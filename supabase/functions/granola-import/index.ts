import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "../_shared/granola-mcp.ts";

// granola-import v1
// POST { deal_id, meeting_id, call_type?, call_date?, title? } (Authorization: user JWT)
// Pulls the verbatim transcript from Granola via MCP, inserts a conversations
// row (source='granola'), and fires process-transcript in the background —
// the back half mirrors import-transcript-url so analysis behaves identically.
// Idempotent on (deal_id, granola_meeting_id).

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jr({ error: "granola-import v1: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jr({ error: "granola-import v1: not authenticated" }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jr({ error: "granola-import v1: not authenticated" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const dealId = body.deal_id;
    const meetingId = body.meeting_id;
    if (!dealId) return jr({ error: "granola-import v1: deal_id missing" }, 400);
    if (!meetingId) return jr({ error: "granola-import v1: meeting_id missing" }, 400);

    // Caller must actually have access to the deal: same-org check.
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).single();
    const { data: deal, error: dealErr } = await sb.from("deals").select("id, org_id").eq("id", dealId).single();
    if (dealErr || !deal) return jr({ error: "granola-import v1: deal not found" }, 404);
    if (!profile?.org_id || profile.org_id !== deal.org_id) {
      return jr({ error: "granola-import v1: deal not in caller org" }, 403);
    }

    // Idempotency: same meeting already imported into this deal -> return it.
    const { data: existing } = await sb
      .from("conversations")
      .select("id, transcript")
      .eq("deal_id", dealId)
      .eq("granola_meeting_id", meetingId)
      .maybeSingle();
    if (existing) {
      return jr({
        success: true,
        version: "granola-import v1",
        conversation_id: existing.id,
        transcript_length: existing.transcript?.length || 0,
        already_imported: true,
      });
    }

    const { data: conn, error: connErr } = await sb
      .from("user_granola_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (connErr) return jr({ error: `granola-import v1: connection lookup failed: ${connErr.message}` }, 500);
    if (!conn || conn.status !== "connected") {
      return jr({ error: "granola-import v1: not connected", reconnect: true }, 401);
    }

    let accessToken: string;
    try {
      accessToken = await ensureFreshToken(sb, conn, "granola-import v1");
    } catch (e: any) {
      return jr({ error: e?.message || "granola-import v1: reconnect required", reconnect: true }, 401);
    }

    const mcp = new McpClient(accessToken);
    await mcp.initialize();

    // Verbatim transcript (the only provenance-grade artifact).
    let transcriptResult: any;
    try {
      transcriptResult = await mcp.toolsCall("get_meeting_transcript", { meeting_id: meetingId });
    } catch (e: any) {
      return jr({ error: `granola-import v1: transcript fetch failed: ${e?.message || e}` }, 502);
    }
    const transcript = mcpResultText(transcriptResult).trim();
    if (!transcript || transcript.length < 200) {
      return jr({
        error: "granola-import v1: transcript empty or too short — Granola may require approval for transcript access on this call",
      }, 422);
    }

    // Best-effort meeting metadata: title/date fallbacks + share link.
    // Granola's AI summary/notes are CONTEXT-ONLY per the provenance spine —
    // stored for display, never provenance. Kept in conversations.metadata.
    let meta: any = null;
    try {
      const metaResult = await mcp.toolsCall("get_meetings", { meeting_ids: [meetingId] });
      const j = mcpResultJson(metaResult);
      const arr = Array.isArray(j) ? j : Array.isArray(j?.meetings) ? j.meetings : j ? [j] : [];
      meta = arr.find((m: any) => String(m?.id || m?.meeting_id) === String(meetingId)) || arr[0] || null;
    } catch (e) {
      console.error("granola-import v1: get_meetings metadata failed (non-fatal):", (e as any)?.message);
    }

    const title = body.title || meta?.title || "Granola call";
    const callDate = body.call_date || (meta?.date ? String(meta.date).substring(0, 10) : new Date().toISOString().substring(0, 10));
    const shareUrl = meta?.share_url || meta?.shareUrl || meta?.url || null;

    // call_type must satisfy conversations_call_type_check; 'custom' is the
    // neutral default when the UI somehow sends nothing.
    const VALID_CALL_TYPES = ["qdc", "functional_discovery", "demo", "scoping", "cs_sow", "proposal", "negotiation", "sync", "custom"];
    const callType = VALID_CALL_TYPES.includes(body.call_type) ? body.call_type : "custom";

    const insertRow: any = {
      deal_id: dealId,
      title,
      call_type: callType,
      call_date: callDate,
      transcript,
      source: "granola",
      granola_meeting_id: meetingId,
      granola_share_url: shareUrl,
      processed: false,
      tasks_extracted: false,
    };
    if (meta) {
      insertRow.metadata = {
        granola: {
          // CONTEXT-ONLY: AI-generated, never satisfies the quote gate.
          summary: meta.summary || meta.ai_summary || null,
          notes: meta.notes || null,
          action_items: meta.action_items || null,
          attendees: meta.attendees || meta.participants || null,
        },
      };
    }

    let conv: any = null;
    {
      const { data, error } = await sb.from("conversations").insert(insertRow).select("id").single();
      if (error) {
        // metadata column may not exist on this schema; retry without it.
        if (insertRow.metadata && /metadata/.test(error.message)) {
          delete insertRow.metadata;
          const retry = await sb.from("conversations").insert(insertRow).select("id").single();
          if (retry.error) return jr({ error: `granola-import v1: insert conversations failed: ${retry.error.message}` }, 500);
          conv = retry.data;
        } else {
          return jr({ error: `granola-import v1: insert conversations failed: ${error.message}` }, 500);
        }
      } else {
        conv = data;
      }
    }

    try {
      await sb.from("user_granola_connections").update({ last_used_at: new Date().toISOString() }).eq("id", conn.id);
    } catch (_) { /* non-fatal */ }

    // Fire process-transcript in the background, mirroring import-transcript-url.
    try {
      const p = fetch(`${SUPABASE_URL}/functions/v1/process-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
        body: JSON.stringify({ conversation_id: conv.id, deal_id: dealId }),
      }).then(async (r) => {
        if (!r.ok) console.error("granola-import v1 process-transcript non-2xx:", r.status, await r.text());
      }).catch((e) => console.error("granola-import v1 process-transcript error:", e));
      // @ts-ignore EdgeRuntime is provided by the platform
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    } catch (e) {
      console.error("granola-import v1 trigger setup error:", e);
    }

    return jr({
      success: true,
      version: "granola-import v1",
      conversation_id: conv.id,
      transcript_length: transcript.length,
    });
  } catch (e: any) {
    console.error("granola-import v1 error:", e);
    return jr({ error: `granola-import v1: ${e?.message || e}` }, 500);
  }
});
