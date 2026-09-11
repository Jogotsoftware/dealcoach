# Lumen Spec: Unified Local Auto-Ingestion (Intake · Email · Calendar · Granola)

Status: strategy spec for project knowledge. Build prompts get cut from this per sprint.
Depends on: the provenance spine + light/full pass mechanics in `lumen-extraction-architecture.md`,
the import precedent in `lumen-granola-connection.md`, and the BDR/QDC intake flow in
`lumen-bdr-submission-routing-spec.md`.

Leans are flagged **[LEAN]** (override before build). **[DECIDED]** marks Joe's settled calls.
Open questions are collected at the end.

---

## 0. Objective

Auto-ingest Joe's real selling activity from **local** sources into the matching Lumen deals,
feeding the same extraction engine the product already uses — recent only, cost-bounded, with
explicit rules about what is actually extracted. Four flows, one join model:

- **Flow A — New-deal intake** from `SageIntacctAppointments@365sage.net` booking emails.
- **Flow B — Email threads** matched to deals.
- **Flow C — Calendar meetings** (engagement + the join hub).
- **Flow D — Granola transcripts** auto-pulled, auto-matched to a meeting/deal, auto-ingested.

The Microsoft 365 MCP path is dead for this account; the data lives on disk, so Outlook
ingestion runs **locally**. Granola comes over its existing cloud connector.

---

## 1. The Join Model (read this first)

**The booking/meeting is the hub. The booking email seeds the deal *and its domain*.**

```
  SageIntacctAppointments email ──creates──▶ DEAL (+ primary contact + prospect domain)
            │                                     ▲        ▲              ▲
            │ states meeting date/time            │        │              │
            ▼                                      │        │              │
     CALENDAR EVENT  ──matched by attendee domain──┘        │              │
            │                                               │              │
            │ matched by start-time + participant overlap   │              │
            ▼                                               │              │
     GRANOLA MEETING ──transcript──▶ auto-ingest ──▶ deal ──┘              │
                                                                          │
     EMAIL THREADS ──matched by prospect domain───────────────────────────┘
```

Why this matters: today only ~12 contacts org-wide have an email, so domain matching is starved.
**Flow A fixes that at the root** — every new deal is born with the prospect's real address
(verified: booking emails carry it as a recipient, e.g. `jciccarello@rainmakerirrigationllc.com`,
`timr@efwinslow.com`, `alan@elizabethspecans.com`). That domain then makes Flows B/C/D
high-confidence for the life of the deal.

---

## 2. Sources (verified, read-only)

**Outlook-for-Mac profile** at
`~/Library/Group Containers/UBF8T346G9.Office/Outlook/Outlook 15 Profiles/Main Identity/Data`:
- `Outlook.sqlite` — `Mail` (51,946 rows, clean metadata + `PathToDataFile`), `CalendarEvents`
  (14,627 rows: `Calendar_StartDateUTC`/`EndDateUTC`/`UID`/`AttendeeCount`/recurrence — metadata only).
- `Messages/<n>/<UUID>.olk15Message` — embeds full RFC822 MIME (body); always present.
- `Events/<n>/<UUID>.olk15Event` — embeds attendee emails (internal + external prospect), timezone,
  Exchange UID; subject in-file. Parse for attendees → domain match + Granola match.
- Read against a **copy** of `Outlook.sqlite` (+`-wal`,`-shm`) or `mode=ro`; Outlook holds it open.

**Granola** — existing cloud connector (`granola-auth`/`granola-meetings`/`granola-import` edge
functions + `user_granola_connections`). `list_meetings` → `[{id,title,date,participants}]`;
`get_meeting_transcript(id)` → transcript. (Today manual/in-deal; this spec makes it auto.)

---

## 3. Flow A — New-Deal Intake (`SageIntacctAppointments@365sage.net`)

613 all-time, **30 in the last 30 days**. This is the inbound new-business feed. **[DECIDED]
invites from this sender = new deals.**

