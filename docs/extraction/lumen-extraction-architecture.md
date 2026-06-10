# Lumen Extraction Architecture: Provenance, Accuracy, Deduplication, Sources

Status: strategy spec for project knowledge. Build prompts get cut from this per sprint.
Depends on: curated SC field catalog (pending), AE QDC extraction sheet, pre-call research sheet.

---

## 1. The Provenance Spine (settled rules)

Every extracted or entered value in Lumen carries three things:

1. **source** - one of `manual`, `transcript`, `research`
2. **provenance payload** - for transcript: verbatim quote + speaker + conversation_id + timestamp_in_call. For research: source_url + source_title + published/accessed date. For manual: changed_by user.
3. **observed_at** - when the fact was observed (call date or research run date), distinct from created_at.

### Precedence rules (final)

1. **No AI hypothesis, anywhere.** If a value cannot be backed by a verbatim quote (transcript) or a citable URL (research), it is not written. The field stays Unknown. This kills the current "suspected red/green flags" seeding in research-company and the hypothesis framing of the pre-call ICP score. Remediating the research pass is part of this build, not separate.
2. **Manual is permanent until manually corrected.** No automated pass ever overwrites a manually entered or manually edited value. Period.
3. **Automated changes to manual values become suggestions.** When a newer transcript or research fact contradicts a manual value, the system writes a row to `field_suggestions` (existing table) with the proposed value, full provenance, and the conflict context. The owner accepts or dismisses. Accepting converts it to a manual edit (which then locks it again).
4. **Among automated sources, most recent wins, change-aware.** A research refresh can supersede an old transcript value and vice versa, by observed_at. But recency is never a blind overwrite: the extraction pass always receives the prior value with its provenance, and classifies every write as new_fact (field was Unknown), confirmation (same value re-observed; bump observed_at and a reconfirmed counter, value unchanged), or changed_fact (value differs; new value wins, prior demotes to history, and the change is recorded as a visible deal event with both values and both sources, e.g. "entity count 8 to 12, stated on 6/12 QDC"). Material changes to qualifying-spine facts (entities, users, timeline, budget) also surface in the deal timeline so the rep sees the world moved, not just that a number silently updated. Superseded values demote to history (`custom_field_value_history` / table-specific history), never deleted.
5. **Speaker discipline for facts about the prospect's business.** A fact about the prospect counts as transcript-sourced only when stated or explicitly confirmed by a prospect-side speaker. The rep saying "you have 12 entities" with no confirmation is not a fact. Rep states it and prospect confirms ("right", "yes, twelve") counts, and the quote captured must include the confirmation.

### Storage mapping

- Custom-field values: `custom_field_values.source`, `extraction_quote`, `extraction_speaker`, `source_conversation_id`, plus history table. Add `observed_at` and `is_manual_locked` (set true on any manual write).
- First-class tables (deal_pain_points, compelling_events, business_catalysts, company_systems, deal_sizing, contacts, deal_analysis): these already carry source / quote / speaker / verified in most cases. Gaps get closed in the hardening pass (deal_sizing needs per-field source tracking; see section 3).
- `deal_sources` remains the cross-cutting provenance ledger: one row per fact-observation regardless of which table the value lands in.

---

## 2. Canonical Field Map (one home per field)

Rule: every fact has exactly one writable home. Everything else that displays it reads from that home. Known collisions and their resolutions:

