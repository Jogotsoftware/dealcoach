import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// generate-email v12
// CHANGES FROM v11:
// - Calls assemble_coach_prompt RPC (p_action='generate_email') and prepends the 4-layer assembled
//   prompt to the hardcoded EMAIL_SYSTEM_PROMPT so coach voice, value props, and ICP are in scope.
// - Upserts assembled_prompt_versions (dedup on SHA-256 hash, increments use_count).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jsonResponse(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }); }
function clean(v: any): string { if (!v || v === 'Unknown') return 'Not available'; return String(v); }

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function recordAssembledPrompt(sb: any, coachId: string | null, callType: string | null, action: string, content: string) {
  try {
    const hash = await sha256Hex(content);
    const { data: existing } = await sb.from('assembled_prompt_versions').select('id, use_count').eq('prompt_hash', hash).limit(1).maybeSingle();
    if (existing?.id) {
      await sb.from('assembled_prompt_versions').update({ last_used_at: new Date().toISOString(), use_count: (existing.use_count || 0) + 1 }).eq('id', existing.id);
    } else {
      await sb.from('assembled_prompt_versions').insert({ prompt_hash: hash, coach_id: coachId, call_type: callType, action, assembled_content: content });
    }
  } catch (e) { console.log('recordAssembledPrompt error:', e); }
}

async function callClaudeWithRetry(body: any, maxRetries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (response.ok) return response;
    if ([429, 500, 503, 529].includes(response.status)) { await new Promise(r => setTimeout(r, Math.min(2000 * Math.pow(2, attempt - 1), 30000))); continue; }
    return response;
  }
  return await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
}

