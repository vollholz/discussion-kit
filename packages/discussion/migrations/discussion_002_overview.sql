-- discussion_002 Übersicht je Person über alle Ziele (GET /v1/me/comments): eigene Kommentare und Erwähnungen,
-- neueste zuerst. Nur nicht gelöschte Kommentare erscheinen dort.
--
-- Idempotent wie discussion_001.

CREATE INDEX IF NOT EXISTS comment_by_author ON {{schema}}.comment (tenant_id, author_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
-- Erwähnungen über «mentions @> ARRAY[person]» (der Operator nutzt den Index, «= ANY(mentions)» nicht)
CREATE INDEX IF NOT EXISTS comment_mentions ON {{schema}}.comment USING gin (mentions) WHERE deleted_at IS NULL;
