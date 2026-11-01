/**
 * Benachrichtigungen (Inbox je Person): Erwähnungen und Antworten aus Kommentaren.
 *
 * - Gespeichert werden nur Verweise (Ziel, Gegenstand, auslösende Person), kein Text. Bezeichnung des Ziels und
 *   Ausschnitt löst die API beim Lesen mit den Rechten der empfangenden Person auf; ist das Ziel nicht (mehr) sichtbar,
 *   erscheint der Eintrag ohne Bezeichnung, Ausschnitt und Person (`available: false`).
 * - Anlegen in der Transaktion des Kommentars (`inboxNotify`). Lesen, als gelesen markieren und löschen nur die
 *   empfangende Person (Lesesicht own_* der Migration).
 */
import { Type } from '@fastify/type-provider-typebox';
import type { Tx } from './host.ts';
import { Cursor, DateTime, decodeCursor, encodeCursor, NextCursor, Nullable, PersonRef, Uuid } from './http.ts';
import type { Ctx } from './plugin.ts';
import type { DiscussionNotice } from './targets.ts';

const TAG = 'Benachrichtigungen';

/**
 * Einträge anlegen (ein Eintrag je Person, Art und Gegenstand; Wiederholungen werden ignoriert). Bewusst ohne
 * Konfliktziel: `ON CONFLICT (spalten)` verlangt SELECT-Recht, dann prüft PostgreSQL die Lesesicht own_read am neuen
 * Eintrag – und der gehört einer anderen Person.
 */
export function inboxNotify(schema: string) {
  return async (tx: Tx, n: DiscussionNotice): Promise<void> => {
    if (!n.recipients.length) return;
    await tx.query(
      `INSERT INTO ${schema}.notification (tenant_id, recipient_id, kind, target_type, target_id, subject_type, subject_id, actor_id)
       SELECT $8, r.id, r.kind, $3, $4, $5, $6, $7 FROM unnest($1::uuid[], $2::text[]) AS r(id, kind)
       ON CONFLICT DO NOTHING`,
      [n.recipients.map(r => r.id), n.recipients.map(r => r.kind), n.targetType, n.targetId, n.subjectType, n.subjectId, n.actorId, n.tenantId]);
  };
}

export const NotificationOut = Type.Object({
  id: Type.String(),
  kind: Type.Union([Type.Literal('mention'), Type.Literal('reply')], { description: '`mention`: erwähnt, `reply`: Antwort auf einen eigenen Kommentar' }),
  createdAt: DateTime, readAt: Nullable(DateTime),
  /** Auslösende Person; `null`, wenn das Ziel nicht sichtbar ist. */
  actor: Nullable(PersonRef),
  target: Type.Object({
    type: Type.String({ description: 'Art des Ziels, z. B. `object`' }), id: Type.String(),
    title: Nullable(Type.String({ description: 'Bezeichnung; `null`, wenn nicht sichtbar' })),
    available: Type.Boolean({ description: 'Ziel für dich sichtbar (sonst gelöscht oder kein Zugriff mehr)' }),
  }),
  subject: Type.Object({
    type: Type.Literal('comment'), id: Type.String(),
    excerpt: Nullable(Type.String({ description: 'Anfang des Textes; `null`, wenn gelöscht oder nicht sichtbar' })),
  }),
}, { title: 'Notification' });

interface Row {
  id: string; kind: 'mention' | 'reply'; target_type: string; target_id: string; subject_type: 'comment'; subject_id: string;
  actor: { id: string; name: string } | null; created_at: Date; read_at: Date | null; _sort: string;
}

export function registerNotifications(c: Ctx, excerpt: (tx: Tx, id: string) => Promise<string | null>) {
  const { app, k, host, targets, schema: S } = c;

  app.get('/v1/me/notifications', {
    schema: {
      tags: [TAG], summary: 'Eigene Benachrichtigungen',
      description: 'Neueste zuerst. Bezeichnung und Ausschnitt mit deinen aktuellen Rechten; nicht mehr sichtbare Ziele mit `available: false`. `unread` zählt alle ungelesenen.',
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
        const t = (await targets.get(r.target_type)?.load(req, tx, r.target_id)) ?? null;
        const text = t ? await excerpt(tx, r.subject_id) : null;
        items.push({
          id: r.id, kind: r.kind, createdAt: r.created_at, readAt: r.read_at, actor: t ? r.actor : null,
          target: { type: r.target_type, id: r.target_id, title: t?.title ?? null, available: !!t },
          subject: { type: r.subject_type, id: r.subject_id, excerpt: text },
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
