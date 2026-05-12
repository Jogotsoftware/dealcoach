-- Phase 2.3 (2/5): FDC (functional_discovery) must-haves
INSERT INTO coach_call_type_must_haves (
  coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template, team_role_required,
  sort_order, is_template
) VALUES
-- FDC kt_prior (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Type of business / Rev Streams', 'Carry forward from QDC — confirm and refresh.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'EE, Rev, & Entities', 'Carry forward from QDC — confirm and refresh.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Budget covered', 'Carry forward from QDC — confirm budget context.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Top 3 Pains & Business Impacts', 'Carry forward from QDC — go deeper on each pain.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'System to Replace & what we plan to keep', 'Carry forward from QDC — confirm.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Potential Integrations', 'Carry forward from QDC — refine integration scope.', 1, NULL, NULL, NULL, NULL, NULL, 6, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Timing Considerations', 'Carry forward from QDC — refine timeline.', 1, NULL, NULL, NULL, NULL, NULL, 7, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Personalities', 'Carry forward from QDC — update stakeholder map.', 1, NULL, NULL, NULL, NULL, NULL, 8, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'kt_prior', 'extraction', 'Risks & Red Flags', 'Carry forward from QDC — update.', 1, NULL, NULL, NULL, NULL, NULL, 9, true),
-- FDC info_to_get (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'info_to_get', 'extraction', 'Key Reports they can''t live without', 'The specific reports the prospect must have. Drives module + integration scope.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'info_to_get', 'extraction', 'Budget, users, modules, integrations confirmed', 'Lock in the scope: budget, user count, modules, and integrations needed for Demo and Scoping.', 2, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'info_to_get', 'extraction', 'Who will be on Demo and what they/CEO/CFO will care about', 'Confirm Demo attendees and what each stakeholder will evaluate Intacct on.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'info_to_get', 'extraction', 'Confirm with SC if ok to book demo', 'Internal: confirm with SC that scope is clear enough to book the Demo.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
-- FDC team_on_call (team_check)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'team_on_call', 'team_check', 'SC present', 'Solutions Consultant on the call.', 1, NULL, NULL, NULL, NULL, 'sc', 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'team_on_call', 'team_check', 'TSC present if integrations', 'Technical Solutions Consultant on the call when integrations are in scope.', 1, 'if integrations', NULL, NULL, NULL, 'tsc', 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'team_on_call', 'team_check', 'Ken Spelman if WD or MFG', 'Ken Spelman on the call if wholesale distribution or manufacturing.', 1, 'if MFG/WD', NULL, NULL, NULL, 'ken_spelman', 3, true),
-- FDC post_call (workflow)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'post_call', 'workflow', 'Debrief with SC/TSC and confirm modules, integrations, 3rd-party solutions', 'Debrief with the SC and TSC to confirm modules, integrations, and any 3rd-party solutions before Demo.', 1, NULL, 'task', 24, 'Debrief with SC/TSC: confirm modules, integrations, 3rd-party solutions', NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'functional_discovery', 'post_call', 'workflow', 'Send Consensus demos ahead of time (add SC to notifications)', 'Send Consensus pre-demo content to attendees and add SC to notification list.', 1, NULL, 'task', 48, 'Send Consensus demos ahead of Demo call; add SC to notifications', NULL, 2, true)
ON CONFLICT (coach_id, call_type, section, title) DO NOTHING;
