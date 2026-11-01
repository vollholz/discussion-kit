-- discussion_001 Kommentare, Anhänge und Benachrichtigungen (Tabellen, Lesesicht, Rechte, Funktionen).
--
-- Platzhalter (discussionMigrations): {{schema}} Schema der Tabellen (dort liegt auch das Personenverzeichnis
-- principal), {{app}} Laufzeit-Rolle, {{sched}} Worker-Rolle, {{tenant}} Ausdruck für den Mandanten der Anfrage,
-- {{principal}} Ausdruck für die angemeldete Person.
--
-- Idempotent: Was es schon gibt (z. B. aus Migrationen der App vor dem Paket), bleibt; insbesondere werden bestehende
-- Lesesichten nicht ersetzt. Ziele meldet die App danach mit {{schema}}.discussion_targets in einer eigenen Migration.

CREATE TABLE IF NOT EXISTS {{schema}}.comment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z][a-z_]{0,39}$'),
  target_id uuid NOT NULL,
  author_id uuid NOT NULL,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  mentions uuid[] NOT NULL DEFAULT '{}',
  reply_to uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  revision int NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  deleted_by uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, reply_to) REFERENCES {{schema}}.comment (tenant_id, id) ON DELETE SET NULL (reply_to),
  CHECK (reply_to IS DISTINCT FROM id)
);
CREATE INDEX IF NOT EXISTS comment_by_target ON {{schema}}.comment (tenant_id, target_type, target_id, created_at, id);
CREATE INDEX IF NOT EXISTS comment_replies ON {{schema}}.comment (tenant_id, reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS comment_purge ON {{schema}}.comment (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.comment_revision (
  tenant_id uuid NOT NULL,
  comment_id uuid NOT NULL,
  revision int NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',
  written_at timestamptz NOT NULL,
  replaced_at timestamptz NOT NULL DEFAULT now(),
  replaced_by uuid,
  PRIMARY KEY (tenant_id, comment_id, revision),
  FOREIGN KEY (tenant_id, comment_id) REFERENCES {{schema}}.comment (tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS {{schema}}.attachment (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z][a-z_]{0,39}$'),
  target_id uuid NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 255),
  size bigint NOT NULL CHECK (size >= 0),
  media_type text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_key text NOT NULL UNIQUE,
  key_id text NOT NULL,
  wrapped_key bytea NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  deleted_by uuid,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS attachment_by_target ON {{schema}}.attachment (tenant_id, target_type, target_id, uploaded_at, id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS attachment_purge ON {{schema}}.attachment (deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS {{schema}}.notification (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mention', 'reply')),
  target_type text NOT NULL CHECK (target_type ~ '^[a-z][a-z_]{0,39}$'),
  target_id uuid NOT NULL,
  subject_type text NOT NULL CHECK (subject_type IN ('comment')),
  subject_id uuid NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, recipient_id, kind, subject_type, subject_id)
);
CREATE INDEX IF NOT EXISTS notification_inbox ON {{schema}}.notification (tenant_id, recipient_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS notification_unread ON {{schema}}.notification (tenant_id, recipient_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_purge ON {{schema}}.notification (created_at);

-- Mandantentrennung und Rechte (unabhängig vom Runner der App)
ALTER TABLE {{schema}}.comment ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.comment FORCE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.comment_revision ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.comment_revision FORCE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.attachment FORCE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.notification ENABLE ROW LEVEL SECURITY;
ALTER TABLE {{schema}}.notification FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'comment' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON {{schema}}.comment TO {{app}} USING (tenant_id = {{tenant}}) WITH CHECK (tenant_id = {{tenant}});
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'comment_revision' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON {{schema}}.comment_revision TO {{app}} USING (tenant_id = {{tenant}}) WITH CHECK (tenant_id = {{tenant}});
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'attachment' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON {{schema}}.attachment TO {{app}} USING (tenant_id = {{tenant}}) WITH CHECK (tenant_id = {{tenant}});
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'notification' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON {{schema}}.notification TO {{app}} USING (tenant_id = {{tenant}}) WITH CHECK (tenant_id = {{tenant}});
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON {{schema}}.comment, {{schema}}.comment_revision, {{schema}}.attachment, {{schema}}.notification TO {{app}};
-- Frühere Stände nur anhängen
REVOKE UPDATE, DELETE ON {{schema}}.comment_revision FROM {{app}};

-- Lesesicht: Vorgabe «nichts sichtbar», bis die App ihre Ziele meldet (discussion_targets); bestehende bleiben
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'comment' AND policyname = 'target_read') THEN
    CREATE POLICY target_read ON {{schema}}.comment AS RESTRICTIVE FOR SELECT TO {{app}}
      USING (current_setting('app.purge', true) = 'on' OR current_setting('discussion.bypass', true) = 'on');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'attachment' AND policyname = 'target_read') THEN
    CREATE POLICY target_read ON {{schema}}.attachment AS RESTRICTIVE FOR SELECT TO {{app}}
      USING (current_setting('app.purge', true) = 'on' OR current_setting('discussion.bypass', true) = 'on');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'comment_revision' AND policyname = 'target_read') THEN
    CREATE POLICY target_read ON {{schema}}.comment_revision AS RESTRICTIVE FOR SELECT TO {{app}}
      USING (EXISTS (SELECT 1 FROM {{schema}}.comment c WHERE c.tenant_id = comment_revision.tenant_id AND c.id = comment_revision.comment_id));
  END IF;
  -- Benachrichtigungen: nur die empfangende Person liest, markiert und löscht; anlegen darf die API für andere
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'notification' AND policyname = 'own_read') THEN
    CREATE POLICY own_read ON {{schema}}.notification AS RESTRICTIVE FOR SELECT TO {{app}} USING (recipient_id = {{principal}});
    CREATE POLICY own_update ON {{schema}}.notification AS RESTRICTIVE FOR UPDATE TO {{app}} USING (recipient_id = {{principal}}) WITH CHECK (recipient_id = {{principal}});
    CREATE POLICY own_delete ON {{schema}}.notification AS RESTRICTIVE FOR DELETE TO {{app}} USING (recipient_id = {{principal}});
  END IF;
  -- Bereinigung im Worker über alle Mandanten, nur mit app.purge = on
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'comment' AND policyname = 'sched_purge') THEN
    CREATE POLICY sched_purge_read ON {{schema}}.comment FOR SELECT TO {{sched}} USING (current_setting('app.purge', true) = 'on');
    CREATE POLICY sched_purge ON {{schema}}.comment FOR DELETE TO {{sched}} USING (current_setting('app.purge', true) = 'on' AND deleted_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'attachment' AND policyname = 'sched_purge') THEN
    CREATE POLICY sched_purge_read ON {{schema}}.attachment FOR SELECT TO {{sched}} USING (current_setting('app.purge', true) = 'on');
    CREATE POLICY sched_purge ON {{schema}}.attachment FOR DELETE TO {{sched}} USING (current_setting('app.purge', true) = 'on' AND deleted_at IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = '{{schema}}' AND tablename = 'notification' AND policyname = 'sched_purge') THEN
    CREATE POLICY sched_purge_read ON {{schema}}.notification FOR SELECT TO {{sched}} USING (current_setting('app.purge', true) = 'on');
    CREATE POLICY sched_purge ON {{schema}}.notification FOR DELETE TO {{sched}} USING (current_setting('app.purge', true) = 'on');
  END IF;
END $$;
GRANT SELECT, DELETE ON {{schema}}.comment, {{schema}}.attachment, {{schema}}.notification TO {{sched}};

-- Ziel gelöscht: Kommentare und Anhänge weich löschen; die Zeile des Ziels fehlt dann schon, darum für die Dauer der
-- Anweisungen an der Lesesicht vorbei (discussion.bypass). Zieltyp als Argument des Triggers.
CREATE OR REPLACE FUNCTION {{schema}}.discussion_target_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE prev text := coalesce(current_setting('discussion.bypass', true), 'off');
BEGIN
  PERFORM set_config('discussion.bypass', 'on', true);
  UPDATE {{schema}}.comment SET deleted_at = now(), deleted_by = {{principal}}
   WHERE tenant_id = OLD.tenant_id AND target_type = TG_ARGV[0] AND target_id = OLD.id AND deleted_at IS NULL;
  UPDATE {{schema}}.attachment SET deleted_at = now(), deleted_by = {{principal}}
   WHERE tenant_id = OLD.tenant_id AND target_type = TG_ARGV[0] AND target_id = OLD.id AND deleted_at IS NULL;
  PERFORM set_config('discussion.bypass', prev, true);
  RETURN NULL;
END $$;

-- Zieltypen melden (nur in Migrationen der App): Lesesicht target_read von Kommentaren und Anhängen mit einem
-- Ausdruck je Zieltyp neu anlegen, Lösch-Trigger an jede Zieltabelle. Immer alle Zieltypen übergeben:
--   SELECT {{schema}}.discussion_targets('{"order": "{{schema}}.sales_order"}');
-- Ein Ausdruck je Zieltyp statt einer Funktion in der Policy: PostgreSQL bettet SQL-Funktionen mit Unterabfragen nicht
-- ein, je Zeile ein Funktionsaufruf machte das Zählen ~7-mal langsamer.
CREATE OR REPLACE FUNCTION {{schema}}.discussion_targets(p_targets jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE k text; tbl text; target regclass; visible text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['comment', 'attachment'] LOOP
    visible := '';
    FOR k IN SELECT jsonb_object_keys(p_targets) ORDER BY 1 LOOP
      IF k !~ '^[a-z][a-z_]{0,39}$' THEN RAISE EXCEPTION 'Ungültiger Zieltyp: %', k; END IF;
      target := (p_targets ->> k)::regclass;
      visible := visible || format(' OR (target_type = %L AND EXISTS (SELECT 1 FROM %s t WHERE t.tenant_id = %I.tenant_id AND t.id = %I.target_id))', k, target, tbl, tbl);
      IF tbl = 'comment' THEN
        EXECUTE format('CREATE OR REPLACE TRIGGER discussion_target_deleted AFTER DELETE ON %s FOR EACH ROW EXECUTE FUNCTION {{schema}}.discussion_target_deleted(%L)', target, k);
      END IF;
    END LOOP;
    EXECUTE format('DROP POLICY IF EXISTS target_read ON {{schema}}.%I', tbl);
    EXECUTE format('CREATE POLICY target_read ON {{schema}}.%I AS RESTRICTIVE FOR SELECT TO {{app}} USING (current_setting(''app.purge'', true) = ''on'' OR current_setting(''discussion.bypass'', true) = ''on''%s)', tbl, visible);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION {{schema}}.discussion_targets(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION {{schema}}.discussion_target_deleted() FROM PUBLIC;
