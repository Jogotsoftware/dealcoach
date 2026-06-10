# Claude Code Sprint: Lumen Extraction Overhaul

## Mission

Rebuild Lumen's extraction, provenance, and accuracy layer end to end per the approved
architecture. After this sprint: every AI-written value carries provenance (quote+speaker
or URL+date) and an observed_at; manual values are permanently locked with AI suggestions
queued against them; AI hypotheses live in a quarantined table, never in fact fields;
research writes only cited facts; transcripts feed a catalog-driven, concept-matched
extraction with a metrics sweep, a 27-risk engine, and call execution analytics; and the
SC gets an editable opportunity-data page with module recommendations and a demo-readiness
gate.

Read first, in order:
1. `CLAUDE.md` in the repo
2. `lumen-extraction-architecture.md` (the authoritative spec; this prompt implements it)
3. The three seed workbooks (read with openpyxl; they are data inputs, not just docs):
   - `sc_extraction_definitions.xlsx` (Field Definitions / Core Entities / Universal Rules)
   - `ae_extraction_definitions.xlsx` (Extraction Protocol / AE Field Definitions /
     Key Metrics / Deal Risk Taxonomy / Call Execution Analytics)
   - `sc_discovery_field_catalog.xlsx` (field_key, type, applicability, routing per field)

Joe will place these files in the repo under `docs/extraction/`. If any is missing, halt.

## Sprint mode

Full autonomous authority on gray-area calls; propose-and-proceed with the lean noted in
the completion report. Halt only on: (a) auth/RLS breakage of the existing app, (b) any
write touching the real org `0acebff8-8827-4984-b478-cbcad404539d`, (c) unrecoverable
schema conflict or failed migration, (d) missing input workbooks. All testing against the
demo tenant `c8a7ea52-42b8-4b66-9d38-91c9b1dda883`. No intermediate pause gates. Work the
phases in order; each phase ends with its verification step green before the next begins.

Project standards apply throughout: apply_migration for all DDL; execute_sql for reads and
one-off fixes; RLS on every new table, org-scoped, no exceptions; try/catch around every
Supabase op (no .catch() on query builders; use safeInsert helpers); version stamps in
every edge function error message ("extract-fields v1: ..."); verify_jwt false + apikey
header; no emojis anywhere; theme tokens from src/lib/theme.js for all frontend work;
schema-inspect via information_schema before writing any migration (column names are not
predictable).

---

## Phase 0: RLS hardening (live exposure; ships first)

1. Enable RLS with NO policies on the 4 backup tables: coaches_backup_pre_ip_cleanup,
   call_type_prompts_backup_pre_ip_cleanup, coach_documents_backup_pre_ip_cleanup,
   organizations_backup_pre_ip_cleanup. (Service-role access remains; that is the intent.)
2. Replace permissive USING(true) policies on: coaches, call_type_prompts, coach_documents,
   coach_icp, coach_pe_portfolio, coach_reference_lists, coach_research_config,
   scoring_configs, rep_scoring_configs, email_templates, msp_templates.
   Method: first read the working org-scope policy on `deals` and any auth helper function
   it uses; mirror that exact convention. Every replacement policy must allow BOTH the
   caller's org rows AND shared/template rows (org_id IS NULL) for SELECT; writes remain
   org-scoped (template writes stay super-admin/service-role only). After each table's
   policy swap, verify the app-critical read path (coach loading for a demo-tenant user)
   still returns the template coach.
3. Tighten global reference tables (ai_providers, plans, widget_registry, roi_industries,
   credit_costs, sme_badges) from public to authenticated SELECT.
4. Verification: as anon (apikey only, no auth), confirm REST reads on all tables above
   return zero rows; as a demo-tenant authenticated user, confirm coaches + prompts +
   scoring configs load and the app functions.

## Phase 1: Schema migrations

New tables (all org-scoped RLS, updated_at triggers, observed-at columns where noted):

1. `deal_hypotheses`: id, org_id, deal_id, hypothesis_type (red_flag|green_flag, text not
   enum for extensibility), hypothesis, reasoning, basis_source_ids uuid[], confidence,
   generated_by (research|transcript_pass|retrospective), status
   (open|confirmed|refuted|dismissed), confirmed_by_source_id, created_at, resolved_at.
