# Lumen — BDR Submission & Deal Routing Build Spec

**Status:** Ready for Claude Code execution
**Scope:** Replace the current `bdr_leads → promote-to-dealcoach (post-QDC)` lifecycle with a `bdr_leads → AI first-glance → route-lead (deal created at routing)` lifecycle.
**Pre-flight required:** Yes — see Section 0 before touching anything.

---

## 0. Pre-flight audit (DO THIS FIRST)

Before any migration or code change, verify the current state. Run and capture output:

### 0.1 — Find all callers of `promote-to-dealcoach`

```bash
# In repo root
grep -rn "promote-to-dealcoach" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx" --include="*.sql" --include="*.md" .
```

In Supabase MCP, also check:
- `list_edge_functions` — confirm `promote-to-dealcoach` is currently deployed
- Search edge function source for any cross-calls: `grep "promote-to-dealcoach"` inside other edge function code
- Check DB triggers: `SELECT trigger_name, event_object_table FROM information_schema.triggers WHERE action_statement ILIKE '%promote-to-dealcoach%';`

Document every reference. Removal happens only after `route-lead` rewrite is verified end-to-end.

### 0.2 — Inspect current schema

Use Supabase MCP `list_tables` + `execute_sql` to capture current shape of:
- `bdr_leads` (every column + type + nullable)
- `bdr_notes` (does it exist? — likely no, this is new)
- `routing_rules` (every column)
- `routing_pools` (does it exist?)
- `routing_pool_members` (does it exist?)
- `bdr_handoff_feedback` (every column — needed for post-QDC disqualification writeback)
- `ae_denial_criteria` (does it exist? — this is new)
- `deals` — confirm presence/absence of `bdr_lead_id` column
- `im_rejection_reasons` (48 seeded — confirm count + structure)

Capture in a markdown table at the top of the migration file for traceability.

### 0.3 — Current edge function code

Use `get_edge_function` to pull current source for:
- `process-bdr-submission`
- `pre-qdc-decision`
- `route-lead`
- `promote-to-dealcoach`
- `research-lead-company`
- `process-transcript`

Read before modifying. We're rewriting `pre-qdc-decision` and `route-lead`. Everything else should remain compatible.

---

## 1. Data model

> **2026-05-11 decisions folded in.** Spec was updated to match the path approved at M0:
> - Column name is `stage` (not `status`); enum is the spec set only (legacy old-flow values dropped — 0 rows).
> - `revenue` (numeric) renamed to `annual_revenue` (bigint).
> - `state` renamed to `hq_state`.
> - **No `conversation_id` column** — `bdr_leads.transcript` (existing column) is the pre-routing transcript source; `conversations` row is created at route-lead time linked to the new deal.
> - `routing_rules` and `bdr_handoff_feedback` restructure (drop legacy, add spec) — clean since both are 0 rows.
> - Audio Mode A dropped (Coming soon tab). See §2.2.
> - `pre-qdc-decision` uses `assemble_coach_prompt` RPC. See §3.

### 1.1 — `bdr_leads` (modify in place — rename + extend)

Final column set after M1:

| column | type | notes |
|---|---|---|
| `id` | uuid PK | existing |
| `org_id` | uuid FK organizations | existing, RLS scope |
| `bdr_id` | uuid FK profiles | existing |
| `stage` | text | extended CHECK: `submitted`, `awaiting_transcript`, `ai_reviewing`, `denied`, `routed`, `disqualified_post_qdc` (legacy values dropped — 0 rows) |
| `company_name` | text NOT NULL | existing |
| `website` | text | existing — URL-validated client-side |
| `employee_count` | integer | existing |
| `tech_stack` | text[] | existing, default `'{}'` |
| `annual_revenue` | bigint | **rename from `revenue` (numeric → bigint)** |
| `num_entities` | integer | existing |
| `accounting_team_size` | integer | NEW |
| `industry` | text | NEW |
| `vertical` | text | existing — from coach-configured vertical list |
| `hq_state` | text | **rename from `state`** |
| `transcript` | text | existing — canonical pre-routing transcript source (Mode B paste, Mode C extracted text) |
| `ai_decision` | text | NEW — `pending` \| `approved` \| `denied` |
| `ai_decision_reason` | text | NEW — actionable BDR feedback if denied |
| `ai_decision_criteria_triggered` | text[] | NEW — which denial criteria fired |
| `ai_decision_at` | timestamptz | NEW |
| `routed_to_ae_id` | uuid FK profiles | NEW |
| `routed_at` | timestamptz | NEW |
| `deal_id` | uuid FK deals | NEW — populated at routing time |
| `created_at`, `updated_at` | timestamptz | existing |

