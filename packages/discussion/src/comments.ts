/**
 * Kommentare an Zielen (je registriertem Zieltyp).
 *
 * - Text ist eine Markdown-Teilmenge und wird als Text gespeichert; der Server erzeugt kein HTML. Erwähnungen stehen im
 *   Text als `@[Name](<principal-id>)`; der Server prüft die Personen und legt ihre IDs in `mentions` ab.
 * - Sichtbarkeit folgt dem Ziel: unsichtbares Ziel = 404, auch für einzelne Kommentare.
 * - Schreiben `comment:write` am Ziel. Bearbeiten nur die Autorin bzw. der Autor; der vorherige Stand bleibt als
 *   Revision erhalten. Löschen (weich) die Autorin bzw. der Autor oder `comment:moderate`.
 * - Antworten eine Ebene tief: Antwort auf eine Antwort hängt am selben Ausgangskommentar.
 * - Erwähnte Personen und wer eine Antwort erhält, werden benachrichtigt (`notify`).
 */
import { Type } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import type { Tx } from './host.ts';
import { Cursor, DateTime, decodeCursor, Deleted, encodeCursor, etag, IdParams, ifMatchVersion, Limit, NextCursor, Nullable, PersonRef, Uuid } from './http.ts';
import type { Ctx } from './plugin.ts';
import { eventTarget, personSql, targetFields, visibleTarget, type DiscussionNotice, type DiscussionTarget, type LoadedTarget } from './targets.ts';

const TAG = 'Kommentare und Anhänge';
export const BODY_MAX = 10_000;
export const MENTIONS_MAX = 20;
/** Länge des Ausschnitts in Benachrichtigungen. */
const EXCERPT_MAX = 160;

/** Erwähnung im Text: `@[Anzeigename](uuid)`. */
const MENTION = /@\[([^\]\n]{1,200})\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

const Body = Type.String({ minLength: 1, maxLength: BODY_MAX, description: 'Markdown-Teilmenge (Absätze, **fett**, *kursiv*, `Code`, Listen mit «- », Links http/https). Erwähnung als `@[Name](<personen-id>)` mit einer ID aus GET /v1/people. HTML wird nicht interpretiert.' });
export const CommentOut = Type.Object({
  id: Type.String(),
  targetType: Type.String({ description: 'Art des Ziels, z. B. `object`' }), targetId: Type.String(),
  objectId: Type.Optional(Type.String({ description: 'Nur an Objekten, gleich `targetId`' })),
  author: PersonRef,
  body: Nullable(Type.String({ description: '`null` bei gelöschten Kommentaren' })),
  mentions: Type.Array(PersonRef, { description: 'Erwähnte Personen in Reihenfolge des Textes' }),
  replyTo: Nullable(Type.String({ description: 'Ausgangskommentar bei Antworten' })),
  createdAt: DateTime, editedAt: Nullable(DateTime),
  revision: Type.Integer({ minimum: 1, description: 'Stand des Textes, gleich dem ETag W/"<revision>". Frühere Stände unter /v1/comments/{id}/revisions.' }),
  deleted: Type.Boolean({ description: 'Gelöscht; erscheint in Listen nur als Platzhalter, solange sichtbare Antworten darauf verweisen' }),
}, { title: 'Comment' });
const RevisionOut = Type.Object({
  revision: Type.Integer(), body: Type.String(), mentions: Type.Array(PersonRef), writtenAt: DateTime, replacedAt: DateTime,
}, { title: 'CommentRevision' });
const IfMatch = Type.Object({ 'if-match': Type.Optional(Type.String({ description: 'ETag aus GET (W/"<revision>"). Bei Abweichung 412.' })) });

interface Row {
  id: string; target_type: string; target_id: string; author: { id: string; name: string } | null; author_id: string; body: string; mentions_ref: { id: string; name: string }[] | null; mentions: string[];
  reply_to: string | null; created_at: Date; edited_at: Date | null; revision: number; deleted_at: Date | null; _sort?: string;
}

