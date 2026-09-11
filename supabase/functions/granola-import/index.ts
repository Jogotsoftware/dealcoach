import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { importGranolaMeeting, GranolaImportError } from "../_shared/granola-import-core.ts";

// granola-import v3
// POST { deal_id, meeting_id, call_type?, call_date?, title? } (Authorization: user JWT)
// Thin wrapper around _shared/granola-import-core.ts (shared with granola-sync):
// validates the caller, confirms same-org access to the deal, then delegates the
// transcript pull + clean + insert + process chain to importGranolaMeeting.
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
  if (req.method !== "POST") return jr({ error: "granola-import v3: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jr({ error: "granola-import v3: not authenticated" }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jr({ error: "granola-import v3: not authenticated" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const dealId = body.deal_id;
    const meetingId = body.meeting_id;
    if (!dealId) return jr({ error: "granola-import v3: deal_id missing" }, 400);
    if (!meetingId) return jr({ error: "granola-import v3: meeting_id missing" }, 400);

    // Caller must actually have access to the deal: same-org check.
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).single();
    const { data: deal, error: dealErr } = await sb.from("deals").select("id, org_id").eq("id", dealId).single();
    if (dealErr || !deal) return jr({ error: "granola-import v3: deal not found" }, 404);
    if (!profile?.org_id || profile.org_id !== deal.org_id) {
      return jr({ error: "granola-import v3: deal not in caller org" }, 403);
    }

    const { data: conn, error: connErr } = await sb
      .from("user_granola_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (connErr) return jr({ error: `granola-import v3: connection lookup failed: ${connErr.message}` }, 500);
    if (!conn || conn.status !== "connected") {
      return jr({ error: "granola-import v3: not connected", reconnect: true }, 401);
    }

    const result = await importGranolaMeeting(
      sb,
      conn,
      { deal_id: dealId, meeting_id: meetingId, call_type: body.call_type, call_date: body.call_date, title: body.title },
      { supabaseUrl: SUPABASE_URL, serviceKey: SERVICE_KEY, fnTag: "granola-import v3" },
    );

    return jr({
      success: true,
      version: "granola-import v3",
      conversation_id: result.conversation_id,
      transcript_length: result.transcript_length,
      truncated: result.truncated,
      ...(result.already_imported ? { already_imported: true } : {}),
    });
  } catch (e: any) {
    if (e instanceof GranolaImportError) {
      return jr({ error: e.message, ...(e.reconnect ? { reconnect: true } : {}) }, e.status);
    }
    console.error("granola-import v3 error:", e);
    return jr({ error: `granola-import v3: ${e?.message || e}` }, 500);
  }
});
