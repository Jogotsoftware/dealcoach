-- Phase 1.1: per-coach gate criteria catalog with anti-patterns column
CREATE TABLE IF NOT EXISTS coach_gate_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  dimension text NOT NULL CHECK (dimension IN ('need_fit', 'power', 'timeline', 'budget', 'hygiene')),
  criterion_key text NOT NULL,
  criterion_title text NOT NULL,
  criterion_description text,
  criterion_anti_patterns text[],
  required_to_advance_from text NOT NULL,
  required_to_advance_to text NOT NULL,
  weight numeric NOT NULL DEFAULT 1.0,
  sort_order integer NOT NULL DEFAULT 0,
  is_template boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(coach_id, criterion_key, required_to_advance_to)
);

ALTER TABLE coach_gate_criteria ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gate_criteria_read" ON coach_gate_criteria;
CREATE POLICY "gate_criteria_read" ON coach_gate_criteria
  FOR SELECT
  USING (
    coach_id IN (
      SELECT id FROM coaches
      WHERE org_id IS NULL OR org_id = user_org_id()
    )
  );

DROP POLICY IF EXISTS "gate_criteria_admin_write" ON coach_gate_criteria;
CREATE POLICY "gate_criteria_admin_write" ON coach_gate_criteria
  FOR ALL
  USING (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_gate_criteria_coach ON coach_gate_criteria(coach_id);
CREATE INDEX IF NOT EXISTS idx_gate_criteria_stage ON coach_gate_criteria(required_to_advance_to);