Legacy columns kept for now (used by deprecated edge functions until M10 cleanup): `primary_contact_*`, `hypothesis`, `evaluation_drivers`, `bant_*`, `recent_news`, `intent_signals`, `lead_source`, `pre_qdc_score`, `pre_qdc_recommendation`, `im_meeting_id`, `notes`. Drop in a follow-up cleanup migration after pilot stability.

The `trg_bdr_leads_snapshot_stage` UPDATE trigger writes stage transitions to `bdr_stage_history` — preserved.

### 1.2 — `bdr_notes` (new)

```sql
CREATE TABLE IF NOT EXISTS bdr_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES bdr_leads(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  note_type text NOT NULL DEFAULT 'bant'
    CHECK (note_type IN ('bant','followup','disqualification_context','general')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bdr_notes_lead_id ON bdr_notes(lead_id);
CREATE INDEX idx_bdr_notes_org_id ON bdr_notes(org_id);

ALTER TABLE bdr_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY bdr_notes_org_select ON bdr_notes
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY bdr_notes_creator_insert ON bdr_notes
  FOR INSERT WITH CHECK (
    org_id = (SELECT org_id FROM profiles WHERE id = auth.uid())
    AND created_by = auth.uid()
  );
CREATE POLICY bdr_notes_creator_update ON bdr_notes
  FOR UPDATE USING (created_by = auth.uid());
```

### 1.3 — `ae_denial_criteria` (new)

```sql
CREATE TABLE IF NOT EXISTS ae_denial_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  created_by uuid NOT NULL REFERENCES profiles(id),
  description text NOT NULL,            -- human-readable, shown to BDR if triggered
  ai_guidance text,                     -- fed into the pre-qdc-decision prompt
  structured_rule jsonb,                -- nullable; reserved for future hard filters
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ae_denial_criteria_org_active ON ae_denial_criteria(org_id, active);

ALTER TABLE ae_denial_criteria ENABLE ROW LEVEL SECURITY;

-- Helper function (create if not present)
-- v1: 'manager' role grants AE manager permissions. Refine when explicit ae_manager role is introduced.
-- system_admin is NOT here — that path goes through is_platform_admin() against the platform_admins table.
CREATE OR REPLACE FUNCTION is_ae_manager(check_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
      AND org_id = check_org_id
      AND role IN ('admin','manager')
  );
$$;

CREATE OR REPLACE FUNCTION is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid());
$$;

CREATE POLICY ae_denial_criteria_org_select ON ae_denial_criteria
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY ae_denial_criteria_manager_write ON ae_denial_criteria
  FOR ALL USING (is_ae_manager(org_id) OR is_platform_admin())
  WITH CHECK (is_ae_manager(org_id) OR is_platform_admin());
```

If `is_ae_manager()` already exists with a different signature, reuse it. If `profiles.role` uses a different enum, adapt the function definition — but the policy contract is: AE managers + platform admins can edit.

### 1.4 — `routing_rules` (restructure — drop legacy, add flat)

0 rows currently. JSONB-based legacy shape dropped clean.

```sql
ALTER TABLE routing_rules
  DROP COLUMN IF EXISTS match_criteria,
  DROP COLUMN IF EXISTS target_ae_id,
  DROP COLUMN IF EXISTS backup_ae_id,
  DROP COLUMN IF EXISTS is_fallback;

ALTER TABLE routing_rules
  ADD COLUMN match_state text,           -- null = wildcard
  ADD COLUMN match_vertical text,        -- null = wildcard
  ADD COLUMN match_employee_min integer, -- null = no min
  ADD COLUMN match_employee_max integer, -- null = no max
  ADD COLUMN destination_type text,
  ADD COLUMN destination_ae_id uuid REFERENCES profiles(id),
  ADD COLUMN destination_pool_id uuid;

ALTER TABLE routing_rules
  ADD CONSTRAINT routing_rules_destination_check
  CHECK (
    destination_type IN ('ae','pool')
    AND (
      (destination_type = 'ae'   AND destination_ae_id IS NOT NULL AND destination_pool_id IS NULL)
      OR
      (destination_type = 'pool' AND destination_pool_id IS NOT NULL AND destination_ae_id IS NULL)
    )
  );

CREATE INDEX IF NOT EXISTS idx_routing_rules_org_active_priority
  ON routing_rules(org_id, active, priority);
```

### 1.5 — `routing_pools` + `routing_pool_members` (new)