export const toComment = (r: Row) => {
  const deleted = r.deleted_at !== null;
  return {
    id: r.id, ...targetFields(r.target_type, r.target_id), author: r.author ?? { id: r.author_id, name: 'Unbekannt' }, body: deleted ? null : r.body, mentions: deleted ? [] : r.mentions_ref ?? [],
    replyTo: r.reply_to, createdAt: r.created_at, editedAt: r.edited_at, revision: r.revision, deleted,
  };
};

/** Kommentar für Ereignisse; an vertraulichen Zielen nur IDs (Text und Erwähnungen über die API). */
const eventComment = (r: Row, t: LoadedTarget) => t.classified ? commentRef(r) : ({ ...commentRef(r), body: r.body, mentions: r.mentions, createdAt: r.created_at, editedAt: r.edited_at, revision: r.revision });
/** Für Ereignisse: IDs statt Namen (Namen können sich ändern und sind über /v1/people abrufbar). */
const commentRef = (r: Pick<Row, 'id' | 'target_type' | 'target_id' | 'author_id' | 'reply_to'>) => ({ id: r.id, ...targetFields(r.target_type, r.target_id), authorId: r.author_id, replyTo: r.reply_to });

/**
 * Ausschnitt eines Kommentars für Benachrichtigungen, mit der Lesesicht der anfragenden Person: Erwähnungen als
 * «@Name», Zeilen zusammengefasst, gekürzt. Gelöscht oder unsichtbar = null.
 */
