/**
 * Was die App dem Baukasten liefert (`host`): Transaktion im Mandantenkontext, angemeldete Person, Rechte, optional
 * Protokoll, Ereignisse und die Fehlerklasse ihrer Fehlerbehandlung. Mehr braucht das Paket nicht – es kennt weder
 * Anmeldung noch Rechtemodell der App.
 *
 * Für Apps mit `@vollholz/iam` gibt es `iamHost`: Er nutzt die Request-Methoden des IAM-Plugins (`req.tx`, `req.need` …)
 * und importiert das Paket nicht (keine Versionskopplung).
 */
import type { FastifyRequest } from 'fastify';

/** Minimale Datenbank-Transaktion (z. B. `pg.PoolClient`). */
export interface Tx {
  query<R = any>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/** Rechte des Baukastens; die App ordnet sie ihren Rollen zu (`DISCUSSION_PERMISSIONS`). */
export type DiscussionPermission = 'comment:write' | 'comment:moderate' | 'attachment:write' | 'attachment:delete';

/** Ort einer Rechteprüfung: Ziel des Kommentars bzw. Anhangs. */
export interface TargetRef { type: string; id: string }

export interface ProtocolEntry { action: string; resourceType: string; resourceId: string; data: Record<string, unknown> }

export interface DiscussionHost {
  /** Transaktion mit dem Mandantenkontext der Anfrage (Lesesicht der Datenbank, RLS). */
  tx<T>(req: FastifyRequest, fn: (tx: Tx) => Promise<T>): Promise<T>;
  /** Angemeldete Person bzw. Maschine; wirft 401, wenn niemand angemeldet ist. */
  principal(req: FastifyRequest): { id: string; tenantId: string };
  /** Recht am Ziel. `hint` reicht der Zieltyp durch (z. B. Objekttyp für eine schnellere Prüfung). */
  can(req: FastifyRequest, perm: string, target: TargetRef, hint?: string | null): Promise<boolean>;
  /** Wie `can`, aber wirft 403 mit der Meldung der App. Standard: `can` und eine allgemeine Meldung. */
  need?(req: FastifyRequest, perm: string, target: TargetRef, hint?: string | null): Promise<void>;
  /** Recht «irgendwo» (Listen und Einzelabrufe vor dem Laden). Standard: keine Prüfung. */
  needSomewhere?(req: FastifyRequest, perm: string): Promise<void>;
  /** Protokoll in derselben Transaktion. Standard: keins. */
  audit?(req: FastifyRequest, tx: Tx, e: ProtocolEntry): Promise<void>;
  /** Ereignis (z. B. Outbox für Webhooks) in derselben Transaktion. Standard: keins. */
  emit?(tx: Tx, type: string, subject: string | null, data: Record<string, unknown>): Promise<void>;
  /** Fehler so bauen, wie die Fehlerbehandlung der App ihn als Problem Details ausgibt. Standard: `DiscussionError`. */
  error?(status: number, title: string, detail?: string, extra?: Record<string, unknown>): Error;
}

/**
 * Fehler des Pakets ohne Fehlerbehandlung der App: Fastify gibt `statusCode` und `message` aus; Felder wie
 * `HttpError` von `@vollholz/iam` (status, title, detail, extra), damit eine Fehlerbehandlung sie erkennen kann.
 */
export class DiscussionError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly title: string;
  readonly detail: string | undefined;
  readonly headers: Record<string, string> = {};
  readonly extra: Record<string, unknown>;
  constructor(status: number, title: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ? `${title}: ${detail}` : title);
    this.status = status; this.statusCode = status; this.title = title; this.detail = detail; this.extra = extra;
  }
}

/** Request mit den Methoden des IAM-Plugins (`@vollholz/iam`, ab 3.0). */
interface IamRequest {
  tx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  requirePrincipal(): { principalId: string; tenantId: string };
  can(perm: string, ref?: TargetRef, hint?: string | null): Promise<boolean>;
  need(perm: string, ref?: TargetRef, hint?: string | null): Promise<void>;
  needSomewhere(perm: string): Promise<void>;
  audit(tx: Tx, e: ProtocolEntry): Promise<void>;
}