```sql
CREATE TABLE IF NOT EXISTS routing_pools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  last_assigned_ae_id uuid REFERENCES profiles(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS routing_pool_members (
  pool_id uuid NOT NULL REFERENCES routing_pools(id) ON DELETE CASCADE,
  ae_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pool_id, ae_id)
);

ALTER TABLE routing_rules
  ADD CONSTRAINT routing_rules_pool_fk
  FOREIGN KEY (destination_pool_id) REFERENCES routing_pools(id);

ALTER TABLE routing_pools ENABLE ROW LEVEL SECURITY;
ALTER TABLE routing_pool_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY routing_pools_org_select ON routing_pools
  FOR SELECT USING (org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY routing_pools_manager_write ON routing_pools
  FOR ALL USING (is_ae_manager(org_id) OR is_platform_admin())
  WITH CHECK (is_ae_manager(org_id) OR is_platform_admin());

CREATE POLICY routing_pool_members_org_select ON routing_pool_members
  FOR SELECT USING (
    pool_id IN (SELECT id FROM routing_pools WHERE org_id = (SELECT org_id FROM profiles WHERE id = auth.uid()))
  );
CREATE POLICY routing_pool_members_manager_write ON routing_pool_members
  FOR ALL USING (
    pool_id IN (
      SELECT id FROM routing_pools
      WHERE is_ae_manager(org_id) OR is_platform_admin()
    )
  );
```

### 1.6 — `deals.bdr_lead_id` (link back)

```sql
ALTER TABLE deals ADD COLUMN IF NOT EXISTS bdr_lead_id uuid REFERENCES bdr_leads(id);
CREATE INDEX IF NOT EXISTS idx_deals_bdr_lead_id ON deals(bdr_lead_id);
```

### 1.7 — `bdr_handoff_feedback` (restructure — 0 rows, clean replace)

Drop legacy old-flow columns, replace with spec shape:

```sql
ALTER TABLE bdr_handoff_feedback
  DROP CONSTRAINT IF EXISTS bdr_handoff_feedback_outcome_check,
  DROP COLUMN IF EXISTS outcome,
  DROP COLUMN IF EXISTS deal_quality_verdict,
  DROP COLUMN IF EXISTS what_came_up_on_qdc,
  DROP COLUMN IF EXISTS hypothesis_validated,
  DROP COLUMN IF EXISTS drivers_validated,
  DROP COLUMN IF EXISTS coaching_notes_for_bdr,
  DROP COLUMN IF EXISTS rejection_reason_code,
  DROP COLUMN IF EXISTS rejection_reason_label,
  DROP COLUMN IF EXISTS ae_id;

ALTER TABLE bdr_handoff_feedback
  ADD COLUMN org_id uuid NOT NULL REFERENCES organizations(id),
  ADD COLUMN deal_id uuid REFERENCES deals(id),
  ADD COLUMN feedback_from_user_id uuid NOT NULL REFERENCES profiles(id),
  ADD COLUMN feedback_to_user_id uuid NOT NULL REFERENCES profiles(id),
  ADD COLUMN feedback_type text NOT NULL CHECK (feedback_type IN ('post_qdc_disqualified')),
  ADD COLUMN rejection_reason_id uuid REFERENCES im_rejection_reasons(id),
  ADD COLUMN notes text;

CREATE INDEX idx_bdr_handoff_feedback_lead_id ON bdr_handoff_feedback(lead_id);
CREATE INDEX idx_bdr_handoff_feedback_to_user ON bdr_handoff_feedback(feedback_to_user_id);
```

RLS:
- BDR can SELECT rows where `feedback_to_user_id = auth.uid()`
- AE can INSERT for deals they own
- Cross-org isolation via `org_id`

---

## 2. BDR submission form

**Route:** `/bdr/submit` (or wherever the existing BDR surface lives)
**Component:** `BdrSubmissionForm.jsx`

### 2.1 — Fields & validation

| field | input | required | notes |
|---|---|---|---|
| Company Name | text | yes | |
| Website | text | yes | client-side URL validation (`https?://...`); auto-prepend `https://` if missing |
| Employees | integer | yes | min 1 |
| Tech Stack / Integrations Needed | tag input | yes | text[]; type + Enter adds a chip; Backspace on empty removes last chip; X on chip removes; trim + dedupe; min 1 chip |
| Annual Revenue | currency input | yes | display formatted `$1,234,567`; store as bigint |
| Number of Entities | integer | yes | min 1 |
| Accounting Team Size | integer | yes | min 1 |
| Industry | text | yes | free text |
| Vertical | dropdown | yes | options from `coach_research_config.verticals` or active coach config |
| HQ State | dropdown | yes | 2-letter codes; standard 50 states + DC |
| BANT Notes | textarea | yes | min 50 chars; min height 6 rows |
| Call recording / transcript | tabbed input | yes | 3 modes (see 2.2) |

Use design tokens from `src/lib/theme.js`. No emojis.

### 2.2 — Transcript input (three tabs — only two functional in pilot)

