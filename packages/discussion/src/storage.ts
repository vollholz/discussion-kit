/**
 * Ablage der Anhänge (verschlüsselte Inhalte, siehe sealed-stream.ts). Schlüssel sind von der Plattform vergeben
 * (`<mandant>/<anhang>`), nie vom Benutzer; Dateinamen stehen nur in den Metadaten.
 *
 * - `FsBlobStore`: Verzeichnis (ATTACHMENT_DIR). Schreiben in eine Teildatei und atomar umbenennen.
 * - `S3BlobStore`: S3-kompatibler Speicher über HTTP(S) mit AWS Signature Version 4, ohne SDK (keine neue
 *   Abhängigkeit). PUT mit bekannter Länge (Strom), GET als Strom, DELETE, Auflisten mit ListObjectsV2.
 *
 * `list` liefert die Einträge seitenweise in der Reihenfolge der Schlüssel (für den Aufräum-Job verwaister Dateien,
 * src/platform/worker/orphans.ts). In versionierten Buckets sieht und löscht die Ablage nur die aktuelle Version
 * (DELETE ohne versionId legt eine Löschmarkierung an); ältere Versionen entfernt die Lebenszyklusregel des Buckets.
 */
import { createHash, createHmac } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export interface BlobStore {
  readonly kind: 'fs' | 's3';
  /** Speichert genau `length` Bytes aus `body`. */
  put(key: string, body: Readable, length: number): Promise<void>;
  get(key: string): Promise<Readable>;
  /** Löscht; fehlt der Eintrag schon, ist das kein Fehler. */
  delete(key: string): Promise<void>;
  /** Alle Einträge seitenweise (höchstens `pageSize` je Seite), aufsteigend nach `name`, nur solche nach `startAfter`. */
  list(o?: { startAfter?: string; pageSize?: number }): AsyncIterable<BlobEntry[]>;
  /** Löscht eine liegengebliebene Teildatei (`kind: 'partial'`, nur Dateisystem). */
  deletePartial(name: string): Promise<void>;
}

/**
 * Eintrag der Ablage. `name`: Name in der Ablage (S3: Objektname ohne Präfix, Dateisystem: `<mandant>/<datei>`),
 * aufsteigend sortiert und Fortsetzungspunkt für `startAfter`.
 * `kind`: `blob` = Datei eines Anhangs (`key` gesetzt), `partial` = Teildatei eines abgebrochenen Schreibvorgangs,
 * `foreign` = passt nicht zum Schema der Plattform (wird nie gelöscht).
 */
export interface BlobEntry { name: string; key: string | null; kind: 'blob' | 'partial' | 'foreign'; modified: Date }

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
export const blobKey = (tenantId: string, attachmentId: string) => `${tenantId}/${attachmentId}`;
function checkKey(key: string) { if (!KEY.test(key)) throw new Error(`Ungültiger Ablageschlüssel «${key}»`); }

export class BlobNotFound extends Error {}

const PARTIAL = /^[0-9a-f-]{36}\/([0-9a-f-]{36})\.\d+\.part$/;
const pageSizeOf = (o?: { pageSize?: number }) => Math.max(1, Math.min(1000, o?.pageSize ?? 1000));

export class FsBlobStore implements BlobStore {
  readonly kind = 'fs' as const;
  private readonly root: string;
  constructor(dir: string) { this.root = resolve(dir); }

  private path(key: string) { checkKey(key); const [t, a] = key.split('/') as [string, string]; return join(this.root, t, a.slice(0, 2), a); }