const EMAIL_SYSTEM_PROMPT = `You are a professional sales communication AI for enterprise B2B sales teams. You generate polished, actionable emails that reflect deep knowledge of the deal and the prospect's business.

EMAIL PRINCIPLES:
- Every email must demonstrate that you know the prospect's business, pains, and priorities. Generic emails are unacceptable.
- Internal emails (SC Briefing, Internal Updates) should use methodology language: BANT gaps, compelling event status, champion strength, methodology framework references from your system prompt.
- External emails should be professional, concise, and tie back to the prospect's stated business goals and priorities.
- Follow-up emails should reference specific discussions from calls, including who said what.
- SC Briefing Notes should give the Solutions Consultant everything they need: main pains, focus of evaluation, integration requirements, contacts and personalities, unanswered questions, competitive landscape.
- Scoping KT emails should transfer the full Pain Chain, system mapping, integration dependencies, and timeline requirements.
- Executive Alignment emails should connect the evaluation to the prospect's strategic initiatives and business outcomes.
- Internal Deal Updates should use the proper forecast format: RED/GREEN status, next steps with dates, risk shorthand.
- Never fabricate information. If data isn't available, note it as a gap.`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'v12: ANTHROPIC_API_KEY not configured' }, 500);
    const { deal_id, template_id, conversation_id } = await req.json();
    if (!deal_id || !template_id) return jsonResponse({ error: 'v12: deal_id and template_id required' }, 400);

    const { data: template } = await sb.from('email_templates').select('*').eq('id', template_id).single();
    if (!template) return jsonResponse({ error: 'v12: Email template not found' }, 404);

    const { data: deal } = await sb.from('deals').select('*').eq('id', deal_id).single();
    if (!deal) return jsonResponse({ error: 'v12: Deal not found' }, 404);

    const [analysisRes, companyRes, contactsRes, competitorsRes, eventsRes, catalystsRes, tasksRes, insightsRes, mspRes, scoresRes, convsRes, painsRes, risksRes, sourcesRes, flagsRes] = await Promise.all([
      template.include_deal_analysis ? sb.from('deal_analysis').select('*').eq('deal_id', deal_id).single() : { data: null },
      template.include_company_profile ? sb.from('company_profile').select('*').eq('deal_id', deal_id).single() : { data: null },
      template.include_contacts ? sb.from('contacts').select('*').eq('deal_id', deal_id) : { data: [] },
      template.include_competition ? sb.from('deal_competitors').select('*').eq('deal_id', deal_id) : { data: [] },
      sb.from('compelling_events').select('*').eq('deal_id', deal_id),
      sb.from('business_catalysts').select('*').eq('deal_id', deal_id),
      template.include_tasks ? sb.from('tasks').select('*').eq('deal_id', deal_id).eq('completed', false) : { data: [] },
      sb.from('proposal_insights').select('*').eq('deal_id', deal_id),
      template.include_msp ? sb.from('msp_stages').select('*').eq('deal_id', deal_id).order('stage_order') : { data: [] },
      template.include_scores ? sb.from('deal_scores').select('*').eq('deal_id', deal_id) : { data: [] },
      template.include_transcripts ? sb.from('conversations').select('id, title, call_type, call_date, ai_summary, ai_coaching_notes').eq('deal_id', deal_id).order('call_date', { ascending: false }).limit(10) : { data: [] },
      template.include_pain_points ? sb.from('deal_pain_points').select('*').eq('deal_id', deal_id) : { data: [] },
      sb.from('deal_risks').select('*').eq('deal_id', deal_id),
      sb.from('deal_sources').select('*').eq('deal_id', deal_id).order('created_at', { ascending: false }).limit(30),
      sb.from('deal_flags').select('*').eq('deal_id', deal_id),
    ]);

    const analysis = analysisRes.data;
    const company = companyRes.data;
    const contacts = contactsRes.data || [];
    const competitors = competitorsRes.data || [];
    const events = eventsRes.data || [];
    const catalysts = catalystsRes.data || [];
    const tasks = tasksRes.data || [];
    const insights = insightsRes.data || [];
    const mspStages = mspRes.data || [];
    const conversations = convsRes.data || [];
    const painPoints = painsRes.data || [];
    const risks = risksRes.data || [];
    const sources = sourcesRes.data || [];
    const flags = flagsRes.data || [];

    let specificTranscript = '';
    if (conversation_id) {
      const { data: conv } = await sb.from('conversations').select('*').eq('id', conversation_id).single();
      if (conv) specificTranscript = `\n\nMOST RECENT CALL (${conv.call_type} on ${conv.call_date}):\nSummary: ${conv.ai_summary || ''}\nCoaching: ${conv.ai_coaching_notes || ''}\n\nTranscript:\n${conv.transcript?.substring(0, 15000) || 'No transcript'}`;
    }

    const { data: rep } = await sb.from('profiles').select('active_coach_id, full_name, initials, email, title, org_id').eq('id', deal.rep_id).single();
    let model = 'claude-sonnet-4-20250514';
    let temperature = 0.3;
    const cid = rep?.active_coach_id || null;
    if (cid) {
      const { data: coach } = await sb.from('coaches').select('model, temperature').eq('id', cid).single();
      if (coach) { model = coach.model || model; temperature = Number(coach.temperature) || temperature; }
    }

    // ── Assemble coach-layer prompt (platform core + methodology + coach + ICP) ──
    let assembledCoachPrompt = '';
    if (cid) {
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', {
          p_coach_id: cid,
          p_call_type: conversations[0]?.call_type || null,
          p_action: 'generate_email',
        });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          assembledCoachPrompt = assembled;
          await recordAssembledPrompt(sb, cid, conversations[0]?.call_type || null, 'generate_email', assembled);
        }
      } catch (e) { console.log('assemble_coach_prompt error (email, non-fatal):', e); }
    }

    let context = `DEAL: ${deal.company_name} | Stage: ${deal.stage} | Forecast: ${deal.forecast_category}\nValue: $${deal.deal_value || 0} | CMRR: $${deal.cmrr || 0} | Close: ${deal.target_close_date || 'TBD'}\nNext Steps: ${deal.next_steps || 'None'}\nFit: ${deal.fit_score || '?'}/10 | Health: ${deal.deal_health_score || '?'}/10`;

    if (company) {
      context += `\n\nCOMPANY:\n${clean(company.overview)}\nIndustry: ${clean(company.industry)} | Revenue: ${clean(company.revenue)} | Employees: ${clean(company.employee_count)}\nHQ: ${clean(company.headquarters)} | Tech: ${clean(company.tech_stack)}\nGoals: ${clean(company.business_goals)} | Priorities: ${clean(company.business_priorities)}\nLeadership: ${clean(company.leadership)}\nPE/VC: ${clean(company.pe_vc_investors)}\nEvents: ${clean(company.events_attended)}\nGrowth: ${clean(company.growth_plans)} | Hiring: ${clean(company.hiring_signals)}\nCompetitive Landscape: ${clean(company.competitive_landscape)}`;
    }

    if (analysis) {
      context += `\n\nANALYSIS:\nPains: ${clean(analysis.pain_points)} | Quantified: ${clean(analysis.quantified_pain)}\nImpact: ${clean(analysis.business_impact)} | Budget: ${clean(analysis.budget)}\nChampion: ${clean(analysis.champion)} | EB: ${clean(analysis.economic_buyer)}\nTimeline: ${clean(analysis.timeline_drivers)} | Criteria: ${clean(analysis.decision_criteria)}\nProcess: ${clean(analysis.decision_process)} | Integrations: ${clean(analysis.integrations_needed)}\nExec Alignment: ${clean(analysis.exec_alignment)} | Driving Factors: ${clean(analysis.driving_factors)}\nRed Flags: ${clean(analysis.red_flags)} | Green Flags: ${clean(analysis.green_flags)}`;
    }

    if (contacts.length) context += `\n\nCONTACTS:\n${contacts.map((c: any) => `- ${c.name} | ${c.title || '?'} | ${c.role_in_deal || '?'}${c.is_champion ? ' [CHAMP]' : ''}${c.is_economic_buyer ? ' [EB]' : ''}${c.priorities ? ' | Priorities: ' + c.priorities : ''}${c.pain_points ? ' | Pains: ' + c.pain_points : ''}`).join('\n')}`;
    if (competitors.length) context += `\n\nCOMPETITION:\n${competitors.map((c: any) => `- ${c.competitor_name}: ${clean(c.strengths)} / ${clean(c.weaknesses)} | ${clean(c.where_in_process)}`).join('\n')}`;
    if (painPoints.length) context += `\n\nPAIN POINTS:\n${painPoints.map((p: any) => `- ${p.pain_description}${p.annual_cost ? ' ($' + p.annual_cost + '/yr)' : ''} [${p.category}]${p.speaker_name ? ' (from: ' + p.speaker_name + ')' : ''}`).join('\n')}`;
    if (events.length) context += `\n\nCOMPELLING EVENTS:\n${events.map((e: any) => `- ${e.event_description} [${e.strength}]${e.event_date ? ' by ' + e.event_date : ''}`).join('\n')}`;
    if (catalysts.length) context += `\n\nCATALYSTS:\n${catalysts.map((c: any) => `- ${c.catalyst} [${c.category}] Urgency: ${c.urgency}`).join('\n')}`;
    if (risks.length) context += `\n\nRISKS:\n${risks.map((r: any) => `- [${r.severity}] ${r.risk_description} [${r.category}]`).join('\n')}`;
    if (flags.length) context += `\n\nFLAGS:\n${flags.map((f: any) => `- [${f.flag_type}] ${f.description} [${f.category}]`).join('\n')}`;
    if (tasks.length) context += `\n\nOPEN TASKS:\n${tasks.map((t: any) => `- [${t.priority}] ${t.title}`).join('\n')}`;
    if (conversations.length) context += `\n\nCALL HISTORY:\n${conversations.map((c: any) => `- ${c.call_date || '?'} [${c.call_type}]: ${(c.ai_summary || '').substring(0, 200)}`).join('\n')}`;
    if (mspStages.length) context += `\n\nMSP:\n${mspStages.map((s: any) => `- [${s.status}] ${s.stage_name}`).join('\n')}`;
    if (sources.length) {
      const ts = sources.filter((s: any) => s.source_origin === 'transcript').slice(0, 15);
      if (ts.length) context += `\n\nKEY TRANSCRIPT EVIDENCE:\n${ts.map((s: any) => `- [${s.field_category}] ${s.speaker || '?'}: "${(s.quote || '').substring(0, 120)}" (${s.call_type} ${s.call_date || ''})`).join('\n')}`;
    }
    context += specificTranscript;

    let subject = template.subject_template || '';
    subject = subject.replace('{{company_name}}', deal.company_name || '').replace('{{deal_value}}', String(deal.deal_value || '')).replace('{{forecast_category}}', deal.forecast_category || '').replace('{{call_type}}', conversations[0]?.call_type || '').replace('{{call_date}}', conversations[0]?.call_date || '');

    const userPrompt = `EMAIL TYPE: ${template.name}\nPURPOSE: ${template.description || ''}\nRECIPIENT: ${template.default_recipients || 'Not specified'}\nSUBJECT LINE: ${subject}\n\nTEMPLATE INSTRUCTIONS:\n${template.body_template || ''}\n\nAI INSTRUCTIONS:\n${template.ai_instructions || ''}\n\n${context}\n\nREP: ${rep?.full_name || 'Unknown'} | ${rep?.title || 'Account Executive'} | ${rep?.email || ''} | ${rep?.initials || ''}\n\nGenerate the email. Return ONLY JSON:\n{"subject": "...", "body": "..."}`;

    // Build final system prompt: assembled coach layer FIRST, then email mode rules
    const systemPromptParts: string[] = [];
    if (assembledCoachPrompt) systemPromptParts.push(assembledCoachPrompt);
    systemPromptParts.push(EMAIL_SYSTEM_PROMPT);
    const finalSystem = systemPromptParts.join('\n\n');

    const claudeRes = await callClaudeWithRetry({ model, max_tokens: 4000, temperature, system: finalSystem, messages: [{ role: 'user', content: userPrompt }] });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return jsonResponse({ error: `v12: Claude API error: ${claudeRes.status}`, details: errText }, 500);
    }

    const claudeData = await claudeRes.json();
    const usage = claudeData.usage || {};
    const rawText = (claudeData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

    let emailSubject = subject, emailBody = rawText;
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (jsonMatch) { const parsed = JSON.parse(jsonMatch[0]); if (parsed.subject) emailSubject = parsed.subject; if (parsed.body) emailBody = parsed.body; }
    } catch {}

    const { data: saved } = await sb.from('generated_emails').insert({ deal_id, email_template_id: template_id, generated_by: deal.rep_id, email_type: template.email_type, subject: emailSubject, body: emailBody, recipients: template.default_recipients, status: 'draft', ai_model_used: model, prompt_tokens: usage.input_tokens || null, completion_tokens: usage.output_tokens || null, conversation_id: conversation_id || null }).select().single();

    try { if (rep?.org_id) { await sb.rpc('deduct_credits', { p_org_id: rep.org_id, p_user_id: deal.rep_id, p_amount: 2, p_type: 'email', p_description: `Email: ${template.name} - ${deal.company_name}`, p_reference_id: saved?.id || null }); } } catch (e) { console.log('Credit deduction failed:', e); }

    return jsonResponse({ success: true, version: 'v12', email_id: saved?.id, subject: emailSubject, body: emailBody, template_name: template.name, recipient_type: template.recipient_type, tokens: { input: usage.input_tokens, output: usage.output_tokens } });

  } catch (err: any) {
    console.error('generate-email v12 error:', err);
    return jsonResponse({ error: `v12: ${err.message}`, success: false }, 500);
  }
});
