import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sme-generate-clarifying-questions v1
// Called when an SME first opens a routed question. Generates 2-3 short
// clarifying questions to help the SME write a reusable answer. Idempotent —
// re-calling returns the cached set instead of regenerating.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { sme_question_id } = await req.json();
    if (!sme_question_id) return jr({ error: 'v1: sme_question_id required' }, 400);

    // Idempotency: return cached clarifying questions if any exist.
    const { data: existing } = await sb.from('sme_answer_thread')
      .select('id, content, created_at')
      .eq('sme_question_id', sme_question_id)
      .eq('message_type', 'clarifying_question_for_sme')
      .order('created_at');
    if (existing && existing.length > 0) {
      return jr({ success: true, version: 'v1', questions: existing.map((r: any) => r.content), cached: true });
    }

    const { data: q } = await sb.from('sme_questions').select('*').eq('id', sme_question_id).single();
    if (!q) return jr({ error: 'v1: question not found' }, 404);

    // Pull related-topic helpful answers (top 3) as priors.
    let relatedContext = '';
    if (q.topic_tags && q.topic_tags.length) {
      const { data: priors } = await sb.from('sme_questions')
        .select('question_text, sme_answer_thread!inner(content, message_type, author_type)')
        .eq('org_id', q.org_id)
        .eq('asker_helpful', true)
        .overlaps('topic_tags', q.topic_tags)
        .limit(3);
      if (priors && priors.length) {
        relatedContext = '\n\nRecent helpful answers on related topics (for SME priming):\n' + priors.slice(0, 3).map((p: any) => {
          const answer = (p.sme_answer_thread || []).find((t: any) => t.message_type === 'answer' && t.author_type === 'sme');
          return `Q: ${(p.question_text || '').slice(0, 200)}\nA: ${(answer?.content || '').slice(0, 300)}`;
        }).join('\n---\n');
      }
    }

    if (!ANTHROPIC_API_KEY) return jr({ error: 'v1: ANTHROPIC_API_KEY not configured' }, 500);

    const sys = `You are helping an internal SME write an answer to a question from a teammate.
The answer will likely be reused for future similar questions, so it should be specific about
scope, source-of-truth, and recency.
Generate 2-3 short clarifying questions FOR THE SME to consider as they write their answer.
Examples: "Does this apply to all deal sizes or only enterprise?", "Is this Sage policy or
your team's practice?", "When did this last change?".
Return ONLY JSON: { "questions": ["...", "...", "..."] }`;
    const usr = `Question being answered: ${q.question_text}
Context: ${q.ai_question_context || '(none)'}
Tags: ${(q.topic_tags || []).join(', ')}${relatedContext}`;

    let questions: string[] = [];
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, temperature: 0.2, system: sys, messages: [{ role: 'user', content: usr }] }),
      });
      if (r.ok) {
        const j = await r.json();
        const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        const m = text.match(/\{[\s\S]*\}/);
        if (m) {
          const parsed = JSON.parse(m[0]);
          questions = (Array.isArray(parsed.questions) ? parsed.questions : []).filter((s: any) => typeof s === 'string').slice(0, 3);
        }
      }
    } catch (e: any) { console.log('clarifying gen error:', e?.message); }

    if (!questions.length) {
      questions = [
        'Does this apply broadly, or only to specific deal sizes / industries?',
        'Is this Sage policy or your team\'s practice?',
        'When did this last change — is your answer still current?',
      ];
    }

    // Persist each as a thread row.
    for (const text of questions) {
      await sb.from('sme_answer_thread').insert({
        sme_question_id, org_id: q.org_id,
        author_type: 'ai', author_user_id: null,
        message_type: 'clarifying_question_for_sme', content: text,
      });
    }

    await sb.from('sme_questions').update({ status: 'clarifying' }).eq('id', sme_question_id).in('status', ['pending', 'routed']);

    return jr({ success: true, version: 'v1', questions, cached: false });
  } catch (err: any) {
    console.error('sme-generate-clarifying-questions v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
