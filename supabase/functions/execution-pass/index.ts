import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// execution-pass v1 (extraction overhaul Phase 6)
// The coaching extraction dimension — observations about HOW the rep/SC ran
// the call, distinct from deal facts. Every observation carries transcript
// evidence. Writes first-class rows (call_questions, call_moments) and
// call-level metrics onto call_analyses. Idempotent: re-running replaces the
// conversation's question/moment rows.
//
// Timestamp dependency: per-turn timestamps are absent in our normalized
// transcripts, so pause detection degrades to verbal markers and talk ratio
// uses word counts — the basis is labeled on the row (talk_ratio_basis).
//
// Also regenerates the Business Drivers summary (deterministic synthesis
// over verified CEs + catalysts + driving_factors — no model output becomes
// a fact) after qdc / functional_discovery calls, respecting human edits via
// the suggest-don't-overwrite rule.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

async function claude(body: any): Promise<Response> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise((res) => setTimeout(res, 2000 * Math.pow(2, i))); continue; }
    return r;
  }
  return fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(body),
  });
}

const CONTRACT = `Analyze HOW the rep ran this call (execution, not deal facts). Return ONLY JSON:
{
 "questions": [{"question_text": "verbatim question", "asked_by": "rep|sc", "types": ["open|closed|leading|quantifying|impact|layering|confirming|stacked"], "topic": "short topic", "turn_index": 0}],
 "moments": [
   {"moment_type": "nugget_missed", "quote": "verbatim prospect statement that deserved a follow-up", "speaker": "", "turn_index": 0, "severity_rank": 1, "payload": {"should_have_asked": "the question the rep should have asked"}},
   {"moment_type": "thinking_pause", "quote": "verbal marker (um, let me think, long silence note)", "speaker": "", "turn_index": 0, "payload": {"basis": "verbal_marker"}},
   {"moment_type": "objection", "quote": "verbatim objection", "speaker": "", "turn_index": 0, "payload": {"handling": "addressed|deflected|ignored", "handling_quote": "how the rep responded"}},
   {"moment_type": "confirmation_loop", "quote": "rep restating + prospect confirming/correcting", "speaker": "", "turn_index": 0, "payload": {"outcome": "confirmed|corrected", "corrected_to": "value when corrected or null"}}
 ],
 "call_metrics": {
   "talk_ratio": 0.0, "talk_ratio_basis": "word_count",
   "longest_monologue_words": 0, "longest_monologue_speaker": "rep|prospect",
   "open_closed_ratio": 0.0, "agenda_upfront": false,
   "bant_coverage": {"budget": false, "authority": false, "need": false, "timeline": false},
   "next_step_grade": "A|B|C|D|F", "next_step_quote": "the closing next-step language or null",
   "tieback_ratio": null,
   "depth_summary": {"<topic>": "surface|probed|deep"}
 }
}
RULES: every row carries verbatim transcript evidence. turn_index = 0-based turn number. severity_rank orders nuggets by importance (1 = most costly miss). tieback_ratio only for demo calls (feature-shown -> tied back to stated pain). talk_ratio = rep words / total words. Grade next steps: A = specific, dated, mutual; F = none.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const conversationId = body.conversation_id;
    if (!conversationId) return jr({ error: "execution-pass v1: conversation_id missing" }, 400);

    const { data: conv } = await sb.from("conversations").select("*").eq("id", conversationId).single();
    if (!conv) return jr({ error: "execution-pass v1: conversation not found" }, 404);
    if (!conv.transcript || conv.transcript.length < 100) return jr({ error: "execution-pass v1: transcript too short" }, 422);
    const { data: deal } = await sb.from("deals").select("id, org_id, company_name").eq("id", conv.deal_id).single();
    if (!deal) return jr({ error: "execution-pass v1: deal not found" }, 404);

    // Auth: service-role bearer (internal chain), the vault-backed cron
    // secret, or a user JWT in the deal's org.
    const cronSecret = Deno.env.get("CRON_SECRET");
    const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!isCron && token !== SERVICE_KEY) {
      if (!token) return jr({ error: "execution-pass v1: missing authorization" }, 401);
      const { data: u, error: uErr } = await sb.auth.getUser(token);
      if (uErr || !u?.user) return jr({ error: "execution-pass v1: invalid token" }, 401);
      const { data: prof } = await sb.from("profiles").select("org_id").eq("id", u.user.id).single();
      if (!prof || prof.org_id !== deal.org_id) return jr({ error: "execution-pass v1: not your org" }, 403);
    }

    let raw: string | null = null;
    if (body.reuse_raw === true) {
      raw = conv.metadata?.execution_pass?.raw || null;
      if (!raw) return jr({ error: "execution-pass v1: no stored raw to reuse" }, 404);
    } else {
      try {
        const { data: credits } = await sb.rpc("check_credits", { p_org_id: deal.org_id, p_required: 1 });
        if (credits && credits.allowed === false) return jr({ error: "execution-pass v1: insufficient credits" }, 402);
      } catch (_) { /* tolerated */ }
      if (!ANTHROPIC_API_KEY) return jr({ error: "execution-pass v1: no API key" }, 500);

      const cr = await claude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        temperature: 0,
        system: "You are Lumen's call-execution analyst. You evaluate how the call was run, with verbatim evidence for every observation. You return only JSON.",
        messages: [{ role: "user", content: `CALL: type=${conv.call_type}, date=${conv.call_date}, company=${deal.company_name}\n\nTRANSCRIPT:\n${conv.transcript}\n\n${CONTRACT}` }],
      });
      if (!cr.ok) return jr({ error: `execution-pass v1: Claude ${cr.status}` }, 502);
      const cd = await cr.json();
      raw = (cd.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      try {
        const meta = { ...(conv.metadata || {}), execution_pass: { raw, at: new Date().toISOString(), version: "v1" } };
        await sb.from("conversations").update({ metadata: meta }).eq("id", conversationId);
      } catch (e: any) { console.error("execution-pass v1: raw persist failed:", e?.message); }
    }

    let out: any;
    try {
      const cleaned = (raw || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("no JSON");
      out = JSON.parse(m[0]);
    } catch (e: any) {
      return jr({ error: `execution-pass v1: parse failed: ${e?.message}` }, 422);
    }

    // Idempotent: replace this conversation's execution rows.
    await sb.from("call_questions").delete().eq("conversation_id", conversationId);
    await sb.from("call_moments").delete().eq("conversation_id", conversationId);

    const sum: any = { version: "execution-pass v1", questions: 0, moments: 0 };
    for (const q of (out.questions || [])) {
      if (!q?.question_text) continue;
      try {
        const { error } = await sb.from("call_questions").insert({
          org_id: deal.org_id, conversation_id: conversationId, deal_id: deal.id,
          question_text: q.question_text, asked_by: q.asked_by === "sc" ? "sc" : "rep",
          types: Array.isArray(q.types) ? q.types : [], topic: q.topic || null,
          turn_index: Number.isInteger(q.turn_index) ? q.turn_index : null,
        });
        if (error) throw error;
        sum.questions++;
      } catch (e: any) { console.error("execution-pass v1: question insert:", e?.message); }
    }
    for (const m of (out.moments || [])) {
      if (!m?.moment_type || !m?.quote) continue;
      try {
        const { error } = await sb.from("call_moments").insert({
          org_id: deal.org_id, conversation_id: conversationId, deal_id: deal.id,
          moment_type: m.moment_type, quote: m.quote, speaker: m.speaker || null,
          turn_index: Number.isInteger(m.turn_index) ? m.turn_index : null,
          severity_rank: Number.isInteger(m.severity_rank) ? m.severity_rank : null,
          payload: m.payload || null,
        });
        if (error) throw error;
        sum.moments++;
      } catch (e: any) { console.error("execution-pass v1: moment insert:", e?.message); }
    }

    // Call-level metrics onto call_analyses (update the analysis row if
    // process-transcript made one; create a minimal row otherwise).
    const cm = out.call_metrics || {};
    const metricCols: any = {
      talk_ratio: typeof cm.talk_ratio === "number" ? cm.talk_ratio : null,
      talk_ratio_basis: cm.talk_ratio_basis || "word_count",
      longest_monologue_words: Number.isInteger(cm.longest_monologue_words) ? cm.longest_monologue_words : null,
      open_closed_ratio: typeof cm.open_closed_ratio === "number" ? cm.open_closed_ratio : null,
      agenda_upfront: typeof cm.agenda_upfront === "boolean" ? cm.agenda_upfront : null,
      bant_coverage: cm.bant_coverage || null,
      next_step_grade: typeof cm.next_step_grade === "string" ? cm.next_step_grade.slice(0, 2) : null,
      tieback_ratio: typeof cm.tieback_ratio === "number" ? cm.tieback_ratio : null,
      depth_summary: cm.depth_summary || null,
    };
    try {
      const { data: existing } = await sb.from("call_analyses").select("id").eq("conversation_id", conversationId).maybeSingle();
      if (existing) await sb.from("call_analyses").update(metricCols).eq("id", existing.id);
      else await sb.from("call_analyses").insert({ conversation_id: conversationId, deal_id: deal.id, scored_by: "execution-pass v1", ...metricCols });
      sum.call_metrics = true;
    } catch (e: any) { console.error("execution-pass v1: call_analyses upsert:", e?.message); }

    // ── Business Drivers summary (deterministic synthesis, full-pass calls) ──
    if (["qdc", "functional_discovery"].includes(conv.call_type)) {
      try {
        const [{ data: ces }, { data: cats }, { data: da }] = await Promise.all([
          sb.from("compelling_events").select("event_description, event_date, verified").eq("deal_id", deal.id),
          sb.from("business_catalysts").select("catalyst, urgency, verified").eq("deal_id", deal.id),
          sb.from("deal_analysis").select("id, driving_factors").eq("deal_id", deal.id).maybeSingle(),
        ]);
        const lines: string[] = [];
        for (const c of (cats || []).filter((x: any) => x.verified)) lines.push(`Catalyst: ${c.catalyst}${c.urgency ? ` (${c.urgency} urgency)` : ""}`);
        for (const e of (ces || []).filter((x: any) => x.verified)) lines.push(`Consequence of inaction: ${e.event_description}${e.event_date ? ` (by ${e.event_date})` : ""}`);
        if (lines.length && da) {
          const generated = lines.join("\n");
          const current = (da.driving_factors || "").trim();
          if (!current || current.toLowerCase() === "unknown") {
            await sb.from("deal_analysis").update({ driving_factors: generated }).eq("id", da.id);
            sum.drivers_summary = "written";
          } else if (current !== generated) {
            // Human (or earlier) content present: never overwrite — surface a refresh suggestion.
            const { data: open } = await sb.from("field_suggestions").select("id").eq("deal_id", deal.id)
              .eq("field_key", "driving_factors").eq("suggestion_kind", "value_update").eq("status", "open");
            if (!open?.length) {
              await sb.from("field_suggestions").insert({
                org_id: deal.org_id, suggestion_kind: "value_update", deal_id: deal.id,
                field_key: "driving_factors", entity_table: "deal_analysis",
                current_value: current, suggested_value: generated,
                suggestion_source: "transcript",
                provenance: { conversation_id: conversationId, observed_at: new Date().toISOString() },
                conflict_context: "Business Drivers regenerated from newer verified catalysts/events",
                status: "open", suggested_field_label: "Business Drivers", suggested_field_type: "text",
                suggested_description: "Regenerated drivers summary", ai_reasoning: "Drivers synthesis from verified CEs + catalysts",
              });
            }
            sum.drivers_summary = "suggested";
          } else {
            sum.drivers_summary = "unchanged";
          }
        }
      } catch (e: any) { console.error("execution-pass v1: drivers summary:", e?.message); }
    }

    try {
      await sb.from("ai_response_log").insert({
        deal_id: deal.id, response_type: "execution_pass", ai_model_used: "claude-sonnet-4-20250514",
        status: "completed", processing_time_ms: Date.now() - t0, extraction_summary: sum,
      });
    } catch (_) { /* non-fatal */ }

    return jr({ success: true, ...sum, ms: Date.now() - t0 });
  } catch (e: any) {
    console.error("execution-pass v1 error:", e);
    return jr({ error: `execution-pass v1: ${e?.message || e}` }, 500);
  }
});
