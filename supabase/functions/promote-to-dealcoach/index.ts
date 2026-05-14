// promote-to-dealcoach — DEPRECATED 2026-05-14, decommissioned in M10.
//
// Original purpose: IM-meetings flow — promoted a post-QDC-approved im_meeting into a
// deals row by inserting the deal + a conversations row with the AE QDC transcript.
//
// Replaced by: `route-lead` (creates the deal at routing time, not post-QDC) +
// `post-qdc-decision` v2 (advances the deal from qualify → discovery on AE approval).
//
// Zero callers verified across repo source, DB triggers, and other edge functions
// (post-qdc-decision v2 rewired in M7 no longer invokes this).
//
// Returns HTTP 410 Gone with a clear message. Logs request body so we can identify
// any caller that resurfaces. Kept deployed for one release cycle; full delete in a
// follow-up cleanup after pilot stability.

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
    "promote-to-dealcoach DEPRECATED CALL",
    JSON.stringify({
      method: req.method,
      caller_ua: req.headers.get("user-agent"),
      caller_referer: req.headers.get("referer"),
      body_preview: bodyText.substring(0, 500),
    }),
  );

  return new Response(
    JSON.stringify({
      error: "promote-to-dealcoach is deprecated as of 2026-05-14 (M10). The IM-meetings flow has been retired. Use route-lead to route an approved BDR lead and post-qdc-decision (v2) to advance/disqualify deals.",
      deprecated: true,
      replacement: { route: "route-lead", advance: "post-qdc-decision (v2)" },
      version: "deprecated-stub-v1",
    }),
    { status: 410, headers: { ...cors(), "Content-Type": "application/json" } },
  );
});
