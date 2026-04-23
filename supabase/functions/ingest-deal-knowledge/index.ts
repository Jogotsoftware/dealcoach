import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// ingest-deal-knowledge v1
// Batch RAG ingestion for a deal:
// - Loops all processed conversations → calls embed-chunks for each
// - Chunks company_profile (overview + goals + priorities + growth plans + tech stack)
// - Chunks deal_analysis (quantified pain + business impact + exec alignment + driving factors)
// Skips conversations already embedded unless force_reingest = true.
// Intended to be called from process-transcript after all DB writes, and as a backfill tool.

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

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

async function callEmbedChunks(deal_id: string, conversation_id: string | null): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/embed-chunks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY },
    body: JSON.stringify({ deal_id, conversation_id }),
  });
  if (!res.ok) return { error: `embed-chunks ${res.status}` };
  return await res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { deal_id, force_reingest } = await req.json();
    if (!deal_id) return jr({ error: 'v1: deal_id required' }, 400);

    const { data: deal } = await sb.from('deals').select('id, org_id, company_name').eq('id', deal_id).single();
    if (!deal) return jr({ error: 'v1: Deal not found' }, 404);

    // Check org embedding settings
    if (deal.org_id) {
      const { data: org } = await sb.from('organizations').select('settings').eq('id', deal.org_id).single();
      if (org?.settings?.ai_features?.embedding_enabled === false) {
        return jr({ success: true, message: 'v1: Embedding disabled for org', chunks_created: 0 });
      }
    }

    const summary: any = { deal_id, deal_company: deal.company_name, conversations_processed: 0, profile_chunks: 0, analysis_chunks: 0, errors: [] };

    // 1. Loop processed conversations
    const { data: convs } = await sb.from('conversations').select('id, processed').eq('deal_id', deal_id).eq('processed', true);
    for (const c of (convs || [])) {
      // Skip if already embedded unless forcing
      if (!force_reingest) {
        const { count } = await sb.from('deal_context_chunks').select('*', { count: 'exact', head: true }).eq('source_conversation_id', c.id).eq('stale', false);
        if (count && count > 0) continue;
      }
      const res = await callEmbedChunks(deal_id, c.id);
      if (res.error) summary.errors.push(`conv ${c.id}: ${res.error}`);
      else summary.conversations_processed++;
    }

    // 2. Chunk company_profile if present
    const { data: profile } = await sb.from('company_profile').select('overview, business_goals, business_priorities, growth_plans, tech_stack, competitive_landscape, industry').eq('deal_id', deal_id).single();
    const profileChunks: { content: string; field: string }[] = [];
    if (profile) {
      const overview = `Company: ${deal.company_name}. ${profile.overview || ''} Industry: ${profile.industry || 'Unknown'}.`.trim();
      if (overview.length > 30) profileChunks.push({ content: overview, field: 'overview' });
      if (profile.business_goals) profileChunks.push({ content: `Business goals: ${profile.business_goals}`, field: 'business_goals' });
      if (profile.business_priorities) profileChunks.push({ content: `Business priorities: ${profile.business_priorities}`, field: 'business_priorities' });
      if (profile.growth_plans) profileChunks.push({ content: `Growth plans: ${profile.growth_plans}`, field: 'growth_plans' });
      if (profile.tech_stack) profileChunks.push({ content: `Tech stack: ${profile.tech_stack}`, field: 'tech_stack' });
      if (profile.competitive_landscape) profileChunks.push({ content: `Competitive landscape: ${profile.competitive_landscape}`, field: 'competitive_landscape' });
    }

    // 3. Chunk deal_analysis summary fields
    const { data: analysis } = await sb.from('deal_analysis').select('quantified_pain, business_impact, driving_factors, exec_alignment, ideal_solution, timeline_drivers, decision_process, decision_criteria').eq('deal_id', deal_id).single();
    const analysisChunks: { content: string; field: string }[] = [];
    if (analysis) {
      for (const [field, label] of [
        ['quantified_pain', 'Quantified pain'],
        ['business_impact', 'Business impact'],
        ['driving_factors', 'Driving factors'],
        ['exec_alignment', 'Exec alignment'],
        ['ideal_solution', 'Ideal solution'],
        ['timeline_drivers', 'Timeline drivers'],
        ['decision_process', 'Decision process'],
        ['decision_criteria', 'Decision criteria'],
      ] as const) {
        const v = (analysis as any)[field];
        if (v && typeof v === 'string' && v.length > 10 && v !== 'Unknown') {
          analysisChunks.push({ content: `${label}: ${v}`, field });
        }
      }
    }

    const allMetaChunks = [
      ...profileChunks.map(c => ({ ...c, chunk_type: 'company_profile', source_table: 'company_profile' })),
      ...analysisChunks.map(c => ({ ...c, chunk_type: 'deal_analysis', source_table: 'deal_analysis' })),
    ];

    if (allMetaChunks.length > 0 && OPENAI_API_KEY) {
      // Delete stale profile/analysis chunks for this deal
      if (force_reingest) {
        await sb.from('deal_context_chunks').delete().eq('deal_id', deal_id).in('chunk_type', ['company_profile', 'deal_analysis']);
      }

      try {
        const embeddings = await getEmbeddings(allMetaChunks.map(c => c.content));
        for (let i = 0; i < allMetaChunks.length; i++) {
          const c = allMetaChunks[i];
          try {
            await sb.from('deal_context_chunks').insert({
              deal_id, org_id: deal.org_id,
              content: c.content, chunk_type: c.chunk_type,
              source_table: c.source_table, source_field: c.field,
              chunk_index: 0, embedding: JSON.stringify(embeddings[i]),
              embedding_model: 'text-embedding-3-small',
              token_count: Math.ceil(c.content.split(/\s+/).length * 1.3),
              confidence: 'high', stale: false,
              embedded_at: new Date().toISOString(),
            });
            if (c.chunk_type === 'company_profile') summary.profile_chunks++;
            else summary.analysis_chunks++;
          } catch (e: any) { summary.errors.push(`meta chunk: ${e.message}`); }
        }
      } catch (e: any) {
        summary.errors.push(`meta embed: ${e.message}`);
      }
    }

    return jr({ success: true, version: 'v1', summary });
  } catch (e: any) {
    console.error('ingest-deal-knowledge v1 error:', e);
    return jr({ error: `v1: ${e.message}` }, 500);
  }
});