2. `deal_metrics`: id, org_id, deal_id, metric_key (nullable), label, value numeric,
   unit, period (month|year|event|point_in_time), as_of, quote, speaker,
   conversation_id, source (transcript|research|manual), observed_at, field_value_id
   (nullable), pain_point_id (nullable), created_at.
3. `metric_taxonomy`: metric_key pk, name, definition, unit_normalization, signals,
   feeds_links, active. Seeded from the Key Metrics tab (22 rows).
4. `risk_definitions`: risk_key pk, plain_name, methodology_anchor, definition,
   evidence_signals, evidence_types text[] (stated|gap), severity_rubric, example,
   active. Seeded from the Deal Risk Taxonomy tab (27 rows). Add to `deal_risks`:
   risk_key (nullable FK), evidence_type (stated|gap), evidence jsonb (quotes or gap
   computation snapshot), auto_generated boolean.
5. `call_questions`: id, org_id, conversation_id, deal_id, question_text, asked_by
   (rep|sc), types text[] (open|closed|leading|quantifying|impact|layering|confirming|
   stacked), topic, elicited (jsonb refs to created field values/entities/metrics),
   turn_index, created_at.
6. `call_moments`: id, org_id, conversation_id, deal_id, moment_type (nugget_missed|
   thinking_pause|objection|confirmation_loop), quote, speaker, turn_index, severity_rank,
   payload jsonb (per-type detail: should-have-asked, gap seconds or marker, handling
   classification, loop outcome), created_at.
7. `deal_modules`: id, org_id, deal_id, module_key, is_recommended boolean default false,
   is_demoed boolean default false, recommended_reason, suggested_by_ai boolean,
   demoed_conversation_id, notes, created_by, created_at, updated_at.
   Unique (deal_id, module_key).
8. `module_reference`: module_key pk, name, description, maps_to_skus text[] (pricebook
   SKU codes), suggestion_rules jsonb (which discovery facts trigger an AI suggestion),
   sort_order, active. Seed the starter list below; map SKUs by name-matching against
   `products` (case-insensitive contains); leave maps_to_skus empty where no confident
   match, flagged for Joe's review in the completion report.

Starter module list (Joe curates post-sprint): core_financials (GL, AP, AR, Cash Mgmt,
Order Entry, Purchasing), dimensions, multi_entity_consolidations, inventory,
order_management, project_costing_billing, contract_revenue_management,
dynamic_allocations, fixed_assets, time_expense, planning (Sage Intacct Planning),
avalara_tax (AvaTax), vendor_payment_services, dashboards_reporting (ICRW), lease_accounting.
Suggestion_rules examples: inventory_type in (buy_to_sell, manufacturing, mixed) ->
inventory + order_management; project_types non-empty -> project_costing_billing;
entity_count > 1 or multi-currency -> multi_entity_consolidations; uses_allocations ->
dynamic_allocations; revenue_recognition_method in (ratable, poc) ->
contract_revenue_management; budgeting_process answered -> planning;
fixed_asset_count > 0 -> fixed_assets.

Column additions (additive, no drops):
- custom_field_values: observed_at timestamptz, is_manual_locked boolean default false,
  pain_point_id uuid null, metric_id uuid null.
- conversations: granola_meeting_id text null (skip if the Granola sprint already added
  it), granola_share_url text null.
- deal_sizing: warehouse_count integer null, plus per-field provenance: a sources jsonb
  ({field: {quote, speaker, conversation_id, source, observed_at}}) — lean call: jsonb
  here is acceptable because it is provenance metadata about scalar columns, not business
  data (does not violate the no-blob rule for first-class facts).
- compelling_events / business_catalysts / deal_pain_points / deal_decision_criteria /
  deal_risks / company_systems: ensure each has observed_at and reconfirmed_count integer
  default 0; add only what is missing (inspect first).

Canonical-home deprecation (write-path only, no data destruction): process-transcript and
all new functions stop writing deal_analysis.pain_points, pain_points_list,
decision_criteria, decision_criteria_list (and the integrations text/_list pair);
relational tables are canonical. Leave existing data and read paths untouched this sprint.

