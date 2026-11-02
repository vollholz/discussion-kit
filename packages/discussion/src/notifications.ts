/**
 * Benachrichtigungen (Inbox je Person): Erwähnungen und Antworten aus Kommentaren und Arten, die andere Bausteine der
 * App melden (`discussionInbox` mit `kinds` und `subjects`, z. B. «Aufgabe zugewiesen» an einer Aufgabe).
 *
 * - Gespeichert werden nur Verweise (Ziel, Gegenstand, auslösende Person), kein Text. Bezeichnung des Ziels und
 *   Ausschnitt löst die API beim Lesen mit den Rechten der empfangenden Person auf; ist das Ziel nicht (mehr) sichtbar,
 *   erscheint der Eintrag ohne Bezeichnung, Ausschnitt und Person (`available: false`).
 * - Anlegen in der Transaktion des Kommentars (`inboxNotify`) bzw. des meldenden Bausteins (`DiscussionInbox.notify`).
 *   Lesen, als gelesen markieren und löschen nur die empfangende Person (Lesesicht own_* der Migration).
 * - Gegenstände ausser Kommentaren löst die App je Art des Gegenstands auf (`InboxSubject.load`, wie `load` der
 *   Zieltypen); `null` heisst nicht (mehr) verfügbar. Das Paket kennt die Bedeutung der Arten nicht.
 */
import { Type } from '@fastify/type-provider-typebox';
import type { FastifyRequest } from 'fastify';
import type { Tx } from './host.ts';
import { Cursor, DateTime, decodeCursor, encodeCursor, ident, NextCursor, Nullable, PersonRef, Uuid } from './http.ts';
import type { Ctx } from './plugin.ts';
import type { DiscussionNotice } from './targets.ts';

const TAG = 'Benachrichtigungen';

/**
 * Einträge anlegen (ein Eintrag je Person, Art und Gegenstand; Wiederholungen werden ignoriert). Bewusst ohne
 * Konfliktziel: `ON CONFLICT (spalten)` verlangt SELECT-Recht, dann prüft PostgreSQL die Lesesicht own_read am neuen
 * Eintrag – und der gehört einer anderen Person.
 */
export function inboxNotify(schema: string) {
  return async (tx: Tx, n: DiscussionNotice | InboxNotice): Promise<number> => {
    if (!n.recipients.length) return 0;
    const r = await tx.query(
      `INSERT INTO ${schema}.notification (tenant_id, recipient_id, kind, target_type, target_id, subject_type, subject_id, actor_id)
       SELECT $8, r.id, r.kind, $3, $4, $5, $6, $7 FROM unnest($1::uuid[], $2::text[]) AS r(id, kind)
       ON CONFLICT DO NOTHING`,
      [n.recipients.map(r => r.id), n.recipients.map(r => r.kind), n.targetType, n.targetId, n.subjectType, n.subjectId, n.actorId, n.tenantId]);
    return r.rowCount ?? 0;
  };
}

/** Arten und Arten von Gegenständen: wie Zieltypen nur a–z und «_», höchstens 40 Zeichen (CHECK der Migration 003). */
const NAME = /^[a-z][a-z_]{0,39}$/;
/** Arten aus Kommentaren (immer bekannt). */
export const COMMENT_KINDS = ['mention', 'reply'] as const;

/** Gegenstand eines Eintrags, aufgelöst mit den Rechten der empfangenden Person. */
export interface InboxSubjectView {
  /** Bezeichnung für die Oberfläche (z. B. Titel der Aufgabe). */
  title: string;
  /** Kurzer Text zum Eintrag (etwa 140 Zeichen); Standard keiner. */
  excerpt?: string | null;
}

/** Eintrag, wie ihn die Auflösung bekommt (nur Verweise, gespeichert ist kein Text). */
export interface InboxSubjectRef { kind: string; subjectType: string; subjectId: string; targetType: string; targetId: string }

/** Auflösung einer Art von Gegenstand (Port der App, wie `DiscussionTarget.load`). */
export interface InboxSubject {
  /** Gegenstand lesen, wenn die anfragende Person ihn sehen darf; sonst `null` (Eintrag «nicht mehr verfügbar»). */
  load(req: FastifyRequest, tx: Tx, ref: InboxSubjectRef): Promise<InboxSubjectView | null>;
}

/** Eintrag eines anderen Bausteins der App (Art und Gegenstand frei, aber registriert). */
export interface InboxNotice {
  tenantId: string;
  /** Empfangende Personen mit Art des Eintrags, z. B. `{ id, kind: 'task_assigned' }`. */
  recipients: { id: string; kind: string }[];
  /** Ziel, an dem die Oberfläche den Eintrag öffnet (z. B. der Fall); frei wählbar, a–z und «_». */
  targetType: string; targetId: string;
  /** Gegenstand, z. B. `task`; braucht eine Auflösung in `subjects` (ausser `comment`). */
  subjectType: string; subjectId: string;
  /** Auslösende Person; `null` für Einträge ohne Person (z. B. Frist überschritten). */
  actorId: string | null;
}

