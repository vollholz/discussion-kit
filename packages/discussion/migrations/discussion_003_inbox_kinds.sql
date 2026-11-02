-- discussion_003 Inbox für weitere Arten: Benachrichtigungen anderer Bausteine der App (z. B. «Aufgabe zugewiesen» an
-- einer Aufgabe) neben Erwähnungen und Antworten an Kommentaren. Statt fester Listen in `kind` und `subject_type` gilt
-- dasselbe Format wie für Zieltypen (a–z und «_», höchstens 40 Zeichen); welche Arten erlaubt sind, legt die App im
-- Code fest (`discussionInbox`). Bestehende Einträge erfüllen das Format.
--
-- Idempotent wie discussion_001: Entfernt nur CHECKs mit fester Liste auf genau einer der beiden Spalten (auch mit
-- anderem Namen aus einer Tabelle der App), legt die Formatprüfung nur an, wenn sie fehlt. Lesesicht (own_*) und
-- Mandantentrennung bleiben unverändert.

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.conname FROM pg_constraint c
     WHERE c.conrelid = '{{schema}}.notification'::regclass AND c.contype = 'c'
       AND c.conname NOT IN ('notification_kind_format', 'notification_subject_type_format')
       AND cardinality(c.conkey) = 1
       AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) IN ('kind', 'subject_type')
       AND pg_get_constraintdef(c.oid) !~ '~'
  LOOP
    EXECUTE format('ALTER TABLE {{schema}}.notification DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '{{schema}}.notification'::regclass AND conname = 'notification_kind_format') THEN
    ALTER TABLE {{schema}}.notification ADD CONSTRAINT notification_kind_format CHECK (kind ~ '^[a-z][a-z_]{0,39}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '{{schema}}.notification'::regclass AND conname = 'notification_subject_type_format') THEN
    ALTER TABLE {{schema}}.notification ADD CONSTRAINT notification_subject_type_format CHECK (subject_type ~ '^[a-z][a-z_]{0,39}$');
  END IF;
END $$;
