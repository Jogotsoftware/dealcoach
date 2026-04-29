# Partner Network — Scope Doc

*Working doc for DealCoach Partner Network. Captures scope, schema, routes, phasing, and open decisions. Update as decisions are made. No code should be written against this doc until Phase 1 schema is locked.*

---

## 1. Positioning

Partner Network is a **second product surface** inside DealCoach that turns partner companies (system integrators, payment providers, consultants, etc.) into first-class participants in the sales cycle.

Two product lenses, one schema:

1. **Customer side** (existing DealCoach): AEs invite partners onto their deals, see partner comments, attach partner-provided resources.
2. **Partner side** (new): partner companies sign in, see every deal across every customer that has invited them, distribute deals to their own AEs, track attainment, earn spiffs, route leads to other partners, build their own reports/dashboards.

The partner side is effectively a mini-CRM + PRM + partner marketplace. At maturity it's in the same product category as Crossbeam, PartnerStack, Impartner, Allbound.

---

## 2. Open Decisions

These block implementation. Do not pick a default — confirm with product owner.

| # | Decision | Options | Current lean |
|---|----------|---------|--------------|
| D1 | partner_orgs singleton across customers? | Single global row per partner company (Paystand = one row, many customer links), OR per-customer duplicates | **Singleton** (implied by "pipeline view across all customer orgs") |
| D2 | Billing model | (a) Guests under customer billing · (b) Partners are their own paying tenants · (c) Hybrid (free to list + accept, paid features) | **(c) Hybrid** — forced by ecosystem features (directory, referrals) that don't require a customer invite |
| D3 | Spiff payment model | (1) DealCoach tracks only · (2) DealCoach facilitates payment (Stripe Connect) · (3) Internal kicker only (payroll) | **(1) Tracks only** — option 2 is a separate product |
| D4 | Phase 1 distribution | Manual only · Manual + round-robin · Full auto-rules | **Manual only** for Phase 1 |
| D5 | Partner AI credits | Piggyback on customer org credits · Partner org has its own credit pool | **Own pool** once Partner Network has any AI features of its own |
| D6 | Directory verification | None (trust on signup) · Email-domain only · Mutual attestation · Full KYB | **Email-domain only** until abuse shows up |
| D7 | Cross-partner spiff splits enforcement | Self-reported by partners · Enforced by customer AE approval · Enforced by signed agreements | **Signed agreements** (`partner_referral_agreements`) |

---

## 3. Personas

### Customer-side
- **Customer AE** — existing `profiles` user with `role='rep'/'manager'/'admin'`. Invites partner_orgs onto their deals, sees partner comments/resources, approves spiffs.
- **Customer admin** — existing. Configures spiff rules for their org. Sees which partners are on which deals.

### Partner-side (new)
- **Partner admin** — runs a partner_org. Invites their own AEs. Distributes incoming deal invitations to AEs. Manages distribution rules, team quotas, resource library, partner directory profile. Sees all org activity. Approves/rejects incoming referrals from other partners.
- **Partner manager** — sees team roster + pipeline + attainment. Can reassign deals but not configure rules.
- **Partner AE** — sees only their assigned deals. Comments, attaches resources, marks MSP milestones, suggests next steps, tracks own quota/spiffs, refers leads out.

---

## 4. Entity Model

Organized by the phase that introduces it. Tables marked **(existing)** already live in the schema.

### 4.1 — Phase 1: Identity + basic collaboration

