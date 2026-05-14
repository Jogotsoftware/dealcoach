// research-lead-company — DEPRECATED 2026-05-14, decommissioned in M10.
//
// Original purpose: Perplexity Sonar Pro research on a bdr_leads row before AI scoring.
// Enriched employee_count, revenue, hq_state, tech_stack, recent_news, intent_signals
// in-place on the lead before pre-qdc scoring ran.
//
// Replaced by: per M0 decision 6.J, pre-decision research was dropped. The AI decides
// on the BDR's submitted data alone (faster decision, no wasted spend on denials).
// Post-routing research is handled by `research-company` (the dealcoach variant —
// Perplexity + Apollo + NinjaPear), invoked async by `route-lead` (v2) after the deal
// is created.
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
    "research-lead-company DEPRECATED CALL",
    JSON.stringify({
      method: req.method,
      caller_ua: req.headers.get("user-agent"),
      caller_referer: req.headers.get("referer"),
      body_preview: bodyText.substring(0, 500),
    }),
  );

  return new Response(
    JSON.stringify({
      error: "research-lead-company is deprecated as of 2026-05-14 (M10). Pre-decision research was dropped; post-routing research is handled by research-company, invoked async by route-lead (v2).",
      deprecated: true,
      replacement: { post_routing: "research-company (invoked by route-lead v2)" },
      version: "deprecated-stub-v1",
    }),
    { status: 410, headers: { ...cors(), "Content-Type": "application/json" } },
  );
});
