# @vollholz/discussion

Kommentare (Markdown-Teilmenge, Erwähnungen, Antworten, Verlauf), Anhänge (verschlüsselt, Typ am Inhalt geprüft,
optional Viren-Scan) und Benachrichtigungen an beliebigen Zielen einer App. Fastify 5, PostgreSQL.

## Einbinden in drei Schritten

### 1. Migrationen

```ts
import { discussionMigrations } from '@vollholz/discussion';

const discussion = discussionMigrations({ schema: 'shop', app: 'shop_app', sched: 'shop_sched' });
// mit dem Runner von @vollholz/iam: migrate(url, [iamMigrations(...), discussion, dirMigrations(dir)])
// sonst: discussion.migrations[i].sql der Reihe nach ausführen (idempotent)
```

Danach in einer **eigenen Migration der App** die Zieltypen melden (immer alle; ein neuer Typ = erneuter Aufruf):

```sql
SELECT shop.discussion_targets('{"order": "shop.sales_order", "customer": "shop.customer"}');
```

Das legt die Lesesicht (ein Kommentar ist sichtbar, wenn sein Ziel sichtbar ist) und den Trigger an, der Kommentare
und Anhänge weich löscht, wenn ein Ziel gelöscht wird.

Voraussetzungen in der Datenbank: Schema `shop`, Rollen `shop_app` (API) und `shop_sched` (Worker), ein
Personenverzeichnis `shop.principal (id uuid, kind 'user'|'client', display_name, client_id, removed_at)` – bei
`@vollholz/iam` vorhanden. Mandant und Person kommen als SQL-Ausdruck (`tenant`, `principal`; Standard
`app.tenant_id()` und `app.principal_id()` von iam).

### 2. API

```ts
import { discussion, createBlobStore, iamHost, type DiscussionTarget } from '@vollholz/discussion';
import { HttpError } from '@vollholz/iam';

const orderTarget: DiscussionTarget = {
  type: 'order', basePath: '/v1/orders', read: 'order:read',
  label: { one: 'Auftrag', of: 'eines Auftrags', at: 'am Auftrag' },
  async load(req, tx, id) {
    const o = (await tx.query('SELECT id, title FROM shop.sales_order WHERE id = $1', [id])).rows[0];
    return o ? { id: o.id, title: o.title, classified: false, ref: { id: o.id, title: o.title } } : null;
  },
};

await app.register(discussion({
  schema: 'shop',
  host: iamHost({ HttpError, emit }),           // oder ein eigener Host (siehe unten)
  targets: [orderTarget],
  attachments: { store: createBlobStore({ storage: 'fs', dir: '/data/anhaenge', s3 }), keys: encryptionKeys },
}));
```

Routen je Zieltyp: `GET/POST /v1/orders/{id}/comments`, `GET/POST /v1/orders/{id}/attachments`; gemeinsam
`/v1/comments/{id}` (lesen, bearbeiten mit `If-Match`, löschen, `/revisions`), `/v1/attachments/{id}` (`/content`),
`GET /v1/me/notifications`, `POST /v1/me/notifications/read`; Übersicht der angemeldeten Person über alle Ziele:
`GET /v1/me/comments` (eigene Kommentare) und `GET /v1/me/mentions` (Erwähnungen), nur an Zielen, die sie sieht. Ereignisse (`host.emit`): `comment.created|updated|deleted`,
`attachment.created|deleted` mit `target`.

**Eigener Host** (ohne iam) – fünf Funktionen:

```ts
const host: DiscussionHost = {
  principal: req => ({ id: req.user.id, tenantId: req.user.tenantId }),
  tx: (req, fn) => db.transaction(req.user, fn),          // Mandantenkontext setzen (RLS)
  can: async (req, perm, target) => rights.allows(req.user, perm, target),
  // optional: need, needSomewhere, audit, emit, error
};
```

### 3. Rechte

`comment:write`, `comment:moderate`, `attachment:write`, `attachment:delete` den Rollen der App geben
(`DISCUSSION_PERMISSIONS` liefert Namen und Beschreibungen).

## Betrieb

- Bereinigung im Worker: `purgeDeleted` (Kommentare, Benachrichtigungen) und `purgeDeletedAttachments` (Dateien).
- Schlüsselrotation: `rewrapAttachmentKeys` je Mandant; Dateien bleiben unverändert.
- Ablage: `FsBlobStore` (Verzeichnis) oder `S3BlobStore` (S3-kompatibel, SigV4 ohne SDK).
