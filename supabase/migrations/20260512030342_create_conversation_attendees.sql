-- Phase 1.7: internal team participation per conversation
CREATE TABLE IF NOT EXISTS conversation_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid REFERENCES profiles(id),
  display_name text NOT NULL,
  role_label text,
  source text NOT NULL DEFAULT 'manual',
  external_calendar_event_id text,
  external_calendar_attendee_email text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(conversation_id, display_name)
);

ALTER TABLE conversation_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attendees_org_scope" ON conversation_attendees;
CREATE POLICY "attendees_org_scope" ON conversation_attendees
  FOR ALL
  USING (org_id = user_org_id())
  WITH CHECK (org_id = user_org_id());

CREATE INDEX IF NOT EXISTS idx_attendees_conversation ON conversation_attendees(conversation_id);
