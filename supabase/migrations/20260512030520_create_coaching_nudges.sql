-- Phase 1.9: coaching_nudges table for AE-facing nudges (Thursday updates, EOM, stalled deals, etc.)
CREATE TABLE IF NOT EXISTS coaching_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  deal_id uuid REFERENCES deals(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(id),
  nudge_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info', 'attention', 'urgent')),
  title text NOT NULL,
  message text NOT NULL,
  action_label text,
  action_target text,
  dismissed boolean DEFAULT false,
  dismissed_at timestamptz,
  dismissed_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

ALTER TABLE coaching_nudges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "nudges_org_scope" ON coaching_nudges;
CREATE POLICY "nudges_org_scope" ON coaching_nudges
  FOR ALL
  USING (org_id = user_org_id())
  WITH CHECK (org_id = user_org_id());

CREATE INDEX IF NOT EXISTS idx_nudges_active ON coaching_nudges(deal_id, dismissed, expires_at) WHERE dismissed = false;
CREATE INDEX IF NOT EXISTS idx_nudges_type_deal ON coaching_nudges(deal_id, nudge_type) WHERE dismissed = false;
