-- Phase 1.5: Sage canon call playbooks per coach
CREATE TABLE IF NOT EXISTS coach_call_type_must_haves (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id uuid NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  call_type text NOT NULL,
  section text NOT NULL,
  must_have_type text NOT NULL CHECK (must_have_type IN ('extraction', 'workflow', 'team_check')),
  title text NOT NULL,
  description text,
  priority integer NOT NULL DEFAULT 1,
  conditional_text text,
  workflow_kind text CHECK (workflow_kind IN ('reminder', 'task') OR workflow_kind IS NULL),
  workflow_due_hours integer,
  workflow_template text,
  team_role_required text,
  sort_order integer NOT NULL DEFAULT 0,
  is_template boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(coach_id, call_type, section, title)
);

ALTER TABLE coach_call_type_must_haves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "must_haves_read" ON coach_call_type_must_haves;
CREATE POLICY "must_haves_read" ON coach_call_type_must_haves
  FOR SELECT
  USING (
    coach_id IN (
      SELECT id FROM coaches
      WHERE org_id IS NULL OR org_id = user_org_id()
    )
  );

DROP POLICY IF EXISTS "must_haves_admin_write" ON coach_call_type_must_haves;
CREATE POLICY "must_haves_admin_write" ON coach_call_type_must_haves
  FOR ALL
  USING (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_must_haves_coach_calltype ON coach_call_type_must_haves(coach_id, call_type);