```
partner_orgs
  id                    uuid PK
  name                  text
  slug                  text unique
  logo_url              text
  website               text
  primary_color         text
  status                text  -- active|suspended|pending
  created_at, updated_at

partner_users
  id                    uuid PK  -- distinct from auth.users to keep customer profiles untouched
  auth_user_id          uuid unique  -- supabase auth id
  partner_org_id        uuid FK → partner_orgs
  email                 text
  full_name             text
  role                  text  -- partner_admin|partner_manager|partner_ae
  active                bool
  created_at, updated_at

partner_org_customer_links
  id                    uuid PK
  partner_org_id        uuid FK → partner_orgs
  customer_org_id       uuid FK → organizations
  status                text  -- invited|active|paused|revoked
  invited_by            uuid  -- customer user
  first_connected_at    timestamptz
  created_at
  unique (partner_org_id, customer_org_id)

deal_partners
  id                    uuid PK
  deal_id               uuid FK → deals
  partner_org_id        uuid FK → partner_orgs
  assigned_user_id      uuid nullable FK → partner_users  -- null = awaiting_assignment
  invited_by            uuid FK → profiles  -- customer AE
  assigned_by           uuid nullable FK → partner_users  -- partner admin
  status                text  -- awaiting_assignment|assigned|declined|completed
  invited_at            timestamptz
  assigned_at           timestamptz nullable
  created_at, updated_at

deal_comments
  id                    uuid PK
  deal_id               uuid FK → deals
  author_type           text  -- profile|partner_user
  author_id             uuid  -- either profiles.id or partner_users.id, disambiguated by author_type
  body                  text
  visibility            text  -- internal|partner_visible
  parent_comment_id     uuid nullable (threading)
  created_at, updated_at
```

### 4.2 — Phase 2: Resources, notifications, partner pipeline view

```
partner_resources
  id                    uuid PK
  partner_org_id        uuid FK → partner_orgs
  uploaded_by           uuid FK → partner_users
  name                  text
  description           text
  resource_type         text  -- deck|one_pager|pdf|link|video
  file_url              text nullable
  external_url          text nullable
  is_public             bool  -- visible in directory or only to partners on deals
  active                bool
  created_at, updated_at

deal_partner_resources
  id                    uuid PK
  deal_id               uuid FK → deals
  partner_resource_id   uuid FK → partner_resources
  attached_by           uuid FK → partner_users
  attached_at           timestamptz

partner_notifications
  id                    uuid PK
  partner_user_id       uuid FK → partner_users
  notification_type     text  -- invited|commented|stage_changed|spiff_earned|spiff_paid|resource_presented|task_assigned|deal_reassigned|referral_accepted|referral_declined
  deal_id               uuid nullable
  payload               jsonb
  read_at               timestamptz nullable
  created_at

-- Extend existing msp_milestones (add column; no new table)
ALTER TABLE msp_milestones
  ADD COLUMN partner_can_complete boolean DEFAULT false,
  ADD COLUMN completed_by_partner_user_id uuid nullable;
```

### 4.3 — Phase 3: Tasks, next-step suggestions, attainment, partner reporting

```
-- Extend existing tasks (no new table unless partner_tasks diverges later)
ALTER TABLE tasks
  ADD COLUMN assignee_type text DEFAULT 'profile',  -- profile|partner_user
  ADD COLUMN partner_user_id uuid nullable FK → partner_users;

next_step_suggestions
  id                    uuid PK
  deal_id               uuid FK → deals
  suggested_by          uuid FK → partner_users
  title                 text
  description           text
  status                text  -- pending|approved|declined
  reviewed_by           uuid nullable FK → profiles  -- customer AE
  reviewed_at           timestamptz nullable
  created_at

partner_quotas
  id                    uuid PK
  partner_user_id       uuid FK → partner_users
  customer_org_id       uuid nullable FK → organizations  -- null = aggregate across all customers
  period_start          date
  period_end            date
  target_amount         numeric
  target_metric         text  -- revenue|deals_closed|meetings_held
  created_at, updated_at

-- Extend existing reporting/dashboard infra with partner_org scope:
ALTER TABLE saved_reports            ADD COLUMN partner_org_id uuid nullable;
ALTER TABLE custom_widget_definitions ADD COLUMN partner_org_id uuid nullable;
ALTER TABLE org_widget_layouts        ADD COLUMN partner_org_id uuid nullable;
ALTER TABLE dashboard_folders         ADD COLUMN partner_org_id uuid nullable;
-- When partner_org_id IS SET, row is partner-scoped and RLS gates to that partner_org.
-- widgetSchema.js gains a "Partner" base-entity group: deal_partners, partner_quotas,
-- spiff_instances, partner_users. Customer entities not exposed to partner scope.
```

