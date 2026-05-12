-- Phase 1.6: per-call must-have coverage from process-transcript extraction
CREATE TABLE IF NOT EXISTS conversation_must_have_coverage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  must_have_id uuid NOT NULL REFERENCES coach_call_type_must_haves(id),
  coverage_state text NOT NULL CHECK (coverage_state IN ('covered', 'partial', 'missed', 'not_applicable')),
  evidence_quote text,
  evidence_speaker text,
  ai_confidence numeric,
  evaluated_at timestamptz DEFAULT now(),
  UNIQUE(conversation_id, must_have_id)
);

ALTER TABLE conversation_must_have_coverage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage_org_scope" ON conversation_must_have_coverage;
CREATE POLICY "coverage_org_scope" ON conversation_must_have_coverage
  FOR ALL
  USING (org_id = user_org_id())
  WITH CHECK (org_id = user_org_id());

CREATE INDEX IF NOT EXISTS idx_coverage_conversation ON conversation_must_have_coverage(conversation_id);
CREATE INDEX IF NOT EXISTS idx_coverage_deal_must_have ON conversation_must_have_coverage(deal_id, must_have_id);
