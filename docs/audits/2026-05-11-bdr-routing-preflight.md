# M0 Pre-flight Audit — BDR Submission & Deal Routing Build

**Date:** 2026-05-11
**Supabase project:** `npfnsyufqqhhjmtvmold`
**Spec reference:** [`docs/builds/lumen-bdr-submission-routing-spec.md`](../builds/lumen-bdr-submission-routing-spec.md)
**Status:** Awaiting go-ahead on open questions before M1.

---

## Phase 2 edge functions — disposition per Joe 2026-05-11

| Function | Decision | Notes |
|---|---|---|
| `pre-qdc-decision` | **REWRITE** in M2 | Full rewrite; current v1 is the old AE post-QDC accept/reject state machine. New v1 = AI first-glance approve/deny. Uses `assemble_coach_prompt(coach_id, 'bdr_first_glance', 'process_transcript')`. |
| `route-lead` | **REWRITE** in M3 | Full rewrite; current v1 uses JSONB `match_criteria` + capacity. New v1 uses flat columns + routing_pools + creates `qualify`-stage deal + creates conversations row + async kickoffs. |
| `promote-to-dealcoach` | **DROP** in M10 | Only caller is `post-qdc-decision` (rewired in M7). Rename source to `_deprecated_promote-to-dealcoach.ts` and keep deployed one release cycle. |
| `process-bdr-submission` | **DROP** in M10 | Old orchestrator (research → score → route → IM meeting). New flow: BDR form invokes `pre-qdc-decision` directly. No middleman. |
| `post-qdc-decision` | **REWIRE** in M7 | New behavior: approve → advance deal stage from `qualify`; reject → execute spec §6 (deal → disqualified, write bdr_handoff_feedback, notify BDR). M7's primary work. |
| `process-ae-self-submission` | OUT OF SCOPE | Separate AE-self lead path; not in this build. |
| `process-ae-qdc-transcript` | OUT OF SCOPE | Post-QDC scoring; not in this build but obsolete in new flow — consider DROP in a future cleanup. |
| `create-im-meeting` | **KEEP** (out of scope) | Per Joe — separate IM concern. Not touched in this build. |
| `send-handoff-notification` | **REWIRE** in M3 | Repurpose for new deal-routing notification (in-app + email to assigned AE on lead route). Source file probably remains compatible. |
| `writeback-bdr-feedback` | **DROP** in M10 | Replaced by spec §6.2 inline write from the AE disqualify modal. |
| `research-lead-company` | **DROP** in M10 | Per 6.J — no pre-decision research. Post-routing research goes through `research-company` (the dealcoach variant). |
| `research-company` | UNCHANGED | Called by `route-lead` post-deal-creation. |
| `process-transcript` | UNCHANGED | Called by `route-lead` post-conversation-creation. |
| `inbound-webhook`, `import-transcript-url`, `execute-workflows`, `dealroom-access`, `generate-field-context`, `generate-proposal-content`, etc. | UNCHANGED | Unrelated to this build. |

**Decommission summary for M10:** `promote-to-dealcoach`, `process-bdr-submission`, `writeback-bdr-feedback`, `research-lead-company`. All renamed to `_deprecated_*` and kept deployed one release cycle for rollback.

---

## Executive summary

The build spec calls for replacing the current `bdr_leads → IM meeting → post-QDC → promote-to-dealcoach` lifecycle with a direct `bdr_leads → AI first-glance → route-lead → deal-at-qualify` lifecycle.

The current state is favorable for the rewrite:
- **No callers of `promote-to-dealcoach` exist in the repo source or DB triggers.** Only one edge function (`post-qdc-decision`) calls it. Decommission is contained.
- **`bdr_leads`, `routing_rules`, `bdr_handoff_feedback` all have 0 rows.** No backfill needed; column adds and CHECK extensions are safe.
- **Phase 3 (BDR frontend) was never built.** M4 and M5 are greenfield — no existing BDR UI to preserve.

Two things block clean execution and need user decisions before M1:
1. **Audio transcription handler does not exist** anywhere in the codebase. Spec §2.2 Mode A cannot ship as-written.
2. **`conversations.deal_id` is `NOT NULL`**, which breaks the spec's submission-time conversation creation. A small flow tweak resolves it.

Beyond those, several name and shape mismatches between spec and existing schema need confirmation on how to reconcile (rename vs. add-alongside). All are listed in §6 below.

---

