# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Überblick

npm-Workspace mit zwei Paketen, die Apps Kommentare, Anhänge und Benachrichtigungen an beliebigen Zielen geben:

- `packages/discussion` → `@vollholz/discussion`: PostgreSQL-Migrationen (RLS), Fastify-5-Plugin, Ablage, Verschlüsselung, Viren-Scan, Wartung.
- `packages/discussion-web` → `@vollholz/discussion-web`: React-19-Komponenten (`CommentsPanel`, `AttachmentsPanel`, `NotificationBell`, `CommentsOverview`) auf TanStack Query 5, Einstieg `/iam` als Adapter für `@vollholz/iam-web`.

Sprache im ganzen Repo ist Deutsch in Schweizer Rechtschreibung («ss» statt «ß», Anführungszeichen «»): Kommentare,
Fehlermeldungen, Texte der API, README, CHANGELOG und Commit-Messages. Jede Quelldatei beginnt mit einem Doc-Kommentar,
der Zweck und Regeln des Moduls beschreibt.

## Befehle

Node ≥ 24 (`.nvmrc`). Node führt `.ts` direkt aus (Type Stripping): Build-Skripte, Tests und `scripts/` laufen ohne Bundler.

```bash
npm install                 # @vollholz/* kommt aus GitHub Packages: vorher NODE_AUTH_TOKEN setzen (z. B. $(gh auth token))
npm run check               # Typprüfung, Build, Tests beider Pakete (wie CI)
npm run typecheck | build | test
```

Einzelne Tests:

```bash
# Backend (node:test)
node --test packages/discussion/test/building-blocks.test.ts
node --test --test-name-pattern="Erwähnung" packages/discussion/test/integration.test.ts

# Oberfläche (Vitest, jsdom)
npm test -w @vollholz/discussion-web -- test/inbox.test.tsx -t "Glocke"

# Release-Notes-Skript (nicht in npm run check enthalten, läuft in CI)
npx tsc -p scripts/tsconfig.json && node --test scripts/*.test.ts
node scripts/changelog.ts check --base origin/main
```

Datenbank-Tests (`packages/discussion/test/integration.test.ts`) brauchen PostgreSQL als Superuser:
`TEST_POSTGRES_URL` oder `POSTGRES_SUPERUSER_PASSWORD` (+ `POSTGRES_PORT`, Standard 5433). Fehlt beides oder ist die
Datenbank nicht erreichbar, werden sie **übersprungen**, nicht rot. CI nutzt `postgres:17` auf Port 5433. Der Test legt
eine Wegwerf-Datenbank `dk_test_<suffix>` mit eigenen Rollen an.

## Architektur

### Ports statt Abhängigkeiten

Das Paket kennt weder Fachobjekte noch Anmeldung oder Rechtemodell der App. Die App liefert zwei Ports:

- **`DiscussionHost`** (`src/host.ts`): `tx` (Transaktion im Mandantenkontext, setzt den Kontext für RLS), `principal`,
  `can`; optional `need`, `needSomewhere`, `audit`, `emit`, `error`. Routen greifen nur über `hostKit(host)` darauf zu,
  das die Vorgaben ergänzt.
- **`DiscussionTarget`** (`src/targets.ts`): Zieltyp mit `basePath`, Wörtern für Texte und `load()`. `load` gibt `null`
  zurück, wenn die Person das Ziel nicht sehen darf. Unsichtbare Ziele und nicht registrierte Typen ergeben immer
  **404** (nie 403), damit weder Ziel noch Kommentar ihre Existenz verraten.

`iamHost` übersetzt auf die Request-Methoden von `@vollholz/iam`, **ohne das Paket zu importieren** (keine
Versionskopplung). In `discussion-web` importiert nur `src/iam.tsx` aus `@vollholz/iam-web` (optionaler Peer). Der
Haupteinstieg muss ohne iam funktionieren.

