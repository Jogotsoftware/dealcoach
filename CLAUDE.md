# CLAUDE.md — Revenue Instruments / DealCoach

*Last updated: April 2026. Replace the existing CLAUDE.md at the repo root with this file.*

---

## What This Is

Revenue Instruments is a multi-product AI-powered revenue platform for enterprise B2B sales teams. The current shipped product is **DealCoach** — AI sales coaching, transcript intelligence, deal management, scoring, and pipeline analytics.

**Tech stack:**
- Frontend: React 18 + Vite, deployed to Netlify (`aidealcoach.netlify.app`)
- Backend: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- AI: Supabase Edge Functions → Claude API (claude-sonnet-4-20250514 for all AI)
- Embeddings: OpenAI text-embedding-3-small (1536 dims, via `embed-chunks` edge function)
- Repo: `jpachecosage/dealcoach`
- **No TypeScript** — plain JSX only
- **No CSS framework** — inline styles using design tokens from `src/lib/theme.js`
- **No Make.com** — fully deprecated, all AI through Supabase Edge Functions

---

## Supabase Project

- **Project ID:** `npfnsyufqqhhjmtvmold`
- **URL:** `https://npfnsyufqqhhjmtvmold.supabase.co`
- **Region:** us-east-1
- **122+ tables**, all org-scoped RLS
- **Security advisors:** 2 acceptable WARNs (known, intentional)

---

## Design System

- **Theme:** Carolina Blue (`#5DADE2`) primary — light theme
- **Background:** `#f5f7fa`, surfaces `#ffffff`
- **All tokens** in `src/lib/theme.js` — always import from here, never hardcode colors
- **Shared components** in `src/components/Shared.jsx` — Card, Badge, Button, ScoreBar, Field, TabBar, Spinner, etc.
- **Font:** Plus Jakarta Sans (Google Fonts) with system fallbacks
- **No emojis in the UI** — ever
- Inline styles only — no Tailwind, no CSS modules

---

## Routes (src/App.jsx)

### Public
| Route | Component |
|-------|-----------|
| `/login` | `Login.jsx` |
| `/invite/:token` | `AcceptInvite.jsx` |
| `/msp/shared/:token` | `MSPClientPortal.jsx` |
| `/onboarding` | `Onboarding.jsx` (authenticated, no org required) |

### Protected (require org — inside Layout with sidebar)
| Route | Component | Notes |
|-------|-----------|-------|
| `/` | `Pipeline.jsx` | Kanban + table view, forecast summary, quota tracker, widgets |
| `/deal/new` | `NewDeal.jsx` | |
| `/deal/:id` | `DealDetail.jsx` | 6 tabs: Overview, Contacts, Transcripts, MSP, Proposal, Tasks |
| `/deal/:dealId/call/:conversationId` | `CallDetail.jsx` | Transcript + AI analysis + coaching scores |
| `/deal/:dealId/msp` | `MSPPage.jsx` | Full MSP builder |
| `/deal/:dealId/quote/new` | `QuoteEditor.jsx` | |
| `/deal/:dealId/quote/:quoteId` | `QuoteEditor.jsx` | |
| `/deal/:dealId/proposal` | `ProposalBuilder.jsx` | |
| `/deal/:id/retrospective` | `DealRetrospective.jsx` | AI retrospective on closed deals |
| `/coach` | `CoachAdmin.jsx` | Prompts, docs, scoring configs, MSP templates, email templates |
| `/coach/builder` | `CoachBuilder.jsx` | 8-step coach configuration wizard |
| `/reports` | `Reports.jsx` | Prebuilt + custom reports from saved_reports |
| `/settings` | `Settings.jsx` | Profile, quota, coach selection, preferences |

### Admin-only (require admin role)
| Route | Component |
|-------|-----------|
| `/settings/team` | `TeamManagement.jsx` |
| `/settings/organization` | `OrgSettings.jsx` |
| `/admin/widgets` | `WidgetBuilder.jsx` |
| `/admin/feedback` | `BetaFeedback.jsx` |
| `/admin/invitations` | `Invitations.jsx` |

### Platform admin only (require platform_admins table membership)
| Route | Component |
|-------|-----------|
| `/admin` | `AdminConsole.jsx` — 7 tabs: Organizations, Users, Plans, Billing (beta), Credit Costs, Modules, Usage |
| `/admin/orgs/:orgId` | `OrgDetail.jsx` |
| `/admin/extraction-definitions` | `ExtractionDefinitions.jsx` |

---

## Edge Functions (15 deployed, all ACTIVE)

