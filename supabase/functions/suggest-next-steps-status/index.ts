// suggest-next-steps-status v1
//
// Lumen's red/green suggestion for the next-steps state of a deal. Applies Sage Forecasting
// v5.2 rules. NEVER touches deals.next_steps_color (the AE's choice) — only writes to the
// next_steps_ai_* columns.
//
// Conventions:
// - Every error message starts with "suggest-next-steps-status v1: ..."
// - verify_jwt: false
// - Uses assemble_coach_prompt RPC for the system prompt
// - Logs to ai_response_log

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERSION = "suggest-next-steps-status v1";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...cors(), "Content-Type": "application/json" } });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function recordAssembledPrompt(
  sb: ReturnType<typeof createClient>,
  coachId: string,
  callType: string | null,
  action: string,
  content: string,
): Promise<string | null> {
  try {
    const hash = await sha256Hex(content);
    const { data: existing } = await sb
      .from("assembled_prompt_versions")
      .select("id, use_count")
      .eq("prompt_hash", hash)
      .limit(1)
      .maybeSingle();
    if (existing?.id) {
      await sb
        .from("assembled_prompt_versions")
        .update({ last_used_at: new Date().toISOString(), use_count: (existing.use_count ?? 0) + 1 })
        .eq("id", existing.id);
      return existing.id as string;
    }
    const { data: inserted } = await sb
      .from("assembled_prompt_versions")
      .insert({ prompt_hash: hash, coach_id: coachId, call_type: callType, action, assembled_content: content })
      .select("id").single();
    return inserted?.id ?? null;
  } catch (_e) {
    return null;
  }
}

async function callClaude(body: unknown, retries = 3): Promise<Response> {
  for (let i = 1; i <= retries; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise((res) => setTimeout(res, 2000 * Math.pow(2, i - 1))); continue; }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
}

