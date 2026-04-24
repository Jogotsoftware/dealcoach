# Revenue Instruments — Master Backlog

**How to use this file:**
- Every sprint prompt starts with: "Read BACKLOG.md. Build everything in the current sprint section. Mark each item done when complete. Move completed items to the Done section."
- After each sprint, update this file: mark done items, add new beta feedback items, move deferred items up.
- Never skip an item without marking it `[DEFERRED reason]`.

---

## 🔴 CURRENT SPRINT (completed April 24, 2026)

> Sprint #2. Regressions + new beta feedback. Build verified, all items shipped. See Done section.

*(Items moved to Done below.)*

### Carried over from previous queue
- [ ] **Admin org-first navigation** — selecting an org in /admin should be top-level, then drill into tabs (Organizations, Users, Plans, etc.) scoped to that org. Currently all tabs are global. `[BF: 301911f7]`
- [ ] **Coach Admin prompt UI overhaul** — system prompt needs visual sections with "managed by RI" badges for locked layers, editable coach context shown distinctly. Not just a textarea. `[BF: bccec18b]`
- [ ] **Catalyst fix — ownership changes** — recent ownership/PE changes are a catalyst, not a compelling event. Add this explicitly to the locked catalyst definition in system_ai_rules and in the extraction prompt. `[BF: b09df111]`

### High (from beta feedback)
- [ ] **Global UI/UX density pass** — too much whitespace throughout the entire platform, not responsive enough. Needs a systematic pass across Pipeline, DealDetail, Settings, and Admin. `[BF: 648514a1]`
- [ ] **Bulk task operations** — bulk select, complete, delete tasks from DealDetail tasks tab and Pipeline task widget. `[BF: e08dfbef]`
- [ ] **Scoreboard benchmarks** — vs org average + avg call scores. Only show if org has 2+ reps. `[BF: 66b345b0]`
- [ ] **Widget builder: Squarespace-level drag-and-drop** — full field picker from DB schema, drag columns to add, reorder by dragging, live preview large and central. `[BF: 5e82e06c, af192bb4, 3d2d7749]`
- [ ] **Pipeline Salesforce-style dashboards** — create reports from DB fields, add to dashboards, clone widgets, create widgets directly on dashboard. `[BF: b3b93e03, a63eed1d]`
- [ ] **Coach Admin template fields** — separate fields for tone, format, rules, instructions, custom context. No sort order. `[BF: 899d6564]`

### Medium (from beta feedback)
- [ ] **Widget filters from DB fields** — filter widgets by any DB field, support averages/sums/counts as calculated fields. `[BF: 49bc45fe]`
- [ ] **Widget cross-reference + formulas** — cross-reference tables in reporting, Salesforce-style AND/OR logic, formulas. `[BF: 5cd000dc]`
- [ ] **Chorus share link → transcript** — paste a Chorus shareable URL and import the transcript automatically. `[BF: 071402cc]`
- [ ] **Quote sizing auto-populate** — include warehouse/inventory user types in quote builder, auto-populate from transcript data. `[BF: 849ca5f8]`
- [ ] **Custom fields platform-wide** — create custom fields in coach admin that get extracted by AI and appear throughout platform. Big lift. `[BF: 819d85f4]`

---

## 🟡 UPCOMING — Scoped but not yet queued

### Beta readiness (needed before inviting external beta users)
- [ ] **Empty states** — every page needs a proper empty state: Pipeline with no deals, Transcripts tab with no uploads, Contacts tab, Tasks tab, etc. Not a blank page.
- [ ] **Loading skeletons** — slow-loading widgets (company research, deal analysis, scores) should show skeletons not blank space
- [ ] **Error boundaries** — every page needs an error boundary so one broken component doesn't crash the whole app
- [ ] **First-deal guided walkthrough** — new user with no deals should see a step-by-step prompt: "Create your first deal → Add company website → Let us research → Upload a transcript"
- [ ] **Beta welcome email sequence** — Day 0 (welcome), Day 1 (tips), Day 3 (check-in), Day 7 (feature highlight), Day 14 (feedback ask). Built in Resend, triggered on first login.
- [ ] **Mobile responsive audit** — platform should be usable on tablet/mobile for field reps

### Learning loop (tables exist, UI not wired)
- [ ] **End-of-session chatbot satisfaction** — when chatbot closes after 3+ messages, show 1-5 star prompt → chatbot_session_feedback
- [ ] **AI suggestion tracking on contacts** — accept/edit/delete of AI-extracted contacts → ai_suggestion_tracking

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

*Last updated: April 23, 2026*
*Next update: after next sprint completes*