### 4.4 — Phase 4: Spiffs

```
spiff_rules
  id                    uuid PK
  org_id                uuid FK → organizations  -- customer org defining the rule
  name                  text
  trigger_event         text  -- stage_reached|milestone_completed|deal_closed_won
  trigger_params        jsonb  -- {stage: 'closed_won'} or {milestone_id: '...'}
  amount_type           text  -- flat|percent_of_value|tiered
  amount_params         jsonb  -- {flat: 2000} or {pct: 0.05} or {tiers: [...]}
  partner_role_filter   text nullable  -- limit to partners with this deal_partners.role
  active                bool
  created_at, updated_at

spiff_instances
  id                    uuid PK
  deal_id               uuid FK → deals
  spiff_rule_id         uuid FK → spiff_rules
  partner_user_id       uuid FK → partner_users  -- assigned AE at time of earn
  partner_org_id        uuid FK → partner_orgs
  amount                numeric
  status                text  -- pending|approved|paid|rejected|voided
  splits                jsonb  -- [{partner_user_id, partner_org_id, pct}] — Phase 5 adds cross-partner splits
  approved_by           uuid nullable FK → profiles  -- customer AE/admin
  approved_at           timestamptz nullable
  paid_at               timestamptz nullable
  notes                 text
  created_at, updated_at

spiff_ledger
  id                    uuid PK
  spiff_instance_id     uuid FK → spiff_instances
  event_type            text  -- earned|approved|paid|voided|split_adjusted
  actor_user_id         uuid
  actor_type            text  -- profile|partner_user|system
  payload               jsonb
  created_at
```

### 4.5 — Phase 5: Ecosystem (directory, referrals, cross-partner splits)

```
partner_directory
  id                    uuid PK
  partner_org_id        uuid FK → partner_orgs unique
  headline              text
  description           text
  areas_of_expertise    text[]
  territories           text[]
  industries            text[]
  default_referral_share_pct numeric  -- starting point for agreements
  verified              bool
  listing_status        text  -- draft|pending|public|hidden
  created_at, updated_at

partner_leads
  id                    uuid PK
  partner_org_id        uuid FK → partner_orgs
  owner_partner_user_id uuid FK → partner_users
  company_name          text
  contact_name          text
  contact_email         text
  estimated_value       numeric
  notes                 text
  stage                 text  -- new|qualifying|refer_out|converted|dropped
  created_at, updated_at

partner_referrals
  id                    uuid PK
  source_partner_org_id uuid FK → partner_orgs
  source_partner_user_id uuid FK → partner_users
  target_partner_org_id uuid FK → partner_orgs
  target_partner_user_id uuid nullable FK → partner_users  -- null until target admin distributes
  lead_id               uuid nullable FK → partner_leads
  converted_to_deal_id  uuid nullable FK → deals
  spiff_share_pct       numeric  -- source partner's cut
  status                text  -- pending|accepted|declined|expired|converted
  message               text  -- handoff notes
  created_at, updated_at

partner_referral_agreements
  id                    uuid PK
  partner_org_a         uuid FK → partner_orgs
  partner_org_b         uuid FK → partner_orgs
  default_share_a_to_b_pct numeric  -- when A refers to B
  default_share_b_to_a_pct numeric
  signed_by_a_user_id   uuid FK → partner_users
  signed_by_b_user_id   uuid FK → partner_users
  signed_at             timestamptz
  active                bool
  created_at, updated_at
  unique (least(partner_org_a, partner_org_b), greatest(partner_org_a, partner_org_b))
```

### 4.6 — Phase 6: Trust, credits, verification

