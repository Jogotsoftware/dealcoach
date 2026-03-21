/**
 * DealCoach Webhook System
 *
 * Loads full deal context from Supabase (13 tables) and sends to
 * call-type-specific Make.com webhooks for Claude AI processing.
 *
 * Each call type has its own webhook URL so Make.com scenarios can
 * use different processing logic per call type.
 */

import { supabase } from './supabase'

// Map call types to their webhook env vars
const WEBHOOK_MAP = {
  qdc: import.meta.env.VITE_WEBHOOK_QDC,
  functional_discovery: import.meta.env.VITE_WEBHOOK_FUNCTIONAL_DISCOVERY,
  demo: import.meta.env.VITE_WEBHOOK_DEMO,
  scoping: import.meta.env.VITE_WEBHOOK_SCOPING,
  proposal: import.meta.env.VITE_WEBHOOK_PROPOSAL,
  negotiation: import.meta.env.VITE_WEBHOOK_NEGOTIATION,
  sync: import.meta.env.VITE_WEBHOOK_SYNC,
  custom: import.meta.env.VITE_WEBHOOK_CUSTOM,
}

/**
 * Get the webhook URL for a given call type.
 * Falls back to VITE_WEBHOOK_CUSTOM if no specific webhook is configured.
 */
export function getWebhookUrl(callType) {
  return WEBHOOK_MAP[callType] || WEBHOOK_MAP.custom || null
}

/**
 * Check if webhooks are configured
 */
export function isWebhookConfigured(callType) {
  return !!getWebhookUrl(callType)
}

/**
 * Skip null / "Unknown" values so the payload stays clean
 */
function clean(value) {
  if (!value || value === 'Unknown' || value === 'unknown') return null
  return value
}

/**
 * Load the complete deal context from Supabase.
 * This is everything Claude needs to give informed coaching.
 *
 * Tables loaded:
 * 1. deals — core deal record
 * 2. deal_analysis — 30+ qualification fields
 * 3. company_profile — company intel
 * 4. contacts — all stakeholders with roles/influence
 * 5. deal_competitors — competitive landscape
 * 6. compelling_events — urgency drivers
 * 7. business_catalysts — business change drivers
 * 8. conversations (previous) — all prior call summaries + coaching notes
 * 9. tasks (open) — so AI doesn't create duplicates
 * 10. proposal_insights — existing insights to avoid duplication
 * 11. msp_stages — deal timeline steps (flat list)
 * 12. deal_scores — current scoring
 */
export async function loadFullDealContext(dealId, excludeConversationId = null) {
  const queries = [
    supabase.from('deals').select('*').eq('id', dealId).single(),
    supabase.from('deal_analysis').select('*').eq('deal_id', dealId).single(),
    supabase.from('company_profile').select('*').eq('deal_id', dealId).single(),
    supabase.from('contacts').select('*').eq('deal_id', dealId),
    supabase.from('deal_competitors').select('*').eq('deal_id', dealId),
    supabase.from('compelling_events').select('*').eq('deal_id', dealId),
    supabase.from('business_catalysts').select('*').eq('deal_id', dealId),
    supabase.from('tasks')
      .select('title, priority, is_blocking, auto_generated, category, due_date')
      .eq('deal_id', dealId).eq('completed', false),
    supabase.from('proposal_insights')
      .select('insight_type, primary_text, impact_text, speaker_name')
      .eq('deal_id', dealId),
    supabase.from('msp_stages')
      .select('stage_name, stage_order, is_completed, status, due_date, notes')
      .eq('deal_id', dealId).order('stage_order'),
    supabase.from('deal_scores')
      .select('score_type, score, max_score, notes')
      .eq('deal_id', dealId),
  ]

  // Previous conversations — exclude the one being processed
  let convoQuery = supabase
    .from('conversations')
    .select('id, title, call_type, call_date, ai_summary, ai_coaching_notes')
    .eq('deal_id', dealId)
    .order('call_date', { ascending: true })
  if (excludeConversationId) {
    convoQuery = convoQuery.neq('id', excludeConversationId)
  }
  queries.push(convoQuery)

  const [
    dealRes, analysisRes, companyRes, contactsRes, competitorsRes,
    eventsRes, catalystsRes, tasksRes, insightsRes,
    stagesRes, scoresRes, convosRes,
  ] = await Promise.all(queries)

  return {
    deal: dealRes.data,
    analysis: analysisRes.data,
    company: companyRes.data,
    contacts: contactsRes.data || [],
    competitors: competitorsRes.data || [],
    events: eventsRes.data || [],
    catalysts: catalystsRes.data || [],
    openTasks: tasksRes.data || [],
    insights: insightsRes.data || [],
    mspStages: stagesRes.data || [],
    scores: scoresRes.data || [],
    previousConversations: convosRes.data || [],
  }
}

/**
 * Load coach configuration (system prompt, call-type prompt, extraction rules, documents)
 */
