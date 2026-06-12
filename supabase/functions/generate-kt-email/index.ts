import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// generate-kt-email v1
// Assembles a knowledge-transfer email (AE -> SC) from structured deal data:
// company snapshot, drivers, quantified pains (+ linked metrics), answered
// discovery facts by section, open blockers, recommended/demoed modules,
// readiness. Plain language, FACTS ONLY — no hypotheses. Degrades gracefully
// on any sparse table. Saves a generated_emails draft and returns it for the
// existing email composer.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" }; }
function jr(d: unknown, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } }); }

async function claude(body: any): Promise<Response> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise(res => setTimeout(res, 1500 * Math.pow(2, i))); continue; }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" }, body: JSON.stringify(body) });
}

const arr = (r: any) => Array.isArray(r?.data) ? r.data : [];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    if (!ANTHROPIC_API_KEY) return jr({ error: "generate-kt-email v1: ANTHROPIC_API_KEY missing" }, 500);
    const { deal_id } = await req.json().catch(() => ({}));
    if (!deal_id) return jr({ error: "generate-kt-email v1: deal_id required" }, 400);

    const { data: deal } = await sb.from("deals").select("id, org_id, rep_id, company_name, stage, deal_value").eq("id", deal_id).maybeSingle();
    if (!deal) return jr({ error: "generate-kt-email v1: deal not found" }, 404);

    // Auth: service bearer (internal) or a user JWT in the deal's org.
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (token !== SERVICE_KEY) {
      if (!token) return jr({ error: "generate-kt-email v1: missing authorization" }, 401);
      const { data: u } = await sb.auth.getUser(token);
      if (!u?.user) return jr({ error: "generate-kt-email v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).maybeSingle();
      if (!prof || prof.org_id !== deal.org_id) return jr({ error: "generate-kt-email v1: not your org" }, 403);
    }

    // Gather — every query independent + tolerant.
    const [profile, analysis, pains, metrics, flat, readiness, risks, modules, moduleRef] = await Promise.all([
      sb.from("company_profile").select("overview, industry, revenue, employee_count, headquarters").eq("deal_id", deal_id).maybeSingle(),
      sb.from("deal_analysis").select("driving_factors, ideal_solution").eq("deal_id", deal_id).maybeSingle(),
      sb.from("deal_pain_points").select("pain_description, annual_cost, annual_hours, category").eq("deal_id", deal_id),
      sb.from("deal_metrics").select("label, value, unit, period").eq("deal_id", deal_id),
      sb.from("deal_field_values_flat").select("display_section, label, value_text").eq("deal_id", deal_id),
      sb.from("deal_readiness").select("coverage_pct, readiness_grade, open_blocker_count").eq("deal_id", deal_id).maybeSingle(),
      sb.from("deal_risks").select("risk_key, risk_description, severity").eq("deal_id", deal_id).eq("status", "open"),
      sb.from("deal_modules").select("module_key, is_recommended, is_demoed").eq("deal_id", deal_id).or("is_recommended.eq.true,is_demoed.eq.true"),
      sb.from("module_reference").select("module_key, name"),
    ]);

    // Resolve blocker plain names.
    const blockerRisks = arr(risks).filter((r: any) => r.severity === "critical" || r.severity === "high");
    let riskNames: Record<string, string> = {};
    const keys = [...new Set(blockerRisks.map((r: any) => r.risk_key).filter(Boolean))];
    if (keys.length) {
      const { data: rd } = await sb.from("risk_definitions").select("risk_key, plain_name").in("risk_key", keys);
      riskNames = Object.fromEntries((rd || []).map((r: any) => [r.risk_key, r.plain_name]));
    }
    const modName = Object.fromEntries(arr(moduleRef).map((m: any) => [m.module_key, m.name]));

    // Build a compact structured brief (facts only).
    const sections: Record<string, string[]> = {};
    for (const f of arr(flat)) {
      if (!f.value_text) continue;
      (sections[f.display_section || "Other"] ||= []).push(`${f.label}: ${f.value_text}`);
    }
    const brief = {
      company: { name: deal.company_name, stage: deal.stage, ...(profile.data || {}) },
      drivers: analysis.data?.driving_factors || null,
      quantified_pains: arr(pains).map((p: any) => ({ pain: p.pain_description, annual_cost: p.annual_cost, annual_hours: p.annual_hours })),
      metrics: arr(metrics).map((m: any) => `${m.label}: ${m.value}${m.unit ? " " + m.unit : ""}${m.period ? " / " + m.period : ""}`),
      discovery_by_section: sections,
      readiness: readiness.data ? { grade: readiness.data.readiness_grade, coverage_pct: readiness.data.coverage_pct } : null,
      open_blockers: blockerRisks.map((r: any) => (r.risk_key && riskNames[r.risk_key]) || r.risk_description),
      recommended_modules: arr(modules).filter((m: any) => m.is_recommended).map((m: any) => modName[m.module_key] || m.module_key),
      demoed_modules: arr(modules).filter((m: any) => m.is_demoed).map((m: any) => modName[m.module_key] || m.module_key),
    };

    const system = "You write internal knowledge-transfer emails from an Account Executive to a Solutions Consultant who is about to take over demo prep. Plain language, sentence case, no filler, no marketing tone. FACTS ONLY — never speculate, never include hypotheses or guesses. Use only the data provided; if a section is empty, omit it. Output strictly as JSON: {\"subject\": \"...\", \"body\": \"...\"}. The body is plain text with short labeled sections (Company, Why they're looking, Quantified pain, What we know, Open blockers, Modules to demo, Readiness). Keep it scannable.";
    const user = `Write the KT email from this deal brief. Omit any empty section.\n\n${JSON.stringify(brief, null, 2)}`;

    const cr = await claude({ model: "claude-sonnet-4-20250514", max_tokens: 2000, temperature: 0.2, system, messages: [{ role: "user", content: user }] });
    if (!cr.ok) return jr({ error: `generate-kt-email v1: Claude ${cr.status}` }, 502);
    const cd = await cr.json();
    const raw = (cd.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    let subject = `Knowledge transfer: ${deal.company_name}`;
    let body = raw;
    try {
      const m = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").match(/\{[\s\S]*\}/);
      if (m) { const p = JSON.parse(m[0]); subject = p.subject || subject; body = p.body || body; }
    } catch (_) { /* fall back to raw text body */ }

    let emailId: string | null = null;
    try {
      const { data: saved } = await sb.from("generated_emails").insert({
        deal_id, email_type: "knowledge_transfer", generated_by: deal.rep_id,
        subject, body, status: "draft", ai_model_used: "claude-sonnet-4-20250514",
        prompt_tokens: cd.usage?.input_tokens || null, completion_tokens: cd.usage?.output_tokens || null,
      }).select("id").single();
      emailId = saved?.id || null;
    } catch (e: any) { console.error("generate-kt-email v1: save failed:", e?.message); }

    return jr({ success: true, version: "generate-kt-email v1", email_id: emailId, subject, body });
  } catch (e: any) {
    console.error("generate-kt-email v1 error:", e);
    return jr({ error: `generate-kt-email v1: ${e?.message || e}` }, 500);
  }
});
