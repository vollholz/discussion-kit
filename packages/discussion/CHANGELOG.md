# Changelog `@vollholz/discussion`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

Jede Version beginnt mit **Für Nutzer** (allgemein verständlich, ohne Namen aus dem Code; übernimmt die App unverändert
in ihre Release Notes) und **Für den Betrieb** (Migrationen, Einstellungen, Wartungsläufe), sonst je «(keine)». Danach
folgen die Angaben für die Entwickler der App. Sammeln für eine App: `npx discussion-notes` (README).

## [Unveröffentlicht]

## [1.1.0] – 2026-11-01

### Für Nutzer

- (keine)

### Für den Betrieb

- (keine)

### Hinzugefügt

- Befehl `discussion-notes`: sammelt «Für Nutzer» und «Für den Betrieb» aller Versionen der Pakete des Kits seit dem
  letzten Release der App (Versionen aus `package-lock.json` jetzt und beim letzten Tag) als Block für die Release
  Notes der App; `--json` für eigene Werkzeuge. Dieselben Funktionen unter `@vollholz/discussion/release-notes`.
- Jede Version im CHANGELOG beginnt mit den Unterabschnitten «Für Nutzer» und «Für den Betrieb» (auch für 1.0.0
  nachgetragen).

## [1.0.0] – 2026-11-01

### Für Nutzer

- Objekte lassen sich kommentieren, mit Erwähnungen von Personen und Antworten; Kommentare lassen sich bearbeiten, der
  Verlauf bleibt sichtbar.
- An Objekte lassen sich Dateien anhängen. Sie werden verschlüsselt abgelegt und vor dem Speichern geprüft.
- Wer erwähnt wird oder eine Antwort auf einen eigenen Kommentar erhält, wird benachrichtigt.

### Für den Betrieb

- Neue Datenbank-Migration `discussion_001_core` (läuft mit den Migrationen der App).
- Ablage für Anhänge einrichten (Verzeichnis oder S3-kompatibler Speicher) und Schlüssel für deren Verschlüsselung
  hinterlegen; optional Viren-Scan über clamd.
- Bereinigung gelöschter Kommentare und Anhänge regelmässig im Worker ausführen.

### Hinzugefügt

- Erste Version, herausgelöst aus Assets (Konzept «Kommentare und Anhänge als Baukasten», Nr. 114): Fastify-Plugin
  `discussion` mit Kommentaren, Anhängen und Inbox je Zieltyp, Port `DiscussionHost` (mit `iamHost` für Apps mit
  `@vollholz/iam`), idempotente Migration `discussion_001_core` mit Lesesicht je Zieltyp (`discussion_targets`),
  Ablage (Dateisystem, S3), Verschlüsselung in Segmenten, Viren-Scan (clamd), Wartung (`purgeDeleted`,
  `purgeDeletedAttachments`, `rewrapAttachmentKeys`).