```
partner_org_credits
  -- mirror of org_credits but for partners; same credit_costs, same metering
  partner_org_id        uuid PK FK → partner_orgs
  balance               numeric
  monthly_allowance     numeric
  period_start          date
  created_at, updated_at

partner_org_verifications
  id                    uuid PK
  partner_org_id        uuid FK → partner_orgs
  verification_type     text  -- email_domain|mutual_attestation|kyb
  verified_by_user_id   uuid nullable
  evidence              jsonb
  verified_at           timestamptz
  expires_at            timestamptz nullable
```

---

## 5. Auth + RLS Pattern

### 5.1 Auth

- **Supabase auth is shared.** A single `auth.users` row either has a matching `profiles` row (customer-side) or a matching `partner_users` row (partner-side), via a helper table `auth_user_types(auth_user_id, user_type)` indicating which.
- Login flow detects type → routes to `/` (customer) or `/partner` (partner).
- A person can be both a customer-side user AND a partner-side user, but they're distinct records.

### 5.2 Helper functions

All policies use these (add to existing set alongside `user_role()`, `is_system_admin()`):

```sql
-- Returns the partner_user row for the current auth user, or null
create function current_partner_user() returns partner_users ...

-- Returns the partner_org_id for the current auth user, or null
create function current_partner_org() returns uuid ...

-- Returns the partner_user role for the current auth user
create function current_partner_role() returns text ...

-- Returns true if the current customer-side user's org has this partner linked
create function customer_org_has_partner(p_partner_org uuid) returns bool ...
```

### 5.3 RLS summary per table

| Table | Customer-side access | Partner-side access |
|-------|----------------------|---------------------|
| partner_orgs | read if `customer_org_has_partner(id)` or is_system_admin | read own org |
| partner_users | read via `customer_org_has_partner(partner_org_id)` | read own org (all roles); insert/update/delete gated on partner_admin role |
| partner_org_customer_links | manage by customer admin | read only |
| deal_partners | read/write on own org deals | read where `assigned_user_id = current_partner_user()` OR role in (admin,manager) and `partner_org_id = current_partner_org()` |
| deal_comments | standard org RLS + filter `visibility='internal'` out for partners | read where `visibility='partner_visible'` and on a deal the partner is assigned to |
| partner_resources | read public + resources attached to deals they're on | full CRUD within own org |
| deal_partner_resources | read on own org deals | read/write where partner org is on the deal |
| partner_tasks (tasks w/ partner_user_id) | read on own org deals | read where `partner_user_id = current_partner_user()` |
| next_step_suggestions | review/approve by customer AE | create by assigned partner AE |
| partner_quotas | n/a | read own; CRUD by partner_admin |
| spiff_rules | CRUD by customer admin | read the rules attached to their invites |
| spiff_instances | read all for own org deals; approve/pay | read own (as assignee); admin/manager see all in partner_org |
| partner_directory | read public listings | CRUD own listing |
| partner_leads / partner_referrals / partner_referral_agreements | n/a (ecosystem-internal) | scoped to own partner_org |
| saved_reports, custom_widget_definitions, org_widget_layouts, dashboard_folders | existing policies + `partner_org_id IS NULL` | new policy: `partner_org_id = current_partner_org()` |

**Invariant**: no partner_user ever reads any of `conversations`, `call_analyses`, `deal_scores`, `coach_*`, `ai_memory`, `deal_chat_*`, `deal_context_chunks`, `ai_response_log`, `assembled_prompt_versions`. Enforced by not granting any policy that references these tables to the `partner_user` role chain.

---

## 6. Routes / UI Surface

### 6.1 Customer-side additions

| Route | Purpose |
|-------|---------|
| `/deal/:id` (existing) | New "Partners" tab/panel: list of invited partner_orgs, invite button, resources attached, comment thread with partner-visible toggle |
| `/deal/:id/next-steps` | (optional) dedicated screen for reviewing partner-suggested next steps |
| `/settings/partners` | Customer admin: manage `partner_org_customer_links` (which partners are connected, pause/revoke), configure `spiff_rules`, approve pending spiffs |

