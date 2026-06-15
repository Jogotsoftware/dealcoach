# Claude Handoff — Lumen (formerly DealCoach)

> Generated 2026-06-15 for a laptop migration. This is an orientation file for a
> fresh Claude session on a new machine. **Canonical sources of truth are the
> repo's own `CLAUDE.md` and `BACKLOG.md`** — read those first; this file is a
> point-in-time summary and may drift.

## What this is
**Lumen** (rebranded from "DealCoach" on 2026-05-11) — the shipped product of
**Revenue Instruments**. An AI deal-coaching / revenue-intelligence platform.

## Where it lives
- **Old-machine path:** `C:\Users\Work\Downloads\dealcoach\dealcoach` (will differ on the new laptop)
- **GitHub:** https://github.com/Jogotsoftware/dealcoach.git  · default branch `main`
- **Live web app:** https://aidealcoach.netlify.app (Netlify auto-deploys from `main`)

## Stack / shape
- React 18 + Vite frontend (`src/`)
- Supabase: Postgres + Auth + Storage + Edge Functions — project ref **`npfnsyufqqhhjmtvmold`**
- All AI runs through Supabase Edge Functions calling the Claude API
- Multi-component monorepo: `desktop/` (Electron), `chatbot/` (standalone Electron), `extension/` (Chrome)
- Modules built *inside* this repo: BDRCoach, Inbound Meetings, DealRoom, Path to Close, Sage canon, the SC (`/sc`) portal

## ⚠️ Uncommitted work preserved on a branch
There was in-progress work in the tree that is **NOT on `main`**. It was committed to
branch **`laptop-migration-snapshot`** and pushed. To see it on the new machine:
```
git checkout laptop-migration-snapshot
```
It's an **"SME" (subject-matter-expert) escalation/citation feature**:
- New: `src/pages/sme/`, `src/lib/sme-taxonomy.js`, and 7 edge functions —
  `escalate-to-sme`, `record-sme-citation`, `sme-flag-incorrect`,
  `sme-generate-clarifying-questions`, `sme-mark-helpful`, `sme-resolve-flag`, `sme-submit-answer`
- Modified: `useAuth.jsx`, `AcceptInvite.jsx`, `CoachAdmin.jsx`, `CoachBuilder.jsx`,
  `Settings.jsx`, `supabase/functions/compute-deal-risks`, `supabase/functions/process-transcript`
- This work is **unverified / mid-build** — that's exactly why it was kept off `main` (which deploys to prod).

## Gotchas worth knowing
- **Edge function deploy:** the MCP deploy tool is unreliable — use the Supabase CLI with the
  token from the repo `.env`, and **always pass `--no-verify-jwt`**.
- Multiple Claude Code sessions sometimes run on this repo at once — verify ownership before committing.
- `.env` (Supabase + Anthropic keys) is gitignored, so it's NOT on GitHub — it ships only in the folder copy.

## To run locally
`npm install` then the dev script in `package.json` (Vite). See `CLAUDE.md` for the full dev workflow.