Verification: migrations applied cleanly; information_schema confirms all columns; RLS
verified on every new table (anon reads return zero).

## Phase 2: Seed from the workbooks

Write a one-off Node or Python script (committed to scripts/) that reads the workbooks and
generates idempotent seed migrations:

1. SC Field Definitions tab (94 rows) -> custom_field_definitions for the platform
   template scope (follow whatever scoping pattern coaches/template cloning uses; inspect
   first): field_key, entity_type='deal', display_section=Section, field label from the
   Question, value type from Type & Normalization, ai_context=Canonical Definition,
   extraction_instructions=Type & Normalization + Good/Bad Example text,
   extraction_signals=Positive Signals, negative_signals=Negative Signals. Fields whose
   catalog routing binds to existing homes (deal_sizing, company_systems,
   deal_pain_points, drivers summary) are seeded with a routing marker (storage_target)
   instead of creating a duplicate writable field; the extraction engine uses
   storage_target to write the canonical home. payment_methods merges into
   vendor_payment_methods (one definition, noted).
2. Core Entities tab -> extraction_definitions rows (canonical_definition, anti_patterns,
   examples) for the 8 entities.
3. Universal Rules + Extraction Protocol tabs -> a generated
   `supabase/functions/_shared/extraction-protocol.ts` exporting the protocol text as the
   locked Platform Core prompt segment (4-layer architecture: this layer is not
   org-editable anywhere).
4. Key Metrics tab -> metric_taxonomy seed. Deal Risk Taxonomy tab -> risk_definitions
   seed.
5. Two new scoring_configs on the template coach: compelling_event and catalyst score
   types, computed per the architecture doc (strength/proximity/verified/reconfirmed for
   CE; urgency/impact/verified-count for catalyst), cloned to orgs via the existing
   clone_coach_for_org path (extend the clone RPC if scoring configs are cloned there;
   inspect first).

Verification: counts match the workbooks (94/8/22/27); re-running the seed is a no-op.

## Phase 3: Research pass remediation (research-company)

1. Claims-with-citations contract: restructure the research output schema so every fact
   carries source_url + source_title + published-or-accessed date. The edge function
   DROPS any claim without a URL (enforced in code, not prompt). Every accepted fact
   writes deal_sources (source_origin=research) and sets source='research' +
   observed_at on its target.
2. Source-quality ordering in the research prompt: primary first (company site, press
   releases, SEC EDGAR for public/PE-backed, state business registries, official
   marketplaces), then trade press, then aggregators; forums excluded as fact sources.
3. Kill suspected red/green flag seeding into deal_analysis. Research reasoning about the
   deal writes deal_hypotheses (generated_by='research', basis_source_ids populated).
4. Pre-call ICP scoring computes over verified facts only and labels itself
   "fit based on N verified facts" in its output.
5. Drop NinjaPear: replace logo fetch with logo.dev, falling back to
   https://www.google.com/s2/favicons?domain={domain}&sz=128; same bucket and
   logo_url write; failures are silent (cosmetic).
6. Recency wires in: research writes to canonical homes (e.g., entity_count ->
   deal_sizing with source='research') under the change-aware recency rules of Phase 4
   (shared writer module; build it there, use it here).
7. Verification: run research on a demo-tenant deal; confirm zero uncited writes, zero
   deal_analysis flag writes, hypotheses rows present with sources, logo populated.

## Phase 4: The extraction engine (the core of the sprint)

Build a shared writer module (`_shared/provenance-writer.ts`) used by ALL extraction
paths, enforcing in code:

- Quote gate: no transcript-sourced write without verbatim quote + speaker; no
  research-sourced write without URL. Violations are dropped and logged.
- Speaker discipline: prospect-business facts require a prospect-side speaker stating or
  explicitly confirming (confirmation quotes must include both halves). Speaker map per
  protocol step 1; unclassifiable speakers default rep-side.
- Numeric containment: number must appear in the quote or be a flagged conversion with
  arithmetic recorded in notes.
- Manual lock: target has is_manual_locked (or human change_source in history) ->
  convert to field_suggestions row (full provenance + conflict context), never write.