export interface InboxOptions {
  /** Schema der Tabellen (wie in `discussion`). */
  schema: string;
  /** Weitere Arten neben `mention` und `reply`, z. B. `['task_assigned', 'sla_breached']`. */
  kinds?: string[];
  /** Auflösung je Art von Gegenstand ausser `comment`, z. B. `{ task: taskSubject }`. */
  subjects?: Record<string, InboxSubject>;
}

/** Inbox des Pakets mit den Arten der App; an `discussion({ notifications })` und an meldende Bausteine geben. */
export interface DiscussionInbox {
  readonly schema: string;
  readonly kinds: ReadonlySet<string>;
  readonly subjects: ReadonlyMap<string, InboxSubject>;
  /**
   * Einträge in der Transaktion der aufrufenden Person anlegen (Mandantenkontext gesetzt). Regeln wie bei Kommentaren:
   * nicht an die auslösende Person, nur an Personen (keine Clients), die es noch gibt, je Person, Art und Gegenstand
   * einmal (Wiederholungen werden ignoriert). Liefert die Zahl neu angelegter Einträge. Eine nicht registrierte Art
   * oder Art von Gegenstand ist ein Fehler im Programm (Exception).
   */
  notify(tx: Tx, n: InboxNotice): Promise<number>;
}

/** Inbox mit weiteren Arten anlegen (`kinds`, `subjects`); ohne Angaben dieselbe Inbox wie die Vorgabe. */
export function discussionInbox(o: InboxOptions): DiscussionInbox {
  const schema = ident(o.schema, 'schema');
  const kinds = new Set<string>(COMMENT_KINDS);
  for (const k of o.kinds ?? []) {
    if (!NAME.test(k)) throw new Error(`Art «${k}»: nur a–z und «_», höchstens 40 Zeichen`);
    kinds.add(k);
  }
  const subjects = new Map<string, InboxSubject>();
  for (const [t, s] of Object.entries(o.subjects ?? {})) {
    if (!NAME.test(t)) throw new Error(`Art des Gegenstands «${t}»: nur a–z und «_», höchstens 40 Zeichen`);
    if (t === 'comment') throw new Error('Art des Gegenstands «comment» löst das Paket selbst auf');
    subjects.set(t, s);
  }
  const insert = inboxNotify(schema);
  return {
    schema, kinds, subjects,
    async notify(tx, n) {
      for (const r of n.recipients) if (!kinds.has(r.kind)) throw new Error(`Art «${r.kind}» nicht registriert (discussionInbox, kinds)`);
      if (n.subjectType !== 'comment' && !subjects.has(n.subjectType)) throw new Error(`Art des Gegenstands «${n.subjectType}» nicht registriert (discussionInbox, subjects)`);
      if (!NAME.test(n.targetType)) throw new Error(`Zieltyp «${n.targetType}»: nur a–z und «_», höchstens 40 Zeichen`);
      const ids = [...new Set(n.recipients.map(r => r.id))].filter(id => id !== n.actorId);
      if (!ids.length) return 0;
      const users = new Set((await tx.query<{ id: string }>(`SELECT id FROM ${schema}.principal WHERE id = ANY($1::uuid[]) AND kind = 'user' AND removed_at IS NULL`, [ids])).rows.map(r => r.id));
      const seen = new Set<string>();
      const recipients = n.recipients.filter(r => users.has(r.id) && !seen.has(`${r.id}/${r.kind}`) && seen.add(`${r.id}/${r.kind}`));
      return insert(tx, { ...n, recipients });
    },
  };
}

export const NotificationOut = Type.Object({
  id: Type.String(),
  kind: Type.String({ pattern: '^[a-z][a-z_]{0,39}$', description: '`mention`: erwähnt, `reply`: Antwort auf einen eigenen Kommentar; weitere Arten meldet die App (`discussionInbox`)' }),
  createdAt: DateTime, readAt: Nullable(DateTime),
  /** Auslösende Person; `null`, wenn das Ziel nicht sichtbar ist. */
  actor: Nullable(PersonRef),
  target: Type.Object({
    type: Type.String({ description: 'Art des Ziels, z. B. `object`' }), id: Type.String(),
    title: Nullable(Type.String({ description: 'Bezeichnung; `null`, wenn nicht sichtbar' })),
    available: Type.Boolean({ description: 'Ziel für dich sichtbar (sonst gelöscht oder kein Zugriff mehr)' }),
  }),
  subject: Type.Object({
    type: Type.String({ description: '`comment` oder eine Art, die die App meldet (z. B. `task`)' }), id: Type.String(),
    excerpt: Nullable(Type.String({ description: 'Anfang des Textes bzw. Kurztext; `null`, wenn gelöscht, nicht verfügbar oder keiner' })),
  }),
}, { title: 'Notification' });

interface Row {
  id: string; kind: string; target_type: string; target_id: string; subject_type: string; subject_id: string;
  actor: { id: string; name: string } | null; created_at: Date; read_at: Date | null; _sort: string;
}

