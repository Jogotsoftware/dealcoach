import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// sme-resolve-flag v1
// Admin (or the original SME) resolves a flagged answer with one of:
//   valid    → answer was indeed wrong. -15 credits, deactivate paired ai_memory
//              + coach_documents. status stays 'flagged_incorrect' so future
//              readers see the badge.
//   invalid  → flag rejected. 0 credit (audit row only). If no other open flags
//              remain, revert status from flagged_incorrect → answered.
//   partial  → answer needed clarification. -5 credits. ai_memory stays active
//              (the answer is mostly right) but the resolution_notes feed an
//              update to the memory content if provided.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const { flag_id, resolver_user_id, resolution, resolution_notes } = await req.json();
    if (!flag_id || !resolver_user_id || !['valid', 'invalid', 'partial'].includes(resolution)) {
      return jr({ error: 'v1: flag_id, resolver_user_id, resolution in (valid|invalid|partial) required' }, 400);
    }

    const { data: flag } = await sb.from('sme_answer_flags').select('*').eq('id', flag_id).single();
    if (!flag) return jr({ error: 'v1: flag not found' }, 404);

    const status = 'resolved_' + resolution;
    await sb.from('sme_answer_flags').update({
      status, resolved_at: new Date().toISOString(),
      resolved_by_user_id: resolver_user_id,
      resolution_notes: resolution_notes || null,
    }).eq('id', flag_id);

    // Find the original answering SME (most recent SME answer).
    const { data: answerRows } = await sb.from('sme_answer_thread')
      .select('author_user_id').eq('sme_question_id', flag.sme_question_id)
      .eq('message_type', 'answer').eq('author_type', 'sme')
      .order('created_at', { ascending: false }).limit(1);
    const originalSme = answerRows?.[0]?.author_user_id;

    const { data: q } = await sb.from('sme_questions').select('org_id, status, question_text').eq('id', flag.sme_question_id).single();

    let creditDelta = 0;
    let memoryDeactivated = false;
    let docDeactivated = false;

    if (resolution === 'valid' && originalSme && q) {
      creditDelta = -15;
      try {
        await sb.rpc('award_sme_credit', {
          p_sme_user_id: originalSme, p_org_id: q.org_id,
          p_event_type: 'flag_resolved_valid', p_credit_amount: -15,
          p_reference_id: flag_id, p_reference_table: 'sme_answer_flags', p_notes: flag.flag_reason,
        });
      } catch (e: any) { console.log('award_sme_credit v error:', e?.message); }

      // Deactivate the paired ai_memory (memory_type='sme_qa' for this question).
      // Strategy: locate by source_type='sme_answer' + content containing the question text head.
      const head = (q.question_text || '').slice(0, 60);
      if (head) {
        const { data: memRows } = await sb.from('ai_memory').select('id')
          .eq('org_id', q.org_id).eq('memory_type', 'sme_qa').eq('source_type', 'sme_answer').eq('active', true)
          .ilike('content', `%${head}%`);
        if (memRows && memRows.length) {
          await sb.from('ai_memory').update({
            active: false, resolved: true,
            resolved_at: new Date().toISOString(),
            resolved_reason: 'SME answer flagged invalid',
          }).in('id', memRows.map((r: any) => r.id));
          memoryDeactivated = true;
        }
      }
      // Deactivate paired coach_documents (doc_type='sme_qa' with name starting "SME Q&A:").
      const docHead = `SME Q&A: ${(q.question_text || '').slice(0, 30)}`;
      const { data: docRows } = await sb.from('coach_documents').select('id')
        .eq('doc_type', 'sme_qa').eq('active', true).ilike('name', `${docHead}%`);
      if (docRows && docRows.length) {
        await sb.from('coach_documents').update({ active: false }).in('id', docRows.map((r: any) => r.id));
        docDeactivated = true;
      }
      // Leave status as 'flagged_incorrect' so future readers see the badge.
    } else if (resolution === 'invalid' && originalSme && q) {
      try {
        await sb.rpc('award_sme_credit', {
          p_sme_user_id: originalSme, p_org_id: q.org_id,
          p_event_type: 'flag_resolved_invalid', p_credit_amount: 0,
          p_reference_id: flag_id, p_reference_table: 'sme_answer_flags', p_notes: 'flag rejected',
        });
      } catch (e: any) { console.log('award_sme_credit i error:', e?.message); }

      // If no remaining open flags AND status was flagged_incorrect, revert to answered.
      const { count } = await sb.from('sme_answer_flags').select('id', { count: 'exact', head: true })
        .eq('sme_question_id', flag.sme_question_id).eq('status', 'open');
      if ((count || 0) === 0 && q.status === 'flagged_incorrect') {
        await sb.from('sme_questions').update({ status: 'answered' }).eq('id', flag.sme_question_id);
      }
    } else if (resolution === 'partial' && originalSme && q) {
      creditDelta = -5;
      try {
        await sb.rpc('award_sme_credit', {
          p_sme_user_id: originalSme, p_org_id: q.org_id,
          p_event_type: 'flag_resolved_partial', p_credit_amount: -5,
          p_reference_id: flag_id, p_reference_table: 'sme_answer_flags', p_notes: resolution_notes || null,
        });
      } catch (e: any) { console.log('award_sme_credit p error:', e?.message); }

      // If resolution_notes provided, append a clarification line to the live ai_memory row.
      if (resolution_notes) {
        const head = (q.question_text || '').slice(0, 60);
        const { data: memRows } = await sb.from('ai_memory').select('id, content')
          .eq('org_id', q.org_id).eq('memory_type', 'sme_qa').eq('source_type', 'sme_answer').eq('active', true)
          .ilike('content', `%${head}%`);
        for (const m of (memRows || [])) {
          const newContent = (m.content || '') + `\n[Clarified by admin ${new Date().toISOString().slice(0, 10)}: ${resolution_notes.slice(0, 400)}]`;
          await sb.from('ai_memory').update({ content: newContent }).eq('id', m.id);
        }
      }
    }

    // Notify the original SME.
    if (originalSme && q) {
      await sb.from('sme_notifications').insert({
        recipient_user_id: originalSme, org_id: q.org_id,
        notification_type: 'flag_resolved',
        reference_id: flag.sme_question_id, reference_table: 'sme_questions',
        title: `Flag resolved (${resolution})`,
        body: `Credit change: ${creditDelta >= 0 ? '+' : ''}${creditDelta}${resolution_notes ? `  ·  ${(resolution_notes as string).slice(0, 100)}` : ''}`,
      });
    }

    return jr({
      success: true, version: 'v1',
      resolution,
      credit_delta: creditDelta,
      memory_deactivated: memoryDeactivated,
      doc_deactivated: docDeactivated,
    });
  } catch (err: any) {
    console.error('sme-resolve-flag v1 error:', err);
    return jr({ error: `v1: ${err.message}` }, 500);
  }
});
