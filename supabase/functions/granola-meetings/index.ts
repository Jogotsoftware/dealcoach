import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "../_shared/granola-mcp.ts";

// granola-meetings v1
// POST { time_range, custom_start?, custom_end?, folder_id? } (Authorization: user JWT)
// -> { meetings: [{ id, title, date, participants }] }
// time_range in [this_week, last_week, last_30_days, custom].

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

// Normalizes whatever shape list_meetings returns into the UI contract.
function normalizeMeetings(result: any): Array<{ id: string; title: string; date: string | null; participants: string[] }> {
  const j = mcpResultJson(result);
  let raw: any[] = [];
  if (Array.isArray(j)) raw = j;
  else if (Array.isArray(j?.meetings)) raw = j.meetings;
  else if (Array.isArray(j?.results)) raw = j.results;
  else {
    // Some MCP servers return one text block per meeting; try line-delimited JSON.
    const text = mcpResultText(result);
    for (const line of text.split("\n")) {
      try {
        const obj = JSON.parse(line);
        if (obj?.id) raw.push(obj);
      } catch (_) { /* not JSON, skip */ }
    }
  }
  return raw
    .filter((m) => m && (m.id || m.meeting_id))
    .map((m) => ({
      id: String(m.id || m.meeting_id),
      title: String(m.title || m.name || "Untitled meeting"),
      date: m.date || m.start_time || m.created_at || null,
      participants: (Array.isArray(m.participants) ? m.participants : Array.isArray(m.attendees) ? m.attendees : [])
        .map((p: any) => (typeof p === "string" ? p : p?.name || p?.email || ""))
        .filter(Boolean),
    }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jr({ error: "granola-meetings v1: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jr({ error: "granola-meetings v1: not authenticated" }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jr({ error: "granola-meetings v1: not authenticated" }, 401);
    const userId = userData.user.id;

    const { data: conn, error: connErr } = await sb
      .from("user_granola_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (connErr) return jr({ error: `granola-meetings v1: connection lookup failed: ${connErr.message}` }, 500);
    if (!conn || conn.status !== "connected") {
      return jr({ error: "granola-meetings v1: not connected", reconnect: true }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const timeRange = body.time_range || "last_30_days";
    const args: Record<string, unknown> = { time_range: timeRange };
    if (timeRange === "custom") {
      if (body.custom_start) args.custom_start = body.custom_start;
      if (body.custom_end) args.custom_end = body.custom_end;
    }
    if (body.folder_id) args.folder_id = body.folder_id;

    let accessToken: string;
    try {
      accessToken = await ensureFreshToken(sb, conn, "granola-meetings v1");
    } catch (e: any) {
      return jr({ error: e?.message || "granola-meetings v1: reconnect required", reconnect: true }, 401);
    }

    const mcp = new McpClient(accessToken);
    let result: any;
    try {
      await mcp.initialize();
      result = await mcp.toolsCall("list_meetings", args);
    } catch (e: any) {
      // One retry after a forced refresh on auth failures.
      if (String(e?.message || "").includes("401")) {
        try {
          conn.token_expires_at = new Date(0).toISOString(); // force refresh
          accessToken = await ensureFreshToken(sb, conn, "granola-meetings v1");
          const mcp2 = new McpClient(accessToken);
          await mcp2.initialize();
          result = await mcp2.toolsCall("list_meetings", args);
        } catch (e2: any) {
          return jr({ error: `granola-meetings v1: ${e2?.message || e2}`, reconnect: true }, 401);
        }
      } else {
        return jr({ error: `granola-meetings v1: ${e?.message || e}` }, 502);
      }
    }

    const meetings = normalizeMeetings(result);
    try {
      await sb.from("user_granola_connections").update({ last_used_at: new Date().toISOString() }).eq("id", conn.id);
    } catch (_) { /* non-fatal */ }

    return jr({ success: true, version: "granola-meetings v1", meetings, granola_email: conn.granola_email });
  } catch (e: any) {
    console.error("granola-meetings v1 error:", e);
    return jr({ error: `granola-meetings v1: ${e?.message || e}` }, 500);
  }
});