**Mode A — Audio file upload — COMING SOON (disabled tab)**
- Tab visible but disabled. Tooltip on hover:
  > "Audio submission is coming soon. For now, record your call in Fathom, Gong, or Chorus, copy the transcript, and paste it into the next tab."
- No upload, no storage bucket, no transcription handler. Post-pilot 2–3 day build adds Whisper or Deepgram.

**Mode B — Paste transcript text**
- Textarea, min 200 chars
- On submit, write text to `bdr_leads.transcript` (existing column — canonical pre-routing transcript source)
- AI first-glance fires immediately (form invokes `pre-qdc-decision` directly)
- `conversations` row is NOT created at submission — `route-lead` creates it post-routing, linked to the new deal

**Mode C — Transcript file upload (text)**
- Accepts: `.txt`, `.vtt`, `.srt`, `.docx`
- Extract text client-side (or via a small extraction edge fn for `.docx`)
- Same path as Mode B once text is in hand — text goes into `bdr_leads.transcript`

### 2.3 — Submit handler

Use `try/catch` with the `safeInsert` helper pattern. Do NOT chain `.catch()` on Supabase calls — they don't support it.

**Important (M3 sign-off):** the form **awaits** `pre-qdc-decision` before redirect. The redirect target's `stage` field is meaningful (`'denied'` or `'routed'`), not a stale `'pending'`. Loading state during the call shows "AI is reviewing your submission..." — typical Claude latency is 4–8s. If pre-qdc-decision fails, show inline error and keep the form filled.

```javascript
async function handleSubmit(formData) {
  // 1. Insert bdr_leads with stage='ai_reviewing', ai_decision='pending'
  //    Mode B/C both have transcript in hand at submit time; no awaiting_transcript path
  //    until Mode A audio support ships post-pilot.
  const { data: lead, error: insErr } = await supabase
    .from('bdr_leads')
    .insert({
      org_id, bdr_id: user.id,
      company_name, website, employee_count, tech_stack,
      annual_revenue, num_entities, accounting_team_size,
      industry, vertical, hq_state,
      transcript: transcriptText,    // pasted (Mode B) or extracted (Mode C)
      stage: 'ai_reviewing',
      ai_decision: 'pending'
    })
    .select()
    .single();
  if (insErr) throw insErr;

  // 2. Insert bdr_notes (BANT block) — separate try/catch so a BANT failure doesn't block
  try {
    await supabase.from('bdr_notes').insert({
      lead_id: lead.id, org_id, created_by: user.id,
      note_type: 'bant', content: bantNotes
    });
  } catch (e) { console.warn('bdr_notes insert failed:', e); }

  // 3. AWAIT pre-qdc-decision so the redirect target shows the real decision.
  //    pre-qdc-decision invokes route-lead internally for approved leads, so by the time
  //    this returns, the lead is either denied (stage='denied') or routed (stage='routed'
  //    with deal_id + routed_to_ae_id populated).
  const { data: decision, error: fnErr } = await supabase.functions.invoke(
    'pre-qdc-decision',
    { body: { lead_id: lead.id } }
  );
  if (fnErr) throw fnErr;

  // 4. Redirect to /bdr/leads/:id — status is final, not pending
  navigate(`/bdr/leads/${lead.id}`);
}
```

### 2.4 — Tag input UX (no external lib)

```jsx
function TechStackInput({ value, onChange }) {
  const [input, setInput] = useState('');
  const addChip = (v) => {
    const trimmed = v.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput('');
  };
  return (
    <div style={{ /* chip container styles from theme.js */ }}>
      {value.map((chip, i) => (
        <span key={i} style={{ /* chip style */ }}>
          {chip}
          <button onClick={() => onChange(value.filter((_, j) => j !== i))}>×</button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); addChip(input); }
          if (e.key === 'Backspace' && !input && value.length) onChange(value.slice(0, -1));
        }}
        placeholder="Type and press Enter"
      />
    </div>
  );
}
```

---

## 3. `pre-qdc-decision` edge function (rewrite)

**Trigger:** invoked by the BDR submission form immediately after lead insert. The transcript lives on `bdr_leads.transcript` (Mode B paste or Mode C extracted text).
**Decision:** AI first-glance approve/deny against AE manager denial criteria.
**Prompt assembly:** MUST use `assemble_coach_prompt(coach_id, 'bdr_first_glance', 'process_transcript')` for the system prompt per CLAUDE.md rule #5. The denial-criteria-aware user message is injected as the user content. Both layers logged to `assembled_prompt_versions` (hash-deduped).
**Coach lookup:** load the org's active BDR-Submission-Coach (cloned from template `BDR Submission Coach`). Call type seeded in M1.9 as `bdr_first_glance`.

### 3.1 — Input contract

```typescript
POST /functions/v1/pre-qdc-decision
Headers: { Authorization: Bearer <jwt>, apikey: <anon> }
Body: { lead_id: string }
```

