/**
 * DealCoach Edge Function Callers
 *
 * All AI processing is handled by Supabase Edge Functions.
 * Each function handles auth, credit checks, and calls the appropriate edge function.
 */

import { supabase } from './supabase'

/**
 * Check if an org has enough credits for an action.
 * Returns { allowed: true } or { allowed: false, reason: '...' }
 */
export async function checkCredits(orgId, actionType) {
  if (!orgId) return { allowed: true }
  const { data: cost } = await supabase.from('credit_costs').select('credits_cost').eq('action_type', actionType).single()
  if (!cost) return { allowed: true }
  const { data } = await supabase.rpc('check_credits', { p_org_id: orgId, p_required: cost.credits_cost })
  return data || { allowed: false, reason: 'Credit check failed' }
}

/**
 * Get the org_id for the current authenticated user.
 */
async function getOrgIdFromSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user?.id) return null
  const { data: profile } = await supabase.from('profiles').select('org_id').eq('id', session.user.id).single()
  return profile?.org_id || null
}

// Edge function callers

/**
 * Call the send-invitation edge function to email an invitation via Resend.
 */
export async function callSendInvitation(invitationId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invitation`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ invitation_id: invitationId }),
      }
    )
    return await response.json()
  } catch (err) {
    return { error: err.message }
  }
}


/**
 * Call the Supabase Edge Function to research a company.
 * Used after deal creation to auto-populate company_profile.
 */
export async function callResearchFunction(dealId) {
  console.log('Calling research-company for deal:', dealId)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }

  const orgId = await getOrgIdFromSession()
  const creditCheck = await checkCredits(orgId, 'research')
  if (!creditCheck.allowed) return { error: creditCheck.reason || 'Insufficient credits for research' }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/research-company`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ deal_id: dealId }),
      }
    )
    const res = await response.json()
    console.log('Edge function response:', res)
    return res
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Call the Supabase Edge Function to process a transcript.
 * Replaces the Make.com webhook flow with a direct Edge Function call.
 */
export async function callProcessTranscript(conversationId) {
  console.log('Calling process-transcript for conversation:', conversationId)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }

  const orgId = await getOrgIdFromSession()
  const creditCheck = await checkCredits(orgId, 'transcript_analysis')
  if (!creditCheck.allowed) return { error: creditCheck.reason || 'Insufficient credits for transcript analysis' }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-transcript`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ conversation_id: conversationId }),
      }
    )
    const res = await response.json()
    console.log('Edge function response:', res)
    return res
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Call the Supabase Edge Function to generate an email from a template.
 */
export async function callGenerateEmail(dealId, templateId, conversationId = null) {
  console.log('Calling generate-email for deal:', dealId, 'template:', templateId)
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }

  const orgId = await getOrgIdFromSession()
  const creditCheck = await checkCredits(orgId, 'email')
  if (!creditCheck.allowed) return { error: creditCheck.reason || 'Insufficient credits for email generation' }

  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-email`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ deal_id: dealId, template_id: templateId, conversation_id: conversationId }),
      }
    )
    const res = await response.json()
    console.log('Generate email response:', res)
    return res
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Call the Supabase Edge Function for deal chat (AI coaching).
 */
export async function callDealChat(dealId, sessionId, message, userId, contextType = null, pageContext = null) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }

  const orgId = await getOrgIdFromSession()
  const creditCheck = await checkCredits(orgId, 'chat')
  if (!creditCheck.allowed) return { error: creditCheck.reason || 'Insufficient credits for coach chat' }

  try {
    const body = { deal_id: dealId || null, session_id: sessionId, message, user_id: userId }
    if (contextType) body.context_type = contextType
    if (pageContext) body.page_context = pageContext
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/deal-chat`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify(body),
      }
    )
    return await response.json()
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Call the Supabase Edge Function to update coaching summary for a user.
 */
export async function callUpdateCoachingSummary(userId) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-coaching-summary`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: userId }),
      }
    )
    return await response.json()
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Reprocess a deal: research, reprocess all transcripts, consolidate, update coaching.
 * Calls onStatus callback with progress messages.
 */
export async function reprocessDeal(dealId, onStatus) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${session.access_token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
  const base = import.meta.env.VITE_SUPABASE_URL + '/functions/v1'
  const results = { steps: [] }

  onStatus?.('Running company research...')
  try {
    const res = await fetch(base + '/research-company', { method: 'POST', headers, body: JSON.stringify({ deal_id: dealId }) })
    results.steps.push({ step: 'research', ...(await res.json()) })
  } catch (e) { results.steps.push({ step: 'research', error: e.message }) }

  onStatus?.('Reprocessing transcripts...')
  try {
    const { data: convs } = await supabase.from('conversations').select('id').eq('deal_id', dealId).not('transcript', 'is', null)
    if (convs?.length) {
      for (let i = 0; i < convs.length; i++) {
        onStatus?.(`Reprocessing transcript ${i + 1} of ${convs.length}...`)
        try {
          const res = await fetch(base + '/process-transcript', { method: 'POST', headers, body: JSON.stringify({ conversation_id: convs[i].id }) })
          results.steps.push({ step: `transcript_${i + 1}`, ...(await res.json()) })
        } catch (e) { results.steps.push({ step: `transcript_${i + 1}`, error: e.message }) }
      }
    }
  } catch (e) { results.steps.push({ step: 'transcripts', error: e.message }) }

  onStatus?.('Consolidating and deduplicating...')
  try {
    const res = await fetch(base + '/consolidate-deal-data', { method: 'POST', headers, body: JSON.stringify({ deal_id: dealId }) })
    results.steps.push({ step: 'consolidate', ...(await res.json()) })
  } catch (e) { results.steps.push({ step: 'consolidate', error: e.message }) }

  onStatus?.('Updating coaching summary...')
  try {
    const res = await fetch(base + '/update-coaching-summary', { method: 'POST', headers, body: JSON.stringify({ user_id: session.user.id }) })
    results.steps.push({ step: 'coaching', ...(await res.json()) })
  } catch (e) { results.steps.push({ step: 'coaching', error: e.message }) }

  results.success = true
  return results
}

/**
 * Call the Supabase Edge Function to generate presentation slides for a deal.
 */
export async function callGenerateSlides(dealId, slideTypes, model = 'claude-opus-4-6') {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return { error: 'Not authenticated' }
  try {
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-slides`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ deal_id: dealId, slide_types: slideTypes, model }),
      }
    )
    return await response.json()
  } catch (err) {
    return { error: err.message }
  }
}
