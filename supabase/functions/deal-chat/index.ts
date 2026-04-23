import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deal-chat v12
// CHANGES FROM v11:
// - Calls assemble_coach_prompt RPC (p_action='chat') and prepends the 4-layer assembled prompt
//   to the hardcoded CHAT_SYSTEM_PROMPT so coach context / ICP / personas / flags are in scope.
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

const TOOLS = [
  { name: 'create_task', description: 'Create a task/action item for this deal.', input_schema: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, due_days: { type: 'number', description: 'Days from now' }, notes: { type: 'string' } }, required: ['title'] } },
  { name: 'update_deal_field', description: 'Update a field on deals, deal_analysis, or company_profile.', input_schema: { type: 'object', properties: { table: { type: 'string', enum: ['deals', 'deal_analysis', 'company_profile'] }, field: { type: 'string' }, value: { type: 'string' } }, required: ['table', 'field', 'value'] } },
  { name: 'add_contact', description: 'Add a new contact to this deal.', input_schema: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, email: { type: 'string' }, role_in_deal: { type: 'string' }, is_champion: { type: 'boolean' }, is_economic_buyer: { type: 'boolean' } }, required: ['name'] } },
  { name: 'add_risk', description: 'Add a risk to this deal.', input_schema: { type: 'object', properties: { risk_description: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['risk_description'] } },
];