- Change-aware recency: classify new_fact | confirmation (bump observed_at +
  reconfirmed_count, value unchanged) | changed_fact (write, demote prior to history,
  record a deal timeline event for qualifying-spine facts: entity/user counts, budget,
  timeline dates, CE/catalyst changes).
- One fact, one home: writes route via storage_target (deal_sizing, company_systems,
  deal_pain_points, custom_field_values, etc.). Multi-field quotes link the same
  deal_sources row to multiple targets.
- Scores are never written by extraction: reject any score-shaped output.

Rebuild process-transcript (or build extract-pass siblings it orchestrates — your call,
note the lean) to run, per transcript:

1. Speaker map + full-pass comprehension (protocol steps 1-2).
2. Entity extraction (8 entities) with match-before-insert dedup: exact/fuzzy natural-key
   match, then embedding shortlist against existing rows (reuse the embed-chunks
   embedding model), then a same-or-different model judgment with both candidates in
   context; borderline inserts carry possible_duplicate_of. Matches enrich (append
   evidence via deal_sources, update quantification by recency, bump reconfirmed_count).
3. Catalog field extraction: load the field catalog (definitions + signals +
   storage_target + current value/source/observed_at + manual-lock state per field) and
   extract concept-driven per protocol step 16. Output contract per field per protocol
   step 15. Gated sections (inventory_type, project_types, uses_allocations) resolve
   gated-off fields to not_applicable. Partial answers write partial + follow-up task.
   Pain tie-in: quantified answers link or propose deal_pain_points (through dedup).
4. Metrics sweep (protocol step 17): every quantified prospect statement -> deal_metrics,
   taxonomy-mapped or unmapped-labeled; field values and pains link metric_id rather than
   duplicating numbers.
5. Hypothesis pass: pattern-shaped observations (title-implies-role, industry-pattern
   risks) -> deal_hypotheses only.
6. Trigger matrix: full pass on qdc, functional_discovery, scoping, demo; light pass
   (entities + metrics + tasks + execution) on sync/custom. Drivers summary (see Phase 6)
   regenerates after qdc/functional_discovery unless human-edited (then suggest refresh).
7. Token discipline: assemble per existing context patterns; keep the full raw response
   in conversations.ai_raw_response (existing pattern) so re-extraction is credit-free.
   Build a small `reextract` utility (script or admin-only endpoint) that re-runs the
   parse+write stage from stored raw responses against the current catalog.

Granola context: when the conversation has granola metadata (summary/notes/action items),
pass it as auxiliary context labeled CONTEXT-ONLY (never provenance); Granola action items
inform task extraction; Lumen remains the single task author.

Verification: process at least two real demo-tenant transcripts (use stored ones via
reextract where possible). Confirm: every written value has quote+speaker; a manual edit
then re-extraction produces a suggestion not an overwrite; the same transcript processed
twice produces zero new rows (idempotent via dedup + change classification); a number
absent from its quote is rejected; deal_metrics captures stated numbers that match no
field.

## Phase 5: Risk engine + spine scores

1. `compute-deal-risks` edge function: runs post-extraction and nightly per active deal.
   Stated risks: written by the extraction pass when quote-backed (risk_key +
   evidence_type='stated' + quotes). Gap risks: computed deterministically from record
   state per risk_definitions (EB unidentified after discovery-stage calls, zero CE rows
   in commit/forecast, single-threading from conversation participants, timeline slippage
   from changed_fact history on date fields, discovery_coverage_gap and
   scope_module_mismatch from catalog + deal_modules state, etc.). Auto-generated gap
   risks resolve themselves when the gap closes (status auto-transitions, history kept).
   Severity per the rubric column, stage-aware.
2. CE + Catalyst scores compute via the Phase 2 scoring configs; the qualifying-spine
   flag (orientation + catalyst + CE all missing -> "deal isn't real yet" deal_flags row)
   computes here.
3. Verification: on a demo deal with no CE rows in forecast category, the critical risk
   appears; adding a verified CE row auto-resolves it.

## Phase 6: Call execution analytics + drivers summary