export async function loadCoachContext(coachId, callType) {
  if (!coachId) return { systemPrompt: '', callPrompt: '', extractionRules: '', coachDocuments: '' }

  const [coachRes, promptRes, docsRes] = await Promise.all([
    supabase.from('coaches').select('system_prompt, extraction_rules, model, temperature')
      .eq('id', coachId).single(),
    supabase.from('call_type_prompts').select('prompt, extraction_rules')
      .eq('coach_id', coachId).eq('call_type', callType).eq('active', true).limit(1),
    supabase.from('coach_documents').select('name, content')
      .eq('coach_id', coachId).eq('active', true),
  ])

  const coach = coachRes.data
  const prompt = promptRes.data?.[0]
  const docs = docsRes.data || []

  return {
    systemPrompt: coach?.system_prompt || '',
    extractionRules: prompt?.extraction_rules || coach?.extraction_rules || '',
    callPrompt: prompt?.prompt || '',
    coachDocuments: docs.map(d => `--- ${d.name} ---\n${d.content}`).join('\n\n'),
    model: coach?.model || 'claude-sonnet-4-20250514',
    temperature: coach?.temperature || 0.1,
  }
}

/**
 * Build the complete webhook payload.
 * This is what gets sent to Make.com — everything Claude needs in one shot.
 */
export function buildWebhookPayload({ conversation, dealContext, coachContext, repProfile }) {
  const { deal, analysis, company, contacts, competitors, events, catalysts,
    openTasks, insights, mspStages, scores, previousConversations } = dealContext

  return {
    // === Identifiers ===
    deal_id: deal?.id,
    conversation_id: conversation.id,
    call_type: conversation.call_type,

    // === Transcript ===
    transcript: conversation.transcript,
    call_date: conversation.call_date,
    call_title: conversation.title,

    // === Rep ===
    rep_name: repProfile?.full_name || '',
    rep_email: repProfile?.email || '',
    rep_initials: repProfile?.initials || '',

    // === Coach Configuration ===
    system_prompt: coachContext.systemPrompt,
    call_type_prompt: coachContext.callPrompt,
    extraction_rules: coachContext.extractionRules,
    coach_documents: coachContext.coachDocuments,
    ai_model: coachContext.model,
    ai_temperature: coachContext.temperature,

    // === Deal Core ===
    company_name: deal?.company_name || '',
    website: deal?.website || '',
    deal_stage: deal?.stage || '',
    forecast_category: deal?.forecast_category || '',
    deal_value: deal?.deal_value || 0,
    cmrr: deal?.cmrr || 0,
    target_close_date: deal?.target_close_date || '',
    current_next_steps: deal?.next_steps || '',
    fit_score: deal?.fit_score,
    deal_health_score: deal?.deal_health_score,

    // === Company Profile ===
    company_overview: clean(company?.overview),
    company_industry: clean(company?.industry),
    company_revenue: clean(company?.revenue),
    company_employees: clean(company?.employee_count),
    company_headquarters: clean(company?.headquarters),
    company_tech_stack: clean(company?.tech_stack),
    company_revenue_streams: clean(company?.revenue_streams),
    company_business_goals: clean(company?.business_goals),
    company_business_priorities: clean(company?.business_priorities),
    company_growth_plans: clean(company?.growth_plans),
    company_recent_news: clean(company?.recent_news),
    company_international: clean(company?.international_operations),

    // === Deal Analysis (full qualification) ===
    analysis_pain_points: clean(analysis?.pain_points),
    analysis_quantified_pain: clean(analysis?.quantified_pain),
    analysis_business_impact: clean(analysis?.business_impact),
    analysis_ideal_solution: clean(analysis?.ideal_solution),
    analysis_driving_factors: clean(analysis?.driving_factors),
    analysis_champion: clean(analysis?.champion),
    analysis_economic_buyer: clean(analysis?.economic_buyer),
    analysis_budget: clean(analysis?.budget),
    analysis_budget_allocated: analysis?.budget_allocated,
    analysis_current_spend: clean(analysis?.current_spend),
    analysis_decision_criteria: clean(analysis?.decision_criteria),
    analysis_decision_process: clean(analysis?.decision_process),
    analysis_decision_method: clean(analysis?.decision_method),
    analysis_timeline_drivers: clean(analysis?.timeline_drivers),
    analysis_decision_date: analysis?.decision_date,
    analysis_signature_date: analysis?.signature_date,
    analysis_kickoff_date: analysis?.kickoff_date,
    analysis_go_live_date: analysis?.go_live_date,
    analysis_busy_season: clean(analysis?.busy_season),
    analysis_integrations: clean(analysis?.integrations_needed),
    analysis_integration_impact: clean(analysis?.integration_impact),
    analysis_exec_alignment: clean(analysis?.exec_alignment),
    analysis_has_rfp: analysis?.has_rfp,
    analysis_has_consultant: analysis?.has_consultant,
    analysis_consultant_name: clean(analysis?.consultant_name),
    analysis_red_flags: clean(analysis?.red_flags),
    analysis_green_flags: clean(analysis?.green_flags),

    // === Contacts (array) ===
    contacts: contacts.map(c => ({
      name: c.name,
      title: c.title,
      department: c.department,
      role_in_deal: clean(c.role_in_deal),
      influence_level: clean(c.influence_level),
      is_champion: c.is_champion,
      is_economic_buyer: c.is_economic_buyer,
      is_signer: c.is_signer,
      priorities: clean(c.priorities),
      pain_points: clean(c.pain_points),
      decision_criteria: clean(c.decision_criteria),
      communication_style: clean(c.communication_style),
      previous_erp_experience: clean(c.previous_erp_experience),
    })),

    // === Competitors (array) ===
    competitors: competitors.map(c => ({
      name: c.competitor_name,
      strengths: clean(c.strengths),
      weaknesses: clean(c.weaknesses),
      where_in_process: clean(c.where_in_process),
      previous_bias: c.previous_bias,
      strategy: clean(c.strategy),
    })),

    // === Compelling Events (array) ===
    compelling_events: events.map(e => ({
      description: e.event_description,
      date: e.event_date,
      impact: clean(e.impact),
      strength: e.strength,
      verified: e.verified,
    })),

    // === Business Catalysts (array) ===
    business_catalysts: catalysts.map(c => ({
      catalyst: c.catalyst,
      category: c.category,
      impact: clean(c.impact),
      urgency: c.urgency,
    })),

    // === Previous Calls (summaries only) ===
    previous_calls: previousConversations.map(c => ({
      title: c.title,
      call_type: c.call_type,
      call_date: c.call_date,
      ai_summary: c.ai_summary,
      coaching_notes: c.ai_coaching_notes,
    })),

    // === Open Tasks (so AI doesn't duplicate) ===
    open_tasks: openTasks.map(t => ({
      title: t.title,
      priority: t.priority,
      is_blocking: t.is_blocking,
      auto_generated: t.auto_generated,
      category: t.category,
      due_date: t.due_date,
    })),

    // === Existing Insights (so AI doesn't duplicate) ===
    existing_insights: insights.map(i => ({
      type: i.insight_type,
      text: i.primary_text,
      impact: i.impact_text,
      speaker: i.speaker_name,
    })),

    // === MSP Status ===
    msp_stages: mspStages.map(s => ({
      name: s.stage_name,
      order: s.stage_order,
      completed: s.is_completed,
    })),
    // === Scores ===
    scores: scores.map(s => ({
      type: s.score_type,
      score: s.score,
      max: s.max_score,
    })),

    // === Supabase connection (for Make.com to write back) ===
    supabase_url: import.meta.env.VITE_SUPABASE_URL,
    supabase_key: import.meta.env.VITE_SUPABASE_ANON_KEY,
  }
}

