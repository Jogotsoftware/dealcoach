import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// embed-chunks v9
// FIX: chunk_type 'summary' -> 'transcript_summary' and 'coaching' -> 'coaching_notes'
//      to match the CHECK constraint on deal_context_chunks.chunk_type.
// FIX: .insert() in supabase-js does NOT throw on error — now destructures
//      { error } and counts/logs failures correctly.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

// Allowed chunk_types per deal_context_chunks_chunk_type_check
const ALLOWED_CHUNK_TYPES = new Set([
  'transcript', 'transcript_summary', 'coaching_notes', 'company_profile', 'company_research',
  'contact', 'deal_analysis', 'pain_point', 'risk', 'flag', 'compelling_event',
  'competitor', 'proposal_insight', 'coach_document', 'task', 'email', 'user_note',
]);

function chunkText(text: string, maxTokens = 500, overlap = 50): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  const chunkSize = Math.floor(maxTokens * 0.75);
  let i = 0;
  while (i < words.length) {
    const end = Math.min(i + chunkSize, words.length);
    chunks.push(words.slice(i, end).join(' '));
    i = end - overlap;
    if (i >= words.length - overlap) break;
  }
  if (chunks.length === 0 && text.trim()) chunks.push(text.trim());
  return chunks;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI embeddings error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.data.map((d: any) => d.embedding);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { deal_id, conversation_id } = await req.json();
    if (!deal_id) return jr({ error: 'v9: deal_id required' }, 400);

    const { data: deal } = await sb.from('deals').select('org_id, rep_id').eq('id', deal_id).single();
    if (!deal) return jr({ error: 'v9: Deal not found' }, 404);

    if (deal.org_id) {
      const { data: org } = await sb.from('organizations').select('settings').eq('id', deal.org_id).single();
      if (org?.settings?.ai_features?.embedding_enabled === false) {
        return jr({ success: true, message: 'v9: Embedding disabled for this org', chunks: 0 });
      }
    }

    const chunks: { content: string; chunk_type: string; source_table: string; source_field: string; source_id: string | null; source_conversation_id: string | null; speaker: string | null; call_type: string | null; call_date: string | null; chunk_index: number }[] = [];

    if (conversation_id) {
      const { data: conv } = await sb.from('conversations').select('transcript, call_type, call_date, ai_summary, ai_coaching_notes').eq('id', conversation_id).single();
      if (conv?.transcript) {
        const segments = chunkText(conv.transcript);
        segments.forEach((seg, i) => chunks.push({
          content: seg, chunk_type: 'transcript', source_table: 'conversations',
          source_field: 'transcript', source_id: conversation_id,
          source_conversation_id: conversation_id, speaker: null,
          call_type: conv.call_type, call_date: conv.call_date, chunk_index: i,
        }));
      }
      if (conv?.ai_summary) {
        chunks.push({
          content: conv.ai_summary, chunk_type: 'transcript_summary', source_table: 'conversations',
          source_field: 'ai_summary', source_id: conversation_id,
          source_conversation_id: conversation_id, speaker: null,
          call_type: conv.call_type, call_date: conv.call_date, chunk_index: 0,
        });
      }
      if (conv?.ai_coaching_notes) {
        chunks.push({
          content: conv.ai_coaching_notes, chunk_type: 'coaching_notes', source_table: 'conversations',
          source_field: 'ai_coaching_notes', source_id: conversation_id,
          source_conversation_id: conversation_id, speaker: null,
          call_type: conv.call_type, call_date: conv.call_date, chunk_index: 0,
        });
      }
    }

    const { data: pains } = await sb.from('deal_pain_points').select('id, pain_description, impact_text, annual_cost, speaker_name, source_conversation_id').eq('deal_id', deal_id);
    (pains || []).forEach(p => {
      const text = `Pain: ${p.pain_description}${p.impact_text ? ' Impact: ' + p.impact_text : ''}${p.annual_cost ? ' Cost: $' + p.annual_cost + '/yr' : ''}`;
      chunks.push({ content: text, chunk_type: 'pain_point', source_table: 'deal_pain_points', source_field: 'pain_description', source_id: p.id, source_conversation_id: p.source_conversation_id, speaker: p.speaker_name, call_type: null, call_date: null, chunk_index: 0 });
    });

    const { data: risks } = await sb.from('deal_risks').select('id, risk_description, severity, category, source_conversation_id').eq('deal_id', deal_id);
    (risks || []).forEach(r => {
      chunks.push({ content: `Risk [${r.severity}]: ${r.risk_description}`, chunk_type: 'risk', source_table: 'deal_risks', source_field: 'risk_description', source_id: r.id, source_conversation_id: r.source_conversation_id, speaker: null, call_type: null, call_date: null, chunk_index: 0 });
    });

    const { data: flags } = await sb.from('deal_flags').select('id, flag_type, description, source_conversation_id').eq('deal_id', deal_id);
    (flags || []).forEach(f => {
      chunks.push({ content: `${f.flag_type === 'green' ? 'Green' : 'Red'} Flag: ${f.description}`, chunk_type: 'flag', source_table: 'deal_flags', source_field: 'description', source_id: f.id, source_conversation_id: f.source_conversation_id, speaker: null, call_type: null, call_date: null, chunk_index: 0 });
    });

    const { data: events } = await sb.from('compelling_events').select('id, event_description, impact, source_conversation_id').eq('deal_id', deal_id);
    (events || []).forEach(e => {
      chunks.push({ content: `Compelling Event: ${e.event_description}${e.impact ? ' Impact: ' + e.impact : ''}`, chunk_type: 'compelling_event', source_table: 'compelling_events', source_field: 'event_description', source_id: e.id, source_conversation_id: e.source_conversation_id, speaker: null, call_type: null, call_date: null, chunk_index: 0 });
    });

    const { data: contacts } = await sb.from('contacts').select('id, name, title, role_in_deal, alignment_status, alignment_notes').eq('deal_id', deal_id);
    (contacts || []).forEach(c => {
      const text = `Contact: ${c.name}${c.title ? ', ' + c.title : ''}. Role: ${c.role_in_deal || 'Unknown'}. Alignment: ${c.alignment_status || 'unknown'}${c.alignment_notes ? '. ' + c.alignment_notes : ''}`;
      chunks.push({ content: text, chunk_type: 'contact', source_table: 'contacts', source_field: 'name', source_id: c.id, source_conversation_id: null, speaker: null, call_type: null, call_date: null, chunk_index: 0 });
    });

    if (chunks.length === 0) return jr({ success: true, version: 'v9', message: 'No content to embed', chunks: 0 });

    // Filter to only allowed chunk_types (defensive)
    const valid = chunks.filter(c => ALLOWED_CHUNK_TYPES.has(c.chunk_type));
    const skipped = chunks.length - valid.length;
    if (skipped > 0) console.log(`v9: skipped ${skipped} chunks with invalid chunk_type`);

    // Mark existing non-stale chunks for this conversation as stale (will be replaced)
    if (conversation_id) {
      await sb.from('deal_context_chunks').update({ stale: true }).eq('deal_id', deal_id).eq('source_conversation_id', conversation_id);
    }

    const BATCH_SIZE = 100;
    let totalEmbedded = 0;
    const errors: string[] = [];

    for (let i = 0; i < valid.length; i += BATCH_SIZE) {
      const batch = valid.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => c.content);

      let embeddings: number[][];
      try {
        embeddings = await getEmbeddings(texts);
      } catch (e: any) {
        const msg = `Embedding batch error: ${e.message}`;
        console.error(msg);
        errors.push(msg);
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const chunk = batch[j];
        const { error } = await sb.from('deal_context_chunks').insert({
          deal_id, org_id: deal.org_id,
          content: chunk.content, chunk_type: chunk.chunk_type,
          source_table: chunk.source_table, source_field: chunk.source_field,
          source_id: chunk.source_id, source_conversation_id: chunk.source_conversation_id,
          speaker: chunk.speaker, call_type: chunk.call_type, call_date: chunk.call_date,
          chunk_index: chunk.chunk_index,
          embedding: JSON.stringify(embeddings[j]),
          embedding_model: 'text-embedding-3-small',
          token_count: Math.ceil(chunk.content.split(/\s+/).length * 1.3),
          confidence: 'mentioned',
          stale: false,
          embedded_at: new Date().toISOString(),
        });
        if (error) {
          const msg = `v9: insert error [${chunk.chunk_type}]: ${error.message}`;
          console.error(msg);
          errors.push(msg);
        } else {
          totalEmbedded++;
        }
      }
    }

    // Clean up stale chunks (ones that didn't get re-inserted)
    if (conversation_id) {
      await sb.from('deal_context_chunks').delete().eq('deal_id', deal_id).eq('source_conversation_id', conversation_id).eq('stale', true);
    }

    return jr({ success: true, version: 'v9', chunks_embedded: totalEmbedded, total_chunks: valid.length, skipped_invalid_type: skipped, errors: errors.slice(0, 20) });

  } catch (e: any) {
    console.error('embed-chunks v9 error:', e);
    return jr({ error: `v9: ${e.message}` }, 500);
  }
});
