// route-lead v2
// Routes an approved bdr_leads row to an AE, creates the qualify-stage deal,
// links the transcript as a conversations row, writes routing_history, and
// fires research-company + process-transcript async (fire-and-forget with
// audit entries in inbound_event_log so silent enrichment failures surface).
//
// CHANGES FROM v1:
// - Fires send-bdr-notification on successful routing (notification_type='lead_approved')
//   so the BDR sees an in-app + email confirmation with the AE name.
// - Fire-and-forget via EdgeRuntime.waitUntil; non-fatal if notification fails.
//
// REPLACES the v1 that shipped earlier (BDR/IM Phase 2). That previous version used
// JSONB match_criteria + capacity check + im_meetings creation. This rewrite uses the
// flat-column routing_rules schema and creates a deal directly in 'qualify' stage,
// bypassing the IM meeting layer entirely.
//
// Conventions:
// - Every error message starts with "route-lead v2: ..."
// - Idempotent: if bdr_leads.stage='routed' and deal_id is set, returns existing deal_id
//   without re-routing.
// - Refuses to route a lead whose ai_decision is not 'approved'.
// - Async kickoffs (research-company, process-transcript) are NOT awaited but ARE audited
//   via inbound_event_log so failed enrichment doesn't disappear silently.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

type Sb = ReturnType<typeof createClient>;

type RoutingRule = {
  id: string;
  org_id: string;
  name: string;
  priority: number;
  active: boolean;
  match_state: string | null;
  match_vertical: string | null;
  match_employee_min: number | null;
  match_employee_max: number | null;
  destination_type: "ae" | "pool" | null;
  destination_ae_id: string | null;
  destination_pool_id: string | null;
};

type BdrLead = {
  id: string;
  org_id: string;
  bdr_id: string;
  company_name: string;
  website: string | null;
  hq_state: string | null;
  vertical: string | null;
  employee_count: number | null;
  transcript: string | null;
  stage: string;
  ai_decision: string;
  deal_id: string | null;
};

function ruleMatches(rule: RoutingRule, lead: BdrLead): boolean {
  if (rule.match_state && rule.match_state !== lead.hq_state) return false;
  if (rule.match_vertical && rule.match_vertical !== lead.vertical) return false;
  if (rule.match_employee_min != null) {
    if (lead.employee_count == null || lead.employee_count < rule.match_employee_min) return false;
  }
  if (rule.match_employee_max != null) {
    if (lead.employee_count == null || lead.employee_count > rule.match_employee_max) return false;
  }
  return true;
}

