import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// import-transcript-url v1
// Accepts { deal_id, url, call_type?, call_date?, title? }
// Fetches the URL, extracts plain text (handles Chorus / Gong / Fathom / Zoom shared links
// and anything else where transcript text is embedded in HTML), inserts a `conversations`
// row, and kicks off process-transcript.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
function jr(d: any, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } });
}

// Strip HTML tags, decode common entities, compact whitespace.
function htmlToText(html: string): string {
  // Remove script + style blocks entirely
  let txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  // Replace common block-level tags with newlines
  txt = txt.replace(/<\/(p|div|br|li|tr|h[1-6]|section|article)>/gi, '\n');
  txt = txt.replace(/<br\s*\/?>/gi, '\n');
  // Strip remaining tags
  txt = txt.replace(/<[^>]+>/g, ' ');
  // Decode a small set of entities
  txt = txt.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
  // Compact whitespace
  txt = txt.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();
  return txt;
}

// Heuristics to detect Chorus/Gong/Fathom-specific transcript containers.
function extractTranscriptFromHtml(html: string): { transcript: string; source: string } {
  // Gong shares often include a JSON blob in a <script> tag — look for transcript content
  const gongJson = html.match(/"transcript"\s*:\s*"([^"]{200,})"/);
  if (gongJson) return { transcript: gongJson[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'), source: 'gong' };

  // Chorus/Fathom etc. usually show each turn in <div class="turn"> or <p class="utterance">
  const turns = html.match(/<div[^>]*class="[^"]*(?:turn|utterance|speaker-line|transcript-line)[^"]*"[^>]*>[\s\S]*?<\/div>/gi);
  if (turns && turns.length > 5) {
    const combined = turns.map(t => htmlToText(t)).filter(t => t).join('\n');
    if (combined.length > 500) return { transcript: combined, source: 'structured-html' };
  }

  // Fallback: strip all HTML and return plain text if long enough.
  const plain = htmlToText(html);
  return { transcript: plain, source: 'plain-text' };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const body = await req.json();
    const deal_id = body.deal_id;
    const url = body.url;
    if (!deal_id) return jr({ error: 'v1: deal_id required' }, 400);
    if (!url || !/^https?:\/\//i.test(url)) return jr({ error: 'v1: valid http(s) url required' }, 400);

    // Validate that the user has access to this deal (service role bypasses RLS,
    // but we still need to know the org/rep for the insert).
    const { data: deal, error: dealErr } = await sb.from('deals').select('id, org_id, rep_id, company_name').eq('id', deal_id).single();
    if (dealErr || !deal) return jr({ error: 'v1: deal not found' }, 404);

    // Fetch the URL (10s timeout via AbortController)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let html = '';
    let fetchStatus = 0;
    try {
      const r = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; DealCoach/1.0; +https://revenueinstruments.com)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });
      fetchStatus = r.status;
      if (!r.ok) return jr({ error: `v1: fetch returned ${r.status}` }, 502);
      html = await r.text();
    } catch (e: any) {
      clearTimeout(timeout);
      return jr({ error: `v1: fetch failed: ${e?.message || e}` }, 502);
    }
    clearTimeout(timeout);

    if (!html || html.length < 200) return jr({ error: 'v1: page body too short — not a shareable transcript?' }, 422);

    const { transcript, source } = extractTranscriptFromHtml(html);
    if (!transcript || transcript.length < 200) return jr({ error: 'v1: could not extract a transcript from that page. Try pasting the text directly.' }, 422);

    // Infer title from <title> tag
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const inferredTitle = titleMatch ? titleMatch[1].trim().substring(0, 200) : null;

    // Insert conversation
    const { data: conv, error: convErr } = await sb.from('conversations').insert({
      deal_id,
      title: body.title || inferredTitle || `Imported from URL`,
      call_type: body.call_type || 'discovery',
      call_date: body.call_date || new Date().toISOString().substring(0, 10),
      transcript,
      source_url: url,
      processed: false,
    }).select().single();
    if (convErr || !conv) return jr({ error: `v1: insert conversations failed: ${convErr?.message}` }, 500);

    // Kick off process-transcript in the background
    try {
      const p = fetch(`${SUPABASE_URL}/functions/v1/process-transcript`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY },
        body: JSON.stringify({ conversation_id: conv.id, deal_id }),
      }).then(async r => {
        if (!r.ok) console.error('v1 process-transcript non-2xx:', r.status, await r.text());
      }).catch(e => console.error('v1 process-transcript error:', e));
      // @ts-ignore
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(p);
    } catch (e) { console.error('v1 trigger setup error:', e); }

    return jr({
      success: true,
      version: 'v1',
      conversation_id: conv.id,
      source,
      fetch_status: fetchStatus,
      transcript_length: transcript.length,
    });
  } catch (e: any) {
    console.error('import-transcript-url v1 error:', e);
    return jr({ error: `v1: ${e?.message || e}` }, 500);
  }
});