All functions use `verify_jwt: false` and implement auth internally. Embed version identifiers in all error messages (e.g. `"v29: conversation_id missing"`).

| Function | Version | Purpose |
|----------|---------|---------|
| `process-transcript` | v29 | Transcript AI analysis — loads 13 tables of deal context, calls Claude, writes tasks/contacts/catalysts/events/pains/flags/scores. Uses `assemble_coach_prompt` RPC. |
| `research-company` | v33 | Perplexity + Apollo + NinjaPear logo in parallel. Populates company_profile. |
| `generate-email` | v11 | Template-based email generation with credit metering. |
| `deal-chat` | v11 | AI coaching chat. Queries 17 tables. Accepts `context_type`: deal/pipeline/coaching/general/help. |
| `onboard-organization` | v8 | 19-step org bootstrap: Perplexity research → Claude coach generation → full scaffolding. |
| `embed-chunks` | v8 | Generates OpenAI text-embedding-3-small vectors for deal_context_chunks. **Requires OPENAI_API_KEY secret.** |
| `build-deal-context` | v3 | Assembles full structured deal context for RAG queries. |
| `manage-ai-memory` | v3 | Writes corrections and observations to ai_memory. |
| `generate-deal-retrospective` | v3 | Auto-fires on deal close. Evaluates AI prediction accuracy + rep execution. Writes to deal_retrospectives. |
| `send-invitation` | v10 | Sends Resend emails for invitations (new_instance + teammate types). |
| `create-invited-user` | v3 | Creates Supabase auth user on invite acceptance. |
| `consolidate-deal-data` | v9 | Deduplicates and consolidates extracted data across transcripts. |
| `update-coaching-summary` | v9 | Aggregates coaching patterns to rep_coaching_summary. |
| `generate-slides` | v8 | PPTX generation via pptxgenjs. |
| `consolidate-deal` | v9 | Alias/variant of consolidate-deal-data. |

**Pending (not yet deployed):**
- `ingest-deal-knowledge` — chunks transcripts + research for RAG ingestion
- `process-retrospective-queue` — polls retrospective_queue every 5 min

---

## Key Architecture Patterns

### Assembled Prompt System
All AI edge functions MUST use `assemble_coach_prompt` RPC instead of reading `coaches.system_prompt` directly:
```ts
const { data: assembledPrompt } = await admin.rpc('assemble_coach_prompt', {
  p_coach_id: coach.id,
  p_call_type: conversation.call_type, // or null
  p_action: 'process_transcript' // or 'chat', 'generate_email', 'research'
})
```
The RPC assembles 4 layers: Platform Core (locked) → Methodology baseline (locked) → Coach context (org-editable) → ICP context (org-editable).

After every AI call, insert to `assembled_prompt_versions` for audit.

### Credit System
Every edge function checks credits before calling Claude:
```ts
const { data: credits } = await admin.rpc('check_credits', { p_org_id: orgId, p_required: cost })
if (!credits?.allowed) return jsonError(402, 'Insufficient credits')
```
Credit costs are in `credit_costs` table. Action types: `research`, `transcript_analysis`, `email`, `chat`, `slides`.

### safeInsert Pattern
`.catch()` is NOT supported on Supabase query builders. Always use try/catch:
```ts
async function safeInsert(table, data) {
  try {
    const { data: result, error } = await admin.from(table).insert(data).select().single()
    if (error) console.error(`safeInsert ${table}:`, error.message)
    return result
  } catch (e) {
    console.error(`safeInsert ${table} threw:`, e.message)
    return null
  }
}
```

### Extraction Definitions
14 locked platform-core extraction definitions are in `system_ai_rules` (layer = 'platform_core', rule_type = 'extraction_definition'). These are injected by `assemble_coach_prompt` and define canonical behavior for: catalyst, compelling_event, pain_point, decision_criteria, competitor, risk, flag, champion, economic_buyer, signer, company_system, task, ai_memory, outcome_analysis.

**Critical distinction — always enforce in prompts:**
- **Business Catalysts** = high-level forces driving change in the buyer's environment (funding round, new exec hire, M&A, regulatory change, system EOL, strategic initiative). NOT operational pain.
- **Compelling Events** = the specific bad thing that happens if they don't act. Must be specific, dated, material.
- **Pain Points** = operational/functional problems the buyer experiences day-to-day.

### Source Linkage
Every AI-extracted catalyst, compelling event, and pain point must include:
- `transcript_excerpt` — verbatim supporting text
- `speaker` — who said it
- `timestamp_in_call` — if available
- `quote` — key quote snippet
- `source` = `'ai_transcript'`
- `source_conversation_id` — the conversation.id

