-- Phase 1.2: per-deal evaluation state for each gate criterion
-- State includes 'not_applicable' per design decision (reserved for future criteria;
-- MSP criteria at confirming_value still evaluate as 'open' on MSP-less deals).
CREATE TABLE IF NOT EXISTS deal_gate_criteria_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  criterion_id uuid NOT NULL REFERENCES coach_gate_criteria(id),
  state text NOT NULL CHECK (state IN ('met', 'partial', 'open', 'not_applicable')) DEFAULT 'open',
  evidence_quote text,
  source_conversation_id uuid REFERENCES conversations(id),
  source_speaker text,
  source_date date,
  suggested_action text,
  ai_generated boolean DEFAULT true,
  last_evaluated_at timestamptz DEFAULT now(),
  UNIQUE(deal_id, criterion_id)
);

ALTER TABLE deal_gate_criteria_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gate_state_org_scope" ON deal_gate_criteria_state;
CREATE POLICY "gate_state_org_scope" ON deal_gate_criteria_state
  FOR ALL
  USING (org_id = user_org_id())
  WITH CHECK (org_id = user_org_id());

CREATE INDEX IF NOT EXISTS idx_gate_state_deal ON deal_gate_criteria_state(deal_id);
CREATE INDEX IF NOT EXISTS idx_gate_state_open ON deal_gate_criteria_state(deal_id, state) WHERE state NOT IN ('met','not_applicable');
