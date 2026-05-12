-- Phase 1.0e: Add source + metadata to tasks for canon-generated task tagging and idempotency
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_source_must_have
  ON tasks ((metadata->>'must_have_id'))
  WHERE source = 'sage_canon_post_call';

CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source) WHERE source IS NOT NULL;