Also write parallel rows to `deal_sources` for the universal evidence layer.

---

## Database Schema (122+ tables)

### Core
`profiles`, `organizations`, `deals`, `contacts`, `company_profile`, `company_systems`, `deal_analysis`, `deal_competitors`, `compelling_events`, `business_catalysts`, `deal_documents`, `deal_scores`, `scoring_configs`, `deal_flags`, `deal_risks`, `deal_pain_points`, `deal_decision_criteria`, `deal_sizing`, `deal_sources`

### Conversations & AI
`conversations`, `call_type_prompts`, `call_analyses`, `ai_response_log`, `assembled_prompt_versions`, `deal_chat_sessions`, `deal_chat_messages`, `generated_emails`, `generated_slides`, `transcript_sources`

### Coaching
`coaches`, `coach_documents`, `coach_icp`, `coach_pe_portfolio`, `coach_reference_lists`, `coach_research_config`, `coach_slide_config`, `analysis_field_configs`, `system_ai_rules`, `system_ai_rules_audit`, `email_templates`

### Tasks
`tasks`, `categories`, `tags`, `task_tags`

### MSP / DealRoom
`msp_stages`, `msp_milestones`, `msp_resources`, `msp_shared_links`, `msp_custom_steps`, `msp_predefined_steps`, `msp_customer_portals`, `msp_templates`, `msp_template_stages`, `msp_template_milestones`

### CPQ / QuoteBuilder
`products`, `pricebook_entries`, `quotes`, `quote_line_items`, `payment_schedules`, `quote_tco_breakdown`, `quote_favorites`, `quote_favorite_items`, `proposal_documents`, `proposal_insights`, `proposal_shares`, `proposal_settings`, `project_dates`

### Team & Quota
`user_team_members`, `deal_team_contacts`, `rep_quotas`, `rep_quota_months`, `rep_scoring_configs`, `rep_coaching_summary`, `rep_historical_performance`

### AI / RAG / Memory
`deal_context_chunks` (vector(1536) + HNSW index), `ai_memory`, `context_assembly_log`, `org_ai_patterns`, `ai_corrections`, `prompt_learnings`

### Learning Loop
`ai_output_feedback`, `ai_suggestion_tracking`, `deal_outcome_factors`, `chatbot_session_feedback`, `org_learning_settings`, `platform_patterns`, `deal_retrospectives`, `retrospective_queue`, `deal_outcome_analysis`

### Forecasting Infrastructure
`deal_history_snapshots`, `deal_engagement_snapshots`, `deal_forecast_predictions`, `org_forecast_accuracy`

### Widgets & Reports
`custom_widget_definitions`, `org_widget_layouts`, `user_widget_overrides`, `widget_registry`, `saved_reports`, `dashboard_snapshots`

### Multi-tenant / Auth
`platform_admins`, `invitations`, `email_log`, `modules`, `user_module_access`, `org_credits`, `credit_costs`, `credit_ledger`, `plans`

### Admin / Audit
`audit_log`, `edge_function_idempotency`, `sync_log`, `integration_field_mappings`, `integrations`, `ai_providers`, `beta_feedback`

### History
`next_steps_history`

### Backup (do not touch)
`coaches_backup_pre_ip_cleanup`, `call_type_prompts_backup_pre_ip_cleanup`, `coach_documents_backup_pre_ip_cleanup`, `organizations_backup_pre_ip_cleanup`

---

## Key RPCs

| RPC | Purpose |
|-----|---------|
| `assemble_coach_prompt(p_coach_id, p_call_type, p_action)` | Assembles 4-layer prompt including platform core, methodology, coach context, ICP |
| `check_credits(p_org_id, p_required)` | Returns `{ allowed: bool, reason? }` |
| `clone_coach_for_org(template_id, target_org_id, ...)` | Clones template coach + 7 prompts + scoring configs into new org |
| `find_similar_deals(p_embedding, p_org_id, p_limit)` | Vector similarity search |
| `search_deal_chunks(p_query_embedding, p_deal_id, p_limit)` | RAG chunk retrieval |
| `search_deal_memories(p_query_embedding, p_deal_id, p_limit)` | AI memory retrieval |
| `get_deal_context_structured(p_deal_id)` | Full structured deal context for AI |
| `capture_deal_snapshot(p_deal_id)` | Manually captures deal_history_snapshot |
| `resolve_org_modules(p_org_id)` | Resolves effective module access (plan + overrides) |
| `delete_invitation(p_invitation_id)` | Hard-deletes an invitation |
| `invite_new_org_with_admin(...)` | Creates invitation with new_instance type |
| `compute_icp_score(p_deal_id, p_coach_id)` | Scores deal against coach ICP config |

