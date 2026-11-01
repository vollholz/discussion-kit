/**
 * Anhänge an Zielen (je registriertem Zieltyp mit `attachments`, targets.ts).
 *
 * Hochladen: POST /v1/<ziel>/{id}/attachments?name=<dateiname> mit dem Dateiinhalt als Body (beliebiger
 * Content-Type, `Content-Length` Pflicht). Der Inhalt fliesst als Strom durch: Typerkennung am Anfang (sniff.ts),
 * SHA-256, optional Viren-Scan (scan.ts), Verschlüsselung (sealed-stream.ts) und Ablage (storage.ts). Erst wenn alles
 * gelungen ist, entsteht die Metadatenzeile; sonst wird die Datei wieder entfernt.
 *
 * Herunterladen nur über die API mit Rechteprüfung, immer als `Content-Disposition: attachment`, `nosniff` und
 * einer CSP ohne jede Quelle (`sandbox`), damit nichts im Ursprung der Plattform ausgeführt wird. Die Oberfläche
 * zeigt nur Rasterbilder als Vorschau (`preview`), nie HTML oder SVG.
 *
 * Rechte: Lesen wie das Ziel. Hochladen `attachment:write` (am Ziel); löschen (weich) wer hochgeladen hat (mit
 * `attachment:write`) oder `attachment:delete`. Bereinigung weich gelöschter Anhänge: `purgeDeletedAttachments`.
 */
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough, pipeline as pipeCb, Readable, Transform, type TransformCallback } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Type } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import { permissionText, type Tx } from './host.ts';
import { Cursor, DateTime, decodeCursor, Deleted, encodeCursor, IdParams, Limit, NextCursor, Nullable, PersonRef, Problem } from './http.ts';
import type { Ctx } from './plugin.ts';
import { ScanError } from './scan.ts';
import { contentAad, LengthMismatch, newWrappedKey, openStream, sealedLength, sealStream, unwrapKey } from './sealed-stream.ts';
import { classify, PREVIEWABLE, SNIFF_BYTES } from './sniff.ts';
import { BlobNotFound, blobKey } from './storage.ts';
import { eventTarget, personSql, targetFields, visibleTarget, type DiscussionTarget, type LoadedTarget } from './targets.ts';

const TAG = 'Kommentare und Anhänge';

const AttachmentOut = Type.Object({
  id: Type.String(),
  targetType: Type.String({ description: 'Art des Ziels: `object`, `connection`' }), targetId: Type.String(),
  objectId: Type.Optional(Type.String({ description: 'Nur an Objekten, gleich `targetId`' })),
  name: Type.String(),
  size: Type.Integer({ minimum: 0, description: 'Bytes' }),
  mediaType: Type.String({ description: 'Am Inhalt erkannter MIME-Typ' }),
  sha256: Type.String({ description: 'SHA-256 des Inhalts (hex); auch ETag des Downloads' }),
  uploadedBy: Nullable(PersonRef), uploadedAt: DateTime,
  preview: Type.Boolean({ description: '`true` für Rasterbilder (PNG, JPEG, GIF, WebP), die als Vorschau angezeigt werden dürfen' }),
}, { title: 'Attachment' });

interface Row {
  id: string; target_type: string; target_id: string; name: string; size: string; media_type: string; sha256: string; storage_key: string; key_id: string; wrapped_key: Buffer;
  uploaded_by: string | null; uploader: { id: string; name: string } | null; uploaded_at: Date; deleted_at: Date | null; _sort?: string;
}

const toAttachment = (r: Row) => ({
  id: r.id, ...targetFields(r.target_type, r.target_id), name: r.name, size: Number(r.size), mediaType: r.media_type, sha256: r.sha256,
  uploadedBy: r.uploader, uploadedAt: r.uploaded_at, preview: PREVIEWABLE.has(r.media_type),
});
/** Anhang für Ereignisse; an vertraulichen Zielen nur IDs (Name, Typ, Grösse und Prüfsumme über die API). */
const eventAttachment = (r: Row, t: LoadedTarget) => {
  const ref = { id: r.id, ...targetFields(r.target_type, r.target_id), uploadedBy: r.uploaded_by };
  return t.classified ? ref : { ...ref, name: r.name, size: Number(r.size), mediaType: r.media_type, sha256: r.sha256, uploadedAt: r.uploaded_at };
};