### 3.2 — Logic

```
1. Load bdr_leads row by lead_id
   - If not found → error "v1: lead_id not found"
   - If stage='denied' or 'routed' → idempotent return existing decision

2. Verify transcript is processable:
   - If bdr_leads.transcript IS NULL or LENGTH < 200 → error "v1: transcript not ready"

3. Load bdr_notes for lead_id (type='bant')

4. Load active denial criteria:
   SELECT description, ai_guidance, priority
   FROM ae_denial_criteria
   WHERE org_id = lead.org_id AND active = true
   ORDER BY priority ASC

5. Load the org's active BDR-Submission-Coach:
   SELECT id, model, temperature FROM coaches
   WHERE org_id = lead.org_id AND name = 'BDR Submission Coach' AND active = true LIMIT 1

6. Assemble system prompt via RPC:
   SELECT * FROM assemble_coach_prompt(coach.id, 'bdr_first_glance', 'process_transcript')
   Log result to assembled_prompt_versions (hash-deduped)

7. Build user message (see 3.3) — denial criteria + structured submission + BANT + transcript + JSON output contract

8. Call Claude:
   - model: coach.model (defaults to claude-sonnet-4-5)
   - max_tokens: 1500
   - system: assembled_prompt
   - messages: [{ role: 'user', content: <user message> }]

9. Parse response defensively (strip ```json fences) → { decision, reason, criteria_triggered }

10. Update bdr_leads:
    - ai_decision = response.decision
    - ai_decision_reason = response.reason
    - ai_decision_criteria_triggered = response.criteria_triggered
    - ai_decision_at = now()
    - stage = response.decision === 'approved' ? 'routed' (after route-lead) : 'denied'

11. Log to ai_response_log

12. If approved → invoke 'route-lead' with { lead_id } and await result for stage update
    If denied → send BDR notification (in-app + email) with ai_decision_reason

13. Return { decision, reason, lead_id }
```

### 3.3 — Prompt template

```
You are evaluating a BDR-submitted lead against the AE management team's denial criteria. Your job is to either approve the lead for routing to an AE, or deny it with specific, actionable feedback the BDR can use to improve their next submission.

# Denial criteria (deny the lead if any apply)

{for each criterion in order of priority:}
{priority}. {description}
   Guidance: {ai_guidance}

# Lead submission

Company: {company_name}
Website: {website}
Employees: {employee_count}
Tech Stack / Integrations Needed: {tech_stack joined by ", "}
Annual Revenue: ${annual_revenue formatted with commas}
Number of Entities: {num_entities}
Accounting Team Size: {accounting_team_size}
Industry: {industry}
Vertical: {vertical}
HQ State: {hq_state}

# BDR BANT notes

{bant_notes}

# Call transcript

{transcript}

# Output

Respond with valid JSON only. No preamble, no markdown code fences.

{
  "decision": "approved" | "denied",
  "reason": "<2-3 sentence explanation; if denied, must be actionable feedback for the BDR>",
  "criteria_triggered": ["<exact description text of each criterion that triggered denial, in priority order>"]
}

If approved, criteria_triggered must be an empty array.
If denied, reason should reference the specific criteria triggered and tell the BDR what to do differently next time.
```

Parse defensively: strip ` ```json ` fences if present before `JSON.parse`. Surface parse errors with version stamp: `"pre-qdc-decision v1: JSON parse failure"`.

### 3.4 — Error stamps

Every error throw includes the version: `pre-qdc-decision v1: <reason>`. Bump to v2 on next deployment after any logic change.

---

## 4. `route-lead` edge function (rewrite)

**Trigger:** invoked by `pre-qdc-decision` after approval.
**Effect:** matches routing rule, assigns AE, creates `qualify`-stage deal, kicks off async research + transcript processing.

### 4.1 — Input contract

```typescript
POST /functions/v1/route-lead
Body: { lead_id: string }
```

### 4.2 — Logic

> Note: `deals.rep_id` is the actual column name (not `assigned_rep_id`). Existing trigger `deals_create_related` AFTER INSERT auto-creates `company_profile` + `deal_analysis` rows.

