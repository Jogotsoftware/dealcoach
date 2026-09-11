// Shared Granola import core. The single code path that turns a Granola meeting
// into a Lumen conversation + analysis. Used by:
//   - granola-import  (manual, user-JWT "From Granola" tab)
//   - granola-sync    (scheduled folder->deal auto-sync)
// Keeping one implementation means the manual and automatic paths behave
// identically (same cleaning, idempotency, metadata, and process chain).

import { McpClient, mcpResultJson, mcpResultText, ensureFreshToken } from "./granola-mcp.ts";

// conversations.call_type CHECK constraint (conversations_call_type_check).
export const VALID_CALL_TYPES = [
  "qdc", "functional_discovery", "demo", "scoping", "cs_sow", "proposal", "negotiation", "sync", "custom",
];

// ─── Call-type label parser ──────────────────────────────────────────────────
// Maps a Granola meeting title's stage label to a Lumen call_type. Joe labels
// calls "Company — QDC", "FDC w/ Laura", "Demo: Acme", etc. We resolve the label
// conservatively so descriptive auto-titles ("Sage Intacct product demo and ...")
// do NOT get mis-typed into a full-pass call type:
//   1. Unambiguous acronyms (QDC, FDC) anywhere = explicit label.
//   2. A stage word only counts when it stands as its own short delimited
//      segment (after — - : | /), not buried mid-sentence.
// Returns null when no label is recognized (caller defaults to a light pass).
// Mirrors lumen-email-calendar-extraction-spec §6a priority order.
export function parseCallTypeFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  // 1) Unambiguous acronyms (highest priority — QDC outranks discovery per §6a).
  if (/\bqdc\b/i.test(title)) return "qdc";
  if (/\bfdcs?\b/i.test(title)) return "functional_discovery";

  // 2) Delimited, short label segments only.
  const segments = title.split(/[—\-:|/]+/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    if (seg.split(/\s+/).length > 3) continue; // skip sentence-like segments
    const s = seg.toLowerCase();
    if (/^(functional discovery|discovery)$/.test(s)) return "functional_discovery";
    if (/^demos?$/.test(s)) return "demo";
    if (/^scoping$/.test(s)) return "scoping";
    if (/^(proposal|closing|sow)\b/.test(s)) return "proposal";
    if (/^(syncs?|connects?)\b/.test(s)) return "sync";
  }
  return null;
}

// ─── Transcript cleaning ─────────────────────────────────────────────────────
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

// ─── Import core ─────────────────────────────────────────────────────────────

export interface ImportOpts {
  deal_id: string;
  meeting_id: string;
  call_type?: string | null;
  title?: string | null;
  call_date?: string | null;
}

export interface ImportResult {
  conversation_id: string;
  already_imported: boolean;
  transcript_length: number;
  truncated: boolean;
  call_type: string;
  title: string;
}

export interface ImportEnv {
  supabaseUrl: string;
  serviceKey: string;
  fnTag: string;
}

// Carries an HTTP status + reconnect hint so the thin wrappers can map a thrown
// error straight onto their response contract.
export class GranolaImportError extends Error {
  status: number;
  reconnect: boolean;
  constructor(message: string, status = 500, reconnect = false) {
    super(message);
    this.name = "GranolaImportError";
    this.status = status;
    this.reconnect = reconnect;
  }
}

