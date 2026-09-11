import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "../_shared/granola-mcp.ts";
import { normalizeMeetings } from "../_shared/granola-meetings-parse.ts";
import {
  importGranolaMeeting,
  parseCallTypeFromTitle,
  GranolaImportError,
} from "../_shared/granola-import-core.ts";

// granola-sync v1
// Scheduled folder->deal auto-sync: pulls newly-recorded Granola calls from each
// mapped folder (deal_granola_folders) into its deal, deriving call_type from the
// meeting title label (parseCallTypeFromTitle, default 'sync'), then firing the
// same process chain as the manual import.
//
// Auth (any one): x-cron-secret == CRON_SECRET (pg_cron sweep) | service-role
// bearer | a user JWT (scoped to the caller's org).
// Modes (POST body):
//   {}                       -> sweep all enabled mappings (cron/service: all orgs;
//                               user: their org only)
//   { deal_id }              -> just that deal's mapping
//   { folder_id }            -> just that folder's mapping
//   { dry_run: true }        -> plan only; lists keep/skip + projected imports, no writes
//   { time_range }           -> override list window (default 'last_30_days')

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const FULL_PASS_TYPES = new Set(["qdc", "functional_discovery", "scoping", "demo"]);
const MAX_IMPORTS_PER_RUN = 50;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jr({ error: "granola-sync v1: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // ── Auth ──────────────────────────────────────────────────────────────
    const isCron = !!CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isService = !!token && token === SERVICE_KEY;
    let callerOrg: string | null = null;
    if (!isCron && !isService) {
      if (!token) return jr({ error: "granola-sync v1: missing authorization" }, 401);
      const { data: u, error: uErr } = await sb.auth.getUser(token);
      if (uErr || !u?.user) return jr({ error: "granola-sync v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).single();
      callerOrg = prof?.org_id || null;
      if (!callerOrg) return jr({ error: "granola-sync v1: caller has no org" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const timeRange = body.time_range || "last_30_days";

    // ── Resolve mappings to process ──────────────────────────────────────
    let q = sb.from("deal_granola_folders").select("*").eq("enabled", true);
    if (body.deal_id) q = q.eq("deal_id", body.deal_id);
    else if (body.folder_id) q = q.eq("granola_folder_id", body.folder_id);
    if (callerOrg) q = q.eq("org_id", callerOrg); // user mode: own org only
    const { data: mappings, error: mapErr } = await q;
    if (mapErr) return jr({ error: `granola-sync v1: mapping lookup failed: ${mapErr.message}` }, 500);
    if (!mappings || !mappings.length) {
      return jr({ success: true, version: "granola-sync v1", dry_run: dryRun, mappings_processed: 0, results: [], totals: zeroTotals() });
    }

    // ── Process each mapping ─────────────────────────────────────────────
    const connCache = new Map<string, any>(); // user_id -> connection row | null
    const results: any[] = [];
    const totals = zeroTotals();
    let importBudget = MAX_IMPORTS_PER_RUN;

    for (const map of mappings) {
      const r: any = {
        deal_id: map.deal_id,
        folder_id: map.granola_folder_id,
        folder_name: map.granola_folder_name,
        listed: 0,
        new: [] as any[],
        imported: 0,
        skipped_existing: 0,
        errors: [] as string[],
      };

      // Resolve the connection for the mapping's owner.
      let conn = connCache.get(map.user_id);
      if (conn === undefined) {
        const { data } = await sb.from("user_granola_connections").select("*").eq("user_id", map.user_id).maybeSingle();
        conn = data && data.status === "connected" ? data : null;
        connCache.set(map.user_id, conn);
      }
      if (!conn) {
        r.errors.push("owner Granola not connected");
        results.push(r);
        continue;
      }

      // List the folder's meetings.
      let meetings: ReturnType<typeof normalizeMeetings> = [];
      try {
        const accessToken = await ensureFreshToken(sb, conn, "granola-sync v1");
        const mcp = new McpClient(accessToken);
        await mcp.initialize();
        const listResult = await mcp.toolsCall("list_meetings", { time_range: timeRange, folder_id: map.granola_folder_id });
        meetings = normalizeMeetings(listResult, mcpResultJson, mcpResultText);
      } catch (e: any) {
        r.errors.push(`list_meetings failed: ${e?.message || e}`);
        results.push(r);
        continue;
      }
      r.listed = meetings.length;
      totals.listed += meetings.length;

      // Which of these are already imported into this deal?
      const ids = meetings.map((m) => m.id);
      const existing = new Set<string>();
      if (ids.length) {
        const { data: imported } = await sb
          .from("conversations")
          .select("granola_meeting_id")
          .eq("deal_id", map.deal_id)
          .in("granola_meeting_id", ids);
        for (const row of imported || []) existing.add(row.granola_meeting_id);
      }

      for (const m of meetings) {
        if (existing.has(m.id)) { r.skipped_existing++; continue; }
        const callType = parseCallTypeFromTitle(m.title) ?? "sync";
        const fullPass = FULL_PASS_TYPES.has(callType);
        const plan = { meeting_id: m.id, title: m.title, call_type: callType, full_pass: fullPass, labeled: parseCallTypeFromTitle(m.title) !== null };
        r.new.push(plan);
        totals.new++;
        if (!plan.labeled) totals.unlabeled_defaulted++;

        if (dryRun) continue;
        if (importBudget <= 0) { r.errors.push(`import cap (${MAX_IMPORTS_PER_RUN}) reached; remainder deferred to next run`); break; }

        try {
          const res = await importGranolaMeeting(
            sb,
            conn,
            { deal_id: map.deal_id, meeting_id: m.id, call_type: callType, title: m.title, call_date: m.date ? String(m.date).substring(0, 10) : null },
            { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, fnTag: "granola-sync v1" },
          );
          if (res.already_imported) r.skipped_existing++;
          else { r.imported++; totals.imported++; importBudget--; }
        } catch (e: any) {
          const msg = e instanceof GranolaImportError ? e.message : (e?.message || String(e));
          r.errors.push(`import ${m.id}: ${msg}`);
          totals.errors++;
        }
      }

      if (!dryRun && r.imported > 0) {
        try { await sb.from("deal_granola_folders").update({ last_synced_at: new Date().toISOString() }).eq("id", map.id); } catch (_) { /* non-fatal */ }
      }
      results.push(r);
    }

    // extract-pass + process-transcript each consume credits per new transcript;
    // projected_credits is a floor (one extract-pass credit per new import).
    totals.projected_credits = totals.new;

    return jr({
      success: true,
      version: "granola-sync v1",
      dry_run: dryRun,
      mappings_processed: mappings.length,
      results,
      totals,
    });
  } catch (e: any) {
    console.error("granola-sync v1 error:", e);
    return jr({ error: `granola-sync v1: ${e?.message || e}` }, 500);
  }
});

function zeroTotals() {
  return { listed: 0, new: 0, imported: 0, skipped_existing: 0, unlabeled_defaulted: 0, errors: 0, projected_credits: 0 };
}
