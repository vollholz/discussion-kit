# Changelog `@vollholz/discussion-web`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

## [Unveröffentlicht]

## [1.1.0] – 2026-11-01

### Hinzugefügt

- `CommentsOverview`: zentrale Übersicht der eigenen Kommentare und Erwähnungen über alle Ziele in einer Liste, mit
  Filter (Alle, Erwähnungen, Meine Kommentare), Ziel, Zeit, Anfang des Textes und Zahl der Antworten; Erwähnungen
  sind mit @ markiert. Ein Eintrag öffnet sein Ziel in der App über `onOpen` mit der ID des Kommentars – mit der Maus
  der ganze Eintrag (ausser Links im Text und beim Markieren), mit der Tastatur der Knopf mit dem Ziel. Braucht
  `@vollholz/discussion` ab 1.1.0.
- `NotificationBell`: optional `onShowAll`, ein Link unten führt zur Übersicht.
- `CommentText`: optional `me`, die eigene Erwähnung ist hervorgehoben. Hook `useCommentOverview`.

### Geändert

- Unter dem Kommentarfeld steht kein Hinweis zur Formatierung mehr («**fett**, *kursiv* … · Strg+Enter sendet»);
  «Erwähnt: …» erscheint nur, wenn jemand erwähnt ist. Strg+Enter sendet weiterhin.
- Antworten liegt näher als ein neuer Kommentar: Unter jedem Gespräch steht ein Feld «Antworten …», das die Antwort
  dort öffnet; der Knopf «Antworten» an jedem Kommentar entfällt. Das Feld unten heisst «Neues Thema beginnen …»,
  steht mit mehr Abstand und hat keine sichtbare Beschriftung mehr (für Screenreader «Neues Thema»); «Antwort an …»
  und «Kommentar bearbeiten» bleiben sichtbar.
- `NotificationBell`: Benachrichtigungen an Zielen, die die Person nicht (mehr) sieht, erscheinen nicht mehr (vorher
  «… für dich nicht mehr sichtbar» ohne Inhalt und ohne Ziel); ungelesene davon gelten als gelesen, damit die Zahl an
  der Glocke stimmt. Die API liefert sie unverändert mit `available: false`.

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