// Fire process-transcript, then extract-pass, in the background. extract-pass
// internally decides full vs light from call_type (FULL_PASS_TYPES), so the
// only thing the caller controls is call_type. Mirrors import-transcript-url.
function fireProcessing(env: ImportEnv, conversationId: string, dealId: string) {
  const { supabaseUrl, serviceKey, fnTag } = env;
  try {
    const p = fetch(`${supabaseUrl}/functions/v1/process-transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
      body: JSON.stringify({ conversation_id: conversationId, deal_id: dealId }),
    }).then(async (r) => {
      if (!r.ok) console.error(`${fnTag} process-transcript non-2xx:`, r.status, await r.text());
    }).catch((e) => console.error(`${fnTag} process-transcript error:`, e)).then(() =>
      fetch(`${supabaseUrl}/functions/v1/extract-pass`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({ conversation_id: conversationId }),
      }).then(async (r) => {
        if (!r.ok) console.error(`${fnTag} extract-pass non-2xx:`, r.status, await r.text());
      }).catch((e) => console.error(`${fnTag} extract-pass error:`, e))
    );
    // @ts-ignore EdgeRuntime is provided by the platform
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
  } catch (e) {
    console.error(`${fnTag} trigger setup error:`, e);
  }
}

// Pulls the verbatim transcript for one Granola meeting and lands it as a
// conversations row (source='granola'), then fires the process chain. Idempotent
// on (deal_id, granola_meeting_id) — re-importing the same meeting returns the
// existing row. Throws GranolaImportError on failure; the deal/org access check
// is the caller's responsibility (granola-import does same-org; granola-sync
// derives deal_id from a vetted mapping row).
export async function importGranolaMeeting(
  sb: any,
  conn: any,
  opts: ImportOpts,
  env: ImportEnv,
): Promise<ImportResult> {
  const { deal_id, meeting_id } = opts;
  const { fnTag } = env;
  if (!deal_id) throw new GranolaImportError(`${fnTag}: deal_id missing`, 400);
  if (!meeting_id) throw new GranolaImportError(`${fnTag}: meeting_id missing`, 400);

  // Idempotency: same meeting already imported into this deal -> return it.
  const { data: existing } = await sb
    .from("conversations")
    .select("id, transcript, call_type, title")
    .eq("deal_id", deal_id)
    .eq("granola_meeting_id", meeting_id)
    .maybeSingle();
  if (existing) {
    return {
      conversation_id: existing.id,
      already_imported: true,
      transcript_length: existing.transcript?.length || 0,
      truncated: false,
      call_type: existing.call_type,
      title: existing.title,
    };
  }

  let accessToken: string;
  try {
    accessToken = await ensureFreshToken(sb, conn, fnTag);
  } catch (e: any) {
    throw new GranolaImportError(e?.message || `${fnTag}: reconnect required`, 401, true);
  }

  // Verbatim transcript (the only provenance-grade artifact). One retry after a
  // forced token refresh when the server rejects the token.
  let mcp = new McpClient(accessToken);
  let transcriptResult: any;
  try {
    await mcp.initialize();
    transcriptResult = await mcp.toolsCall("get_meeting_transcript", { meeting_id });
  } catch (e: any) {
    if (String(e?.message || "").includes("401")) {
      try {
        accessToken = await ensureFreshToken(sb, conn, fnTag, true);
        mcp = new McpClient(accessToken);
        await mcp.initialize();
        transcriptResult = await mcp.toolsCall("get_meeting_transcript", { meeting_id });
      } catch (e2: any) {
        throw new GranolaImportError(`${fnTag}: ${e2?.message || e2}`, 401, true);
      }
    } else {
      throw new GranolaImportError(`${fnTag}: transcript fetch failed: ${e?.message || e}`, 502);
    }
  }

  // The tool returns a JSON envelope ({ id, title, transcript }) inside its text
  // block — unwrap it. Fall back to raw text for other shapes.
  let rawTranscript = mcpResultText(transcriptResult).trim();
  let envelopeTitle: string | null = null;
  const envelope = mcpResultJson(transcriptResult);
  if (envelope && typeof envelope.transcript === "string") {
    rawTranscript = envelope.transcript.trim();
    envelopeTitle = envelope.title || null;
  }
  if (!rawTranscript || rawTranscript.length < 200) {
    throw new GranolaImportError(
      `${fnTag}: transcript empty or too short — Granola may require approval for transcript access on this call`,
      422,
    );
  }
  const { text: transcript, truncated } = cleanGranolaTranscript(rawTranscript);

  // Best-effort meeting metadata: title/date fallbacks + share link. Granola's
  // AI summary/notes are CONTEXT-ONLY per the provenance spine — stored for
  // display, never provenance. Kept in conversations.metadata.
  let meta: any = null;
  try {
    const metaResult = await mcp.toolsCall("get_meetings", { meeting_ids: [meeting_id] });
    const j = mcpResultJson(metaResult);
    const arr = Array.isArray(j) ? j : Array.isArray(j?.meetings) ? j.meetings : j ? [j] : [];
    meta = arr.find((m: any) => String(m?.id || m?.meeting_id) === String(meeting_id)) || arr[0] || null;
  } catch (e) {
    console.error(`${fnTag}: get_meetings metadata failed (non-fatal):`, (e as any)?.message);
  }

  const title = opts.title || meta?.title || envelopeTitle || "Granola call";
  const callDate = opts.call_date ||
    (meta?.date ? String(meta.date).substring(0, 10) : new Date().toISOString().substring(0, 10));
  const shareUrl = meta?.share_url || meta?.shareUrl || meta?.url || null;

  const callType = VALID_CALL_TYPES.includes(opts.call_type as string) ? (opts.call_type as string) : "custom";

  const insertRow: any = {
    deal_id,
    title,
    call_type: callType,
    call_date: callDate,
    transcript,
    source: "granola",
    granola_meeting_id: meeting_id,
    granola_share_url: shareUrl,
    processed: false,
    tasks_extracted: false,
    metadata: {
      granola: {
        // CONTEXT-ONLY: AI-generated, never satisfies the quote gate.
        summary: meta?.summary || meta?.ai_summary || null,
        notes: meta?.notes || null,
        action_items: meta?.action_items || null,
        attendees: meta?.attendees || meta?.participants || null,
        truncated,
        raw_chars: rawTranscript.length,
      },
    },
  };

  let conversationId: string;
  {
    const { data, error } = await sb.from("conversations").insert(insertRow).select("id").single();
    if (error) {
      // Unique-index race: a concurrent import of the same meeting landed first.
      if (error.code === "23505" || /duplicate key/.test(error.message)) {
        const { data: winner } = await sb
          .from("conversations")
          .select("id, transcript, call_type, title")
          .eq("deal_id", deal_id)
          .eq("granola_meeting_id", meeting_id)
          .maybeSingle();
        if (winner) {
          return {
            conversation_id: winner.id,
            already_imported: true,
            transcript_length: winner.transcript?.length || 0,
            truncated,
            call_type: winner.call_type,
            title: winner.title,
          };
        }
      }
      throw new GranolaImportError(`${fnTag}: insert conversations failed: ${error.message}`, 500);
    }
    conversationId = data.id;
  }

  try {
    await sb.from("user_granola_connections").update({ last_used_at: new Date().toISOString() }).eq("id", conn.id);
  } catch (_) { /* non-fatal */ }

  fireProcessing(env, conversationId, deal_id);

  return {
    conversation_id: conversationId,
    already_imported: false,
    transcript_length: transcript.length,
    truncated,
    call_type: callType,
    title,
  };
}