### 6.2 Partner-side (new surface)

```
/partner/login                                  public
/partner                                        partner home (dashboard)
/partner/inbox                                  notifications
/partner/deals                                  pipeline of deals partner AE is assigned to (filterable)
/partner/deals/:dealId                          single deal view (company, MSP, contacts, comments, resources)
/partner/distribution                           admin-only: queue of unassigned deal_partners + distribution rules config
/partner/team                                   admin/manager-only: roster, quotas, team pipeline, attainment
/partner/resources                              library CRUD
/partner/reports                                reports page (existing UI shape, partner scope)
/partner/dashboards                             dashboards page (existing UI shape, partner scope)
/partner/directory                              browse other partners in the ecosystem (Phase 5)
/partner/directory/profile                      edit own listing (Phase 5)
/partner/leads                                  own leads, refer out (Phase 5)
/partner/referrals                              inbound + outbound referrals (Phase 5)
/partner/spiffs                                 ledger (earned/approved/paid) (Phase 4)
/partner/settings                               profile, notifications, agreements (Phase 5)
/partner/admin                                  partner_admin console: users, roles, billing (Phase 2+)
```

All partner routes wrap in a separate `PartnerLayout` component with its own sidebar — *not* the customer-side `Layout`. A partner who also has a customer account toggles via account menu; the two surfaces do not cross-pollinate.

---

## 7. Phased Roadmap

Each phase is shippable on its own. Stop at any phase if product validation says no.

### Phase 1 — Renee test (target: 1–2 weeks)
**Goal:** end-to-end: customer AE invites Paystand, Paystand's admin distributes to Renee, Renee signs in, sees the deal, comments, AE sees her comment.

Scope:
- Migrations: partner_orgs, partner_users, partner_org_customer_links, deal_partners, deal_comments + RLS helper functions + RLS policies for those 5 tables.
- Auth: partner login route, partner_user invite flow (email via Resend).
- Customer UI: new Partners panel on `/deal/:id` with invite flow + comment thread.
- Partner UI: `/partner/login`, `/partner`, `/partner/deals`, `/partner/deals/:dealId`, `/partner/distribution` (admin-only, minimal: list of unassigned + pick-an-AE dropdown).
- Manual distribution only. No auto-rules.

### Phase 2 — Solo partner product
- partner_resources + deal_partner_resources + upload UI + attach flow.
- msp_milestones.partner_can_complete + partner-side check-off UI.
- partner_notifications + notification bell in both surfaces.
- `/partner/resources` library.
- Partner-side `/partner/deals` gains filtering, stage view.
- Basic attainment (closed_won sum) on `/partner` home.

### Phase 3 — Partner tasks + reporting
- tasks.assignee_type + partner_user_id, partner-side task list.
- next_step_suggestions + AE review flow.
- partner_quotas + quota tracker on `/partner` home.
- Extend saved_reports / custom_widget_definitions / org_widget_layouts / dashboard_folders with partner_org_id.
- widgetSchema "Partner" entity group.
- `/partner/reports` and `/partner/dashboards` reusing existing page components.

### Phase 4 — Spiffs
- spiff_rules + customer admin config UI.
- spiff_instances + trigger logic (DB triggers on deal stage change / milestone complete).
- spiff_ledger for auditing.
- Customer side: `/settings/partners` spiff approval screen.
- Partner side: `/partner/spiffs` ledger screen.
- Status: no cross-partner splits yet. splits jsonb stays empty until Phase 5.

### Phase 5 — Ecosystem
- partner_directory + public listings.
- partner_leads + refer-out flow.
- partner_referrals + inbound queue in partner admin.
- partner_referral_agreements + signature flow.
- spiff_instances.splits now populated via referral chain.
- `/partner/directory`, `/partner/leads`, `/partner/referrals`.

