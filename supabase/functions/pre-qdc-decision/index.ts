// pre-qdc-decision v4
// AI first-glance approve/deny against AE manager denial criteria for BDR-submitted leads.
//
// CHANGES FROM v3:
// - Field iteration is now driven by `bdr_submission_fields` (M11). The hardcoded 10-field
//   list is gone; we iterate active fields ordered by priority and read built-ins from
//   the `bdr_leads` column matching `field_key`, customs from `lead.custom_fields[field_key]`.
//   Inactive fields are omitted entirely. Adds a "Custom fields" tail block listing any
//   custom_fields entries whose field_key is missing or inactive in the config (so manual
//   data from a removed field still surfaces to the AI rather than vanishing silently).
//
// CHANGES FROM v2:
// - Fires send-bdr-notification on denial (in-app + email parity to the BDR with the
//   AI's actionable reason). Approval notifications are emitted by route-lead because
//   that's where the AE assignment is known.
// - Fire-and-forget (EdgeRuntime.waitUntil) — notification failure is non-fatal.
//
// CHANGES FROM v1:
// - Added pre-Claude existence check on call_type_prompts (coach_id, 'bdr_first_glance', active=true).
//   If the bdr_first_glance prompt is missing or inactive, fail loudly BEFORE assemble_coach_prompt
//   and BEFORE Claude is called. v1 caught the misconfig downstream via the decision-value validator,
//   but burned ~$0.02 of tokens and wrote an assembled_prompt_versions row in the process. v2 stops
//   that waste at the door.
// - Error message includes org_id + coach_id for operational triage.
//
// REPLACES the v1 that shipped earlier (BDR/IM Phase 2): that previous version was the
// AE post-QDC accept/reject state machine for im_meetings. This is a complete rewrite
// per the Lumen BDR Submission & Deal Routing spec — different inputs, different table,
// different lifecycle position.
//
// Conventions:
// - Every error message starts with "pre-qdc-decision v4: ..." for runtime traceability.
// - System prompt comes from assemble_coach_prompt RPC. Fails LOUDLY if RPC errors or
//   returns empty — never silently falls back to a partial prompt.
// - Hash-dedups into assembled_prompt_versions (sha256 of system content).
// - Logs to ai_response_log with model, tokens, latency, decision summary.
// - Idempotent: a second invocation for the same lead_id returns the existing decision
//   without re-billing Claude.
// - If approved, fires route-lead async (fire-and-forget; non-fatal in M2 since route-lead
//   v1 from the old build will likely fail on the new schema. M3 ships the rewrite).

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

