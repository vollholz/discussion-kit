# Changelog `@vollholz/discussion-web`

Alle Änderungen dieses Pakets, die eine App betreffen. Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionen nach [Semantic Versioning](https://semver.org/lang/de/): Breaking = Major.

Jede Version beginnt mit **Für Nutzer** (allgemein verständlich, ohne Namen aus dem Code; übernimmt die App unverändert
in ihre Release Notes) und **Für den Betrieb** (Migrationen, Einstellungen, Wartungsläufe), sonst je «(keine)». Danach
folgen die Angaben für die Entwickler der App. Sammeln für eine App: `npx discussion-notes` aus `@vollholz/discussion`.

## [Unveröffentlicht]

### Für Nutzer

- Die Glocke zeigt auch Benachrichtigungen aus anderen Bereichen der App (z. B. eine zugewiesene Aufgabe) mit eigenem
  Text; unbekannte Arten erscheinen als «Neue Benachrichtigung».

### Für den Betrieb

- (keine)

### Hinzugefügt

- `DiscussionProvider`: `notificationKinds: { [kind]: { text(n), icon? } }` für weitere Arten der Glocke. `text` liefert
  die Zeile vor der Bezeichnung des Ziels, `icon` ersetzt das Kürzel der Person. Typ `NotificationKind`.
- `NotificationBell`: `onOpen` bekommt als dritten Wert den ganzen Eintrag (`Notification`), damit die Shell nach
  `subject.type` entscheiden kann. Bestehende Aufrufe mit zwei Parametern bleiben gültig.

### Geändert

- `Notification`: `kind` und `subject.type` erlauben neben `mention`/`reply` bzw. `comment` weitere Zeichenketten.
  Unbekannte Arten ohne Eintrag in `notificationKinds` zeigen einen allgemeinen Text; Erwähnungen und Antworten wie
  bisher.

## [1.2.0] – 2026-11-01

### Für Nutzer

- Ein Klick auf einen Eintrag der Übersicht «Kommentare und Erwähnungen» oder auf eine Benachrichtigung führt direkt
  zum Kommentar: Die Liste scrollt zu ihm und hebt ihn kurz hervor, auch wenn er weiter hinten steht.

### Für den Betrieb

- (keine)

### Hinzugefügt

- `CommentsPanel`: optional `commentId`. Die Liste lädt Seiten nach, bis der Kommentar geladen ist, scrollt ihn in die
  Mitte, hebt ihn hervor (Klasse `focused`, `aria-current`) und setzt den Fokus darauf, einmal je ID. Fehlt er, bleibt
  die Liste, wie sie ist. Die App reicht die ID aus `onOpen` von `CommentsOverview` bzw. `NotificationBell` weiter,
  z. B. über die Adresse.

### Geändert

- `NotificationBell`: `onOpen` erhält als zweites Argument die ID des Kommentars (wie bei `CommentsOverview`).
  Bestehende Handler mit einem Argument funktionieren unverändert.

## [1.1.0] – 2026-11-01

### Für Nutzer

- Neue Übersicht «Kommentare und Erwähnungen»: Eigene Kommentare und alle Stellen, an denen man erwähnt wurde, stehen
  in einer Liste über alle Objekte, neueste zuerst, und lassen sich auf Erwähnungen oder eigene Kommentare
  eingrenzen. Ein Klick auf einen Eintrag öffnet das Objekt. Es erscheint nur, was man sehen darf.
- Antworten ist einfacher: Unter jedem Gespräch steht ein Feld «Antworten …». Das Feld unten beginnt ein neues Thema.
- Das Kommentarfeld ist aufgeräumt: kein Hinweis zur Formatierung mehr darunter.
- Die Glocke zeigt keine Benachrichtigungen mehr zu Objekten, die man nicht (mehr) sehen darf.

### Für den Betrieb

- (keine)

### Hinzugefügt

- `CommentsOverview`: zentrale Übersicht der eigenen Kommentare und Erwähnungen über alle Ziele in einer Liste, mit
  Filter (Alle, Erwähnungen, Meine Kommentare), Ziel, Zeit, Anfang des Textes und Zahl der Antworten; Erwähnungen
  sind mit @ markiert. Ein Eintrag öffnet sein Ziel in der App über `onOpen` mit der ID des Kommentars – mit der Maus
  der ganze Eintrag (ausser Links im Text und beim Markieren), mit der Tastatur der Knopf mit dem Ziel. Braucht
  `@vollholz/discussion` ab 1.2.0.
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
