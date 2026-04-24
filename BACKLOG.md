# Revenue Instruments — Master Backlog

**How to use this file:**
- Every sprint prompt starts with: "Read BACKLOG.md. Build everything in the current sprint section. Mark each item done when complete. Move completed items to the Done section."
- After each sprint, update this file: mark done items, add new beta feedback items, move deferred items up.
- Never skip an item without marking it `[DEFERRED reason]`.

---

## 🔴 CURRENT SPRINT — April 25, 2026 (batch shipping)

> Sprint #3 live. Everything below is what's left after the 4/25 batch. Build verified after each chunk.

### High — still open
- [ ] **Proposal Builder full rewrite** — integrated quote generator, AI-generate quantified pains + outcomes + "why we're here", real ROI/TCO calculators, full quoting engine. Multi-session lift. `[BF: 1e76c5e2]`
- [ ] **Custom fields platform-wide** — create custom fields in coach admin that get extracted by AI and appear throughout platform. `custom_field_definitions` table already wired into `assemble_coach_prompt`; needs UI across CoachAdmin/DealDetail/ExtractionDefinitions. `[BF: 819d85f4]`
- [ ] **Reports engine — real cross-reference + AND/OR groups** — Reports engine foundation shipped, but user reports `/reports` still routes to pipeline in some contexts. Verify routing + extend with Salesforce-style report-of-reports cross-ref. `[BF: de4123bb, 4662ea9c]`
- [ ] **DealDetail + Settings + Admin density sweep** — density pass so far hits Shared.jsx, Pipeline header cards, and the grid breakpoints. DealDetail + Settings + Admin still need a pass. `[BF: 648514a1]`

### Beta readiness (needed before inviting external beta users)
- [ ] **First-deal guided walkthrough** — step-by-step for new users after they land on the empty-state pipeline (CTA already present, walkthrough state machine not yet)
- [ ] **Beta welcome email sequence** — Day 0 / 1 / 3 / 7 / 14 via Resend, triggered on first login
- [ ] **Mobile responsive audit** — Pipeline widgets now re-layout on sm/xs; DealDetail + Settings + Coach + Admin still need explicit mobile sweep
- [ ] **Remaining empty states** — Settings with no coach, MSP with no template, Quote Editor with no products, Reports with no saved reports

### Tests (before fundraising)
- [ ] **Edge function smoke tests** — 5 functions: embed-chunks, build-deal-context, manage-ai-memory, process-transcript, generate-deal-retrospective
- [ ] **E2E flow 1** — create deal → research fires → company_profile populated
- [ ] **E2E flow 2** — upload transcript → tasks/insights inserted → assembled_prompt_versions row created
- [ ] **E2E flow 3** — chatbot session → feedback captured → field updated

### Tests (before fundraising)
- [ ] **Edge function smoke tests** — 5 functions: embed-chunks, build-deal-context, manage-ai-memory, process-transcript, generate-deal-retrospective
- [ ] **E2E flow 1** — create deal → research fires → company_profile populated
- [ ] **E2E flow 2** — upload transcript → tasks/insights inserted → assembled_prompt_versions row created
- [ ] **E2E flow 3** — chatbot session → feedback captured → field updated

---

## 🔵 ROADMAP — Future sprints (not current scope)

### PartnerHub Renee MVP
- [ ] Schema: partner_orgs, partner_pages, partner_resources, deal_partners, deal_comments
- [ ] AE side: @handle invocation in DealDetail to invite a partner
- [ ] Partner workspace: scoped view of assigned deals, comment thread, no transcripts/scores
- [ ] Manual Paystand setup + Renee test

### Manager 1:1 Tracker
- [ ] Track 1:1 meetings with manager, action items, coaching focus areas, things working on
- [ ] Route: /1on1 or section in Settings/Pipeline
- [ ] Not in beta scope

### Platform / GTM
- [ ] Stripe + outcome-based pricing (success fee or hybrid base+success)
- [ ] Salesforce sync
- [ ] HubSpot sync
- [ ] Auto-transcript webhooks: Gong, Chorus, Teams, GMeet
- [ ] SOC 2 roadmap
- [ ] Phase D forecasting prediction model (needs 500+ closed deals)
- [ ] LinkedIn data enrichment

---

## ✅ DONE

