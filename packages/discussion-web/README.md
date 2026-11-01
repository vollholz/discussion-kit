# @vollholz/discussion-web

React-Komponenten zu [`@vollholz/discussion`](../discussion): `CommentsPanel` (Verlauf, Antworten, @-Erwähnung per
Tastatur, Bearbeiten mit Verlauf), `AttachmentsPanel` (Hochladen mit Fortschritt und Drag & Drop, Vorschau nur für
Rasterbilder), `NotificationBell` (Glocke mit Zahl der ungelesenen), `CommentsOverview` (eigene Kommentare und
Erwähnungen über alle Ziele). Peer: React 19, TanStack Query 5.

## Einbinden

```tsx
import '@vollholz/discussion-web/styles.css';
import { CommentsPanel, DiscussionProvider } from '@vollholz/discussion-web';

const targets = { order: { basePath: '/v1/orders', here: 'zu diesem Auftrag', restricted: 'Für diesen Auftrag', files: 'Lieferscheine' } };

<DiscussionProvider targets={targets} me={principalId} can={perm => rights.includes(perm)} headers={() => ({ 'X-CSRF-Token': csrf })}>
  <CommentsPanel target={{ type: 'order', id: order.id }} can={order.can} />
</DiscussionProvider>
```

Mit **`@vollholz/iam-web`** genügt der Adapter – Sitzung, Rechte, Organisation, CSRF, Personensuche, Meldungen und
Grundbausteine kommen aus der App:

```tsx
import { IamDiscussionProvider } from '@vollholz/discussion-web/iam';

<IamDiscussionProvider targets={targets}><CommentsPanel target={…} /></IamDiscussionProvider>
```

Die Glocke entscheidet nicht selbst, wohin ein Eintrag führt: `<NotificationBell onOpen={t => navigate(…)} />`.

**Zentrale Übersicht** – eigene Kommentare und Erwähnungen über alle Ziele, z. B. als eigene Seite; die Glocke führt
mit `onShowAll` dorthin:

```tsx
<CommentsOverview onOpen={(t, commentId) => navigate(…)} defaultView="mentions" />
<NotificationBell onOpen={t => navigate(…)} onShowAll={() => navigate('/ich/kommentare')} />
```

## Anpassen

| Option | Vorgabe |
|---|---|
| `searchPeople(q, limit)` | `GET /v1/people?q=…&limit=…` |
| `link(url)` | Download- und Bildlinks unverändert |
| `toast` | eigene Meldungsleiste unten |
| `components` | eigene `Loading`, `ErrorBox`, `Empty`, `Confirm`, `Modal`, `MissingRight` |
| `toError` | `DiscussionApiError` (Problem Details) |

Farben: Tokens der App (`--surface`, `--line`, `--accent` …) oder die `--dk-*`-Variablen.
