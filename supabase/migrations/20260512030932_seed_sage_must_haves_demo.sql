-- Phase 2.3 (3/5): Demo must-haves
INSERT INTO coach_call_type_must_haves (
  coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template, team_role_required,
  sort_order, is_template
) VALUES
-- Demo prior_to_call (workflow + extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'prior_to_call', 'workflow', 'Email Attendees Agenda for buy-in', 'Email Demo attendees with an agenda at least 24 hours ahead for buy-in.', 1, NULL, 'task', 24, 'Email Demo attendees with agenda for buy-in (at least 24hrs ahead)', NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'prior_to_call', 'workflow', 'Send Consensus demos ahead of time', 'Send Consensus pre-demo content to attendees.', 1, NULL, 'task', 24, 'Send Consensus demos ahead of Demo call', NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'prior_to_call', 'extraction', 'Personalities reviewed', 'Review attendee personalities and what each will care about before walking in.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'prior_to_call', 'workflow', 'KT with SC/TSC to ensure team is on same page for roles', 'KT call with SC and TSC to confirm roles and handoffs during the Demo.', 1, NULL, 'task', 48, 'KT with SC/TSC: align on roles for Demo', NULL, 4, true),
-- Demo things_to_communicate (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'things_to_communicate', 'extraction', 'RECAP slide of their business, top challenges', 'Open Demo with a recap slide of their business and top challenges — shows we listened.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'things_to_communicate', 'extraction', 'Reiterate value and challenges throughout', 'Tie each demo flow back to a stated challenge or value driver throughout.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'things_to_communicate', 'extraction', 'Where do we go from here on MSP (planned kickoff, targeted go-live)', 'Discuss MSP next steps: planned kickoff and targeted go-live dates.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'things_to_communicate', 'extraction', 'What gets in way of implementation kickoff and signature', 'Surface blockers to kickoff and signature — legal, IT, security, procurement.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'things_to_communicate', 'extraction', 'Scoping Call and planned decision/closing date', 'Set up the Scoping call and confirm planned decision and closing dates.', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
-- Demo team_on_call (team_check)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'team_on_call', 'team_check', 'SC present', 'Solutions Consultant on the call.', 1, NULL, NULL, NULL, NULL, 'sc', 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'team_on_call', 'team_check', 'TSC present if integrations', 'Technical Solutions Consultant on the call when integrations are in scope.', 1, 'if integrations', NULL, NULL, NULL, 'tsc', 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'demo', 'team_on_call', 'team_check', 'Ken Spelman if WD or MFG', 'Ken Spelman on the call if wholesale distribution or manufacturing.', 1, 'if MFG/WD', NULL, NULL, NULL, 'ken_spelman', 3, true)
ON CONFLICT (coach_id, call_type, section, title) DO NOTHING;
