// post-qdc-decision v2
// Rewires the AE's post-QDC outcome on a deal. Replaces the v1 IM-meetings state machine.
//
// CHANGES FROM v1:
// - Operates on `deals`, not `im_meetings`. Old IM flow retired alongside promote-to-dealcoach.
// - Two outcomes:
//   * 'approved'    → deal stage qualify → discovery; fires `lead_advanced` notification if BDR-sourced.
//   * 'disqualified'→ calls disqualify_deal_with_feedback() RPC + fires `lead_disqualified_post_qdc` notification.
// - DOES NOT call promote-to-dealcoach anymore (zero callers remaining; M10 decommissions it).
// - Idempotent: re-invocation on a deal already past qualify (or already disqualified) returns existing state
//   without duplicate writes or duplicate notifications.
// - Handles AE-self-submitted deals (no bdr_lead_id) gracefully — deal moves, retrospective fires,
//   BDR-side writes/notifications are skipped.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const APPROVAL_TARGET_STAGE = "discovery"; // qualify → discovery on AE approval after QDC

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}
function jr(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), {
    status: s,
    headers: { ...cors(), "Content-Type": "application/json" },
  });
}

async function fireNotification(payload: Record<string, unknown>): Promise<void> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/send-bdr-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      console.log("post-qdc-decision v2: send-bdr-notification non-OK", r.status, txt.substring(0, 200));
    }
  } catch (e) {
    console.log("post-qdc-decision v2: send-bdr-notification threw (non-fatal)", e);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json().catch(() => ({}));
    const deal_id = body.deal_id as string | undefined;
    const decision = body.decision as string | undefined;        // 'approved' | 'disqualified'
    const rejection_reason_id = (body.rejection_reason_id as string | undefined) ?? null;
    const feedback = (body.feedback as string | undefined) ?? null;
    const actor_user_id = (body.actor_user_id as string | undefined) ?? null;
    const suppress_bdr_notification = !!body.suppress_bdr_notification;

    if (!deal_id) throw new Error("post-qdc-decision v2: deal_id required");
    if (!["approved", "disqualified"].includes(decision ?? "")) {
      throw new Error(`post-qdc-decision v2: invalid decision: ${JSON.stringify(decision)}. Valid: 'approved', 'disqualified'.`);
    }
    if (!actor_user_id) {
      throw new Error("post-qdc-decision v2: actor_user_id required (the AE making the decision)");
    }

    // Load deal
    const { data: deal, error: dErr } = await sb
      .from("deals")
      .select("id, org_id, stage, bdr_lead_id, company_name, rep_id")
      .eq("id", deal_id)
      .maybeSingle();
    if (dErr) throw new Error(`post-qdc-decision v2: deal select error: ${dErr.message}`);
    if (!deal) throw new Error(`post-qdc-decision v2: deal not found: ${deal_id}`);

    // ─── DISQUALIFIED PATH ─────────────────────────────────────────────────
    if (decision === "disqualified") {
      // Validation: feedback required when BDR-sourced and not suppressed (safety net).
      // SKIPPED if the deal is already disqualified — the RPC's idempotency check returns
      // existing state without writes, so a no-op repeat call shouldn't trip validation.
      if (deal.stage !== "disqualified") {
        if (deal.bdr_lead_id && !suppress_bdr_notification && (!feedback || feedback.trim().length < 30)) {
          throw new Error("post-qdc-decision v2: feedback required (min 30 chars) when disqualifying a BDR-sourced deal without suppressing the notification");
        }
      }

      const { data: rpcResult, error: rpcErr } = await sb.rpc("disqualify_deal_with_feedback", {
        p_deal_id: deal_id,
        p_rejection_reason_id: rejection_reason_id,
        p_feedback: feedback,
        p_actor_user_id: actor_user_id,
        p_suppress_bdr_notification: suppress_bdr_notification,
      });
      if (rpcErr) throw new Error(`post-qdc-decision v2: disqualify_deal_with_feedback RPC failed: ${rpcErr.message}`);

      const result = rpcResult as Record<string, unknown>;
      if (result?.was_already_disqualified) {
        return jr({
          success: true,
          version: "v2",
          decision: "disqualified",
          idempotent: true,
          deal_id,
          bdr_lead_id: result.bdr_lead_id ?? null,
        });
      }

      // Fire notification if RPC produced a payload (BDR-sourced, not suppressed)
      const notifyPayload = result?.notification_payload as Record<string, unknown> | null;
      if (notifyPayload) {
        // Don't await — fire-and-forget via EdgeRuntime.waitUntil so retrospective trigger (which
        // fires synchronously on the deals UPDATE above) doesn't block on email.
        const p = fireNotification(notifyPayload);
        // @ts-ignore EdgeRuntime is available in Supabase edge runtime
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(p);
        }
      }

      return jr({
        success: true,
        version: "v2",
        decision: "disqualified",
        deal_id,
        bdr_lead_id: result?.bdr_lead_id ?? null,
        handoff_feedback_id: result?.handoff_feedback_id ?? null,
        notification_fired: !!notifyPayload,
      });
    }

    // ─── APPROVED PATH ─────────────────────────────────────────────────────
    // Idempotency: deal already past qualify (or in a terminal state) → no-op return.
    if (deal.stage !== "qualify") {
      return jr({
        success: true,
        version: "v2",
        decision: "approved",
        idempotent: true,
        deal_id,
        stage: deal.stage,
        note: `Deal already at stage '${deal.stage}'. No advancement applied.`,
      });
    }

    const { error: updErr } = await sb
      .from("deals")
      .update({
        stage: APPROVAL_TARGET_STAGE,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deal_id);
    if (updErr) throw new Error(`post-qdc-decision v2: deal advance failed: ${updErr.message}`);

    // Fire lead_advanced notification if BDR-sourced
    let notificationFired = false;
    if (deal.bdr_lead_id) {
      const { data: lead } = await sb
        .from("bdr_leads")
        .select("bdr_id, company_name, org_id")
        .eq("id", deal.bdr_lead_id)
        .maybeSingle();
      if (lead?.bdr_id) {
        const p = fireNotification({
          recipient_user_id: lead.bdr_id,
          org_id: lead.org_id,
          notification_type: "lead_advanced",
          reference_id: deal.bdr_lead_id,
          reference_table: "bdr_leads",
          title: `Your lead "${lead.company_name}" advanced to ${APPROVAL_TARGET_STAGE}`,
          body: `The AE completed the QDC and is moving the deal forward.`,
          email_body: `Your submission for ${lead.company_name} passed the AE's QDC review and is now in the ${APPROVAL_TARGET_STAGE} stage. The AE will continue driving the deal — you can track progress in My Leads.`,
        });
        // @ts-ignore
        if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
          // @ts-ignore
          EdgeRuntime.waitUntil(p);
        }
        notificationFired = true;
      }
    }

    return jr({
      success: true,
      version: "v2",
      decision: "approved",
      deal_id,
      stage: APPROVAL_TARGET_STAGE,
      notification_fired: notificationFired,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("post-qdc-decision v2 FATAL:", msg);
    return jr({ error: msg, version: "v2" }, 500);
  }
});