### 3.0 When to create a deal — precise gate [DECIDED]

**The trigger is a CALENDAR INVITE, not the email.** A new deal is created ONLY when an event meets
**ALL**:
1. **`joe.pacheco@sage.com` is an attendee** on the invite.
2. **The event is categorized `QDC`.** (The QDC is the qualifying first call — that's when a deal
   becomes real.)
3. Inside the window, with an **external prospect attendee** (→ contact email + domain).

Then **dedup before create:** if an existing **open** deal matches the prospect **domain** (preferred)
or company name → **match into it** (attach the QDC meeting + contact + SFDC link); else **create**
at `qualify`/`pending_approval` + contact + the QDC meeting + fire `research-company`.

**This supersedes the email-title trigger.** The `SageIntacctAppointments@365sage.net` booking email
is no longer what creates a deal — it becomes **enrichment** (SFDC opp URL, confirmation, contact
email), linked to the deal by company/domain. (The email still books the meeting that Joe then tags
`QDC`. Verified the email alone is unsafe as a trigger: 39 of 477 bookings name a different rep.)

**Not a create trigger:** Joe not on the invite · event not tagged `QDC` (a `Discovery`/`FDC`/`Demo`/
`Scoping` event that matches an existing deal *ingests to it*; if it matches none, it does **not**
create — flag for review) · reschedule of an already-handled QDC → **update** the meeting date, no
second deal.

> **[DECIDED] Manual QDC tag required.** No auto-treating bookings as QDC. A deal is created only
> when Joe personally tags the invite `QDC`. Consequence (accepted): deals are created deliberately
> and sparingly — nothing is created until Joe tags a qualifying call `QDC`. (Practical note for the
> first run: there are no recent `QDC`-tagged invites yet, so a proof run creates 0 deals until Joe
> tags one.)

### 3.1 Subtypes (by subject)
- **`<Company> + Sage Intacct`** — booked prospect meeting. Body: "confirming this meeting for
  `<date/time>` … your assigned Account Executive, Joe Pacheco." Recipients include the prospect.
- **`New Opportunity Creation - <Company>`** — SFDC opp created; body carries the
  `intacct.lightning.force.com` opportunity URL.
- Treat reschedules/updates (same company, "rescheduled/updated") as updates to the existing
  intake, not new deals.

### 3.2 Parse rules (deterministic, free)
- **Company** = subject before ` + Sage Intacct`, or after `New Opportunity Creation - `.
- **Prospect contact** = the external recipient (the `To`/`DisplayTo` address that is **not**
  `@sage.com` and **not** `@365sage.net`). Capture email → name (from display) → **domain**.
- **Meeting date/time** = parsed from body ("Wednesday, June 24th at 9 AM EST"); cross-check
  against the matching calendar event when present.
- **SFDC opp URL** = the lightning link (opportunity subtype).
- **AE** = Joe (assignment line).

### 3.3 Actions
1. **Match-or-create deal** in the active org, keyed on (company name) ∪ (SFDC opp id from URL).
   **[DECIDED] Auto-create** at **`qualify` stage with `qdc_status='pending_approval'`** (a booked
   discovery meeting awaiting QDC), mirroring the BDR/QDC intake. **[DECIDED] First run: prove on
   2–3 recent bookings**, verify deal+contact+domain+research, then process the rest of the window.
2. **Create primary contact** with the prospect email + name (+ domain → also normalizes
   `deals.website`). This is the seed that powers Flows B/C/D.
3. **Create the scheduled meeting** as a deal event / next-step ("QDC with `<contact>` on `<date>`").
4. **Store** the SFDC opp URL on the deal (link-out).
5. **Fire `research-company`** for the new deal (the one justified AI/credit spend at intake —
   new deals are worth researching).
6. **Idempotency** on `email_message_id`; dedupe deals on company + SFDC opp id.