// Hash-dedup write to assembled_prompt_versions. Returns the row id (existing or new).
async function recordAssembledPrompt(
  sb: ReturnType<typeof createClient>,
  coachId: string,
  callType: string,
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
      console.log("pre-qdc-decision v4: assembled_prompt_versions insert error", error.message);
      return null;
    }
    return inserted?.id ?? null;
  } catch (e) {
    console.log("pre-qdc-decision v4: recordAssembledPrompt threw", e);
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
  // Final attempt return (mirrors process-transcript pattern)
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

function formatRevenue(n: number | string | null | undefined): string {
  if (n == null) return "Unknown";
  const num = typeof n === "string" ? Number(n) : n;
  if (!Number.isFinite(num)) return "Unknown";
  return "$" + Math.round(num).toLocaleString("en-US");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("pre-qdc-decision v4: ANTHROPIC_API_KEY not configured");
    }

    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const lead_id = reqBody.lead_id as string | undefined;
    if (!lead_id) throw new Error("pre-qdc-decision v4: lead_id required");

    // 1. Load bdr_leads
    const { data: lead, error: lErr } = await sb
      .from("bdr_leads")
      .select("*")
      .eq("id", lead_id)
      .maybeSingle();
    if (lErr) throw new Error(`pre-qdc-decision v4: bdr_leads select error: ${lErr.message}`);
    if (!lead) throw new Error(`pre-qdc-decision v4: lead_id not found: ${lead_id}`);

    // 2. Idempotency — already decided
    if (lead.ai_decision === "approved" || lead.ai_decision === "denied") {
      return jr({
        success: true,
        version: "v4",
        idempotent: true,
        lead_id,
        decision: lead.ai_decision,
        reason: lead.ai_decision_reason,
        criteria_triggered: lead.ai_decision_criteria_triggered ?? [],
      });
    }

    // 3. Verify transcript is processable
    const transcript = (lead.transcript as string | null) ?? "";
    if (!transcript || transcript.length < 200) {
      throw new Error(
        `pre-qdc-decision v4: transcript not ready (length=${transcript.length}); minimum 200 chars`,
      );
    }

    // 4. Load BANT notes
    const { data: notes } = await sb
      .from("bdr_notes")
      .select("content")
      .eq("lead_id", lead_id)
      .eq("note_type", "bant")
      .order("created_at", { ascending: true });
    const bantNotes = ((notes ?? []) as Array<{ content: string }>)
      .map((n) => (n.content ?? "").trim())
      .filter(Boolean)
      .join("\n\n");

    // 5. Load active denial criteria
    const { data: criteriaData } = await sb
      .from("ae_denial_criteria")
      .select("id, description, ai_guidance, priority")
      .eq("org_id", lead.org_id)
      .eq("active", true)
      .order("priority", { ascending: true });
    const criteria = (criteriaData ?? []) as Array<{
      id: string;
      description: string;
      ai_guidance: string | null;
      priority: number;
    }>;

    // 6. Locate BDR Submission Coach for this org
    const { data: coach, error: cErr } = await sb
      .from("coaches")
      .select("id, name, model, temperature")
      .eq("org_id", lead.org_id)
      .eq("name", "BDR Submission Coach")
      .eq("active", true)
      .maybeSingle();
    if (cErr) {
      throw new Error(`pre-qdc-decision v4: coach lookup error: ${cErr.message}`);
    }
    if (!coach) {
      throw new Error(
        `pre-qdc-decision v4: BDR Submission Coach not active for org ${lead.org_id} — clone it via /coach or contact the AE manager`,
      );
    }

    // 6b. NEW IN v2: explicit existence check for the bdr_first_glance call_type prompt.
    //     assemble_coach_prompt is permissive — if this prompt is missing/inactive it returns
    //     a 3-layer fallback prompt (no call-type layer) and Claude responds with a different
    //     output shape, burning tokens before the validator catches it. We stop that here.
    const { data: prompt, error: pErr } = await sb
      .from("call_type_prompts")
      .select("id, active")
      .eq("coach_id", coach.id)
      .eq("call_type", "bdr_first_glance")
      .eq("active", true)
      .maybeSingle();
    if (pErr) {
      throw new Error(
        `pre-qdc-decision v4: call_type_prompts existence check failed for coach ${coach.id} (org ${lead.org_id}): ${pErr.message}`,
      );
    }
    if (!prompt) {
      throw new Error(
        `pre-qdc-decision v4: bdr_first_glance prompt missing or inactive for coach ${coach.id} (org ${lead.org_id}). An AE manager likely deactivated it via /coach. Re-enable and retry.`,
      );
    }

    // 7. Assemble system prompt via RPC — FAIL LOUDLY if missing or empty
    const { data: assembled, error: rpcErr } = await sb.rpc("assemble_coach_prompt", {
      p_coach_id: coach.id,
      p_call_type: "bdr_first_glance",
      p_action: "process_transcript",
    });
    if (rpcErr) {
      throw new Error(
        `pre-qdc-decision v4: assemble_coach_prompt RPC failed for coach ${coach.id} (org ${lead.org_id}): ${rpcErr.message}`,
      );
    }
    if (typeof assembled !== "string" || assembled.length < 50) {
      throw new Error(
        `pre-qdc-decision v4: assemble_coach_prompt returned empty or invalid result (length=${
          typeof assembled === "string" ? assembled.length : -1
        }) for coach ${coach.id} (org ${lead.org_id}).`,
      );
    }
    const assembledPromptVersionId = await recordAssembledPrompt(
      sb,
      coach.id as string,
      "bdr_first_glance",
      "process_transcript",
      assembled,
    );

    // 7b. Load active submission fields (M11). Drives the lead-submission section of the
    //     prompt. Built-in field_keys map to bdr_leads columns; custom field_keys live in
    //     lead.custom_fields JSONB. Ordered by priority so admin-set ordering carries
    //     through to the AI prompt.
    const { data: fieldsData } = await sb
      .from("bdr_submission_fields")
      .select("field_key, label, input_type, is_builtin, active, priority")
      .eq("org_id", lead.org_id)
      .eq("active", true)
      .order("priority", { ascending: true });
    const fields = (fieldsData ?? []) as Array<{
      field_key: string;
      label: string;
      input_type: string;
      is_builtin: boolean;
      active: boolean;
      priority: number;
    }>;

    const customFields = (lead.custom_fields ?? {}) as Record<string, unknown>;

    function formatFieldValue(fieldKey: string, inputType: string, isBuiltin: boolean): string {
      const raw = isBuiltin
        ? (lead as Record<string, unknown>)[fieldKey]
        : customFields[fieldKey];
      if (raw == null || raw === "") return "Unknown";
      if (inputType === "currency" || (isBuiltin && fieldKey === "annual_revenue")) {
        return formatRevenue(raw as number | string);
      }
      if (inputType === "tag_input" || Array.isArray(raw)) {
        const arr = Array.isArray(raw) ? raw : [raw];
        return arr.length ? arr.map((x) => String(x)).join(", ") : "Unknown";
      }
      return String(raw);
    }

    // 8. Build the user message — denial criteria + lead fields + BANT + transcript
    const criteriaBlock = criteria.length === 0
      ? "(NO ACTIVE DENIAL CRITERIA configured for this org. Approve unless the submission is obviously inadequate: missing transcript, BANT notes contradict the company stated, or transcript is clearly unrelated to the lead.)"
      : criteria
        .map(
          (c) =>
            `${c.priority}. ${c.description}\n   Guidance: ${c.ai_guidance ?? "(no guidance)"}`,
        )
        .join("\n\n");

    const leadLines = fields.length === 0
      // Defensive fallback: no submission fields config (e.g. fresh org pre-seed).
      // Surface a clear note rather than an empty section.
      ? ["(No submission fields configured for this org. Judge on transcript + BANT alone.)"]
      : fields.map((f) => `${f.label}: ${formatFieldValue(f.field_key, f.input_type, f.is_builtin)}`);

    // Surface orphaned custom_fields keys (data submitted under a field that's since been
    // deactivated or renamed) so they aren't silently dropped from the AI's view.
    const activeKeys = new Set(fields.map((f) => f.field_key));
    const orphanCustomEntries = Object.entries(customFields)
      .filter(([k, v]) => !activeKeys.has(k) && v != null && v !== "");
    const orphanCustomBlock = orphanCustomEntries.length
      ? [
        "",
        "# Custom fields (no longer in current config)",
        "",
        ...orphanCustomEntries.map(([k, v]) => {
          const valStr = Array.isArray(v) ? (v as unknown[]).join(", ") : String(v);
          return `${k}: ${valStr}`;
        }),
      ]
      : [];

    const userMessage = [
      "# Denial criteria (deny the lead if any apply)",
      "",
      criteriaBlock,
      "",
      "# Lead submission",
      "",
      ...leadLines,
      ...orphanCustomBlock,
      "",
      "# BDR BANT notes",
      "",
      bantNotes || "(BDR did not provide BANT notes — flag this in your reason if it affects judgment.)",
      "",
      "# Call transcript",
      "",
      transcript,
    ].join("\n");

    // 9. Call Claude
    const model = (coach.model as string) || "claude-sonnet-4-5";
    const temperature = Number(coach.temperature ?? 0.2);
    const claudeStart = Date.now();
    const cr = await callClaude({
      model,
      max_tokens: 1500,
      temperature,
      system: assembled,
      messages: [{ role: "user", content: userMessage }],
    });
    const claudeMs = Date.now() - claudeStart;

    if (!cr.ok) {
      const errText = await cr.text().catch(() => "");
      throw new Error(
        `pre-qdc-decision v4: Claude API ${cr.status}: ${errText.substring(0, 300)}`,
      );
    }
    const claudeData = await cr.json();
    const raw = ((claudeData.content ?? []) as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    // 10. Parse JSON defensively
    let parsed: { decision?: string; reason?: string; criteria_triggered?: unknown };
    try {
      const cleaned = stripJsonFences(raw);
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error(
        `pre-qdc-decision v4: JSON parse failure: ${
          e instanceof Error ? e.message : String(e)
        }. Raw[0..400]: ${raw.substring(0, 400)}`,
      );
    }

    if (parsed.decision !== "approved" && parsed.decision !== "denied") {
      throw new Error(
        `pre-qdc-decision v4: invalid decision value: ${JSON.stringify(parsed.decision)}`,
      );
    }
    const decision = parsed.decision;
    const reason = String(parsed.reason ?? "").trim();
    const triggered = Array.isArray(parsed.criteria_triggered)
      ? (parsed.criteria_triggered as unknown[]).map((x) => String(x))
      : [];

    // 11. Update bdr_leads
    //    - denied → stage = 'denied'
    //    - approved → stage stays at 'ai_reviewing' until route-lead (M3) moves it to 'routed'
    const newStage = decision === "denied" ? "denied" : "ai_reviewing";
    const { error: updErr } = await sb
      .from("bdr_leads")
      .update({
        ai_decision: decision,
        ai_decision_reason: reason,
        ai_decision_criteria_triggered: triggered,
        ai_decision_at: new Date().toISOString(),
        stage: newStage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead_id);
    if (updErr) {
      throw new Error(`pre-qdc-decision v4: bdr_leads update failed: ${updErr.message}`);
    }

    // 12. Log to ai_response_log
    const usage = (claudeData.usage ?? {}) as {
      input_tokens?: number;
      output_tokens?: number;
    };
    const inputTok = usage.input_tokens ?? null;
    const outputTok = usage.output_tokens ?? null;
    const totalTok = (inputTok ?? 0) + (outputTok ?? 0) || null;
    try {
      await sb.from("ai_response_log").insert({
        deal_id: null,
        lead_id,
        response_type: "bdr_first_glance",
        coach_id: coach.id,
        ai_model_used: model,
        temperature,
        prompt_tokens: inputTok,
        completion_tokens: outputTok,
        total_tokens: totalTok,
        processing_time_ms: claudeMs,
        extraction_summary: {
          decision,
          criteria_triggered: triggered,
          reason_preview: reason.substring(0, 240),
          assembled_prompt_chars: assembled.length,
          user_message_chars: userMessage.length,
        },
        status: "completed",
        version: 1,
        assembled_prompt_version_id: assembledPromptVersionId,
      });
    } catch (e) {
      console.log("pre-qdc-decision v4: ai_response_log insert error (non-fatal)", e);
    }

    // 13a. If approved, invoke route-lead (synchronous so the response reflects routed state).
    //      route-lead will emit the 'lead_approved' notification itself (it knows the AE).
    if (decision === "approved") {
      try {
        const rr = await fetch(`${SUPABASE_URL}/functions/v1/route-lead`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ lead_id }),
        });
        if (!rr.ok) {
          console.log(
            "pre-qdc-decision v4: route-lead non-OK (non-fatal — BDR sees ai_reviewing until route succeeds)",
            rr.status,
            await rr.text().catch(() => ""),
          );
        }
      } catch (e) {
        console.log("pre-qdc-decision v4: route-lead invocation threw (non-fatal)", e);
      }
    }

    // 13b. If denied, fire BDR notification (in-app + email). Fire-and-forget; non-fatal.
    if (decision === "denied") {
      const notifyPromise = fetch(`${SUPABASE_URL}/functions/v1/send-bdr-notification`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
        body: JSON.stringify({
          recipient_user_id: lead.bdr_id,
          org_id: lead.org_id,
          notification_type: "lead_denied",
          reference_id: lead_id,
          reference_table: "bdr_leads",
          title: `Your lead "${lead.company_name}" needs revision`,
          body: reason,
          email_body: reason + (triggered.length
            ? `\n\nCriteria triggered:\n- ${triggered.join("\n- ")}`
            : ""),
        }),
      }).catch((e) => console.log("pre-qdc-decision v4: send-bdr-notification fire failed (non-fatal)", e));
      // @ts-ignore EdgeRuntime is available in Supabase edge functions runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(notifyPromise);
      }
    }

    return jr({
      success: true,
      version: "v4",
      lead_id,
      decision,
      reason,
      criteria_triggered: triggered,
      tokens: { input: inputTok, output: outputTok, total: totalTok },
      processing_time_ms: claudeMs,
      total_time_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("pre-qdc-decision v4 FATAL:", msg);
    return jr({ error: msg, version: "v4" }, 500);
  }
});
