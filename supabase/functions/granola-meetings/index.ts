import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "../_shared/granola-mcp.ts";

// granola-meetings v2
// POST { time_range, custom_start?, custom_end?, folder_id? } (Authorization: user JWT)
//   -> { meetings: [{ id, title, date, participants }] }
//   time_range in [this_week, last_week, last_30_days, custom].
//   When folder_id is absent, the connection's default_folder_id (set in
//   Settings) scopes the list automatically.
// POST { list: 'folders' } -> { folders: [{ id, title, description, note_count }] }

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

function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Best-effort ISO conversion for Granola's human dates ("Jun 9, 2026 6:08 PM
// EDT"). granola-import substrings the first 10 chars into a date column, so
// non-ISO strings must be converted here or import would get garbage.
function toIso(dateRaw: string | null): string | null {
  if (!dateRaw) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(dateRaw)) return dateRaw;
  let d = new Date(dateRaw);
  if (isNaN(d.getTime())) d = new Date(dateRaw.replace(/\s+[A-Z]{2,4}$/, ""));
  return isNaN(d.getTime()) ? dateRaw : d.toISOString();
}

// Granola's MCP returns list_meetings as XML-style text (verified live):
//   <meetings_data from="..." to="..." count="N">
//     <meeting id="uuid" title="..." date="Jun 9, 2026 6:08 PM EDT">
//       <known_participants>
//       Name (note creator) <email>, Name2 from Org <email2>
//       </known_participants>
//     </meeting>...
function parseXmlMeetings(text: string): Array<{ id: string; title: string; date: string | null; participants: string[] }> {
  const out: Array<{ id: string; title: string; date: string | null; participants: string[] }> = [];
  const meetingRe = /<meeting\s+([^>]*)>([\s\S]*?)<\/meeting>/g;
  let m: RegExpExecArray | null;
  while ((m = meetingRe.exec(text))) {
    const attrs = m[1];
    const body = m[2];
    const id = (attrs.match(/id="([^"]*)"/) || [])[1];
    if (!id) continue;
    const title = decodeEntities((attrs.match(/title="([^"]*)"/) || [])[1] || "Untitled meeting");
    const dateRaw = (attrs.match(/date="([^"]*)"/) || [])[1] || null;
    const partBlock = (body.match(/<known_participants>([\s\S]*?)<\/known_participants>/) || [])[1] || "";
    const participants: string[] = [];
    const pRe = /([^,<>\n]+?)(?:\s*\(note creator\))?\s*<[^<>@\s]+@[^<>\s]+>/g;
    let p: RegExpExecArray | null;
    while ((p = pRe.exec(partBlock))) {
      const name = p[1].trim().replace(/^,\s*/, "").trim();
      if (name) participants.push(name);
    }
    out.push({ id, title, date: toIso(dateRaw), participants });
  }
  return out;
}

// Normalizes whatever shape list_meetings returns into the UI contract.
// Granola currently speaks the XML-style text format; the JSON paths are kept
// as forward-compat in case the server starts returning structured content.
function normalizeMeetings(result: any): Array<{ id: string; title: string; date: string | null; participants: string[] }> {
  const j = mcpResultJson(result);
  let raw: any[] = [];
  if (Array.isArray(j)) raw = j;
  else if (Array.isArray(j?.meetings)) raw = j.meetings;
  else if (Array.isArray(j?.results)) raw = j.results;

  if (raw.length) {
    return raw
      .filter((m) => m && (m.id || m.meeting_id))
      .map((m) => ({
        id: String(m.id || m.meeting_id),
        title: String(m.title || m.name || "Untitled meeting"),
        date: toIso(m.date || m.start_time || m.created_at || null),
        participants: (Array.isArray(m.participants) ? m.participants : Array.isArray(m.attendees) ? m.attendees : [])
          .map((p: any) => (typeof p === "string" ? p : p?.name || p?.email || ""))
          .filter(Boolean),
      }));
  }

  // XML-style text format (the live behavior).
  const text = mcpResultText(result);
  if (text.includes("<meeting")) return parseXmlMeetings(text);
  return [];
}

// Folders arrive as clean JSON ({ count, folders: [...] }) — verified live.
function normalizeFolders(result: any): Array<{ id: string; title: string; description: string | null; note_count: number }> {
  const j = mcpResultJson(result);
  const raw = Array.isArray(j?.folders) ? j.folders : Array.isArray(j) ? j : [];
  return raw
    .filter((f: any) => f && f.id)
    .map((f: any) => ({
      id: String(f.id),
      title: String(f.title || f.name || "Untitled folder"),
      description: f.description || null,
      note_count: Number(f.note_count) || 0,
    }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jr({ error: "granola-meetings v2: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jr({ error: "granola-meetings v2: not authenticated" }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jr({ error: "granola-meetings v2: not authenticated" }, 401);
    const userId = userData.user.id;

    const { data: conn, error: connErr } = await sb
      .from("user_granola_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (connErr) return jr({ error: `granola-meetings v2: connection lookup failed: ${connErr.message}` }, 500);
    if (!conn || conn.status !== "connected") {
      return jr({ error: "granola-meetings v2: not connected", reconnect: true }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const wantFolders = body.list === "folders";

    const toolName = wantFolders ? "list_meeting_folders" : "list_meetings";
    let args: Record<string, unknown> = {};
    if (!wantFolders) {
      const timeRange = body.time_range || "last_30_days";
      args = { time_range: timeRange };
      if (timeRange === "custom") {
        if (body.custom_start) args.custom_start = body.custom_start;
        if (body.custom_end) args.custom_end = body.custom_end;
      }
      // Explicit folder_id wins; '' (All meetings) suppresses the default.
      if (body.folder_id) args.folder_id = body.folder_id;
      else if (body.folder_id !== "" && conn.default_folder_id) args.folder_id = conn.default_folder_id;
    }

    let accessToken: string;
    try {
      accessToken = await ensureFreshToken(sb, conn, "granola-meetings v2");
    } catch (e: any) {
      return jr({ error: e?.message || "granola-meetings v2: reconnect required", reconnect: true }, 401);
    }

    const mcp = new McpClient(accessToken);
    let result: any;
    try {
      await mcp.initialize();
      result = await mcp.toolsCall(toolName, args);
    } catch (e: any) {
      // One retry after a forced refresh on auth failures.
      if (String(e?.message || "").includes("401")) {
        try {
          accessToken = await ensureFreshToken(sb, conn, "granola-meetings v2", true);
          const mcp2 = new McpClient(accessToken);
          await mcp2.initialize();
          result = await mcp2.toolsCall(toolName, args);
        } catch (e2: any) {
          return jr({ error: `granola-meetings v2: ${e2?.message || e2}`, reconnect: true }, 401);
        }
      } else {
        return jr({ error: `granola-meetings v2: ${e?.message || e}` }, 502);
      }
    }

    try {
      await sb.from("user_granola_connections").update({ last_used_at: new Date().toISOString() }).eq("id", conn.id);
    } catch (_) { /* non-fatal */ }

    if (wantFolders) {
      return jr({ success: true, version: "granola-meetings v2", folders: normalizeFolders(result), granola_email: conn.granola_email });
    }
    return jr({
      success: true,
      version: "granola-meetings v2",
      meetings: normalizeMeetings(result),
      granola_email: conn.granola_email,
      active_folder: args.folder_id ? { id: args.folder_id, name: args.folder_id === conn.default_folder_id ? conn.default_folder_name : null } : null,
    });
  } catch (e: any) {
    console.error("granola-meetings v2 error:", e);
    return jr({ error: `granola-meetings v2: ${e?.message || e}` }, 500);
  }
});
