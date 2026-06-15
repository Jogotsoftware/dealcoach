import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// compute-deal-risks v1 (extraction overhaul Phase 5)
// Deterministic risk + spine-score engine. Runs post-extraction (fired by
// extract-pass) and on demand ({ deal_id } or { org_id } for a sweep).
//
// Gap risks are computable absences — verifiable claims about the record
// itself, never inferences about the prospect (so they satisfy the
// no-hypothesis rule). Auto-generated gap risks resolve themselves when the
// gap closes; history kept via status transitions.
//
// Also computes the two spine scores (Compelling Event, Catalyst) per the
// template scoring configs, and the qualifying-spine deal flag ("deal isn't
// real yet") when CE + catalyst + finance-orientation evidence are all
// missing. Scores are computed here, never written by extraction.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const LATER_STAGES = new Set(["confirming_value", "selection", "solution_validation"]);
const SPINE_FLAG = "Qualifying spine missing: no compelling event, no catalyst, and no finance-operations orientation evidence — this deal isn't real yet.";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } });
}

const daysBetween = (a: Date, b: Date) => Math.abs(a.getTime() - b.getTime()) / 86_400_000;

async function computeForDeal(sb: any, dealId: string): Promise<any> {
  const { data: deal } = await sb.from("deals").select("id, org_id, stage, forecast_category").eq("id", dealId).maybeSingle();
  if (!deal) return { deal_id: dealId, error: "not found" };

  const [cesR, catsR, convsR, contactsR, risksR, changesR, valuesR, sizingR, moduleRefR, dealModsR] = await Promise.all([
    sb.from("compelling_events").select("id, event_date, strength, verified, reconfirmed_at, observed_at, created_at").eq("deal_id", dealId),
    sb.from("business_catalysts").select("id, urgency, impact, verified").eq("deal_id", dealId),
    sb.from("conversations").select("id, call_type, call_date").eq("deal_id", dealId),
    sb.from("contacts").select("id, is_economic_buyer, role_in_deal").eq("deal_id", dealId),
    sb.from("deal_risks").select("id, risk_key, status, auto_generated").eq("deal_id", dealId).eq("auto_generated", true),
    sb.from("deal_change_events").select("field_key, created_at").eq("deal_id", dealId),
    sb.from("custom_field_values").select("field_key, value_text, value_number, value_boolean, value_json").eq("entity_type", "deal").eq("entity_id", dealId),
    sb.from("deal_sizing").select("*").eq("deal_id", dealId).maybeSingle(),
    sb.from("module_reference").select("module_key, name, suggestion_rules").eq("active", true).not("suggestion_rules", "is", null),
    sb.from("deal_modules").select("module_key").eq("deal_id", dealId),
  ]);
  const ces = cesR.data || [];
  const cats = catsR.data || [];
  const convs = convsR.data || [];
  const contacts = contactsR.data || [];
  const autoRisks = risksR.data || [];
  const discoveryCalls = convs.filter((c: any) => ["qdc", "functional_discovery", "scoping", "demo"].includes(c.call_type)).length;

  // ── Spine scores ──
  const STRENGTH = { strong: 100, moderate: 60, medium: 60, weak: 25 } as Record<string, number>;
  let ceScore = 0;
  if (ces.length) {
    const strength = ces.reduce((s: number, c: any) => s + (STRENGTH[c.strength] ?? 60), 0) / ces.length;
    const dated = ces.filter((c: any) => c.event_date);
    let proximity = 10;
    if (dated.length) {
      const nearest = Math.min(...dated.map((c: any) => daysBetween(new Date(c.event_date), new Date())));
      proximity = nearest < 30 ? 100 : nearest < 90 ? 75 : nearest < 180 ? 50 : 25;
    }
    const verified = (ces.filter((c: any) => c.verified).length / ces.length) * 100;
    const recents = ces.map((c: any) => c.reconfirmed_at || c.observed_at || c.created_at).filter(Boolean);
    let recency = 10;
    if (recents.length) {
      const newest = Math.min(...recents.map((d: string) => daysBetween(new Date(d), new Date())));
      recency = newest < 30 ? 100 : newest < 60 ? 60 : newest < 90 ? 30 : 10;
    }
    ceScore = Math.round(strength * 0.35 + proximity * 0.30 + verified * 0.20 + recency * 0.15);
  }
  const URG = { high: 100, medium: 60, low: 25 } as Record<string, number>;
  let catScore = 0;
  if (cats.length) {
    const urgency = cats.reduce((s: number, c: any) => s + (URG[c.urgency] ?? 60), 0) / cats.length;
    const impact = cats.reduce((s: number, c: any) => s + (URG[c.impact] ?? 60), 0) / cats.length;
    const vCount = cats.filter((c: any) => c.verified).length;
    const verified = vCount === 0 ? 0 : vCount === 1 ? 50 : vCount === 2 ? 75 : 100;
    catScore = Math.round(urgency * 0.35 + impact * 0.35 + verified * 0.30);
  }

  // Upsert scores (one row per score_type per deal, refreshed in place).
  const summary_score_errors: string[] = [];
  for (const [type, score] of [["compelling_event", ceScore], ["catalyst", catScore]] as const) {
    try {
      const { data: existing } = await sb.from("deal_scores").select("id").eq("deal_id", dealId).eq("score_type", type).maybeSingle();
      const row = { deal_id: dealId, score_type: type, score, max_score: 100, scored_by: "auto", notes: "compute-deal-risks v1", scored_at: new Date().toISOString() };
      const { error } = existing
        ? await sb.from("deal_scores").update(row).eq("id", existing.id)
        : await sb.from("deal_scores").insert(row);
      if (error) throw new Error(error.message);
    } catch (e: any) { console.error("compute-deal-risks v1: score upsert:", e?.message); summary_score_errors.push(`${type}: ${e?.message}`); }
  }

  // ── Gap risks (deterministic; auto-resolve when the gap closes) ──
  type Gap = { key: string; present: boolean; severity: string; description: string; evidence: Record<string, unknown> };
  const verifiedCEs = ces.filter((c: any) => c.verified).length;
  const timelineChanges = (changesR.data || []).filter((c: any) => ["go_live_target", "decision_timeline", "timeline", "contract_end_date"].includes(c.field_key)).length;
  const orientationValue = (valuesR.data || []).find((v: any) => v.field_key === "finance_operations_orientation")?.value_text || null;

  const gaps: Gap[] = [
    {
      key: "compelling_event_missing",
      present: LATER_STAGES.has(deal.stage) && verifiedCEs === 0,
      severity: "critical",
      description: "No verified compelling event on a late-stage deal — nothing happens to them if they do nothing.",
      evidence: { stage: deal.stage, compelling_events: ces.length, verified: verifiedCEs },
    },
    {
      key: "eb_unidentified",
      present: discoveryCalls >= 2 && !contacts.some((c: any) => c.is_economic_buyer),
      severity: "high",
      description: `No economic buyer identified after ${discoveryCalls} discovery-stage calls.`,
      evidence: { discovery_calls: discoveryCalls, contacts: contacts.length },
    },
    {
      key: "single_threaded",
      present: convs.length >= 2 && contacts.length <= 1,
      severity: "high",
      description: `Single-threaded: ${contacts.length} contact${contacts.length === 1 ? "" : "s"} engaged across ${convs.length} calls.`,
      evidence: { calls: convs.length, contacts: contacts.length },
    },
    {
      key: "timing_slippage",
      present: timelineChanges >= 2,
      severity: "medium",
      description: `Timeline facts have changed ${timelineChanges} times — dates are slipping.`,
      evidence: { timeline_changes: timelineChanges },
    },
  ];

  const summary: any = { deal_id: dealId, ce_score: ceScore, catalyst_score: catScore, raised: [], resolved: [] };
  if (summary_score_errors.length) summary.score_errors = summary_score_errors;
  for (const g of gaps) {
    const existing = autoRisks.find((r: any) => r.risk_key === g.key && r.status === "open");
    if (g.present && !existing) {
      try {
        const { error } = await sb.from("deal_risks").insert({
          deal_id: dealId, risk_key: g.key, risk_description: g.description,
          evidence_type: "gap", evidence: g.evidence, severity: g.severity,
          category: "deal", status: "open", source: "computed", auto_generated: true,
          observed_at: new Date().toISOString(),
        });
        if (error) throw new Error(error.message);
        summary.raised.push(g.key);
      } catch (e: any) { console.error(`compute-deal-risks v1: raise ${g.key}:`, e?.message); summary[`raise_error_${g.key}`] = e?.message; }
    } else if (!g.present && existing) {
      try {
        const { error } = await sb.from("deal_risks").update({
          status: "resolved", resolved_at: new Date().toISOString(),
          resolution_notes: "Auto-resolved: the computed gap closed.",
          evidence: g.evidence,
        }).eq("id", existing.id);
        if (error) throw new Error(error.message);
        summary.resolved.push(g.key);
      } catch (e: any) { console.error(`compute-deal-risks v1: resolve ${g.key}:`, e?.message); summary[`resolve_error_${g.key}`] = e?.message; }
    } else if (g.present && existing) {
      try { await sb.from("deal_risks").update({ evidence: g.evidence, observed_at: new Date().toISOString() }).eq("id", existing.id); } catch (_) { /* non-fatal */ }
    }
  }

  // ── Module suggestions (rules over discovery facts; SC confirms) ──
  // AI only ever sets suggested_by_ai on rows it creates — it never touches
  // a module the SC has already acted on, and never un-suggests.
  try {
    const sizing = sizingR.data || null;
    const SIZING_KEY = { entity_count: "entity_count", total_users: "full_users", reporting_readonly_users: "view_only_users", bills_per_period: "ap_invoices_monthly", fixed_asset_count: "fixed_assets", warehouse_count: "warehouse_count" } as Record<string, string>;
    const fieldValue = (key: string): unknown => {
      if (SIZING_KEY[key]) return sizing?.[SIZING_KEY[key]] ?? null;
      const v = (valuesR.data || []).find((r: any) => r.field_key === key);
      if (!v) return null;
      return v.value_number ?? v.value_boolean ?? v.value_json ?? v.value_text;
    };
    const checkRule = (r: any): boolean => {
      const val = fieldValue(r.field);
      switch (r.op) {
        case ">": return typeof val === "number" ? val > Number(r.value) : Number(val) > Number(r.value);
        case "in": return Array.isArray(r.value) && r.value.includes(String(val ?? "").toLowerCase());
        case "true": return val === true || String(val).toLowerCase() === "true" || String(val).toLowerCase() === "yes";
        case "nonempty": return Array.isArray(val) ? val.length > 0 : !!String(val ?? "").trim();
        case "answered": return val !== null && val !== undefined && String(val).trim() !== "" && String(val).toLowerCase() !== "unknown";
        case "multi": return Array.isArray(val) ? val.length > 1 : /,| and /i.test(String(val ?? ""));
        default: return false;
      }
    };
    const existing = new Set((dealModsR.data || []).map((m: any) => m.module_key));
    const suggested: string[] = [];
    for (const mod of (moduleRefR.data || [])) {
      if (existing.has(mod.module_key)) continue;
      const rules = mod.suggestion_rules?.any || [];
      const hit = rules.find((r: any) => { try { return checkRule(r); } catch (_) { return false; } });
      if (!hit) continue;
      const { error } = await sb.from("deal_modules").insert({
        org_id: deal.org_id, deal_id: dealId, module_key: mod.module_key,
        is_recommended: false, suggested_by_ai: true,
        recommended_reason: `${hit.field} = ${JSON.stringify(fieldValue(hit.field))}`,
      });
      if (!error) suggested.push(mod.module_key);
    }
    if (suggested.length) summary.modules_suggested = suggested;
  } catch (e: any) { console.error("compute-deal-risks v1: module suggestions:", e?.message); }

  // ── Qualifying-spine flag ──
  const spineMissing = ceScore === 0 && catScore === 0 && !orientationValue;
  try {
    const { data: flag } = await sb.from("deal_flags").select("id, resolved").eq("deal_id", dealId).eq("description", SPINE_FLAG).maybeSingle();
    if (spineMissing && !flag) {
      await sb.from("deal_flags").insert({ deal_id: dealId, flag_type: "red", description: SPINE_FLAG, category: "fit", severity: "critical", source: "computed" });
      summary.spine_flag = "raised";
    } else if (!spineMissing && flag && !flag.resolved) {
      await sb.from("deal_flags").update({ resolved: true, resolved_at: new Date().toISOString(), resolved_reason: "Spine evidence arrived (CE, catalyst, or orientation)." }).eq("id", flag.id);
      summary.spine_flag = "resolved";
    }
  } catch (e: any) { console.error("compute-deal-risks v1: spine flag:", e?.message); }

  return summary;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const body = await req.json().catch(() => ({}));

    // Auth: service-role bearer (internal chain), the shared cron secret
    // (pg_cron sweep — vault-stored, no service key in the database), or a
    // user JWT whose org owns the target. verify_jwt is false platform-wide.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    let callerOrg: string | null = null;
    if (!isCron && token !== SERVICE_KEY) {
      if (!token) return jr({ error: "compute-deal-risks v1: missing authorization" }, 401);
      const { data: u, error: uErr } = await sb.auth.getUser(token);
      if (uErr || !u?.user) return jr({ error: "compute-deal-risks v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).single();
      if (!prof?.org_id) return jr({ error: "compute-deal-risks v1: no org" }, 403);
      callerOrg = prof.org_id;
    }

    if (body.deal_id) {
      if (callerOrg) {
        const { data: d } = await sb.from("deals").select("org_id").eq("id", body.deal_id).maybeSingle();
        if (!d || d.org_id !== callerOrg) return jr({ error: "compute-deal-risks v1: not your org" }, 403);
      }
      const r = await computeForDeal(sb, body.deal_id);
      return jr({ success: true, version: "compute-deal-risks v1", ...r });
    }
    if (body.org_id) {
      if (callerOrg && callerOrg !== body.org_id) return jr({ error: "compute-deal-risks v1: not your org" }, 403);
      // Nightly sweep across active deals for one org.
      const { data: deals } = await sb.from("deals").select("id").eq("org_id", body.org_id)
        .not("stage", "in", "(closed_won,closed_lost,disqualified)");
      const results = [];
      for (const d of (deals || [])) results.push(await computeForDeal(sb, d.id));
      return jr({ success: true, version: "compute-deal-risks v1", deals: results.length });
    }
    if (body.all_orgs === true) {
      // Platform-wide nightly sweep — cron / service callers only.
      if (callerOrg) return jr({ error: "compute-deal-risks v1: all_orgs is cron/service only" }, 403);
      const { data: deals } = await sb.from("deals").select("id")
        .not("stage", "in", "(closed_won,closed_lost,disqualified)");
      let done = 0;
      for (const d of (deals || [])) { await computeForDeal(sb, d.id); done++; }
      return jr({ success: true, version: "compute-deal-risks v1", deals: done });
    }
    return jr({ error: "compute-deal-risks v1: deal_id or org_id required" }, 400);
  } catch (e: any) {
    console.error("compute-deal-risks v1 error:", e);
    return jr({ error: `compute-deal-risks v1: ${e?.message || e}` }, 500);
  }
});
