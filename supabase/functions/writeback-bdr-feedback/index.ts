// writeback-bdr-feedback — DEPRECATED 2026-05-14, decommissioned in M10.
//
// Original purpose: write a row to bdr_handoff_feedback after an AE rejected an IM
// meeting post-QDC, so the BDR sees deal-outcome feedback. Pulled feedback context from
// im_meetings.post_qdc_ai_raw_response.
//
// Replaced by: the shared SECURITY DEFINER RPC `disqualify_deal_with_feedback(...)` —
// invoked from the AE disqualify modal AND from post-qdc-decision (v2). The RPC writes
// bdr_handoff_feedback (with the AE's typed feedback notes, not AI-summarized post-QDC
// raw response) + updates bdr_leads.stage='disqualified_post_qdc' + returns a payload
// for send-bdr-notification to use.
//
// Zero callers verified across repo source, DB triggers, and other edge functions.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });

  let bodyText = "";
  try { bodyText = await req.text(); } catch { /* noop */ }
  console.log(
    "writeback-bdr-feedback DEPRECATED CALL",
    JSON.stringify({
      method: req.method,
      caller_ua: req.headers.get("user-agent"),
      caller_referer: req.headers.get("referer"),
      body_preview: bodyText.substring(0, 500),
    }),
  );

  return new Response(
    JSON.stringify({
      error: "writeback-bdr-feedback is deprecated as of 2026-05-14 (M10). The IM-meetings handoff-feedback writeback has been replaced by the disqualify_deal_with_feedback RPC.",
      deprecated: true,
      replacement: { rpc: "disqualify_deal_with_feedback", entry_points: ["post-qdc-decision (v2)", "DisqualifyDealModal frontend"] },
      version: "deprecated-stub-v1",
    }),
    { status: 410, headers: { ...cors(), "Content-Type": "application/json" } },
  );
});