const CHAT_SYSTEM_PROMPT = `You are a deal intelligence assistant for an enterprise B2B sales team. You have access to EVERYTHING in the deal database. Your job is to give clear, direct, sourced answers to any question about this deal.

HOW YOU OPERATE:
- When asked a question, answer it directly from the deal data provided. Be specific — use names, numbers, dates, exact quotes.
- When you cite information, tell the user WHERE it came from: which call, which research source, which contact said it.
- If deal_sources data is available, reference the specific source (URL, speaker quote, call date).
- If the data doesn't contain the answer, say so clearly: "We don't have that information yet. Here's what you could ask on the next call to find out."
- Be concise. Don't pad responses with methodology lectures unless the user asks for coaching advice.
- Use bullet points for lists. Bold key terms.
- When asked for coaching guidance, draw from the methodology layers provided in your system prompt.
- When asked to create tasks, update fields, add contacts, or log risks — use the tools provided.

QUERY PATTERNS YOU HANDLE:
- "What do we know about their budget?" → Pull from deal_analysis.budget, any transcript sources where budget was discussed, research sources
- "Who is the economic buyer?" → Pull from deal_analysis.economic_buyer, contacts with is_economic_buyer=true, source quotes
- "What are the top risks?" → Pull from deal_risks, red flags, BANT gaps
- "Summarize the last call" → Pull from most recent conversation ai_summary
- "What's our competitive position?" → Pull from competitors, company_profile.competitive_landscape, competitive mentions in transcripts
- "What should I ask on the next call?" → Identify BANT gaps, missing methodology elements, unvalidated compelling events
- "What's the compelling event?" → Pull from compelling_events table, distinguish from catalysts
- "Write my next steps update" → Generate in the proper format: (Initials) MM/DD — RED/GREEN (reasoning), next call + type, last call + type, RISK:
- "What's changed since the last call?" → Compare current deal state with previous call summaries
- "Where did we learn about [X]?" → Query deal_sources for the field_category, return the source URL or speaker quote`;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'v12: ANTHROPIC_API_KEY not configured' }, 500);
    const { deal_id, session_id, message, user_id } = await req.json();
    if (!deal_id || !message) return jsonResponse({ error: 'v12: deal_id and message required' }, 400);

    let activeSessionId = session_id;
    if (!activeSessionId) {
      const { data: newSession } = await sb.from('deal_chat_sessions').insert({ deal_id, user_id, title: message.substring(0, 60) }).select('id').single();
      activeSessionId = newSession?.id;
    }

    await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id, role: 'user', content: message });

    const { data: history } = await sb.from('deal_chat_messages').select('role, content').eq('session_id', activeSessionId).order('created_at').limit(20);

    // Load ALL deal data
    const [dealRes, analysisRes, companyRes, contactsRes, competitorsRes, tasksRes, convsRes, painsRes, risksRes, eventsRes, catalystsRes, mspRes, flagsRes, sizingRes, sourcesRes, scoresRes, systemsRes] = await Promise.all([
      sb.from('deals').select('*').eq('id', deal_id).single(),
      sb.from('deal_analysis').select('*').eq('deal_id', deal_id).single(),
      sb.from('company_profile').select('*').eq('deal_id', deal_id).single(),
      sb.from('contacts').select('*').eq('deal_id', deal_id),
      sb.from('deal_competitors').select('*').eq('deal_id', deal_id),
      sb.from('tasks').select('*').eq('deal_id', deal_id).order('completed', { ascending: true }),
      sb.from('conversations').select('id, title, call_type, call_date, ai_summary, ai_coaching_notes').eq('deal_id', deal_id).order('call_date', { ascending: false }).limit(15),
      sb.from('deal_pain_points').select('*').eq('deal_id', deal_id),
      sb.from('deal_risks').select('*').eq('deal_id', deal_id).eq('status', 'open'),
      sb.from('compelling_events').select('*').eq('deal_id', deal_id),
      sb.from('business_catalysts').select('*').eq('deal_id', deal_id),
      sb.from('msp_stages').select('*').eq('deal_id', deal_id).order('stage_order'),
      sb.from('deal_flags').select('*').eq('deal_id', deal_id),
      sb.from('deal_sizing').select('*').eq('deal_id', deal_id).single(),
      sb.from('deal_sources').select('*').eq('deal_id', deal_id).order('created_at', { ascending: false }).limit(50),
      sb.from('deal_scores').select('*').eq('deal_id', deal_id).order('scored_at', { ascending: false }),
      sb.from('company_systems').select('*').eq('deal_id', deal_id),
    ]);

    const deal = dealRes.data;
    if (!deal) return jsonResponse({ error: 'v12: Deal not found' }, 404);
    const analysis = analysisRes.data;
    const company = companyRes.data;
    const contacts = contactsRes.data || [];
    const competitors = competitorsRes.data || [];
    const tasks = tasksRes.data || [];
    const convs = convsRes.data || [];
    const pains = painsRes.data || [];
    const risks = risksRes.data || [];
    const events = eventsRes.data || [];
    const catalysts = catalystsRes.data || [];
    const mspStages = mspRes.data || [];
    const flags = flagsRes.data || [];
    const sizing = sizingRes.data;
    const sources = sourcesRes.data || [];
    const systems = systemsRes.data || [];

    const { data: rep } = await sb.from('profiles').select('active_coach_id, full_name, initials').eq('id', deal.rep_id).single();
    let model = 'claude-sonnet-4-20250514';
    const cid = rep?.active_coach_id || null;
    if (cid) {
      const { data: coach } = await sb.from('coaches').select('model').eq('id', cid).single();
      if (coach?.model) model = coach.model;
    }

    // ── Assemble coach-layer prompt (platform core + methodology + coach + ICP) ──
    let assembledCoachPrompt = '';
    if (cid) {
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', {
          p_coach_id: cid,
          p_call_type: null,
          p_action: 'chat',
        });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          assembledCoachPrompt = assembled;
          await recordAssembledPrompt(sb, cid, null, 'chat', assembled);
        }
      } catch (e) { console.log('assemble_coach_prompt error (chat, non-fatal):', e); }
    }

    const redFlags = flags.filter((f: any) => f.flag_type === 'red');
    const greenFlags = flags.filter((f: any) => f.flag_type === 'green');
    const researchSources = sources.filter((s: any) => s.source_origin === 'research');
    const transcriptSources = sources.filter((s: any) => s.source_origin === 'transcript');

    const dealContext = `DEAL DATA FOR: ${deal.company_name}\n` +
      `════════════════════════════════\n` +
      `DEAL CORE:\n` +
      `Stage: ${deal.stage} | Forecast: ${deal.forecast_category} | Value: $${deal.deal_value || 0} | CMRR: $${deal.cmrr || 0}\n` +
      `Close Date: ${deal.target_close_date || 'TBD'} | Fit: ${deal.fit_score || '?'}/10 | Health: ${deal.deal_health_score || '?'}/10 | ICP: ${deal.icp_fit_score || '?'}/100\n` +
      `Next Steps: ${deal.next_steps || 'None'}\n` +
      `Rep: ${rep?.full_name || 'Unknown'} (${rep?.initials || '??'})\n\n` +

      `COMPANY PROFILE:\n` +
      `Overview: ${clean(company?.overview)}\n` +
      `Industry: ${clean(company?.industry)} | Revenue: ${clean(company?.revenue)} | Employees: ${clean(company?.employee_count)}\n` +
      `HQ: ${clean(company?.headquarters)} | Founded: ${clean(company?.founded)}\n` +
      `Revenue Streams: ${clean(company?.revenue_streams)}\n` +
      `Tech Stack: ${clean(company?.tech_stack)}\n` +
      `Business Goals: ${clean(company?.business_goals)}\n` +
      `Business Priorities: ${clean(company?.business_priorities)}\n` +
      `Growth Plans: ${clean(company?.growth_plans)}\n` +
      `Leadership: ${clean(company?.leadership)}\n` +
      `PE/VC/Investors: ${clean(company?.pe_vc_investors)}\n` +
      `Competitive Landscape: ${clean(company?.competitive_landscape)}\n` +
      `Events Attended: ${clean(company?.events_attended)}\n` +
      `Hiring Signals: ${clean(company?.hiring_signals)}\n` +
      `International: ${clean(company?.international_operations)}\n` +
      `Other Initiatives: ${clean(company?.other_initiatives)}\n\n` +

      `CURRENT SYSTEMS (${systems.length}):\n${systems.map((s: any) => `- ${s.system_name} [${s.system_category}]${s.confirmed ? ' CONFIRMED' : ''} (${s.confidence})`).join('\n') || 'None'}\n\n` +

      `SIZING: ${sizing ? `Users: ${sizing.full_users || '?'} | View-Only: ${sizing.view_only_users || '?'} | Entities: ${sizing.entity_count || '?'} | AP/mo: ${sizing.ap_invoices_monthly || '?'} | AR/mo: ${sizing.ar_invoices_monthly || '?'} | Assets: ${sizing.fixed_assets || '?'} | Payroll: ${sizing.employee_count_payroll || '?'}` : 'Not captured yet'}\n\n` +

      `DEAL ANALYSIS:\n` +
      `Pain Points: ${clean(analysis?.pain_points)}\n` +
      `Quantified Pain: ${clean(analysis?.quantified_pain)}\n` +
      `Business Impact: ${clean(analysis?.business_impact)}\n` +
      `Budget: ${clean(analysis?.budget)} | Allocated: ${analysis?.budget_allocated ? 'Yes' : 'Unknown'} | Current Spend: ${clean(analysis?.current_spend)}\n` +
      `Champion: ${clean(analysis?.champion)}\n` +
      `Economic Buyer: ${clean(analysis?.economic_buyer)}\n` +
      `Decision Criteria: ${clean(analysis?.decision_criteria)}\n` +
      `Decision Process: ${clean(analysis?.decision_process)}\n` +
      `Decision Method: ${clean(analysis?.decision_method)}\n` +
      `Timeline Drivers: ${clean(analysis?.timeline_drivers)}\n` +
      `Decision Date: ${analysis?.decision_date || 'Unknown'} | Signature: ${analysis?.signature_date || 'Unknown'} | Kickoff: ${analysis?.kickoff_date || 'Unknown'} | Go-Live: ${analysis?.go_live_date || 'Unknown'}\n` +
      `Driving Factors: ${clean(analysis?.driving_factors)}\n` +
      `Integrations: ${clean(analysis?.integrations_needed)} | Impact: ${clean(analysis?.integration_impact)}\n` +
      `Exec Alignment: ${clean(analysis?.exec_alignment)}\n` +
      `Ideal Solution: ${clean(analysis?.ideal_solution)}\n` +
      `Has RFP: ${analysis?.has_rfp ? 'Yes' : 'No'} | Consultant: ${analysis?.has_consultant ? `Yes - ${analysis?.consultant_name || '?'}` : 'No'}\n\n` +

      `CONTACTS (${contacts.length}):\n${contacts.map((c: any) => `- ${c.name} | ${c.title || '?'} | ${c.role_in_deal || '?'} | Influence: ${c.influence_level || '?'}${c.is_champion ? ' [CHAMPION]' : ''}${c.is_economic_buyer ? ' [EB]' : ''}${c.is_signer ? ' [SIGNER]' : ''}\n  Priorities: ${c.priorities || '?'} | Pain Points: ${c.pain_points || '?'}`).join('\n') || 'None'}\n\n` +

      `COMPETITORS (${competitors.length}):\n${competitors.map((c: any) => `- ${c.competitor_name}${c.competitor_type ? ' [' + c.competitor_type + ']' : ''}: Strengths: ${c.strengths || '?'} | Weaknesses: ${c.weaknesses || '?'} | Where: ${c.where_in_process || '?'} | Pricing: ${c.received_pricing ? 'Yes' : '?'} | Strategy: ${c.strategy || '?'}`).join('\n') || 'None'}\n\n` +

      `PAIN POINTS (${pains.length}):\n${pains.map((p: any) => `- ${p.pain_description}${p.annual_cost ? ' ($' + p.annual_cost + '/yr)' : ''}${p.annual_hours ? ' (' + p.annual_hours + ' hrs/yr)' : ''} [${p.category}] ${p.verified ? 'VERIFIED' : ''} ${p.speaker_name ? '(said by: ' + p.speaker_name + ')' : ''}`).join('\n') || 'None'}\n\n` +

      `COMPELLING EVENTS (${events.length}):\n${events.map((e: any) => `- ${e.event_description} [${e.strength}]${e.event_date ? ' by ' + e.event_date : ''} ${e.verified ? 'VERIFIED' : ''}`).join('\n') || 'None'}\n\n` +

      `CATALYSTS (${catalysts.length}):\n${catalysts.map((c: any) => `- ${c.catalyst} [${c.category}] Urgency: ${c.urgency}`).join('\n') || 'None'}\n\n` +

      `RISKS (${risks.length} open):\n${risks.map((r: any) => `- [${r.severity}] ${r.risk_description} [${r.category}]`).join('\n') || 'None'}\n\n` +

      `RED FLAGS (${redFlags.length}):\n${redFlags.map((f: any) => `- [${f.severity || '?'}] ${f.description} [${f.category}]`).join('\n') || 'None'}\n\n` +

      `GREEN FLAGS (${greenFlags.length}):\n${greenFlags.map((f: any) => `- ${f.description} [${f.category}]`).join('\n') || 'None'}\n\n` +

      `TASKS (${tasks.length}):\n${tasks.map((t: any) => `- [${t.completed ? 'DONE' : t.priority}] ${t.title}${t.due_date ? ' (due ' + t.due_date.substring(0, 10) + ')' : ''}${t.is_blocking ? ' BLOCKING' : ''}`).join('\n') || 'None'}\n\n` +

      `CALL HISTORY (${convs.length}):\n${convs.map((c: any) => `- ${c.call_date || '?'} [${c.call_type}] "${c.title || 'Untitled'}": ${(c.ai_summary || 'No summary').substring(0, 200)}`).join('\n') || 'None'}\n\n` +

      `MSP (${mspStages.length} steps):\n${mspStages.map((s: any) => `- Step ${s.stage_order}: [${s.status}] ${s.stage_name}${s.target_date ? ' (target: ' + s.target_date + ')' : ''}`).join('\n') || 'None'}\n\n` +

      `EVIDENCE / SOURCES (${sources.length} total — ${researchSources.length} research, ${transcriptSources.length} transcript):\n` +
      `Research Sources:\n${researchSources.slice(0, 25).map((s: any) => `- [${s.field_category}] ${s.summary || ''}${s.source_url ? ' → ' + s.source_url : ''}`).join('\n') || 'None'}\n` +
      `Transcript Sources:\n${transcriptSources.slice(0, 25).map((s: any) => `- [${s.field_category}] ${s.speaker || '?'}: "${(s.quote || '').substring(0, 120)}" (${s.call_type} ${s.call_date || ''})`).join('\n') || 'None'}`;

    // Build final system prompt: assembled coach layer FIRST, then chat mode rules, then deal context
    const systemPromptParts: string[] = [];
    if (assembledCoachPrompt) systemPromptParts.push(assembledCoachPrompt);
    systemPromptParts.push(CHAT_SYSTEM_PROMPT);
    systemPromptParts.push(dealContext);
    const finalSystem = systemPromptParts.join('\n\n');

    const messages = (history || []).map((m: any) => ({ role: m.role, content: m.content }));

    const claudeRes = await callClaudeWithRetry({ model, max_tokens: 4000, temperature: 0.3, system: finalSystem, tools: TOOLS, messages });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return jsonResponse({ error: `v12: Claude API error: ${claudeRes.status}`, details: errText }, 500);
    }

    const claudeData = await claudeRes.json();
    const usage = claudeData.usage || {};
    const actionsTaken: any[] = [];
    let responseText = '';

    for (const block of (claudeData.content || [])) {
      if (block.type === 'text') responseText += block.text;
      else if (block.type === 'tool_use') {
        const toolResult = await executeTool(sb, deal_id, rep?.full_name || '', block.name, block.input);
        actionsTaken.push({ type: block.name, input: block.input, result: toolResult });
      }
    }

    if (actionsTaken.length > 0 && claudeData.stop_reason === 'tool_use') {
      const toolResultMessages = [...messages];
      toolResultMessages.push({ role: 'assistant', content: claudeData.content });
      const toolResults: any[] = [];
      for (const block of claudeData.content) {
        if (block.type === 'tool_use') {
          const action = actionsTaken.find((a: any) => a.input === block.input);
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(action?.result || { success: true }) });
        }
      }
      toolResultMessages.push({ role: 'user', content: toolResults });
      const followUp = await callClaudeWithRetry({ model, max_tokens: 2000, temperature: 0.3, system: finalSystem, tools: TOOLS, messages: toolResultMessages });
      if (followUp.ok) {
        const followUpData = await followUp.json();
        const followUpText = (followUpData.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        if (followUpText) responseText = followUpText;
        const fu = followUpData.usage || {};
        usage.input_tokens = (usage.input_tokens || 0) + (fu.input_tokens || 0);
        usage.output_tokens = (usage.output_tokens || 0) + (fu.output_tokens || 0);
      }
    }

    if (!responseText && actionsTaken.length > 0) {
      responseText = 'Done! ' + actionsTaken.map((a: any) => {
        if (a.type === 'create_task') return `Created task: "${a.input.title}"`;
        if (a.type === 'update_deal_field') return `Updated ${a.input.field}`;
        if (a.type === 'add_contact') return `Added contact: ${a.input.name}`;
        if (a.type === 'add_risk') return `Added risk: "${a.input.risk_description}"`;
        return `Action: ${a.type}`;
      }).join('. ');
    }

    await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id, role: 'assistant', content: responseText, actions_taken: actionsTaken.length > 0 ? actionsTaken : [], ai_model_used: model, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens });

    // Credits
    try {
      const { data: repData } = await sb.from('profiles').select('org_id').eq('id', deal.rep_id).single();
      if (repData?.org_id) { await sb.rpc('deduct_credits', { p_org_id: repData.org_id, p_user_id: deal.rep_id, p_amount: 1, p_type: 'chat', p_description: `Chat: ${deal.company_name}`, p_reference_id: null }); }
    } catch (e) { console.log('Credit deduction failed:', e); }

    return jsonResponse({ success: true, version: 'v12', session_id: activeSessionId, message: responseText, actions_taken: actionsTaken, tokens: { input: usage.input_tokens, output: usage.output_tokens } });

  } catch (err: any) {
    console.error('deal-chat v12 error:', err);
    return jsonResponse({ error: `v12: ${err.message}`, success: false }, 500);
  }
});