export function registerNotifications(c: Ctx, excerpt: (tx: Tx, id: string) => Promise<string | null>, inbox: DiscussionInbox) {
  const { app, k, host, targets, schema: S } = c;

  /** Bezeichnung und Ausschnitt mit den Rechten der empfangenden Person; `null` = nicht (mehr) verfügbar. */
  async function resolve(req: FastifyRequest, tx: Tx, r: Row): Promise<{ title: string; excerpt: string | null } | null> {
    if (r.subject_type === 'comment') {
      const t = (await targets.get(r.target_type)?.load(req, tx, r.target_id)) ?? null;
      return t ? { title: t.title, excerpt: await excerpt(tx, r.subject_id) } : null;
    }
    const s = inbox.subjects.get(r.subject_type);
    const v = s ? await s.load(req, tx, { kind: r.kind, subjectType: r.subject_type, subjectId: r.subject_id, targetType: r.target_type, targetId: r.target_id }) : null;
    return v ? { title: v.title, excerpt: v.excerpt ?? null } : null;
  }

  app.get('/v1/me/notifications', {
    schema: {
      tags: [TAG], summary: 'Eigene Benachrichtigungen',
      description: 'Neueste zuerst, alle Arten (auch die von der App gemeldeten). Bezeichnung und Ausschnitt mit deinen aktuellen Rechten; nicht mehr verfügbare Gegenstände mit `available: false`. `unread` zählt alle ungelesenen.',
      querystring: Type.Object({
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100, default: 30 })), cursor: Type.Optional(Cursor),
        unread: Type.Optional(Type.Boolean({ description: 'Nur ungelesene' })),
      }),
      response: { 200: Type.Object({ items: Type.Array(NotificationOut), nextCursor: NextCursor, unread: Type.Integer({ minimum: 0 }) }) },
    },
  }, async req => {
    const me = host.principal(req);
    const limit = req.query.limit ?? 30;
    const cur = decodeCursor(k, req.query.cursor);
    return host.tx(req, async tx => {
      const params: unknown[] = [limit + 1, me.id];
      if (cur) params.push(cur.v, cur.id);
      // Lesesicht own_read; die Bedingung auf recipient_id gilt zusätzlich (auch für eine App ohne diese Lesesicht)
      const rows = (await tx.query<Row>(
        `SELECT n.id, n.kind, n.target_type, n.target_id, n.subject_type, n.subject_id, n.created_at, n.read_at, n.created_at::text AS _sort,
                (SELECT json_build_object('id', p.id, 'name', coalesce(p.display_name, p.client_id, 'Unbekannt')) FROM ${S}.principal p WHERE p.id = n.actor_id) AS actor
           FROM ${S}.notification n
          WHERE n.recipient_id = $2 ${req.query.unread ? 'AND n.read_at IS NULL' : ''} ${cur ? 'AND (n.created_at, n.id) < ($3::timestamptz, $4::uuid)' : ''}
          ORDER BY n.created_at DESC, n.id DESC LIMIT $1`, params)).rows;
      const unread = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${S}.notification WHERE recipient_id = $1 AND read_at IS NULL`, [me.id])).rows[0]!.n;
      const page = rows.slice(0, limit), last = page[page.length - 1];
      const items = [];
      for (const r of page) {
        const v = await resolve(req, tx, r);
        items.push({
          id: r.id, kind: r.kind, createdAt: r.created_at, readAt: r.read_at, actor: v ? r.actor : null,
          target: { type: r.target_type, id: r.target_id, title: v?.title ?? null, available: !!v },
          subject: { type: r.subject_type, id: r.subject_id, excerpt: v?.excerpt ?? null },
        });
      }
      return { items, nextCursor: rows.length > limit && last ? encodeCursor({ v: last._sort, id: last.id }) : null, unread };
    });
  });

  app.post('/v1/me/notifications/read', {
    schema: {
      tags: [TAG], summary: 'Benachrichtigungen als gelesen markieren',
      description: 'Bestimmte (`ids`) oder alle (`all: true`) eigenen Benachrichtigungen. Fremde oder unbekannte IDs werden ignoriert.',
      body: Type.Object({ ids: Type.Optional(Type.Array(Uuid, { maxItems: 200 })), all: Type.Optional(Type.Boolean()) }, { additionalProperties: false }),
      response: { 200: Type.Object({ updated: Type.Integer({ minimum: 0, description: 'Neu als gelesen markiert' }) }) },
    },
  }, async req => {
    const me = host.principal(req);
    const { ids, all } = req.body;
    if (!all && !ids?.length) return { updated: 0 };
    return host.tx(req, async tx => {
      const r = all
        ? await tx.query(`UPDATE ${S}.notification SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL`, [me.id])
        : await tx.query(`UPDATE ${S}.notification SET read_at = now() WHERE recipient_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])`, [me.id, ids]);
      return { updated: r.rowCount ?? 0 };
    });
  });
}