```
1. Load bdr_leads by lead_id
   - Verify ai_decision = 'approved'
   - If stage = 'routed' → idempotent, return existing deal_id

2. Find matching routing rule:
   SELECT * FROM routing_rules
   WHERE org_id = lead.org_id
     AND active = true
     AND (match_state IS NULL OR match_state = lead.hq_state)
     AND (match_vertical IS NULL OR match_vertical = lead.vertical)
     AND (match_employee_min IS NULL OR lead.employee_count >= match_employee_min)
     AND (match_employee_max IS NULL OR lead.employee_count <= match_employee_max)
   ORDER BY priority ASC
   LIMIT 1

   If no match → fall back to org's default open pool (see 4.3)
   If no default pool → error "v1: no routing rule matched and no default pool"

3. Resolve AE:
   If rule.destination_type = 'ae':
     ae_id = rule.destination_ae_id
   If rule.destination_type = 'pool':
     ae_id = advanceRoundRobin(rule.destination_pool_id)

4. Create deal:
   INSERT INTO deals (
     org_id, rep_id, company_name, website, stage, source,
     bdr_lead_id, created_at
   ) VALUES (
     lead.org_id, ae_id, lead.company_name, lead.website, 'qualify', 'bdr_submission',
     lead.id, now()
   ) RETURNING id

   (deals_create_related trigger auto-creates company_profile + deal_analysis)

5. Create conversations row linked to the new deal (copies bdr_leads.transcript → conversations.transcript):
   INSERT INTO conversations (deal_id, transcript, source, call_type, call_date, processed)
   VALUES (new_deal.id, lead.transcript, 'bdr_submission', 'qdc', now(), false)
   RETURNING id

   (conversations.source CHECK must include 'bdr_submission' — extend in M1)

6. Update bdr_leads:
   routed_to_ae_id = ae_id
   routed_at = now()
   deal_id = new_deal.id
   stage = 'routed'

7. Write routing_history (existing table — schema adapt):
   INSERT INTO routing_history (
     source_type='bdr_lead', source_id=lead.id, org_id=lead.org_id,
     matched_rule_id=rule.id, target_ae_id=ae_id, ...
   )

8. Async kickoffs (do not await):
   - Invoke 'research-company' with { deal_id: new_deal.id }
   - Invoke 'process-transcript' with { conversation_id: new_convo.id }

9. Send handoff notification:
   - In-app notification to ae_id
   - Email via existing notification path
   - Include link to /deals/{deal_id}

10. Return { deal_id, ae_id, conversation_id }
```

### 4.3 — Round-robin pool advance

Must be atomic to avoid two concurrent leads getting assigned to the same AE.

```sql
-- Inside a transaction:
WITH pool AS (
  SELECT id, last_assigned_ae_id FROM routing_pools
  WHERE id = $pool_id FOR UPDATE
),
members AS (
  SELECT ae_id, row_number() OVER (ORDER BY ae_id) AS rn
  FROM routing_pool_members
  WHERE pool_id = $pool_id AND active = true
),
current_idx AS (
  SELECT COALESCE((SELECT rn FROM members WHERE ae_id = (SELECT last_assigned_ae_id FROM pool)), 0) AS idx,
         (SELECT count(*) FROM members) AS total
),
next_member AS (
  SELECT ae_id FROM members
  WHERE rn = ((SELECT idx FROM current_idx) % (SELECT total FROM current_idx)) + 1
)
UPDATE routing_pools
SET last_assigned_ae_id = (SELECT ae_id FROM next_member),
    updated_at = now()
WHERE id = $pool_id
RETURNING last_assigned_ae_id AS assigned_ae_id;
```

Wrap as an RPC for the edge function to call cleanly:

```sql
CREATE OR REPLACE FUNCTION advance_routing_pool(p_pool_id uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE
  v_assigned_ae_id uuid;
BEGIN
  -- CTE logic above
  RETURN v_assigned_ae_id;
END;
$$;
```

### 4.4 — `promote-to-dealcoach` decommission

After `route-lead` is verified end-to-end (test checklist in §8 green):

1. List all callers found in pre-flight §0.1
2. Update each to call `route-lead` instead (frontend, other edge fns, triggers)
3. Remove `promote-to-dealcoach` from edge function registry
4. Mark deprecated in docs
5. **Do not delete the source file** for one release cycle — keep as `_deprecated_promote-to-dealcoach.ts` for rollback safety
6. Remove fully in a follow-up cleanup migration after pilot stability is proven

---

## 5. AE manager admin UI

### 5.1 — Denial criteria management

**Route:** `/admin/denial-criteria` (add as new tab to existing `/admin` 7-tab shell)
**Component:** `DenialCriteriaAdmin.jsx`

Surface:
- List of criteria, sorted by priority
- Drag handle to reorder priority
- Toggle active per row
- Create button → inline expand editor (matches existing `/admin` pattern, no drill-in route)
- Fields: description (required, plain text), ai_guidance (required, 2-3 sentences explaining when this fires), priority (auto-assigned to next available)
- Edit: inline expand same form
- Delete: confirm modal

Access guard:
- Tab only visible when `is_ae_manager(org_id)` OR `is_platform_admin()`
- All write operations RLS-enforced server-side via the policy in §1.3

Future hook (do not build now): a "Test" button that runs a sample lead through the current criteria set and shows what the AI would decide. Stub it as `disabled={true}` button with tooltip "Coming soon."

