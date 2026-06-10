// Shared Granola MCP client + OAuth/DCR helpers.
// Used by granola-auth / granola-meetings / granola-import.
//
// Granola exposes no general REST API on the Business plan; the supported
// integration surface is its MCP server (Streamable HTTP transport) at
// https://mcp.granola.ai/mcp with OAuth 2.0 + Dynamic Client Registration.
// This module implements the minimal client side:
//   - RFC 9728 protected-resource metadata discovery
//   - RFC 8414 authorization-server metadata discovery
//   - RFC 7591 dynamic client registration (public client, PKCE)
//   - authorization-code + refresh-token exchanges (RFC 8707 resource param)
//   - JSON-RPC 2.0 over Streamable HTTP: initialize -> notifications/initialized
//     -> tools/call, handling both application/json and text/event-stream replies.

export const GRANOLA_MCP_URL = "https://mcp.granola.ai/mcp";

// ─── Discovery ───────────────────────────────────────────────────────────────

export interface AuthServerMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

// Discovers the authorization server for the Granola MCP resource.
// Order: protected-resource metadata (.well-known/oauth-protected-resource),
// falling back to authorization-server metadata on the MCP origin itself.
export async function discoverAuthServer(): Promise<AuthServerMeta> {
  const mcpUrl = new URL(GRANOLA_MCP_URL);
  const candidates: string[] = [];

  // RFC 9728: protected resource metadata — path-aware then root.
  const prCandidates = [
    `${mcpUrl.origin}/.well-known/oauth-protected-resource${mcpUrl.pathname}`,
    `${mcpUrl.origin}/.well-known/oauth-protected-resource`,
  ];
  for (const prUrl of prCandidates) {
    try {
      const r = await fetch(prUrl, { headers: { Accept: "application/json" } });
      if (r.ok) {
        const meta = await r.json();
        const servers: string[] = meta?.authorization_servers || [];
        for (const s of servers) candidates.push(s);
        if (candidates.length) break;
      }
    } catch (_) { /* try next */ }
  }
  // Fallback: the MCP origin acts as its own authorization server.
  if (!candidates.length) candidates.push(mcpUrl.origin);

  for (const issuer of candidates) {
    const base = issuer.replace(/\/$/, "");
    const asCandidates = [
      `${base}/.well-known/oauth-authorization-server`,
      `${base}/.well-known/openid-configuration`,
    ];
    for (const asUrl of asCandidates) {
      try {
        const r = await fetch(asUrl, { headers: { Accept: "application/json" } });
        if (!r.ok) continue;
        const m = await r.json();
        if (m?.authorization_endpoint && m?.token_endpoint) {
          return {
            issuer: m.issuer || base,
            authorization_endpoint: m.authorization_endpoint,
            token_endpoint: m.token_endpoint,
            registration_endpoint: m.registration_endpoint,
          };
        }
      } catch (_) { /* try next */ }
    }
  }
  throw new Error("granola-mcp: OAuth discovery failed (no authorization server metadata found)");
}

// ─── Dynamic Client Registration (RFC 7591) ──────────────────────────────────

export async function registerClient(meta: AuthServerMeta, redirectUri: string): Promise<any> {
  if (!meta.registration_endpoint) {
    throw new Error("granola-mcp: authorization server does not advertise a registration_endpoint (DCR unsupported)");
  }
  const r = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: "Lumen by Revenue Instruments",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none", // public client; PKCE carries the proof
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`granola-mcp: DCR failed ${r.status}: ${body.slice(0, 300)}`);
  }
  return await r.json();
}

// ─── PKCE ────────────────────────────────────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function makePkce(): { verifier: string } {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return { verifier: b64url(bytes) };
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ─── Token exchanges ─────────────────────────────────────────────────────────

export async function exchangeCode(meta: AuthServerMeta, clientId: string, code: string, verifier: string, redirectUri: string): Promise<any> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: GRANOLA_MCP_URL, // RFC 8707 — MCP requires audience binding
  });
  const r = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`granola-mcp: code exchange failed ${r.status}: ${t.slice(0, 300)}`);
  }
  return await r.json();
}

export async function refreshTokens(meta: AuthServerMeta, clientId: string, refreshToken: string): Promise<any> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    resource: GRANOLA_MCP_URL,
  });
  const r = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`granola-mcp: token refresh failed ${r.status}: ${t.slice(0, 300)}`);
  }
  return await r.json();
}

// ─── Minimal MCP-over-Streamable-HTTP client ─────────────────────────────────