### 3.4 What is NOT done at intake
- No transcript/email body extraction (none exists yet). No full field-catalog pass. The booking
  email itself is structured intake, not prospect speech — it never becomes quote-gated fact.

---

## 4. Flow B — Email Thread Ingestion

### 4.1 Decisions
- **[DECIDED] Window: 30 days.**  **[DECIDED] Direction: sent + received.**
  **[DECIDED] Internal Sage↔Sage threads: hard-drop.**
- **[DECIDED] First run scope: the 6 real-contact deals** — Chaberton, Off The Hook, QC Graphics,
  Cargo International, Spire Storage, Sneex. (Ongoing: all deals, incl. those Flow A creates.)

### 4.2 Matching (free, in code)
Per deal, build a domain set from `contacts.email` domains (authoritative) ∪ cleaned
`deals.website` (fallback). Website cleanup: strip scheme/`www.`/path; strip a stray leading `i`
only if the de-`i`'d domain corroborates a contact domain/company; **drop** `*.example.com` and
any value with whitespace or no dot. A message matches when an **external** participant domain ∈
the deal set. Confidence: contact-email = high; website-only = medium; name-only = excluded.
Domain→multiple-deals → assign to the active-org open deal; else flag, don't double-ingest.

### 4.3 Noise / exclusion (free, before AI; every drop counted in the report)
- **Hard drop:** internal-only; automated/bulk (`no-reply`/`notifications`/`mailer-daemon`,
  `List-Unsubscribe`, `Precedence: bulk`, OOO auto-replies); platform notifications
  (Teams/Zoom recording, read/delivery receipts, DSN/bounce).
- **[DECIDED] Store-only (kept on the thread for continuity, NO AI extraction):** cleaned body
  < **~25 words** (logistics: "thanks", "sounds good", scheduling pings); attachment-only with no body.
- **Keep:** everything else matched to a deal.

### 4.4 Content rules (make a thread read like a transcript)
- **Newest-body-only for facts.** Ignore quoted reply chains (`>`, `On … wrote:`, Outlook
  `From:/Sent:` blocks) for extraction — context only, never a fact source.
- **Strip:** signatures, the Sage legal footer, tracking pixels, unsubscribe blocks, invite
  boilerplate, divider lines; decode quoted-printable; collapse whitespace.
- **One `conversations` row per thread** (not per message): messages oldest→newest as
  `[sender] (rep|prospect) — <date>: <cleaned body>` into `transcript`. Tag each message
  rep/prospect by domain (drives speaker discipline).
- **[DECIDED] Thread window:** if any message in a thread falls in the 30-day window, ingest the
  **whole thread** for readable context, but **extract facts only from in-window messages**
  (older messages are context, not re-mined).

### 4.5 Pass: **LIGHT** (see §7). 1 credit per thread.

---

## 5. Flow C — Calendar Meetings (deterministic, ~0 credits)

**Recency bound (hard rule): only events inside the recent window are ingested. NO historical
backfill of prior meetings.** The all-time categorized meetings (513 Discovery, 336 Demo, 131
Scoping, etc.) are history/context — they are **not** ingestion targets. Same window for Granola
(§6): only transcripts for recent-window meetings auto-ingest.

Match events to deals by external attendee domain (§4.2), or to the Flow-A deal by
company/time. Default **deterministic** extraction, no AI:
- **Engagement** → deal timeline / `deal_engagement_snapshots` (cadence, recency, momentum).
- **Contacts** → attendees become `contacts` (name + email; title if present).
- **Next steps** → upcoming matched meeting seeds a next-step/task.
- **Single-threading risk** (evidence_type=`gap`) → from attendee history.
- Also serves as the **join key** for Flow D.

AI (light, 1 credit) **only** when an event body has real agenda text beyond Teams/Zoom invite
boilerplate (strip the known block, check residual length). → Open question 4.

---

