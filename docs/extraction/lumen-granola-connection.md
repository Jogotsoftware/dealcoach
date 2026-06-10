# Claude Code Prompt: Granola Connection + In-App Meeting Import

## Objective

Add a per-user Granola integration so an AE can connect their own Granola account
(browser OAuth) and import a meeting transcript directly into a Lumen deal from the
existing Import Transcript dialog. New flow: open Import Transcript, pick the "From
Granola" tab, see a list of recent Granola calls with dates, select one, set the call
type, edit the title if needed, and import. Import inserts a `conversations` row and
fires `process-transcript`, exactly like the existing paste and URL-import paths.

This is a strategy-approved build. Read `CLAUDE.md` in the repo first.

## Decisions already made (leans, flag any you want to override before building)

1. **Per-user connection.** The connection is owned by the logged-in profile, not the
   org. Each AE authorizes their own Granola. RLS scopes a connection to its owner.
2. **Official auth path is Granola MCP over browser OAuth.** Granola exposes no general
   REST API on the Business plan. The supported path is the MCP server at
   `https://mcp.granola.ai/mcp` using OAuth 2.0 with Dynamic Client Registration (DCR)
   over Streamable HTTP transport. DCR means there is no client ID or client secret to
   pre-provision: Lumen registers as a client dynamically during the connect flow. Use
   standard MCP auth discovery (protected-resource metadata, then authorization-server
   metadata) against the MCP endpoint rather than hardcoding any OAuth URLs.
3. **Lumen acts as an MCP client inside edge functions.** Implement a minimal
   MCP-over-HTTP client (initialize, tools/list, tools/call). Do not pull in a heavy SDK
   if a thin JSON-RPC-over-HTTP implementation covers initialize + tools/call.
4. **Three edge functions, mapping to the three UI actions:** `granola-auth`,
   `granola-meetings`, `granola-import`.
5. **No deal matching.** The AE is already inside a deal when they import, so `deal_id`
   is supplied by the UI. None of the background routing/triage logic applies here.
6. **Token storage in a new `user_granola_connections` table.** Tokens stored with RLS
   restricting rows to the owner. See the encryption note in Out of Scope: production
   encryption-at-rest hardening is a separate Sage IT posture item, not part of this
   sprint.

## Architecture

```
UI: Import Transcript dialog, new "From Granola" tab
   not connected  -> "Connect Granola" button -> opens granola-auth (popup)
   connected      -> time-range dropdown + meeting list (title, date, participants)
                     -> select meeting -> call_type select + editable title -> Import

granola-auth      action=start    -> DCR if needed, build authorize URL, redirect
                  action=callback -> exchange code for tokens, upsert connection row
granola-meetings  -> authenticated MCP tools/call: list_meetings(time_range)
                     -> returns [{ id, title, date, participants }]
granola-import    -> authenticated MCP tools/call: get_meeting_transcript(meeting_id)
                     -> insert conversations row (processed=false) -> fire process-transcript
```

The back half (conversations insert + process-transcript handoff) must match the
existing `import-transcript-url` function so analysis behaves identically.

## Database migration (apply_migration)

Create `user_granola_connections`:

- `id` uuid pk default gen_random_uuid()
- `user_id` uuid not null (the owning profile)
- `org_id` uuid not null
- `status` text not null default 'connected' (connected | disconnected | error)
- `granola_email` text null (from get_account_info, for display "Connected as ...")
- `access_token` text null
- `refresh_token` text null
- `token_expires_at` timestamptz null
- `client_registration` jsonb null (DCR client metadata returned by Granola)
- `last_used_at` timestamptz null
- `created_at` timestamptz default now()
- `updated_at` timestamptz default now()
- unique (user_id)

RLS: a user can select/insert/update/delete only rows where `user_id = auth.uid()`.
Add `update_updated_at` trigger consistent with other tables.

Additive change to `conversations` for traceability and idempotency:

- `granola_meeting_id` text null

Before insert in `granola-import`, check for an existing conversation with the same
`deal_id` and `granola_meeting_id`; if found, return it instead of inserting a duplicate.

## Edge functions

All three deploy with `verify_jwt: false` (project standard). Require the `apikey`
header with the anon key for Kong. Wrap every Supabase op in try/catch; use the
`safeInsert` / `safeInsertNoReturn` helpers. Embed a version stamp in every error
message, for example `"granola-import v1: deal_id missing"`.

### granola-auth (v1)
- `action=start`: resolve the caller's user_id/org_id. Run MCP auth discovery against
  `https://mcp.granola.ai/mcp`. If no `client_registration` exists for this user, perform
  DCR and persist the registration. Build the authorization URL with PKCE, store the
  PKCE verifier and state server-side (keyed to the user), and redirect the browser.