/** Dateiname für Metadaten und Download: ohne Pfad, ohne Steuerzeichen, höchstens 255 Zeichen. */
export function cleanName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = raw.split(/[\\/]/).pop()!.replace(/[\u0000-\u001F\u007F]/g, '').normalize('NFC').trim();
  const name = base.replace(/^\.+/, '').slice(0, 255);
  if (!name) throw new InvalidName();
  return name;
}

/** `Content-Disposition: attachment` mit ASCII-Ersatz und UTF-8-Namen (RFC 6266/8187). */
export function contentDisposition(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const utf8 = encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(n % (1024 * 1024) ? 1 : 0)} MiB` : n >= 1024 ? `${Math.round(n / 1024)} KiB` : `${n} Bytes`);

/** Dateiname fehlt oder besteht nur aus Pfad, Punkten oder Steuerzeichen. */
export class InvalidName extends Error { constructor() { super('Dateiname fehlt oder ist ungültig.'); } }

class UploadAborted extends Error { constructor() { super('Upload abgebrochen'); } }

class Rejected extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Puffert den Anfang, prüft den Typ und gibt dann alles unverändert weiter. */
class Sniffer extends Transform {
  type: string | null = null;
  private head: Buffer[] = [];
  private n = 0;
  private readonly o: { size: number; declared: string | null; name: string; allowed: string[] };
  constructor(o: { size: number; declared: string | null; name: string; allowed: string[] }) { super(); this.o = o; }
  private decide(complete: boolean, cb: TransformCallback) {
    const all = Buffer.concat(this.head);
    this.head = [];
    const v = classify({ head: all.subarray(0, SNIFF_BYTES), complete, declared: this.o.declared, name: this.o.name, allowed: this.o.allowed });
    if (!v.ok) return cb(new Rejected(v.reason.includes('nicht erlaubt') ? 415 : 422, v.reason));
    this.type = v.type;
    cb(null, all);
  }
  override _transform(c: Buffer, _e: BufferEncoding, cb: TransformCallback) {
    if (this.type) return cb(null, c);
    this.head.push(c); this.n += c.length;
    if (this.n >= Math.min(SNIFF_BYTES, this.o.size)) return this.decide(this.n >= this.o.size, cb);
    cb();
  }
  override _flush(cb: TransformCallback) { if (this.type) return cb(); this.decide(true, cb); }
}

export function registerAttachments(c: Ctx) {
  const { app, k, host, targets, schema: S } = c;
  const a = c.attachments!;
  const keys = a.keys;
  const COLS = `a.id, a.target_type, a.target_id, a.name, a.size, a.media_type, a.sha256, a.storage_key, a.key_id, a.wrapped_key, a.uploaded_by, ${personSql(S, 'a.uploaded_by')} AS uploader, a.uploaded_at, a.deleted_at`;

  async function load(tx: Tx, id: string): Promise<Row | undefined> {
    return (await tx.query<Row>(`SELECT ${COLS} FROM ${S}.attachment a WHERE a.id = $1`, [id])).rows[0];
  }
  async function readable(req: FastifyRequest, tx: Tx, id: string) {
    const r = await load(tx, id);
    if (!r || r.deleted_at) throw k.notFound('Anhang');
    const def = targets.get(r.target_type);
    if (def) await k.needSomewhere(req, def.read);
    const t = await visibleTarget(k, req, tx, def, r.target_id, 'Anhang');
    return { r, def: def!, t };
  }

  for (const def of targets.list) if (def.attachments !== false) registerTargetRoutes(def);

  function registerTargetRoutes(def: DiscussionTarget) {
    app.get(`${def.basePath}/:id/attachments`, {
      schema: {
        tags: [TAG], summary: `Anhänge ${def.label.of}`, params: IdParams, description: 'Älteste zuerst. Cursor-Paginierung wie bei Objekten.',
        querystring: Type.Object({ limit: Type.Optional(Limit), cursor: Type.Optional(Cursor) }),
        response: { 200: Type.Object({ items: Type.Array(AttachmentOut), nextCursor: NextCursor, total: Type.Integer({ minimum: 0 }) }) },
      },
    }, async req => {
      await k.needSomewhere(req, def.read);
      const limit = req.query.limit ?? 50;
      const cur = decodeCursor(k, req.query.cursor);
      return host.tx(req, async tx => {
        const t = await visibleTarget(k, req, tx, def, req.params.id, def.label.one);
        const params: unknown[] = [def.type, t.id, limit + 1];
        if (cur) params.push(cur.v, cur.id);
        const rows = (await tx.query<Row>(`SELECT ${COLS}, a.uploaded_at::text AS _sort FROM ${S}.attachment a
            WHERE a.target_type = $1 AND a.target_id = $2 AND a.deleted_at IS NULL ${cur ? 'AND (a.uploaded_at, a.id) > ($4::timestamptz, $5::uuid)' : ''}
            ORDER BY a.uploaded_at, a.id LIMIT $3`, params)).rows;
        const total = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.attachment WHERE target_type = $1 AND target_id = $2 AND deleted_at IS NULL`, [def.type, t.id])).rows[0]!.n;
        const page = rows.slice(0, limit), last = page[page.length - 1];
        return { items: page.map(toAttachment), nextCursor: rows.length > limit && last ? encodeCursor({ v: last._sort!, id: last.id }) : null, total };
      });
    });

    // Upload: eigener Kontext, in dem kein Body-Parser greift – der Handler liest den Strom selbst.
    app.register(async sub => {
      sub.removeAllContentTypeParsers();
      sub.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));
      (sub as Ctx['app']).post(`${def.basePath}/:id/attachments`, {
        schema: {
          tags: [TAG], summary: `Anhang hochladen (${def.label.one})`, params: IdParams,
          description: `Body = Dateiinhalt (kein multipart), \`Content-Type\` = Typ der Datei (oder application/octet-stream), \`Content-Length\` Pflicht (411 ohne). Höchstens ${fmtBytes(a.maxBytes)} (sonst 413). Der Typ wird am Inhalt erkannt: Passt er nicht zur Angabe oder zur Dateiendung, 422; ist er nicht erlaubt, 415. Mit Viren-Scan lehnt ein Fund mit 422 ab, ein nicht erreichbarer Scanner mit 503. Recht \`attachment:write\` ${def.label.at}. Ereignis \`attachment.created\`.`,
          querystring: Type.Object({ name: Type.String({ minLength: 1, maxLength: 1000, description: 'Dateiname (ohne Pfad), URL-kodiert' }) }),
          // Nur für die Beschreibung: «*/*» passt auf keinen konkreten Content-Type, Fastify validiert den Strom darum nicht
          body: { content: { '*/*': { schema: { type: 'string', format: 'binary', description: 'Inhalt der Datei' } } } },
          headers: Type.Object({ 'content-length': Type.Optional(Type.String({ pattern: '^\\d+$' })) }),
          response: {
            201: AttachmentOut,
            411: { description: 'Content-Length fehlt', content: { 'application/problem+json': { schema: Problem } } },
            413: { description: 'Datei zu gross', content: { 'application/problem+json': { schema: Problem } } },
            415: { description: 'Dateityp nicht erlaubt', content: { 'application/problem+json': { schema: Problem } } },
            503: { description: 'Viren-Scan oder Verschlüsselung nicht verfügbar', content: { 'application/problem+json': { schema: Problem } } },
          },
        },
      }, async (req, reply) => {
        const p = host.principal(req);
        const q = req.query as { name: string }, params = req.params as { id: string };
        // Bei vorzeitiger Ablehnung wird der Rest nicht mehr gelesen: Verbindung danach schliessen
        const reject = (e: Error) => { reply.header('connection', 'close'); return e; };
        const t = await host.tx(req, tx => visibleTarget(k, req, tx, def, params.id, def.label.one));
        await k.need(req, 'attachment:write', { type: def.type, id: t.id }, t.hint);
        let name: string;
        try { name = cleanName(q.name); } catch { throw k.invalid('Dateiname fehlt oder ist ungültig.', [{ path: '/name', message: 'ungültig' }]); }
        const len = req.headers['content-length'];
        if (len === undefined) throw reject(k.error(411, 'Länge fehlt', 'Header Content-Length angeben; Uploads ohne Längenangabe (chunked) sind nicht möglich.'));
        const size = Number(len);
        if (!Number.isSafeInteger(size) || size < 0) throw reject(k.error(400, 'Content-Length ungültig'));
        if (size > a.maxBytes) throw reject(k.error(413, 'Datei zu gross', `«${name}» hat ${fmtBytes(size)}; erlaubt sind höchstens ${fmtBytes(a.maxBytes)}.`));
        if (!keys.length) throw reject(k.error(503, 'Anhänge nicht verfügbar', 'Für verschlüsselte Ablage fehlt ein Hauptschlüssel (ENCRYPTION_KEYS).'));

        const id = randomUUID(), key = blobKey(p.tenantId, id);
        const wk = newWrappedKey(keys, p.tenantId, id);
        const hash = createHash('sha256');
        const declared = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : null;
        const sniffer = new Sniffer({ size, declared, name, allowed: a.allowedTypes });
        const hasher = new Transform({ transform(c: Buffer, _e, cb) { hash.update(c); cb(null, c); } });
        const scan = a.scanner?.start() ?? null;
        // Nicht req.raw selbst in die Pipeline: bei einem Fehler würde sie die Anfrage (und den Socket) zerstören,
        // bevor die Fehlerantwort gesendet ist.
        const entry = new PassThrough();
        const onClose = () => { if (!req.raw.complete) entry.destroy(new UploadAborted()); };
        req.raw.on('close', onClose);
        req.raw.on('error', onClose);
        req.raw.pipe(entry);
        const out = new PassThrough();
        try {
          const flow = pipeline(entry, sniffer, hasher, ...(scan ? [scan.tap] : []), sealStream(wk.key, contentAad(p.tenantId, id), size), out);
          const put = a.blobs.put(key, out, sealedLength(size)).catch(e => { out.destroy(e as Error); throw e; });
          // Beide abwarten: sonst könnte die Ablage nach dem Aufräumen noch fertig schreiben
          const failure = (await Promise.allSettled([flow, put])).find(r => r.status === 'rejected');
          if (failure) throw failure.reason;
          if (scan) {
            const r = await scan.result();
            if (!r.clean) {
              req.log.warn({ attachment: id, signature: r.signature }, 'Anhang abgelehnt: Schadsoftware erkannt');
              throw k.error(422, 'Datei abgelehnt', `In «${name}» wurde Schadsoftware erkannt (${r.signature}).`);
            }
          }
          const row = await host.tx(req, async tx => {
            // aktueller Stand: die Vertraulichkeit kann sich während des Uploads geändert haben
            const cur = await visibleTarget(k, req, tx, def, t.id, def.label.one);
            const r = (await tx.query<Row>(`WITH a AS (INSERT INTO ${S}.attachment (tenant_id, id, target_type, target_id, name, size, media_type, sha256, storage_key, key_id, wrapped_key, uploaded_by)
                VALUES ($12, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *) SELECT ${COLS} FROM a`,
              [id, def.type, t.id, name, size, sniffer.type, hash.digest('hex'), key, wk.keyId, wk.wrapped, p.id, p.tenantId])).rows[0]!;
            await k.audit(req, tx, { action: 'attachment.created', resourceType: 'attachment', resourceId: id, data: { ...targetFields(def.type, t.id), name, size, mediaType: r.media_type, sha256: r.sha256 } });
            await k.emit(tx, 'attachment.created', id, { attachment: eventAttachment(r, cur), ...eventTarget(def, cur) });
            return r;
          });
          return reply.status(201).header('location', `/v1/attachments/${id}`).send(toAttachment(row));
        } catch (e) {
          scan?.abort();
          // Rest der Anfrage verwerfen (höchstens die erlaubte Grösse), damit die Fehlerantwort ankommt
          req.raw.unpipe(entry);
          if (!req.raw.destroyed) req.raw.resume();
          await a.blobs.delete(key).catch(err => req.log.error({ err, key }, 'Anhang: Aufräumen der Ablage fehlgeschlagen'));
          if (e instanceof Rejected) throw k.error(e.status, e.status === 415 ? 'Dateityp nicht erlaubt' : 'Inhalt passt nicht', e.message);
          if (e instanceof LengthMismatch) throw k.error(400, 'Upload unvollständig', `Erwartet ${e.expected} Bytes, erhalten ${e.actual}.`);
          if (e instanceof UploadAborted) throw reject(k.error(400, 'Upload abgebrochen'));
          if (e instanceof ScanError) throw k.error(503, 'Viren-Scan nicht verfügbar', 'Die Datei wurde nicht gespeichert. Später erneut versuchen.');
          throw e;
        } finally {
          req.raw.off('close', onClose);
          req.raw.off('error', onClose);
        }
      });
    });
  }

  app.get('/v1/attachments/:id', {
    schema: { tags: [TAG], summary: 'Anhang (Metadaten)', params: IdParams, response: { 200: AttachmentOut } },
  }, async req => {
    return toAttachment((await host.tx(req, tx => readable(req, tx, req.params.id))).r);
  });

  app.get('/v1/attachments/:id/content', {
    schema: {
      tags: [TAG], summary: 'Anhang herunterladen', params: IdParams,
      description: 'Immer als Download (`Content-Disposition: attachment`), mit `X-Content-Type-Options: nosniff` und `Content-Security-Policy: default-src \'none\'; sandbox`. `ETag` = SHA-256; `If-None-Match` ergibt 304.',
      headers: Type.Object({ 'if-none-match': Type.Optional(Type.String()) }),
      response: {
        200: { description: 'Inhalt der Datei', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } },
        304: Type.Null({ description: 'Unverändert' }),
      },
    },
  }, async (req, reply) => {
    const p = host.principal(req);
    const { r } = await host.tx(req, tx => readable(req, tx, req.params.id));
    const tag = `"${r.sha256}"`;
    reply.header('etag', tag).header('cache-control', 'private, no-cache').header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'; sandbox").header('cross-origin-resource-policy', 'same-origin');
    if (req.headers['if-none-match'] === tag) return reply.status(304).send(null);
    let src: Readable;
    try { src = await a.blobs.get(r.storage_key); } catch (e) {
      if (e instanceof BlobNotFound) { req.log.error({ attachment: r.id }, 'Anhang: Datei fehlt in der Ablage'); throw k.error(500, 'Datei fehlt in der Ablage', `Referenz ${req.id}`); }
      throw e;
    }
    const dec = openStream(unwrapKey(keys, r.key_id, r.wrapped_key, p.tenantId, r.id), contentAad(p.tenantId, r.id), Number(r.size));
    const body = pipeCb(src, dec, e => { if (e) req.log.error({ err: e, attachment: r.id }, 'Anhang: Entschlüsseln fehlgeschlagen'); });
    const type = r.media_type.startsWith('text/') ? `${r.media_type}; charset=utf-8` : r.media_type;
    return reply.header('content-type', type).header('content-length', String(r.size)).header('content-disposition', contentDisposition(r.name)).send(body as never);
  });

  app.delete('/v1/attachments/:id', {
    schema: {
      tags: [TAG], summary: 'Anhang löschen', params: IdParams, response: Deleted,
      description: 'Weichlöschung durch die hochladende Person (`attachment:write`) oder mit `attachment:delete`. Die Datei wird nach der Aufbewahrungsfrist der App aus der Ablage entfernt. Ereignis `attachment.deleted`.',
    },
  }, async (req, reply) => {
    const p = host.principal(req);
    await host.tx(req, async tx => {
      const { r, def, t } = await readable(req, tx, req.params.id);
      const ref = { type: def.type, id: t.id };
      const own = r.uploaded_by === p.id && (await host.can(req, 'attachment:write', ref, t.hint));
      if (!own && !(await host.can(req, 'attachment:delete', ref, t.hint))) throw k.forbidden(`Nur wer hochgeladen hat oder mit dem Recht ${permissionText('attachment:delete')}.`);
      await tx.query(`UPDATE ${S}.attachment SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`, [r.id, p.id]);
      await k.audit(req, tx, { action: 'attachment.deleted', resourceType: 'attachment', resourceId: r.id, data: { ...targetFields(def.type, t.id), name: r.name } });
      await k.emit(tx, 'attachment.deleted', r.id, { attachment: eventAttachment(r, t), ...eventTarget(def, t), deletedBy: p.id });
    });
    return reply.status(204).send(null);
  });
}