  async put(key: string, body: Readable, length: number) {
    const file = this.path(key), part = `${file}.${process.pid}.part`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await pipeline(body, createWriteStream(part, { flags: 'wx', mode: 0o600 }));
      const s = await stat(part);
      if (s.size !== length) throw new Error(`Ablage: ${s.size} statt ${length} Bytes geschrieben`);
      await rename(part, file);
    } catch (e) {
      await rm(part, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Readable> {
    const file = this.path(key);
    try { await stat(file); } catch { throw new BlobNotFound(key); }
    return createReadStream(file);
  }

  async delete(key: string) { await rm(this.path(key), { force: true }); }

  async deletePartial(name: string) {
    if (!PARTIAL.test(name)) throw new Error(`Keine Teildatei «${name}»`);
    const [t, f] = name.split('/') as [string, string];
    await rm(join(this.root, t, f.slice(0, 2), f), { force: true });
  }

  /**
   * Verzeichnisse `<mandant>/<aa>/<datei>` sortiert durchlaufen. `aa` ist der Anfang des Dateinamens, darum ist
   * `<mandant>/<datei>` (= `name`) aufsteigend wie der Ablageschlüssel.
   */
  async *list(o: { startAfter?: string; pageSize?: number } = {}): AsyncIterable<BlobEntry[]> {
    const size = pageSizeOf(o), after = o.startAfter ?? '', afterTenant = after.split('/')[0]!;
    const entries = async (p: string) => {
      try { return (await readdir(p, { withFileTypes: true })).map(d => ({ name: d.name, dir: d.isDirectory() })).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0)); }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    };
    let page: BlobEntry[] = [];
    for (const t of await entries(this.root)) {
      if (!t.dir || t.name < afterTenant) continue;
      for (const aa of await entries(join(this.root, t.name))) {
        if (!aa.dir) continue;
        for (const f of await entries(join(this.root, t.name, aa.name))) {
          const name = `${t.name}/${f.name}`;
          if (f.dir || name <= after) continue;
          let modified: Date;
          try { modified = (await stat(join(this.root, t.name, aa.name, f.name))).mtime; } catch { continue; /* inzwischen gelöscht */ }
          const inPlace = f.name.startsWith(aa.name);
          page.push(inPlace && KEY.test(name) ? { name, key: name, kind: 'blob', modified }
            : { name, key: null, kind: inPlace && PARTIAL.test(name) ? 'partial' : 'foreign', modified });
          if (page.length >= size) { yield page; page = []; }
        }
      }
    }
    if (page.length) yield page;
  }
}

/** Anbindung an einen S3-kompatiblen Speicher (AWS, MinIO, Hetzner, Exoscale …). */
export interface S3Config { endpoint: string | null; bucket: string; region: string; prefix: string; pathStyle: boolean; accessKeyId: string | null; secretAccessKey: string | null }
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

/** RFC 3986, wie SigV4 es verlangt; im Objektnamen bleiben Schrägstriche. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encPath = (s: string) => s.split('/').map(enc).join('/');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s, 'utf8').digest();

/**
 * Signatur nach AWS Signature Version 4 (Header-Variante). Exportiert für den Test mit dem Beispiel der AWS-Doku.
 * `headers` müssen `host` und `x-amz-date` enthalten; alle übergebenen Header werden signiert.
 */
export function signV4(o: { method: string; path: string; query?: string; headers: Record<string, string>; payloadHash: string; region: string; accessKeyId: string; secretAccessKey: string; service?: string }): string {
  const service = o.service ?? 's3';
  const amzDate = o.headers['x-amz-date']!, day = amzDate.slice(0, 8);
  const names = Object.keys(o.headers).map(h => h.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(o.headers).map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, ' ')]));
  const canonical = [o.method, o.path, o.query ?? '', names.map(n => `${n}:${lower[n]}\n`).join(''), names.join(';'), o.payloadHash].join('\n');
  const scope = `${day}/${o.region}/${service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, createHash('sha256').update(canonical, 'utf8').digest('hex')].join('\n');
  const kSigning = hmac(hmac(hmac(hmac(`AWS4${o.secretAccessKey}`, day), o.region), service), 'aws4_request');
  return `AWS4-HMAC-SHA256 Credential=${o.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex')}`;
}

export class S3BlobStore implements BlobStore {
  readonly kind = 's3' as const;
  private readonly c: S3Config;
  constructor(c: S3Config) { this.c = c; }

  /** `objectKey` ohne Präfix; ohne Angabe der Bucket selbst (Auflisten). */
  private target(objectKey?: string) {
    const base = new URL(this.c.endpoint!);
    const host = this.c.pathStyle ? base.host : `${this.c.bucket}.${base.host}`;
    const basePath = base.pathname.replace(/\/$/, '');
    const bucketPath = `${basePath}${this.c.pathStyle ? `/${enc(this.c.bucket)}` : ''}`;
    const path = objectKey === undefined ? (bucketPath || '/') : `${bucketPath}/${encPath(`${this.c.prefix}${objectKey}`)}`;
    return { base, host, path };
  }

