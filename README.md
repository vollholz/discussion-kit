# discussion-kit

Kommentare, Anhänge und Benachrichtigungen für eigene Apps – Datenbank, API und Oberfläche aus einem Baukasten.
Eine App macht etwas kommentierbar, indem sie einen **Zieltyp** meldet und eine **Komponente** einbindet.

| Paket | Inhalt |
|---|---|
| [`@vollholz/discussion`](packages/discussion) | Migrationen (PostgreSQL, RLS), Fastify-Plugin (Kommentare, Anhänge, Inbox), Ablage (Dateisystem, S3), Verschlüsselung, Viren-Scan, Wartung |
| [`@vollholz/discussion-web`](packages/discussion-web) | React-Komponenten `CommentsPanel`, `AttachmentsPanel`, `NotificationBell`; optional Adapter für `@vollholz/iam-web` |

## Grundsätze

- **Wenig Einbindung.** Backend: eine Migrationsquelle, ein Plugin, ein Host aus wenigen Zeilen. Oberfläche: ein Provider,
  Komponenten mit eigenem Stylesheet. Kein Zwang zu `@vollholz/iam`; für iam-Apps gibt es Adapter (`iamHost`,
  `@vollholz/discussion-web/iam`).
- **Fachlogik bleibt in der App.** Was sichtbar ist und wer kommentieren darf, entscheidet die App (`DiscussionTarget`,
  `host.can`). Das Paket kennt keine Fachobjekte.
- **Sicher ohne Zutun.** Mandantentrennung und Lesesicht in der Datenbank (RLS), Benachrichtigungen nur für die
  empfangende Person, Anhänge verschlüsselt, Typ am Inhalt geprüft, Download nur als Anhang mit `sandbox`-CSP.
- **Sieht aus wie die App.** Farben über die Tokens der App (`--surface`, `--accent` …); Fehler, Dialoge und Meldungen
  lassen sich durch die Bausteine der App ersetzen.

## Entwicklung

```bash
npm install          # @vollholz/* aus GitHub Packages: NODE_AUTH_TOKEN setzen (z. B. gh auth token)
npm run check        # Typprüfung, Build, Tests (Datenbank-Tests mit TEST_POSTGRES_URL, sonst übersprungen)
```

Neue Version: `version` in `packages/<paket>/package.json` erhöhen, Abschnitt in `CHANGELOG.md` schreiben, per PR
mergen. Der Workflow `release.yml` veröffentlicht jede Version, die noch nicht auf GitHub Packages liegt, mit Tag
`<paket>-v<version>` und GitHub Release.

Lizenz: Apache-2.0 (LICENSE, NOTICE).