| Fact | Canonical home | Deprecate / read-only |
|---|---|---|
| Entity count | `deal_sizing.entity_count` | `company_profile.entity_count` (research writes to deal_sizing with source=research) |
| Entities and locations | `deal_sizing` extension or SC field (decide in curation) | `company_profile.entities_locations(_list)` |
| Full / view-only users | `deal_sizing` | SC total_users / reporting_readonly_users bind here |
| AP bill volume | `deal_sizing.ap_invoices_monthly` | SC bills_per_period binds here |
| Fixed asset count | `deal_sizing.fixed_assets` | SC fixed_asset_count binds here |
| Warehouse count | `deal_sizing.warehouse_count` (new column) | SC warehouse_count binds here |
| Pains / problems to solve | `deal_pain_points` | `deal_analysis.pain_points` + `pain_points_list` become legacy display; SC problems_to_solve renders the table |
| Decision criteria | `deal_decision_criteria` | `deal_analysis.decision_criteria` + `_list` legacy |
| Integrations / systems | `company_systems` | `deal_analysis.integrations_needed` + `integrations_list`; `company_profile.tech_stack`; SC stack section binds here |
| Revenue streams | SC field (custom_field) or company_profile, decide in curation; one home only | the other |
| Drivers / motivation | `compelling_events` + `business_catalysts` + `deal_analysis.driving_factors/ideal_solution` | SC Business Drivers section is a generated summary over these, never independently captured |

The deal_analysis text + jsonb-list + relational-table triplication (pains, criteria, integrations) collapses to relational-table-as-canonical during the hardening pass. Text and _list columns stop being written; UI reads tables.

The merged field map (every field, its home, its extraction trigger, its display surfaces) is produced after Joe's curation pass on the SC catalog and becomes an appendix to this doc.

---

## 3. How the AI Identifies Fields in Transcripts

### Definition layer (what each field means)

Every extractable field gets an extraction definition. Two existing systems carry this; use both for what they are:

- `extraction_definitions` (entity-level): canonical_definition, anti_patterns, grammar, good_examples, bad_examples. Used for first-class entities (pain point, catalyst, compelling event, decision criterion, system, risk, contact role). The 4/22 Catalyst fix is the template.
- `custom_field_definitions` (field-level): ai_context, extraction_instructions, extraction_signals, negative_signals. Used for every SC catalog field. Each seeded field ships with: the question text, a one-line canonical definition, 2-3 positive signal phrasings (how prospects actually say it), 1-2 negative signals (what it is NOT, to prevent cross-field bleed), and the expected value type.

Example, close_duration_days: definition "number of business days from period end to close complete, as stated by the prospect." Signals: "takes us N days/weeks to close", "we close by the Nth". Negative signals: aspirational statements ("we want to close in 5 days" is desired state, goes to desired_reporting/ideal context, not current state). Type: number, with the unit normalization rule (weeks x5 business days, flag the conversion in notes).

### Extraction pass mechanics

1. Single structured pass per transcript (within process-transcript or a sibling, decided at build time), receiving: the field catalog with definitions and signals, the entity extraction definitions, the current value + source + observed_at for every field (so the model knows what exists), and the manual-locked list.
2. Output contract per field: status (found / not_found), verbatim quote, speaker, value, normalized_value, change classification (new_fact / confirmation / changed_fact, with reference to the prior value it saw), and target disposition (write | suggest | skip). The model proposes; the edge function enforces.
3. **Write-time gates live in code, not the prompt.** The edge function rejects any write lacking quote + speaker, any write against a manual-locked field (converted to suggestion), any prospect-fact quote where the speaker is rep-side without confirmation, and any value whose quote does not contain or directly support the value (cheap containment check for numbers: the number must appear in the quote or be a flagged unit conversion).
4. Ambiguity handling: a partial or unclear answer writes status=partial with the quote, and generates a follow-up task (existing task pattern). Partial never fills the value field with a guess.
5. Trigger matrix: research pass on deal create and on manual re-run. Field extraction pass on qdc, functional_discovery (FDC), scoping, demo. Drivers summary regenerates after qdc and functional_discovery (manual refresh if human-edited). Light pass (pains, catalysts, CEs, risks, contacts, next steps only) on sync and other call types, since functional facts can surface anywhere but the full 60+ field catalog need not run on every check-in call. Every pass is accumulate-only against locked values.
6. Re-extraction is free: full raw responses persist in conversations.ai_raw_response, so catalog/definition changes can re-run against history without credits.