## 1. Callers of `promote-to-dealcoach`

| Source | Count | Detail |
|---|---|---|
| Repo (`*.js/jsx/ts/tsx/sql/md`) | **0** | Grep returns no matches anywhere in the codebase. |
| DB triggers | **0** | `information_schema.triggers` with `action_statement ILIKE '%promote-to-dealcoach%'` returns 0 rows. |
| Other deployed edge functions | **1** | `post-qdc-decision/index.ts` calls `promote-to-dealcoach` via `callEdge()` (the only invocation point). |

**Implication:** Decommission in M10 is a two-step removal:
1. Stop wiring `post-qdc-decision` → `promote-to-dealcoach` (the whole post-QDC AE path becomes dead in the new flow).
2. Mark `promote-to-dealcoach` deprecated (rename source file to `_deprecated_promote-to-dealcoach.ts`, leave deployed for one release cycle for rollback safety).

No frontend or DB cleanup required.

---

## 2. Schema snapshot

### 2.1 — Tables: present vs. expected

| Table | Status | Notes |
|---|---|---|
| `bdr_leads` | ✅ exists, 0 rows | Schema diverges from spec §1.1 — see §6.A |
| `bdr_notes` | ❌ does not exist | Will be created in M1 |
| `routing_rules` | ✅ exists, 0 rows | Shape totally different from spec §1.4 — see §6.D |
| `routing_pools` | ❌ does not exist | Will be created in M1 |
| `routing_pool_members` | ❌ does not exist | Will be created in M1 |
| `bdr_handoff_feedback` | ✅ exists, 0 rows | Schema diverges from spec §1.7 — see §6.E |
| `ae_denial_criteria` | ❌ does not exist | Will be created in M1 |
| `im_rejection_reasons` | ✅ exists, 48 rows total across orgs | Per-org table, `applies_to ∈ (pre_qdc, post_qdc, both)` |
| `deals` | ✅ exists, 6 rows | Missing `bdr_lead_id`, `source`, `disqualified_*` (spec §1.6, §6.1) |
| `deals.bdr_lead_id` | ❌ column missing | Will be added in M1 |
| `routing_history` | ✅ exists | Used by current `route-lead` v1 — schema compatible |
| `conversations` | ✅ exists | **`deal_id` is `NOT NULL`** — blocks spec flow, see §6.B |
| `transcript_sources` | ✅ exists | Webhook source registry (Fathom/Gong); NOT an audio file tracker — see §6.C |
| `im_meetings` | ✅ exists | Used by current flow; new flow bypasses it entirely |
| `coach_research_config` | ✅ exists | **No `verticals` column** (spec §2.1 references one) — see §6.G |
| `bdr_pre_qdc_scores`, `bdr_submission_feedback`, `bdr_stage_history`, `im_post_qdc_scores`, `im_stage_history` | ✅ exist | Part of old flow; obsolete after this build but kept for one release |

### 2.2 — Current `bdr_leads` columns (relevant)

