-- Phase 2.2: Seed 14 Sage canon gate criteria for confirming_value -> selection on the template coach
-- coach_id is Sage Intacct - General Business (formerly Revenue Instruments Coach Template)

INSERT INTO coach_gate_criteria (
  coach_id, dimension, criterion_key, criterion_title, criterion_description,
  criterion_anti_patterns, required_to_advance_from, required_to_advance_to,
  weight, sort_order, is_template
) VALUES
-- need_fit (3)
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'need_fit',
  'why_switch',
  'Why switch to Intacct documented',
  'The prospect has clearly articulated why they need to switch from their current system to Sage Intacct. The reasons are specific, quantified where possible, and tied to business outcomes — not generic "we want better reporting."',
  ARRAY[
    'Reasons given are generic ("better reporting", "newer tech") with no specific business impact',
    'AE described the reasons; the prospect never confirmed them in their own words',
    'No quantified pain (no $, hours, headcount, or growth target attached)',
    'Reasons are aspirational but the current system technically works fine'
  ],
  'confirming_value', 'selection', 7, 1, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'need_fit',
  'functional_fit',
  'Functional fit confirmed',
  'Sage Intacct can deliver the modules, workflows, and reports the prospect has identified as required. Gaps (if any) have been surfaced and acknowledged by both sides, with a path for handling them (Phase 2, integration, or accepted gap).',
  ARRAY[
    'Required modules/features not validated in a demo or scoping call',
    'Known functional gaps exist but have been hand-waved without a plan',
    'Prospect has not seen Intacct do the specific workflows they care about most',
    'SC has not confirmed feasibility for the requested integrations or customizations'
  ],
  'confirming_value', 'selection', 7, 2, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'need_fit',
  'competitor_differentiation',
  'Differentiation vs competitors articulated',
  'The prospect understands why Sage Intacct is the right choice over the alternative(s) they are evaluating. Differentiation is on their evaluation criteria, not generic feature comparisons.',
  ARRAY[
    'AE has not asked who else is being evaluated',
    'Differentiation is generic ("we have great support") and not tied to prospect priorities',
    'Prospect cannot articulate, in their own words, what makes Intacct different',
    'No clear competitive position — deal is treated as if it is uncontested'
  ],
  'confirming_value', 'selection', 6, 3, true
),
-- power (4)
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'power',
  'buying_process_mapped',
  'Buying process mapped',
  'The prospect''s buying process is documented: who is involved, what each stakeholder needs, what approval steps exist (legal, security, procurement, BOD), and what order they happen in.',
  ARRAY[
    'No documented list of stakeholders beyond the champion',
    'Legal / procurement / security steps not yet identified',
    'Champion has not confirmed the process — AE is guessing based on company size',
    'Approval chain is described vaguely ("the CFO will sign off") without names or sequence'
  ],
  'confirming_value', 'selection', 6, 4, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'power',
  'eb_engaged',
  'Economic buyer engaged on a call',
  'The Economic Buyer has personally been on at least one Lumen call (Demo, Scoping, or executive alignment). They have heard the pitch in their own words and asked their own questions. Email-only is NOT engagement.',
  ARRAY[
    'Champion confirms EB is engaged but EB has not been on any Lumen call',
    'EB included on email thread but never spoke',
    'AE met EB at an event but no formal sales conversation took place',
    'EB attended but did not ask questions or participate substantively'
  ],
  'confirming_value', 'selection', 7, 5, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'power',
  'criteria_validated_eb',
  'Decision criteria validated with EB',
  'The Economic Buyer has personally confirmed the decision criteria — what they will evaluate Intacct on and what would make them pick another path. Criteria are not just what the champion thinks the EB cares about.',
  ARRAY[
    'Decision criteria are inferred from champion, not confirmed by EB',
    'Criteria are vague ("ROI", "ease of use") with no measurable thresholds',
    'EB has not been asked directly what would make this a "no" for them',
    'Champion''s priorities and EB''s priorities have not been reconciled'
  ],
  'confirming_value', 'selection', 6, 6, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'power',
  'exec_alignment',
  'RVP/AVP-level executive alignment',
  'Internal Sage leadership (RVP or AVP) has been engaged on this deal — briefed, aligned to strategy, and prepared to participate in executive-to-executive conversations if needed.',
  ARRAY[
    'No RVP/AVP has heard about this deal',
    'Manager-of-AE is aware but no exec-level relationship-building has happened',
    'Exec sponsorship is assumed but not confirmed with a named exec on the deal',
    'No exec from Sage has met any exec from the prospect'
  ],
  'confirming_value', 'selection', 6, 7, true
),
-- timeline (3)
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'timeline',
  'compelling_event',
  'Compelling event documented',
  'A specific, dated, material bad-thing-that-happens-if-they-don''t-act is documented for this deal. Generic "want to grow" or "thinking about it" do not qualify. The CE must be tied to a date and a quantified consequence.',
  ARRAY[
    'No compelling_events row exists for this deal',
    'Documented CE has no quantified impact ($, time, capacity)',
    'CE has not been reconfirmed by buyer on a call in the last 30 days',
    'Recent transcripts contain hedge language like "we''ll get to it" or "no real rush"',
    '"Want to upgrade systems" listed as a CE — too vague to count'
  ],
  'confirming_value', 'selection', 7, 8, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'timeline',
  'decision_signature_dates',
  'Decision and signature dates established',
  'The prospect has committed to a target decision date AND a target signature date. Dates are specific (not "by end of quarter") and account for the buying process steps already mapped.',
  ARRAY[
    'Only a vague "decision sometime this quarter" — no specific date',
    'Decision date exists but signature date is open-ended',
    'Dates are AE''s wishful thinking, not prospect-confirmed',
    'Dates ignore known process steps (legal review, BOD, security review)'
  ],
  'confirming_value', 'selection', 7, 9, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'timeline',
  'backed_into_golive',
  'Timeline backed into from go-live',
  'The decision and signature dates were derived by working backward from a target go-live date — accounting for implementation duration, kickoff lead time, signature/paperwork lead time, and the prospect''s compelling event.',
  ARRAY[
    'Go-live date is unstated or undefined',
    'Signature date and go-live are disconnected — no math between them',
    'Implementation timeline assumes a kickoff faster than realistic for the scope',
    'Compelling event is after the go-live date — the timeline doesn''t actually solve the problem'
  ],
  'confirming_value', 'selection', 6, 10, true
),
-- budget (2)
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'budget',
  'budget_allocated',
  'Budget allocation confirmed',
  'Budget for Sage Intacct is allocated or in the process of being allocated. The amount, source (department, CapEx, OpEx), and approval status are documented.',
  ARRAY[
    'Budget is "being figured out" — no source identified',
    'Champion says "we have budget" but cannot name the amount or source',
    'Budget exists for "software" generically but not earmarked for Intacct or ERP',
    'No conversation with finance has happened yet'
  ],
  'confirming_value', 'selection', 8, 11, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'budget',
  'price_expectations',
  'Price expectations surfaced',
  'The prospect''s price expectation has been surfaced and discussed. They know the ballpark range Intacct falls in, and any gap between expectation and reality has been addressed before formal pricing is delivered.',
  ARRAY[
    'AE has never asked about budget expectations',
    'First time prospect sees pricing is in the formal proposal',
    'Known gap exists between expectation and likely quote, but no conversation has happened',
    'Prospect expectation is anchored to a competitor''s pricing without context'
  ],
  'confirming_value', 'selection', 7, 12, true
),
-- hygiene (2)
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'hygiene',
  'msp_active',
  'MSP active with prospect',
  'An MSP (Mutual Success Plan) is active on this deal — populated with stages, dates, and the buying process steps. It exists as a working artifact, not just a placeholder.',
  ARRAY[
    'No MSP exists on this deal',
    'MSP exists but is empty or only has default template stages',
    'MSP exists but is not in the customer portal — only internal',
    'MSP has not been updated since deal entered confirming_value'
  ],
  'confirming_value', 'selection', 5, 13, true
),
(
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'hygiene',
  'msp_agreed',
  'MSP formally agreed by prospect',
  'The MSP has been formally agreed to by the prospect — the AE walked them through it, they confirmed the steps and dates, and prospect_agreed_flag is set on the customer portal.',
  ARRAY[
    'MSP exists but prospect has never seen it',
    'AE walked through it but prospect never confirmed agreement explicitly',
    'Prospect agreement is verbal and not recorded as agreed in the portal',
    'MSP changes happened after agreement and were not re-confirmed'
  ],
  'confirming_value', 'selection', 5, 14, true
)
ON CONFLICT (coach_id, criterion_key, required_to_advance_to) DO NOTHING;