## 6. Flow D — Granola Auto-Sync → Match → Auto-Ingest Transcript

Builds what the Granola doc deferred ("background auto-sync", "deal auto-matching" were out of scope).

### 6.1 Pull
Scheduled `list_meetings` over the recent window via the existing connection (service path; no
manual click). Idempotency on `granola_meeting_id` (column already exists).

### 6.2 Match (Granola meeting → calendar event → deal)
1. **Primary:** match to a calendar event by **start time within ±[LEAN] 30 min** **and**
   participant-email overlap (≥1 shared external address) **and** title similarity.
2. The matched event already resolves to a deal (Flow C / Flow A). → that deal.
3. **Fallback:** no calendar event → match the Granola meeting directly to a deal by participant
   domain (§4.2).
4. **Unmatched** → review queue, not force-ingested. Reported.

### 6.3 Auto-ingest
- `get_meeting_transcript` → insert `conversations` row (`source='granola'`,
  `granola_meeting_id`, share URL) → fire **`process-transcript`** + **`extract-pass`**.
- **Call type [DECIDED]: from the matched Outlook event's CATEGORY** (see §6a). The Granola
  transcript inherits the call type of the calendar event it matched. Category → call type drives
  full vs light pass. (Stage/title inference is retired; used only as a fallback when an event
  carries no stage category.)
- Granola AI summary + action items are **auxiliary context only** (never quote-gated fact;
  action items seed task extraction, not the tasks table) — per the Granola addendum.

### 6.4 Pass: **FULL** for real discovery calls (qdc/fdc/scoping/demo); light otherwise. Transcripts
are the highest-value source, so this spend is intended — but idempotent and capped.

---

## 6a. Category → Call Type (the meeting's stage signal) [DECIDED]

Joe categorizes calendar events by stage. The event category **is** the Lumen call type, and the
call type decides full vs light pass (§7). Events carry the category in
`CalendarEvents_Categories → Categories.Category_Name`; an event may carry several categories, so
pick the highest-priority *stage* category and ignore color/admin/personal/prep tags.

**Priority (highest first) + mapping** — normalized case-insensitively:

| Outlook category (incl. synonyms) | Lumen `call_type` | Pass |
|---|---|---|
| `QDC` | `qdc` | FULL |
| `FDC`, `FDCs`, **`Discovery`** | `functional_discovery` | FULL |
| `Demo`, `DEMO`, `Demos` | `demo` | FULL |
| `Scoping` | `scoping` | FULL |
| `Proposal`, `Closing`, `Closing/SOW Review`, `SOW Review/Proposal`, `SOW & Subscription Review` | `proposal` | light |
| `Connects/Syncs`, `Sync` | `sync` | light |
| prep/internal/admin/personal/color-only, or **uncategorized** | → not ingested as a stage call (skip / fallback) |

