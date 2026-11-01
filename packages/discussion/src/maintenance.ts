/**
 * Wartung für den Worker bzw. Betriebsbefehle der App.
 *
 * - `purgeDeletedAttachments`: weich gelöschte Anhänge nach Frist endgültig entfernen – zuerst die Datei in der
 *   Ablage, dann die Zeile. Scheitert die Ablage, bleibt die Zeile für den nächsten Lauf.
 * - `purgeDeleted`: weich gelöschte Kommentare (frühere Stände mit) und alte Benachrichtigungen löschen.
 * - `rewrapAttachmentKeys`: nach einem neuen Hauptschlüssel die Datenschlüssel der Anhänge eines Mandanten neu
 *   umschliessen; die Dateien bleiben unverändert.
 *
 * Bereinigung läuft über alle Mandanten mit `app.purge = on` (Policies sched_purge*, Worker-Rolle).
 */
import { box, primaryKey, type Keyring } from './crypto.ts';
import type { Tx } from './host.ts';
import { ident } from './http.ts';
import { dataKeyAad, unwrapKey } from './sealed-stream.ts';
import type { BlobStore } from './storage.ts';

/** Verbindung, die Transaktionen selbst steuert (z. B. `pg.PoolClient` der Worker-Rolle). */
export interface Client extends Tx {}

const ms = `now() - $1::bigint * interval '1 millisecond'`;

/** Weich gelöschte Anhänge älter als `olderThanMs`: Datei löschen, dann Zeile. Liefert die Zahl entfernter Anhänge. */
export async function purgeDeletedAttachments(c: Client, store: BlobStore, o: { schema: string; olderThanMs: number; batchSize?: number; log?: (m: string, d?: Record<string, unknown>) => void; stopped?: () => boolean }): Promise<number> {
  const S = ident(o.schema, 'schema'), batch = o.batchSize ?? 1000;
  let total = 0;
  const failed = new Set<string>();
  for (;;) {
    await c.query('BEGIN');
    try {
      await c.query(`SELECT set_config('app.purge', 'on', true), set_config('lock_timeout', '5s', true)`);
      const rows = (await c.query<{ id: string; storage_key: string }>(
        `SELECT id, storage_key FROM ${S}.attachment
          WHERE deleted_at IS NOT NULL AND deleted_at < ${ms} AND NOT (id = ANY($3::uuid[]))
          ORDER BY deleted_at LIMIT $2`, [o.olderThanMs, batch, [...failed]])).rows;
      const done: string[] = [];
      for (const r of rows) {
        try { await store.delete(r.storage_key); done.push(r.id); }
        catch (e) { failed.add(r.id); o.log?.('Anhang: Datei nicht gelöscht', { attachment: r.id, error: (e as Error).message }); }
      }
      if (done.length) await c.query(`DELETE FROM ${S}.attachment WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`, [done]);
      await c.query('COMMIT');
      total += done.length;
      if (rows.length < batch || o.stopped?.()) break;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    }
  }
  return total;
}

/** Weich gelöschte Kommentare und Benachrichtigungen nach ihren Fristen löschen (0 = nie). */
export async function purgeDeleted(c: Client, o: { schema: string; commentsOlderThanMs: number; notificationsOlderThanMs: number; batchSize?: number }): Promise<{ comment: number; notification: number }> {
  const S = ident(o.schema, 'schema'), batch = o.batchSize ?? 1000;
  const run = async (table: string, where: string, age: number) => {
    if (age <= 0) return 0;
    let total = 0;
    for (;;) {
      await c.query('BEGIN');
      try {
        await c.query(`SELECT set_config('app.purge', 'on', true), set_config('lock_timeout', '5s', true)`);
        const n = (await c.query<{ n: number }>(`WITH d AS (DELETE FROM ${S}.${table} WHERE ctid = ANY(ARRAY(SELECT ctid FROM ${S}.${table} WHERE ${where} LIMIT $2)) RETURNING 1) SELECT count(*)::int AS n FROM d`, [age, batch])).rows[0]!.n;
        await c.query('COMMIT');
        total += n;
        if (n < batch) return total;
      } catch (e) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw e;
      }
    }
  };
  return {
    comment: await run('comment', `deleted_at IS NOT NULL AND deleted_at < ${ms}`, o.commentsOlderThanMs),
    notification: await run('notification', `created_at < ${ms}`, o.notificationsOlderThanMs),
  };
}

/**
 * Datenschlüssel der Anhänge eines Mandanten auf den ersten Hauptschlüssel umstellen (auch weich gelöschte). Läuft in
 * der Transaktion der App mit Mandantenkontext; sieht für die Dauer der Transaktion alle Anhänge (`discussion.bypass`).
 */
export async function rewrapAttachmentKeys(tx: Tx, keys: Keyring, o: { schema: string; tenantId: string; dryRun?: boolean }): Promise<number> {
  const S = ident(o.schema, 'schema');
  const primary = primaryKey(keys);
  await tx.query(`SELECT set_config('discussion.bypass', 'on', true)`);
  const rows = (await tx.query<{ id: string; key_id: string; wrapped_key: Buffer }>(`SELECT id, key_id, wrapped_key FROM ${S}.attachment WHERE key_id <> $1 FOR UPDATE`, [primary.id])).rows;
  if (!o.dryRun) {
    for (const a of rows) {
      const key = unwrapKey(keys, a.key_id, a.wrapped_key, o.tenantId, a.id);
      await tx.query(`UPDATE ${S}.attachment SET key_id = $2, wrapped_key = $3 WHERE id = $1`, [a.id, primary.id, box(primary.key, key, dataKeyAad(o.tenantId, a.id))]);
    }
  }
  await tx.query(`SELECT set_config('discussion.bypass', 'off', true)`);
  return rows.length;
}