---

## pg_cron Jobs (5 scheduled)

| Job | Schedule | What it does |
|-----|----------|-------------|
| `nightly-deal-snapshots` | 3:00 AM daily | `capture_nightly_snapshots()` |
| `nightly-rep-rollups` | 3:30 AM daily | `refresh_all_rep_rollups()` |
| `cleanup-old-dashboard-snapshots` | Sunday 2:00 AM | Deletes dashboard_snapshots > 90 days |
| `cleanup-idempotency` | 4:00 AM daily | Deletes expired edge_function_idempotency rows |
| `process-retrospective-queue` | Every 5 min | Polls retrospective_queue — **pending deployment** |

---

## Auto-Triggers (PostgreSQL)

| Trigger | Table | Action |
|---------|-------|--------|
| `deals_create_related` | deals AFTER INSERT | Creates company_profile + deal_analysis (all "Unknown") |
| `deals_snapshot_next_steps` | deals AFTER UPDATE | Snapshots next_steps to next_steps_history when changed |
| `trg_deal_retro_on_close` | deals AFTER UPDATE | Enqueues to retrospective_queue when stage → closed_won/lost/disqualified |
| `trg_capture_snapshot_on_transcript` | conversations AFTER INSERT | Captures deal_history_snapshot |
| `trg_capture_snapshot_on_score` | deal_scores AFTER INSERT/UPDATE | Captures deal_history_snapshot |
| `trg_clone_coach_on_org_insert` | organizations AFTER INSERT | Clones template coach into new org |
| `trg_enforce_pain_quant_source` | deal_pain_points | Enforces source linkage |
| `tasks_completed_at` | tasks BEFORE UPDATE | Auto-sets/clears completed_at |
| `deal_team_contacts_usage_increment` | deal_team_contacts AFTER INSERT | Increments usage_count |
| `update_updated_at` | all major tables BEFORE UPDATE | Auto-updates updated_at |

---

## Roles & Auth

- `profiles.role`: `system_admin`, `admin`, `manager`, `rep`
- `platform_admins` table: separate from profiles.role — checked for /admin access
- Coach Admin (`/coach`) requires admin role
- Platform admin routes require `platform_admins` table membership
- `RequireOrg` guard: redirects to `/onboarding` if profile has no org_id
- `RequireAdmin` guard: 403 if role not admin/system_admin
- `PlatformAdminGuard`: checks platform_admins table

---

## Plans

| Name | Slug | Credits/mo | Max Users | Notes |
|------|------|-----------|-----------|-------|
| Free | free | 25 | 2 | |
| Starter | starter | 100 | 3 | |
| Pro | pro | 500 | 10 | |
| Enterprise | enterprise | 2000 | 50 | |
| Internal | internal | 99,999 | 100 | Internal use |
| Beta | beta | 99,999 | 100 | Beta program users, is_public=false |

---

## AI Processing Flow

1. Rep creates deal → `deals_create_related` trigger creates company_profile + deal_analysis (all "Unknown")
2. `research-company` auto-fires → Perplexity + Apollo → populates company_profile
3. Rep uploads transcript → saved to `conversations` (processed=false)
4. Frontend calls `process-transcript` edge function
5. Edge function: loads deal context (13 tables) → calls `assemble_coach_prompt` → calls Claude → parses JSON response → writes tasks, contacts, catalysts, events, pains, flags, scores → sets processed=true
6. `ingest-deal-knowledge` called → chunks transcript → `embed-chunks` generates vectors → stored in deal_context_chunks
7. `manage-ai-memory` writes key observations to ai_memory
8. On stage → closed_*: `trg_deal_retro_on_close` queues retrospective → `process-retrospective-queue` polls → `generate-deal-retrospective` runs → writes to deal_retrospectives

---

## Learning Loop

**Tri-layer architecture:**
- **Per-deal** (always on): `ai_memory` + `deal_context_chunks` (pgvector RAG)
- **Per-org** (always on): `org_ai_patterns` — aggregated from feedback + outcomes
- **Platform** (opt-in only): `platform_patterns` — structural signals, never customer content

**Feedback surfaces:**
- Chatbot thumbs → `ai_output_feedback`
- Task accept/edit/delete → `ai_suggestion_tracking`
- Deal close form → `deal_outcome_factors`
- Session satisfaction → `chatbot_session_feedback`

---

## Methodology (public sources only)

