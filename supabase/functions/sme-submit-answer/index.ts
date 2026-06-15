import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sme-submit-answer v1
// SME hits "Submit answer". Persists the answer + addressed clarifications to
// sme_answer_thread, marks sme_questions.status='answered', awards 10 credits,
// fires asker notification.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { sme_question_id, sme_user_id, answer_text, addressed_clarifications } = await req.json();
    if (!sme_question_id || !sme_user_id || !answer_text) return jr({ error: 'v1: sme_question_id, sme_user_id, answer_text required' }, 400);

    const { data: q } = await sb.from('sme_questions').select('id, org_id, asked_by_user_id, deal_id, question_text').eq('id', sme_question_id).single();
    if (!q) return jr({ error: 'v1: question not found' }, 404);

    // 1. Insert the answer.
    await sb.from('sme_answer_thread').insert({
      sme_question_id, org_id: q.org_id,
      author_type: 'sme', author_user_id: sme_user_id,
      message_type: 'answer', content: answer_text,
    });

    // 2. Insert follow_up rows for each addressed clarification (for thread display).
    if (Array.isArray(addressed_clarifications)) {
      for (const c of addressed_clarifications) {
        if (typeof c === 'string' && c.trim()) {
          await sb.from('sme_answer_thread').insert({
            sme_question_id, org_id: q.org_id,
            author_type: 'sme', author_user_id: sme_user_id,
            message_type: 'follow_up', content: `Addressed: ${c.slice(0, 400)}`,
          });
        }
      }
    }

    // 3. Status + timestamp.
    await sb.from('sme_questions').update({ status: 'answered', answered_at: new Date().toISOString() }).eq('id', sme_question_id);

    // 4. Award 10 credits.
    let creditsAwarded = 0;
    try {
      await sb.rpc('award_sme_credit', {
        p_sme_user_id: sme_user_id, p_org_id: q.org_id,
        p_event_type: 'answer_submitted', p_credit_amount: 10,
        p_reference_id: sme_question_id, p_reference_table: 'sme_questions', p_notes: null,
      });
      creditsAwarded = 10;
    } catch (e: any) { console.log('award_sme_credit error (non-fatal):', e?.message); }

    // 5. Notify the asker.
    const truncated = (q.question_text || '').length > 120 ? (q.question_text as string).slice(0, 120) + '…' : q.question_text;
    await sb.from('sme_notifications').insert({
      recipient_user_id: q.asked_by_user_id, org_id: q.org_id,
      notification_type: 'answer_received',
      reference_id: sme_question_id, reference_table: 'sme_questions',
      title: 'An SME answered your question',
      body: truncated,
    });

    return jr({ success: true, version: 'v1', credits_awarded: creditsAwarded });
  } catch (err: any) {
    console.error('sme-submit-answer v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
