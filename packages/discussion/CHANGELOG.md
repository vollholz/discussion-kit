# Changelog `@vollholz/discussion`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

Jede Version beginnt mit **Für Nutzer** (allgemein verständlich, ohne Namen aus dem Code; übernimmt die App unverändert
in ihre Release Notes) und **Für den Betrieb** (Migrationen, Einstellungen, Wartungsläufe), sonst je «(keine)». Danach
folgen die Angaben für die Entwickler der App. Sammeln für eine App: `npx discussion-notes` (README).

## [Unveröffentlicht]

## [1.3.0] – 2026-11-02

### Für Nutzer

- Die Glocke kann neben Erwähnungen und Antworten auch Benachrichtigungen aus anderen Bereichen der App zeigen, z. B.
  wenn dir eine Aufgabe zugewiesen wird.

### Für den Betrieb

- Neue Datenbank-Migration `discussion_003_inbox_kinds`: ersetzt die festen Listen der Arten in der Tabelle der
  Benachrichtigungen durch eine Formatprüfung (läuft mit den Migrationen der App; bestehende Einträge bleiben gültig).

### Hinzugefügt

- `discussionInbox({ schema, kinds, subjects })`: Inbox mit weiteren Arten anderer Bausteine der App (z. B.
  `task_assigned` an `task`). Als `notifications` an `discussion(...)` geben und dem meldenden Baustein reichen;
  `inbox.notify(tx, notice)` legt Einträge in dessen Transaktion an, mit denselben Regeln wie bei Kommentaren (nicht an
  sich selbst, nur Personen, je Person, Art und Gegenstand einmal) und liefert die Zahl neuer Einträge. Nicht
  registrierte Arten sind ein Fehler.
- `InboxSubject.load(req, tx, ref)` je Art von Gegenstand: Bezeichnung und Kurztext mit den Rechten der empfangenden
  Person; `null` ergibt `available: false` (wie ein nicht mehr sichtbares Ziel).
- Typen `DiscussionInbox`, `InboxNotice`, `InboxOptions`, `InboxSubject`, `InboxSubjectRef`, `InboxSubjectView`,
  Konstante `COMMENT_KINDS`.
- Migration `discussion_003_inbox_kinds`: CHECKs `notification_kind_format` und `notification_subject_type_format`
  (a–z und «_», höchstens 40 Zeichen) statt `kind IN ('mention', 'reply')` und `subject_type IN ('comment')`;
  Lesesicht `own_*` unverändert.

### Geändert

- `GET /v1/me/notifications`: `kind` und `subject.type` sind im Schema Zeichenketten (Format wie oben) statt fester
  Werte und liefern auch die registrierten Arten. Für Kommentare ändert sich nichts.
- `DiscussionOptions.notifications` nimmt zusätzlich eine `DiscussionInbox` an.

## [1.2.0] – 2026-11-01

### Für Nutzer

- (keine)

### Für den Betrieb

- Neue Datenbank-Migration `discussion_002_overview` mit zwei Indizes für die Übersicht (läuft mit den Migrationen
  der App).

### Hinzugefügt

- Übersicht der angemeldeten Person über alle Ziele: `GET /v1/me/comments` listet eigene Kommentare und Antworten
  und Kommentare anderer, die sie erwähnen, in einer Liste, neueste zuerst – mit `involvement` (`author`, `mention`),
  Bezeichnung des Ziels und Zahl der Antworten; `filter=mine|mentions` grenzt ein. Nur Kommentare an Zielen, die sie
  mit ihren aktuellen Rechten sieht (`load` je Ziel, wie die Inbox); Erwähnungen folgen dem aktuellen Text (nach
  Bearbeitungen).
- Migration `discussion_002_overview`: Indizes für die Übersicht (Autorin bzw. Autor, Erwähnungen).

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
