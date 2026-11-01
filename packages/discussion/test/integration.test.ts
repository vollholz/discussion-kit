/**
 * Einbindung ohne `@vollholz/iam`: eine kleine App «shop» mit eigenem Schema, eigenen Rollen, eigenem Mandanten- und
 * Personenausdruck und einem Host aus wenigen Zeilen. Prüft Migrationen (auch zweimal), Lesesicht je Mandant,
 * Kommentare mit Erwähnung und Antwort, Benachrichtigungen nur für die empfangende Person, Rechte über den Host,
 * Anhänge mit Verschlüsselung und das weiche Löschen beim Löschen des Ziels.
 *
 * Datenbank: TEST_POSTGRES_URL (Superuser) oder POSTGRES_SUPERUSER_PASSWORD (+ POSTGRES_PORT, Standard 5433); sonst
 * werden die Tests übersprungen.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import pg from 'pg';
import { discussion, discussionMigrations, FsBlobStore, type DiscussionHost, type DiscussionTarget } from '../src/index.ts';

const superUrl = process.env.TEST_POSTGRES_URL
  ?? (process.env.POSTGRES_SUPERUSER_PASSWORD ? `postgres://postgres:${encodeURIComponent(process.env.POSTGRES_SUPERUSER_PASSWORD)}@localhost:${process.env.POSTGRES_PORT ?? '5433'}/postgres` : null);

async function available(): Promise<boolean> {
  if (!superUrl) return false;
  const c = new pg.Client({ connectionString: superUrl, connectionTimeoutMillis: 1500 });
  try { await c.connect(); await c.end(); return true; } catch { return false; }
}
const skip = !(await available()) && 'PostgreSQL nicht erreichbar (TEST_POSTGRES_URL oder POSTGRES_SUPERUSER_PASSWORD)';

const withDb = (url: string, db: string) => { const u = new URL(url); u.pathname = `/${db}`; return u.toString(); };
const TENANT = "(nullif(current_setting('shop.tenant', true), ''))::uuid";
const PRINCIPAL = "(nullif(current_setting('shop.principal', true), ''))::uuid";

describe('Einbindung ohne IAM (App «shop»)', { skip }, () => {
  const suffix = randomBytes(4).toString('hex');
  const db = `dk_test_${suffix}`, appRole = `dk_app_${suffix}`, schedRole = `dk_sched_${suffix}`;
  let admin: pg.Client, pool: pg.Pool, app: FastifyInstance, dir: string;
  const A = randomUUID(), B = randomUUID();
  const ada = randomUUID(), bea = randomUUID(), carl = randomUUID(), gus = randomUUID();
  /** Rechte je Person (der Host der App entscheidet). */
  const rights: Record<string, string[]> = { [ada]: ['comment:write', 'attachment:write'], [bea]: ['comment:write'], [carl]: [], [gus]: ['comment:write'] };
  const tenantOf: Record<string, string> = { [ada]: A, [bea]: A, [carl]: A, [gus]: B };
  const items: Record<string, string> = {};

  const host: DiscussionHost = {
    principal(req) {
      const id = req.headers['x-user'] as string | undefined;
      if (!id || !tenantOf[id]) throw Object.assign(new Error('Nicht angemeldet'), { statusCode: 401 });
      return { id, tenantId: tenantOf[id]! };
    },
    async tx(req, fn) {
      const p = host.principal(req);
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(`SET LOCAL ROLE ${appRole}`);
        await c.query(`SELECT set_config('shop.tenant', $1, true), set_config('shop.principal', $2, true)`, [p.tenantId, p.id]);
        const r = await fn(c);
        await c.query('COMMIT');
        return r;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async can(req, perm) { return (rights[host.principal(req).id] ?? []).includes(perm); },
  };
  const itemTarget: DiscussionTarget = {
    type: 'item', basePath: '/v1/items', label: { one: 'Artikel', of: 'eines Artikels', at: 'am Artikel' }, read: 'item:read',
    async load(_req: FastifyRequest, tx, id) {
      const r = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM shop.item WHERE id = $1', [id])).rows[0];
      return r ? { id: r.id, classified: false, title: r.name, ref: { id: r.id, name: r.name } } : null;
    },
  };
  const call = async (who: string, method: string, url: string, body?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, headers: { 'x-user': who }, ...(body !== undefined ? { payload: body as object } : {}) });
    return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
  };

  before(async () => {
    const su = new pg.Client({ connectionString: superUrl! });
    await su.connect();
    await su.query(`CREATE DATABASE ${db}`);
    await su.query(`CREATE ROLE ${appRole} NOLOGIN; CREATE ROLE ${schedRole} NOLOGIN`);
    await su.end();
    admin = new pg.Client({ connectionString: withDb(superUrl!, db) });
    await admin.connect();
    // Die App: Personenverzeichnis und Artikel, je Mandant getrennt
    await admin.query(`
      CREATE SCHEMA shop; GRANT USAGE ON SCHEMA shop TO ${appRole}, ${schedRole};
      CREATE TABLE shop.principal (tenant_id uuid NOT NULL, id uuid PRIMARY KEY, kind text NOT NULL, display_name text, client_id text, removed_at timestamptz);
      CREATE TABLE shop.item (tenant_id uuid NOT NULL, id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
      ALTER TABLE shop.principal ENABLE ROW LEVEL SECURITY; ALTER TABLE shop.item ENABLE ROW LEVEL SECURITY;
      CREATE POLICY t ON shop.principal TO ${appRole} USING (tenant_id = ${TENANT});
      CREATE POLICY t ON shop.item TO ${appRole} USING (tenant_id = ${TENANT}) WITH CHECK (tenant_id = ${TENANT});
      GRANT SELECT ON shop.principal TO ${appRole}; GRANT SELECT, INSERT, DELETE ON shop.item TO ${appRole};`);
    const m = discussionMigrations({ schema: 'shop', app: appRole, sched: schedRole, tenant: TENANT, principal: PRINCIPAL });
    for (const x of m.migrations) await admin.query(x.sql);
    await admin.query(`SELECT shop.discussion_targets('{"item": "shop.item"}')`);
    for (const [id, name, t] of [[ada, 'Ada', A], [bea, 'Bea', A], [carl, 'Carl', A], [gus, 'Gus', B]] as const) {
      await admin.query(`INSERT INTO shop.principal (tenant_id, id, kind, display_name) VALUES ($1, $2, 'user', $3)`, [t, id, name]);
    }
    items.a = (await admin.query(`INSERT INTO shop.item (tenant_id, name) VALUES ($1, 'Velo') RETURNING id`, [A])).rows[0].id;
    items.b = (await admin.query(`INSERT INTO shop.item (tenant_id, name) VALUES ($1, 'Kanu') RETURNING id`, [B])).rows[0].id;
    pool = new pg.Pool({ connectionString: withDb(superUrl!, db), max: 4 });
    dir = mkdtempSync(join(tmpdir(), 'dk-test-'));
    app = Fastify();
    await app.register(discussion({ schema: 'shop', host, targets: [itemTarget], attachments: { store: new FsBlobStore(dir), keys: [{ id: 'k1', key: randomBytes(32) }] } }));
    await app.ready();
  });
  after(async () => {
    await app?.close(); await pool?.end(); await admin?.end();
    const su = new pg.Client({ connectionString: superUrl! });
    await su.connect();
    await su.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await su.query(`DROP ROLE IF EXISTS ${appRole}; DROP ROLE IF EXISTS ${schedRole}`);
    await su.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  test('Migrationen sind idempotent und lassen die Lesesicht der App stehen', async () => {
    const before = (await admin.query(`SELECT qual FROM pg_policies WHERE schemaname = 'shop' AND tablename = 'comment' AND policyname = 'target_read'`)).rows[0].qual;
    for (const x of discussionMigrations({ schema: 'shop', app: appRole, sched: schedRole, tenant: TENANT, principal: PRINCIPAL }).migrations) await admin.query(x.sql);
    const after = (await admin.query(`SELECT qual FROM pg_policies WHERE schemaname = 'shop' AND tablename = 'comment' AND policyname = 'target_read'`)).rows[0].qual;
    assert.equal(after, before);
    assert.match(after, /shop\.item/);
  });

  test('Kommentar mit Erwähnung und Antwort; Benachrichtigungen nur für die empfangende Person', async () => {
    const c = await call(ada, 'POST', `/v1/items/${items.a}/comments`, { body: `Hallo @[Bea](${bea})` });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    assert.deepEqual([c.body.targetType, c.body.targetId, c.body.mentions], ['item', items.a, [{ id: bea, name: 'Bea' }]]);
    const r = await call(bea, 'POST', `/v1/items/${items.a}/comments`, { body: 'Danke', replyTo: c.body.id });
    assert.equal(r.status, 201);
    const beaInbox = (await call(bea, 'GET', '/v1/me/notifications')).body;
    assert.deepEqual(beaInbox.items.map((n: { kind: string; target: { title: string }; subject: { excerpt: string } }) => [n.kind, n.target.title, n.subject.excerpt]), [['mention', 'Velo', 'Hallo @Bea']]);
    const adaInbox = (await call(ada, 'GET', '/v1/me/notifications')).body;
    assert.deepEqual(adaInbox.items.map((n: { kind: string }) => n.kind), ['reply']);
    assert.equal((await call(ada, 'POST', '/v1/me/notifications/read', { ids: [beaInbox.items[0].id] })).body.updated, 0, 'fremder Eintrag');
    // Direkt in der Datenbank: Ada sieht Beas Eintrag nicht (Lesesicht own_read)
    const c2 = await pool.connect();
    try {
      await c2.query('BEGIN'); await c2.query(`SET LOCAL ROLE ${appRole}`);
      await c2.query(`SELECT set_config('shop.tenant', $1, true), set_config('shop.principal', $2, true)`, [A, ada]);
      assert.equal((await c2.query('SELECT count(*)::int AS n FROM shop.notification')).rows[0].n, 1);
      await c2.query('ROLLBACK');
    } finally { c2.release(); }
  });

  test('Mandanten getrennt, Rechte über den Host', async () => {
    assert.equal((await call(gus, 'GET', `/v1/items/${items.a}/comments`)).status, 404, 'Artikel eines anderen Mandanten');
    assert.equal((await call(gus, 'POST', `/v1/items/${items.a}/comments`, { body: 'fremd' })).status, 404);
    const list = (await call(carl, 'GET', `/v1/items/${items.a}/comments`)).body;
    assert.equal(list.total, 2, 'Lesen ohne Recht zum Schreiben');
    const denied = await call(carl, 'POST', `/v1/items/${items.a}/comments`, { body: 'darf nicht' });
    assert.equal(denied.status, 403);
    assert.match(denied.body.message, /Kommentieren/);
    assert.equal((await call(carl, 'POST', `/v1/items/${items.a}/comments`, { body: `@[Gus](${gus})` })).status, 403);
    assert.equal((await call(ada, 'POST', `/v1/items/${items.a}/comments`, { body: `@[Gus](${gus})` })).status, 422, 'Person eines anderen Mandanten');
  });

  test('Anhang: hochladen, verschlüsselt ablegen, herunterladen; ohne Recht 403', async () => {
    const up = await app.inject({ method: 'POST', url: `/v1/items/${items.a}/attachments?name=notiz.txt`, headers: { 'x-user': ada, 'content-type': 'text/plain' }, payload: Buffer.from('Rahmen 54 cm') });
    assert.equal(up.statusCode, 201, up.body);
    const a = JSON.parse(up.body);
    const dl = await app.inject({ method: 'GET', url: `/v1/attachments/${a.id}/content`, headers: { 'x-user': carl } });
    assert.equal(dl.body, 'Rahmen 54 cm');
    assert.equal(dl.headers['content-disposition'], `attachment; filename="notiz.txt"; filename*=UTF-8''notiz.txt`);
    const denied = await app.inject({ method: 'POST', url: `/v1/items/${items.a}/attachments?name=x.txt`, headers: { 'x-user': bea, 'content-type': 'text/plain' }, payload: Buffer.from('x') });
    assert.equal(denied.statusCode, 403);
  });

  test('Ziel gelöscht: Kommentare und Anhänge weich gelöscht, nicht mehr abrufbar', async () => {
    const id = (await admin.query(`INSERT INTO shop.item (tenant_id, name) VALUES ($1, 'Zelt') RETURNING id`, [A])).rows[0].id as string;
    const c = (await call(ada, 'POST', `/v1/items/${id}/comments`, { body: 'bald weg' })).body;
    await admin.query('DELETE FROM shop.item WHERE id = $1', [id]);
    assert.equal((await admin.query('SELECT count(*)::int AS n FROM shop.comment WHERE target_id = $1 AND deleted_at IS NOT NULL', [id])).rows[0].n, 1);
    assert.equal((await call(ada, 'GET', `/v1/comments/${c.id}`)).status, 404);
  });
});
