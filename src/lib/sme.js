// SME edge function client helpers.
// Mirrors the lib/webhooks.js pattern: each function authenticates from the
// current Supabase session, fires the named edge function, returns the JSON
// body. All errors are caught and returned as { error }.

import { supabase } from './supabase'

const SME_ENDPOINTS = [
  'escalate-to-sme',
  'sme-generate-clarifying-questions',
  'sme-submit-answer',
  'sme-mark-helpful',
  'sme-flag-incorrect',
  'sme-resolve-flag',
  'record-sme-citation',
]

async function callSme(endpoint, body) {
  if (!SME_ENDPOINTS.includes(endpoint)) return { error: `Unknown SME endpoint: ${endpoint}` }
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return { error: 'Not authenticated' }
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      },
    )
    return await res.json()
  } catch (err) {
    return { error: err.message }
  }
}

export function escalateToSme({ user_id, org_id, deal_id, chat_session_id, chat_message_id, question_text }) {
  return callSme('escalate-to-sme', { user_id, org_id, deal_id, chat_session_id, chat_message_id, question_text })
}

export function generateClarifyingQuestions(sme_question_id) {
  return callSme('sme-generate-clarifying-questions', { sme_question_id })
}

export function submitSmeAnswer({ sme_question_id, sme_user_id, answer_text, addressed_clarifications }) {
  return callSme('sme-submit-answer', { sme_question_id, sme_user_id, answer_text, addressed_clarifications })
}

export function markSmeAnswerHelpful({ sme_question_id, asker_user_id, helpful, feedback_text, deactivate_correction, apply_to_roi_builder }) {
  return callSme('sme-mark-helpful', { sme_question_id, asker_user_id, helpful, feedback_text, deactivate_correction, apply_to_roi_builder })
}

export function flagSmeAnswerIncorrect({ sme_question_id, flagged_by_user_id, flag_reason, flag_notes }) {
  return callSme('sme-flag-incorrect', { sme_question_id, flagged_by_user_id, flag_reason, flag_notes })
}

export function resolveSmeFlag({ flag_id, resolver_user_id, resolution, resolution_notes }) {
  return callSme('sme-resolve-flag', { flag_id, resolver_user_id, resolution, resolution_notes })
}

export function recordSmeCitation({ sme_question_id, citing_user_id, citing_chat_message_id }) {
  return callSme('record-sme-citation', { sme_question_id, citing_user_id, citing_chat_message_id })
}

// Rank threshold reference (matches compute_sme_rank in the DB).
export function rankFromCredits(credits) {
  if (credits >= 5000) return 'platinum'
  if (credits >= 1000) return 'gold'
  if (credits >= 250) return 'silver'
  return 'bronze'
}

export const SME_RANK_COLORS = {
  bronze: '#c08457',
  silver: '#9aa5b1',
  gold: '#e8b923',
  platinum: '#5DADE2',
}

export const SME_BADGE_LABELS = {
  first_responder: 'First Responder',
  workhorse_50: 'Workhorse · 50',
  workhorse_100: 'Workhorse · 100',
  workhorse_250: 'Workhorse · 250',
  workhorse_500: 'Workhorse · 500',
  topic_master: 'Topic Master',
  trusted_voice: 'Trusted Voice',
  mentor: 'Mentor',
}