### Phase 6 — Trust + credits
- partner_org_credits + metering for partner-side AI features.
- partner_org_verifications + directory verification badges.
- Rate limits, anti-spam on referrals.

---

## 8. Integration Notes with Existing App

- **Coach / AI layers are invisible to partners.** No policy grants partner_users access to `coaches`, `coach_*`, `system_ai_rules`, or anything under the assembled-prompt system. Partners who eventually get AI features get their own coach concept (out of current scope).
- **Credit metering stays customer-side through Phase 3.** Any AI action in the partner UI during Phases 2–3 (e.g., chatbot) is blocked or uses the customer org's credits with explicit attribution. Partner credits start in Phase 6.
- **Existing extraction / scoring / retrospectives are untouched.** No partner input feeds the learning loop unless explicitly opt-in later.
- **Modules table** (`modules`, `user_module_access`, `resolve_org_modules`): partner product features get their own module slugs (`partner_portal`, `partner_directory`, `partner_spiffs`, etc.). Customer orgs enable per plan. Partner orgs have a parallel module resolution path.
- **Edge functions**: at least two new ones likely needed —
  - `send-partner-invitation` — mirrors `send-invitation` for partner_users.
  - `process-spiff-trigger` — DB trigger enqueues, function computes amount from rule, writes spiff_instance.

---

## 9. Migration Strategy

Phase-by-phase migrations with names matching `<phase>_<feature>`:

- `p1_partner_orgs_and_users`
- `p1_deal_partners`
- `p1_deal_comments`
- `p2_partner_resources`
- `p2_partner_notifications`
- `p2_msp_milestone_partner_completion`
- `p3_partner_tasks`
- `p3_partner_quotas`
- `p3_reporting_partner_scope`
- `p4_spiffs_rules_and_instances`
- `p4_spiff_ledger`
- `p5_partner_directory`
- `p5_partner_leads`
- `p5_partner_referrals`
- `p5_partner_referral_agreements`
- `p6_partner_credits`
- `p6_partner_verifications`

All migrations reversible where possible (drop policies, drop tables in reverse order). No destructive changes to existing tables — only additive columns on `msp_milestones`, `tasks`, `saved_reports`, `custom_widget_definitions`, `org_widget_layouts`, `dashboard_folders`.

---

## 10. Risks / Known Unknowns

- **Auth model complexity.** Partner users and customer users sharing an auth pool but living in separate tables adds invariants the app has to preserve everywhere (middleware, hooks, RLS helpers). A leaked cross-scope query (a customer route accidentally exposing partner data or vice versa) is a security incident. Needs careful audit on route guards.
- **Billing/pricing shape (D2).** Decides whether partner_orgs are peers to organizations or subordinate. Affects whether we need a separate `partner_plans`, `partner_subscriptions`, etc.
- **Spiff legal / tax.** Tracking spiffs in software creates audit exposure even if we don't pay them. Needs legal review before Phase 4 launches.
- **Directory abuse.** Phase 5 opens a semi-public surface. Need abuse controls before launch (D6).
- **Cross-org user (future).** Today `profiles.org_id` is single-valued. A customer admin who's also a partner admin at another company can't do both without two auth accounts. Acceptable for now; solving means the `org_memberships` refactor.

---

## 11. What's NOT in Scope (and why)

- **DealCoach-style AI coaching for partner AEs.** Partners don't get transcript analysis, deal scoring, or coach prompts. That's a separate future product.
- **Customer-visible "Paystand profile" on the deal.** The AE sees invited partner + resources + comments. A rich partner-page-on-the-deal is Phase 5 directory territory.
- **Automated payment rails for spiffs.** D3 option 2. Out of scope unless explicitly pursued as a separate phase.
- **Real-time presence / chat.** Comments are async. Real-time is not on the roadmap.
- **Mobile app for partners.** Web only.
- **Public partner API / webhooks.** Not considered.

---

## Changelog

- 2026-04-24 — Initial scope doc from synthesis of /coach conversation. Captures Phase 1–6. Seven open decisions flagged.
