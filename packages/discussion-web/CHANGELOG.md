# Changelog `@vollholz/discussion-web`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

## [Unveröffentlicht]

## [1.0.1] – 2026-11-01

### Behoben

- Erwähnungen stehen im Eingabefeld als «@Name» mit Hervorhebung statt als Rohtext `@[Name](id)`. Das Format des
  Servers entsteht erst beim Senden; beim Bearbeiten werden gespeicherte Erwähnungen wieder als «@Name» angezeigt. Wer
  den Namen einer Erwähnung ändert, macht daraus normalen Text.
- «@ Person erwähnen» liess die Personenauswahl kurz aufgehen und gleich wieder schliessen (Flackern). Der Knopf
  nimmt dem Feld den Fokus nicht mehr, und die Auswahl schliesst nur, wenn der Fokus das Formular verlässt.

## [1.0.0] – 2026-11-01

### Hinzugefügt

- Erste Version, herausgelöst aus Assets (Nr. 114): `DiscussionProvider`, `CommentsPanel`, `AttachmentsPanel`,
  `NotificationBell`, eigene Grundbausteine und Stylesheet; Adapter `@vollholz/discussion-web/iam` für Apps mit
  `@vollholz/iam-web`.