/**
 * Host für Apps mit `@vollholz/iam`: `iamHost({ HttpError, emit })` mit der Fehlerklasse des Pakets der App (damit
 * Fehler als Problem Details erscheinen) und optional der Outbox der App.
 */
export function iamHost(o: {
  HttpError: new (status: number, title: string, detail?: string, headers?: Record<string, string>, extra?: Record<string, unknown>) => Error;
  emit?: DiscussionHost['emit'];
}): DiscussionHost {
  const r = (req: FastifyRequest) => req as unknown as IamRequest;
  return {
    tx: (req, fn) => r(req).tx(fn),
    principal: req => { const p = r(req).requirePrincipal(); return { id: p.principalId, tenantId: p.tenantId }; },
    can: (req, perm, target, hint) => r(req).can(perm, target, hint),
    need: (req, perm, target, hint) => r(req).need(perm, target, hint),
    needSomewhere: (req, perm) => r(req).needSomewhere(perm),
    audit: (req, tx, e) => r(req).audit(tx, e),
    emit: o.emit,
    error: (status, title, detail, extra) => new o.HttpError(status, title, detail, {}, extra ?? {}),
  };
}

/** Fehler und Rechteprüfung über den Host (mit Vorgaben). */
export function hostKit(host: DiscussionHost) {
  const error = (status: number, title: string, detail?: string, extra?: Record<string, unknown>) =>
    host.error ? host.error(status, title, detail, extra) : new DiscussionError(status, title, detail, extra);
  return {
    error,
    notFound: (what: string) => error(404, `${what} nicht gefunden`),
    forbidden: (detail: string) => error(403, 'Keine Berechtigung', detail),
    invalid: (detail: string, errors?: { path: string; message: string }[]) => error(422, 'Ungültige Eingabe', detail, errors ? { errors } : {}),
    async need(req: FastifyRequest, perm: DiscussionPermission, target: TargetRef, hint?: string | null) {
      if (host.need) return host.need(req, perm, target, hint);
      if (!(await host.can(req, perm, target, hint))) throw error(403, 'Keine Berechtigung', `Dir fehlt das Recht ${PERMISSION_TEXT[perm]}.`);
    },
    async needSomewhere(req: FastifyRequest, perm: string) { await host.needSomewhere?.(req, perm); },
    async audit(req: FastifyRequest, tx: Tx, e: ProtocolEntry) { await host.audit?.(req, tx, e); },
    async emit(tx: Tx, type: string, subject: string | null, data: Record<string, unknown>) { await host.emit?.(tx, type, subject, data); },
  };
}
export type HostKit = ReturnType<typeof hostKit>;

/** Rechte des Baukastens mit Label und Beschreibung (für das Rechtemodell der App, z. B. `defineModel`). */
export const DISCUSSION_PERMISSIONS: Record<DiscussionPermission, { label: string; description: string }> = {
  'comment:write': { label: 'Kommentieren', description: 'Kommentieren und eigene Kommentare ändern und löschen.' },
  'comment:moderate': { label: 'Kommentare moderieren', description: 'Kommentare anderer Personen löschen (ändern kann einen Kommentar nur, wer ihn geschrieben hat).' },
  'attachment:write': { label: 'Anhänge hochladen', description: 'Dateien anhängen und eigene Anhänge löschen.' },
  'attachment:delete': { label: 'Anhänge löschen', description: 'Anhänge anderer Personen löschen.' },
};
const PERMISSION_TEXT = Object.fromEntries(Object.entries(DISCUSSION_PERMISSIONS).map(([k, v]) => [k, `«${v.label}» (${k})`])) as Record<DiscussionPermission, string>;
export const permissionText = (p: DiscussionPermission) => PERMISSION_TEXT[p];
