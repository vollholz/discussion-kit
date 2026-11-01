# discussion-kit

Kommentare, Anhänge und Benachrichtigungen für eigene Apps – Datenbank, API und Oberfläche aus einem Baukasten.
Eine App macht etwas kommentierbar, indem sie einen **Zieltyp** meldet und eine **Komponente** einbindet.

| Paket | Inhalt |
|---|---|
| [`@vollholz/discussion`](packages/discussion) | Migrationen (PostgreSQL, RLS), Fastify-Plugin (Kommentare, Anhänge, Inbox), Ablage (Dateisystem, S3), Verschlüsselung, Viren-Scan, Wartung |
| [`@vollholz/discussion-web`](packages/discussion-web) | React-Komponenten `CommentsPanel`, `AttachmentsPanel`, `NotificationBell`, `CommentsOverview`; optional Adapter für `@vollholz/iam-web` |

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

## Release Notes

Die Apps liefern ihren Nutzern Release Notes, und darin sollen die Änderungen der Pakete seit dem letzten Release der
App stehen. Deshalb schreibt jedes Paket den Text für Nutzer selbst, und die App sammelt ihn ein.

**Im Kit.** Jeder Versionsabschnitt in `packages/<paket>/CHANGELOG.md` beginnt mit zwei Unterabschnitten, danach folgen
wie bisher die Rubriken nach Keep a Changelog für die Entwickler der App:

```markdown
## [1.0.1] – 2026-11-01

### Für Nutzer

- Erwähnungen erscheinen beim Schreiben eines Kommentars als «@Name» statt als unleserlicher Rohtext.

### Für den Betrieb

- (keine)

### Behoben

- … (für die Entwickler der App)
```

- **Für Nutzer:** allgemein verständlich, aus Sicht der Person am Bildschirm, ohne Namen aus dem Code. Die App übernimmt
  den Text unverändert. Allgemeine Begriffe («Kommentare», «Anhänge», «Benachrichtigungen»), keine Fachbegriffe einer
  bestimmten App.
- **Für den Betrieb:** Migrationen, neue Einstellungen, Wartungsläufe, Anforderungen an Ablage oder Viren-Scanner.
- Nichts zu sagen: `- (keine)`. Die CI (`scripts/changelog.ts check`) verlangt beide Unterabschnitte für jede neue
  Version, so wird der Text für Nutzer nicht vergessen.

**In der App.** `@vollholz/discussion` bringt den Befehl `discussion-notes` mit. Er vergleicht die Versionen der Pakete
im `package-lock.json` jetzt und beim letzten Tag der App, liest die Abschnitte dazwischen aus `CHANGELOG.md` der
installierten Pakete (wird mit ausgeliefert, kein Zugriff auf dieses Repo nötig) und gibt einen Block für die
Release Notes der App aus:

```bash
npx discussion-notes                    # seit dem letzten Tag (git describe --tags)
npx discussion-notes --seit v2.3.0      # seit einem bestimmten Release der App
npx discussion-notes --json             # für eigene Werkzeuge; --ebene 2 für die Überschrift, --lockfile <pfad>
```

```markdown
### Kommentare, Anhänge und Benachrichtigungen

#### Für Nutzer

- Erwähnungen erscheinen beim Schreiben eines Kommentars als «@Name» statt als unleserlicher Rohtext.

<sub>@vollholz/discussion-web 1.0.0 → 1.0.2</sub>
```

Die App übernimmt den Block und streicht höchstens Punkte zu Teilen, die sie nicht nutzt. Fehlt einer Version ein
Unterabschnitt (Versionen vor dieser Regel, im Kit nachgetragen ab `@vollholz/discussion` 1.1.0 und
`@vollholz/discussion-web` 1.0.2), steht im Block ein Hinweis «Unvollständig» und auf stderr eine Meldung. Ist ein
Paket neu eingebunden, beschreibt die App die neue Funktion selbst; der Block nennt dann nur die Version.

Lizenz: Apache-2.0 (LICENSE, NOTICE).
