-- One-shot back-fill: copy Sage canon gate criteria + must-haves from the template coach
-- into every non-template coach that's missing them. Mirrors the INSERT...SELECT pattern
-- in clone_coach_for_org v2 so behavior is identical. Idempotent via NOT EXISTS guards
-- (re-running is a no-op).
--
-- Context: gate criteria + must-haves were added in Phase 1, but clone_coach_for_org was
-- only extended to clone them in Phase 1.12. Any coach cloned before Phase 1.12 (i.e. every
-- existing org's coach when the build landed) needs this back-fill.

-- 1. Back-fill coach_gate_criteria for every non-template coach that has zero rows
INSERT INTO coach_gate_criteria (
  id, coach_id, dimension, criterion_key, criterion_title, criterion_description,
  criterion_anti_patterns, required_to_advance_from, required_to_advance_to,
  weight, sort_order, is_template, created_at
)
SELECT
  gen_random_uuid(),
  c.id,
  tmpl.dimension, tmpl.criterion_key, tmpl.criterion_title, tmpl.criterion_description,
  tmpl.criterion_anti_patterns, tmpl.required_to_advance_from, tmpl.required_to_advance_to,
  tmpl.weight, tmpl.sort_order, false, NOW()
FROM coaches c
CROSS JOIN coach_gate_criteria tmpl
WHERE c.is_template = false
  AND tmpl.coach_id = '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM coach_gate_criteria existing
    WHERE existing.coach_id = c.id
      AND existing.criterion_key = tmpl.criterion_key
      AND existing.required_to_advance_to = tmpl.required_to_advance_to
  );

-- 2. Back-fill coach_call_type_must_haves for every non-template coach that has zero rows
INSERT INTO coach_call_type_must_haves (
  id, coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template,
  team_role_required, sort_order, is_template, created_at
)
SELECT
  gen_random_uuid(),
  c.id,
  tmpl.call_type, tmpl.section, tmpl.must_have_type, tmpl.title, tmpl.description,
  tmpl.priority, tmpl.conditional_text, tmpl.workflow_kind, tmpl.workflow_due_hours, tmpl.workflow_template,
  tmpl.team_role_required, tmpl.sort_order, false, NOW()
FROM coaches c
CROSS JOIN coach_call_type_must_haves tmpl
WHERE c.is_template = false
  AND tmpl.coach_id = '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid
  AND NOT EXISTS (
    SELECT 1 FROM coach_call_type_must_haves existing
    WHERE existing.coach_id = c.id
      AND existing.call_type = tmpl.call_type
      AND existing.section = tmpl.section
      AND existing.title = tmpl.title
  );
