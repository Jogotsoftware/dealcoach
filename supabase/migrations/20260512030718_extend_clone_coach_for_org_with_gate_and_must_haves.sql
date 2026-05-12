-- Phase 1.12: extend clone_coach_for_org to clone coach_gate_criteria and coach_call_type_must_haves
-- v2: now also clones gate criteria + must-haves alongside coach row, prompts, scoring, email templates, docs, field configs, ICP
CREATE OR REPLACE FUNCTION public.clone_coach_for_org(
  p_template_coach_id uuid,
  p_target_org_id uuid,
  p_product_context text DEFAULT NULL::text,
  p_industry_context text DEFAULT NULL::text,
  p_coach_name text DEFAULT NULL::text,
  p_created_by uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_new_coach_id uuid := gen_random_uuid();
  v_template RECORD;
  v_creator uuid;
BEGIN
  v_creator := COALESCE(p_created_by, auth.uid());

  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'clone_coach_for_org requires authentication or p_created_by';
  END IF;

  SELECT * INTO v_template FROM coaches WHERE id = p_template_coach_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template coach % not found', p_template_coach_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM organizations WHERE id = p_target_org_id) THEN
    RAISE EXCEPTION 'Target org % not found', p_target_org_id;
  END IF;

  -- 1. Clone the coach row
  INSERT INTO coaches (
    id, name, description, system_prompt, extraction_rules, research_prompt,
    model, temperature, active, created_by, org_id, is_template,
    research_mode, product_context, industry_context, research_prompts,
    selected_methodology_addons, coaching_style, coaching_style_notes,
    value_propositions, competitor_context, general_notes, call_type_definitions,
    created_at, updated_at
  ) VALUES (
    v_new_coach_id,
    COALESCE(p_coach_name, v_template.name),
    v_template.description,
    v_template.system_prompt,
    v_template.extraction_rules,
    v_template.research_prompt,
    v_template.model,
    v_template.temperature,
    true,
    v_creator,
    p_target_org_id,
    false,
    v_template.research_mode,
    COALESCE(p_product_context, v_template.product_context),
    COALESCE(p_industry_context, v_template.industry_context),
    v_template.research_prompts,
    v_template.selected_methodology_addons,
    v_template.coaching_style,
    v_template.coaching_style_notes,
    v_template.value_propositions,
    v_template.competitor_context,
    v_template.general_notes,
    v_template.call_type_definitions,
    NOW(),
    NOW()
  );

  -- 2. Clone call_type_prompts
  INSERT INTO call_type_prompts (id, coach_id, call_type, label, prompt, extraction_rules, active, created_at, updated_at)
  SELECT gen_random_uuid(), v_new_coach_id, call_type, label, prompt, extraction_rules, active, NOW(), NOW()
  FROM call_type_prompts WHERE coach_id = p_template_coach_id;

  -- 3. Clone scoring_configs
  INSERT INTO scoring_configs (id, coach_id, score_type, label, criteria, max_score, description, active, created_at)
  SELECT gen_random_uuid(), v_new_coach_id, score_type, label, criteria, max_score, description, active, NOW()
  FROM scoring_configs WHERE coach_id = p_template_coach_id;

  -- 4. Clone email_templates
  INSERT INTO email_templates (
    id, coach_id, name, email_type, description, subject_template, body_template,
    ai_instructions, recipient_type, default_recipients,
    include_pain_points, include_contacts, include_competition, include_deal_analysis,
    include_company_profile, include_transcripts, include_tasks, include_scores, include_msp,
    sort_order, active, created_at, updated_at
  )
  SELECT
    gen_random_uuid(), v_new_coach_id, name, email_type, description, subject_template, body_template,
    ai_instructions, recipient_type, default_recipients,
    include_pain_points, include_contacts, include_competition, include_deal_analysis,
    include_company_profile, include_transcripts, include_tasks, include_scores, include_msp,
    sort_order, active, NOW(), NOW()
  FROM email_templates WHERE coach_id = p_template_coach_id;

  -- 5. Clone coach_documents
  INSERT INTO coach_documents (id, coach_id, name, doc_type, content, active, created_at, updated_at)
  SELECT gen_random_uuid(), v_new_coach_id, name, doc_type, content, active, NOW(), NOW()
  FROM coach_documents WHERE coach_id = p_template_coach_id;

  -- 6. Clone analysis_field_configs
  INSERT INTO analysis_field_configs (id, coach_id, field_name, field_type, field_options, sort_order, active, created_at)
  SELECT gen_random_uuid(), v_new_coach_id, field_name, field_type, field_options, sort_order, active, NOW()
  FROM analysis_field_configs WHERE coach_id = p_template_coach_id;

  -- 7. Clone coach_icp
  INSERT INTO coach_icp (
    id, coach_id, name, active, industries, geographies,
    revenue_min, revenue_max, employee_min, employee_max,
    entity_count_min, entity_count_max,
    current_systems, tech_red_flags, buying_signals, disqualifiers,
    personas, green_flags, red_flags, functional_green_flags, functional_red_flags,
    weight_industry, weight_revenue, weight_employees, weight_entities,
    weight_current_system, weight_buying_signals,
    created_at, updated_at
  )
  SELECT
    gen_random_uuid(), v_new_coach_id, name, active, industries, geographies,
    revenue_min, revenue_max, employee_min, employee_max,
    entity_count_min, entity_count_max,
    current_systems, tech_red_flags, buying_signals, disqualifiers,
    personas, green_flags, red_flags, functional_green_flags, functional_red_flags,
    weight_industry, weight_revenue, weight_employees, weight_entities,
    weight_current_system, weight_buying_signals,
    NOW(), NOW()
  FROM coach_icp WHERE coach_id = p_template_coach_id;

  -- 8. v2: Clone coach_gate_criteria (Sage canon Path to Close gates)
  INSERT INTO coach_gate_criteria (
    id, coach_id, dimension, criterion_key, criterion_title, criterion_description,
    criterion_anti_patterns, required_to_advance_from, required_to_advance_to,
    weight, sort_order, is_template, created_at
  )
  SELECT
    gen_random_uuid(), v_new_coach_id, dimension, criterion_key, criterion_title, criterion_description,
    criterion_anti_patterns, required_to_advance_from, required_to_advance_to,
    weight, sort_order, false, NOW()
  FROM coach_gate_criteria WHERE coach_id = p_template_coach_id;

  -- 9. v2: Clone coach_call_type_must_haves (Sage canon call playbooks)
  INSERT INTO coach_call_type_must_haves (
    id, coach_id, call_type, section, must_have_type, title, description,
    priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template,
    team_role_required, sort_order, is_template, created_at
  )
  SELECT
    gen_random_uuid(), v_new_coach_id, call_type, section, must_have_type, title, description,
    priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template,
    team_role_required, sort_order, false, NOW()
  FROM coach_call_type_must_haves WHERE coach_id = p_template_coach_id;

  RETURN v_new_coach_id;
END;
$function$;
