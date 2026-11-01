# Changelog `@vollholz/discussion`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

## [Unveröffentlicht]

## [1.1.0] – 2026-11-01

### Hinzugefügt

- Übersicht der angemeldeten Person über alle Ziele: `GET /v1/me/comments` listet eigene Kommentare und Antworten
  und Kommentare anderer, die sie erwähnen, in einer Liste, neueste zuerst – mit `involvement` (`author`, `mention`),
  Bezeichnung des Ziels und Zahl der Antworten; `filter=mine|mentions` grenzt ein. Nur Kommentare an Zielen, die sie
  mit ihren aktuellen Rechten sieht (`load` je Ziel, wie die Inbox); Erwähnungen folgen dem aktuellen Text (nach
  Bearbeitungen).
- Migration `discussion_002_overview`: Indizes für die Übersicht (Autorin bzw. Autor, Erwähnungen).

## [1.0.0] – 2026-11-01

### Hinzugefügt

- Erste Version, herausgelöst aus Assets (Konzept «Kommentare und Anhänge als Baukasten», Nr. 114): Fastify-Plugin
  `discussion` mit Kommentaren, Anhängen und Inbox je Zieltyp, Port `DiscussionHost` (mit `iamHost` für Apps mit
  `@vollholz/iam`), idempotente Migration `discussion_001_core` mit Lesesicht je Zieltyp (`discussion_targets`),
  Ablage (Dateisystem, S3), Verschlüsselung in Segmenten, Viren-Scan (clamd), Wartung (`purgeDeleted`,
  `purgeDeletedAttachments`, `rewrapAttachmentKeys`).
