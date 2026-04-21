# CLAUDE.md — DealCoach Project Context

## What This Is
DealCoach is an AI-powered sales coaching and deal intelligence platform for enterprise B2B sales teams. React + Vite frontend, Supabase backend (45+ tables), Edge Functions for AI processing via Claude API.

## Tech Stack
- Frontend: React 18 + Vite + React Router
- Backend: Supabase (PostgreSQL + Auth + RLS)
- AI Processing: Make.com webhooks → Claude API (claude-sonnet-4-20250514)
- Hosting: Netlify
- No TypeScript (plain JSX)
- No CSS framework — inline styles using theme tokens from `src/lib/theme.js`

## Supabase Project
- Project ID: npfnsyufqqhhjmtvmold
- URL: https://npfnsyufqqhhjmtvmold.supabase.co
- Region: us-east-1
- 45 tables, 10 migrations, 25 triggers
- RLS enabled on all tables

## Design System
- Carolina Blue (#5DADE2) primary — from cpqmsp2.0 project
- Light theme: white surfaces (#fff) on #f5f7fa background
- All tokens in `src/lib/theme.js`
- Shared components in `src/components/Shared.jsx` (Card, Badge, Button, ScoreBar, Field, TabBar, etc.)
- No emojis in the UI
- Font: Plus Jakarta Sans (Google Fonts) with system fallbacks

## Architecture

### Pages & Routes (src/App.jsx)
| Route | Component | Purpose |
|-------|-----------|---------|
| /login | Login.jsx | Supabase Auth sign in/up |
| / | Pipeline.jsx | Kanban board, 3-month pipeline, FY attainment |
| /deal/new | NewDeal.jsx | Create deal form |
| /deal/:id | DealDetail.jsx | 6 tabs: Overview, Contacts, Transcripts, MSP, Proposal, Tasks |
| /deal/:dealId/msp | MSPPage.jsx | Full MSP builder |
| /deal/:dealId/quote/new | QuoteEditor.jsx | CPQ quote builder |
| /deal/:dealId/quote/:quoteId | QuoteEditor.jsx | Edit existing quote |
| /deal/:dealId/proposal | ProposalBuilder.jsx | Proposal builder with insights |
| /deal/:dealId/call/:conversationId | CallDetail.jsx | Call transcript + AI analysis + coaching |
| /msp/shared/:token | MSPClientPortal.jsx | Public client-facing MSP |
| /coach | CoachAdmin.jsx | Coach config, prompts, docs, scoring, MSP templates |
| /settings | Settings.jsx | Profile, quota, coach selection, my team, preferences |

### AI Processing Flow (Edge Functions)
All AI processing uses Supabase Edge Functions (no more Make.com). Each function handles auth, credit checks, and calls Claude API.

When a transcript is uploaded:
1. Frontend saves to `conversations` table
2. Frontend calls `process-transcript` edge function
3. Edge function loads full deal context, calls Claude API, writes results back
4. Frontend refreshes to show results

Edge function callers in `src/lib/webhooks.js`:
- `callProcessTranscript` — transcript analysis + coaching
- `callResearchFunction` — company research via Perplexity + Claude
- `callDealChat` — AI coaching chat
- `callGenerateEmail` — AI email generation
- `callGenerateSlides` — presentation slide generation
- `reprocessDeal` — full re-research + re-process all transcripts

### Database Schema (45 tables)

**Core**: deals, profiles, contacts, company_profile, company_systems, deal_analysis, deal_competitors, compelling_events, business_catalysts, deal_documents, deal_scores, scoring_configs, conversations, call_type_prompts, coaches, coach_documents, analysis_field_configs

**Tasks**: tasks, categories, tags, task_tags

**MSP**: msp_stages, msp_milestones, msp_resources, msp_shared_links, msp_custom_steps, msp_predefined_steps, msp_customer_portals, msp_templates, msp_template_stages, msp_template_milestones

**CPQ/Proposals**: products, quotes, quote_line_items, payment_schedules, quote_tco_breakdown, quote_favorites, quote_favorite_items, proposal_documents, proposal_insights, proposal_shares, proposal_settings, project_dates

**Team/Quota**: user_team_members, deal_team_contacts, rep_quotas

**AI/History**: ai_response_log, next_steps_history, call_analyses, deal_risks, deal_pain_points, rep_quota_months, rep_scoring_configs

**Modules/Access**: modules, user_module_access

### Roles & Permissions
- `profiles.role`: system_admin, admin, manager, rep
- Coach Admin (/coach) is admin-only
- All reps can select any active coach from Settings

### Key Features
- **Call History**: DealDetail Overview shows call progression with AI scores, links to CallDetail page
- **Editable Fields**: All deal_analysis, deals, company_profile, contacts, and competitors are inline-editable
- **MSP Templates**: Admins create templates in Coach Admin; reps apply templates to auto-populate MSP stages/milestones
- **My Team Contacts**: Settings page allows reps to manage their SC/partner team; members can be assigned to deals
- **Coach Selection**: Reps choose their active coach in Settings (profiles.active_coach_id)
- **Closed Revenue Adjustment**: Reps can manually adjust closed_amount per month in quota table

### Key Auto-Triggers
- `deals_create_related`: AFTER INSERT on deals → auto-creates company_profile + deal_analysis (all "Unknown")
- `deals_snapshot_next_steps`: AFTER UPDATE → snapshots next_steps to history
- `tasks_completed_at`: BEFORE UPDATE → auto-sets completed_at timestamp
- `deal_team_contacts_usage_increment`: AFTER INSERT → increments team member usage_count
- `update_updated_at`: BEFORE UPDATE on all major tables

### Sales Methodology
- Revenue Instruments Framework (default) — seven pillars: Curiosity, Independently Wealthy, Continuous Qualification, Empathetic Listening, Outcome-Goal Alignment, Mutual Authoring, Buyer Risk Mitigation
- BANT qualification (Budget, Authority, Need, Timeline) — available as add-on
- Fiscal year is per-org configurable (organizations.fiscal_year_end_month/day)
- Deal stages: qualify, discovery, solution_validation, confirming_value, selection, disqualified, closed_won, closed_lost
- Call types (separate from stages): qdc, functional_discovery, demo, scoping, proposal, negotiation, sync, custom

## Commands
```bash
npm run dev     # Start dev server on port 3000
npm run build   # Production build to dist/
npm run preview # Preview production build
```

## Key Files to Understand
- `src/lib/theme.js` — All design tokens, constants, helpers
- `src/lib/supabase.js` — Supabase client singleton
- `src/lib/webhooks.js` — Full-context payload builder + Make.com webhook caller
- `src/hooks/useAuth.jsx` — Auth context with auto profile creation
- `src/components/Shared.jsx` — All shared UI components
- `src/components/Layout.jsx` — Sidebar navigation shell