export function commentExcerpt(schema: string) {
  return async (tx: Tx, id: string): Promise<string | null> => {
    const r = (await tx.query<{ body: string }>(`SELECT body FROM ${schema}.comment WHERE id = $1 AND deleted_at IS NULL`, [id])).rows[0];
    if (!r) return null;
    const text = r.body.replace(MENTION, (_m, name: string) => `@${name}`).replace(/\s+/g, ' ').trim();
    return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1)}…` : text;
  };
}

export function registerComments(c: Ctx) {
  const { app, k, host, targets, schema: S } = c;
  const COLS = `c.id, c.target_type, c.target_id, c.author_id, ${personSql(S, 'c.author_id')} AS author, c.body, c.mentions,
  (SELECT json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, p.client_id, 'Unbekannt')) ORDER BY array_position(c.mentions, p.id)) FROM ${S}.principal p WHERE p.id = ANY(c.mentions)) AS mentions_ref,
  c.reply_to, c.created_at, c.edited_at, c.revision, c.deleted_at`;

  /** Text prüfen und Erwähnungen auflösen; unbekannte Personen lehnt der Server ab. */
  async function parseBody(tx: Tx, raw: string): Promise<{ body: string; mentions: string[] }> {
    const body = raw.replace(/\r\n?/g, '\n');
    if (!body.trim()) throw k.invalid('Kommentar ist leer.', [{ path: '/body', message: 'darf nicht leer sein' }]);
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body)) throw k.invalid('Steuerzeichen sind nicht erlaubt.', [{ path: '/body', message: 'enthält Steuerzeichen' }]);
    const mentions = [...new Set([...body.matchAll(MENTION)].map(m => m[2]!.toLowerCase()))];
    if (mentions.length > MENTIONS_MAX) throw k.invalid(`Höchstens ${MENTIONS_MAX} Personen erwähnen.`, [{ path: '/body', message: 'zu viele Erwähnungen' }]);
    if (mentions.length) {
      const found = new Set((await tx.query<{ id: string }>(`SELECT id FROM ${S}.principal WHERE id = ANY($1::uuid[]) AND kind = 'user' AND removed_at IS NULL`, [mentions])).rows.map(r => r.id));
      const unknown = mentions.filter(m => !found.has(m));
      if (unknown.length) throw k.invalid('Erwähnte Person unbekannt.', unknown.map(u => ({ path: '/body', message: `Person ${u} nicht gefunden` })));
    }
    return { body, mentions };
  }

  const loadComment = async (tx: Tx, id: string) => (await tx.query<Row>(`SELECT ${COLS} FROM ${S}.comment c WHERE c.id = $1`, [id])).rows[0];

  /** Kommentar mit sichtbarem Ziel; gelöscht, unsichtbar oder Zieltyp unbekannt = 404. */
  async function readable(req: FastifyRequest, tx: Tx, id: string) {
    const cm = await loadComment(tx, id);
    if (!cm || cm.deleted_at) throw k.notFound('Kommentar');
    const def = targets.get(cm.target_type);
    if (def) await k.needSomewhere(req, def.read);
    const t = await visibleTarget(k, req, tx, def, cm.target_id, 'Kommentar');
    return { c: cm, def: def!, t };
  }

  /** Benachrichtigen, ohne die schreibende Person selbst; nur Personen (keine Clients), die es noch gibt. */
  async function notify(tx: Tx, def: DiscussionTarget, t: LoadedTarget, cm: Row, actor: { id: string; tenantId: string }, wanted: DiscussionNotice['recipients']) {
    if (!c.notify) return;
    const ids = [...new Set(wanted.map(w => w.id))].filter(id => id !== actor.id);
    if (!ids.length) return;
    const users = new Set((await tx.query<{ id: string }>(`SELECT id FROM ${S}.principal WHERE id = ANY($1::uuid[]) AND kind = 'user' AND removed_at IS NULL`, [ids])).rows.map(r => r.id));
    const seen = new Set<string>();
    const recipients = wanted.filter(w => users.has(w.id) && !seen.has(w.id) && seen.add(w.id));
    if (recipients.length) await c.notify(tx, { tenantId: actor.tenantId, recipients, targetType: def.type, targetId: t.id, subjectType: 'comment', subjectId: cm.id, actorId: actor.id });
  }

  for (const def of targets.list) {
    app.get(`${def.basePath}/:id/comments`, {
      schema: {
        tags: [TAG], summary: `Kommentare ${def.label.of}`, params: IdParams,
        description: 'Chronologisch (älteste zuerst), Antworten mit `replyTo`. Gelöschte Kommentare erscheinen nur als Platzhalter (`deleted`, ohne Text), solange sichtbare Antworten darauf verweisen. Cursor-Paginierung.',
        querystring: Type.Object({ limit: Type.Optional(Limit), cursor: Type.Optional(Cursor) }),
        response: { 200: Type.Object({ items: Type.Array(CommentOut), nextCursor: NextCursor, total: Type.Integer({ minimum: 0, description: `Nicht gelöschte Kommentare ${def.label.of}` }) }) },
      },
    }, async req => {
      await k.needSomewhere(req, def.read);
      const limit = req.query.limit ?? 50;
      const cur = decodeCursor(k, req.query.cursor);
      return host.tx(req, async tx => {
        const t = await visibleTarget(k, req, tx, def, req.params.id, def.label.one);
        const params: unknown[] = [def.type, t.id, limit + 1];
        if (cur) params.push(cur.v, cur.id);
        const rows = (await tx.query<Row>(
          `SELECT ${COLS}, c.created_at::text AS _sort FROM ${S}.comment c
            WHERE c.target_type = $1 AND c.target_id = $2
              AND (c.deleted_at IS NULL OR EXISTS (SELECT 1 FROM ${S}.comment r WHERE r.tenant_id = c.tenant_id AND r.reply_to = c.id AND r.deleted_at IS NULL))
              ${cur ? 'AND (c.created_at, c.id) > ($4::timestamptz, $5::uuid)' : ''}
            ORDER BY c.created_at, c.id LIMIT $3`, params)).rows;
        const total = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.comment WHERE target_type = $1 AND target_id = $2 AND deleted_at IS NULL`, [def.type, t.id])).rows[0]!.n;
        const page = rows.slice(0, limit), last = page[page.length - 1];
        return { items: page.map(toComment), nextCursor: rows.length > limit && last ? encodeCursor({ v: last._sort!, id: last.id }) : null, total };
      });
    });

    app.post(`${def.basePath}/:id/comments`, {
      schema: {
        tags: [TAG], summary: `Kommentar schreiben (${def.label.one})`, params: IdParams,
        description: `Recht \`comment:write\` ${def.label.at}. Erwähnte Personen müssen im Mandanten bekannt sein (GET /v1/people). Antwort mit \`Location\` und \`ETag\`. Ereignis \`comment.created\` mit den erwähnten Personen; Erwähnte und wer eine Antwort erhält, werden benachrichtigt.`,
        body: Type.Object({ body: Body, replyTo: Type.Optional(Uuid) }, { additionalProperties: false }),
        response: { 201: CommentOut },
      },
    }, async (req, reply) => {
      const p = host.principal(req);
      const row = await host.tx(req, async tx => {
        const t = await visibleTarget(k, req, tx, def, req.params.id, def.label.one);
        await k.need(req, 'comment:write', { type: def.type, id: t.id }, t.hint);
        const { body, mentions } = await parseBody(tx, req.body.body);
        let replyTo: string | null = null, repliedTo: string | null = null;
        if (req.body.replyTo) {
          const parent = (await tx.query<{ id: string; target_type: string; target_id: string; reply_to: string | null; author_id: string; deleted_at: Date | null }>(
            `SELECT id, target_type, target_id, reply_to, author_id, deleted_at FROM ${S}.comment WHERE id = $1`, [req.body.replyTo])).rows[0];
          if (!parent || parent.target_type !== def.type || parent.target_id !== t.id || parent.deleted_at) throw k.invalid(`Kommentar, auf den geantwortet wird, gibt es ${def.label.at} nicht.`, [{ path: '/replyTo', message: 'nicht gefunden' }]);
          replyTo = parent.reply_to ?? parent.id;
          repliedTo = parent.author_id;
        }
        const id = (await tx.query<{ id: string }>(`INSERT INTO ${S}.comment (tenant_id, target_type, target_id, author_id, body, mentions, reply_to) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [p.tenantId, def.type, t.id, p.id, body, mentions, replyTo])).rows[0]!.id;
        const cm = (await loadComment(tx, id))!;
        await k.audit(req, tx, { action: 'comment.created', resourceType: 'comment', resourceId: id, data: { ...targetFields(def.type, t.id), replyTo, mentions } });
        await k.emit(tx, 'comment.created', id, { comment: eventComment(cm, t), ...eventTarget(def, t) });
        await notify(tx, def, t, cm, p, [...mentions.map(m => ({ id: m, kind: 'mention' as const })), ...(repliedTo ? [{ id: repliedTo, kind: 'reply' as const }] : [])]);
        return cm;
      });
      return reply.status(201).header('location', `/v1/comments/${row.id}`).header('etag', etag(row.revision)).send(toComment(row));
    });
  }

  app.get('/v1/comments/:id', {
    schema: { tags: [TAG], summary: 'Kommentar lesen', description: 'Gelöscht oder Ziel unsichtbar: 404.', params: IdParams, response: { 200: CommentOut } },
  }, async (req, reply) => {
    const { c: cm } = await host.tx(req, tx => readable(req, tx, req.params.id));
    return reply.header('etag', etag(cm.revision)).send(toComment(cm));
  });

  app.patch('/v1/comments/:id', {
    schema: {
      tags: [TAG], summary: 'Kommentar bearbeiten', params: IdParams, headers: IfMatch,
      description: 'Nur die Autorin bzw. der Autor (mit `comment:write`); fremde Texte ändert niemand, auch nicht mit `comment:moderate` (stattdessen löschen). Der vorherige Stand bleibt als Revision erhalten, `editedAt` zeigt die Bearbeitung an. Mit `If-Match` optimistisch gesperrt. Ereignis `comment.updated`; neu Erwähnte werden benachrichtigt.',
      body: Type.Object({ body: Body }, { additionalProperties: false }), response: { 200: CommentOut },
    },
  }, async (req, reply) => {
    const p = host.principal(req);
    const expected = ifMatchVersion(k, req.headers['if-match']);
    const row = await host.tx(req, async tx => {
      const { c: cm, def, t } = await readable(req, tx, req.params.id);
      await k.need(req, 'comment:write', { type: def.type, id: t.id }, t.hint);
      if (cm.author_id !== p.id) throw k.forbidden('Nur die Autorin bzw. der Autor kann einen Kommentar bearbeiten.');
      if (expected !== undefined && expected !== cm.revision) throw k.error(412, 'Kommentar wurde inzwischen geändert', undefined, { currentVersion: cm.revision });
      const { body, mentions } = await parseBody(tx, req.body.body);
      if (body === cm.body) return cm;
      await tx.query(`INSERT INTO ${S}.comment_revision (tenant_id, comment_id, revision, body, mentions, written_at, replaced_by) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [p.tenantId, cm.id, cm.revision, cm.body, cm.mentions, cm.edited_at ?? cm.created_at, p.id]);
      const u = await tx.query(`UPDATE ${S}.comment SET body = $2, mentions = $3, edited_at = now(), revision = revision + 1 WHERE id = $1 AND revision = $4 AND deleted_at IS NULL`, [cm.id, body, mentions, cm.revision]);
      if (!u.rowCount) throw k.error(412, 'Kommentar wurde inzwischen geändert');
      const n = (await loadComment(tx, cm.id))!;
      const added = mentions.filter(m => !cm.mentions.includes(m));
      await k.audit(req, tx, { action: 'comment.updated', resourceType: 'comment', resourceId: cm.id, data: { ...targetFields(def.type, t.id), revision: n.revision, mentions, addedMentions: added } });
      await k.emit(tx, 'comment.updated', cm.id, { comment: eventComment(n, t), ...eventTarget(def, t), previousRevision: cm.revision, ...(t.classified ? {} : { addedMentions: added }) });
      await notify(tx, def, t, n, p, added.map(m => ({ id: m, kind: 'mention' as const })));
      return n;
    });
    return reply.header('etag', etag(row.revision)).send(toComment(row));
  });

  app.delete('/v1/comments/:id', {
    schema: {
      tags: [TAG], summary: 'Kommentar löschen', params: IdParams, response: Deleted,
      description: 'Weichlöschung durch die Autorin bzw. den Autor (`comment:write`) oder mit `comment:moderate`. Der Text verschwindet aus der API; endgültig entfernt nach der Aufbewahrungsfrist der App. Antworten bleiben. Ereignis `comment.deleted`.',
    },
  }, async (req, reply) => {
    const p = host.principal(req);
    await host.tx(req, async tx => {
      const { c: cm, def, t } = await readable(req, tx, req.params.id);
      const ref = { type: def.type, id: t.id };
      const own = cm.author_id === p.id && (await host.can(req, 'comment:write', ref, t.hint));
      const moderated = !own;
      if (moderated) await k.need(req, 'comment:moderate', ref, t.hint);
      await tx.query(`UPDATE ${S}.comment SET deleted_at = now(), deleted_by = $2 WHERE id = $1 AND deleted_at IS NULL`, [cm.id, p.id]);
      await k.audit(req, tx, { action: 'comment.deleted', resourceType: 'comment', resourceId: cm.id, data: { ...targetFields(def.type, t.id), authorId: cm.author_id, moderated } });
      await k.emit(tx, 'comment.deleted', cm.id, { comment: commentRef(cm), ...eventTarget(def, t), deletedBy: p.id, moderated });
    });
    return reply.status(204).send(null);
  });

  app.get('/v1/comments/:id/revisions', {
    schema: {
      tags: [TAG], summary: 'Frühere Stände eines Kommentars', params: IdParams,
      description: 'Bearbeitungen nachvollziehen: frühere Texte, neueste zuerst (der aktuelle Stand ist der Kommentar selbst).',
      response: { 200: Type.Object({ items: Type.Array(RevisionOut) }) },
    },
  }, async req => host.tx(req, async tx => {
    await readable(req, tx, req.params.id);
    const items = (await tx.query(`SELECT r.revision, r.body,
        coalesce((SELECT json_agg(json_build_object('id', p.id, 'name', coalesce(p.display_name, p.client_id, 'Unbekannt')) ORDER BY array_position(r.mentions, p.id)) FROM ${S}.principal p WHERE p.id = ANY(r.mentions)), '[]') AS mentions,
        r.written_at AS "writtenAt", r.replaced_at AS "replacedAt"
      FROM ${S}.comment_revision r WHERE r.comment_id = $1 ORDER BY r.revision DESC`, [req.params.id])).rows;
    return { items };
  }));
}