| column | type | nullable | default | spec match |
|---|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` | ✅ |
| `org_id` | uuid | NO | — | ✅ |
| `bdr_id` | uuid | NO | — | ✅ |
| `company_name` | text | NO | — | ✅ |
| `website` | text | YES | — | ✅ |
| `employee_count` | integer | YES | — | ✅ |
| `tech_stack` | text[] | YES | `'{}'` | ✅ |
| `num_entities` | integer | YES | — | ✅ |
| `vertical` | text | YES | — | ✅ |
| `revenue` | numeric | YES | — | ⚠️ spec wants `annual_revenue` (bigint) |
| `state` | text | YES | — | ⚠️ spec wants `hq_state` |
| `stage` | text | NO | `'submitted'` | ⚠️ spec wants `status`, with **different enum values** |
| `transcript` | text | YES | — | spec uses `conversation_id` instead |
| `lead_source` | text | NO | `'bdr'` | not in spec — keep |
| `pre_qdc_score`, `pre_qdc_recommendation`, `im_meeting_id` | various | YES | — | old-flow remnants, obsolete in new flow |
| `primary_contact_*` (5 cols), `hypothesis`, `evaluation_drivers`, `bant_*` (4 cols), `recent_news`, `intent_signals`, `notes` | various | YES | various | not in new spec — leave; some may belong as `bdr_notes` rows |
| **MISSING from current:** `industry`, `accounting_team_size`, `conversation_id`, `ai_decision`, `ai_decision_reason`, `ai_decision_criteria_triggered`, `ai_decision_at`, `routed_to_ae_id`, `routed_at`, `deal_id` | — | — | — | all to be added in M1 |

### 2.3 — Current `bdr_leads.stage` CHECK constraint

```sql
CHECK (stage IN (
  'submitted','researching','scored','routed','recycled',
  'accepted','rejected_pre_qdc','rejected_post_qdc'
))
```

**Spec wants:** `submitted, awaiting_transcript, ai_reviewing, denied, routed, disqualified_post_qdc`.

Recommendation in §6.A.

### 2.4 — Current `routing_rules` columns

| column | type | nullable | default |
|---|---|---|---|
| `id` | uuid | NO | `gen_random_uuid()` |
| `org_id` | uuid | NO | — |
| `name` | text | NO | — |
| `match_criteria` | jsonb | NO | `'{}'` |
| `target_ae_id` | uuid | YES | — |
| `backup_ae_id` | uuid | YES | — |
| `priority` | integer | NO | `100` |
| `is_fallback` | boolean | NO | `false` |
| `active` | boolean | NO | `true` |
| `created_at`, `updated_at` | timestamptz | NO | `now()` |

**Spec §1.4 wants flat columns:** `match_state`, `match_vertical`, `match_employee_min/max`, `destination_type`, `destination_ae_id`, `destination_pool_id`.

With 0 rows, additive migration is clean. Old `match_criteria` / `target_ae_id` / `backup_ae_id` / `is_fallback` become unused (cleanup migration later).

### 2.5 — Current `bdr_handoff_feedback` columns

| column | type | nullable | spec match |
|---|---|---|---|
| `id` | uuid | NO | — |
| `lead_id` | uuid | NO | ✅ |
| `outcome` (CHECK: `rejected_pre_qdc / rejected_post_qdc / accepted_promoted`) | text | NO | ⚠️ spec wants `feedback_type` with `post_qdc_disqualified` |
| `deal_quality_verdict`, `what_came_up_on_qdc`, `hypothesis_validated`, `drivers_validated`, `coaching_notes_for_bdr`, `rejection_reason_code`, `rejection_reason_label` | various | YES | old-flow fields; coexist |
| `ae_id` | uuid | YES | spec calls this `feedback_from_user_id` |
| **MISSING:** `deal_id`, `feedback_from_user_id` (alias for `ae_id`?), `feedback_to_user_id`, `feedback_type`, `rejection_reason_id` (FK), `notes` | — | — | to be added in M1 |

### 2.6 — `deals` columns (relevant)

| column | type | nullable | notes |
|---|---|---|---|
| `id` | uuid | NO | — |
| `rep_id` | uuid | YES | ⚠️ spec §4.2 calls this `assigned_rep_id` — adapt edge function |
| `org_id` | uuid | YES | — |
| `company_name` | text | NO | — |
| `stage` | text | NO | CHECK: `qualify, discovery, solution_validation, confirming_value, selection, disqualified, closed_won, closed_lost` ✅ |
| **MISSING:** `bdr_lead_id`, `source`, `disqualified_at`, `disqualified_by`, `disqualification_reason_id` | — | — | spec §1.6, §6.1 — to be added |

### 2.7 — `profiles.role` CHECK constraint

```sql
CHECK (role IS NULL OR role IN (
  'system_admin','admin','manager','rep','bdr','ae'
))
```

**Spec §1.3 `is_ae_manager()` checks `role IN ('ae_manager','admin')`.** The value `'ae_manager'` does not exist in this enum. See §6.F.

### 2.8 — Helper functions already in DB

| Function | Status | Notes |
|---|---|---|
| `is_platform_admin()` | ✅ exists | Per CLAUDE.md, checks `platform_admins` table |
| `is_ae_manager(uuid)` | ❌ does not exist | Will be created in M1 |
| `advance_routing_pool(uuid)` | ❌ does not exist | Will be created in M1 |
| `public_denial_criteria_for_bdr()` | ❌ does not exist | Will be created in M1 |

---

## 3. Edge function inventory

### 3.1 — Currently deployed (34 ACTIVE)

In scope for this build:

| Function | Version | Status | Action in this build |
|---|---|---|---|
| `pre-qdc-decision` | v1 | ACTIVE | **Full rewrite** (M2). Current v1 is the AE post-QDC accept/reject state machine — completely different semantics. |
| `route-lead` | v1 | ACTIVE | **Full rewrite** (M3). Current v1 uses JSONB `match_criteria` + capacity check + writes to `routing_history`. New v1 uses flat columns, creates deals, fires async kickoffs. |
| `promote-to-dealcoach` | v1 | ACTIVE | **Decommission** (M10). Only called by `post-qdc-decision`. |
| `process-bdr-submission` | v1 | ACTIVE | Orchestrates old flow (research → score → route → create IM meeting). **Becomes obsolete** in new flow. Spec doesn't mention it — flag in §6.K. |
| `post-qdc-decision` | v1 | ACTIVE | AE post-QDC accept/reject. **Becomes obsolete** in new flow (no post-QDC promote step; AE works deal directly from `qualify`). |
| `process-ae-self-submission` | v1 | ACTIVE | AE-self lead path. Out of scope for this build; may retire alongside above. |
| `process-ae-qdc-transcript` | v1 | ACTIVE | Post-QDC scoring + summary. Obsolete in new flow. |
| `create-im-meeting` | v1 | ACTIVE | Creates `im_meetings` row from a routed lead. Obsolete. |
| `send-handoff-notification` | v1 | ACTIVE | Resend email to AE on IM-meeting routing. **Repurpose** for the new deal-routing notification. |
| `writeback-bdr-feedback` | v1 | ACTIVE | Writes `bdr_handoff_feedback` from IM meeting context. **Replaced** by the spec §6.2 inline write from the disqualify modal. |
| `research-lead-company` | v1 | ACTIVE | Perplexity research on a `bdr_leads` row. Keep — `route-lead` may call before deal creation, OR `research-company` (the dealcoach variant) takes over after deal creation. **Decision needed** — flag in §6.J. |
| `process-transcript` | v34 | ACTIVE | Existing transcript analysis. Unchanged; new `route-lead` invokes it post-deal-creation. |
| `research-company` | v34 | ACTIVE | Existing deal research (Perplexity + Apollo + NinjaPear). Unchanged; new `route-lead` invokes it post-deal-creation. |

### 3.2 — Local edge function source

`supabase/functions/` contains only 12 directories:
```
create-invited-user, deal-chat, dealroom-access, embed-chunks, generate-email,
import-transcript-url, ingest-deal-knowledge, onboard-organization,
process-retrospective-queue, process-transcript, research-company, send-invitation
```

**The BDR/IM Phase 2 functions (`pre-qdc-decision`, `route-lead`, `promote-to-dealcoach`, etc.) are NOT in the local repo.** They were deployed via MCP (per the paused-build memory) but never committed.

**Implication for M2 and M3:** writing fresh local source files at `supabase/functions/pre-qdc-decision/index.ts` and `supabase/functions/route-lead/index.ts` is the natural path. `npx supabase functions deploy <name> --project-ref npfnsyufqqhhjmtvmold --no-verify-jwt` will push the new source, overriding v1. The current MCP-deployed source becomes irrecoverable from local — that's fine since we're replacing it.

### 3.3 — Audio transcription handler

**Search results:**
- `grep -i "audio|whisper|transcribe|.mp3|.m4a|.wav|.webm|assemblyai|deepgram"` across the repo: **1 hit**, in `src/pages/QuoteBuilder.jsx` (unrelated — refers to "audio/video" proposal asset type).
- No edge function transcribes audio.
- No storage bucket pattern `transcripts/audio/...` exists.
- `transcript_sources` table stores webhook source registrations (Fathom, Gong, Otter, etc.), not audio files. Columns: `source_type`, `webhook_endpoint`, `webhook_secret`, `last_received_at`, `transcripts_received` — confirms this is the webhook-based ingestion config.

**Conclusion:** There is no audio-to-text pipeline in this codebase. Spec §2.2 Mode A cannot ship as written. **This is an M0 stop-and-report trigger** per the orchestration prompt. See §6.H for the recommended path.

---

## 4. `routing_rules` data — backfill check

Spec §1.4 adds a `routing_rules_destination_check` CHECK constraint requiring exactly one of `(destination_ae_id, destination_pool_id)` populated based on `destination_type`. With **0 rows currently**, no backfill is required. Constraint can be added in M1 alongside the column adds.

---

## 5. `im_rejection_reasons` — disqualification source

Per-org, with 48 rows total seeded across orgs (memory called out 12 per org × 4 orgs ≈ 48 — confirmed). `applies_to ∈ (pre_qdc, post_qdc, both)`. The spec §6.1 disqualification modal should filter on `applies_to IN ('post_qdc','both')` and `org_id = current_org`. No schema change needed.

---

## 6. Open questions / spec deviations — DECISIONS NEEDED BEFORE M1

### 6.A — `bdr_leads`: column name conflicts and stage CHECK

| spec wants | current has | recommendation |
|---|---|---|
| `annual_revenue` (bigint) | `revenue` (numeric) | Add `annual_revenue` bigint. Flag `revenue` for cleanup migration. |
| `hq_state` | `state` | Add `hq_state`. Flag `state` for cleanup. |
| `status` (new enum) | `stage` (different enum) | **Keep column name `stage`** (avoids breaking unrelated reads in `process-bdr-submission`/`route-lead` v1 during the transition). **Extend CHECK** to add `'awaiting_transcript'`, `'ai_reviewing'`, `'denied'`, `'disqualified_post_qdc'`. Map spec's `status` semantically to `stage`. Old enum values (`'researching'`, `'scored'`, `'recycled'`, `'accepted'`, `'rejected_pre_qdc'`, `'rejected_post_qdc'`) remain valid until cleanup migration. |

**Question for Joe:** OK to use these column names instead of spec names? `bdr_leads` is empty so renaming `revenue → annual_revenue`, `state → hq_state`, `stage → status` is also safe — happy to do either. Recommendation above is conservative (add-alongside) but spec-aligned alternative is full rename.

### 6.B — `conversations.deal_id` is `NOT NULL`

Spec §2.3 has the BDR form creating a `conversations` row at submission time and linking `bdr_leads.conversation_id`. Spec §3 step 3 has `pre-qdc-decision` reading `conversations.raw_transcript`. But:
- `conversations.deal_id NOT NULL` means we can't create a `conversations` row until a deal exists.
- In the new flow, the deal is only created at routing time, AFTER `pre-qdc-decision` runs.

**Recommendation:** Store the transcript text on `bdr_leads.transcript` (existing column) at submission time. `pre-qdc-decision` reads from `bdr_leads.transcript` directly (not via `conversations`). `route-lead` creates the `conversations` row linked to the newly-created deal, copying `bdr_leads.transcript → conversations.transcript`, then fires `process-transcript`.

**Question for Joe:** OK with this flow change? Alternative is making `conversations.deal_id` nullable, which is more invasive.

### 6.C — `transcript_sources` semantics

Spec §2.2 Mode A says "Create `transcript_sources` row with type `'audio'`, status `'pending'`". But `transcript_sources` is the webhook-source registry, not a per-file tracker. There's no obvious place to track in-flight audio uploads in the current schema.

**Recommendation:** If audio mode ships (see §6.H), add a small `bdr_audio_uploads` tracking table (or reuse `bdr_leads.stage = 'awaiting_transcript'` as the only state marker). Don't repurpose `transcript_sources`.

### 6.D — `routing_rules` shape divergence

Current: JSONB `match_criteria` + `target_ae_id` + `backup_ae_id` + `is_fallback`.
Spec: flat columns `match_state, match_vertical, match_employee_min/max, destination_type, destination_ae_id, destination_pool_id`.

With 0 rows, additive migration is clean. Old columns coexist as unused. Recommend cleanup migration after pilot.

**Question for Joe:** confirm OK with hybrid schema until cleanup, OR want a single migration that drops the old columns now (also safe with 0 rows)?

### 6.E — `bdr_handoff_feedback` shape divergence

Current `outcome` CHECK: `rejected_pre_qdc / rejected_post_qdc / accepted_promoted`. Spec wants new `feedback_type` field with value `post_qdc_disqualified`.

**Recommendation:** Add the spec's new columns (`deal_id`, `feedback_from_user_id`, `feedback_to_user_id`, `feedback_type`, `rejection_reason_id` FK, `notes`) as nullable. Extend `outcome` CHECK to add `'post_qdc_disqualified'` value OR introduce `feedback_type` as a separate independent text field (CHECK for spec values). Old columns coexist. The new disqualify flow writes the new fields; legacy reads still work.

### 6.F — `is_ae_manager(org_id)` role mapping

Spec function checks `role IN ('ae_manager','admin')`. Current enum is `('system_admin','admin','manager','rep','bdr','ae')` — no `ae_manager` value.

**Recommendation:** `is_ae_manager()` returns true for `role IN ('admin', 'manager', 'system_admin')`. "admin" is org-level admin; "manager" is sales manager (which in Sage context is the AE manager). `system_admin` is included for org owners. The spec note explicitly allows this adaptation.

**Question for Joe:** confirm this mapping. Alternative: add `'ae_manager'` to the role enum.

### 6.G — Vertical dropdown source (spec §2.1)

Spec says vertical options come from `coach_research_config.verticals`. **That column does not exist.** `coach_research_config` has `focus_areas` (jsonb), but it's keyed by `coach_id`, not `org_id`, and doesn't naturally map to a vertical picklist.

**Recommendation:** Add a `verticals text[]` column to `coach_research_config`, default to the Sage Intacct pilot vertical list (e.g., `{Construction, Nonprofit, Distribution, Real Estate, Professional Services, Manufacturing, Healthcare, Other}`). The BDR form reads via the AE manager's active coach. Or — simpler — add a platform-level `coach_verticals` table.

**Question for Joe:** which source? Recommend `verticals text[]` on `coach_research_config` for v1 simplicity. Open follow-up to formalize as its own table later (already noted in spec §12).

### 6.H — Audio transcription handler missing (spec §2.2 Mode A)

**This is the only true blocker. No audio handler exists.** Three options:

| option | description | implication |
|---|---|---|
| **A — drop Mode A** | Ship M4 with Mode B (paste) + Mode C (text file upload) only. Show "Audio submission coming soon" tooltip. | Recommended for pilot. Sage AEs/BDRs likely already use a tool (Fathom/Gong) that produces text — they paste it in. |
| **B — build audio pipeline** | New edge function calling OpenAI Whisper or AssemblyAI. New storage bucket with RLS. New transcription-complete handler. ~1 day additional scope. | Doable but adds scope. Adds an API key dependency (Whisper or AssemblyAI). |
| **C — webhook ingestion** | BDR records call in Fathom/Gong → existing `inbound-webhook` or `transcript_sources` flow fires → transcript arrives → `pre-qdc-decision` triggered by webhook handler. | Closest to existing infra. But requires BDRs to be on Fathom/Gong, and a `bdr_leads` row needs to be pre-created and linked. |

**Recommendation:** **Option A** for the pilot. Note the UI with "Audio submission coming soon — for now, record in Fathom/Gong and paste the transcript here." If audio is must-have, **Option B** at ~1 extra day.

### 6.I — `deals.rep_id` vs spec `assigned_rep_id`

Spec §4.2 has `INSERT INTO deals (... assigned_rep_id ...)`. Current column is `rep_id`. Just adapt `route-lead` to use `rep_id`. No schema change.

### 6.J — `research-lead-company` vs `research-company`

Current flow: `research-lead-company` enriches `bdr_leads` (Perplexity-only). Then post-routing, `research-company` enriches `deals/company_profile` (Perplexity + Apollo + NinjaPear).

**Question for Joe:** in new flow, do we still pre-research `bdr_leads` for the AI first-glance to consume? Two paths:

| path | when | what runs |
|---|---|---|
| Pre-decision research | `pre-qdc-decision` is called → it fires `research-lead-company` first → then AI decides | More AI context, slower decision (Perplexity adds latency) |
| Post-routing research only | AI decides on raw BDR submission → if approved, `route-lead` fires `research-company` post-deal-creation | Faster decision, but AI judges denial criteria against less data |

**Recommendation:** Post-routing only. AI decides on BDR-provided data (BANT notes + transcript + form fields). Denial criteria are about disposition (e.g., "client size too small", "wrong vertical", "no compelling event") — should be discernible from the BDR's submission alone. Research is for the AE.

### 6.K — `process-bdr-submission` and old-flow edge functions

Not mentioned in spec, but they become obsolete in the new flow:
- `process-bdr-submission` (orchestrator)
- `post-qdc-decision`
- `process-ae-qdc-transcript`
- `create-im-meeting`
- `writeback-bdr-feedback` (replaced by inline write in spec §6.2)
- `promote-to-dealcoach` (spec §4.4)
- Possibly: `process-ae-self-submission`, current `send-handoff-notification` (repurposable)

**Recommendation:** in M10 (decommission), mark all of these `_deprecated_*` alongside `promote-to-dealcoach`. Keep deployed for one release cycle. Their callers (the BDR form, which doesn't exist yet) will go directly to the new functions in M4.

### 6.L — `assemble_coach_prompt` RPC vs ad-hoc Claude calls (spec §3)

CLAUDE.md rule #5: **all AI edge functions MUST use `assemble_coach_prompt` RPC** instead of `coaches.system_prompt` directly. Spec §3.3 has an inline prompt template.

**Recommendation:** Layer the spec's denial-criteria-aware user message ON TOP of the assembled system prompt. Concretely:
- Locate or create a "BDR First-Glance Coach" (template `is_template=true, org_id=NULL`, action `'process_transcript'` or new `'bdr_first_glance'`).
- `pre-qdc-decision` calls `assemble_coach_prompt(coach_id, null, '<action>')` for the system prompt.
- The user-message content is what the spec §3.3 template defines (denial criteria + lead submission + BANT + transcript + JSON output instructions).
- Write to `assembled_prompt_versions` (hash-deduped) per CLAUDE.md.

**Question for Joe:** OK with this layering? It honors CLAUDE.md while preserving the spec's denial-criteria mechanics. Alternative: bypass `assemble_coach_prompt` for this one function (would violate the CLAUDE.md rule).

---

## 7. Risks I want to flag

1. **The new flow eliminates the IM meeting layer entirely.** Existing data and functions tied to `im_meetings` become orphaned. Recommend an internal note that `im_meetings` table can be archived after pilot stability (not part of this build).

2. **The `process-bdr-submission` orchestrator is the natural entry point for the BDR form.** In the new flow, the form invokes `pre-qdc-decision` directly. If you ever want pre-decision enrichment (research), you'd add an orchestrator back. For now, deny-fast-from-BDR-data is the lean path.

3. **Concurrency on round-robin pool advance.** Spec §4.3 uses `FOR UPDATE` on `routing_pools` — correct. Need to verify the RPC isn't called from inside an outer transaction that holds incompatible locks. In `route-lead`, the RPC call should be sequenced before the deal insert (which acquires its own locks), not after.

4. **RLS on new tables vs. service-role edge function access.** Edge functions use `SUPABASE_SERVICE_ROLE_KEY`, which bypasses RLS. RLS protects browser-side reads (the BDR/AE-manager UI in M4-M6). Spec is aware of this — calling out for awareness only.

5. **No coach template exists for BDR first-glance.** Per the BDR/IM memory, two templates were cloned: "BDR Submission Coach" and "AE QDC Coach". The "BDR Submission Coach" is for the old scoring flow, not the new yes/no first-glance. We may need a new coach template **OR** repurpose the existing one. Flag in §6.L.

---

## 8. Recommended path forward

If you approve the recommendations in §6, M1 (migrations) plays out cleanly:

1. **M1.1** — `bdr_leads`: ADD `annual_revenue`, `hq_state`, `industry`, `accounting_team_size`, `conversation_id`, `ai_decision*`, `routed_to_ae_id`, `routed_at`, `deal_id`. EXTEND `stage` CHECK to include new values.
2. **M1.2** — `bdr_notes`: CREATE with RLS (BDR can SELECT/INSERT/UPDATE own; org isolation).
3. **M1.3** — `ae_denial_criteria`: CREATE with RLS + `is_ae_manager()` + `is_platform_admin()` helpers + `public_denial_criteria_for_bdr()` projection function.
4. **M1.4** — `routing_pools` + `routing_pool_members`: CREATE with RLS.
5. **M1.5** — `routing_rules`: ADD flat columns + new CHECK constraint + index.
6. **M1.6** — `deals`: ADD `bdr_lead_id`, `source`, `disqualified_at`, `disqualified_by`, `disqualification_reason_id`.
7. **M1.7** — `bdr_handoff_feedback`: ADD spec fields, extend CHECK.
8. **M1.8** — `advance_routing_pool(uuid)` RPC.
9. **M1.9** — `coach_research_config.verticals text[]` ADD (pending §6.G decision) and seed Sage Intacct pilot verticals.
10. **M1.10** — `bdr_my_lead_status` SECURITY INVOKER view (orchestration prompt requirement).

All migrations wrapped with `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` on new tables; BDR-specific policies inline per the orchestration prompt access matrix.

---

## 9. Files modified by M0

- Created: `docs/builds/lumen-bdr-submission-routing-spec.md` (spec saved verbatim from the build prompt)
- Created: `docs/audits/2026-05-11-bdr-routing-preflight.md` (this file)

No code or schema modifications in M0.
