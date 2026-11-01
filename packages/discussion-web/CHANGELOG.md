# Changelog `@vollholz/discussion-web`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

Jede Version beginnt mit **Für Nutzer** (allgemein verständlich, ohne Namen aus dem Code; übernimmt die App unverändert
in ihre Release Notes) und **Für den Betrieb** (Migrationen, Einstellungen, Wartungsläufe), sonst je «(keine)». Danach
folgen die Angaben für die Entwickler der App. Sammeln für eine App: `npx discussion-notes` aus `@vollholz/discussion`.

## [Unveröffentlicht]

## [1.0.2] – 2026-11-01

### Für Nutzer

- (keine)

### Für den Betrieb

- (keine)

### Geändert

- Jede Version im CHANGELOG beginnt mit den Unterabschnitten «Für Nutzer» und «Für den Betrieb» (für 1.0.0 und 1.0.1
  nachgetragen), damit Apps sie mit `discussion-notes` in ihre Release Notes übernehmen können. Am Code nichts geändert.

## [1.0.1] – 2026-11-01

### Für Nutzer

- Erwähnungen erscheinen beim Schreiben eines Kommentars als «@Name» statt als unleserlicher Rohtext, auch beim
  späteren Bearbeiten.
- «@ Person erwähnen» öffnet die Personenauswahl zuverlässig; sie schloss sich zuvor manchmal sofort wieder.

### Für den Betrieb

- (keine)

### Behoben

- Erwähnungen stehen im Eingabefeld als «@Name» mit Hervorhebung statt als Rohtext `@[Name](id)`. Das Format des
  Servers entsteht erst beim Senden; beim Bearbeiten werden gespeicherte Erwähnungen wieder als «@Name» angezeigt. Wer
  den Namen einer Erwähnung ändert, macht daraus normalen Text.
- «@ Person erwähnen» liess die Personenauswahl kurz aufgehen und gleich wieder schliessen (Flackern). Der Knopf
  nimmt dem Feld den Fokus nicht mehr, und die Auswahl schliesst nur, wenn der Fokus das Formular verlässt.

## [1.0.0] – 2026-11-01

### Für Nutzer

- Kommentarbereich an Objekten mit Erwähnungen («@»), Antworten und Bearbeiten.
- Bereich für Anhänge: Dateien hochladen und herunterladen, Bilder als Vorschau ansehen.
- Glocke mit Benachrichtigungen, wenn man erwähnt wird oder jemand auf einen eigenen Kommentar antwortet.

### Für den Betrieb

- (keine)

### Hinzugefügt

- Erste Version, herausgelöst aus Assets (Nr. 114): `DiscussionProvider`, `CommentsPanel`, `AttachmentsPanel`,
  `NotificationBell`, eigene Grundbausteine und Stylesheet; Adapter `@vollholz/discussion-web/iam` für Apps mit
  `@vollholz/iam-web`.