  private send(method: 'PUT' | 'GET' | 'DELETE', key: string | null, o: { body?: Readable; length?: number; query?: Record<string, string> } = {}): Promise<IncomingMessage> {
    if (key !== null) checkKey(key);
    const { base, host, path } = this.target(key ?? undefined);
    // Kanonische Abfrage nach SigV4: Namen sortiert, Namen und Werte nach RFC 3986 kodiert
    const query = Object.entries(o.query ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&');
    const url = new URL(`${base.protocol}//${host}${path}${query ? `?${query}` : ''}`);
    const amzDate = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    // Inhalt ist bereits verschlüsselt und authentisiert; über HTTPS genügt UNSIGNED-PAYLOAD (kein zweiter Durchlauf)
    const payloadHash = method === 'PUT' ? 'UNSIGNED-PAYLOAD' : EMPTY_SHA256;
    const headers: Record<string, string> = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
    if (method === 'PUT') { headers['content-length'] = String(o.length); headers['content-type'] = 'application/octet-stream'; }
    headers.authorization = signV4({ method, path, query, headers: { ...headers }, payloadHash, region: this.c.region, accessKeyId: this.c.accessKeyId!, secretAccessKey: this.c.secretAccessKey! });
    const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method, headers, timeout: 60_000 });
    return new Promise((ok, fail) => {
      req.on('response', ok);
      req.on('timeout', () => req.destroy(new Error('S3: Zeitüberschreitung')));
      req.on('error', fail);
      if (o.body) pipeline(o.body, req).catch(e => { req.destroy(e as Error); fail(e); });
      else req.end();
    });
  }

  private async fail(res: IncomingMessage, what: string): Promise<never> {
    let text = '';
    for await (const c of res) { if (text.length < 2000) text += String(c); }
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
    throw new Error(`S3 ${what}: HTTP ${res.statusCode}${code ? ` ${code}` : ''}`);
  }

  async put(key: string, body: Readable, length: number) {
    const res = await this.send('PUT', key, { body, length });
    if (res.statusCode !== 200) return this.fail(res, 'Speichern');
    res.resume();
  }

  async get(key: string): Promise<Readable> {
    const res = await this.send('GET', key);
    if (res.statusCode === 404) { res.resume(); throw new BlobNotFound(key); }
    if (res.statusCode !== 200) return this.fail(res, 'Lesen');
    return res;
  }

  async delete(key: string) {
    const res = await this.send('DELETE', key);
    if (res.statusCode !== 204 && res.statusCode !== 200 && res.statusCode !== 404) return this.fail(res, 'Löschen');
    res.resume();
  }

  /** Mehrteilige Uploads verwendet die Plattform nicht; Teildateien gibt es nur im Dateisystem. */
  async deletePartial(name: string): Promise<void> { throw new Error(`S3 kennt keine Teildateien («${name}»)`); }

  /**
   * ListObjectsV2 mit Paginierung (Fortsetzungstoken). Liefert nur aktuelle Versionen; Objekte, deren neuste Version
   * eine Löschmarkierung ist, erscheinen nicht.
   */
  async *list(o: { startAfter?: string; pageSize?: number } = {}): AsyncIterable<BlobEntry[]> {
    const prefix = this.c.prefix;
    let token: string | null = null;
    do {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': String(pageSizeOf(o)), 'encoding-type': 'url' };
      if (prefix) query.prefix = prefix;
      if (token) query['continuation-token'] = token;
      else if (o.startAfter) query['start-after'] = `${prefix}${o.startAfter}`;
      const res = await this.send('GET', null, { query });
      if (res.statusCode !== 200) return this.fail(res, 'Auflisten');
      let xml = '';
      for await (const c of res) xml += String(c);
      const page: BlobEntry[] = [];
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const full = decodeURIComponent(xmlText(/<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1] ?? ''));
        if (!full.startsWith(prefix)) continue;
        const name = full.slice(prefix.length);
        const modified = new Date(xmlText(/<LastModified>([^<]*)<\/LastModified>/.exec(m[1]!)?.[1] ?? ''));
        if (Number.isNaN(modified.getTime())) throw new Error('S3 Auflisten: LastModified fehlt');
        page.push(KEY.test(name) ? { name, key: name, kind: 'blob', modified } : { name, key: null, kind: 'foreign', modified });
      }
      const truncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/.test(xml);
      token = truncated ? xmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || null : null;
      if (truncated && !token) throw new Error('S3 Auflisten: NextContinuationToken fehlt');
      if (page.length) yield page;
    } while (token);
  }
}

const xmlText = (s: string) => s.replace(/&(lt|gt|quot|apos|amp);/g, (_, e: string) => ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' })[e]!);

/** Ablage aus der Konfiguration der App: Dateisystem (`dir`) oder S3. */
export function createBlobStore(cfg: { storage: 'fs' | 's3'; dir: string; s3: S3Config }): BlobStore {
  return cfg.storage === 's3' ? new S3BlobStore(cfg.s3) : new FsBlobStore(cfg.dir);
}
