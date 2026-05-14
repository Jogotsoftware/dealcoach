// process-bdr-submission — DEPRECATED 2026-05-14, decommissioned in M10.
//
// Original purpose: orchestrator for the old BDR flow — research → Claude scoring →
// score/feedback persistence → route → create IM meeting. Acted as the entry point
// from a (never-built) BDR form.
//
// Replaced by: the BDR submission form (M4) invokes `pre-qdc-decision` directly. No
// orchestrator middleman. pre-qdc-decision (v3) handles AI approve/deny against denial
// criteria, and on approval invokes `route-lead` (v2) which creates the deal in the
// qualify stage. Research happens post-routing via `research-company` (not pre-decision).
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
    "process-bdr-submission DEPRECATED CALL",
    JSON.stringify({
      method: req.method,
      caller_ua: req.headers.get("user-agent"),
      caller_referer: req.headers.get("referer"),
      body_preview: bodyText.substring(0, 500),
    }),
  );

  return new Response(
    JSON.stringify({
      error: "process-bdr-submission is deprecated as of 2026-05-14 (M10). The orchestrator pattern was replaced with direct pre-qdc-decision invocation from the BDR submission form.",
      deprecated: true,
      replacement: { entry_point: "pre-qdc-decision (v3)", routing: "route-lead (v2)" },
      version: "deprecated-stub-v1",
    }),
    { status: 410, headers: { ...cors(), "Content-Type": "application/json" } },
  );
});