function stripJsonFences(s: string): string {
  return s.replace(/```json\s*/gi, "").replace(/```\s*$/g, "").replace(/```\s*/g, "").trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) throw new Error(`${VERSION}: ANTHROPIC_API_KEY not configured`);

    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const deal_id = reqBody.deal_id as string | undefined;
    if (!deal_id) throw new Error(`${VERSION}: deal_id required`);

    // 1. Load deal + state
    const { data: deal, error: dErr } = await sb
      .from("deals")
      .select("id, org_id, rep_id, stage, target_close_date, company_name, cmrr, next_steps, next_steps_color, stage_changed_at")
      .eq("id", deal_id).maybeSingle();
    if (dErr) throw new Error(`${VERSION}: deals select error: ${dErr.message}`);
    if (!deal) throw new Error(`${VERSION}: deal_id not found: ${deal_id}`);

    const orgId = deal.org_id as string;
    if (!orgId) throw new Error(`${VERSION}: deal ${deal_id} has no org_id`);

    // 2. Last conversation
    const { data: lastConv } = await sb
      .from("conversations")
      .select("id, call_type, call_date, created_at")
      .eq("deal_id", deal_id)
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    // 3. MSP status
    const { data: portal } = await sb
      .from("msp_customer_portals")
      .select("id, prospect_agreed_flag, target_close_date")
      .eq("deal_id", deal_id).maybeSingle();

    // 4. Latest forecast prediction
    const { data: latestForecast } = await sb
      .from("deal_forecast_predictions")
      .select("confidence_score, biggest_lever_dimension, predicted_at")
      .eq("deal_id", deal_id)
      .order("predicted_at", { ascending: false })
      .limit(1).maybeSingle();

    // 5. Open gate criteria summary
    const { data: openBarriers } = await sb
      .from("deal_open_barriers_v")
      .select("dimension, criterion_title, state, impact_score")
      .eq("deal_id", deal_id)
      .order("impact_score", { ascending: false })
      .limit(8);

    // 6. Active deal_risks
    const { data: risks } = await sb
      .from("deal_risks")
      .select("risk_type, risk_description, severity")
      .eq("deal_id", deal_id)
      .neq("status", "resolved")
      .order("created_at", { ascending: false })
      .limit(10);

    // 7. Active coach
    const { data: coach, error: cErr } = await sb
      .from("coaches")
      .select("id, model, temperature")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (cErr) throw new Error(`${VERSION}: coach lookup error: ${cErr.message}`);
    if (!coach) throw new Error(`${VERSION}: no active coach for org ${orgId}`);

    // 8. Assemble system prompt
    const { data: assembled } = await sb.rpc("assemble_coach_prompt", {
      p_coach_id: coach.id, p_call_type: null, p_action: "process_transcript",
    });
    const systemBase = typeof assembled === "string" && assembled.length > 50
      ? assembled
      : "You are a Sage Intacct sales coach.";

    const sageRules = [
      "",
      "# Sage Forecasting v5.2 Red/Green Rules",
      "",
      "## RED signals (any of these = red)",
      "- Trending poorly: stage decay, no progression, missed target dates",
      "- Functional gap: prospect's must-have requirements not satisfiable by Intacct",
      "- Lack of access to power: EB never engaged on a Lumen call",
      "- Competitive bias: prospect anchored to a competitor, not Intacct",
      "- Poor timing: timeline doesn't tie to compelling event, dates are vague or have slipped",
      "- Business conditions: prospect's business is contracting, layoffs, frozen budgets",
      "",
      "## GREEN signals (need a meaningful set of these)",
      "- Trending well: stage progression, MSP active and updated, recent meaningful activity",
      "- Good product fit: functional fit confirmed, demo well-received",
      "- Prior Intacct experience or strong industry fit",
      "- Access to power: EB engaged on a Lumen call, decision criteria validated with EB",
      "- Customer engaged: champion is engaged, prospect responsive, prospect agreed on MSP",
      "- Good timing: dates tied to compelling event, backed into go-live properly",
    ].join("\n");
    const systemPrompt = systemBase + "\n\n" + sageRules;
    await recordAssembledPrompt(sb, coach.id as string, null, "suggest_next_steps_status", systemPrompt);

    // 9. Build user message
    const userMessage = [
      `# Deal state`,
      `Company: ${deal.company_name ?? "Unknown"}`,
      `Stage: ${deal.stage}`,
      `CMRR: $${deal.cmrr ?? 0}`,
      `Target close date: ${deal.target_close_date ?? "Unknown"}`,
      `AE's current red/green: ${deal.next_steps_color ?? "(not set)"}`,
      `AE's next steps text: ${deal.next_steps ?? "(empty)"}`,
      `Stage changed at: ${deal.stage_changed_at ?? "Unknown"}`,
      ``,
      `# Latest forecast confidence`,
      latestForecast
        ? `${latestForecast.confidence_score}% — biggest lever: ${latestForecast.biggest_lever_dimension ?? "?"}`
        : `(no forecast yet)`,
      ``,
      `# MSP`,
      portal ? `Portal exists. Prospect agreed: ${portal.prospect_agreed_flag}. MSP target close: ${portal.target_close_date ?? "(none)"}` : `(no MSP portal)`,
      ``,
      `# Last conversation`,
      lastConv ? `${lastConv.call_type ?? "?"} on ${lastConv.call_date ?? lastConv.created_at}` : `(no conversations)`,
      ``,
      `# Open gate barriers (top 8 by impact)`,
      (openBarriers ?? []).length === 0 ? "(none)" : (openBarriers ?? []).map((b: Record<string, unknown>) =>
        `- [${b.dimension}] ${b.criterion_title} = ${b.state} (impact ${b.impact_score})`,
      ).join("\n"),
      ``,
      `# Active deal risks`,
      (risks ?? []).length === 0 ? "(none)" : (risks ?? []).map((r: Record<string, unknown>) =>
        `- [${r.severity}] ${r.risk_type ?? "general"}: ${r.risk_description}`,
      ).join("\n"),
      ``,
      `# Output`,
      `Apply the Sage Forecasting v5.2 Red/Green rules to this deal state. Return JSON only, no fences:`,
      `{`,
      `  "status": "red" | "green",`,
      `  "reasoning": "<2-4 sentences explaining the call. Reference specific signals from the deal state.>"`,
      `}`,
    ].join("\n");

    // 10. Call Claude
    const model = (coach.model as string) || "claude-sonnet-4-5";
    const temperature = Number(coach.temperature ?? 0.2);
    const claudeStart = Date.now();
    const cr = await callClaude({
      model, max_tokens: 600, temperature, system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    const claudeMs = Date.now() - claudeStart;
    if (!cr.ok) {
      const errText = await cr.text().catch(() => "");
      throw new Error(`${VERSION}: Claude API ${cr.status}: ${errText.substring(0, 300)}`);
    }
    const claudeData = await cr.json();
    const raw = ((claudeData.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");

    let parsed: { status?: string; reasoning?: string };
    try {
      parsed = JSON.parse(stripJsonFences(raw));
    } catch (e) {
      throw new Error(`${VERSION}: JSON parse failure: ${e instanceof Error ? e.message : String(e)}. Raw[0..300]: ${raw.substring(0, 300)}`);
    }
    if (parsed.status !== "red" && parsed.status !== "green") {
      throw new Error(`${VERSION}: invalid status: ${JSON.stringify(parsed.status)}`);
    }
    const aiStatus = parsed.status as "red" | "green";
    const aiReasoning = String(parsed.reasoning ?? "").trim();

    // 11. Write to next_steps_ai_* — NEVER touch next_steps_color
    const { error: updErr } = await sb
      .from("deals")
      .update({
        next_steps_ai_status: aiStatus,
        next_steps_ai_reasoning: aiReasoning,
        next_steps_ai_evaluated_at: new Date().toISOString(),
      })
      .eq("id", deal_id);
    if (updErr) throw new Error(`${VERSION}: deals update failed: ${updErr.message}`);

    // 12. Log
    try {
      await sb.from("ai_response_log").insert({
        org_id: orgId, deal_id, function_name: "suggest-next-steps-status", function_version: "v1",
        model, latency_ms: claudeMs, success: true,
        metadata: { ai_status: aiStatus, ae_status: deal.next_steps_color, stage: deal.stage },
      });
    } catch (_e) { /* best-effort */ }

    return jr({
      success: true, version: "v1", deal_id,
      ai_status: aiStatus, ai_reasoning: aiReasoning,
      ae_color_unchanged: deal.next_steps_color, total_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(VERSION, msg);
    return jr({ success: false, version: "v1", error: msg }, 500);
  }
});
