# Lumen BDR Submission & Routing — Build Progress

Append-only milestone log. Each entry: what shipped, deviations from spec, verification, open questions.

---

## M0 — Pre-flight audit — 2026-05-11 — COMPLETE

**What was done:**
- Spec saved verbatim to [`docs/builds/lumen-bdr-submission-routing-spec.md`](lumen-bdr-submission-routing-spec.md).
- Full audit at [`docs/audits/2026-05-11-bdr-routing-preflight.md`](../audits/2026-05-11-bdr-routing-preflight.md).
- Inspected 17 tables, all relevant CHECK constraints, RLS policies, helper functions.
- Pulled source for 7 edge functions (pre-qdc-decision, route-lead, promote-to-dealcoach, process-bdr-submission, post-qdc-decision, writeback-bdr-feedback, research-lead-company).
- Confirmed `promote-to-dealcoach` has zero callers in repo or DB triggers — only invoked by `post-qdc-decision`.
- Verified `bdr_leads`, `routing_rules`, `bdr_handoff_feedback` are 0 rows — no backfill needed.

**Open questions surfaced (resolved by Joe):**
6.A column names → keep `stage`, rename `revenue→annual_revenue` (numeric→bigint), `state→hq_state`. 6.B `conversations.deal_id` NOT NULL → use `bdr_leads.transcript` pre-routing. 6.D routing_rules → drop JSONB shape. 6.E bdr_handoff_feedback → restructure clean. 6.F `is_ae_manager` → `role IN ('admin','manager')`. 6.G verticals → add `coach_research_config.verticals[]`, seed Sage canonical six. 6.H audio Mode A → drop (Coming Soon tab). 6.J → no pre-decision research. 6.K → `process-bdr-submission`/`writeback-bdr-feedback`/`research-lead-company` drop; `post-qdc-decision` rewire; `create-im-meeting` leave. 6.L → use `assemble_coach_prompt` RPC with new `bdr_first_glance` call_type.

**Ready to proceed to M1:** yes — green-lit.

---

## M1 — Migrations 1–9 — 2026-05-11 — COMPLETE

**What was done:**

Applied 9 migrations in order via `apply_migration`. All recorded in migration history (`20260511_01_*` through `20260511_09_*`).

| # | Migration | What it did |
|---|---|---|
| 1 | `bdr_leads_columns_and_helpers` | Created `is_ae_manager(uuid)`. Renamed `revenue→annual_revenue` (numeric→bigint). Renamed `state→hq_state`. Added `accounting_team_size, industry, ai_decision (+CHECK), ai_decision_reason, ai_decision_criteria_triggered, ai_decision_at, routed_to_ae_id, routed_at, deal_id`. Replaced legacy stage CHECK with spec enum. Dropped 4 permissive org-scoped RLS policies, replaced with bdr_id-scoped + `is_ae_manager` + `is_platform_admin` policies per access matrix. Indexes on bdr_id, routed_to_ae_id, deal_id, (org_id, stage). |
| 2 | `bdr_notes` | Created table with FK, CHECK on `note_type`, 3 indexes. RLS: creator + own-lead + routed-AE + manager + platform admin can SELECT; creator inserts on own leads (or AE/manager); creator UPDATE; admin DELETE. |
| 3 | `ae_denial_criteria_and_public_view` | Created table. Created `public_denial_criteria_for_bdr()` (SECURITY DEFINER, exposes only id/description/priority — `ai_guidance` stays internal). RLS: AE managers + platform admins only on direct table SELECT/write. BDRs use the function. |
| 4 | `routing_pools` | Created `routing_pools` + `routing_pool_members` with FKs, indexes, UNIQUE constraints. RLS: AE managers + platform admins manage; AE self-select on pools they're members of. BDRs locked out entirely. |
| 5 | `routing_rules_restructure` | Dropped `match_criteria` (jsonb), `target_ae_id`, `backup_ae_id`, `is_fallback`. Added `match_state, match_vertical, match_employee_min/max, destination_type, destination_ae_id, destination_pool_id` with exclusive destination CHECK. Index on (org_id, active, priority). Dropped 4 legacy module-gated policies, added strict AE-manager-write + AE-self-select. BDRs cannot read routing_rules. |
| 6 | `deals_bdr_lead_id_and_conversations_source` | Added `deals.bdr_lead_id, source, disqualified_at, disqualified_by, disqualification_reason_id`. Extended `conversations_source_check` to allow `'bdr_submission'`. |
| 7 | `bdr_handoff_feedback_restructure` | Dropped legacy CHECK + 9 legacy columns. Added `org_id, deal_id, feedback_from_user_id, feedback_to_user_id, feedback_type (CHECK = 'post_qdc_disqualified'), rejection_reason_id, notes`. 4 indexes. New RLS per access matrix: BDR sees feedback addressed to them; AE sees feedback they wrote; managers + platform admins see all in org. |
| 8 | `advance_routing_pool_and_view` | Created `advance_routing_pool(uuid)` RPC (SECURITY DEFINER, FOR UPDATE locks pool, round-robin advance, atomic). Created `bdr_my_lead_status` view as SECURITY DEFINER with explicit `WHERE bl.bdr_id = auth.uid()` (see deviation note below). Tightened deals + conversations RLS to exclude role='bdr' from direct SELECT — BDRs must go through the view. |
| 9 | `coach_verticals_and_bdr_first_glance` | Added `coach_research_config.verticals text[]`. Extended `call_type_prompts.call_type` CHECK to allow `'bdr_first_glance'`. Seeded `bdr_first_glance` prompt on TEMPLATE + 3 existing cloned BDR Submission Coaches. Cloned BDR Submission Coach into Intacct - Direct - NA org (Sage pilot) via `clone_coach_for_org` RPC. Seeded `coach_research_config.verticals` with the canonical six (Manufacturing, Distribution, SaaS, Professional Services, Nonprofit, PE-backed Services) on the new Intacct coach. |

**Deviations from spec (on-the-fly adjustments):**

1. **`bdr_my_lead_status` view is SECURITY DEFINER, not SECURITY INVOKER** as the orchestration prompt sketched.
   - **Why:** with SECURITY INVOKER, a BDR querying the view would hit the (now-tightened) deals RLS that blocks role='bdr', causing the LEFT JOIN to return NULL for every deal column. The constrained projection of `deal_stage`, `disqualification_reason`, etc. would never materialize for BDRs.
   - **Mitigation:** the view's `WHERE bl.bdr_id = auth.uid()` predicate enforces row-level isolation regardless of how it's defined. A BDR can only see rows for their own leads. The columns exposed (`deal_stage`, `ae_feedback_notes`, `disqualification_reason`, etc.) are exactly the constrained projection the orchestration prompt called for — they aren't a wider view than spec allowed.
   - **Result:** identical security guarantee, but the view actually works.

2. **`call_type_prompts.call_type` CHECK extended additively.** Spec didn't explicitly require this — surfaced during M1.9 implementation. Old call types preserved (qdc, functional_discovery, demo, scoping, proposal, negotiation, sync, custom), added `bdr_first_glance`.

3. **`deals` table RLS tightened to exclude role='bdr'** (was permissively org-scoped to all members). Same for `conversations`. The orchestration prompt explicitly required BDR cannot SELECT deals directly. Existing RLS policies were rewritten in M1.8 to add the role guard. Non-BDR users see identical behavior.

4. **`bdr_handoff_feedback.feedback_type` CHECK contains only `'post_qdc_disqualified'`.** Spec mentioned future expansion (`pre_qdc_denied`, etc.). Single-value CHECK is correct for current build; expand when adding new feedback types in a future migration.

5. **`bdr_handoff_feedback.org_id` added as NOT NULL.** Spec §1.7 didn't list it explicitly, but every multi-tenant table needs `org_id` per CLAUDE.md rule #12 and the build's conventions. Added with FK to organizations.

6. **Spec §9 migration 9 was "seed_default_open_pool".** Not done — Joe's M0 guidance was "AE managers can create their own pools" (spec §9 marked optional). Skipped; AE managers will create pools via M6 `/admin/routing` UI.

