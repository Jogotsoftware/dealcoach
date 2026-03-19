# DealCoach

AI-powered sales coaching and deal intelligence platform for enterprise B2B sales teams.

## Tech Stack

- **Frontend**: React 18 + Vite
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Edge Functions)
- **AI Processing**: Make.com webhooks (per call type) calling Claude API (claude-sonnet-4-20250514)
- **Hosting**: Netlify

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/dealcoach.git
cd dealcoach
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```bash
cp .env.example .env
```

The `.env` file needs:
- `VITE_SUPABASE_URL` — Your Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — Your Supabase anon/public key

### 3. Run locally

```bash
npm run dev
```

Opens at `http://localhost:3000`

### 4. Deploy to Netlify

1. Push to GitHub
2. Connect repo in Netlify
3. Set environment variables in Netlify dashboard:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Build command: `npm run build`
5. Publish directory: `dist`

The `netlify.toml` file handles SPA routing automatically.

### 5. Set up Make.com Webhooks (for AI processing)

See `docs/MAKE_COM_SETUP.md` for the full guide. Quick version:

1. Create a Make.com scenario with a Custom Webhook trigger
2. Copy the webhook URL
3. Add it to your `.env` file as `VITE_WEBHOOK_QDC` (or whichever call type)
4. Add an HTTP module that calls the Claude API with the payload
5. Add HTTP modules that write results back to Supabase

Start with just the QDC webhook — duplicate for other call types later.
The processing logic is identical; the call-type prompt comes from the payload.

## Supabase Project

- **Project ID**: npfnsyufqqhhjmtvmold
- **Region**: us-east-1
- **Tables**: 45
- **Migrations**: 10

## Pages

| Route | Page | Description |
|-------|------|-------------|
| `/login` | Login | Sign in / sign up |
| `/` | Pipeline | Kanban board, 3-month pipeline, FY attainment |
| `/deal/new` | New Deal | Create deal form |
| `/deal/:id` | Deal Detail | 6 tabs: Overview, Contacts, Transcripts, MSP, Proposal, Tasks |
| `/deal/:id/msp` | MSP Builder | Full MSP with stages, milestones, resources, sharing |
| `/deal/:id/quote/new` | Quote Editor | CPQ: products, line items, discounts, terms |
| `/deal/:id/quote/:qid` | Quote Editor | Edit existing quote |
| `/deal/:id/proposal` | Proposal Builder | Build proposals from insights, preview |
| `/msp/shared/:token` | Client Portal | Public client-facing MSP view |
| `/coach` | Coach Admin | Coach config, prompts, documents, scoring |
| `/settings` | Settings | Profile, quota, preferences |

## Database Schema (45 tables)

### Core
deals, profiles, contacts, company_profile, company_systems, deal_analysis, deal_competitors, compelling_events, business_catalysts, deal_documents, deal_scores, scoring_configs, conversations, call_type_prompts, coaches, coach_documents, analysis_field_configs

### Tasks
tasks, categories, tags, task_tags

### MSP Module
msp_stages, msp_milestones, msp_resources, msp_shared_links, msp_custom_steps, msp_predefined_steps, msp_customer_portals

### CPQ / Proposals
products, quotes, quote_line_items, payment_schedules, quote_tco_breakdown, quote_favorites, quote_favorite_items, proposal_documents, proposal_insights, proposal_shares, proposal_settings, project_dates

### Team & Quota
user_team_members, deal_team_contacts, rep_quotas

### AI & History
ai_response_log, next_steps_history

## Sales Methodology

Built around the Sage Intacct sales process:
- BANT qualification (Budget, Authority, Need, Timeline)
- Selling Through Curiosity
- Structured deal execution
- Fiscal year starts October (FY2026 = Oct 2025 - Sep 2026)