Revenue Instruments is built on publicly-sourced frameworks only. Never reference proprietary employer frameworks.

- **BANT** — IBM
- **MEDDPICC** — Dunkel & Napoli
- **Challenger Sale** — Dixon & Adamson
- **SPIN Selling** — Rackham
- **Solution Selling** — Bosworth
- **Sandler** — Sandler Training
- **JOLT Effect** — Dixon & McKenna
- **Command of the Message** — Force Management

**Compelling Event** = the bad thing that happens if the prospect doesn't change (consequence of inaction).
**Catalyst** = forces currently happening that drive the need for change (triggers, pressures).

---

## Development Rules

1. Always check current schema before migrations — run `list_tables` or check existing code
2. `apply_migration` for DDL, `execute_sql` for read queries
3. All new tables require RLS — no exceptions
4. `.catch()` is NOT supported on Supabase query builders — use `try/catch` with safeInsert helpers
5. All AI edge functions must use `assemble_coach_prompt` RPC, not `coaches.system_prompt` directly
6. Embed version identifiers in edge function error messages (`"v29: conversation_id missing"`)
7. Stage and call type are SEPARATE concepts — never conflate them
8. Default fiscal year is January (configurable per org via `organizations.fiscal_year_start_month`)
9. All discovery-dependent fields default to "Unknown"
10. No emojis in the UI
11. Use only public-source methodology language
12. Multi-tenant: every query scoped to org_id via RLS — never trust client-supplied org_id
13. Coaches with `org_id = NULL` and `is_template = true` are platform templates — cloned on new org creation
14. `platform_admins` table controls super-admin access, separate from `profiles.role`

---

## Environment Variables

### Frontend (Vite — in `.env`)
```
VITE_SUPABASE_URL=https://npfnsyufqqhhjmtvmold.supabase.co
VITE_SUPABASE_ANON_KEY=...
VITE_POSTHOG_KEY=           # optional, no-op if unset
VITE_SENTRY_DSN=            # optional, no-op if unset
```

### Edge Functions (set in Supabase dashboard → Settings → Edge Functions)
```
ANTHROPIC_API_KEY           # Claude API — all AI generation
OPENAI_API_KEY              # text-embedding-3-small — required for embed-chunks
PERPLEXITY_API_KEY          # company research
APOLLO_API_KEY              # contact enrichment
NINJAPEAR_API_KEY           # company logo fetch
RESEND_API_KEY              # transactional email
INVITATION_FROM_EMAIL       # e.g. "Revenue Instruments <invites@revenueinstruments.com>"
APP_BASE_URL                # https://aidealcoach.netlify.app
SUPABASE_URL                # auto-set
SUPABASE_SERVICE_ROLE_KEY   # auto-set
SUPABASE_ANON_KEY           # auto-set
```

---

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/theme.js` | Design tokens — ALL colors, spacing, fonts. Import from here, never hardcode. |
| `src/components/Shared.jsx` | Shared component library — Card, Badge, Button, Spinner, TabBar, ScoreBar, Field, etc. |
| `src/lib/webhooks.js` | All edge function callers — `callProcessTranscript`, `callResearchFunction`, `callDealChat`, `callGenerateEmail`, `callSendInvitation`, `reprocessDeal`, etc. |
| `src/lib/supabase.js` | Supabase client singleton |
| `src/contexts/OrgContext.jsx` | OrgContext provider — `useOrg()` gives org, user, credits, plan, isAdmin, isSystemAdmin, hasModule |
| `src/hooks/useAuth.js` | Auth hook — `useAuth()` gives profile, signOut |
| `src/hooks/useModules.js` | Module gating hook — `useModules()` gives `hasModule(slug)` |
| `src/components/Layout.jsx` | Main layout shell with sidebar, module-aware nav, platform admin section |
| `src/components/SourceLink.jsx` | Transcript source citation pill — links to CallDetail with excerpt anchor |
| `src/components/BetaFeedbackButton.jsx` | Floating beta feedback trigger (to be replaced by GlobalChatbot) |
| `src/components/guards/RequireOrg.jsx` | Route guard — redirects to /onboarding if no org |
| `src/components/guards/RequireAdmin.jsx` | Route guard — 403 if not admin role |
| `src/components/guards/PlatformAdminGuard.jsx` | Route guard — checks platform_admins table |

---

## Auxiliary Products

- `desktop/` — Electron desktop widget (Tasks, Chat, Deals, Emails). Standalone HTML/JS, dark theme.
- `chatbot/` — Standalone Electron chatbot app.
- `chrome-extension/` — Chrome extension for SFDC/LinkedIn field extraction.

