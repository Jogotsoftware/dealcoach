import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  discoverAuthServer,
  registerClient,
  makePkce,
  pkceChallenge,
  exchangeCode,
  GRANOLA_MCP_URL,
  McpClient,
  mcpResultJson,
  mcpResultText,
} from "../_shared/granola-mcp.ts";

// granola-auth v1
// Per-user Granola MCP OAuth connection.
//   POST { action: 'start' }       (Authorization: user JWT) -> { authorize_url }
//   GET  /granola-auth/callback?code=&state=                 -> HTML postMessage page
//   POST { action: 'status' }      (Authorization: user JWT) -> { connected, granola_email }
//   POST { action: 'disconnect' }  (Authorization: user JWT) -> { success }
//
// Flow notes: 'start' is called via fetch WITH the user's JWT and returns the
// authorize URL for the UI to open in a popup — the JWT never rides a URL.
// The callback carries only code+state; we find the owning user by the state
// stored server-side in auth_state.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/granola-auth/callback`;

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  };
}
function jr(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), "Content-Type": "application/json" } });
}
function htmlPage(body: string) {
  return new Response(body, { status: 200, headers: { ...cors(), "Content-Type": "text/html" } });
}

async function resolveUser(req: Request, sb: ReturnType<typeof createClient>) {
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return null;
  const { data, error } = await sb.auth.getUser(jwt);
  if (error || !data?.user) return null;
  return data.user;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const url = new URL(req.url);

  try {
    // ── Callback (browser redirect from Granola's auth server) ──
    if (req.method === "GET" && url.pathname.endsWith("/callback")) {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const oauthError = url.searchParams.get("error");
      const fail = (msg: string) =>
        htmlPage(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">
          <p>Granola connection failed: ${msg.replace(/</g, "&lt;")}</p>
          <script>try{window.opener&&window.opener.postMessage({type:'granola-connect-error',message:${JSON.stringify(msg)}},'*')}catch(e){};setTimeout(function(){window.close()},4000)</script>
          </body></html>`);

      if (oauthError) return fail(`granola-auth v1: provider returned ${oauthError}`);
      if (!code || !state) return fail("granola-auth v1: missing code or state");

      // Locate the connection row by stored state.
      const { data: conn, error: connErr } = await sb
        .from("user_granola_connections")
        .select("*")
        .eq("auth_state->>state", state)
        .maybeSingle();
      if (connErr || !conn) return fail("granola-auth v1: unknown or expired state");

      const verifier = conn.auth_state?.verifier;
      const clientId = conn.client_registration?.client_id;
      if (!verifier || !clientId) return fail("granola-auth v1: missing PKCE verifier or client registration");

      const meta = await discoverAuthServer();
      let tokens: any;
      try {
        tokens = await exchangeCode(meta, clientId, code, verifier, REDIRECT_URI);
      } catch (e: any) {
        return fail(e?.message || "token exchange failed");
      }

      // Best-effort: capture the connected account email for display.
      let granolaEmail: string | null = null;
      try {
        const mcp = new McpClient(tokens.access_token);
        await mcp.initialize();
        const acct = await mcp.toolsCall("get_account_info", {});
        const j = mcpResultJson(acct);
        granolaEmail = j?.email || j?.user?.email || null;
        if (!granolaEmail) {
          const t = mcpResultText(acct);
          const m = t.match(/[\w.+-]+@[\w-]+\.[\w.]+/);
          granolaEmail = m ? m[0] : null;
        }
      } catch (e) {
        console.error("granola-auth v1: get_account_info failed (non-fatal):", (e as any)?.message);
      }

      const { error: upErr } = await sb
        .from("user_granola_connections")
        .update({
          status: "connected",
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token || null,
          token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
          granola_email: granolaEmail,
          auth_state: null,
          last_used_at: new Date().toISOString(),
        })
        .eq("id", conn.id);
      if (upErr) return fail(`granola-auth v1: failed to persist connection: ${upErr.message}`);

      return htmlPage(`<!doctype html><html><body style="font-family:sans-serif;padding:24px">
        <p>Granola connected${granolaEmail ? ` as ${granolaEmail}` : ""}. You can close this window.</p>
        <script>try{window.opener&&window.opener.postMessage({type:'granola-connected',email:${JSON.stringify(granolaEmail)}},'*')}catch(e){};setTimeout(function(){window.close()},1500)</script>
        </body></html>`);
    }

    // ── Authenticated JSON actions ──
    if (req.method !== "POST") return jr({ error: "granola-auth v1: POST required" }, 405);
    const user = await resolveUser(req, sb);
    if (!user) return jr({ error: "granola-auth v1: not authenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action || "start";

    if (action === "status") {
      const { data: conn } = await sb
        .from("user_granola_connections")
        .select("status, granola_email")
        .eq("user_id", user.id)
        .maybeSingle();
      return jr({
        connected: conn?.status === "connected",
        status: conn?.status || "disconnected",
        granola_email: conn?.granola_email || null,
        version: "granola-auth v1",
      });
    }

    if (action === "disconnect") {
      const { error: e } = await sb
        .from("user_granola_connections")
        .update({ status: "disconnected", access_token: null, refresh_token: null, token_expires_at: null, auth_state: null })
        .eq("user_id", user.id);
      if (e) return jr({ error: `granola-auth v1: disconnect failed: ${e.message}` }, 500);
      return jr({ success: true, version: "granola-auth v1" });
    }

    if (action === "start") {
      // Resolve the caller's org for the row.
      const { data: profile } = await sb.from("profiles").select("org_id").eq("id", user.id).single();
      if (!profile?.org_id) return jr({ error: "granola-auth v1: caller has no org" }, 400);

      const meta = await discoverAuthServer();

      // Reuse existing DCR registration when present; register otherwise.
      const { data: existing } = await sb
        .from("user_granola_connections")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      let registration = existing?.client_registration || null;
      const registeredRedirects: string[] = registration?.redirect_uris || [];
      if (!registration?.client_id || !registeredRedirects.includes(REDIRECT_URI)) {
        registration = await registerClient(meta, REDIRECT_URI);
      }

      const { verifier } = makePkce();
      const challenge = await pkceChallenge(verifier);
      const state = crypto.randomUUID();

      const authState = { state, verifier, created_at: new Date().toISOString() };
      if (existing) {
        const { error: e } = await sb
          .from("user_granola_connections")
          .update({ client_registration: registration, auth_state: authState })
          .eq("id", existing.id);
        if (e) return jr({ error: `granola-auth v1: state persist failed: ${e.message}` }, 500);
      } else {
        const { error: e } = await sb.from("user_granola_connections").insert({
          user_id: user.id,
          org_id: profile.org_id,
          status: "disconnected",
          client_registration: registration,
          auth_state: authState,
        });
        if (e) return jr({ error: `granola-auth v1: connection insert failed: ${e.message}` }, 500);
      }

      const authorize = new URL(meta.authorization_endpoint);
      authorize.searchParams.set("response_type", "code");
      authorize.searchParams.set("client_id", registration.client_id);
      authorize.searchParams.set("redirect_uri", REDIRECT_URI);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      authorize.searchParams.set("resource", GRANOLA_MCP_URL);
      // offline_access is required for a refresh token on Granola's AS
      // (verified via .well-known scopes_supported); openid/email/profile
      // give us the account email for the "Connected as ..." display.
      authorize.searchParams.set("scope", registration.scope || "openid email profile offline_access");

      return jr({ authorize_url: authorize.toString(), version: "granola-auth v1" });
    }

    return jr({ error: `granola-auth v1: unknown action '${action}'` }, 400);
  } catch (e: any) {
    console.error("granola-auth v1 error:", e);
    return jr({ error: `granola-auth v1: ${e?.message || e}` }, 500);
  }
});
