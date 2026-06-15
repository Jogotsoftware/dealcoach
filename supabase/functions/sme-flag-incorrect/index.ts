import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sme-flag-incorrect v1
// Any user flags an answered SME question as incorrect. >= 2 open flags pushes
// the question status to 'flagged_incorrect' (a soft signal Lux/UI surfaces).
// Notifies the original answering SME + org admins.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { sme_question_id, flagged_by_user_id, flag_reason, flag_notes } = await req.json();
    if (!sme_question_id || !flagged_by_user_id || !flag_reason) return jr({ error: 'v1: sme_question_id, flagged_by_user_id, flag_reason required' }, 400);

    const { data: q } = await sb.from('sme_questions').select('id, org_id, question_text, status').eq('id', sme_question_id).single();
    if (!q) return jr({ error: 'v1: question not found' }, 404);

    // 1. Record the flag.
    await sb.from('sme_answer_flags').insert({
      sme_question_id, org_id: q.org_id,
      flagged_by_user_id, flag_reason,
      flag_notes: flag_notes || null,
      status: 'open',
    });

    // 2. Count open flags. >= 2 promotes status.
    const { count } = await sb.from('sme_answer_flags').select('id', { count: 'exact', head: true }).eq('sme_question_id', sme_question_id).eq('status', 'open');
    const totalOpen = count || 0;
    if (totalOpen >= 2 && q.status !== 'flagged_incorrect') {
      await sb.from('sme_questions').update({ status: 'flagged_incorrect' }).eq('id', sme_question_id);
    }

    // 3. Find the original answering SME.
    const { data: answerRows } = await sb.from('sme_answer_thread')
      .select('author_user_id').eq('sme_question_id', sme_question_id)
      .eq('message_type', 'answer').eq('author_type', 'sme')
      .order('created_at', { ascending: false }).limit(1);
    const originalSme = answerRows?.[0]?.author_user_id;

    const truncated = (q.question_text || '').slice(0, 120) + ((q.question_text || '').length > 120 ? '…' : '');
    if (originalSme) {
      await sb.from('sme_notifications').insert({
        recipient_user_id: originalSme, org_id: q.org_id,
        notification_type: 'answer_flagged',
        reference_id: sme_question_id, reference_table: 'sme_questions',
        title: 'Your answer was flagged as incorrect',
        body: `${truncated}  ·  reason: ${flag_reason}`,
      });
    }

    // 4. Notify org admins.
    const { data: admins } = await sb.from('profiles')
      .select('id').eq('org_id', q.org_id).in('role', ['admin', 'system_admin']);
    for (const a of (admins || [])) {
      if (a.id === flagged_by_user_id) continue;
      await sb.from('sme_notifications').insert({
        recipient_user_id: a.id, org_id: q.org_id,
        notification_type: 'answer_flagged_admin',
        reference_id: sme_question_id, reference_table: 'sme_questions',
        title: 'Answer flagged — needs review',
        body: `${truncated}  ·  reason: ${flag_reason}`,
      });
    }

    return jr({ success: true, version: 'v1', total_open_flags: totalOpen });
  } catch (err: any) {
    console.error('sme-flag-incorrect v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
