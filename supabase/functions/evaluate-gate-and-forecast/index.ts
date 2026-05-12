// evaluate-gate-and-forecast v1
//
// Sage canon Path to Close evaluator. Given a deal_id (optionally a triggering conversation_id),
// evaluates every gate criterion for the deal's current stage, recomputes the glass-box
// confidence (6-factor breakdown), and writes an immutable forecast prediction row.
//
// Conventions:
// - Every error message starts with "evaluate-gate-and-forecast v1: ..."
// - verify_jwt: false (set at deploy time); auth handled implicitly via service role
// - Uses assemble_coach_prompt RPC for the system prompt layer
// - Parallelizes per-criterion Claude evaluations with Promise.all
// - Sentiment factor is stubbed at 70 for v1 (TODO: real computation)
// - Calibration adjustment: org_forecast_accuracy lookup; defaults to +17 if no history (TODO: real lookup)
// - Logs to ai_response_log per project convention

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const VERSION = "evaluate-gate-and-forecast v1";

// Fixed dimension weights for the 6-factor confidence breakdown (sum to 100)
const DIMENSION_WEIGHTS: Record<string, number> = {
  need_fit: 20,
  power: 25,
  timeline: 20,
  budget: 15,
  hygiene: 10,
  sentiment: 10,
};
const STUB_SENTIMENT_SCORE_PCT = 70; // TODO: replace with real sentiment computation
const DEFAULT_CALIBRATION = 17;       // TODO: replace with real org_forecast_accuracy lookup

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jr(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
        .update({
          last_used_at: new Date().toISOString(),
          use_count: (existing.use_count ?? 0) + 1,
        })
        .eq("id", existing.id);
      return existing.id as string;
    }
    const { data: inserted, error } = await sb
      .from("assembled_prompt_versions")
      .insert({
        prompt_hash: hash,
        coach_id: coachId,
        call_type: callType,
        action,
        assembled_content: content,
      })
      .select("id")
      .single();
    if (error) {
      console.log(`${VERSION}: assembled_prompt_versions insert error`, error.message);
      return null;
    }
    return inserted?.id ?? null;
  } catch (e) {
    console.log(`${VERSION}: recordAssembledPrompt threw`, e);
    return null;
  }
}

async function callClaude(body: unknown, retries = 3): Promise<Response> {
  for (let i = 1; i <= retries; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) {
      await new Promise((res) => setTimeout(res, 2000 * Math.pow(2, i - 1)));
      continue;
    }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });
}

