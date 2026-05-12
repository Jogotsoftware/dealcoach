-- Phase 1.0d: Add reconfirmed_at to compelling_events for stale-CE detection in process-transcript watcher
ALTER TABLE compelling_events
  ADD COLUMN IF NOT EXISTS reconfirmed_at timestamptz;

COMMENT ON COLUMN compelling_events.reconfirmed_at IS 'When CE was last reconfirmed by buyer on a call (semantically distinct from updated_at). Populated by process-transcript when CE-reconfirming language detected.';