### Zieltyp = zwei Stellen

Ein neuer Zieltyp braucht beides: den `DiscussionTarget` in TypeScript **und** in einer Migration der App
`SELECT <schema>.discussion_targets('{"<typ>": "<schema>.<tabelle>"}')`. Erst das legt in der Datenbank die Lesesicht
an (Policy `target_read`: Kommentar sichtbar, wenn sein Ziel sichtbar ist) und den Trigger, der beim Löschen des Ziels
weich löscht. Ohne Meldung ist nichts sichtbar.

### Sicherheit in der Datenbank

`migrations/discussion_NNN_*.sql` sind Vorlagen mit Platzhaltern `{{schema}}`, `{{app}}`, `{{sched}}`, `{{tenant}}`,
`{{principal}}`. `discussionMigrations()` (`src/migrations.ts`) setzt sie ein und bildet eine Checksumme. Unbekannte
Platzhalter sind ein Fehler. Regeln für Migrationen:

- idempotent (`IF NOT EXISTS`, Prüfung über `pg_policies`) und Bestehendes stehen lassen, weil Apps Tabellen aus
  eigenen Migrationen mitbringen können;
- Änderungen als neue Datei `discussion_NNN_*.sql`, weil sich bei bestehenden Dateien die Checksumme ändert.

Mandantentrennung über `tenant_isolation` (FORCE RLS), Lesesicht über `RESTRICTIVE`-Policies. Benachrichtigungen sieht
nur die empfangende Person (`own_*`). Revisionen sind nur anhängbar (`REVOKE UPDATE, DELETE`). Die Worker-Rolle
`{{sched}}` löscht nur bei `app.purge = 'on'`.

### Anhänge als Strom

`src/attachments.ts`: Upload fliesst ohne Puffer durch Typerkennung am Inhalt (`sniff.ts`), SHA-256, optional clamd
(`scan.ts`), Verschlüsselung (`sealed-stream.ts`) und Ablage (`storage.ts`: `FsBlobStore` oder `S3BlobStore` mit
eigener SigV4, ohne SDK). Die Metadatenzeile entsteht erst, wenn alles gelungen ist. Sonst wird die Datei entfernt.

- **Verschlüsselung:** AES-256-GCM in 64-KiB-Segmenten mit Datenschlüssel je Datei, umschlossen vom Hauptschlüssel
  (`crypto.ts`, AAD bindet an Mandant und Anhang). Rotation (`rewrapAttachmentKeys`) schliesst nur Datenschlüssel neu
  ein. `box`/`unbox` sind bytegleich mit `@vollholz/iam`, das Format bleibt kompatibel.
- **Download:** immer `Content-Disposition: attachment`, `nosniff` und CSP `sandbox`.
- **Vorschau:** nur für Rasterbilder (`PREVIEWABLE`), nie für HTML oder SVG.

### Kommentare und Erwähnungen

Text ist eine Markdown-Teilmenge, gespeichert als Text. Der Server erzeugt kein HTML. Gerendert wird nur in
`discussion-web/src/markdown.tsx`, ohne HTML zu interpretieren. Erwähnungen stehen im gespeicherten Text als
`@[Name](<principal-id>)`. Das Eingabefeld zeigt «@Name» und wandelt erst beim Senden um (`mentionToken` in `api.ts`).
Bearbeiten nur durch die Autorin bzw. den Autor, mit `If-Match`/ETag. Der alte Stand bleibt als Revision. Antworten
gehen eine Ebene tief.

Benachrichtigungen (`notifications` in `DiscussionOptions`): Standard ist die Inbox des Pakets (`/v1/me/notifications`),
eine eigene `Notify`-Funktion leitet an die App weiter, `false` schaltet sie ab.

### Vertrag Backend ↔ Oberfläche

