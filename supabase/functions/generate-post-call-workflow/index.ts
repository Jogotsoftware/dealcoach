// generate-post-call-workflow v1
//
// For a given conversation, reads the call_type's must-haves of type 'workflow' from
// coach_call_type_must_haves and generates tasks (workflow_kind = 'task') or coaching_nudges
// (workflow_kind = 'reminder'). Idempotent: re-running for the same conversation+must_have
// pair does NOT duplicate.
//
// Conditional logic:
//   "if MFG/WD"        -> match company_profile.industry against manufacturing or wholesale dist.
//   "if integrations"  -> match company_systems with is_needed=true OR integration_purpose set
//   other "if ..."     -> skipped in v1 with TODO log

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VERSION = "generate-post-call-workflow v1";

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

function isMfgOrWd(industry: string | null | undefined): boolean {
  if (!industry) return false;
  const t = industry.toLowerCase();
  return t.includes("manufactur") || t.includes("wholesale") || t.includes("distribut");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const reqBody = await req.json().catch(() => ({} as Record<string, unknown>));
    const conversation_id = reqBody.conversation_id as string | undefined;
    if (!conversation_id) throw new Error(`${VERSION}: conversation_id required`);

    // 1. Load conversation
    const { data: conv, error: cvErr } = await sb
      .from("conversations")
      .select("id, deal_id, call_type, created_at, call_date")
      .eq("id", conversation_id).maybeSingle();
    if (cvErr) throw new Error(`${VERSION}: conversations select error: ${cvErr.message}`);
    if (!conv) throw new Error(`${VERSION}: conversation_id not found: ${conversation_id}`);
    const callType = conv.call_type as string | null;
    if (!callType) {
      return jr({ success: true, version: "v1", conversation_id, message: "Call has no call_type — no workflow generated." });
    }

    // 2. Load deal + company_profile + company_systems
    const { data: deal, error: dErr } = await sb
      .from("deals")
      .select("id, org_id, rep_id, company_name")
      .eq("id", conv.deal_id).maybeSingle();
    if (dErr) throw new Error(`${VERSION}: deals select error: ${dErr.message}`);
    if (!deal) throw new Error(`${VERSION}: deal not found for conversation ${conversation_id}`);

    const { data: rep } = await sb
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", deal.rep_id).maybeSingle();

    const { data: companyProfile } = await sb
      .from("company_profile")
      .select("industry")
      .eq("deal_id", deal.id).maybeSingle();

    const { data: systems } = await sb
      .from("company_systems")
      .select("id, is_needed, integration_purpose")
      .eq("deal_id", deal.id);
    const hasIntegrations = (systems ?? []).some((s: Record<string, unknown>) =>
      s.is_needed === true || (s.integration_purpose != null && String(s.integration_purpose).length > 0),
    );

    // 3. Resolve coach for this deal's org, then load workflow must-haves for the call_type
    const { data: coach } = await sb
      .from("coaches")
      .select("id")
      .eq("org_id", deal.org_id)
      .eq("active", true)
      .order("updated_at", { ascending: false })
      .limit(1).maybeSingle();
    if (!coach) throw new Error(`${VERSION}: no active coach for org ${deal.org_id}`);

    const { data: mhs, error: mhErr } = await sb
      .from("coach_call_type_must_haves")
      .select("id, title, description, conditional_text, workflow_kind, workflow_due_hours, workflow_template")
      .eq("coach_id", coach.id)
      .eq("call_type", callType)
      .eq("must_have_type", "workflow");
    if (mhErr) throw new Error(`${VERSION}: must_haves select error: ${mhErr.message}`);
    const mustHaves = (mhs ?? []) as Array<{
      id: string;
      title: string;
      description: string | null;
      conditional_text: string | null;
      workflow_kind: "reminder" | "task" | null;
      workflow_due_hours: number | null;
      workflow_template: string | null;
    }>;

    const created: Array<{ must_have_id: string; kind: string; skipped?: boolean; reason?: string }> = [];

    for (const mh of mustHaves) {
      // Conditional gate
      const cond = (mh.conditional_text ?? "").trim();
      if (cond) {
        const cLower = cond.toLowerCase();
        if (cLower.includes("mfg") || cLower.includes("wd") || cLower.includes("manufactur") || cLower.includes("wholesale")) {
          if (!isMfgOrWd(companyProfile?.industry as string | null)) {
            created.push({ must_have_id: mh.id, kind: mh.workflow_kind ?? "task", skipped: true, reason: "conditional: not MFG/WD" });
            continue;
          }
        } else if (cLower.includes("integration")) {
          if (!hasIntegrations) {
            created.push({ must_have_id: mh.id, kind: mh.workflow_kind ?? "task", skipped: true, reason: "conditional: no integrations" });
            continue;
          }
        } else {
          // Other conditionals not yet implemented — log and skip
          console.log(`${VERSION}: TODO conditional "${cond}" not implemented; skipping must-have ${mh.id}`);
          created.push({ must_have_id: mh.id, kind: mh.workflow_kind ?? "task", skipped: true, reason: `conditional not implemented: ${cond}` });
          continue;
        }
      }

      const dueHours = mh.workflow_due_hours ?? 24;
      const dueAt = new Date(new Date(conv.created_at as string).getTime() + dueHours * 3600 * 1000).toISOString();
      const message = mh.workflow_template ?? mh.description ?? mh.title;

      if (mh.workflow_kind === "reminder") {
        // Idempotency: skip if active non-dismissed nudge already exists for this conversation+must_have
        const { data: existingNudges } = await sb
          .from("coaching_nudges")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("nudge_type", "post_call_reminder")
          .eq("dismissed", false)
          .contains("action_target", `conversation_id=${conversation_id}`); // best-effort marker

        // Check via action_target containing conv id+must_have id marker
        // Use a strict approach: store marker in action_target query string for lookup
        const markerSuffix = `?source=post_call&conversation_id=${conversation_id}&must_have_id=${mh.id}`;
        const action_target = `/deal/${deal.id}${markerSuffix}`;

        const { data: dup } = await sb
          .from("coaching_nudges")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("nudge_type", "post_call_reminder")
          .eq("action_target", action_target)
          .eq("dismissed", false)
          .maybeSingle();
        if (dup) {
          created.push({ must_have_id: mh.id, kind: "reminder", skipped: true, reason: "idempotent: existing nudge" });
          continue;
        }
        void existingNudges; // suppress unused warning

        const { error } = await sb.from("coaching_nudges").insert({
          org_id: deal.org_id,
          deal_id: deal.id,
          user_id: deal.rep_id,
          nudge_type: "post_call_reminder",
          severity: "attention",
          title: mh.title,
          message,
          action_label: "Open deal",
          action_target,
          expires_at: dueAt,
        });
        if (error) {
          console.log(`${VERSION}: coaching_nudges insert error for must_have ${mh.id}`, error.message);
        }
        created.push({ must_have_id: mh.id, kind: "reminder" });
      } else {
        // task (default if workflow_kind is null but template exists)
        // Idempotency: metadata->>'conversation_id' AND metadata->>'must_have_id'
        const { data: existing } = await sb
          .from("tasks")
          .select("id")
          .eq("deal_id", deal.id)
          .eq("source", "sage_canon_post_call")
          .filter("metadata->>conversation_id", "eq", conversation_id)
          .filter("metadata->>must_have_id", "eq", mh.id)
          .maybeSingle();
        if (existing) {
          created.push({ must_have_id: mh.id, kind: "task", skipped: true, reason: "idempotent: existing task" });
          continue;
        }

        const { error } = await sb.from("tasks").insert({
          deal_id: deal.id,
          conversation_id,
          source_conversation_id: conversation_id,
          title: message,
          notes: mh.description ?? null,
          priority: "medium",
          due_date: dueAt,
          owner: rep?.full_name ?? null,
          rep_email: rep?.email ?? null,
          rep_name: rep?.full_name ?? null,
          auto_generated: true,
          source: "sage_canon_post_call",
          metadata: { conversation_id, must_have_id: mh.id, call_type: callType, title: mh.title },
        });
        if (error) {
          console.log(`${VERSION}: tasks insert error for must_have ${mh.id}`, error.message);
        }
        created.push({ must_have_id: mh.id, kind: "task" });
      }
    }

    return jr({
      success: true, version: "v1",
      conversation_id, deal_id: deal.id, call_type: callType,
      processed: created.length,
      created: created.filter((c) => !c.skipped).length,
      skipped: created.filter((c) => c.skipped).length,
      detail: created,
      total_ms: Date.now() - t0,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(VERSION, msg);
    return jr({ success: false, version: "v1", error: msg }, 500);
  }
});