- `action=callback`: validate state, exchange the auth code (with PKCE verifier) for
  access + refresh tokens, optionally call `get_account_info` to capture `granola_email`,
  upsert the `user_granola_connections` row with `status='connected'`, then return a tiny
  HTML page that posts a message to the opener and closes the popup.

### granola-meetings (v1)
- Input: `{ time_range, custom_start?, custom_end?, folder_id? }`.
- Load the caller's connection. If expired, refresh using the refresh token; if refresh
  fails, set `status='error'` and return a 401-style body the UI can use to prompt
  reconnect.
- MCP `tools/call` `list_meetings` with the given range. Normalize to
  `[{ id, title, date, participants }]`. Update `last_used_at`.

### granola-import (v1)
- Input: `{ deal_id, meeting_id, call_type, call_date, title }`.
- Idempotency check on (`deal_id`, `granola_meeting_id`).
- MCP `tools/call` `get_meeting_transcript` for `meeting_id`. If the transcript is empty
  or under a minimal length, return a clear error.
- Insert `conversations`: `deal_id`, `title` (use supplied title, fall back to meeting
  title), `call_type` (default `discovery` if absent), `call_date` (use the meeting date),
  `transcript`, `source='granola'`, `granola_meeting_id`, `processed=false`,
  `tasks_extracted=false`.
- Fire `process-transcript` in the background with `{ conversation_id, deal_id }` using
  `EdgeRuntime.waitUntil`, same pattern as `import-transcript-url`.
- Return `{ success, version:'granola-import v1', conversation_id, transcript_length }`.

## Frontend (TranscriptUpload.jsx)

Add a "From Granola" tab alongside the existing paste / upload / URL options. Inline
styles from `src/lib/theme.js`, Carolina Blue tokens, no emojis.

- On open, check connection status (a lightweight read of `user_granola_connections` for
  the current user, or a status field returned by `granola-meetings`).
- Not connected: show a short explainer and a "Connect Granola" button that opens
  `granola-auth?action=start` in a popup. Listen for the postMessage from the callback
  page, then refresh status.
- Connected: show "Connected as {granola_email}", a time-range dropdown (This week, Last
  week, Last 30 days), and the meeting list. Each row shows title, formatted date, and
  participants. Selecting a row reveals the call-type select and an editable title field
  prefilled from the meeting title, plus an Import button.
- Import calls `granola-import`, then shows the same processing state the other import
  paths use, and calls `onUploaded` so the deal view refreshes.
- Provide a small "Disconnect" affordance that sets `status='disconnected'` and clears
  tokens.

## Granola MCP reference (verified against a live Business-plan account)

Tools available via `tools/list` on the MCP server:

- `list_meetings({ time_range, custom_start?, custom_end?, folder_id? })`
  time_range in [this_week, last_week, last_30_days, custom]. Returns meetings with
  `id` (uuid), `title`, `date` (with timezone), and participants (name + email).
- `get_meeting_transcript({ meeting_id })` returns verbatim transcript content
  (timestamped speaker turns). Note: a transcript pull may require user approval on the
  Granola side; surface any non-success cleanly in the UI.
- `get_meetings({ meeting_ids[] })` returns notes, AI summary, attendees, metadata.
  Not required for v1 but available if you want richer list metadata.
- `list_meeting_folders()` returns folder ids/titles/counts. Optional, only needed if you
  expose folder filtering.

Constraints to respect: transcript access requires Business plan (confirmed available).
MCP returns only notes the user owns; shared-with notes do not appear. That is acceptable
for "import my calls."

## Out of scope (do not build in this sprint)

- Background auto-sync or polling of Granola. This is manual, user-initiated import only.
- Deal auto-matching / triage inbox. The AE supplies the deal.
- The Discovery Call analyzer/extraction work (separate task, content pending).
- The SC discovery-notes creator (separate task, content pending).
- Team or org-wide Granola connections, and shared-note access.
- Production token encryption-at-rest (Supabase Vault / pgsodium). Store tokens in the
  table with RLS for the pilot, and leave a clear TODO comment that hardening is a Sage
  IT posture item. Do not silently ship plaintext tokens without that note.

## Halt conditions (stop and report, do not improvise around these)

- The MCP OAuth/DCR handshake against Granola fails in a way that appears to require
  manual app pre-registration (i.e., DCR is not actually supported as documented).
- Any write that would touch the real production org (`0acebff8-8827-4984-b478-cbcad404539d`).
- A schema conflict on `conversations` or an unrecoverable failed migration.
- Auth breakage in the existing app (login, RLS) caused by the new table or functions.

## Completion report

Return a self-annotated checklist: migration applied (table + RLS + conversations column),
each edge function deployed with its version stamp, the connect flow tested end to end
(connect, list, import, transcript lands, process-transcript fires), the idempotency check
verified by importing the same meeting twice, and the disconnect path verified. Note any
leans you changed and why, and flag the encryption-at-rest TODO explicitly.