`discussion-web` spricht nur HTTP mit den Routen des Backends. Die Typen in `discussion-web/src/api.ts` (`Comment`,
`Attachment`, `Notification`, Seiten mit `nextCursor`) spiegeln die TypeBox-Schemas in `comments.ts`,
`attachments.ts` und `notifications.ts`. Wer Antworten ändert, ändert beide Pakete. Fehler sind Problem Details
(RFC 9457). `host.error` bzw. `toError` lassen die Fehlerklasse der App einsetzen.

In der Oberfläche gilt:

- Alle Daten laufen über Hooks in `api.ts`, mit Abfrageschlüsseln `dkKeys`. Hochladen läuft über XMLHttpRequest, damit
  der Fortschritt sichtbar ist.
- `request()` nutzt eine absolute Herkunft (`baseUrl`, nötig für fetch in Tests). Links für Download und Bild bleiben
  relativ (`linkBase`).
- Rechte am Ziel (`DiscussionCan` aus den Antworten der App) haben Vorrang. Fehlt ein Wert, gilt `can(perm)` auf Ebene
  der Organisation (`can.ts`).
- Grundbausteine (`components`) und Meldungen (`toast`) sind ersetzbar. Farben kommen aus den Tokens der App
  (`--surface`, `--accent` …) oder aus `--dk-*`.
- Kein Quellmodul importiert CSS: Der Build kopiert `src/styles.css` nach `dist`, `dist` braucht keinen Bundler.

## TypeScript-Konventionen

`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` (Typen mit `import type`) und
`erasableSyntaxOnly`, weil Node die Dateien direkt ausführt: keine `enum`, keine `namespace`, keine
Parameter-Properties. Relative Imports tragen die Endung `.ts`/`.tsx`. Der Build schreibt sie auf `.js` um
(`rewriteRelativeImportExtensions`). Neue öffentliche Exporte gehören in `src/index.ts` des Pakets.

## Tests

- `discussion/test/building-blocks.test.ts`: Bausteine ohne Datenbank (Verschlüsselung, Typerkennung, Dateinamen, S3
  gegen einen lokalen HTTP-Server).
- `discussion/test/integration.test.ts`: kleine App «shop» **ohne** iam mit eigenem Host aus wenigen Zeilen. Gute
  Referenz dafür, wie eine App das Paket einbindet.
- `discussion-web/test/utils.tsx`: `renderWith()` (Provider mit Query-Client) und `mockFetch({ 'GET /v1/…': handler })`
  ersetzt `fetch`. Unbekannte Pfade antworten mit 404.

## Versionen und Release

Neue Version eines Pakets:

1. `version` in `packages/<paket>/package.json` erhöhen (SemVer, Breaking = Major).
2. In `packages/<paket>/CHANGELOG.md` einen Abschnitt `## [x.y.z] – JJJJ-MM-TT` unter `## [Unveröffentlicht]` anlegen.
   Er beginnt mit `### Für Nutzer` (allgemein verständlich, ohne Namen aus dem Code, die Apps übernehmen den Text
   unverändert) und `### Für den Betrieb` (Migrationen, Einstellungen, Wartung), bei nichts zu sagen je `- (keine)`.
   Danach folgen die Rubriken nach Keep a Changelog für die Entwickler der App. Regeln: README, Abschnitt «Release Notes».
3. Per PR mergen.

CI (`scripts/changelog.ts check`) lässt keine Version ohne Abschnitt und ohne die beiden Unterabschnitte durch und
keine kleinere als auf der Basis. Das Lesen der Abschnitte teilt sich das Skript mit `discussion-notes`
(`packages/discussion/src/release-notes.ts`), mit dem Apps die Texte für ihre eigenen Release Notes einsammeln.
`release.yml` veröffentlicht nach dem Merge jede Version, die noch nicht auf GitHub Packages liegt, mit Tag
`<paket>-v<version>` und GitHub Release. Commit-Messages folgen dem Muster `<paket> <version>: <was sich ändert>`.
