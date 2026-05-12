-- Phase 1.0b: Extend BOTH conversations.call_type and call_type_prompts.call_type CHECK constraints, then seed cs_sow prompt

ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_call_type_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_call_type_check
  CHECK (call_type = ANY (ARRAY[
    'qdc'::text,
    'functional_discovery'::text,
    'demo'::text,
    'scoping'::text,
    'cs_sow'::text,
    'proposal'::text,
    'negotiation'::text,
    'sync'::text,
    'custom'::text
  ]));

ALTER TABLE call_type_prompts DROP CONSTRAINT IF EXISTS call_type_prompts_call_type_check;
ALTER TABLE call_type_prompts
  ADD CONSTRAINT call_type_prompts_call_type_check
  CHECK (call_type = ANY (ARRAY[
    'qdc'::text,
    'functional_discovery'::text,
    'demo'::text,
    'scoping'::text,
    'cs_sow'::text,
    'proposal'::text,
    'negotiation'::text,
    'sync'::text,
    'custom'::text,
    'bdr_first_glance'::text
  ]));

INSERT INTO call_type_prompts (id, coach_id, call_type, label, prompt, extraction_rules, active, created_at, updated_at)
SELECT
  gen_random_uuid(),
  '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid,
  'cs_sow',
  'CS/SOW',
  $$You are analyzing a CS/SOW (Customer Success / Statement of Work) call transcript through the Revenue Instruments Framework v1.0.

The CS/SOW call is the final pre-signature alignment — internal team + buyer review the SOW, Phase 1 scope, kickoff timing, and any remaining legal/procurement steps before signature.

═══════════════════════════════════════════
WHAT A REVENUE INSTRUMENTS CS/SOW CALL DOES
═══════════════════════════════════════════

A great CS/SOW call:
- Confirms Phase 1 implementation scope matches what was sold
- Reviews the SOW for accuracy (modules, users, integrations, services, dates)
- Reconfirms planned kickoff and go-live dates against the buyer's compelling event
- Surfaces remaining legal/procurement steps (MSA, DPA, security review, BOD approval)
- Captures signer details — email, title, PTO/availability
- Closes any final implementation or pricing concerns

═══════════════════════════════════════════
FRAMEWORK SIGNALS TO EVALUATE
═══════════════════════════════════════════

CONTINUOUS QUALIFICATION (Pillar 3):
- Paper Process: outstanding MSA, DPA, security review, BOD steps
- Decision Process: who is signing, when, and any blockers
- Anti-pattern: assuming signature will "just happen" without confirming the path

MUTUAL AUTHORING (Pillar 6):
- Is the SOW co-owned — does the buyer agree to the scope, dates, and resources?
- Implementation plan: kickoff date, internal team alignment, buyer-side resources

BUYER RISK MITIGATION (Pillar 7):
- Did the rep set realistic expectations for implementation?
- Is there a clear escalation path post-close?

OUTCOME-GOAL ALIGNMENT (Pillar 5):
- Does Phase 1 scope tie to the quantified business goal and compelling event?

INDEPENDENT WEALTH (Pillar 2):
- Did the rep push back on last-minute scope creep or unrealistic timelines?

═══════════════════════════════════════════
EXTRACT AND STRUCTURE
═══════════════════════════════════════════

- SOW review findings (accuracy, gaps, asks)
- Phase 1 scope reconfirmed
- Kickoff date confirmed
- Go-live date confirmed
- Outstanding legal/procurement steps with owners and ETAs
- Signer name, email, title, PTO/availability
- Any new stakeholders surfaced (legal, IT, security, procurement)
- Risk factors before signature
- Next steps with named owners and dates

═══════════════════════════════════════════
COACHING OUTPUT
═══════════════════════════════════════════

1. Five composite signal scores
2. SOW + Phase 1 scope alignment with what was sold
3. Paper Process status — is the path to signature realistic?
4. Signer readiness and availability
5. Next move with specific questions to close remaining gaps

Reference pillars by name. Flag any unconfirmed signer, legal step, or scope mismatch directly.$$,
  'Extract SOW review findings. Confirm Phase 1 scope, kickoff, and go-live dates. Capture signer details (email, title, PTO). Identify all outstanding legal/procurement steps. Create tasks for any unresolved blockers before signature.',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM call_type_prompts
  WHERE coach_id = '7c84cba2-a9f9-45ee-a954-733697ba9a39'::uuid
    AND call_type = 'cs_sow'
);