// Parses an MCP HTTP response that may be plain JSON or an SSE stream; returns
// the JSON-RPC payload matching the request id (or the first result payload).
async function parseMcpResponse(r: Response, expectId: number): Promise<any> {
  const ctype = r.headers.get("content-type") || "";
  if (ctype.includes("text/event-stream")) {
    const text = await r.text();
    // SSE: scan data: lines, parse each JSON, return the one with our id.
    let fallback: any = null;
    for (const line of text.split("\n")) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      try {
        const obj = JSON.parse(m[1]);
        if (obj?.id === expectId) return obj;
        if (obj?.result !== undefined || obj?.error !== undefined) fallback = obj;
      } catch (_) { /* keep scanning */ }
    }
    if (fallback) return fallback;
    throw new Error("granola-mcp: SSE response contained no JSON-RPC payload");
  }
  return await r.json();
}

export class McpClient {
  private accessToken: string;
  private sessionId: string | null = null;
  private nextId = 1;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${this.accessToken}`,
    };
    if (this.sessionId) h["Mcp-Session-Id"] = this.sessionId;
    return h;
  }

  async initialize(): Promise<void> {
    const id = this.nextId++;
    const r = await fetch(GRANOLA_MCP_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "lumen-edge", version: "1.0.0" },
        },
      }),
    });
    if (r.status === 401) throw new Error("granola-mcp: 401 unauthorized (token expired or revoked)");
    if (!r.ok) throw new Error(`granola-mcp: initialize failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
    this.sessionId = r.headers.get("Mcp-Session-Id") || r.headers.get("mcp-session-id");
    const payload = await parseMcpResponse(r, id);
    if (payload?.error) throw new Error(`granola-mcp: initialize error: ${JSON.stringify(payload.error).slice(0, 300)}`);

    // Spec: client must send notifications/initialized after a successful init.
    try {
      await fetch(GRANOLA_MCP_URL, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
    } catch (_) { /* non-fatal */ }
  }

  async toolsCall(name: string, args: Record<string, unknown>): Promise<any> {
    const id = this.nextId++;
    const r = await fetch(GRANOLA_MCP_URL, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    });
    if (r.status === 401) throw new Error("granola-mcp: 401 unauthorized (token expired or revoked)");
    if (!r.ok) throw new Error(`granola-mcp: tools/call ${name} failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const payload = await parseMcpResponse(r, id);
    if (payload?.error) throw new Error(`granola-mcp: ${name} error: ${JSON.stringify(payload.error).slice(0, 300)}`);
    return payload?.result;
  }
}

// Flattens an MCP tool result's content blocks to text. Tool results arrive as
// { content: [{type:'text', text:'...'}, ...], structuredContent?, isError? }.
export function mcpResultText(result: any): string {
  if (!result) return "";
  if (typeof result === "string") return result;
  const blocks = Array.isArray(result.content) ? result.content : [];
  return blocks
    .filter((b: any) => b?.type === "text" && typeof b.text === "string")
    .map((b: any) => b.text)
    .join("\n");
}

// Best-effort JSON parse of a tool result: prefers structuredContent, then
// tries to parse the text blocks as JSON, then returns null.
export function mcpResultJson(result: any): any {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = mcpResultText(result);
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return null; }
}

// ─── Connection token management (shared by meetings/import) ────────────────

// Ensures the connection has a usable access token, refreshing when expired.
// Mutates + persists the row via the provided service-role client. Returns the
// access token, or throws with a reconnect-worthy message.
export async function ensureFreshToken(sb: any, conn: any, fnTag: string): Promise<string> {
  const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
  const needsRefresh = !conn.access_token || (expiresAt > 0 && expiresAt - Date.now() < 60_000);
  if (!needsRefresh) return conn.access_token;

  if (!conn.refresh_token) throw new Error(`${fnTag}: token expired and no refresh token; reconnect required`);
  const clientId = conn.client_registration?.client_id;
  if (!clientId) throw new Error(`${fnTag}: missing client registration; reconnect required`);

  const meta = await discoverAuthServer();
  let tokens: any;
  try {
    tokens = await refreshTokens(meta, clientId, conn.refresh_token);
  } catch (e: any) {
    try {
      await sb.from("user_granola_connections").update({ status: "error" }).eq("id", conn.id);
    } catch (_) { /* non-fatal */ }
    throw new Error(`${fnTag}: refresh failed; reconnect required (${e?.message || e})`);
  }

  const update: any = {
    access_token: tokens.access_token,
    status: "connected",
  };
  if (tokens.refresh_token) update.refresh_token = tokens.refresh_token;
  if (tokens.expires_in) update.token_expires_at = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  try {
    await sb.from("user_granola_connections").update(update).eq("id", conn.id);
  } catch (e: any) {
    console.error(`${fnTag}: failed to persist refreshed tokens:`, e?.message);
  }
  return tokens.access_token;
}
