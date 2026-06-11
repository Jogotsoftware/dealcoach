import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "../_shared/granola-mcp.ts";

// granola-import v2
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

// ─── Granola transcript cleaning ─────────────────────────────────────────────
// Granola's raw transcript interleaves two capture channels: "Me" (the note
// owner's microphone) and "Them" (system audio). Without headphones the mic
// also hears the remote side, so every "Them" utterance is duplicated as a
// near-identical "Me" echo. Leak is one-directional (remote speech leaks into
// the mic channel; the owner's voice never appears under "Them"), so any Me
// sentence that fuzzy-matches a nearby Them sentence is an echo and drops.
// Output: one turn per line, consecutive same-speaker turns merged.

function normSentence(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim();
}

function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 12 && b.length >= 12 && (a.includes(b) || b.includes(a))) return true;
  const wa = new Set(a.split(" "));
  const wb = new Set(b.split(" "));
  if (wa.size < 3 || wb.size < 3) return false;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  const jaccard = inter / (wa.size + wb.size - inter);
  return jaccard >= 0.6;
}

function splitSentences(text: string): string[] {
  return text.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
}

export function cleanGranolaTranscript(raw: string): { text: string; truncated: boolean } {
  // Heuristic truncation flag: Granola caps the tool response (~16k chars)
  // and the cut lands mid-sentence.
  const truncated = raw.length > 8000 && !/[.?!"']\s*$/.test(raw.trim());

  // Parse "Me:" / "Them:" turns.
  const turns: Array<{ speaker: string; text: string }> = [];
  const re = /(Me|Them):\s*/g;
  let m: RegExpExecArray | null;
  let lastSpeaker: string | null = null;
  let lastEnd = 0;
  while ((m = re.exec(raw))) {
    if (lastSpeaker !== null) {
      const text = raw.slice(lastEnd, m.index).trim();
      if (text) turns.push({ speaker: lastSpeaker, text });
    }
    lastSpeaker = m[1];
    lastEnd = re.lastIndex;
  }
  if (lastSpeaker !== null) {
    const text = raw.slice(lastEnd).trim();
    if (text) turns.push({ speaker: lastSpeaker, text });
  }
  // Not the expected two-channel format — return as-is.
  if (turns.length < 4) return { text: raw.trim(), truncated };

  // Sentence-level echo removal: drop Me sentences that match a Them sentence
  // in the previous, same-index, or next turn.
  type Sent = { speaker: string; text: string };
  const turnSentences = turns.map((t) => splitSentences(t.text).map((s) => ({ raw: s, norm: normSentence(s) })));
  const kept: Sent[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.speaker !== "Me") {
      for (const s of turnSentences[i]) kept.push({ speaker: t.speaker, text: s.raw });
      continue;
    }
    // Neighboring Them sentences to compare against.
    const themNorms: string[] = [];
    for (const j of [i - 1, i + 1]) {
      if (j >= 0 && j < turns.length && turns[j].speaker === "Them") {
        for (const s of turnSentences[j]) themNorms.push(s.norm);
      }
    }
    for (const s of turnSentences[i]) {
      const isEcho = themNorms.some((n) => fuzzyMatch(s.norm, n));
      if (!isEcho) kept.push({ speaker: "Me", text: s.raw });
    }
  }

  // Rebuild: merge consecutive same-speaker sentences into turns.
  const lines: string[] = [];
  let curSpeaker: string | null = null;
  let curParts: string[] = [];
  const flush = () => {
    if (curSpeaker !== null && curParts.length) lines.push(`${curSpeaker}: ${curParts.join(" ")}`);
    curParts = [];
  };
  for (const s of kept) {
    if (s.speaker !== curSpeaker) { flush(); curSpeaker = s.speaker; }
    curParts.push(s.text);
  }
  flush();

  const text = lines.join("\n");
  // Safety valve: if cleaning nuked most of the content, keep the raw.
  if (text.length < raw.length * 0.25) return { text: raw.trim(), truncated };
  return { text, truncated };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors() });
  if (req.method !== "POST") return jr({ error: "granola-import v2: POST required" }, 405);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return jr({ error: "granola-import v2: not authenticated" }, 401);
    const { data: userData, error: userErr } = await sb.auth.getUser(jwt);
    if (userErr || !userData?.user) return jr({ error: "granola-import v2: not authenticated" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const dealId = body.deal_id;
    const meetingId = body.meeting_id;
    if (!dealId) return jr({ error: "granola-import v2: deal_id missing" }, 400);
    if (!meetingId) return jr({ error: "granola-import v2: meeting_id missing" }, 400);

    // Caller must actually have access to the deal: same-org check.
    const { data: profile } = await sb.from("profiles").select("org_id").eq("id", userId).single();
    const { data: deal, error: dealErr } = await sb.from("deals").select("id, org_id").eq("id", dealId).single();
    if (dealErr || !deal) return jr({ error: "granola-import v2: deal not found" }, 404);
    if (!profile?.org_id || profile.org_id !== deal.org_id) {
      return jr({ error: "granola-import v2: deal not in caller org" }, 403);
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
        version: "granola-import v2",
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
    if (connErr) return jr({ error: `granola-import v2: connection lookup failed: ${connErr.message}` }, 500);
    if (!conn || conn.status !== "connected") {
      return jr({ error: "granola-import v2: not connected", reconnect: true }, 401);
    }

    let accessToken: string;
    try {
      accessToken = await ensureFreshToken(sb, conn, "granola-import v2");
    } catch (e: any) {
      return jr({ error: e?.message || "granola-import v2: reconnect required", reconnect: true }, 401);
    }

    // Verbatim transcript (the only provenance-grade artifact). One retry
    // after a forced token refresh when the server rejects the token.
    let mcp = new McpClient(accessToken);
    let transcriptResult: any;
    try {
      await mcp.initialize();
      transcriptResult = await mcp.toolsCall("get_meeting_transcript", { meeting_id: meetingId });
    } catch (e: any) {
      if (String(e?.message || "").includes("401")) {
        try {
          accessToken = await ensureFreshToken(sb, conn, "granola-import v2", true);
          mcp = new McpClient(accessToken);
          await mcp.initialize();
          transcriptResult = await mcp.toolsCall("get_meeting_transcript", { meeting_id: meetingId });
        } catch (e2: any) {
          return jr({ error: `granola-import v2: ${e2?.message || e2}`, reconnect: true }, 401);
        }
      } else {
        return jr({ error: `granola-import v2: transcript fetch failed: ${e?.message || e}` }, 502);
      }
    }
    // The tool returns a JSON envelope ({ id, title, transcript }) inside its
    // text block — unwrap it; storing the envelope verbatim was the "{ id:..."
    // junk in View Transcript. Fall back to raw text for other shapes.
    let rawTranscript = mcpResultText(transcriptResult).trim();
    let envelopeTitle: string | null = null;
    const envelope = mcpResultJson(transcriptResult);
    if (envelope && typeof envelope.transcript === "string") {
      rawTranscript = envelope.transcript.trim();
      envelopeTitle = envelope.title || null;
    }
    if (!rawTranscript || rawTranscript.length < 200) {
      return jr({
        error: "granola-import v2: transcript empty or too short — Granola may require approval for transcript access on this call",
      }, 422);
    }
    const { text: transcript, truncated } = cleanGranolaTranscript(rawTranscript);

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
      console.error("granola-import v2: get_meetings metadata failed (non-fatal):", (e as any)?.message);
    }

    const title = body.title || meta?.title || envelopeTitle || "Granola call";
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
    insertRow.metadata = {
      granola: {
        // CONTEXT-ONLY: AI-generated, never satisfies the quote gate.
        summary: meta?.summary || meta?.ai_summary || null,
        notes: meta?.notes || null,
        action_items: meta?.action_items || null,
        attendees: meta?.attendees || meta?.participants || null,
        // Granola caps get_meeting_transcript (~16k chars); when the cut
        // lands mid-sentence we flag it so the UI can tell the AE.
        truncated,
        raw_chars: rawTranscript.length,
      },
    };

    let conv: any = null;
    {
      const { data, error } = await sb.from("conversations").insert(insertRow).select("id").single();
      if (error) {
        // Unique-index race: a concurrent import of the same meeting landed
        // first. Return the winner — same contract as the pre-insert check.
        if (error.code === "23505" || /duplicate key/.test(error.message)) {
          const { data: winner } = await sb
            .from("conversations")
            .select("id, transcript")
            .eq("deal_id", dealId)
            .eq("granola_meeting_id", meetingId)
            .maybeSingle();
          if (winner) {
            return jr({
              success: true,
              version: "granola-import v2",
              conversation_id: winner.id,
              transcript_length: winner.transcript?.length || 0,
              already_imported: true,
            });
          }
        }
        return jr({ error: `granola-import v2: insert conversations failed: ${error.message}` }, 500);
      }
      conv = data;
    }

    try {
      await sb.from("user_granola_connections").update({ last_used_at: new Date().toISOString() }).eq("id", conn.id);
    } catch (_) { /* non-fatal */ }

    // Fire process-transcript in the background, mirroring import-transcript-url,
    // then the catalog extraction pass (extract-pass) after it settles.
    try {
      const p = fetch(`${SUPABASE_URL}/functions/v1/process-transcript`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
        body: JSON.stringify({ conversation_id: conv.id, deal_id: dealId }),
      }).then(async (r) => {
        if (!r.ok) console.error("granola-import v2 process-transcript non-2xx:", r.status, await r.text());
      }).catch((e) => console.error("granola-import v2 process-transcript error:", e)).then(() =>
        fetch(`${SUPABASE_URL}/functions/v1/extract-pass`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY },
          body: JSON.stringify({ conversation_id: conv.id }),
        }).then(async (r) => {
          if (!r.ok) console.error("granola-import v2 extract-pass non-2xx:", r.status, await r.text());
        }).catch((e) => console.error("granola-import v2 extract-pass error:", e))
      );
      // @ts-ignore EdgeRuntime is provided by the platform
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    } catch (e) {
      console.error("granola-import v2 trigger setup error:", e);
    }

    return jr({
      success: true,
      version: "granola-import v2",
      conversation_id: conv.id,
      transcript_length: transcript.length,
      truncated,
    });
  } catch (e: any) {
    console.error("granola-import v2 error:", e);
    return jr({ error: `granola-import v2: ${e?.message || e}` }, 500);
  }
});
