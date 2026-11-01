/**
 * Zieltypen (Port der App): Was kommentierbar ist, meldet die App als `DiscussionTarget`. Das Paket kennt keine
 * Fachobjekte. Die Datenbank kennt dieselben Zieltypen über `discussion_targets` in einer Migration der App; ein
 * neuer Zieltyp braucht beides.
 */
import type { FastifyRequest } from 'fastify';
import type { HostKit, Tx } from './host.ts';

/** Ziel, wie ein Zieltyp es liefert. */
export interface LoadedTarget {
  id: string;
  /** Hinweis für die Rechteprüfung (`host.can`), z. B. der Objekttyp. */
  hint?: string | null;
  /** Vertraulich: Ereignisse tragen dann nur IDs, keinen Text. */
  classified: boolean;
  /** Bezug in Ereignissen; vertrauliche Ziele nur als Verweis ohne Bezeichnung. */
  ref: Record<string, unknown>;
  /** Bezeichnung für die Oberfläche (Benachrichtigungen). */
  title: string;
}

/**
 * Zieltyp, den die App kommentierbar macht. `type` ist der Ressourcentyp, an dem die Rechte `comment:*` und
 * `attachment:*` geprüft werden (`host.can(req, perm, { type, id })`).
 */
export interface DiscussionTarget {
  type: string;
  /** Pfad der Listen, z. B. `/v1/objects` → `/v1/objects/{id}/comments`. */
  basePath: string;
  /** Wörter für Texte der API: «Objekt», «eines Objekts», «am Objekt». */
  label: { one: string; of: string; at: string };
  /** Leserecht, das irgendwo bestehen muss (`host.needSomewhere`, vor dem Laden). */
  read: string;
  /** Anhänge erlaubt (Standard: ja). */
  attachments?: boolean;
  /** Ziel lesen, wenn die anfragende Person es sehen darf; sonst null (404). */
  load(req: FastifyRequest, tx: Tx, id: string): Promise<LoadedTarget | null>;
}

export class Targets {
  readonly list: DiscussionTarget[];
  private readonly byType = new Map<string, DiscussionTarget>();
  constructor(list: DiscussionTarget[]) {
    this.list = list;
    for (const t of list) {
      if (!/^[a-z][a-z_]{0,39}$/.test(t.type)) throw new Error(`Zieltyp «${t.type}»: nur a–z und «_», höchstens 40 Zeichen`);
      if (this.byType.has(t.type)) throw new Error(`Zieltyp ${t.type} doppelt registriert`);
      this.byType.set(t.type, t);
    }
  }
  get(type: string): DiscussionTarget | undefined { return this.byType.get(type); }
}

/** Ziel lesen; unsichtbar oder Zieltyp nicht registriert = 404 (weder Ziel noch Kommentar verraten ihre Existenz). */
export async function visibleTarget(k: HostKit, req: FastifyRequest, tx: Tx, def: DiscussionTarget | undefined, id: string, what: string): Promise<LoadedTarget> {
  const t = def ? await def.load(req, tx, id) : null;
  if (!t) throw k.notFound(what);
  return t;
}

/** Bezug auf das Ziel in Ausgaben und im Protokoll; bei `object` zusätzlich `objectId`. */
export const targetFields = (type: string, id: string) => ({ targetType: type, targetId: id, ...(type === 'object' ? { objectId: id } : {}) });

/** Ziel in Ereignissen; bei `object` zusätzlich `object` (Filter der Abonnements nach Schema und Typ). */
export const eventTarget = (def: DiscussionTarget, t: LoadedTarget) => ({ target: { type: def.type, ...t.ref }, ...(def.type === 'object' ? { object: t.ref } : {}) });

/** Benachrichtigung für Personen (Inbox des Pakets oder eigener Port der App). */
export interface DiscussionNotice {
  tenantId: string;
  recipients: { id: string; kind: 'mention' | 'reply' }[];
  targetType: string; targetId: string;
  subjectType: 'comment'; subjectId: string;
  actorId: string;
}
export type Notify = (tx: Tx, n: DiscussionNotice) => Promise<void>;

/** Name eines Principals für Ausgaben (Person oder Client), Tabelle `<schema>.principal` (Personenverzeichnis). */
export const personSql = (schema: string, col: string) => `(SELECT json_build_object('id', p.id, 'name', coalesce(p.display_name, p.client_id, 'Unbekannt')) FROM ${schema}.principal p WHERE p.id = ${col})`;