async function executeTool(sb: any, dealId: string, repName: string, toolName: string, input: any) {
  try {
    switch (toolName) {
      case 'create_task': {
        const dueDate = input.due_days ? new Date(Date.now() + input.due_days * 86400000).toISOString() : null;
        const { data, error } = await sb.from('tasks').insert({ deal_id: dealId, title: input.title, priority: input.priority || 'medium', due_date: dueDate, notes: input.notes || null, auto_generated: true, completed: false, owner: repName }).select('id, title').single();
        if (error) return { success: false, error: error.message };
        return { success: true, task_id: data.id, title: data.title };
      }
      case 'update_deal_field': {
        const { table, field, value } = input;
        if (!['deals', 'deal_analysis', 'company_profile'].includes(table)) return { success: false, error: 'Invalid table' };
        const idField = table === 'deals' ? 'id' : 'deal_id';
        const { error } = await sb.from(table).update({ [field]: value }).eq(idField, dealId);
        if (error) return { success: false, error: error.message };
        return { success: true, table, field, value };
      }
      case 'add_contact': {
        const { data, error } = await sb.from('contacts').insert({ deal_id: dealId, name: input.name, title: input.title || null, email: input.email || null, role_in_deal: input.role_in_deal || 'Unknown', is_champion: input.is_champion || false, is_economic_buyer: input.is_economic_buyer || false }).select('id, name').single();
        if (error) return { success: false, error: error.message };
        return { success: true, contact_id: data.id, name: data.name };
      }
      case 'add_risk': {
        const { data, error } = await sb.from('deal_risks').insert({ deal_id: dealId, risk_description: input.risk_description, category: input.category || 'deal', severity: input.severity || 'medium', source: 'chat', status: 'open' }).select('id').single();
        if (error) return { success: false, error: error.message };
        return { success: true, risk_id: data.id };
      }
      default: return { success: false, error: 'Unknown tool' };
    }
  } catch (err: any) { return { success: false, error: err.message }; }
}