### April 25, 2026 sprint #3 — drag-drop dashboards, voice fields, tests-adjacent hygiene
- [x] **Dashboards per scope** — `/dashboards` page with create/edit/clone/delete, drag-arrange widgets via react-grid-layout, per-scope (deal/rep/team/territory/industry/org). Widget library sidebar pulls from `custom_widget_definitions`. Each dashboard tile on the grid has a `⋯` menu with **Edit definition** (opens /admin/widgets in new tab), **Clone (creates new editable copy)** (duplicates the definition, swaps the dashboard widget to the clone), and **Remove from dashboard**. Migration: `org_widget_layouts.scope` + `scope_value` + `slug`, RLS locked to user's org.
- [x] **Admin org-first navigation** — AdminConsole has an org scope selector + scoped banner + "Open full org page →" deep link. Users / Usage / Credits tabs filter their queries to the scoped org; Organizations-list tab hides when scoped. `[BF: 301911f7]`
- [x] **Catalyst prompt hardened (v33 deployed)** — explicit ownership-change → CATALYST (not compelling event) negative-example block, warehouse/inventory quote-sizing hint added. RAG ingest wrapped in `EdgeRuntime.waitUntil`. `[BF: b09df111]`
- [x] **Coach Voice & Behavior structured fields** — migration `coaches.tone` / `response_format` / `behavior_rules` / `custom_context`; CoachVoiceEditor card with 4 accent-coded boxes, edit-save-per-field, nice typography (not mono). `assemble_coach_prompt` RPC updated to splice all four into the coach context layer. `[BF: bccec18b, 899d6564]`
- [x] **Coach Admin prompt UI polish** — Research Prompt display uses pretty left-accent card (not mono typewriter); Custom Research Instructions textarea switched from T.mono → T.font; email templates now have separate Tone / Format / Rules / Custom Instructions fields and `sort_order` field removed per feedback. Migration: `email_templates.tone` + `response_format` + `rules`. `[BF: 6c18bf, 899d6564]`
- [x] **Coach Admin focus areas / anti-rules / custom instructions** — TagInput bubble pickers already land for Focus Areas + Anti-Rules; Custom Research Instructions stays as a textarea but with the correct font + sizing. Verified.
- [x] **UI density pass (Shared components + Pipeline)** — Shared Card title 8/14→6/12, margin 12→10; Shared inputs 10/12→8/10; Field 12→8 margin; Pipeline forecast cards 14→8/10 padding + auto-fit grid; Pipeline responsive breakpoints add `sm` (6-col) + `xs` (4-col) tiers. `[BF: 648514a1]`
- [x] **Bulk task operations on Pipeline task widget** — row-level checkboxes, Select all / N selected bar, bulk Complete (completed=true + completed_at), bulk Delete with confirm, Clear. `[BF: e08dfbef]`
- [x] **Scoreboard benchmarks** — verified already shipped with vs-org deltas + orgAvg tick marks on each ScoreBar, gated on org ≥2 reps. `[BF: 66b345b0]`
- [x] **Widget builder rebuild (preview-first + drag-drop)** — DB field tree with HTML5 drag source; drop onto section drop zones; drag field chips to reorder; filter field picker (no more raw text); value picker adapts to badge options / boolean / numeric; conditional formatting editor with field/operator/value + scope + color + bold; save toast + error surface; "+ formula" chip creates calculated columns; Properties panel shows formula editor with identifier hints. `[BF: 5e82e06c, af192bb4, 3d2d7749, 49bc45fe]`
- [x] **Widget formulas + cross-reference filters** — `widgetQuery.js` supports `filter_logic: 'and'|'or'` + `filter_groups[]` (OR rendered via supabase `.or(pgrest-string)`). Formula fields: safe arithmetic evaluator, +-*/() and identifier substitution against row + joined tables. WidgetBuilder shows AND/OR toggle when 2+ filters. `[BF: 5cd000dc]`
- [x] **URL transcript import** — `import-transcript-url` edge function v1 deployed. Accepts Chorus/Gong/Fathom/Zoom share URLs, server-side fetch, HTML scrape (gong JSON path / turn/utterance regex / plain-text fallback), inserts conversations row, kicks `process-transcript` via `waitUntil`. UI row in TranscriptUpload above the file uploader. Migration: `conversations.source_url`. `[BF: 071402cc]`
- [x] **Quote sizing — warehouse/inventory + auto-populate** — migration `deal_sizing.warehouse_users / inventory_users / fulfillment_users / receiving_users / customer_count / order_volume_monthly` + `auto_populated_from_transcript` flag + timestamp. DealDetail QuoteSizingWidget: new "Warehouse / Inventory / Volume" section + "Auto-populate from transcripts" regex scan over conversations.transcript + pain_points. `[BF: 849ca5f8]`
- [x] **Pipeline empty state** — zero-deal accounts now see a guided welcome card on `/` with a 4-step walkthrough and a "Create first deal →" CTA instead of an empty pipeline view.
- [x] **DealDetail tab empty states upgraded** — Contacts / Transcripts tabs now use the new EmptyState with an icon, heading, body copy, and a direct action button (Add contact / Upload transcript). Tasks tab kept existing EmptyState (still works — back-compat).
- [x] **Loading skeletons** — `Shared.Skeleton`, `SkeletonTable`, `SkeletonCards` components (shimmer animation). DealDetail CompanyProfileWidget now renders a typed skeleton + "Researching {company}..." header when `research_status` is pending/in_progress and no overview exists.
- [x] **Error boundaries per route** — `components/ErrorBoundary.jsx`. Every route in App.jsx wrapped with a labelled ErrorBoundary; failure UI shows technical details + Try again / Reload / Back to pipeline. Sentry hook-up attempted via `window.Sentry`.
- [x] **Chatbot end-of-session satisfaction** — when `closePanel` fires on a 3+ message session that hasn't been rated yet, show a 1-5 star + optional notes overlay. On submit, writes to `chatbot_session_feedback` with message_count, thumbs_up/down counts, satisfaction_score, satisfaction_notes. Tracks `chatbot_satisfaction_rated` analytics event. Skip closes without writing.
- [x] **AI contact edit tracking** — `saveContact` now writes to `ai_suggestion_tracking` with `action='edited'` + before/after payload of name/title/role/department/email/influence when editing an AI-sourced contact (notes begins `Source:`). Delete tracking was already shipped.
- [x] **Inline dashboard widget ⋯ menu** — Edit definition (opens /admin/widgets hash-link in new tab), Clone (inserts a new editable copy of the widget definition and swaps it into the dashboard), Remove from dashboard.