/**
 * Process a transcript: load full context, send to Make.com webhook.
 *
 * Returns { success, webhookUrl } or { error }
 */
export async function processTranscript(conversationId) {
  try {
    // 1. Load conversation
    const { data: conv, error: convErr } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single()
    if (convErr || !conv) throw new Error('Conversation not found')

    // 2. Get webhook URL for this call type
    const webhookUrl = getWebhookUrl(conv.call_type)
    if (!webhookUrl) {
      return { error: `No webhook configured for call type: ${conv.call_type}. Check .env file.` }
    }

    // 3. Load full deal context (13 tables in parallel)
    const dealContext = await loadFullDealContext(conv.deal_id, conversationId)

    // 4. Load rep profile
    const { data: repProfile } = await supabase
      .from('profiles')
      .select('full_name, email, initials, active_coach_id')
      .eq('id', dealContext.deal?.rep_id)
      .single()

    // 5. Load coach context
    const coachContext = await loadCoachContext(
      repProfile?.active_coach_id,
      conv.call_type
    )

    // 6. Build full payload
    const payload = buildWebhookPayload({
      conversation: conv,
      dealContext,
      coachContext,
      repProfile,
    })

    // 7. Log the processing attempt
    await supabase.from('ai_response_log').insert({
      deal_id: conv.deal_id,
      conversation_id: conversationId,
      response_type: 'transcript_analysis',
      coach_id: repProfile?.active_coach_id || null,
      ai_model_used: coachContext.model,
      status: 'pending',
      triggered_by: dealContext.deal?.rep_id || null,
      extraction_summary: { webhook_url: webhookUrl, call_type: conv.call_type },
    })

    // 8. Send to Make.com (non-blocking — Make.com writes back to Supabase)
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(err => {
      console.error(`Webhook failed for ${conv.call_type}:`, err)
    })

    return {
      success: true,
      webhookUrl,
      callType: conv.call_type,
      contextLoaded: {
        contacts: dealContext.contacts.length,
        competitors: dealContext.competitors.length,
        previousCalls: dealContext.previousConversations.length,
        openTasks: dealContext.openTasks.length,
        insights: dealContext.insights.length,
        mspStages: dealContext.mspStages.length,
      },
    }
  } catch (err) {
    console.error('processTranscript error:', err)
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
