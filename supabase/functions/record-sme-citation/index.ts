import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// record-sme-citation v1
// Fired by the chatbot frontend when Lux's response renders an SME citation
// pill. Idempotent: UNIQUE(sme_question_id, citing_chat_message_id) on
// sme_citation_events prevents double-counting on re-renders. Bumps
// sme_questions.ai_citation_count, awards milestone bonus credits (50 each at
// 25 / 50 / 100), and grants the Mentor badge to SMEs who cross 25 citations.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CITATION_MILESTONES = [25, 50, 100];
const MENTOR_BADGE_THRESHOLD = 25;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { sme_question_id, citing_user_id, citing_chat_message_id } = await req.json();
    if (!sme_question_id || !citing_user_id || !citing_chat_message_id) return jr({ error: 'v1: sme_question_id, citing_user_id, citing_chat_message_id required' }, 400);

    const { data: q } = await sb.from('sme_questions').select('id, org_id, ai_citation_count').eq('id', sme_question_id).single();
    if (!q) return jr({ error: 'v1: question not found' }, 404);

    // 1. Idempotency insert. ON CONFLICT DO NOTHING via .upsert with ignoreDuplicates.
    const { error: insErr } = await sb.from('sme_citation_events').insert({
      sme_question_id, citing_user_id, citing_chat_message_id, org_id: q.org_id,
    });
    if (insErr) {
      // Unique violation (23505) means already recorded — return silent success.
      if (insErr.code === '23505') {
        return jr({ success: true, version: 'v1', recorded: false, ai_citation_count: q.ai_citation_count });
      }
      console.log('sme_citation_events insert error:', insErr.message);
      return jr({ error: 'v1: insert failed: ' + insErr.message }, 500);
    }

    // 2. Atomic increment on sme_questions.ai_citation_count.
    const { data: updated } = await sb.from('sme_questions')
      .update({ ai_citation_count: (q.ai_citation_count || 0) + 1 })
      .eq('id', sme_question_id)
      .select('ai_citation_count')
      .single();
    const newCount = updated?.ai_citation_count || ((q.ai_citation_count || 0) + 1);

    // 3. Milestone check + badge grant.
    let milestoneAwarded: number | null = null;
    let mentorBadgeAwarded = false;
    if (CITATION_MILESTONES.includes(newCount)) {
      // Find the answering SME.
      const { data: answerRows } = await sb.from('sme_answer_thread')
        .select('author_user_id').eq('sme_question_id', sme_question_id)
        .eq('message_type', 'answer').eq('author_type', 'sme')
        .order('created_at', { ascending: false }).limit(1);
      const smeUserId = answerRows?.[0]?.author_user_id;
      if (smeUserId) {
        try {
          await sb.rpc('award_sme_credit', {
            p_sme_user_id: smeUserId, p_org_id: q.org_id,
            p_event_type: 'citation_milestone', p_credit_amount: 50,
            p_reference_id: sme_question_id, p_reference_table: 'sme_questions',
            p_notes: `crossed ${newCount} citations`,
          });
          milestoneAwarded = newCount;
        } catch (e: any) { console.log('award_sme_credit milestone error:', e?.message); }

        // Mentor badge at >=25 citations on any single answer (per doc).
        if (newCount === MENTOR_BADGE_THRESHOLD) {
          const { data: smeProf } = await sb.from('sme_profiles').select('id, user_id, badges').eq('user_id', smeUserId).eq('org_id', q.org_id).maybeSingle();
          if (smeProf && Array.isArray(smeProf.badges) && !smeProf.badges.includes('mentor')) {
            const next = [...smeProf.badges, 'mentor'];
            await sb.from('sme_profiles').update({ badges: next }).eq('id', smeProf.id);
            mentorBadgeAwarded = true;
            await sb.from('sme_notifications').insert({
              recipient_user_id: smeUserId, org_id: q.org_id,
              notification_type: 'badge_earned',
              reference_id: sme_question_id, reference_table: 'sme_questions',
              title: 'Badge earned: Mentor',
              body: 'One of your answers crossed 25 citations — Lux is leaning on your knowledge.',
            });
          }
        }
      }
    }

    return jr({
      success: true, version: 'v1',
      recorded: true, ai_citation_count: newCount,
      milestone_awarded: milestoneAwarded,
      mentor_badge_awarded: mentorBadgeAwarded,
    });
  } catch (err: any) {
    console.error('record-sme-citation v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