### April 24, 2026 sprint #2 — regressions + new feedback
- [x] **RG1 — Settings My Coach: share + delete** — `CoachSection` now accepts `ownerActions`. "Coaches You've Built" row shows inline Share + Delete buttons. Share inserts a `coach_share_tokens` row and reveals a copy-to-clipboard panel. Delete soft-archives via `active=false` (scoped by `created_by`). `[BF: 32cae416]`
- [x] **RG2 — Team page edit/delete** — "My Team" tab is now the rep's personal `user_team_members` roster with real CRUD (add, edit-inline, delete) for SCs / partners / managers / collaborators, plus a read-only "Org Roster" card below. "Users" tab now lets **admins** (not just system_admin) change non-system-admin roles; disabled-state badges carry tooltips explaining why an action is unavailable. `[BF: e7c4f579]`
- [x] **RG3 — Catalyst prompt hardened** — process-transcript bumped to v33 with explicit "rejection test", enumerated always-pain examples, and explicit permission to emit zero catalysts. Addresses `c6905825`.
- [x] **Reports engine foundation** — Reports page now has a real Build Report wizard: pick any table from `widgetSchema` TABLES, checkbox fields, stack filters (=, !=, >, <, contains, is empty, is set), sort, limit, aggregate (row list / count / sum / avg). Results render as a table with CSV export. Edit/Delete on custom reports. Prebuilt reports are read-only-runnable. `[BF: de4123bb, 4662ea9c]`
- [x] **Widget scope field** — WidgetBuilder has a Scope dropdown (deal / rep / team / territory / industry / org). Stored in `custom_widget_definitions.config.scope`. `[BF: 5841f06d]`
- [x] **Widget header color** — WidgetBuilder has a color picker + hex input. Stored in `custom_widget_definitions.config.header_color`. DealDetail widget grid reads the custom def and applies the color to the header border, title color, and tinted header background. `[BF: 2ea672b0]`
- [x] **Coach Admin bubble picker** — Research tab: Focus Areas is now a `TagInput` bubble picker (type + Enter/comma to add). New "Anti-Rules / What NOT to do" card with its own TagInput. Migration added `coach_research_config.anti_rules jsonb default '[]'`. `[BF: 9ffb5b95]`

