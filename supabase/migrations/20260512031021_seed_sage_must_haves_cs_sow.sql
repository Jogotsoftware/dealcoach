-- Phase 2.3 (5/5): CS/SOW must-haves
INSERT INTO coach_call_type_must_haves (
  coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template, team_role_required,
  sort_order, is_template
) VALUES
-- CS/SOW kt_prior (workflow + extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'workflow', 'KT EMAIL TO WHOLE INTERNAL TEAM', 'Send KT email to the whole internal team ahead of CS/SOW call.', 2, NULL, 'task', 24, 'Send KT EMAIL to whole internal team ahead of CS/SOW call', NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'extraction', 'Confirm Phase 1 scope internally', 'Internal confirmation of Phase 1 scope before the call.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'extraction', 'Review SOW to ensure accuracy', 'Internal review of SOW for accuracy (modules, users, integrations, services, dates).', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'extraction', 'Timing Considerations', 'Carry forward — confirm timing.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'extraction', 'Personalities', 'Carry forward — personalities map.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'kt_prior', 'extraction', 'Risks & Red Flags', 'Carry forward — risks updated.', 1, NULL, NULL, NULL, NULL, NULL, 6, true),
-- CS/SOW info_to_get (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'info_to_get', 'extraction', 'Where do we go from here on MSP', 'Final MSP next steps to signature and kickoff.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'info_to_get', 'extraction', 'Reconfirm Planned kick-off & Go-Live', 'Reconfirm kickoff and go-live dates against compelling event.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'info_to_get', 'extraction', 'What gets in way of implementation kickoff and signature', 'Final blockers to kickoff and signature.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'info_to_get', 'extraction', 'Legal process / BOD review', 'Legal and BOD/committee process and ETAs.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'info_to_get', 'extraction', 'Signer email & PTO', 'Signer name, email, title, and availability/PTO.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
-- CS/SOW team_on_call (team_check)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'team_on_call', 'team_check', 'RVP present', 'Regional VP on the call.', 1, NULL, NULL, NULL, NULL, 'rvp', 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'team_on_call', 'team_check', 'Robert Acks or PS Partner', 'PS Partner (Robert Acks or equivalent) on the call.', 1, NULL, NULL, NULL, NULL, 'ps_partner', 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'team_on_call', 'team_check', 'SC if needed', 'Solutions Consultant on the call if needed.', 1, 'if needed', NULL, NULL, NULL, 'sc', 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'cs_sow', 'team_on_call', 'team_check', 'TSC if integrations', 'Technical Solutions Consultant on the call when integrations are in scope.', 1, 'if integrations', NULL, NULL, NULL, 'tsc', 4, true)
ON CONFLICT (coach_id, call_type, section, title) DO NOTHING;
