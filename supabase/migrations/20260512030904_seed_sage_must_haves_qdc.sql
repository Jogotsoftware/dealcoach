-- Phase 2.3 (1/5): QDC must-haves
INSERT INTO coach_call_type_must_haves (
  coach_id, call_type, section, must_have_type, title, description,
  priority, conditional_text, workflow_kind, workflow_due_hours, workflow_template, team_role_required,
  sort_order, is_template
) VALUES
-- QDC info_to_get (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Type of business / Rev Streams', 'Confirm the business model and what generates revenue. Look for industry, segments, and product/service mix.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'EE, Rev, & Entities', 'Employee count, revenue, and number of legal entities. Key for sizing and Intacct fit.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Top 3 Pains & Business Impacts', 'The top three operational pains with quantified business impact ($, time, capacity). Generic pains do not count.', 2, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Budget covered (users & context)', 'Budget discussion: do they have budget, what for, and how many users. Establishes financial viability.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'System to Replace & what we plan to keep', 'Current accounting/ERP system being replaced and any systems that stay (CRM, payroll, T&E).', 1, NULL, NULL, NULL, NULL, NULL, 5, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Potential Integrations', 'Other systems Intacct will integrate with (Salesforce, ADP, expense tools, banks). Identify integration scope.', 1, NULL, NULL, NULL, NULL, NULL, 6, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'What happens if we don''t make this change', 'The consequence-of-inaction. This is the compelling event signal — what breaks if they don''t act.', 1, NULL, NULL, NULL, NULL, NULL, 7, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Timing Considerations', 'Target timing: when do they want to be live, what events drive the date (year-end, audit, growth milestone).', 1, NULL, NULL, NULL, NULL, NULL, 8, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Personalities', 'Who is involved, what they care about, communication style. Identifies champion, EB, blockers.', 1, NULL, NULL, NULL, NULL, NULL, 9, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'info_to_get', 'extraction', 'Risks & Red Flags', 'Anything that could derail the deal: budget uncertainty, competitive bias, recent failed projects, decision-by-committee.', 1, NULL, NULL, NULL, NULL, NULL, 10, true),
-- QDC things_to_communicate (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'things_to_communicate', 'extraction', 'What we know of their business today', 'AE leads with research-informed perspective on the prospect''s business. Establishes credibility.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'things_to_communicate', 'extraction', 'SI for growing companies in their industry', 'Sage Intacct positioning for growing companies in their industry. Industry-specific narrative.', 1, NULL, NULL, NULL, NULL, NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'things_to_communicate', 'extraction', 'Customer story / case study', 'A relevant customer reference shared on the call. Adds proof.', 1, NULL, NULL, NULL, NULL, NULL, 3, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'things_to_communicate', 'extraction', 'MSP introduced', 'AE introduces the Mutual Success Plan concept and sets expectation it will be co-authored.', 1, NULL, NULL, NULL, NULL, NULL, 4, true),
-- QDC prior_to_call (extraction)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'prior_to_call', 'extraction', 'Inbound vs Outbound — approach differently if OB', 'AE adjusts approach based on whether deal is inbound or outbound-sourced.', 1, NULL, NULL, NULL, NULL, NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'prior_to_call', 'extraction', 'Bring on Ken Spelman if MFG/WD focused', 'If manufacturing or wholesale distribution, Ken Spelman attends. Industry SME.', 1, 'if MFG/WD', NULL, NULL, NULL, 'ken_spelman', 2, true),
-- QDC post_call (workflow)
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'post_call', 'workflow', 'Disposition QDC approval', 'Disposition the QDC in SFDC within 24 hours per Sage canon.', 1, NULL, 'reminder', 24, 'Disposition QDC approval within 24 hours per Sage canon', NULL, 1, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'post_call', 'workflow', 'If moving to FDC, Chatter Aleks/Maureen for SC assignment', 'Chatter Aleks and/or Maureen in SFDC to request SC assignment for the FDC.', 1, NULL, 'task', 48, 'Chatter Aleks and/or Maureen for SC assignment', NULL, 2, true),
('7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid, 'qdc', 'post_call', 'workflow', 'Forward notes & Chorus recording to SC', 'Forward QDC notes and Chorus recording to the assigned SC.', 1, NULL, 'task', 24, 'Forward notes & Chorus recording to SC', NULL, 3, true)
ON CONFLICT (coach_id, call_type, section, title) DO NOTHING;