Notes: `Discovery` is Joe's dominant category (513) and maps to `functional_discovery` (his FDC).
**`Closing` = `proposal`** (Joe's call). `negotiation` is unused (no category maps to it).
Multi-category events resolve by the priority order above.

**Coverage reality (verified):** recent events are **mostly uncategorized** (244 of the 300
most-recent carry no category; historical categorization was heavy — 513 Discovery all-time). So
the category signal is reliable when present but absent on most fresh meetings — the fallback
(§6b) is load-bearing, not an edge case.

**Internal vs generic:** `Internal`/`Internal Meeting`/`Personal`/`Admin`/`Prep` (or all-internal
attendees) ⇒ **not a customer call, skip ingest.** `Customer Call` (generic, no stage) ⇒ **skip**
(§6b) — only the stage categories above trigger ingestion.

## 6b. Uncategorized handling [DECIDED — supersedes the earlier light-ingest fallback]

**Joe categorizes every customer-facing meeting.** Therefore **uncategorized = not customer-facing
= SKIP** (do not ingest). Non-stage categories (`Internal`, `Personal`, `Admin`, `Prep`,
`Customer Call` generic, color-only) also skip. Only the stage categories in §6a trigger ingestion.

Safety net (optional, off by default): if Joe forgets to tag a real customer meeting, he can tag
it later; if it was ever light-ingested, reclassifying re-runs the full pass FREE from
`conversations.ai_raw_response`. With the skip rule this is a rare exception, not the default path.

The calendar epoch needs a one-time decode constant at build time (raw `Calendar_StartDateUTC` is
offset, not Unix) — read a real `DTSTART` from an `.olk15Event` file or anchor to a known meeting.

---

## 7. Extraction Contract — what is *actually* extracted (centerpiece)

Pass type by source: **Intake (A)** = deterministic, no extraction. **Email (B)** = light.
**Calendar (C)** = deterministic (light only on agenda-bearing events). **Granola (D)** = full
on discovery calls, light otherwise. **The 60+ SC field catalog runs ONLY on full-pass
transcripts — never on email or calendar.**

### 7.1 DO extract (light + full targets)
| Target | Qualifies from |
|---|---|
| `deal_pain_points` | prospect-stated problem + verbatim quote |
| `business_catalysts` | prospect-stated force driving change |
| `compelling_events` | prospect-stated dated consequence of inaction |
| `company_systems` | tools/systems the prospect names |
| `contacts` | new people from participants/signatures/attendees |
| `deal_metrics` | any quantified prospect statement + quote |
| `tasks` (next steps) | explicit commitments/asks |
| `deal_risks` (`stated`) | quote-backed risk signals (e.g. "also evaluating NetSuite") |
| `deal_hypotheses` | AI reasoning — quarantined, never client-facing, never fact |
| SC field catalog | **full-pass transcripts only** |

### 7.2 DO NOT extract
- SC field catalog from email/calendar. Scores (computed by `compute-deal-risks`). Pricing/quote/
  proposal content. Anything from quoted reply chains or AI-summary text.

### 7.3 Provenance & gates (reuse the spine)
- New `source` values `email`, `meeting`, plus existing `granola`(transcript)/`manual`/`research`.
- **Quote gate:** fact needs verbatim sentence (quote) + sender/speaker + message/meeting id +
  observed_at. No quote ⇒ not written.
- **Speaker discipline:** prospect-business facts count only from a **prospect-side** sender/speaker.
  Joe asserting in a sent email = context, not fact; prospect confirming = fact.
- **Manual-lock / recency / change-classification / match-before-insert dedup:** identical to the
  transcript pass; emails *enrich* existing entities (append a `deal_sources` quote), not duplicate.
- Every fact writes `deal_sources` with the right `source_origin` + a deep link back.

---

## 8. Recency, Scope & Cost Bounds

- **[DECIDED] Participant gate (cross-cutting):** ingest an item ONLY when
  **`joe.pacheco@sage.com` is an attendee/sender/recipient** of the meeting/thread. Calendar &
  Granola: Joe must be in the attendee list. Email: Joe must be a participant on the thread (not
  merely sitting in a shared/forwarded folder). Anything Joe isn't actually on is skipped.
- **[DECIDED] 30-day window** on send time / event start (all flows). No historical backfill.
- **Incremental watermark** per source (no re-scan).
- **Hard caps per run [LEAN]:** `MAX_THREADS_PER_DEAL=25`, `MAX_NEW_DEALS=50`,
  `MAX_TOTAL_CREDITS=100` (projected overspend aborts with a report).
- **Dry-run default:** match/filter/thread + print keep/drop counts and **projected credit spend**;
  writes nothing without `--commit`.
- Cost facts: `extract-pass` = **1 credit/run**, charged **per thread / per transcript**, not per
  message. **Re-extraction free** from `ai_raw_response`. Calendar ≈ free. Intake spends only
  `research-company` per genuinely new deal.

---

## 9. Schema Additions (additive; mirror the Granola precedent)

`conversations`: `email_message_id text`, `email_thread_id text`, `email_direction text`,
`outlook_record_id integer`, `calendar_event_id text`; `source` gains `email`/`meeting`;
`call_type` gains `email`/`meeting` (confirm both excluded from `FULL_PASS_TYPES`).
Provenance `source` / `deal_sources.source_origin` gain `email`, `meeting`.
`deals`: `sfdc_opportunity_url text`, `intake_source text` (`sage_intacct_appointments`).
New: `local_ingest_settings` (org-scoped: window, caps, internal_domains[], exclusion jsonb,
enabled) and `local_ingest_log` (run id, watermark, counts, projected vs actual credits,
ambiguity/unmatched flags). Idempotency on `email_message_id` / `calendar_event_id` /
`granola_meeting_id` / SFDC opp id.

---

## 10. Delivery — the Local Outlook Portal [DECIDED]

**Substrate: Classic/Legacy Outlook for Mac** (Joe switches off New Outlook). This is what makes
the category/QDC signal reachable — Classic writes category tags into the readable
`Outlook.sqlite` **and** exposes an AppleScript automation interface.

**The portal** is a small local service on Joe's Mac (packaged as a local MCP + a scheduled
on-demand job):
- **Read (bulk):** `Outlook.sqlite` + `.olk15*` files — mail, events, attendees, times, bodies.
- **Read (categories + gaps):** **AppleScript** against `Microsoft Outlook` (Classic) for event
  categories (QDC/Discovery/Demo/…), and anything the SQLite mirror lags on. AppleScript is the
  authoritative category read.
