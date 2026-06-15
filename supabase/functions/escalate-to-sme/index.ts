import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// escalate-to-sme v1
// Rep clicks "Ask an SME" in chat → creates an sme_questions row, classifies
// against the org's active topic taxonomy via Haiku (constrained vocabulary so
// tags don't drift), routes via get_sme_for_topic, fires in-app notification.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

async function classifyTopic(message: string, taxonomy: string[]): Promise<{ topic_tags: string[]; ai_question_context: string }> {
  if (!ANTHROPIC_API_KEY) return { topic_tags: ['unmatched'], ai_question_context: '' };
  const sys = `You are tagging a question a rep escalated to an internal SME.
Pick 1-3 tags from the supplied vocabulary that best describe the question's topic.
If no tag fits well, return ["unmatched"].
Also write a short 1-2 sentence neutral summary of what the asker is really asking
(useful for the SME glancing at the inbox).
Return ONLY JSON: { "topic_tags": ["..."], "ai_question_context": "..." }`;
  const usr = `Vocabulary (pick from this list only):\n${taxonomy.map(t => `- ${t}`).join('\n')}\n\nQuestion:\n${message.slice(0, 2000)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, temperature: 0, system: sys, messages: [{ role: 'user', content: usr }] }),
    });
    if (!r.ok) return { topic_tags: ['unmatched'], ai_question_context: '' };
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { topic_tags: ['unmatched'], ai_question_context: '' };
    const parsed = JSON.parse(m[0]);
    const tags = Array.isArray(parsed.topic_tags) ? parsed.topic_tags.filter((t: any) => typeof t === 'string').slice(0, 3) : ['unmatched'];
    return { topic_tags: tags.length ? tags : ['unmatched'], ai_question_context: typeof parsed.ai_question_context === 'string' ? parsed.ai_question_context : '' };
  } catch (e: any) { console.log('classifyTopic error:', e?.message); return { topic_tags: ['unmatched'], ai_question_context: '' }; }
}

async function loadTaxonomy(sb: any, orgId: string): Promise<string[]> {
  // Constrained vocabulary = active routing rules (canonical) + top 20 tags used in recent questions (fallback).
  try {
    const [routesRes, tagsRes] = await Promise.all([
      sb.from('sme_routing_rules').select('topic_tag').eq('org_id', orgId).eq('active', true),
      sb.from('sme_questions').select('topic_tags').eq('org_id', orgId).order('created_at', { ascending: false }).limit(200),
    ]);
    const set = new Set<string>();
    (routesRes.data || []).forEach((r: any) => r.topic_tag && set.add(r.topic_tag));
    const usedCount: Record<string, number> = {};
    (tagsRes.data || []).forEach((q: any) => (q.topic_tags || []).forEach((t: string) => { usedCount[t] = (usedCount[t] || 0) + 1; }));
    Object.entries(usedCount).sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([t]) => set.add(t));
    set.add('unmatched');
    return Array.from(set);
  } catch (e: any) { console.log('loadTaxonomy error:', e?.message); return ['unmatched']; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { user_id, org_id, deal_id, chat_session_id, chat_message_id, question_text } = await req.json();
    if (!user_id || !org_id || !question_text) return jr({ error: 'v1: user_id, org_id, question_text required' }, 400);

    const taxonomy = await loadTaxonomy(sb, org_id);
    const { topic_tags, ai_question_context } = await classifyTopic(question_text, taxonomy);

    // Pick the first non-null SME route across the matched tags.
    let routedTo: string | null = null;
    let routedTag: string | null = null;
    for (const tag of topic_tags) {
      if (tag === 'unmatched') continue;
      try {
        const { data } = await sb.rpc('get_sme_for_topic', { p_org_id: org_id, p_topic_tag: tag });
        const candidate = typeof data === 'string' ? data : (data && typeof data === 'object' ? (data.sme_user_id || data.user_id || null) : null);
        if (candidate) { routedTo = candidate; routedTag = tag; break; }
      } catch (e: any) { console.log('get_sme_for_topic error (non-fatal):', e?.message); }
    }

    const { data: inserted, error: insertErr } = await sb.from('sme_questions').insert({
      org_id, asked_by_user_id: user_id, deal_id: deal_id || null,
      chat_session_id: chat_session_id || null, chat_message_id: chat_message_id || null,
      question_text, ai_question_context,
      topic_tags, status: routedTo ? 'routed' : 'pending',
      routed_to_sme_id: routedTo, routed_at: routedTo ? new Date().toISOString() : null,
      visibility: 'org',
    }).select('id').single();
    if (insertErr || !inserted) return jr({ error: 'v1: insert sme_questions failed: ' + (insertErr?.message || 'unknown') }, 500);

    if (routedTo) {
      const truncated = question_text.length > 120 ? question_text.slice(0, 120) + '…' : question_text;
      await sb.from('sme_notifications').insert({
        recipient_user_id: routedTo, org_id,
        notification_type: 'question_routed',
        reference_id: inserted.id, reference_table: 'sme_questions',
        title: 'New question routed to you',
        body: truncated + (routedTag ? `  ·  ${routedTag}` : ''),
      });
    }

    return jr({
      success: true, version: 'v1',
      sme_question_id: inserted.id,
      routed_to_sme_id: routedTo,
      routed_tag: routedTag,
      topic_tags,
      ai_question_context,
    });
  } catch (err: any) {
    console.error('escalate-to-sme v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
