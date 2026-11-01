# Changelog `@vollholz/discussion`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

## [Unveröffentlicht]

## [1.0.0] – 2026-11-01

### Hinzugefügt

- Erste Version, herausgelöst aus Assets (Konzept «Kommentare und Anhänge als Baukasten», Nr. 114): Fastify-Plugin
  `discussion` mit Kommentaren, Anhängen und Inbox je Zieltyp, Port `DiscussionHost` (mit `iamHost` für Apps mit
  `@vollholz/iam`), idempotente Migration `discussion_001_core` mit Lesesicht je Zieltyp (`discussion_targets`),
  Ablage (Dateisystem, S3), Verschlüsselung in Segmenten, Viren-Scan (clamd), Wartung (`purgeDeleted`,
  `purgeDeletedAttachments`, `rewrapAttachmentKeys`).