### 5.2 — Routing rules management

**Route:** `/admin/routing` (new tab)
**Component:** `RoutingAdmin.jsx`

Two sub-sections on one page:

**Rules list:**
- columns: priority, state, vertical, employee band, destination (AE name or "Pool: {pool_name}"), active toggle
- Create rule: inline expand form with state dropdown (50 + DC + null=wildcard), vertical dropdown (from coach config + null=wildcard), employee min/max numerics (both nullable), destination radio (AE | Pool) → conditional dropdown
- Priority drag-reorder

**Pools list:**
- columns: name, member count, last assigned AE, active
- Create pool: name + initial members (multi-select AE dropdown)
- Expand row to edit members (add/remove)

Same access guard as denial criteria.

---

## 6. Post-QDC disqualification — "both" path

When the AE marks a deal as disqualified post-QDC. This is M7's primary work — the existing `post-qdc-decision` edge function is **rewired** (not dropped):
- AE approves QDC: post-qdc-decision advances `deals.stage` from `qualify` → `discovery` (confirm exact target stage in M7).
- AE rejects QDC: post-qdc-decision triggers spec §6 — deal → `disqualified`, write `bdr_handoff_feedback`, notify BDR.

### 6.1 — UI

In the deal detail view (existing component, modify), the existing "disqualify" action gets a required modal:

- Required: select rejection reason from `im_rejection_reasons` (org-scoped, filter `applies_to IN ('post_qdc','both')`)
- Required: free-text "what should the BDR have caught?" (min 30 chars)
- Optional checkbox: "Don't surface this to the BDR" (defaults off — feedback flows to BDR by default)

### 6.2 — Submit handler

```javascript
async function disqualifyDeal(dealId, rejectionReasonId, feedback, suppressBdrNotification) {
  // 1. Update deal stage
  await supabase.from('deals').update({
    stage: 'disqualified',
    disqualified_at: new Date().toISOString(),
    disqualified_by: user.id,
    disqualification_reason_id: rejectionReasonId
  }).eq('id', dealId);

  // 2. Write to bdr_handoff_feedback (the coaching loop back to BDR)
  if (!suppressBdrNotification) {
    const { data: deal } = await supabase.from('deals')
      .select('bdr_lead_id, assigned_rep_id, bdr_leads(bdr_id)')
      .eq('id', dealId).single();

    if (deal?.bdr_lead_id) {
      await safeInsertNoReturn('bdr_handoff_feedback', {
        lead_id: deal.bdr_lead_id,
        deal_id: dealId,
        feedback_from_user_id: deal.assigned_rep_id,
        feedback_to_user_id: deal.bdr_leads.bdr_id,
        feedback_type: 'post_qdc_disqualified',
        rejection_reason_id: rejectionReasonId,
        notes: feedback
      });

      // 3. Update bdr_leads stage
      await supabase.from('bdr_leads').update({
        stage: 'disqualified_post_qdc'
      }).eq('id', deal.bdr_lead_id);

      // 4. Notify BDR (in-app + email)
      await notifyBdr(deal.bdr_leads.bdr_id, 'post_qdc_disqualified', { dealId, feedback });
    }
  }

  // 5. AI retrospective auto-fires via deals_trigger_retrospective (existing)
}
```

Both effects happen: deal goes to `disqualified` stage (retrospective fires, learning loop captures), AND BDR sees actionable coaching feedback.

---

## 7. Frontend AE deal list — qualify-stage separation

Outside the strict scope of this build, but required for the new flow to feel right.

In the AE deal pipeline view:
- Pin a "New Leads — Awaiting QDC" section at the top showing `deals WHERE stage = 'qualify' AND bdr_lead_id IS NOT NULL`
- Render these with a distinct visual treatment (subtle Carolina-blue accent border, "From BDR" tag)
- Below, the rest of the pipeline as today, filtered to `stage != 'qualify'` OR `bdr_lead_id IS NULL`

This isn't a blocker for the backend work, but Claude Code should ship the AE list change in the same PR set so the new routed deals are visible and distinguishable.

---

## 8. Test checklist (E2E)

All seven must pass before `promote-to-dealcoach` is decommissioned:

1. **BDR submits with pasted transcript → approval → deal created**
   - Lead row exists with all 12 fields populated
   - bdr_notes row exists with BANT content
   - conversations row exists with raw_transcript
   - ai_decision = 'approved', reason populated
   - deal exists in qualify stage with bdr_lead_id set
   - company_profile + deal_analysis auto-created via existing trigger
   - AE received notification

2. **BDR submits with audio upload → transcription completes → AI evaluates → approved → routed**
   - Lead status moves: submitted → awaiting_transcript → ai_reviewing → routed
   - Latency end-to-end logged