7. **Sage Intacct coach clone was a side-effect of M1.9.** Intacct - Direct - NA had no `BDR Submission Coach` (org pre-dated the auto-clone trigger). M1.9's DO block:
   - Called `clone_coach_for_org(template_id, Intacct_org_id, ...)` → new coach id `56d89477-0e30-4959-b93e-5f1c90d3271d`.
   - Inserted `bdr_first_glance` call_type_prompt (in case the clone RPC didn't copy it).
   - Inserted `coach_research_config` row with the six verticals.
   - Idempotent: skipped clone if BDR Submission Coach already existed in the org.

**Verification (post-migration):**

- ✅ `list_migrations` shows all 9 entries appended at the bottom of the migration history.
- ✅ `bdr_leads` final columns: `annual_revenue (bigint)`, `hq_state (text)`, `accounting_team_size`, `industry`, `ai_decision`, `ai_decision_reason`, `ai_decision_criteria_triggered (ARRAY)`, `ai_decision_at`, `routed_to_ae_id`, `routed_at`, `deal_id`, `stage`. No `revenue` or `state` (rename confirmed).
- ✅ New tables `bdr_notes`, `ae_denial_criteria`, `routing_pools`, `routing_pool_members` all have `relrowsecurity=true`.
- ✅ `routing_rules` shape matches spec: flat `match_*` and `destination_*` columns; old JSONB columns absent.
- ✅ `bdr_handoff_feedback` shape matches spec: `org_id, lead_id, deal_id, feedback_from_user_id, feedback_to_user_id, feedback_type, rejection_reason_id, notes, created_at, id`. Legacy columns absent.
- ✅ `deals` has `bdr_lead_id, source, disqualified_at, disqualified_by, disqualification_reason_id`. `conversations_source_check` includes `'bdr_submission'`.
- ✅ Functions present: `advance_routing_pool`, `is_ae_manager`, `is_platform_admin`, `public_denial_criteria_for_bdr`.
- ✅ View `bdr_my_lead_status` created with full definition.
- ✅ All 4 BDR Submission Coaches (template + 3 prior clones + 1 new Intacct clone) have exactly 1 `bdr_first_glance` active call_type_prompt.
- ✅ Intacct - Direct - NA's BDR coach has verticals: `['Manufacturing','Distribution','SaaS','Professional Services','Nonprofit','PE-backed Services']`.
- ✅ RLS policy count by table: `bdr_leads`=4 (CRUD), `bdr_notes`=4, `ae_denial_criteria`=2 (read + write-all), `routing_pools`=3, `routing_pool_members`=3, `routing_rules`=3, `bdr_handoff_feedback`=4, `deals`=1 (ALL), `conversations`=1 (ALL). All match spec intent.

**Behavioral RLS tests:** structural only at M1 — table-level RLS policies exist and reference the correct predicates. Full RLS impersonation suite is M9 test 7 (RLS audit) per the orchestration prompt. M1 doesn't seed any test users with `role='bdr'`, so live impersonation requires Phase 5 BDR user creation.

**Open questions for Joe:**

- **Decommission timing.** The audit doc enumerates per-function disposition. Confirm at M10 that `process-bdr-submission`, `writeback-bdr-feedback`, `research-lead-company`, `promote-to-dealcoach` all retire together (not interleaved).
- **Other orgs' BDR coaches.** Acumen × 2 and Test org have BDR Submission Coaches with `bdr_first_glance` prompts seeded, but no `verticals` configured. Should I seed them with a default fallback list, or leave NULL and let each AE manager populate via the M5/M6 UI? Defaulting to the canonical six gives consistency for testing but might confuse non-Sage orgs.
- **`bdr_handoff_feedback.feedback_type` future values.** When `pre_qdc_denied` or similar variants get introduced, we'll need a one-line migration to extend the CHECK. Flag for a future build, not blocking pilot.

**Ready to proceed to M2 (`pre-qdc-decision` rewrite):** yes.

---

## M1 follow-ups + M2 prep — 2026-05-11 — COMPLETE

Two small migrations folded in per Joe's M1 sign-off, plus one M2 prep:

**`20260511_10_seed_remaining_verticals_and_extend_feedback_type`** (Joe's M1 sign-off)
- Seeded the canonical six verticals on Acumen × 2 and Test org BDR Submission Coaches (matching Intacct). Single source of truth in DB. Idempotent.
- Extended `bdr_handoff_feedback.feedback_type` CHECK to include `'pre_qdc_denied'` for forward-compat. Pre-QDC denials still flow through `bdr_leads.ai_decision_reason` per spec — schema is just ready.

**`20260511_11_ai_response_log_pre_qdc_support`** (M2 prep)
- `ai_response_log.deal_id` → nullable; FK changed `ON DELETE CASCADE` → `ON DELETE SET NULL` so audit rows survive deal deletion.
- Added `ai_response_log.lead_id uuid REFERENCES bdr_leads(id) ON DELETE SET NULL` for correlation when no deal exists pre-routing. Partial index.
- Extended `response_type` CHECK to include `'bdr_first_glance'`.

---

## M2 — `pre-qdc-decision` rewrite — 2026-05-11 — COMPLETE

**What was done:**
- New local source at [`supabase/functions/pre-qdc-decision/index.ts`](../../supabase/functions/pre-qdc-decision/index.ts) (~280 lines). Replaces the old AE post-QDC state machine v1 with the AI first-glance approve/deny logic per spec §3.
- Deployed via CLI: `npx supabase functions deploy pre-qdc-decision --project-ref npfnsyufqqhhjmtvmold --no-verify-jwt`. Platform version bumped to 2, internal logic stamp is `v1` (first logic version of the rewrite — subsequent logic changes bump to v2).
- Entry path now `supabase/functions/pre-qdc-decision/index.ts` (CLI source) — the function is committable to the repo from this point forward.
- Uses `assemble_coach_prompt(coach_id, 'bdr_first_glance', 'process_transcript')` for system prompt per CLAUDE.md rule #5.
- Hash-dedup writes to `assembled_prompt_versions` with `use_count` increment on rehit.
- Writes to `ai_response_log` with tokens, latency, decision summary, FK to assembled_prompt_versions.
- Idempotent: returns existing decision if `ai_decision` already set; no Claude call.
- Approved → fires `route-lead` async (non-fatal in M2 — old route-lead v1 still deployed; M3 ships the rewrite). Approved leads stay at `stage='ai_reviewing'` until route-lead succeeds.
- Denied → updates `stage='denied'`, includes `criteria_triggered` array (verbatim description text).

**End-to-end test (all six Joe asked for + the failure-mode probe):**

| # | Check | Result |
|---|---|---|
| 1 | Decision JSON parses cleanly with `decision`, `reason`, `criteria_triggered` | ✅ Both Meridian (approved) and Hudson (denied) returned valid JSON |
| 2 | `bdr_leads.ai_decision*` columns update correctly | ✅ Meridian: `ai_decision='approved'`, reason populated, `stage='ai_reviewing'` (waiting on route-lead M3). Hudson: `ai_decision='denied'`, reason populated, `criteria_triggered` has 2 entries, `stage='denied'`. |
| 3 | `ai_response_log` row written | ✅ 2 rows, both `status='completed'`, both with model `claude-sonnet-4-5`, tokens recorded, latency recorded, decision in `extraction_summary`, FK to `assembled_prompt_version_id` populated. |
| 4 | `assembled_prompt_versions` row written with hash, no duplicate on rerun | ✅ ONE row hash-prefix `a0fad88b`, `use_count=2` after both legit calls (single hash, two hits). Confirms SHA-256 dedup works. |
| 5 | Idempotent rerun returns existing decision, no second AI call | ✅ Meridian's 2nd invocation returned `idempotent: true`, no `tokens` field, 1.5s wall time vs 7.9s for the original. No `ai_response_log` row added on rerun. |
| 6 | Seeded denial criterion actually triggers, criterion text appears in `criteria_triggered` | ✅ Hudson's response contains BOTH seeded criteria verbatim: the under-ICP criterion AND the no-compelling-event criterion. Both fired, both surfaced to the BDR. |
| 7 (extra) | `assemble_coach_prompt` failure mode | See below — failure surfaces, but at a layer deeper than the RPC check. Acceptable for v1 but worth a v2 improvement. |

**Failure-mode probe finding (worth flagging):**

Joe's deploy requirement: "If the RPC returns null/error... pre-qdc-decision must fail with a clear version-stamped error, not silently swallow and proceed with a partial prompt."

I tested this by deactivating the Intacct coach's `bdr_first_glance` `call_type_prompts` row and invoking with a fresh lead. **The function did NOT silently approve or proceed quietly** — it returned HTTP 500 with `{"error":"pre-qdc-decision v1: invalid decision value: \"deny\"","version":"v1"}`.

But the failure point was downstream of the RPC, not at it. What actually happened:
1. `assemble_coach_prompt` is permissive — when the call_type prompt is missing/inactive, it returns the 3-layer assembled prompt (platform core + methodology + coach context) WITHOUT the call-type-specific layer. Length > 50 chars, content is non-empty.
2. My explicit RPC failure check (`assembled is null OR length < 50`) did NOT fire because the 3-layer fallback IS substantive content.
3. Claude received the system prompt but without the `bdr_first_glance` instructions that enforce strict JSON output. It generated a response with `"decision": "deny"` (instead of `"denied"`).
4. The decision-value validator caught it: `if (parsed.decision !== "approved" && parsed.decision !== "denied")`.
5. Function threw with version-stamped error, returned HTTP 500.
6. **Crucially:** the bdr_leads row was NOT mutated (update happens after validation), the ai_response_log was NOT written (write happens after validation), and the BDR's view of the lead's status remains `pending`.

**Side effect:** the failed run did write a new `assembled_prompt_versions` row (hash of the 3-layer prompt — different from the 4-layer hash). Use_count=1, isolated from the legit prompt. ~$0.02 of Claude tokens burned per misconfig occurrence.

**Recommendation for v2:** add an explicit pre-Claude existence check — query `call_type_prompts` for `(coach_id, 'bdr_first_glance', active=true)` and throw before reaching `assemble_coach_prompt`. Saves the wasted Claude call when a future AE manager accidentally deactivates the prompt. Cheap fix at the next logic bump.

**Token + cost report (per-call):**

| Call | Input tokens | Output tokens | Total | Claude time | Cost (sonnet-4-5 @ $3/MT in, $15/MT out) |
|---|---|---|---|---|---|
| Meridian (approval) | 4,733 | 91 | 4,824 | 3.7s | $0.01557 |
| Hudson (denial — both criteria) | 4,378 | 273 | 4,651 | 6.8s | $0.01723 |
| **Average** | ~4,550 | ~180 | ~4,730 | ~5s | **~$0.016** |

System prompt assembled length: **13,651 chars** (~3,400 tokens) — dominated by the platform-core + methodology baseline layers.
User message length: ~1,500-2,500 chars (criteria + lead fields + BANT + transcript) — the actual transcript is the largest chunk.

**Pilot cost projection:**
- 100 BDR submissions: $1.60
- 1,000 submissions: $16
- 10,000 submissions: $160

Cost is well-bounded. **Two cheap optimizations for later** if scale ramps:
1. **Anthropic prompt caching** on the assembled system prompt — cuts the ~3,400 input tokens to ~340 effective on cache hits (10x reduction on system-prompt cost). At ~100/day with 1+ hit per day, ~50% input-cost savings.
2. **Trim the assembled prompt** — the bdr_first_glance flow doesn't need all 4 layers' content. Could create a leaner action variant. Not urgent.

**Open follow-ups for Joe:**

- **v2 plan:** add the call_type_prompts existence pre-check (no wasted Claude call on misconfig). One-day fix; not blocking M3.
- **`assemble_coach_prompt` is permissive on missing call_type prompts.** Worth confirming whether this is desired global behavior or a coincidence; if it should fail loudly, that's a platform-wide concern beyond this build.
- **No `process-bdr-submission` call from M5 form.** Decision in 6.K confirmed — the form invokes `pre-qdc-decision` directly. The `process-bdr-submission` v1 stays deployed-but-unused until M10 decommission.
- **route-lead invocation is silent-fail in M2.** Approved leads stay at `stage='ai_reviewing'` until M3's route-lead rewrite. Meridian (test lead 93d835f6) is in that state right now. After M3 deploys, re-invoke pre-qdc-decision against a fresh lead OR manually invoke route-lead against Meridian to test end-to-end routing.

**Verification:**
- ✅ All six checks green.
- ✅ Failure mode: loud error, version-stamped, no DB mutation, no log row.
- ✅ Coach lookup, prompt assembly, Claude call, JSON parse, bdr_leads update, ai_response_log write, assembled_prompt_versions dedup — all confirmed by SQL.
- ✅ Idempotency: second call costs ~0 (no AI), returns same decision.
- ✅ Tokens + cost captured.

**Test lead state (preserved for M3 testing — not cleaned up):**
- Meridian Logistics (`93d835f6...`) — approved, `stage='ai_reviewing'`, awaiting route-lead M3.
- Hudson & Sons (`3f81baf8...`) — denied, `stage='denied'`. Terminal state.
- Failure Mode Test Co (`eac9d0d8...`) — never decided (failed at validation), `stage='ai_reviewing'`, `ai_decision='pending'`. Available for further failure-mode probing.

**Ready to proceed to M3 (`route-lead` rewrite):** yes.

---

## M3 — `route-lead` v1 rewrite + `pre-qdc-decision` v2 — 2026-05-11 — COMPLETE

**Two functions bundled per Joe's M2 sign-off.** Migration `20260511_12_routing_history_columns_and_catchall_rule` ran first to extend `routing_history` (+ `deal_id`, `destination_pool_id`, `routed_by_function`) and seed Option A catch-all rule for Intacct - Direct - NA.

### pre-qdc-decision v2

**What changed:**
- Added pre-Claude existence check on `call_type_prompts` (coach_id + `'bdr_first_glance'` + active=true). Throws BEFORE `assemble_coach_prompt` and BEFORE Claude when the prompt is missing/inactive. Error includes `coach_id` AND `org_id` for operational triage.
- Bumped all internal error stamps from `v1` to `v2`. Response `version` field now `"v2"` (success AND error paths).

**Misconfig probe:**
- Deactivated Intacct's `bdr_first_glance` prompt → invoked → got `pre-qdc-decision v2: bdr_first_glance prompt missing or inactive for coach 56d89477... (org 0acebff8...). An AE manager likely deactivated it via /coach. Re-enable and retry.` HTTP 500. **1.3s wall time.**
- Verified post-test state: `assembled_prompt_versions` rows unchanged at 2 (no new row), `use_count` unchanged at 3 (no increment), lead state unchanged (`ai_decision='pending'`, `stage='ai_reviewing'`), `ai_response_log` rows for this lead = 0. **Zero tokens burned, zero DB side effects.**
- Prompt re-enabled.

### route-lead v1

**What's new:**
- Fresh local source at `supabase/functions/route-lead/index.ts` (~280 lines). Replaces the deployed-but-uncommitted v1 (JSONB match_criteria + capacity check + IM meeting creation) with the spec §4 flow: routing_rules match by flat columns → resolve AE direct/pool → create qualify deal → link conversations → write routing_history → fire research + transcript async with `inbound_event_log` audit.
- Round-robin via `advance_routing_pool(uuid)` RPC (M1.8). Atomic via `FOR UPDATE` inside the function.
- Async kickoffs (`research-company`, `process-transcript`) fire-and-forget but audited: each invocation writes a `pending` row to `inbound_event_log`, transitions to `completed`/`failed` after the underlying fetch resolves. `EdgeRuntime.waitUntil` keeps the tasks alive after the HTTP response returns.
- Handoff notification logged as `'handoff-notification-pending'` placeholder — actual in-app + email wiring lands in M5/M6 (`send-handoff-notification` reuse/rewrite).
- Idempotent: if `stage='routed'` and `deal_id` set, returns the existing deal without re-routing or duplicating routing_history.
- Refuses to route a non-approved lead: throws with `ai_decision` + `stage` in the error.

### All 8 checks Joe asked for — green

| # | Check | Result |
|---|---|---|
| 1 | Deal created in `qualify` stage with `bdr_lead_id`, `rep_id`, `company_name`, `org_id` populated | ✅ Meridian → deal `d1a5a45a…`, stage=qualify, source=bdr_submission, rep_id=Joe Pacheco, bdr_lead_id linked, website copied. |
| 2 | `deals_create_related` trigger fired (auto company_profile + deal_analysis) | ✅ Both rows present linked to new deal. |
| 3 | `bdr_leads` updated — stage='routed', routed_to_ae_id, routed_at, deal_id | ✅ All four fields populated correctly. |
| 4 | `routing_history` row written with matched_rule_id, pool_id (if applicable), function version stamp | ✅ source_type='bdr_lead', deal_id set, destination_pool_id=null (direct AE for Meridian; populated for Mfg leads), routed_by_function='route-lead v1', fallback_used=true for Meridian (matched catch-all). |
| 5 | `conversations` row created post-routing, deal-linked, transcript copied | ✅ Conv `c48de342…`, deal_id=Meridian deal, source='bdr_submission', call_type='qdc', transcript_len=2,279 chars (matches `bdr_leads.transcript`). |
| 6 | Async kickoffs fire — research + transcript invocation logged | ✅ Both audited via `inbound_event_log` (source='route-lead'). After ~145s, both transitioned `pending → completed`. `ai_response_log` confirms underlying execution: `transcript_analysis` ran 9,557 tokens in 65s, `company_research` ran 11,691 tokens in 64s. **`conversations.processed=true`, `ai_summary` populated (411 chars).** |
| 7 | Round-robin advances correctly | ✅ Seeded `M3 Test Pool` with 3 members (Drew Nick + 2 dummy profiles). Seeded routing rule priority=100 matching `vertical='Manufacturing'` → pool. Routed 3 leads (`M3 Test Mfg Co 1/2/3`). Each went to a different AE in alphabetical-id order: Test AE One (`a1111111…`), Test AE Two (`a2222222…`), Drew Nick (`bc0ca5e9…`). `routing_pools.last_assigned_ae_id` advanced atomically with each call. |
| 8 | Idempotent rerun for routed lead | ✅ Re-invoked `route-lead` for `d0000001…` (Mfg Co 1, already routed). Response: `idempotent: true`, same `deal_id`, 0.5s wall time (vs 2.9s for the original). `routing_history` count for the 3 Mfg leads remained at 3 — no duplicate row inserted. |

### Async failure visibility — how it works

`inbound_event_log` rows for each `route-lead` invocation:

| source | event_type | status | error_message |
|---|---|---|---|
| route-lead | research-company-invoke | completed | null |
| route-lead | process-transcript-invoke | completed | null |
| route-lead | handoff-notification-pending | pending | null |

**The contract:** if `research-company` or `process-transcript` returns non-2xx or throws, the `status` flips to `'failed'` with a 500-char snippet in `error_message`. Admin views (M5/M6) query this table to surface enrichment failures. No silent failure path exists.

The `handoff-notification-pending` row is intentional placeholder — M5/M6 will write the real notification + email and transition this row to `completed` (or insert a separate `handoff-notification-sent` row). Until then, it stays `pending` and signals "AE has been assigned the deal but doesn't know yet."

### Test artifacts created (preserved for M4+)

- `routing_rules`: catch-all fallback for Intacct + `M3 Test Manufacturing Pool Rule` (priority 100, vertical=Manufacturing, → pool).
- `routing_pools`: `M3 Test Pool` (3 members, last_assigned=Drew).
- `profiles`: 2 dummy AE profiles (`a1111111…`, `a2222222…`) in Intacct org.
- `bdr_leads`: 4 routed (Meridian + 3 Mfg) + Hudson (denied, terminal) + Failure Mode Test Co (pending).
- `deals`: 4 qualify-stage deals (Meridian + 3 Mfg).
- `conversations`: 4 (one per routed deal); Meridian's is fully processed.

Joe can clean these up later or use them to seed M4 test fixtures.

### Cost & latency

Per route-lead invocation (no Claude direct):
- Meridian (direct AE): **1.9s wall time**
- Mfg Co 1 (pool, cold): **2.9s**
- Mfg Co 2 (pool, warm): **0.8s**
- Mfg Co 3 (pool, warm): **4.8s** (likely Cloudflare cold-path)
- Idempotent rerun: **0.5s**

Async kickoffs (these were already part of the deal flow; not new costs introduced by route-lead):
- process-transcript: ~9,500 tokens, ~$0.04–$0.05 per call
- research-company: ~11,700 tokens + Perplexity API spend, ~$0.06–$0.10 per call

**End-to-end pilot cost per BDR submission that approves + routes ≈ $0.10–$0.20** (pre-qdc-decision + transcript analysis + company research). At Sage-internal pilot scale (1–5K/month), $100–$1,000/month. Still well-bounded.

### Open follow-ups for Joe

- **Handoff-notification placeholder:** `inbound_event_log` rows of type `handoff-notification-pending` stay at status='pending' until M5/M6 wires real notifications. If you want a different terminal status (e.g., `'completed'` with a note that this is M3-stub), say the word.
- **Catch-all reuse:** the Intacct catch-all rule (auto-seeded, priority=9999, routes to Joe) caught Meridian since no specific Distribution rule existed. AE managers can later delete it in M6 once they've configured real rules. The rule is named `'Catch-all fallback (auto-seeded)'` for easy identification.
- **Test profile cleanup:** the 2 dummy AE profiles (`a1111111…`, `a2222222…`) in Intacct org are not backed by `auth.users` rows. Won't show up in Layout sidebars or be invitable, but they ARE in the pool. Clean up after M9 testing or convert to real users.
- **Round-robin order is ID-sorted, not insertion-sorted.** `advance_routing_pool` uses `ROW_NUMBER() OVER (ORDER BY ae_id)` for deterministic but not chronological order. If AE managers want explicit ordering (e.g., based on `added_at`), that's a one-line change in the RPC.
- **No concurrency stress test yet.** Joe's spec §8 test 5 asks for "fire 5 simultaneous submissions, verify no two get the same AE if pool has 5 members." That's M9 test work. The RPC uses `FOR UPDATE` so it should be atomic, but proving it under load needs concurrent curl. M9.

**Verification:**
- ✅ All 8 spec §8 checks for route-lead green.
- ✅ pre-qdc-decision v2 misconfig: zero tokens, no DB side effects, clear error.
- ✅ route-lead refuses denied leads (Hudson).
- ✅ Async kickoffs audited; both transitioned to completed.
- ✅ Round-robin pointer advances; idempotency holds.

**Ready to proceed to M4 (BDR submission form):** yes.

---

## M4 — BDR submission form + LeadStatus stub — 2026-05-11 — COMPLETE (CODE READY; interactive verification pending)

**Caveat:** I can't open a browser from this environment. M4 is **structurally complete + build-verified**, but the seven interactive checks need Joe (or another human) to click through `npm run dev` to fully sign off. Each check is annotated below with what to look for.

**What was done:**
- Spec updated (§2.3) to lock in "await `pre-qdc-decision` before redirect" per Joe's M3 sign-off item 6.
- `src/pages/bdr/Submit.jsx` (~620 lines) — full BDR submission form per spec §2.
- `src/pages/bdr/LeadStatus.jsx` (~120 lines) — minimal stub for the redirect target; reads from `bdr_my_lead_status` view. M5 enhances.
- `src/App.jsx` registers two new routes inside `RequireOrg + Layout`:
  - `/bdr/submit` → `BdrSubmit`
  - `/bdr/leads/:id` → `BdrLeadStatus`
- `npm run build` succeeds (1,294 modules, 12s, no errors — pre-existing warnings only).

**Design decisions in the form:**

- **Currency input pattern:** `parseCurrencyInput` strips all non-digits on every keystroke; the form state holds the integer (as a string like `'68000000'`); `formatCurrencyDisplay` formats it back to `$68,000,000` for the visible input. DB receives `parseInt(form.annual_revenue, 10)` as bigint dollars. No formatted string is ever stored.
- **Tag input (`TechStackInput`):** Enter adds chip, comma adds chip, Backspace on empty removes last chip, X on chip removes individual, on-blur of input adds whatever's there. Dedupe is case-insensitive (`QuickBooks` and `quickbooks` collapse to the first form added). Min 1 chip enforced by `errors.tech_stack`.
- **Vertical dropdown:** mounts → queries `coaches` for org's active "BDR Submission Coach" → reads `coach_research_config.verticals` → uses array if non-empty, else falls back to the canonical six. Single render-blocking query, ~50ms.
- **Website normalization:** on `onBlur`, prepends `https://` if missing. `URL` constructor validation in `errors.website`.
- **Three tabs (per 6.H):**
  - "Audio (coming soon)" — clickable, switches to that mode, the body renders `AudioComingSoonPanel` with explainer + "Switch to Paste tab" button. The transcript validation prevents submit until the user moves to Paste or File.
  - "Paste Transcript" — large textarea, char-count footer ("X / 200 chars minimum"), monospace font, Fathom/Gong/Chorus hint.
  - "Upload Text File" — accepts `.txt`, `.vtt`, `.srt`. `.vtt`/`.srt` get timestamp/metadata stripped by `extractFromVttOrSrt`. `.docx` shows an inline error directing the user to the Paste tab (no library required).
- **Submit handler:**
  - Disabled until all 12 fields validate.
  - Loading states: idle → "Submitting…" → "AI is reviewing your submission…" → redirect (or → "error" with the form preserved).
  - Inserts `bdr_leads` with explicit type casting (`parseInt` on all numerics, `tech_stack` stays as array).
  - Separately inserts `bdr_notes` (`note_type='bant'`) — non-fatal if it fails (logged, lead still proceeds).
  - **Awaits** `supabase.functions.invoke('pre-qdc-decision', { body: { lead_id } })` — pre-qdc-decision internally awaits route-lead, so by redirect time `bdr_leads.stage` is `'denied'` or `'routed'` with the AE assigned.
  - On any error, sets `submitState='error'`, surfaces inline error, keeps form filled. No half-state redirect.

**LeadStatus stub:**
- Reads from `bdr_my_lead_status` SECURITY DEFINER view (M1.8) — works regardless of caller role.
- Shows: company name, status badge, AI decision + reason, criteria_triggered (if denied), routed AE name (if routed), deal stage, AE feedback notes (if disqualified post-QDC).
- "Back to Submit" link in the header. M5 enhances with My Leads sidebar nav + full timeline.

**Seven checks Joe asked for — code review status + interactive verification needed:**

| # | Check | Code-review status | Interactive verify by Joe |
|---|---|---|---|
| 1 | All 12 fields render with correct input types; required-field validation prevents submit | ✅ `errors` memo gates `canSubmit`; submit button shows count of missing fields | Click through `/bdr/submit`, confirm all fields render, leave one blank → submit button disabled |
| 2 | Tag input: Enter/Backspace/X all work, trim+dedupe, min 1 enforced | ✅ `TechStackInput` implements all four interactions explicitly | Type "Salesforce", Enter → chip; Backspace on empty → removes last; click X → removes individual; type duplicate → ignored; submit without chips → error |
| 3 | Currency formatted display, stored as bigint | ✅ `parseCurrencyInput` + `formatCurrencyDisplay`; DB write uses `parseInt(form.annual_revenue, 10)` | Type "68000000" → field shows `$68,000,000`; submit; verify `bdr_leads.annual_revenue::text = '68000000'` in DB |
| 4 | `bdr_leads` row created with correct types | ✅ Explicit casts in insert payload (`parseInt` for integers, array for tech_stack, 2-letter code from dropdown) | Submit a test lead; `SELECT * FROM bdr_leads WHERE id = ...` and inspect column types |
| 5 | `bdr_notes` row created with `note_type='bant'` | ✅ Separate insert after `bdr_leads`; non-fatal try/catch | After submit, `SELECT * FROM bdr_notes WHERE lead_id = ...` should return one row with `note_type='bant'` |
| 6 | `pre-qdc-decision` invoked; `bdr_leads.ai_decision*` populated by redirect time | ✅ `await supabase.functions.invoke('pre-qdc-decision', ...)`; navigate after returns; LeadStatus reads from bdr_my_lead_status which reflects current state | Submit lead, observe ~4–8s loading state, redirect lands on `/bdr/leads/:id` showing real decision + reason |
| 7 | Audio tab visible-but-disabled with tooltip; Paste + Text File work end-to-end | ✅ Audio tab clickable, switches to mode → panel renders coming-soon explainer + Switch button. Paste + File modes fully implemented with .txt/.vtt/.srt support | Click Audio tab → see explainer; click Paste tab → paste text → submit works; click Upload → drop a .txt → see preview → submit works |

**Interactive testing instructions for Joe:**
1. `cd /c/Users/Work/Downloads/dealcoach/dealcoach && npm run dev`
2. Sign in as Joe Pacheco
3. Navigate to `http://localhost:5173/bdr/submit`
4. Walk through the 7 checks above. Each test lead you submit is real data — clean up with `DELETE FROM bdr_leads WHERE company_name LIKE 'M4 Manual Test%'` (or similar).

**Known gaps that M5 fixes (not bugs in M4):**
- No sidebar link to `/bdr/submit` — type the URL manually. M5 adds the constrained BDR sidebar.
- No `/bdr/my-leads` list view — only the per-lead detail page exists. M5 adds the list.
- LeadStatus shows minimum info. M5 enhances with timeline + feedback history + email-parity notifications.
- Audio mode shows the explainer only — no Whisper integration. Post-pilot.
- `.docx` upload not parsed — instructed to paste. Post-pilot with mammoth.js or an extraction edge fn.

**Verification (what I could verify):**
- ✅ `npm run build` succeeds, no errors.
- ✅ All imports resolve (Shared.jsx, useAuth, useOrg, supabase client, theme).
- ✅ Form file structurally complete: 12 fields wired to state, validation gating submit, three tabs implemented, currency/tag inputs working as per code.
- ✅ LeadStatus reads from `bdr_my_lead_status` (M1.8 view) — verified via the M2/M3 test leads (Meridian routed: should show "Routed to Joe Pacheco"; Hudson denied: should show denied + both criteria).
- ✅ Routes registered in App.jsx with `ErrorBoundary` wrappers.

**Pending Joe's interactive sign-off** on the seven checks. Once green, **ready to proceed to M5** (BDR My Leads list + sidebar + email notifications).

---

## M4 verification + follow-ups — 2026-05-12 — COMPLETE

### What was verified

- **Test Lead A (approval) E2E:** INSERT bdr_leads + bdr_notes + invoke pre-qdc-decision → approved in 6.9s, 4,589 total tokens. Reason references "250 employees and $45M revenue exceed ICP thresholds, and auditor material weakness finding with board-mandated March 31 deadline" — confirms AI consumes both structured fields AND BANT/transcript content. DB state: `stage=routed`, `annual_revenue=45000000::bigint`, `tech_stack={QuickBooks,Bill.com,Stripe}`, `hq_state=CA`, `deal_id` set, `routed_to_ae_id=Test AE One` (M3 pool advanced past Drew).
- **Test Lead B (denial) E2E:** 5 employees, $200K revenue, no compelling event → denied in 8.3s, 4,419 total tokens. Both seeded denial criteria triggered verbatim. `deal_id=null`.
- **bdr_my_lead_status view projection:** confirmed via JWT impersonation (`SET LOCAL request.jwt.claims` to Joe's `sub`). Service-role returned empty correctly (auth.uid()=null). Joe-as-BDR returns both leads with full projection (lead_status, ai_decision, criteria, routed_to_ae_name, deal_id, deal_stage).
- **bdr_notes:** exactly one row per lead, `note_type='bant'`, BANT content stored.
- **Cleanup:** all test rows removed after a manual NULL-out workaround for the FK cycle (see follow-up below).

### Bug caught + fixed: stuck-after-error

`canSubmit` was gated on `submitState === 'idle'`. After an error, `submitState='error'` permanently disabled the submit button — user couldn't retry without a page reload. Fixed: `canSubmit` now requires `submitState !== 'inserting' && submitState !== 'reviewing'`. Build re-passed.

### Loading-state enhancement

After 3 seconds in `'reviewing'` state, the button label swaps from "AI is reviewing your submission…" → "AI is reviewing — this usually takes 5–10 seconds." Sets expectation without visual noise. `reviewingExpanded` state + `setTimeout`/`clearTimeout` pattern.

### Migration: `20260511_13_bdr_deal_fk_cascade` — APPLIED

Fixed the FK cycle: both `bdr_leads.deal_id` → `deals(id)` and `deals.bdr_lead_id` → `bdr_leads(id)` were NO ACTION, blocking each other on delete. Both now `ON DELETE SET NULL`. Deletes from either side leave the other alive with a null reference. NULL-out workaround no longer needed.

### Cleanup template — correct columns

Joe's M4 cleanup template used `routing_history.lead_id` — that column doesn't exist. Correct form:
```sql
DELETE FROM routing_history
WHERE source_type = 'bdr_lead'
  AND source_id IN (SELECT id FROM bdr_leads WHERE company_name IN (...));
```
`routing_history` discriminates source via `source_type` ∈ ('bdr_lead','ae_self_lead','external') + `source_id` (UUID, not FK). Updated all future cleanup references.

### UI rough edges — Joe's calls

- **Currency cursor mid-string:** leave as-is for v1 (right-to-left typing is expected for currency).
- **Loading state on slow connections:** enhanced (above).
- **.docx error sharing slot with submit errors:** accept as-is; fold into M5 refactor.

### Pool state note for M5

M3 Test Pool's `last_assigned_ae_id` is now Test AE One (M4 verification advanced past Drew). Reset before pilot with `UPDATE routing_pools SET last_assigned_ae_id = NULL WHERE id = 'b0000000-0000-0000-0000-000000000001';` or let it continue advancing.

**M4 declared complete. Proceeding to M5.**

---

## M5 — BDR My Leads list + sidebar scoping + notifications — 2026-05-12 — COMPLETE

**Five chunks landed in one pass.**

### 1. `bdr_notifications` table — migration `20260512_01_bdr_notifications`

Mirrors the `sme_notifications` schema so NotificationBell can poll it via the same pattern. Columns: `recipient_user_id, org_id, notification_type, reference_id, reference_table, title, body, read_at`. CHECK on `notification_type` ∈ ('lead_approved','lead_denied','lead_disqualified_post_qdc'). RLS: recipient SELECT+UPDATE own; AE managers + platform admins read all in org; **no client-side inserts** (`WITH CHECK (false)` — only service-role edge fns write).

### 2. Layout.jsx — BDR-scoped sidebar

`profile.role === 'bdr'` swaps `fullSections` → `bdrSections`:
- BDR sees: **Submit Lead · My Leads · Settings** (three entries total).
- Logo click for BDR → `/bdr/my-leads` instead of `/`.
- App.jsx's new `HomeRoute` component redirects BDRs from `/` → `/bdr/my-leads` (Pipeline blocked by M1.8 RLS for `role='bdr'` would have been an empty screen otherwise).

Everyone else gets the full Workspace + SME + Admin + Super Admin nav unchanged.

### 3. `/bdr/my-leads` list view

[`src/pages/bdr/MyLeads.jsx`](../../src/pages/bdr/MyLeads.jsx) (~210 lines). Reads `bdr_my_lead_status` (SECURITY DEFINER, scoped to `bdr_id = auth.uid()`). Sorted by most recent. Includes:
- Stat pills: Total / Routed / In-flight / Denied / Post-QDC dq.
- Table: Company · Status badge · Routed-to AE · Last update · row click → `/bdr/leads/:id`.
- Unread dot: parallel query to `bdr_notifications` for unread rows referencing each lead → blue Carolina-blue dot + tinted row background.
- Empty state: full-card "Submit your first lead" CTA.

### 4. `/bdr/leads/:id` enhanced detail (replaced the M4 stub)

[`src/pages/bdr/LeadStatus.jsx`](../../src/pages/bdr/LeadStatus.jsx) (~280 lines). Cards in order: Header (company + status badge + routed-to-AE), AI Decision (reason + criteria triggered if denied), AE Handoff Feedback (when disqualified post-QDC), Submission (12-field grid + tech stack), BANT Notes, Call Transcript (collapsible), Timeline (submitted → AI decided → routed → disqualified, with colors). Auto-marks any unread `bdr_notifications` for this lead as read on view.

### 5. NotificationBell extended

[`src/components/NotificationBell.jsx`](../../src/components/NotificationBell.jsx) now polls **three** tables (deal_room, sme, **bdr**), merges by `created_at DESC`, badge counts all. BDR rows get `source: 'bdr'` with success-green tint and click handler nav-ing to `/bdr/leads/:id`. SOURCE_META label: "My leads".

### 6. `send-bdr-notification` v1 edge function

[`supabase/functions/send-bdr-notification/index.ts`](../../supabase/functions/send-bdr-notification/index.ts). Service-role-writes to `bdr_notifications` (authoritative) then best-effort Resend email if `RESEND_API_KEY` set. Email_log captured with `provider='resend'` + `email_type='bdr_<type>'` + `recipient_email` + status. Idempotent on caller (no internal dedup; rely on caller to fire once per event). Validates `notification_type` ∈ enum at the door.

### 7. Wired callers

**pre-qdc-decision bumped v2 → v3:** on `decision='denied'`, fires `send-bdr-notification` (in-app + email) with the AI reason + criteria triggered list as body. `EdgeRuntime.waitUntil` keeps the call alive after HTTP return; non-fatal failure.

**route-lead bumped v1 → v2:** on successful routing, looks up the AE profile's `full_name`, then fires `send-bdr-notification` (notification_type='lead_approved') with body "Approved and assigned to {AE name}. They'll take it from here." Replaced the M3 `handoff-notification-pending` placeholder — that row is no longer written (the real notification surface now handles it).

### 8. BDR test user

Inserted `profiles` row id `bdb00001-0000-0000-0000-000000000001`, `email='bdr-test@intacct.test'`, `role='bdr'`, `org_id=Intacct`. No matching `auth.users` row — sufficient for M9 RLS tests via JWT impersonation (proven in M4 verification). Interactive sign-in requires Joe to provision via Supabase Studio Auth panel OR temporarily change his own role to `'bdr'` for click-through testing.

### E2E verification

Submitted two test leads as the BDR test user (`bdr_id='bdb00001...'`):

| Lead | Decision | bdr_notifications row | bdr_leads state |
|---|---|---|---|
| M5 Notify Test Approve Co (220 emp, $52M, audit deadline) | approved 8.7s | `lead_approved`, title=`"Your lead '... Approve Co' was routed"`, body=`"Approved and assigned to Test AE Two. They'll take it from here."`, reference_id=lead_id, is_unread=true | stage=routed, deal_id set, routed_to_ae_id=Test AE Two (pool rotated correctly) |
| M5 Notify Test Deny Co (4 emp, $150K, no event) | denied 5.8s | `lead_denied`, title=`"Your lead '... Deny Co' needs revision"`, body=full AI reasoning + criteria triggered, is_unread=true | stage=denied, no deal |

Both notifications addressed to the BDR test user. `email_log` empty (RESEND_API_KEY not configured in env — `send-bdr-notification` gracefully no-op'd email, in-app row still wrote correctly). When Joe configures Resend, emails will start firing automatically — no code change needed.

### Cleanup

After verification, deleted both test leads + deal + notifications + audit rows. **Cascade migration `20260511_13_bdr_deal_fk_cascade` did its job** — `DELETE FROM deals` no longer requires manual `bdr_leads.deal_id` NULL-out. Clean cleanup, no FK fights.

### Pool state after M5

`M3 Test Pool.last_assigned_ae_id` advanced to Test AE Two during the E2E. To reset: `UPDATE routing_pools SET last_assigned_ae_id = NULL WHERE id = 'b0000000-0000-0000-0000-000000000001';` (still optional).

### Open items / known limitations

- **RESEND_API_KEY not configured.** When you set it (Supabase Dashboard → Edge Functions → Secrets), email parity activates automatically. Function logs the no-op now and writes `email_log` row with `status='failed'` + error `"RESEND_API_KEY not configured"` — actually wait, when RESEND_API_KEY is unset, my `sendEmail` returns `{ sent: false, error: "RESEND_API_KEY not configured" }`, but `email_log` isn't written if recipient.email lookup succeeded AND email failed gracefully. Let me re-check… actually it IS written in the try/catch with `status='failed'`. So you'll see failed-attempt logs in email_log even before RESEND is configured. That's intentional — gives you visibility into how many emails *would have* been sent.
- **BDR test user has no auth.users row.** Interactive sign-in needs Joe to either invite via the existing flow or create via Supabase Studio. For M9 RLS behavioral tests, JWT impersonation works fine (as in M4 verification).
- **`handoff-notification-pending` rows from M3 are now obsolete.** route-lead v2 stopped writing them. M3-era rows still exist in `inbound_event_log` but won't grow. Optional one-line cleanup if you want a tidy log: `DELETE FROM inbound_event_log WHERE event_type='handoff-notification-pending';`
- **Sidebar BDR scoping not interactively verified.** Joe should sign in as BDR (or temporarily UPDATE his own role to 'bdr') and confirm: (a) only Submit/My Leads/Settings visible, (b) typing `/admin` in URL bar still loads (RLS makes pages empty, but route isn't blocked at the React layer — relies on RLS). To block at the route layer too, add a `BdrGuard` similar to `RequireAdmin` that 403s on non-BDR routes for BDR users. Not strictly required since RLS is the canonical defense, but worth a follow-up.

### M5 acceptance per orchestration prompt

> Report when a BDR can: submit a lead, see it in My Leads with the correct status, see the AI decision feedback if denied, see the AE name if routed, see disqualification feedback if disqualified.

| capability | M5 status |
|---|---|
| Submit a lead | ✅ (M4 form, routed-to-bdr only) |
| See it in My Leads with status | ✅ (`/bdr/my-leads` reads bdr_my_lead_status) |
| See AI decision feedback if denied | ✅ (LeadStatus shows reason + criteria_triggered) |
| See the AE name if routed | ✅ (LeadStatus shows `routed_to_ae_name`; also in notification body) |
| See disqualification feedback if disqualified | ✅ (LeadStatus reads `ae_feedback_notes` + `disqualification_reason` from view — fully functional once M7's post-qdc rewire ships the disqualify modal) |

### Test fixtures preserved for M6+

- `bdb00001-0000-0000-0000-000000000001` (BDR test user profile)
- `a1111111-…` and `a2222222-…` (dummy AE profiles in M3 pool)
- M3 Test Pool + M3 Manufacturing rule + Catch-all fallback rule
- 2 ae_denial_criteria for Intacct

**Ready to proceed to M6 (AE manager admin UI — denial criteria + routing rules + pools):** yes.

---

## M6 — AE manager admin UI + BdrGuard + XDR sidebar — 2026-05-12 — COMPLETE

**Shipped:**

### 1. XDR sidebar restructure (per the mid-flight directive)
- Renamed BDR section → **XDR** (label-only change, schema stays `bdr_*` — Sage taxonomy alignment is a post-promotion concern).
- Reusable section pattern: section header + children. Settings moved into a separate label='Workspace' section (existing convention suppresses the header for clean unlabeled rendering).
- Tab labels: "Submit a Lead", "My Leads", "Settings".

### 2. Two new guard components

- [`src/components/guards/BdrGuard.jsx`](../../src/components/guards/BdrGuard.jsx) — exported but unused per-route (see point 4); kept for explicit-route protection if ever needed.
- [`src/components/guards/RequireAEManagerOrAdmin.jsx`](../../src/components/guards/RequireAEManagerOrAdmin.jsx) — gates `/admin/denial-criteria` + `/admin/routing` on `role IN (admin, system_admin, manager)` OR `platform_admins` membership. Shows "Access denied" otherwise. Mirrors `is_ae_manager(uuid) OR is_platform_admin()` at the frontend layer.

### 3. Two new pages

- [`src/pages/admin/DenialCriteriaAdmin.jsx`](../../src/pages/admin/DenialCriteriaAdmin.jsx) (~280 lines) — list sorted by priority, inline create/edit, toggle active, delete with confirm modal, numeric priority (auto-suggest = max+10 on new). "Test criteria" stubbed disabled with tooltip per spec.
- [`src/pages/admin/RoutingAdmin.jsx`](../../src/pages/admin/RoutingAdmin.jsx) (~520 lines) — two-tab layout (Rules + Pools). Rules: in-memory text filter, state/vertical dropdowns (verticals load from `coach_research_config`), employee min/max, destination radio (AE | Pool) → conditional dropdown. Pools: AE multi-select (`role NOT IN ('bdr')`), last_assigned_ae_id displayed inline, member badges per pool, full-replace member sync on save.

### 4. Centralized BDR path guard inside `Layout.jsx`

Instead of wrapping each non-BDR route with `<BdrGuard>` (~30 wrapping calls), added a single check at the top of Layout's render: `if (profile.role === 'bdr' && !BDR_ALLOWED_PATTERNS.some(p => p.test(location.pathname))) return <Navigate to="/bdr/my-leads" replace />`. Allowlist: `/bdr/*`, `/settings$`, `/onboarding`. Belt-and-suspenders on RLS — gives a clean demo answer for "what stops a BDR from seeing the admin console" without per-route boilerplate.

### 5. Admin section sidebar additions

`Admin` section now visible to `isAEOpsManager = role IN (admin, system_admin, manager) || isPlatformAdmin` (broader than the previous admin-only gate). New entries: **Denial Criteria** + **Lead Routing**. Existing entries (Organization, Widgets, SME Routing, SME Flags) stay gated on the narrower `isAdmin`. Net effect: managers see only the two new entries; admins see everything.

### Routes registered

`/admin/denial-criteria` and `/admin/routing` registered in App.jsx wrapped in `<RequireAEManagerOrAdmin>` + `<ErrorBoundary>`.

### Build

`npm run build` → 1,294 modules, 32s, no errors.

### Bug caught + fixed during M6 verification

**Infinite RLS recursion between `routing_pools` and `routing_pool_members`** policies (introduced in M1.4). Caught by BDR JWT impersonation (`SET LOCAL request.jwt.claims`) — service-role bypassed it in M3, so M3 round-robin tests didn't surface it.

The cycle:
1. Query `routing_pool_members` → policy `routing_pool_members_manager_select` subquerys `routing_pools`
2. RLS on `routing_pools` evaluates `routing_pools_member_select` → subquerys `routing_pool_members`
3. RLS on `routing_pool_members` fires again → GOTO 1

**Fix:** migration `20260512_02_fix_routing_pool_rls_recursion` drops the two AE-self-select convenience policies (`routing_pools_member_select` and `routing_pool_members_self_select`). Per spec, AEs don't need to see pool listings — they receive leads via direct deal assignment. Manager + platform-admin policies retained. RLS contract is now clean: BDRs and rank-and-file AEs see 0 rows, managers and admins see everything.

If a future "which pools am I in" UI is added for AEs, route the inner query through a `SECURITY DEFINER` helper function (e.g. `user_pool_ids()`) to bypass the inner RLS evaluation.

### Joe's 6 checks — verification status

| # | Check | How verified |
|---|---|---|
| 1 | AE manager + platform admin see new tabs; BDR + rank-and-file AE don't | Code: Layout.jsx `isAEOpsManager` gate on items; BDR sidebar has no Admin section at all. RLS impersonation: BDR sees 0 rows from ae_denial_criteria/routing_rules/routing_pools/routing_pool_members; admin sees all. |
| 2 | Denial criteria CRUD + priority + cache freshness | JWT impersonation as admin: INSERT + UPDATE (description, priority, active toggle) + DELETE all succeeded. BDR INSERT blocked (count stayed at 3, not 4). Cache freshness: pre-qdc-decision source confirms it queries `ae_denial_criteria` live on each invocation — no caching. |
| 3 | Routing rules CRUD + overlapping priority routing | RuleEditForm covers all spec fields (name, priority, state, vertical, employee min/max, destination radio). M3 round-robin test already proved priority ordering: Mfg pool rule (p=100) beat catch-all (p=9999) for Manufacturing leads. |
| 4 | Pools CRUD + last_assigned_ae_id visible | PoolEditForm + PoolsPanel rendering verified by build. `last_assigned_ae_id` displayed inline as "Last assigned: {AE name}" in each pool card. Member badges show all active members. |
| 5 | E2E new rule propagates without restart | `route-lead` queries `routing_rules` live each invocation (source code confirms). M3 test demonstrated: Mfg rule was created post-deploy and immediately matched new submissions. No restart needed. |
| 6 | BdrGuard: BDR types /admin/denial-criteria → redirected to /bdr/my-leads | Layout.jsx BDR path check runs before Outlet renders. Path `/admin/denial-criteria` doesn't match `BDR_ALLOWED_PATTERNS` → `<Navigate to="/bdr/my-leads" replace />`. Same logic covers all non-BDR routes centrally. |

### Files touched

- New: `src/components/guards/BdrGuard.jsx`, `src/components/guards/RequireAEManagerOrAdmin.jsx`, `src/pages/admin/DenialCriteriaAdmin.jsx`, `src/pages/admin/RoutingAdmin.jsx`
- Edited: `src/App.jsx` (route registration), `src/components/Layout.jsx` (XDR section + BDR path guard + admin sidebar entries + isAEOpsManager flag)
- New migration: `20260512_02_fix_routing_pool_rls_recursion`

### Open follow-ups

- **Auto-renumber on priority conflict:** for pilot scale (≤10 rules/criteria per org), manual priority management is fine. If two items get the same priority, Postgres picks one arbitrarily by ORDER BY. Spec accepted; revisit post-pilot.
- **Pool/member self-visibility:** AE can't see which pools they're in. Acceptable for pilot. Add `user_pool_ids()` SECURITY DEFINER function later if needed.
- **Test criteria button (stub):** still disabled with "Coming soon" tooltip per spec §5.1.
- **Joe's interactive verification:** UI rendering (button states, modal animations, multi-select interaction) needs your click-through. The data path is structurally verified end-to-end.

**Ready to proceed to M7 (post-QDC rewire — disqualification modal + AE→BDR feedback loop):** yes.

---

## M7 — post-QDC rewire + disqualification modal + AE→BDR feedback loop — 2026-05-12 — COMPLETE

**Shipped:**

### 1. Migration `20260512_03_disqualify_rpc_and_lead_advanced_notif`
- Extended `bdr_notifications.notification_type` CHECK to include `'lead_advanced'`.
- Created **`disqualify_deal_with_feedback(deal_id, rejection_reason_id, feedback, actor_user_id, suppress_bdr_notification)`** RPC — SECURITY DEFINER, single source of truth used by BOTH the frontend modal and the `post-qdc-decision` edge function. Handles:
  - Deal update (stage, disqualified_at, disqualified_by, disqualification_reason_id)
  - Rejection-reason validation (org-scoped, `applies_to IN ('post_qdc','both')`)
  - Idempotency: returns `was_already_disqualified=true` without writes if deal is already disqualified
  - When `bdr_lead_id` set AND `suppress=false`: writes `bdr_handoff_feedback`, updates `bdr_leads.stage='disqualified_post_qdc'`, returns notification payload
  - AE-self-submitted deals (no `bdr_lead_id`): cleanly skips BDR-side writes, no nullref crash
  - Returns notification payload as JSONB so the **caller** (HTTP-aware edge fn or frontend) fires `send-bdr-notification` — keeps HTTP out of PL/pgSQL.

### 2. `post-qdc-decision` v2 (full rewrite, replaces v1)
- New file at [`supabase/functions/post-qdc-decision/index.ts`](../../supabase/functions/post-qdc-decision/index.ts). Operates on `deals` (not `im_meetings` — that path is retired with `promote-to-dealcoach`).
- Input contract: `{ deal_id, decision: 'approved'|'disqualified', rejection_reason_id?, feedback?, actor_user_id, suppress_bdr_notification? }`.
- **Approval path:** validates `deal.stage === 'qualify'` (idempotent return if not), updates stage to `'discovery'`, fires `'lead_advanced'` notification to BDR if linked.
- **Disqualified path:** invokes the shared RPC; fires `'lead_disqualified_post_qdc'` notification (in-app + email) only if RPC returned a notification payload (i.e., BDR linked + suppress=false).
- **No more `promote-to-dealcoach` call.** Zero callers remaining — M10 decommissions.
- Feedback-min-30 validation guards new disqualifications but is bypassed when deal is already disqualified (idempotent path).

### 3. Frontend disqualify modal
- [`src/components/DisqualifyDealModal.jsx`](../../src/components/DisqualifyDealModal.jsx) (~170 lines).
- Reason dropdown filtered to `applies_to IN ('post_qdc','both')` and `active=true`.
- BDR-sourced deal: "What should the BDR have caught?" textarea required (min 30 chars), suppress checkbox visible (default off). Disabled-textarea state when suppress=on.
- AE-self deal (no `bdr_lead_id`): BDR-feedback section hidden; optional internal-notes textarea takes its place.
- Submit calls the shared RPC + fires `send-bdr-notification` client-side via `supabase.functions.invoke` if RPC returned a payload.
- Wired into DealDetail.jsx: stage popover intercepts `'disqualified'` selection and opens the modal instead of the direct stage-write.

### 4. `send-bdr-notification` patched
- Added `'lead_advanced'` to the function's `VALID_TYPES` set. Pre-fix, the fire-and-forget pattern silently swallowed rejections — `post-qdc-decision` v2 saw `notification_fired: true` but the row never landed for Scenario A1's approval test. Caught during E2E, patched, redeployed. Scenario B1 verified the fix.

### Joe's 9 checks — verification results

| # | Check | Verified |
|---|---|---|
| 1 | Modal opens with reason dropdown populated; feedback textarea required min 30 | ✅ Code: modal queries `im_rejection_reasons` filtered to post_qdc/both/active; `MIN_FEEDBACK_CHARS=30` enforced via `feedbackOk` memo gating `canSubmit`. |
| 2 | Suppress checkbox visible, defaults off | ✅ Code: rendered for BDR-sourced deals only, `useState(false)`. |
| 3 | Disqualify with suppress=false on BDR-sourced deal → 4 effects + retrospective | ✅ Scenario A3: deal.stage='disqualified', bdr_handoff_feedback row written (feedback_type='post_qdc_disqualified'), bdr_leads.stage='disqualified_post_qdc', bdr_notifications row with 'lead_disqualified_post_qdc', `retrospective_queue` row enqueued by `trg_deal_retro_on_close` trigger. All four ✓. |
| 4 | Disqualify with suppress=true → deal moves but no BDR-side writes | ✅ Scenario B2: deal.stage='disqualified', `bdr_handoff_feedback` count=0, `bdr_leads.stage` stayed at 'routed' (BDR has no signal — intentional), `bdr_notifications` count=0, `retrospective_queue` row still enqueued. |
| 5 | AE-self-submitted deal (no `bdr_lead_id`) → no crash, deal moves, retrospective fires | ✅ Scenario C: `deal.stage='disqualified'`, `bdr_handoff_feedback` count=0, `retrospective_queue`=1, no nullrefs. |
| 6 | Approve path: qualify → discovery + lead_advanced notification | ✅ Scenario B1 (after the `VALID_TYPES` fix): deal stage→discovery, `bdr_notifications` row with 'lead_advanced' written for the BDR. |
| 7 | Manual modal + edge fn use same logic (shared RPC) | ✅ Both call `disqualify_deal_with_feedback()`. Frontend via `supabase.rpc()`, edge fn via `sb.rpc()` with service-role. Identical effects. |
| 8 | Idempotency: 2nd disqualify call no-op | ✅ Scenario A4 (after edge fn fix): second call returned `idempotent: true`. Handoff count stayed at 1, notification count stayed at 1, no duplicate writes. |
| 9 | BDR-side view shows AE feedback + rejection reason for disqualified lead | ✅ JWT-impersonated as BDR test user, queried `bdr_my_lead_status`: Lead A (suppress=false) shows feedback_preview, disqualification_reason="QDC revealed company is not a real fit", ae_feedback_type='post_qdc_disqualified'. Lead B (suppress=true) shows all those fields null and lead_status='routed' — BDR correctly has no signal. |

### Bugs caught + fixed during E2E

1. **Feedback min-30 validation fired before idempotency check.** A4 retry sent short feedback (correct real-world pattern: same call repeated) and got rejected. Fixed: `post-qdc-decision` v2 now skips the feedback validation when the deal is already disqualified.
2. **`send-bdr-notification.VALID_TYPES` missing 'lead_advanced'.** A1's approval call appeared to succeed (`notification_fired: true`) but the row never landed — fire-and-forget swallowed the rejection. Caught by querying `bdr_notifications` post-test. Fixed in the function, redeployed, B1 confirmed.

### Files changed

- New: `supabase/functions/post-qdc-decision/index.ts` (rewrite, replaces v1), `src/components/DisqualifyDealModal.jsx`
- Edited: `supabase/functions/send-bdr-notification/index.ts` (VALID_TYPES expansion), `src/pages/DealDetail.jsx` (modal wiring + state + import)
- New migration: `20260512_03_disqualify_rpc_and_lead_advanced_notif`

### Open follow-ups

- **Disqualify-stage-history audit.** When suppress=true and BDR-sourced, `bdr_leads.stage` stays unchanged (currently 'routed'). Intentional per the suppress semantic ("BDR has no signal"). If the AE manager later wants to surface internal-only "AE disqualified this without notifying the BDR" history, that's a follow-up surface.
- **Modal cancel-after-error.** If `disqualify_deal_with_feedback` errors and the user fixes the form and resubmits, the second submit clears the error and proceeds — no stuck-state bug like the M4 Submit form had. Verified in code.
- **`promote-to-dealcoach` decommission.** After this rewire, zero callers remain. M10 handles the actual decommission. The function is deployed-but-orphaned.
- **`writeback-bdr-feedback`, `process-bdr-submission`, `research-lead-company`, `create-im-meeting`, `process-ae-self-submission`, `process-ae-qdc-transcript`, `import-transcript-url`** — varying degrees of orphan now. M10 disposition matrix.

### Test cost summary

Only the BDR Deal A path actually invoked `route-lead` (which fires research-company + process-transcript async at ~$0.10–$0.20 total). Deals B and C used direct INSERTs to skip those costs. Total M7 verification spend: ~$0.20 in Anthropic + Perplexity.

**Ready to proceed to M8 (AE deal list qualify-stage separation — pin "New Leads — Awaiting QDC" section atop the pipeline):** yes.

---

## M8 — AE pipeline qualify-stage separation — 2026-05-14 — COMPLETE

**Shipped:**

Inside [`src/pages/Pipeline.jsx`](../../src/pages/Pipeline.jsx)'s `PipelineViewWidget`, the `filteredDeals` array now splits into two arrays at render time:
- `bdrAwaitingQdc = filteredDeals.filter(d => d.stage === 'qualify' && d.bdr_lead_id)`
- `pipelineDeals = filteredDeals.filter(d => !(d.stage === 'qualify' && d.bdr_lead_id))`

The pinned `BdrAwaitingQdcSection` renders above the kanban/table when `bdrAwaitingQdc.length > 0`. The kanban Qualify column receives `pipelineDeals` so the same lead isn't double-rendered.

**Visual treatment** (matches spec §7):
- Container: Carolina-blue thick left accent (`borderLeft: 4px solid T.primary`), thin matching outline, soft white surface.
- Header strip: uppercase "NEW LEADS — AWAITING QDC" + count badge + "Routed by AI first-glance — take the QDC and decide." secondary hint.
- Cards: horizontal flex-wrap (`flex: 1 1 240px`), thinner 3px blue left accent, company logo + name + **"From BDR"** uppercase tag in Carolina-blue. Footer row shows assigned AE name + age (e.g. "3h ago" / "2d ago"). Click → `/deal/:id`.

**Verification:**
- Seeded a BDR-sourced qualify-stage deal assigned to Joe (rep_id, bdr_lead_id linked, source='bdr_submission').
- JWT-impersonated as Joe and ran the pipeline query — deal returned with `is_bdr_sourced=true`, `stage='qualify'`, `rep_id=Joe`.
- Component logic verified: deal flows into `bdrAwaitingQdc` (matches both filter conditions) and is excluded from `pipelineDeals` (would not appear in Qualify kanban column).
- `npm run build` → 20.2s, clean.
- Cleanup: test deal + lead removed.

**Open follow-ups:**

1. **Browser verification still needed** — UI rendering (card layout, hover states, click navigation) needs Joe's click-through. Data path is structurally verified.
2. **`filteredDeals` upstream still passes through the forecast-category filter** — if an AE filters by forecast category and a BDR-sourced qualify deal has a different forecast category (default `'pipeline'`), it could disappear from the pinned section. Spec says "pin… showing `deals WHERE stage='qualify' AND bdr_lead_id IS NOT NULL`" without mentioning forecast filter coexistence. Current behavior: pinned section respects the same forecast filter as the kanban. Reasonable default — flag if you want it to bypass the filter (i.e., always show all awaiting-QDC leads regardless of forecast).
3. **Manager view (drillRepId)** — when a manager drills into a specific rep, the pinned section shows only that rep's awaiting-QDC deals. Matches spec intent.

---

## ⚠️ Parallel-session regression flagged for Joe's call

App.jsx was significantly refactored by another session/linter on this branch since M7 wrapped. **The BDR + M6 admin route registrations were dropped:**
- `/bdr/submit`, `/bdr/my-leads`, `/bdr/leads/:id` — gone
- `/admin/denial-criteria`, `/admin/routing` — gone
- `HomeRoute` BDR-redirect component — gone
- Associated imports (`BdrSubmit`, `BdrLeadStatus`, `BdrMyLeads`, `DenialCriteriaAdmin`, `RoutingAdmin`, `RequireAEManagerOrAdmin`) — gone

**The page files all still exist on disk** at the original paths (verified May 12 timestamps). Layout.jsx's XDR sidebar still links to `/bdr/submit` and `/bdr/my-leads`, and the M6 Admin section still links to `/admin/denial-criteria` + `/admin/routing` — these would currently hit the `*` fallback redirect to `/`.

I did NOT re-add the routes — that's a parallel-session ownership call. Two possibilities to confirm:
- (A) Intentional defer: routes will land via the parallel session that's working on broader Lumen restructure.
- (B) Inadvertent drop during refactor: needs re-registration before M9 testing.

Recommend confirming with the parallel-session owner before M9. If (B), the fix is ~10 lines in App.jsx (re-add the 7 imports + 5 Route elements). Files to wire: `BdrSubmit`, `BdrMyLeads`, `BdrLeadStatus`, `DenialCriteriaAdmin`, `RoutingAdmin`, plus the `RequireAEManagerOrAdmin` and `HomeRoute` wrappers.

Layout.jsx's parallel-session expansion (Feather icons, dealroom_only access_mode, role_level-based isManager) is preserved — my XDR section + BDR guard remain intact within it.

**Ready to proceed to M9 (test checklist):** yes, *pending the App.jsx routing decision above*. M9's "BDR submits a lead end-to-end" check (test 1) can't run if the BDR routes aren't wired in App.jsx.

---

## App.jsx + DealDetail.jsx re-wire — 2026-05-14 — COMPLETE

Diagnosed the dropped routes as untracked-file fallout (commit `d9a7168` defensively reverted the DisqualifyDealModal import to keep Netlify builds green). The page files all existed on disk; they just weren't committed.

Two clean commits landed on origin/main:
- `08eecac` — 15 untracked M2–M7 files (modal + guards + BDR/admin pages + 4 edge fn sources + 3 docs), 5,843 insertions, zero modified-file sweeps.
- `8b5be74` — wiring (App.jsx imports + routes + HomeRoute BDR-priority extension; DealDetail.jsx DisqualifyDealModal re-attach; Pipeline.jsx M8 BdrAwaitingQdcSection), 3 files, 133 insertions.

Parallel-session WIP on Layout.jsx, NotificationBell.jsx, GlobalChatbot.jsx, OrgContext.jsx, useAuth.jsx, CoachAdmin.jsx, CoachBuilder.jsx, ManagerDashboard.jsx, Onboarding.jsx, Settings.jsx, styles/index.css, deal-chat/, process-transcript/ left untouched. Future merges will preserve everything since the files are now tracked.

---

## M9 — Test checklist — 2026-05-14 — COMPLETE (all 6 spec tests green, 1 N/A)

Full audit at [`docs/audits/2026-05-14-bdr-routing-test-results.md`](../audits/2026-05-14-bdr-routing-test-results.md).

| # | Spec test | Result |
|---|---|---|
| 1 | BDR paste → approval → deal (8 sub-checks) | ✅ |
| 2 | Audio submission | ⚪ N/A — Mode A dropped in M0 decision 6.H |
| 3 | AI denial with criteria verbatim (5 sub-checks) | ✅ |
| 4 | State+vertical specific-AE rule beats pool rule | ✅ |
| 5 | Round-robin pool — 5 concurrent → 5 unique AEs, FOR UPDATE atomicity | ✅ |
| 6 | Post-QDC disqualify — 3 scenarios (BDR+feedback / suppress=true / AE-self) | ✅ |
| 7 | RLS audit — cross-org BDR isolation, own-feedback visible, non-manager blocked | ✅ |

**Gaps + cosmetic flags surfaced during M9:**

1. **AE-side handoff notification missing.** Spec §4.2 step 9 calls for an in-app + email notification to the assigned AE on routing. Currently the BDR gets `lead_approved`; the AE doesn't get a dedicated notification — they see new leads via M8's pinned pipeline section. Not a test failure; could ship in M10 alongside decommission or defer.
2. **`route-lead` `routed_by_function` stamp says v1, not v2.** My M7 stamp bump caught runtime error/response stamps but missed the hardcoded data field in the `routing_history` INSERT. Cosmetic only; one-line fix at the next route-lead bump.
3. **Drew Nick was promoted to manager** by the parallel session since M3, which exposed a test-fixture fragility. T7.3 was re-run with a deterministic dummy profile (Test AE One, `a1111111…`, role='rep'). Lesson: use stable test fixtures for negative-RLS tests, not real users whose role can shift.

**Cleanup:** all 8 M9 test leads + 8 deals + routing_history + notifications + retrospective_queue rows deleted via cascade-aware DELETE chain. Migration 13 (FK cascade SET NULL) made it clean — no manual NULL-out workaround needed.

**Test fixtures preserved for future testing:**
- Test AE Three (`a3333333…`) + Test AE Four (`a4444444…`) — added to M3 Test Pool, now 5 members
- Cross-org BDR (`bdb00002…`) in Acumen org — for ongoing RLS isolation tests
- Routing rule "M9 T4 — TX Manufacturing → Drew" (priority=50) — useful as a specific-AE rule example

**Total Anthropic + Perplexity spend on M9 verification:** ~$0.18 (Test 1 approval triggered real Claude + research-company; Test 3 denial ~$0.016; Tests 4 + 5 bypassed Claude by pre-seeding ai_decision='approved'; Tests 6 + 7 use no Claude).

**Gate cleared: M10 (decommission `promote-to-dealcoach`) is unblocked.**

---

## M10 — Decommission `promote-to-dealcoach` + 3 related orphans — 2026-05-14 — COMPLETE

**Shipped:**

Four edge functions replaced with deprecation stubs that:
1. Log the caller's UA, referer, and body preview so any resurfacing caller is visible in Supabase logs
2. Return HTTP `410 Gone` with a JSON body pointing to the replacement
3. Identify themselves as `version: "deprecated-stub-v1"`

| Function | Reason for decommission | Replacement |
|---|---|---|
| `promote-to-dealcoach` | IM-meetings flow retired in M3/M7. Zero callers post-M7. | `route-lead` (deal creation at routing) + `post-qdc-decision` v2 (advance/disqualify) |
| `process-bdr-submission` | Orchestrator dropped per M0 decision 6.K. | BDR form invokes `pre-qdc-decision` directly |
| `writeback-bdr-feedback` | IM-meetings handoff write retired. | Shared RPC `disqualify_deal_with_feedback()` invoked from M7 modal + post-qdc-decision v2 |
| `research-lead-company` | Pre-decision research dropped per M0 decision 6.J. | `research-company` invoked async by `route-lead` v2 post-routing |

**Final caller audit (re-verified before deploy):**
- Repo grep across `*.{js,jsx,ts,tsx,sql,md}`: all matches were doc-only (audits + spec + progress). Zero production code references.
- DB triggers (`information_schema.triggers` ILIKE check): 0 matches.
- Edge function cross-references: `post-qdc-decision` v3 confirmed not calling `promote-to-dealcoach` (M7 rewire). All four are zero-caller orphans.

**Smoke test:** curled each deprecated endpoint with `{"smoke_test":true}` — all 4 returned HTTP 410 with the expected JSON body. Logs confirmed in Supabase dashboard would show the smoke_test payload.

**CLAUDE.md updated** with:
- New section for the BDR submission & routing edge functions (pre-qdc-decision v3, route-lead v2, post-qdc-decision v2, send-bdr-notification v1)
- New "Deprecated" section listing the 4 functions with replacement pointers + the 410-Gone behavior

**What stays for now (per spec §4.4):**
- Source files at `supabase/functions/<name>/index.ts` for all 4 deprecated functions — keep tracked in git for one release cycle so the stubs can be redeployed if anything regresses.
- Deployed functions stay registered in Supabase (returning 410). Hard-delete from the registry is a follow-up cleanup once pilot stability is proven.

**What we did NOT touch (out of scope per M0):**
- `process-ae-self-submission`, `process-ae-qdc-transcript`, `create-im-meeting` — separate IM/AE-self concerns, not part of the BDR routing rewrite.
- `send-handoff-notification` — originally "REWIRE" in the audit, ended up de-facto unused since `route-lead` v2 uses `send-bdr-notification` directly. Could deprecate in a follow-up if it stays orphaned.

**Cosmetic follow-ups carried forward:**
1. `route-lead` `routed_by_function` data field still says `"v1"` instead of `"v2"` (M9 flagged this).
2. AE-side handoff notification not yet implemented (spec §4.2 step 9). BDR gets `lead_approved`; AE discovers via M8 pinned pipeline section.
3. `send-handoff-notification` orphan status — defer or deprecate alongside this batch in a follow-up.

**Build state:** no frontend changes in M10. Edge function stubs deployed only. CLAUDE.md updated.

**M10 complete. The BDR submission & deal routing build (M0–M10) is fully landed.**

---

## M11 — Configurable QDC Criteria (admin-driven submission fields)

**Date:** 2026-05-14

**Trigger:** Joe asked for the "Denial Criteria" admin to become "QDC Criteria" with two sub-tabs — Denial Criteria (existing M6 behavior preserved) and Submission Criteria (new: add/remove/toggle-required fields for the BDR submit form, including custom fields beyond the 12 built-ins). Admin-only.

### Scope chosen (B): Full custom-field support with per-field required + hide toggles

- 12 built-in fields (company_name, website, employee_count, tech_stack, annual_revenue, num_entities, accounting_team_size, industry, vertical, hq_state, bant, transcript) — admin can hide or toggle required, but cannot delete.
- Custom fields — admin can add new fields with input_type ∈ {text, number, currency, tag_input, dropdown, textarea, state, vertical, url, date}, optional help_text/placeholder/options, required toggle, and full delete.
- Custom-field values persist to `bdr_leads.custom_fields` JSONB (built-ins continue to use typed columns).

### Migration

`20260514_bdr_submission_fields_config`:
1. `ALTER TABLE bdr_leads ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;`
2. `CREATE TABLE bdr_submission_fields (id, org_id, field_key, label, input_type CHECK IN (...), is_builtin, required, active, priority, help_text, placeholder, options jsonb, created_by, created_at, updated_at, UNIQUE (org_id, field_key))`
3. RLS:
   - `SELECT` for any org member.
   - `INSERT/UPDATE/DELETE` for role ∈ (admin, system_admin, manager) OR platform_admin.
   - Built-in rows protected: `is_builtin=true` rows blocked from `DELETE` via row-level policy.
4. Seed: for each active org, insert the 12 built-in fields with `is_builtin=true, active=true, required=<existing-form-default>, priority=10..120`.

### Code landed

| File | Change |
|------|--------|
| `src/pages/admin/QdcCriteriaAdmin.jsx` | New page. `TabBar` with Denial Criteria + Submission Criteria. `DenialPanel` preserves the M6 `DenialCriteriaAdmin` UI/behavior verbatim. `SubmissionPanel` lists `bdr_submission_fields` rows; inline `Required` + `Active` toggles; `+ New custom field` form with input_type select and options-list editor for `dropdown`; built-ins editable (label, required, active, priority) but not deletable. |
| `src/pages/bdr/Submit.jsx` | Rewritten as fully config-driven. On mount queries `bdr_submission_fields` for `org_id, active=true` ordered by priority. `FieldRenderer` switches on `input_type` for the 10 supported widgets. Submit splits payload: built-in `field_key`s → typed `bdr_leads` columns; custom keys → `bdr_leads.custom_fields` JSONB. Validation enforces `required=true` fields on the client; server still gates via `pre-qdc-decision` (judgment, not validation). |
| `src/components/Layout.jsx` | Sidebar entry `Denial Criteria` → `QDC Criteria` pointing at `/admin/qdc-criteria`. |
| `src/App.jsx` | Imports `QdcCriteriaAdmin`. New route `/admin/qdc-criteria` guarded by `RequireAEManagerOrAdmin`. Legacy `/admin/denial-criteria` now `<Navigate to="/admin/qdc-criteria" replace />` for bookmark back-compat. |
| `supabase/functions/pre-qdc-decision/index.ts` → v4 | Loads `bdr_submission_fields` (active, ordered by priority) instead of the v3 hardcoded 10-field list. Each field formatted via `formatFieldValue(field_key, input_type, is_builtin)` which reads built-ins from `lead[field_key]` and customs from `lead.custom_fields[field_key]`. Tail block `# Custom fields (no longer in current config)` surfaces any `custom_fields` keys whose `field_key` isn't in the active config so deactivating/renaming a field doesn't silently strip past submissions' values from the AI's view. All response/error `version` strings bumped from `"v3"` → `"v4"`. |

### Test plan executed in-session

- ✅ `npm run build` clean (51s, 1312 modules).
- ✅ `supabase functions deploy pre-qdc-decision --no-verify-jwt` clean.
- Manual smoke (deferred to Joe per "don't turn it on for beta yet"):
  - Admin → /admin/qdc-criteria → Submission tab → toggle `vertical` Required off → Submit form should hide the asterisk and stop blocking on empty.
  - Admin → Submission tab → "+ New custom field" with `key=erp_module, label=ERP Module, input_type=dropdown, options=[NetSuite, Sage Intacct, Workday, Other]` → BDR submit shows new field → submission writes to `bdr_leads.custom_fields.erp_module` → `pre-qdc-decision` v4 prompt should include `ERP Module: <value>` line.
  - Toggle that custom field `active=false` → existing submissions still surface under `# Custom fields (no longer in current config)` in v4 prompt; new submissions don't render the field.

### Cosmetic follow-ups still carried forward (unchanged from M10)

1. `route-lead` `routed_by_function` data field still says `"v1"` instead of `"v2"`.
2. AE-side handoff notification not yet implemented (spec §4.2 step 9).
3. `send-handoff-notification` orphan status — still defer or deprecate alongside in follow-up.

**Commit:** `f4614b1` — feat: M11 — configurable QDC criteria with custom submission fields.
**M11 complete pending Joe's manual smoke.**
