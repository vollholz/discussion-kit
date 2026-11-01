/** Bausteine der Routen: Schemas (TypeBox), Cursor, ETag. */
import { Type, type TSchema } from '@fastify/type-provider-typebox';
import type { HostKit } from './host.ts';

export const Uuid = Type.String({ format: 'uuid' });
export const DateTime = Type.Unsafe<string | Date>({ type: 'string', format: 'date-time' });
export const Nullable = <T extends TSchema>(s: T) => Type.Union([s, Type.Null()]);
export const IdParams = Type.Object({ id: Uuid });
export const Limit = Type.Integer({ minimum: 1, maximum: 200, default: 50, description: 'Seitengrösse (höchstens 200).' });
export const Cursor = Type.String({ maxLength: 512, description: 'Opaker Cursor aus `nextCursor` der vorherigen Seite.' });
export const NextCursor = Nullable(Type.String({ description: 'Cursor der nächsten Seite; `null` auf der letzten Seite.' }));
export const Deleted = { 204: Type.Null({ description: 'Gelöscht' }) };
/** Fehler als Problem Details (RFC 9457); weitere Felder der Fehlerbehandlung der App bleiben erhalten. */
export const Problem = Type.Object({
  type: Type.Optional(Type.String()), title: Type.Optional(Type.String()), status: Type.Optional(Type.Integer()), detail: Type.Optional(Type.String()), instance: Type.Optional(Type.String()),
}, { additionalProperties: true, title: 'DiscussionProblem' });
export const PersonRef = Type.Object({ id: Type.String(), name: Type.String() }, { title: 'PersonRef' });

/** Opaker Cursor (base64url-JSON). Inhalt ist kein Vertrag und kann sich ändern. */
export function encodeCursor(v: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(v)).toString('base64url');
}

/** Cursor mit Zeitpunkt und ID (Sortierung der Listen); ungültig = 422. */
export function decodeCursor(k: HostKit, c: string | undefined): { v: string; id: string } | null {
  if (!c) return null;
  let v: unknown;
  try { v = JSON.parse(Buffer.from(c, 'base64url').toString('utf8')); } catch { v = null; }
  const o = v as Record<string, unknown> | null;
  if (!o || typeof o !== 'object' || !isTimestamp(o.v) || !isUuid(o.id)) throw k.invalid('Cursor ungültig oder aus einer anderen Abfrage.');
  return { v: o.v, id: o.id };
}

const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Zeitpunkt wie `timestamptz::text` mit gültigem Datum (sonst lehnte die Datenbank den Wert mit 500 ab). */
function isTimestamp(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d{1,6})?(?:Z|[+-](\d{2})(?::?(\d{2}))?)$/.exec(v);
  if (!m) return false;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
  const [oh, om] = [Number(m[8] ?? 0), Number(m[9] ?? 0)];
  const t = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && h < 24 && mi < 60 && se < 60 && oh <= 15 && om < 60;
}

export const etag = (version: number) => `W/"${version}"`;

/** If-Match → erwartete Version. `*` oder fehlend = keine Prüfung; Unlesbares kann nie passen (412). */
export function ifMatchVersion(k: HostKit, h: string | string[] | undefined): number | undefined {
  const v = Array.isArray(h) ? h[0] : h;
  if (v === undefined || v.trim() === '*' || v.trim() === '') return undefined;
  const m = /^\s*(?:W\/)?"?(\d+)(?:-[\w-]+)?"?\s*$/.exec(v);
  if (!m) throw k.error(412, 'If-Match passt nicht', 'Erwartet ein ETag der Form W/"<version>".');
  return Number(m[1]);
}

/** Bezeichner für SQL (Schema): nur Kleinbuchstaben, Ziffern, «_». */
export function ident(v: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(v)) throw new Error(`${what}: ungültiger Bezeichner «${v}»`);
  return v;
}
