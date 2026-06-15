import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sme-mark-helpful v2
// v2: ai_memory and coach_documents content templates now lead with a parseable
//     Citation Metadata block so Lux can emit a `type: 'sme_answer'` fenced
//     source block (powering record-sme-citation + Mentor badge). Templates
//     include sme_question_id, sme_name, answered_at (ISO), helpful_marks.
// v1 (PR 4): Asker clicks Helpful → promotes the SME answer into long-term memory:
//   1. ai_memory row (memory_type='sme_qa') — Lux deal/org-scoped read paths surface it
//   2. coach_documents row (doc_type='sme_qa') — flows into assemble_coach_prompt v2
//   3. award 25 credits to the answering SME
//   4. notify the SME
// Branch A — correction-validation: if the question was auto-created from a
// chat correction (ai_correction_memory_id != null) AND the asker checked
// "this means the original Lux answer was actually correct — deactivate my
// earlier correction", deactivate the linked correction ai_memory row instead
// of leaving it active alongside the new sme_qa row.
// Branch B — ROIBuilder writeback: if the question's topic_tags contain
// isv-named-<slug> or implementation-partner-named-<slug> AND
// apply_to_roi_builder=true, also insert a coach_roi_partner_driver_library
// row scoped to the matching partner so the ROI surface picks it up.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { sme_question_id, asker_user_id, helpful, feedback_text, deactivate_correction, apply_to_roi_builder } = await req.json();
    if (!sme_question_id || !asker_user_id || typeof helpful !== 'boolean') return jr({ error: 'v2: sme_question_id, asker_user_id, helpful required' }, 400);

    const { data: q } = await sb.from('sme_questions').select('*').eq('id', sme_question_id).single();
    if (!q) return jr({ error: 'v2: question not found' }, 404);

    // 1. Persist asker feedback regardless of value.
    await sb.from('sme_questions').update({
      asker_helpful: helpful,
      asker_feedback_text: feedback_text || null,
      closed_at: new Date().toISOString(),
    }).eq('id', sme_question_id);

    if (!helpful) {
      return jr({ success: true, version: 'v2', helpful: false, memory_id: null, doc_id: null });
    }

    // 2. Find the answering SME (most recent answer in thread).
    const { data: answerRows } = await sb.from('sme_answer_thread')
      .select('id, content, author_user_id, created_at')
      .eq('sme_question_id', sme_question_id)
      .eq('message_type', 'answer')
      .eq('author_type', 'sme')
      .order('created_at', { ascending: false })
      .limit(1);
    const answer = answerRows?.[0];
    if (!answer) return jr({ error: 'v2: no SME answer found to promote' }, 400);
    const smeUserId = answer.author_user_id;
    const answerText = answer.content || '';

    // 3. SME profile (for "per {sme_full_name}, {date}" attribution).
    let smeName = 'SME';
    if (smeUserId) {
      const { data: smeProf } = await sb.from('profiles').select('full_name').eq('id', smeUserId).single();
      if (smeProf?.full_name) smeName = smeProf.full_name;
    }
    const answeredAtIso = q.answered_at || answer.created_at || new Date().toISOString();
    const answeredAt = answeredAtIso.slice(0, 10);
    // v2: count helpful marks AFTER this current event (so first helpful = 1).
    // Cheapest source-of-truth: count sme_questions in the same thread with asker_helpful=true.
    // For this turn, the question we just updated has asker_helpful=true, so +1 over historical.
    let helpfulMarksCount = 1;
    try {
      const { count } = await sb.from('sme_questions')
        .select('id', { count: 'exact', head: true })
        .eq('id', sme_question_id)
        .eq('asker_helpful', true);
      helpfulMarksCount = count || 1;
    } catch (e: any) { console.log('helpful_marks count error (non-fatal):', e?.message); }

    // v2: lead with a parseable inline metadata prefix so Lux can extract the
    // sme_question_id verbatim for source-block citations.
    const memoryContent = `[sme_question_id=${sme_question_id} sme_name="${smeName.replace(/"/g, '\\"')}" answered_at=${answeredAtIso} helpful_marks=${helpfulMarksCount}] Q: ${q.question_text} A: ${answerText}. Tags: ${(q.topic_tags || []).join(', ')}.`;

    // 4. Write the ai_memory row. deal_id may be NULL for org-scoped knowledge.
    let memoryId: string | null = null;
    const { data: memRow, error: memErr } = await sb.from('ai_memory').insert({
      deal_id: q.deal_id,  // null is allowed post Phase A
      org_id: q.org_id,
      memory_type: 'sme_qa',
      content: memoryContent,
      priority: 'high',
      source_type: 'sme_answer',
      source_conversation_id: null,
      related_field: null,
      active: true,
      resolved: false,
    }).select('id').single();
    if (memErr) console.log('ai_memory insert error:', memErr.message);
    else memoryId = memRow?.id || null;

    // 5. Write the coach_documents row so assemble_coach_prompt v2 picks it up.
    // Coach scope: the org's primary non-template coach. Fall back to whatever first matches.
    let coachId: string | null = null;
    const { data: coachRow } = await sb.from('coaches')
      .select('id').eq('org_id', q.org_id).eq('is_template', false)
      .order('created_at', { ascending: true })
      .limit(1).maybeSingle();
    coachId = coachRow?.id || null;
    if (!coachId) {
      // Fallback: representative profile's active_coach_id.
      const { data: askerProf } = await sb.from('profiles').select('active_coach_id').eq('id', q.asked_by_user_id).single();
      coachId = askerProf?.active_coach_id || null;
    }
    let docId: string | null = null;
    if (coachId) {
      const titleHead = (q.question_text || '').slice(0, 60);
      const docName = `SME Q&A: ${titleHead}${(q.question_text || '').length > 60 ? '…' : ''}`;
      // v2: structured metadata block at the top so Lux can extract citation fields directly.
      const docContent = `# Citation Metadata\nsme_question_id: ${sme_question_id}\nsme_name: ${smeName}\nanswered_at: ${answeredAtIso}\nhelpful_marks: ${helpfulMarksCount}\n\n# Question\n${q.question_text}\n\n# Answer (per ${smeName}, ${answeredAt})\n${answerText}\n\n# Topics\n${(q.topic_tags || []).join(', ')}\n\n# Source\nSME question ${sme_question_id}`;
      const { data: docRow, error: docErr } = await sb.from('coach_documents').insert({
        coach_id: coachId, name: docName, doc_type: 'sme_qa',
        content: docContent, active: true,
        uploaded_by: smeUserId, processing_status: 'ready',
      }).select('id').single();
      if (docErr) console.log('coach_documents insert error:', docErr.message);
      else docId = docRow?.id || null;
    }

    // 6. Branch A — correction-validation deactivation.
    let correctionDeactivated = false;
    if (q.ai_correction_memory_id && deactivate_correction === true) {
      const { error: deErr } = await sb.from('ai_memory').update({
        active: false, resolved: true,
        resolved_at: new Date().toISOString(),
        resolved_reason: 'SME validation: original Lux answer was correct',
      }).eq('id', q.ai_correction_memory_id);
      if (!deErr) correctionDeactivated = true;
    }

    // 7. Award 25 credits.
    let creditsAwarded = 0;
    if (smeUserId) {
      try {
        await sb.rpc('award_sme_credit', {
          p_sme_user_id: smeUserId, p_org_id: q.org_id,
          p_event_type: 'marked_helpful', p_credit_amount: 25,
          p_reference_id: sme_question_id, p_reference_table: 'sme_questions', p_notes: null,
        });
        creditsAwarded = 25;
      } catch (e: any) { console.log('award_sme_credit error (non-fatal):', e?.message); }
    }

    // 8. Notify the SME.
    if (smeUserId) {
      await sb.from('sme_notifications').insert({
        recipient_user_id: smeUserId, org_id: q.org_id,
        notification_type: 'marked_helpful',
        reference_id: sme_question_id, reference_table: 'sme_questions',
        title: 'Your answer was marked helpful',
        body: `+25 credits${docId ? ' · promoted to org knowledge' : ''}`,
      });
    }

    // 9. Branch B — ROIBuilder partner-library writeback.
    let roiDriverId: string | null = null;
    if (apply_to_roi_builder === true && coachId && (q.topic_tags || []).length) {
      const partnerTag = (q.topic_tags as string[]).find(t => t.startsWith('isv-named-') || t.startsWith('implementation-partner-named-'));
      if (partnerTag) {
        const partnerSlug = partnerTag.replace(/^(isv-named-|implementation-partner-named-)/, '');
        // Match partners by slugified name within the coach's org.
        const { data: partners } = await sb.from('coach_roi_partners').select('id, name').eq('coach_id', coachId).eq('active', true);
        const matched = (partners || []).find((p: any) => slugify(p.name || '') === partnerSlug);
        if (matched) {
          const titleHead = (q.question_text || '').slice(0, 80);
          const { data: driverRow, error: driverErr } = await sb.from('coach_roi_partner_driver_library').insert({
            coach_id: coachId, partner_id: matched.id,
            name: `SME Q&A: ${titleHead}`,
            category: 'sme_qa',
            description: answerText.slice(0, 1000),
            methodology_notes: `From SME ${smeName} on ${answeredAt}. Source: sme_questions/${sme_question_id}.`,
            active: true,
          }).select('id').single();
          if (driverErr) console.log('roi driver insert error:', driverErr.message);
          else roiDriverId = driverRow?.id || null;
        }
      }
    }

    return jr({
      success: true, version: 'v2',
      helpful: true,
      memory_id: memoryId,
      doc_id: docId,
      credits_awarded: creditsAwarded,
      correction_deactivated: correctionDeactivated,
      roi_driver_id: roiDriverId,
    });
  } catch (err: any) {
    console.error('sme-mark-helpful v2 error:', err);
    return jr({ error: `v2: ${err.message}` }, 500);
  }
});
