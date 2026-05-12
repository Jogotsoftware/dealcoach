-- Phase 2.3 (4/5): Scoping must-haves
INSERT INTO coach_call_type_must_haves (
  coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template, team_role_required,
  sort_order, is_template
) VALUES
-- Scoping kt_prior (workflow + extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'workflow', 'KT EMAIL TO PS TEAM', 'Send KT email to PS Team ahead of Scoping call.', 2, NULL, 'task', 24, 'Send KT EMAIL to PS Team ahead of Scoping call', NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Type of business / Rev Streams', 'Carry forward from FDC — confirm.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'EE, Rev, & Entities', 'Carry forward from FDC — confirm.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Users, types of users, modules, volumes', 'Specific user counts, types of users, modules, and transaction volumes for PS scoping.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'System to replace & Key Reports needed', 'Carry forward — confirm replacement system and key reports.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Potential Integrations & Phase 2', 'Integrations confirmed for Phase 1 and Phase 2.', 1, NULL, NULL, NULL, NULL, NULL, 6, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Timing Considerations', 'Carry forward — timeline locked.', 1, NULL, NULL, NULL, NULL, NULL, 7, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Personalities & HQ', 'Personalities updated and HQ location confirmed.', 1, NULL, NULL, NULL, NULL, NULL, 8, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'kt_prior', 'extraction', 'Risks, Red Flags, things to still uncover', 'Risks updated; anything still unknown going into PS scoping.', 1, NULL, NULL, NULL, NULL, NULL, 9, true),
-- Scoping info_to_get (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'RECAP slide on why we are here', 'Open with a recap slide on why we are at scoping.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'Confirm Modules, Users, volumes, integrations before PS Scope', 'Final scope confirmation before PS builds the SOW.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'Where do we go from here on MSP', 'MSP next steps from scoping forward.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'What gets in way of implementation kickoff and signature', 'Surface kickoff and signature blockers.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'Closing strong and planned decision/closing date', 'Close strong; confirm decision and closing dates.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'Confirm Address, company name, admin, signer, signer contact info', 'Contracting details: legal entity name, address, admin contact, signer info.', 1, NULL, NULL, NULL, NULL, NULL, 6, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'info_to_get', 'extraction', 'Legal process / BOD review', 'Legal process and any BOD or committee approvals required.', 1, NULL, NULL, NULL, NULL, NULL, 7, true),
-- Scoping team_on_call (team_check)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'team_on_call', 'team_check', 'SC (KT only)', 'Solutions Consultant in KT only (does not need to attend the scoping call itself).', 1, NULL, NULL, NULL, NULL, 'sc', 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'team_on_call', 'team_check', 'TSC if integrations', 'Technical Solutions Consultant on the call when integrations are in scope.', 1, 'if integrations', NULL, NULL, NULL, 'tsc', 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'team_on_call', 'team_check', 'Ken Spelman if WD or MFG', 'Ken Spelman on the call if wholesale distribution or manufacturing.', 1, 'if MFG/WD', NULL, NULL, NULL, 'ken_spelman', 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'scoping', 'team_on_call', 'team_check', 'Robert Acks or PS Partner', 'PS Partner (Robert Acks or equivalent) on the call.', 1, NULL, NULL, NULL, NULL, 'ps_partner', 4, true)
ON CONFLICT (coach_id, call_type, section, title) DO NOTHING;