1. Execution pass (same transcript pass family, after fact extraction): produce
   call_questions rows (inventory + classification + elicited links), call_moments rows
   (nuggets_missed with severity rank and should-have-asked phrased from the relevant
   field's signals; thinking_pauses via turn-gap timing where per-turn timestamps exist,
   verbal-marker fallback labeled by basis; objections with handling classification;
   confirmation_loops with outcomes, corrected loops feeding changed-value evidence), and
   call-level metrics on call_analyses: talk_ratio + basis, longest_monologue,
   open_closed_ratio, depth summary per topic, agenda_upfront, bant_coverage,
   next_step_grade, tieback_ratio (demo calls), catalog_coverage + gap_closure
   (functional_discovery/scoping), assumption_verification outcomes.
   Inspect call_analyses columns first; add missing columns additively.
2. `handoff-readiness` computation (function or view): composite per architecture doc
   (gates answered, gated-on coverage, critical integrations scoped, assumptions
   verified, scope-module diff) returning grade + named blockers.
3. Drivers summary generator: synthesizes the Business Drivers section from
   compelling_events + business_catalysts + deal_analysis driving_factors/ideal_solution
   with linked provenance; stored as a generated field (respects human edits: offers
   refresh, never overwrites).
4. Verification: a processed transcript yields a question inventory, at least
   correctly-classified question types on a hand-checked sample, and a nuggets list whose
   every row carries the quote.

## Phase 7: Frontend

All inline styles from theme.js; shared components; no emojis. Surfaces:

1. Provenance everywhere a value displays in the deal view: source chip
   (Manual/Transcript/Research) + expandable evidence (quote, speaker, call link, or URL,
   observed_at). History accessible per field.
2. Suggestions tray: per-deal "Suggested updates" (open field_suggestions) with inline
   accept (becomes manual edit, locks) / dismiss; inline "newer information available"
   indicator on affected fields.
3. AI Hypotheses area on the AE deal view: clearly labeled, visually distinct from facts,
   with reasoning + basis sources, confirm/dismiss actions. Hypotheses render NOWHERE
   else (not SC page, not DealRoom, not proposals).
4. SC page (new route, work-mode): the 15 catalog sections in doc order; per-section
   coverage indicators; per-field question, value, status chip, provenance, inline edit
   (both AE and SC edit; attributed via value history change_source); conditional
   sections collapse on gate=false; Business Drivers renders the generated summary with
   refresh; Modules section (recommended/demoed toggles per module_reference, AI
   suggestions shown as suggestions pending confirmation); readiness gate banner with
   named blockers; "Generate FDC handoff note" action rendering the structured data into
   the existing SC handoff note path (inspect how FDC handoff notes are generated today;
   reuse).
   AE push-to-SC: an explicit handoff action on the deal that notifies and unlocks the SC
   view; after push the page is a live shared surface.
5. Risk panel upgrade: risks grouped, plain-language names, evidence expandable (quotes
   or gap computation), severity, auto-resolved history.
6. Call view: execution analytics summary (ratios, depth, coverage), question inventory,
   nuggets missed list, and the Granola source link when present.
7. Conversation upload paths: optional "link Granola call" affordance on paste.

Verification: the three critical E2E flows pass on the demo tenant: (1) deal create ->
research -> cited facts + hypotheses visible with sources; (2) transcript process ->
fields/entities/metrics/risks/execution populate with provenance, manual edit + reprocess
-> suggestion; (3) SC page edit by a second demo user -> attributed history; push-to-SC ->
notification; readiness gate reflects state.

## Out of scope (do not build)

Granola connection itself (separate prompt: lumen-granola-connection.md; only the
granola_meeting_id columns and CONTEXT-ONLY handling here). ROIBuilder frontend. Forecast
Intelligence wiring. Salesforce/Chorus/Outlook/ZoomInfo integrations. Auto-sync/polling of
any transcript source. SSO/SAML and token encryption-at-rest (leave TODOs). PartnerHub.
Reading or modifying any data in the real org. Deleting the backup tables. deal_analysis
legacy column data migration (write-path deprecation only). Any UI for editing the
Platform Core protocol layer.

## Completion report

Self-annotated checklist per phase with verification evidence (queries + results), every
lean taken and why, the SKU-mapping gaps in module_reference for Joe's review, any
workbook rows that could not seed cleanly (with the row reference), edge function names +
version stamps deployed, and the explicit TODO list left behind (encryption-at-rest,
legacy column reads, module list curation).