### April 23, 2026 sprint #1 — WS1–WS11 (shipped)
- [x] **WS1** — RAG ingest fix: unawaited fetch in process-transcript was being cancelled on response return. Wrapped in `EdgeRuntime.waitUntil` with error logging so `deal_context_chunks` actually populates.
- [x] **WS2** — Reports page race: `useModules` now waits for `authLoading` before deciding modules is empty, so authenticated users no longer redirect to `/` on first paint.
- [x] **WS3** — process-transcript v32 live: flags reconciliation (confirm/contradict existing) + contact extraction tightened to decision-relevant prospect-side contacts only.
- [x] **WS4a** — MSP stage colors: pending/in_progress/completed/blocked/at_risk with status picker.
- [x] **WS4b** — MSP internal (`assigned_team_contacts`) + client (`assigned_client_contacts`) contacts per stage.
- [x] **WS4c** — MSP shareable portal cleaned: opt-in "Powered by", progress bar excludes tweener stages, client contacts visible, AE email link, auto-detected meeting/recording links (Chorus/Gong/Fathom/Zoom/Teams/GMeet/Loom).
- [x] **WS4d** — MSP template stages have call_type, purpose, notes, attendee_roles (multi-select across AE/SC/Champion/EB/TE/Exec/Legal/Procurement).
- [x] **WS5a** — Next steps inline in DealDetail header with "Last updated" timestamp; no widget.
- [x] **WS5b** — Scores + Deal Info are separate widgets; ICP Fit tooltip (plus Fit/Health) with human-readable explanations and, when available, top score drivers from `icp_fit_breakdown`.
- [x] **WS5c** — Flags widget: resolved toggle, `last_confirmed_at`, resolved reason, show/hide resolved.
- [x] **WS5d** — Stuck transcript (>10 min unprocessed) shows "Processing failed" badge + Retry + Delete.
- [x] **WS5e** — Recent news URLs hyperlinked: robust parseNewsItem handles parenthesised trailing URL AND inline URL anywhere in the text.
- [x] **WS5f** — Deal Analysis widget in 2-column grid (1fr 1fr) with running problem cost banner.
- [x] **WS6a** — Coach Admin density: Card padding pinned to 10, overview + edit forms in 2-col grids, less whitespace.
- [x] **WS6b** — Scoring weights editable with running total (green when =100%, red otherwise) + per-score-type tooltips.
- [x] **WS6c** — Extraction rules as structured entity toggles with optional per-entity custom instructions (serialised to JSON in `coaches.extraction_rules`).
- [x] **WS6d** — Email template body editor with "Insert variable" dropdown (inserts at cursor) covering 8 tokens + subject-line token hint.
- [x] **WS7a** — OrgSettings shows current plan card + Upgrade CTA; full plan comparison collapsed behind "View all plans" toggle.
- [x] **WS7b** — Sidebar NavLinks all use `end` prop so no nav item highlights on prefix matches (fixes Settings lighting up on /settings/organization).
- [x] **WS7c** — Admin Usage tab: per-org × response_type with prompt/completion/total tokens, sortable; success/failed/pending counts; 7d/30d/all range filter.
- [x] **WS7d** — Admin Users: sortable Name/Email/Role/Org/Modules/Created, inline role edit, Modules override count column, platform-admin invite flow.
- [x] **WS7e** — /settings/team is now tabbed: admins see Users (full admin view + invites) and My Team (teammate roster); reps see only My Team.
- [x] **WS8a** — Chatbot thumbs: surface refetch + insert errors; if optimistic message has no id yet, fall back to most-recent assistant message in the session; generalised `chatbot_thumbs` analytics event (up + down).
- [x] **WS8b** — Close-out modal: intercepts stage → closed_won/closed_lost/disqualified, records outcome reason; "Skip" also tracks dismissal.
- [x] **WS8c** — Silent AI suggestion tracking on auto_generated tasks: accept (complete), reject (delete), incl. bulk operations, writes to `ai_suggestion_tracking` with `time_to_action_seconds` + before/after payload. AI-sourced contacts also tracked on delete.
- [x] **WS9a** — Quota CSV upload: template download + papaparse preview + bulk apply to 12 months.
- [x] **WS9b** — My Coach simplified to 3 sections: Org coach, Coaches you've built, Shared coaches.
- [x] **WS9c** — Coach share tokens: generate with label/max_uses/expiry, copy, revoke, audit use counts.
- [x] **WS10a** — Proposal "Generate from deal" synthesises problems from `deal_pain_points` (ordered by annual_cost) and maps solutions round-robin through coach value_propositions; seeds exec summary.
- [x] **WS10b** — Primary quote with line items rendered inline (subscriptions / implementation / services grouped).
- [x] **WS10c** — TCO breakdown table + auto ROI (annual impact / investment %); auto-populated if user leaves expected_roi blank.
- [x] **WS11** — PostHog + Sentry initialised in main.jsx (no-op when env vars unset). Key events tracked: user_signed_in, deal_created, deal_closed, transcript_uploaded, transcript_processed, chatbot_opened/topic_selected/message_sent/thumbs.