async function logAsyncInvocation(
  sb: Sb,
  orgId: string,
  eventType: string,
  dealId: string | null,
  status: "pending" | "completed" | "failed",
  errorMessage: string | null,
  payload: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await sb
      .from("inbound_event_log")
      .insert({
        org_id: orgId,
        source: "route-lead",
        event_type: eventType,
        deal_id: dealId,
        status,
        error_message: errorMessage,
        mapped_payload: payload,
      })
      .select("id")
      .single();
    if (error) {
      console.log("route-lead v2: inbound_event_log insert error", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (e) {
    console.log("route-lead v2: inbound_event_log threw", e);
    return null;
  }
}

async function updateAsyncInvocation(
  sb: Sb,
  invocationId: string | null,
  status: "completed" | "failed",
  errorMessage: string | null,
): Promise<void> {
  if (!invocationId) return;
  try {
    await sb
      .from("inbound_event_log")
      .update({ status, error_message: errorMessage })
      .eq("id", invocationId);
  } catch (e) {
    console.log("route-lead v2: inbound_event_log update threw", e);
  }
}

// Fire an edge function and audit the invocation. Awaited internally but the caller
// invokes via Promise without awaiting, so route-lead's HTTP response is not blocked.
async function fireAndAudit(
  sb: Sb,
  orgId: string,
  eventType: string,
  dealId: string,
  slug: string,
  body: Record<string, unknown>,
): Promise<void> {
  const invId = await logAsyncInvocation(sb, orgId, eventType, dealId, "pending", null, body);
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(body),
    });
    if (r.ok) {
      await updateAsyncInvocation(sb, invId, "completed", null);
    } else {
      const errText = await r.text().catch(() => "");
      await updateAsyncInvocation(
        sb,
        invId,
        "failed",
        `HTTP ${r.status}: ${errText.substring(0, 500)}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateAsyncInvocation(sb, invId, "failed", `threw: ${msg.substring(0, 500)}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const lead_id = reqBody.lead_id as string | undefined;
    if (!lead_id) throw new Error("route-lead v2: lead_id required");

    // 1. Load lead
    const { data: leadRaw, error: lErr } = await sb
      .from("bdr_leads")
      .select(
        "id, org_id, bdr_id, company_name, website, hq_state, vertical, employee_count, transcript, stage, ai_decision, deal_id",
      )
      .eq("id", lead_id)
      .maybeSingle();
    if (lErr) throw new Error(`route-lead v2: bdr_leads select error: ${lErr.message}`);
    if (!leadRaw) throw new Error(`route-lead v2: lead_id not found: ${lead_id}`);
    const lead = leadRaw as BdrLead;

    // 2a. Idempotency: already routed
    if (lead.stage === "routed" && lead.deal_id) {
      return jr({
        success: true,
        version: "v2",
        idempotent: true,
        lead_id,
        deal_id: lead.deal_id,
        ae_id: null, // not refetched; caller can read bdr_leads.routed_to_ae_id
      });
    }

    // 2b. Refuse if not approved
    if (lead.ai_decision !== "approved") {
      throw new Error(
        `route-lead v2: lead ${lead_id} is not approved (ai_decision=${JSON.stringify(lead.ai_decision)}, stage=${JSON.stringify(lead.stage)})`,
      );
    }

    // 3. Find matching routing rule (priority ASC, first match)
    const { data: rulesRaw } = await sb
      .from("routing_rules")
      .select(
        "id, org_id, name, priority, active, match_state, match_vertical, match_employee_min, match_employee_max, destination_type, destination_ae_id, destination_pool_id",
      )
      .eq("org_id", lead.org_id)
      .eq("active", true)
      .order("priority", { ascending: true });
    const rules = (rulesRaw ?? []) as RoutingRule[];

    let matchedRule: RoutingRule | null = null;
    for (const r of rules) {
      if (ruleMatches(r, lead)) {
        matchedRule = r;
        break;
      }
    }
    if (!matchedRule) {
      throw new Error(
        `route-lead v2: no routing rule matched and no catch-all available for org ${lead.org_id}. Seed a rule via /admin/routing.`,
      );
    }

    // 4. Resolve AE
    let aeId: string | null = null;
    if (matchedRule.destination_type === "ae") {
      aeId = matchedRule.destination_ae_id;
      if (!aeId) {
        throw new Error(
          `route-lead v2: matched rule ${matchedRule.id} (${matchedRule.name}) has destination_type='ae' but destination_ae_id is null`,
        );
      }
    } else if (matchedRule.destination_type === "pool") {
      if (!matchedRule.destination_pool_id) {
        throw new Error(
          `route-lead v2: matched rule ${matchedRule.id} (${matchedRule.name}) has destination_type='pool' but destination_pool_id is null`,
        );
      }
      const { data: poolResult, error: rpcErr } = await sb.rpc("advance_routing_pool", {
        p_pool_id: matchedRule.destination_pool_id,
      });
      if (rpcErr) {
        throw new Error(
          `route-lead v2: advance_routing_pool failed for pool ${matchedRule.destination_pool_id}: ${rpcErr.message}`,
        );
      }
      aeId = poolResult as string | null;
      if (!aeId) {
        throw new Error(
          `route-lead v2: advance_routing_pool returned null for pool ${matchedRule.destination_pool_id}`,
        );
      }
    } else {
      throw new Error(
        `route-lead v2: matched rule ${matchedRule.id} has invalid destination_type: ${JSON.stringify(matchedRule.destination_type)}`,
      );
    }

    // 5. Create deal in 'qualify' stage. The deals_create_related trigger auto-creates
    //    company_profile + deal_analysis rows.
    const { data: dealRow, error: dealErr } = await sb
      .from("deals")
      .insert({
        org_id: lead.org_id,
        rep_id: aeId,
        company_name: lead.company_name,
        website: lead.website,
        stage: "qualify",
        source: "bdr_submission",
        bdr_lead_id: lead.id,
        forecast_category: "pipeline",
      })
      .select("id")
      .single();
    if (dealErr || !dealRow) {
      throw new Error(`route-lead v2: deals insert failed: ${dealErr?.message ?? "no row"}`);
    }
    const deal_id = dealRow.id as string;

    // 6. Create conversations row linked to the new deal, transcript copied from bdr_leads
    let conversation_id: string | null = null;
    if (lead.transcript && lead.transcript.trim().length > 0) {
      const { data: convoRow, error: convoErr } = await sb
        .from("conversations")
        .insert({
          deal_id,
          title: `QDC — ${lead.company_name}`,
          call_type: "qdc",
          transcript: lead.transcript,
          source: "bdr_submission",
          call_date: new Date().toISOString(),
          processed: false,
        })
        .select("id")
        .single();
      if (convoErr || !convoRow) {
        // Non-fatal — log and continue. AE can re-attach transcript later.
        console.log("route-lead v2: conversations insert failed (non-fatal)", convoErr?.message);
      } else {
        conversation_id = convoRow.id as string;
      }
    }

    // 7. Update bdr_leads: stage='routed', routed_to_ae_id, routed_at, deal_id
    const now = new Date().toISOString();
    const { error: updErr } = await sb
      .from("bdr_leads")
      .update({
        stage: "routed",
        routed_to_ae_id: aeId,
        routed_at: now,
        deal_id,
        updated_at: now,
      })
      .eq("id", lead_id);
    if (updErr) {
      throw new Error(`route-lead v2: bdr_leads update failed: ${updErr.message}`);
    }

    // 8. Write routing_history
    const isFallback = matchedRule.priority >= 9999 ||
      matchedRule.name === "Catch-all fallback (auto-seeded)";
    try {
      await sb.from("routing_history").insert({
        source_type: "bdr_lead",
        source_id: lead.id,
        org_id: lead.org_id,
        matched_rule_id: matchedRule.id,
        target_ae_id: aeId,
        deal_id,
        destination_pool_id: matchedRule.destination_pool_id,
        routed_by_function: "route-lead v1",
        fallback_used: isFallback,
        capacity_skipped_ae_ids: [],
        routed_at: now,
      });
    } catch (e) {
      console.log("route-lead v2: routing_history insert error (non-fatal)", e);
    }

    // 9. Async kickoffs (fire-and-forget but audited via inbound_event_log)
    //    research-company enriches company_profile + deal_analysis
    //    process-transcript runs AI extraction on the conversation
    //    EdgeRuntime.waitUntil keeps them alive after the HTTP response returns.
    const researchKick = fireAndAudit(sb, lead.org_id, "research-company-invoke", deal_id, "research-company", { deal_id });
    if (conversation_id) {
      const transcriptKick = fireAndAudit(
        sb,
        lead.org_id,
        "process-transcript-invoke",
        deal_id,
        "process-transcript",
        { conversation_id, deal_id },
      );
      // @ts-ignore — EdgeRuntime is available in Supabase Edge Functions runtime
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(Promise.allSettled([researchKick, transcriptKick]));
      }
    } else {
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(researchKick);
      }
    }

    // 10. Handoff notification to the BDR — fires send-bdr-notification (in-app + email).
    //     Fire-and-forget via EdgeRuntime.waitUntil; non-fatal if notification path errors.
    //     Audited via inbound_event_log alongside research/transcript kickoffs.
    const { data: aeProfile } = await sb
      .from("profiles")
      .select("full_name")
      .eq("id", aeId)
      .maybeSingle();
    const aeName = aeProfile?.full_name ?? "your assigned AE";

    const handoffPromise = fireAndAudit(
      sb,
      lead.org_id,
      "handoff-notification-invoke",
      deal_id,
      "send-bdr-notification",
      {
        recipient_user_id: lead.bdr_id,
        org_id: lead.org_id,
        notification_type: "lead_approved",
        reference_id: lead.id,
        reference_table: "bdr_leads",
        title: `Your lead "${lead.company_name}" was routed`,
        body: `Approved and assigned to ${aeName}. They'll take it from here.`,
        email_body: `Your submission for ${lead.company_name} passed AI review and has been routed to ${aeName}. They'll reach out to schedule a QDC. You can track this lead's progress in My Leads.`,
      },
    );
    // @ts-ignore EdgeRuntime is available in Supabase edge functions runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(handoffPromise);
    }

    return jr({
      success: true,
      version: "v2",
      lead_id,
      deal_id,
      ae_id: aeId,
      conversation_id,
      matched_rule_id: matchedRule.id,
      matched_rule_name: matchedRule.name,
      destination_type: matchedRule.destination_type,
      destination_pool_id: matchedRule.destination_pool_id,
      fallback_used: isFallback,
      total_time_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("route-lead v1 FATAL:", msg);
    return jr({ error: msg, version: "v1" }, 500);
  }
});