function stripJsonFences(s: string): string {
  return s
    .replace(/```json\s*/gi, "")
    .replace(/```\s*$/g, "")
    .replace(/```\s*/g, "")
    .trim();
}

interface Criterion {
  id: string;
  dimension: string;
  criterion_key: string;
  criterion_title: string;
  criterion_description: string | null;
  criterion_anti_patterns: string[] | null;
  weight: number;
  required_to_advance_from: string;
  required_to_advance_to: string;
}

interface CriterionEvaluation {
  state: "met" | "partial" | "open" | "not_applicable";
  evidence_quote: string | null;
  source_speaker: string | null;
  suggested_action: string | null;
}

async function evaluateOneCriterion(
  criterion: Criterion,
  systemPrompt: string,
  dealContext: string,
  coverageBlock: string,
  model: string,
  temperature: number,
): Promise<CriterionEvaluation> {
  const antiPatterns = (criterion.criterion_anti_patterns ?? []).filter(Boolean);
  const apBlock = antiPatterns.length === 0
    ? "(no anti-patterns specified)"
    : antiPatterns.map((a, i) => `${i + 1}. ${a}`).join("\n");

  const userMessage = [
    `# Criterion to evaluate`,
    `**Dimension:** ${criterion.dimension}`,
    `**Title:** ${criterion.criterion_title}`,
    `**Description:** ${criterion.criterion_description ?? "(none)"}`,
    ``,
    `## Anti-patterns (DO NOT mark "met" if any of these apply)`,
    apBlock,
    ``,
    `## State definitions`,
    `- "met": clear evidence the criterion is satisfied; no anti-patterns triggered.`,
    `- "partial": some evidence exists but it is weak, indirect, or only partially covers what the criterion requires.`,
    `- "open": no evidence, or evidence is contradicted by anti-patterns, or this has not yet been addressed.`,
    `- "not_applicable": this criterion legitimately does not apply to this deal (rare — only when the deal context makes it irrelevant).`,
    ``,
    `# Deal context`,
    dealContext,
    ``,
    `# Per-call must-have coverage (informs criterion evidence)`,
    coverageBlock,
    ``,
    `# Output`,
    `Return JSON only, no prose, no fences. Shape:`,
    `{`,
    `  "state": "met" | "partial" | "open" | "not_applicable",`,
    `  "evidence_quote": "<verbatim quote from a transcript or context that supports the state, or null>",`,
    `  "source_speaker": "<who said it, or null>",`,
    `  "suggested_action": "<one-sentence concrete next action the AE should take to close this gap, or null if state is 'met'>"`,
    `}`,
  ].join("\n");

  try {
    const cr = await callClaude({
      model,
      max_tokens: 600,
      temperature,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    if (!cr.ok) {
      const errText = await cr.text().catch(() => "");
      console.log(`${VERSION}: criterion ${criterion.criterion_key} Claude API ${cr.status}: ${errText.substring(0, 200)}`);
      return { state: "open", evidence_quote: null, source_speaker: null, suggested_action: null };
    }
    const claudeData = await cr.json();
    const raw = ((claudeData.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");
    const cleaned = stripJsonFences(raw);
    const parsed = JSON.parse(cleaned) as Partial<CriterionEvaluation>;
    const state = parsed.state;
    if (state !== "met" && state !== "partial" && state !== "open" && state !== "not_applicable") {
      return { state: "open", evidence_quote: null, source_speaker: null, suggested_action: null };
    }
    return {
      state,
      evidence_quote: typeof parsed.evidence_quote === "string" ? parsed.evidence_quote : null,
      source_speaker: typeof parsed.source_speaker === "string" ? parsed.source_speaker : null,
      suggested_action: typeof parsed.suggested_action === "string" ? parsed.suggested_action : null,
    };
  } catch (e) {
    console.log(`${VERSION}: criterion ${criterion.criterion_key} threw`, e instanceof Error ? e.message : e);
    return { state: "open", evidence_quote: null, source_speaker: null, suggested_action: null };
  }
}

function computeConfidenceFactors(
  criteria: Criterion[],
  evals: Map<string, CriterionEvaluation>,
): {
  factors: Array<{ dimension: string; weight: number; score_pct: number; contribution: number; state: string }>;
  raw_score: number;
  biggest_lever_dimension: string;
  biggest_lever_potential: number;
} {
  const byDim: Record<string, { met: number; partial: number; total: number }> = {
    need_fit: { met: 0, partial: 0, total: 0 },
    power: { met: 0, partial: 0, total: 0 },
    timeline: { met: 0, partial: 0, total: 0 },
    budget: { met: 0, partial: 0, total: 0 },
    hygiene: { met: 0, partial: 0, total: 0 },
  };
  for (const c of criteria) {
    const e = evals.get(c.id);
    if (!e || e.state === "not_applicable") continue;
    const bucket = byDim[c.dimension];
    if (!bucket) continue;
    bucket.total += 1;
    if (e.state === "met") bucket.met += 1;
    else if (e.state === "partial") bucket.partial += 1;
  }

  const factors: Array<{ dimension: string; weight: number; score_pct: number; contribution: number; state: string }> = [];
  let raw_score = 0;
  let biggest_lever_dimension = "need_fit";
  let biggest_lever_potential = 0;

  for (const dim of ["need_fit", "power", "timeline", "budget", "hygiene"] as const) {
    const b = byDim[dim];
    const weight = DIMENSION_WEIGHTS[dim];
    const score_pct = b.total === 0 ? 0 : Math.round(((b.met + 0.5 * b.partial) / b.total) * 100);
    const contribution = Math.round((weight * score_pct) / 100);
    raw_score += contribution;
    const state = score_pct >= 80 ? "strong" : score_pct >= 40 ? "partial" : "gap";
    factors.push({ dimension: dim, weight, score_pct, contribution, state });

    const potential_gain = weight - contribution; // headroom if this dim went to 100%
    if (potential_gain > biggest_lever_potential) {
      biggest_lever_potential = potential_gain;
      biggest_lever_dimension = dim;
    }
  }

  // Sentiment (stubbed at 70 for v1)
  const sentimentWeight = DIMENSION_WEIGHTS.sentiment;
  const sentimentContribution = Math.round((sentimentWeight * STUB_SENTIMENT_SCORE_PCT) / 100);
  raw_score += sentimentContribution;
  factors.push({
    dimension: "sentiment",
    weight: sentimentWeight,
    score_pct: STUB_SENTIMENT_SCORE_PCT,
    contribution: sentimentContribution,
    state: STUB_SENTIMENT_SCORE_PCT >= 80 ? "strong" : STUB_SENTIMENT_SCORE_PCT >= 40 ? "partial" : "gap",
  });

  return { factors, raw_score, biggest_lever_dimension, biggest_lever_potential };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error(`${VERSION}: ANTHROPIC_API_KEY not configured`);
    }

    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const deal_id = reqBody.deal_id as string | undefined;
    const conversation_id = (reqBody.conversation_id as string | undefined) ?? null;
    const triggered_by = (reqBody.triggered_by as string | undefined) ?? "manual";
    if (!deal_id) throw new Error(`${VERSION}: deal_id required`);

    // 1. Load deal
    const { data: deal, error: dErr } = await sb
      .from("deals")
      .select("id, org_id, rep_id, stage, target_close_date, company_name, cmrr")
      .eq("id", deal_id)
      .maybeSingle();
    if (dErr) throw new Error(`${VERSION}: deals select error: ${dErr.message}`);
    if (!deal) throw new Error(`${VERSION}: deal_id not found: ${deal_id}`);

    const stage = deal.stage as string;
    const orgId = deal.org_id as string;
    if (!orgId) throw new Error(`${VERSION}: deal ${deal_id} has no org_id`);

    // 2. Locate active coach for the org (first active coach for this org)
    const { data: coach, error: cErr } = await sb
      .from("coaches")
      .select("id, name, model, temperature")
      .eq("org_id", orgId)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (cErr) throw new Error(`${VERSION}: coach lookup error: ${cErr.message}`);
    if (!coach) throw new Error(`${VERSION}: no active coach for org ${orgId}`);

    // 3. Load gate criteria for this stage's outbound transition
    const { data: criteriaRaw, error: gErr } = await sb
      .from("coach_gate_criteria")
      .select("id, dimension, criterion_key, criterion_title, criterion_description, criterion_anti_patterns, weight, required_to_advance_from, required_to_advance_to, sort_order")
      .eq("coach_id", coach.id)
      .eq("required_to_advance_from", stage)
      .order("sort_order", { ascending: true });
    if (gErr) throw new Error(`${VERSION}: coach_gate_criteria select error: ${gErr.message}`);
    const criteria = (criteriaRaw ?? []) as Criterion[];

    if (criteria.length === 0) {
      return jr({
        success: true,
        version: "v1",
        deal_id,
        stage,
        message: "No gate criteria defined for this stage. No forecast computed.",
      });
    }

    // 4. Load deal context (compact summary)
    const { data: structuredCtx } = await sb.rpc("get_deal_context_structured", { p_deal_id: deal_id });
    const dealContextText = typeof structuredCtx === "string"
      ? structuredCtx
      : JSON.stringify(structuredCtx ?? {}, null, 2).substring(0, 8000);

    // 5. Load must-have coverage (informs evidence)
    const { data: coverageRows } = await sb
      .from("conversation_must_have_coverage")
      .select("coverage_state, evidence_quote, evidence_speaker, must_have_id, coach_call_type_must_haves(title, call_type, section)")
      .eq("deal_id", deal_id);
    const coverageBlock = (coverageRows ?? []).length === 0
      ? "(no must-have coverage data yet)"
      : (coverageRows ?? []).slice(0, 50).map((c: Record<string, unknown>) => {
          const mh = c.coach_call_type_must_haves as { title?: string; call_type?: string; section?: string } | null;
          return `- [${mh?.call_type ?? "?"} / ${mh?.section ?? "?"}] ${mh?.title ?? "?"} = ${c.coverage_state}` +
            (c.evidence_quote ? ` (evidence: "${String(c.evidence_quote).substring(0, 160)}")` : "");
        }).join("\n");

    // 6. Assemble system prompt
    const { data: assembled, error: rpcErr } = await sb.rpc("assemble_coach_prompt", {
      p_coach_id: coach.id,
      p_call_type: null,
      p_action: "process_transcript",
    });
    if (rpcErr) throw new Error(`${VERSION}: assemble_coach_prompt RPC error: ${rpcErr.message}`);
    const systemPrompt = typeof assembled === "string" && assembled.length > 50
      ? assembled
      : "You are a Sage Intacct sales methodology evaluator. Apply Sage canon strictly.";
    await recordAssembledPrompt(sb, coach.id as string, null, "evaluate_gate", systemPrompt);

    // 7. Parallel evaluate each criterion
    const model = (coach.model as string) || "claude-sonnet-4-5";
    const temperature = Number(coach.temperature ?? 0.2);
    const claudeStart = Date.now();
    const evalResults = await Promise.all(
      criteria.map((c) => evaluateOneCriterion(c, systemPrompt, dealContextText, coverageBlock, model, temperature)),
    );
    const claudeMs = Date.now() - claudeStart;

    const evalsMap = new Map<string, CriterionEvaluation>();
    criteria.forEach((c, i) => evalsMap.set(c.id, evalResults[i]));

    // 8. Upsert deal_gate_criteria_state for each criterion
    const sourceConversationId = conversation_id;
    const upsertRows = criteria.map((c) => {
      const e = evalsMap.get(c.id)!;
      return {
        deal_id,
        org_id: orgId,
        criterion_id: c.id,
        state: e.state,
        evidence_quote: e.evidence_quote,
        source_conversation_id: sourceConversationId,
        source_speaker: e.source_speaker,
        source_date: new Date().toISOString().substring(0, 10),
        suggested_action: e.suggested_action,
        ai_generated: true,
        last_evaluated_at: new Date().toISOString(),
      };
    });
    const { error: upErr } = await sb
      .from("deal_gate_criteria_state")
      .upsert(upsertRows, { onConflict: "deal_id,criterion_id" });
    if (upErr) {
      console.log(`${VERSION}: deal_gate_criteria_state upsert error`, upErr.message);
    }

    // 9. Compute confidence
    const { factors, raw_score, biggest_lever_dimension, biggest_lever_potential } = computeConfidenceFactors(criteria, evalsMap);

    // Calibration adjustment — pull latest org_forecast_accuracy or default +17
    let calibration_adjustment = DEFAULT_CALIBRATION;
    try {
      const { data: accRow } = await sb
        .from("org_forecast_accuracy")
        .select("prediction_error_pct")
        .eq("org_id", orgId)
        .order("period_end", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (accRow?.prediction_error_pct != null) {
        // If org under-predicts (prediction_error_pct < 0), bump up. If over-predicts, bring down.
        // For v1, simple inversion of the error pct (capped to +/- 30).
        const errPct = Number(accRow.prediction_error_pct);
        calibration_adjustment = Math.max(-30, Math.min(30, Math.round(-errPct)));
      }
    } catch (_e) {
      // TODO: real lookup
    }

    const final_confidence = Math.max(0, Math.min(100, raw_score + calibration_adjustment));

    // 10. Insert new immutable forecast prediction row
    const featureSnapshot = {
      stage,
      target_close_date: deal.target_close_date,
      criterion_count: criteria.length,
      evaluated_by_call: conversation_id,
      triggered_by,
    };
    const { error: insErr } = await sb.from("deal_forecast_predictions").insert({
      deal_id,
      org_id: orgId,
      rep_id: deal.rep_id,
      predicted_at: new Date().toISOString(),
      prediction_horizon: stage,
      prediction_source: "evaluate-gate-and-forecast",
      model_version: "v1",
      predicted_close_date: deal.target_close_date,
      confidence_score: final_confidence,
      confidence_factors: { factors },
      raw_score,
      calibration_adjustment,
      biggest_lever_dimension,
      biggest_lever_potential,
      feature_snapshot: featureSnapshot,
      reasoning: `Computed by evaluate-gate-and-forecast v1 for stage=${stage}. Raw=${raw_score}, calibration=${calibration_adjustment}, final=${final_confidence}. Biggest lever: ${biggest_lever_dimension} (potential +${biggest_lever_potential}).`,
    });
    if (insErr) {
      console.log(`${VERSION}: deal_forecast_predictions insert error`, insErr.message);
    }

    // 11. Log
    try {
      await sb.from("ai_response_log").insert({
        org_id: orgId,
        deal_id,
        function_name: "evaluate-gate-and-forecast",
        function_version: "v1",
        model,
        latency_ms: claudeMs,
        success: true,
        metadata: {
          stage,
          criterion_count: criteria.length,
          final_confidence,
          raw_score,
          calibration_adjustment,
          biggest_lever_dimension,
          triggered_by,
          conversation_id,
        },
      });
    } catch (_e) {
      // best-effort
    }

    return jr({
      success: true,
      version: "v1",
      deal_id,
      stage,
      final_confidence,
      raw_score,
      calibration_adjustment,
      biggest_lever_dimension,
      biggest_lever_potential,
      criterion_count: criteria.length,
      evaluations: criteria.map((c, i) => ({
        criterion_key: c.criterion_key,
        dimension: c.dimension,
        state: evalResults[i].state,
      })),
      total_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(VERSION, msg);
    return jr({ success: false, version: "v1", error: msg }, 500);
  }
});