### Infrastructure
- [x] 122+ table Supabase schema, all org-scoped RLS
- [x] 17 edge functions deployed (process-transcript v32, research-company v33, deal-chat v13, onboard-organization v9, embed-chunks, ingest-deal-knowledge, build-deal-context, manage-ai-memory, generate-deal-retrospective, send-invitation, create-invited-user, generate-email, generate-slides, update-coaching-summary, consolidate-deal-data, process-retrospective-queue, consolidate-deal)
- [x] assemble_coach_prompt RPC — 4-layer prompt assembly
- [x] 14 locked platform-core extraction definitions in system_ai_rules
- [x] pgvector + HNSW index on deal_context_chunks (vector(1536))
- [x] pg_cron: 4 of 5 jobs scheduled (nightly snapshots, rollups, cleanup, idempotency)
- [x] Multi-tenant RLS — all tables org-scoped, 2 acceptable WARNs
- [x] Coach template architecture — clone on new org, 7 prompts + scoring configs
- [x] deal_chat_sessions.context_type column
- [x] coach_share_tokens table
- [x] Beta plan (slug: beta, 99,999 credits, is_public: false)
- [x] IP cleanup migrations applied (7 migrations April 21)

### Frontend — pages
- [x] Pipeline (kanban + table, forecast summary, quota tracker, widgets) + localStorage view persistence
- [x] DealDetail (6 tabs: Overview, Contacts, Transcripts, MSP, Proposal, Tasks)
- [x] CallDetail (transcript + AI analysis + source link anchors)
- [x] MSPPage
- [x] QuoteEditor
- [x] ProposalBuilder
- [x] DealRetrospective
- [x] CoachAdmin (prompts, docs, scoring, MSP templates, email templates)
- [x] CoachBuilder (8-step wizard with ICP, personas, call types, live preview)
- [x] Reports (prebuilt reports, category filter)
- [x] Settings (profile, quota, coach selection)
- [x] TeamManagement (tabbed Users / My Team)
- [x] OrgSettings
- [x] WidgetBuilder
- [x] AdminConsole (7 tabs)
- [x] OrgDetail
- [x] ExtractionDefinitions
- [x] Invitations admin
- [x] BetaFeedback admin
- [x] Onboarding (7-step wizard with full coach setup — competitors, value props, personas, green/red flags)
- [x] AcceptInvite
- [x] MSPClientPortal

### Frontend — components
- [x] GlobalChatbot (floating, topic selector, session history, thumbs with fallback id resolution)
- [x] SourceLink (transcript citation pills → CallDetail anchor)
- [x] Layout with role-aware sidebar (fixed active state)
- [x] OrgContext provider
- [x] RequireOrg / RequireAdmin / PlatformAdminGuard

### Features
- [x] process-transcript using assemble_coach_prompt (v32 with flags reconciliation + decision-relevant contacts + waitUntil RAG ingest)
- [x] Catalyst vs pain point separation enforced in extraction schema + rules
- [x] Source linkage on catalysts/events/pains (transcript_excerpt, speaker, timestamp, quote)
- [x] deal_sources universal evidence layer
- [x] AI memory written per transcript
- [x] ICP scoring (compute_icp_score RPC)
- [x] send-invitation + Resend email working
- [x] Invite Organization modal in AdminConsole
- [x] Pipeline view persistence (localStorage)
- [x] Recent activity shows call date + type
- [x] Credits → "Billing (beta)" tab rename

---

*Last updated: April 25, 2026 sprint #3*
*Next update: after next sprint completes*