- **Normalize/index:** thread assembly, body parsing, dedup, deal-matching into its own local store.
- **Write to Supabase** (service role) per Flows A–D; dry-run → `--commit`.
- **Write-back to Outlook** (AppleScript, optional): mark processed, set/confirm a category, etc.
- **Granola (Flow D):** **[DECIDED] on-demand** pull via the existing connection; match to the
  categorized event by date/call; ingest with the event's category as call type.
- **Re-extraction:** separate free pass over `ai_raw_response` when rules/catalog change.

Category source is resolved: **Classic Outlook SQLite + AppleScript** (no Lumen tagging, no
HxStore parsing). Requires Joe to switch to Classic and let it fully re-sync before first run.

---

## 11. Out of Scope (v1)

Attachment content extraction (filename/type only). Gmail/other providers. Name-only matching.
Internal-thread mining. Real-time push. Encryption-at-rest hardening of any cached DB copy
(separate IT item).

---

## 12. Decisions Made & Open Questions

**Decided:** **substrate = Classic/Legacy Outlook**; category source = Classic SQLite + AppleScript
(no Lumen tagging) · delivery = **local Outlook portal** (local MCP + on-demand sync, read + Outlook
write-back) · sender `SageIntacctAppointments@365sage.net` context, but **deal creation trigger =
Joe-attended invite manually tagged `QDC`** (email is enrichment only) · **participant gate: only
ingest where `joe.pacheco@sage.com` is an attendee/participant** · 30-day window, **no historical
meeting backfill** · email sent+received · drop internal threads · first email run = the 6
real-contact deals · intake auto-creates at `qualify`+`pending_approval` · **call type = Outlook
event category** (QDC, FDC/Discovery→FDC, Demo, Scoping, Closing→Proposal, Sync); drives full vs
light pass · **uncategorized = skip** · Granola on-demand for v1.

**Still open (non-blocking; default leans apply unless Joe says otherwise):**
1. **Calendar depth:** deterministic-only for v1 (lean), or also light-AI on agenda-bearing events?
2. **Caps/thresholds:** `MAX_THREADS_PER_DEAL=25`, `MAX_NEW_DEALS=50`, `MAX_TOTAL_CREDITS=100`,
   store-only < 25 words — confirm or adjust.
</content>