3. **BDR submits → AI denies due to triggered criterion**
   - ai_decision = 'denied'
   - ai_decision_criteria_triggered contains the exact criterion description
   - BDR received actionable reason
   - No deal created

4. **Lead matches state + vertical → specific AE**
   - routing_history row written with rule_id

5. **Lead matches open territory pool → round-robin advances**
   - Submit 3 leads matching same pool
   - Verify each routes to a different AE in the pool, advancing the pointer
   - Verify `routing_pools.last_assigned_ae_id` updates each time
   - Concurrency test: fire 5 simultaneous submissions, verify no two get the same AE if pool has 5 members

6. **AE disqualifies post-QDC → both paths fire**
   - deals.stage = 'disqualified'
   - bdr_handoff_feedback row written with feedback_type='post_qdc_disqualified'
   - bdr_leads.status = 'disqualified_post_qdc'
   - BDR notified
   - AI retrospective fires (deal_retrospectives row created)

7. **RLS audit**
   - BDR cannot SELECT another BDR's bdr_leads (different org)
   - BDR can SELECT their own bdr_handoff_feedback
   - Non-manager cannot INSERT into ae_denial_criteria
   - Non-manager cannot UPDATE routing_rules
   - Cross-org isolation verified for all new tables

---

## 9. Migration order (one file per logical chunk)

Run via `apply_migration` (records history; do not use `execute_sql` for DDL):

1. `20260511_01_bdr_leads_columns.sql` — ALTER bdr_leads
2. `20260511_02_bdr_notes.sql` — CREATE bdr_notes + RLS
3. `20260511_03_ae_denial_criteria.sql` — CREATE ae_denial_criteria + helper functions + RLS
4. `20260511_04_routing_pools.sql` — CREATE routing_pools + routing_pool_members + RLS
5. `20260511_05_routing_rules_extend.sql` — ALTER routing_rules + constraint + indexes
6. `20260511_06_deals_bdr_lead_id.sql` — ALTER deals
7. `20260511_07_bdr_handoff_feedback_extend.sql` — ALTER bdr_handoff_feedback
8. `20260511_08_advance_routing_pool_rpc.sql` — CREATE FUNCTION advance_routing_pool
9. `20260511_09_seed_default_open_pool.sql` — INSERT one default open pool per existing org (optional; AE managers can create their own)

Each migration includes explicit `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on any new table — Supabase does NOT auto-enable RLS.

---

## 10. Build sequence

1. **Pre-flight audit** (§0) — output a markdown report into the repo at `docs/audits/2026-05-11-bdr-routing-preflight.md`
2. **Migrations 1–9** (§9)
3. **`pre-qdc-decision` rewrite** (§3) — deploy as v1, version-stamp all errors
4. **`route-lead` rewrite** (§4) — deploy as v1
5. **BDR submission form** (§2) — wire to new flow
6. **AE manager admin UI** (§5) — denial criteria + routing rules + pools
7. **Post-QDC disqualification modal** (§6) — both paths
8. **AE deal list qualify-stage separation** (§7)
9. **Run test checklist** (§8) — capture results, fix gaps
10. **Decommission `promote-to-dealcoach`** (§4.4) — only after all 7 tests green

---

## 11. Conventions (carry through every file)

- No `.catch()` on Supabase calls. Wrap in `try/catch`. Use `safeInsert` / `safeInsertNoReturn` helpers.
- All edge functions: `verify_jwt: false`, version-stamp every error message (`pre-qdc-decision v1: ...`).
- All new tables: explicit `ENABLE ROW LEVEL SECURITY` + explicit policies. Multi-tenant isolation by `org_id` is mandatory.
- Inline styles using `src/lib/theme.js` tokens. Shared components in `src/components/Shared.jsx`. Plus Jakarta Sans, Carolina Blue (`#5DADE2`) primary.
- No emojis anywhere in the UI.
- Pain points, decision criteria, contact alignment, and now BDR notes all in first-class relational tables — never JSONB arrays on parent records.
- `apply_migration` for all DDL (records history). `execute_sql` for read queries only.
- `deploy_edge_function` requires full file content every deploy — no partial update.

---

## 12. Open follow-ups (not in this build)

- Vertical list source: confirm `coach_research_config.verticals` is the right source vs. a global `verticals` reference table.
- Industry list: free text in v1; consider standardizing to NAICS or a curated list in a future build.
- Hard structured filters in `ae_denial_criteria.structured_rule` (jsonb): UI to compose these without writing JSON; deferred to post-pilot.
- "Test denial criteria" admin tool (stubbed disabled button in §5.1).
- BDR self-service view of their own submission history with rolling approve/deny ratio — promotion-case metric surface.