### Pain tie-in (Joe's rule)

SC functional answers that quantify a problem are pain evidence, not just field values. The extraction contract includes an optional pain_link per field result: when a quantified answer evidences a pain (close takes 15 days, AP is manual across 300 bills), the pass either links to an existing deal_pain_points row or proposes a new one (subject to the same quote gate and dedup below). custom_field_values gets a nullable pain_point_id. This routes SC quantification into quantified pain, ROIBuilder, and proposals.

### Concept-driven extraction (not question-anchored)

The field catalog's questions document intent; reps ask similar-but-different questions and prospects volunteer facts unprompted. A field is found whenever its canonical definition and signals match a prospect statement, regardless of what question preceded it. Extraction never conditions on a question having been asked. Protocol step 16.

### Metrics sweep and deal_metrics (new table)

Every quantified business statement by a prospect-side speaker is captured as a metric observation, independent of whether any field matched: the guarantee that stated numbers are never lost. New table `deal_metrics`:

- deal_id, metric_key (nullable; from the Key Metrics taxonomy when unambiguous), label (prospect's own term when unmapped), value, unit, period (month/year/event), as_of, quote, speaker, conversation_id, source, observed_at, field_value_id (nullable link), pain_point_id (nullable link). Org-scoped RLS.

Rules: containment and speaker discipline apply in full; field values and pain quantifications link to their observation rather than duplicating the number (the observation is the quantitative record); unmapped labels get reviewed and recurring ones promoted to taxonomy keys. deal_metrics feeds ROIBuilder directly: prospect-stated metrics with quote citations are exactly what coach_roi_metric_benchmarks' prospect-benchmark type and the operational metric library (DSO, DPO) are designed to consume, so ROI models cite the prospect's own numbers. Starter taxonomy (22 keys) lives in the AE extraction definitions workbook, Key Metrics tab.

### Scores (new)

Two coach-level score types added to scoring_configs:

- **Compelling Event Score**: from compelling_events strength, event_date proximity, verified status, and recency of reconfirmation (reconfirmed_at exists). No CE rows = 0 and a HIGH RISK flag (matches existing QDC rule).
- **Catalyst Score**: from business_catalysts urgency, impact, count of verified catalysts.

Together with Finance-Operations Orientation, the qualifying spine becomes fully computable: all three missing = "deal isn't real yet" becomes a deal flag, not just doctrine.

---

## 3b. The Hypothesis Layer (quarantined, never fact)

AI reasoning about a deal is valuable coaching signal; it just must never share a surface or a table with facts. New table `deal_hypotheses`:

- deal_id, hypothesis_type (`red_flag` | `green_flag`, extensible), hypothesis (text), reasoning (why the AI believes this), basis_source_ids (array of deal_sources rows the reasoning drew on, so every hypothesis shows its work), confidence, generated_by (research | transcript_pass | retrospective), status (`open` | `confirmed` | `refuted` | `dismissed`), confirmed_by_source_id, created_at, resolved_at. Org-scoped RLS like everything else.

Rules:

1. Research and transcript passes write suspected red/green flags HERE, never to deal_analysis. The current seeding of deal_analysis.red_flags/green_flags from research is removed; deal_analysis flags become verified-fact territory only (quote-backed or manual).
2. Hypotheses display in a clearly labeled "AI hypotheses" area on the deal view, visually distinct from facts. No hypothesis ever renders on the SC page, in the DealRoom, in proposals, or in any client-facing or handoff surface.
3. Lifecycle: later evidence confirms (promotes to a verified flag/fact with the confirming quote) or refutes (closed with the refuting evidence). Reps can dismiss. All transitions logged.
4. Hypothesis accuracy is a measurable promotion-case signal: the AI retrospective on deal close scores open and resolved hypotheses against the outcome (did the suspected red flags materialize?), feeding deal_outcome_analysis and prompt_learnings. "Lumen's early-warning hypotheses were right N% of the time" is a demo line backed by data.

---

## 3c. Deal Risk Taxonomy and Call Execution Analytics

### Risk taxonomy (MEDDPICC / Power of 7 internally; plain language in the UI)

deal_risks gets a controlled 27-risk taxonomy (AE workbook, Deal Risk Taxonomy tab) spanning two families in one table: deal-execution risks (budget, economic buyer, authority, champion, pain quality, the Sage qualifying spine, timing, decision criteria and process, paper process, competition, threading, consultant gatekeeping) and solution/SC risks (functional fit gaps on stated must-haves, discovery coverage gaps before demo/proposal, data migration complexity, critical-integration feasibility, rev rec/compliance complexity vs timeline, scope-vs-module mismatch, and demos built on unverified assumptions). One important boundary inside the solution family: the prospect's requirement is the fact; the fit assessment against it is coach knowledge and is always labeled as such, never presented as a prospect fact. Methodology anchors are internal only: Power of 7 never surfaces as a label; the UI shows plain-language risk names.

The structural addition is the evidence_type on every risk: **stated** (quote-backed, e.g. a bias statement from the CFO), **gap** (a computable absence: no EB evidence after N discovery calls, zero CE rows in a forecast-category deal, single-threaded participant history), or **hypothesis** (pattern-shaped, which routes to deal_hypotheses, never to deal_risks). Gap risks satisfy the no-hypothesis rule because they are verifiable claims about the record itself, computed deterministically from coverage state, not inferred about the prospect. Several previously doctrinal rules become standing computed risks: no-CE-in-commit, the all-three-spine-signals-missing "deal isn't real" flag, timeline slippage (computable from change-aware recency history on the timeline fields), and single-threading (computable from conversation participants).

### Call execution analytics (the coaching extraction layer)

A second extraction dimension, distinct from deal facts: observations about how the rep or SC ran the call, every one evidenced by transcript references. Defined in the AE workbook (Call Execution Analytics tab, 19 signals), covering AE-side execution (question inventory and type classification, quantifying and impact questions with landed-vs-missed tracking, discovery depth per topic, prospect thinking pauses, nuggets missed, talk ratio, longest monologue, open/closed ratio, agenda/upfront contract, per-call BANT coverage, next-step quality, objection handling, demo etiquette tie-backs, confirmation loops) and SC/FDC-side execution: catalog coverage per call (the FDC analog of bant_coverage, feeding the next-FDC agenda), assumption verification (research-sourced and partial facts confirmed aloud, which clears the unvalidated-assumptions risk), gap closure rate (do follow-up tasks actually convert partials into facts), and a composite FDC/demo readiness gate per the Sage playbook (computed from coverage and risk states, surfacing named blockers on both the SC page and the AE deal view before a demo gets scheduled).

Storage: first-class per the no-blob rule: `call_questions` (one row per rep question, classified, with what it elicited), `call_moments` (nuggets missed, pauses, objections, confirmation loops: typed moment rows with turn references), and call-level metrics on `call_analyses` (talk_ratio, longest_monologue, depth summary, bant_coverage, next_step_grade, tieback_ratio). Runs inside the same transcript pass family; outputs feed rep_coaching_summary, the post-call coaching note, and the coaching-velocity promotion metric.

Timestamp dependency: pause detection and time-based talk ratio require per-turn timestamps (Granola transcripts have them); the pass degrades gracefully to verbal markers and word counts when absent, labeling which basis it used.

### Universal Granola linkage

Every conversation sourced from a Granola call stores granola_meeting_id and the Granola share link, regardless of arrival path (picker import, future auto-sync, or manual paste of a Granola transcript when identifiable). The conversation view displays the link back to the source call. The picker import sets it automatically; the paste flow offers an optional "link Granola call" affordance.

---

## 4. Deduplication Architecture

Three layers, addressing different duplication modes:

**Layer 1, field-level: canonical homes (section 2).** The same fact never has two writable locations. This eliminates structural duplication by design.

**Layer 2, entity-level: match-before-insert.** For row-based entities (pain points, catalysts, compelling events, decision criteria, systems, risks, contacts), every extraction pass matches candidates against existing rows for the deal before inserting:

1. Exact/fuzzy match on the natural key (system_name + category for systems; contact name/email; competitor name).
2. Semantic match for free-text entities: embed the candidate (same embedding model as deal_context_chunks) and compare against existing rows' embeddings; above threshold = same entity. "Month-end close takes too long" and "their close process is slow and painful" must resolve to one pain row.
3. On match: enrich, do not insert. Append the new quote as additional evidence (deal_sources row linked to the same entity), update quantification if newer, bump observed_at. On no match: insert.
4. The threshold judgment goes to the model with both candidates in context ("same pain or different pain?") rather than a raw cosine cutoff, with the cosine gate only used to shortlist comparisons. Borderline calls insert with a possible_duplicate_of reference flagged for the rep, rather than silently merging distinct pains.

**Layer 3, cross-call: accumulate by upsert.** Field values upsert on (deal_id, field_key). New observation of the same field updates value + provenance by recency rule, demoting the old value to history. Nothing re-inserts.

Duplication QA metric for the pilot: per-deal duplicate-entity rate (manual merges performed by reps), captured via ai_corrections so the learning loop sees it.

---

## 5. Suggestions Queue (the manual-lock mechanic)

`field_suggestions` becomes the single queue for every automated-vs-manual conflict:

- Row: deal_id, field_key (or entity table + row id), current_value, suggested_value, source + full provenance of the suggestion, created_at, status (open / accepted / dismissed).
- Surfaced in UI as a per-deal "Suggested updates" tray on both AE and SC pages, and inline on the field (small indicator: "newer information available").
- Accept = manual edit with the suggested value (locks it, logs to history with change_source). Dismiss = logged; the same fact re-observed later may re-suggest only if provenance is new.
- All accept/dismiss decisions log to ai_corrections / ai_suggestion_tracking, feeding prompt_learnings.

---

## 6. Research Source Strategy (facts-only)

### Enforcement changes to research-company (remediation, in scope)

1. Output contract becomes claims-with-citations: every fact must carry a source URL. Claims without a URL are dropped by the edge function, not just discouraged in the prompt.
2. Suspected red/green flag seeding moves out of deal_analysis and into `deal_hypotheses` (section 3b). Research writes no deal judgments into fact tables; its reasoning lands in the quarantined hypothesis layer with its basis sources attached.
3. ICP fit at the research stage computes only over verified facts and is labeled as such ("fit based on N verified facts"); fields still Unknown do not contribute.
4. Source-quality ordering in the research prompt: primary over secondary. Company website, press releases, SEC EDGAR (public cos), state business registries, official app marketplaces and case studies, then reputable trade press, then aggregators. Forums and low-quality aggregators excluded for facts (allowed only as leads to verify).
5. Every research fact writes deal_sources with source_origin=research, URL, title, published date, accessed_at. Recency rule runs on published/observed date.

### Source assessment (current stack vs alternatives)

- **Perplexity (Sonar Pro / Deep Research): keep.** It is the synthesis layer, and the accuracy problem was never Perplexity, it was Lumen accepting uncited output. With the claims-with-citations contract enforced in code, it stays the primary web-research engine. Steer it toward primary sources via the prompt ordering above.
- **Apollo: keep for pilot.** Right price point and adequate firmographic + contact accuracy at this scale; independent testing puts no provider as universally best and positions Apollo as the value leader. Known weakness: senior-title staleness, mitigated by the confirm-on-call cycle.
- **ZoomInfo: the post-handoff upgrade, not a pilot purchase.** Enterprise-grade breadth at enterprise cost, and Sage already licenses it (it is in the stack Lumen consolidates). Plugging Lumen into Sage's existing ZoomInfo contract via API is a promotion-case integration line item, not a v1 expense. The integrations/field-mapping layer means this is mapping rows, not new code.
- **Clearbit: dead end.** Absorbed into HubSpot as Breeze; standalone tools sunset. Remove from consideration.
- **NinjaPear: dropped (unreliable in practice).** Replace with a cheap fallback in research-company: logo.dev or the Google favicon endpoint (`https://www.google.com/s2/favicons?domain={domain}&sz=128`), writing to the same `company-logos` bucket and `company_profile.logo_url`. Cosmetic only; no accuracy stake, so the cheapest reliable option wins.
- **Targeted primary-source additions worth piloting cheaply:**
  - SEC EDGAR (free API) for public companies and PE-backed cos with public filings: revenue, entities, fiscal year, segment data. Highest-trust source that exists for those facts.
  - State Secretary of State registries (GA and other states as needed) for entity structure: registered entities, officers. Directly serves entity_count and corporate structure with registry-grade citations. No unified free API; treat as a Perplexity-steered target ("check state business registries") rather than a custom integration in v1.
  - Job postings (already partly via hiring_signals): keep as catalyst evidence with posting URLs as citations.
- **Technographics (BuiltWith / HG Insights): defer.** Marginal for back-office ERP/payroll detection, which web technographics see poorly. The confirm-on-call cycle through company_systems is the reliable path for stack facts.

---

## 7. Build Sequencing

1. **RLS cleanup** (live exposure; already scoped: 4 backup tables + permissive-policy coach tables). Ships first.
2. **Provenance + precedence enforcement**: observed_at + is_manual_locked, write-time gates in process-transcript, suggestions queue wiring, research-pass remediation (citations contract, kill flag seeding). This is the trust foundation everything else writes through.
3. **Canonical field map migration**: collapse the deal_analysis triplications, resolve the deal_sizing collisions, add warehouse_count.
4. **SC catalog seed + extraction pass** (post-curation): seed custom_field_definitions with definitions/signals, build the field extraction pass with the pain tie-in, add CE and Catalyst score configs.
5. **SC page + modules**: editable SC surface, deal_modules table + authored module list, drivers summary generation, AE push-to-SC handoff, FDC re-run.
6. **Granola connection** (prompt doc already written) can run in parallel with 4-5 since it touches different surfaces.

Each step cuts to its own Claude Code prompt doc with explicit out-of-scope sections.

---

## Open items (resolved 6/9)

- SC field catalog: **keep all 94 fields.** Fields that bind to existing homes (deal_sizing, company_systems, deal_pain_points) still get extraction definitions; only the storage target differs.
- Module-to-SKU mapping: **now, against the pricebook** (412 products). The authored module list maps each module to representative pricebook SKUs so recommended/demoed modules flow into QuoteBuilder line items.
- Extraction definitions: authored per field in `sc_extraction_definitions.xlsx` (companion to this doc); seeds custom_field_definitions (ai_context, extraction_instructions, extraction_signals, negative_signals) and extraction_definitions (entities).
- Speaker-confirmation rule: pending Joe's confirmation.

## Granola ingestion addendum

granola-import also calls `get_meetings` for the meeting's notes and AI summary and stores them on the conversation (metadata or a dedicated column). Two rules keep this consistent with the provenance spine:

1. **Granola's AI summary is context, never fact.** It is AI-generated text, not prospect speech, so it can never satisfy the quote gate. It is passed to process-transcript as auxiliary context and stored for display, but no field value may cite a Granola summary as its provenance. Only the verbatim transcript produces quotes.
2. **Granola action items seed task extraction, not the tasks table directly.** Pass them as auxiliary context so Lumen's existing task extraction remains the single task author. This avoids duplicate tasks (Granola's "send pricing" vs Lumen's extracted "send pricing proposal") since one author plus existing context beats two authors plus dedup.
