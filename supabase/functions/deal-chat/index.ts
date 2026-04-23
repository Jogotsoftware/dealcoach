import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deal-chat v13
// CHANGES FROM v12:
// - Accepts optional context_type: 'deal' (default) | 'pipeline' | 'coaching' | 'help' | 'general'
// - 'pipeline': no deal_id required. Loads rep's active deals as pipeline context.
// - 'coaching': no deal/rep data. Pure methodology coaching with assembled prompt.
// - 'help': help-mode system prompt, answers product-navigation questions.
// - 'general': general sales discussion with methodology context only.
// - Persists context_type on deal_chat_sessions for history filtering.
// CHANGES FROM v11:
// - Calls assemble_coach_prompt RPC (p_action='chat') and prepends the 4-layer assembled prompt.
// - Upserts assembled_prompt_versions.

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

const DEAL_SYSTEM_PROMPT = `You are a deal intelligence assistant for an enterprise B2B sales team. You have access to EVERYTHING in the deal database. Your job is to give clear, direct, sourced answers to any question about this deal.

HOW YOU OPERATE:
- Answer directly from the deal data provided. Be specific — use names, numbers, dates, exact quotes.
- When you cite information, tell the user WHERE it came from: which call, which research source, which contact said it.
- If data doesn't contain the answer, say so clearly and suggest what to ask on the next call.
- Be concise. Bullet points for lists. Bold key terms.
- Draw from the methodology layers provided in your system prompt for coaching guidance.
- When asked to create tasks, update fields, add contacts, or log risks — use the tools provided.`;

const PIPELINE_SYSTEM_PROMPT = `You are a pipeline intelligence assistant. The user is a rep asking strategic questions about their full pipeline.

HOW YOU OPERATE:
- Answer based on the pipeline summary provided. Reference specific deals by name and stage.
- Identify patterns: which deals need attention, which are at risk, which are hottest.
- Be specific — reference deal values, close dates, next steps, scores.
- Coach on pipeline prioritization using the methodology in your system prompt.
- Short responses. Bullet points when listing deals.`;

const COACHING_SYSTEM_PROMPT = `You are a sales coach. The user is asking for methodology guidance with no specific deal in context.

HOW YOU OPERATE:
- Answer based on the methodology layers in your system prompt.
- When giving advice, be Socratic — lead the rep to the insight rather than lecturing.
- Use examples from the framework (Revenue Instruments pillars, BANT/MEDDPICC if selected).
- Short, direct, opinionated responses. The rep wants clarity, not a lecture.`;

const HELP_SYSTEM_PROMPT = `You are a product help assistant for Revenue Instruments / DealCoach.

HOW YOU OPERATE:
- Answer questions about how to use the product. You know:
  - Pipeline (/): kanban + table view, forecast summary, widgets, task list, scoreboard
  - Deal Detail (/deal/:id): 6 tabs — Overview, Contacts, Transcripts, MSP, Proposal, Tasks
  - Coach (/coach): admin for prompts, docs, scoring, ICP, email templates
  - Coach Builder (/coach/builder): 11-step wizard for coach configuration
  - Reports (/reports): prebuilt + custom reports
  - Settings (/settings): profile, quota, coach selection
- If asked about something not in the product, say "I don't think we have that yet — you can send feedback via the chatbot's Feedback topic"
- Be concise. 1-3 sentence answers when possible.`;

const GENERAL_SYSTEM_PROMPT = `You are a sales coaching assistant. The user is asking a general sales question.

HOW YOU OPERATE:
- Answer based on the methodology and coaching framework in your system prompt.
- Stay grounded in public-source methodology (BANT, MEDDPICC, SPIN, Challenger, Solution Selling, Sandler, JOLT, Command of the Message).
- Direct, concise, opinionated. Reference frameworks by name.`;

function systemPromptFor(contextType: string): string {
  switch (contextType) {
    case 'pipeline': return PIPELINE_SYSTEM_PROMPT;
    case 'coaching': return COACHING_SYSTEM_PROMPT;
    case 'help': return HELP_SYSTEM_PROMPT;
    case 'general': return GENERAL_SYSTEM_PROMPT;
    case 'deal':
    default: return DEAL_SYSTEM_PROMPT;
  }
}

async function buildDealContext(sb: any, deal_id: string): Promise<{ context: string; deal: any; rep: any; cid: string | null; model: string }> {
  const [dealRes, analysisRes, companyRes, contactsRes, competitorsRes, tasksRes, convsRes, painsRes, risksRes, eventsRes, catalystsRes, mspRes, flagsRes, sizingRes, sourcesRes, systemsRes] = await Promise.all([
    sb.from('deals').select('*').eq('id', deal_id).single(),
    sb.from('deal_analysis').select('*').eq('deal_id', deal_id).single(),
    sb.from('company_profile').select('*').eq('deal_id', deal_id).single(),
    sb.from('contacts').select('*').eq('deal_id', deal_id),
    sb.from('deal_competitors').select('*').eq('deal_id', deal_id),
    sb.from('tasks').select('*').eq('deal_id', deal_id).order('completed', { ascending: true }),
    sb.from('conversations').select('id, title, call_type, call_date, ai_summary').eq('deal_id', deal_id).order('call_date', { ascending: false }).limit(15),
    sb.from('deal_pain_points').select('*').eq('deal_id', deal_id),
    sb.from('deal_risks').select('*').eq('deal_id', deal_id).eq('status', 'open'),
    sb.from('compelling_events').select('*').eq('deal_id', deal_id),
    sb.from('business_catalysts').select('*').eq('deal_id', deal_id),
    sb.from('msp_stages').select('*').eq('deal_id', deal_id).order('stage_order'),
    sb.from('deal_flags').select('*').eq('deal_id', deal_id),
    sb.from('deal_sizing').select('*').eq('deal_id', deal_id).single(),
    sb.from('deal_sources').select('*').eq('deal_id', deal_id).order('created_at', { ascending: false }).limit(50),
    sb.from('company_systems').select('*').eq('deal_id', deal_id),
  ]);

  const deal = dealRes.data;
  if (!deal) return { context: '', deal: null, rep: null, cid: null, model: 'claude-sonnet-4-20250514' };
  const analysis = analysisRes.data, company = companyRes.data;
  const contacts = contactsRes.data || [], competitors = competitorsRes.data || [], tasks = tasksRes.data || [];
  const convs = convsRes.data || [], pains = painsRes.data || [], risks = risksRes.data || [];
  const events = eventsRes.data || [], catalysts = catalystsRes.data || [], mspStages = mspRes.data || [];
  const flags = flagsRes.data || [], sizing = sizingRes.data, sources = sourcesRes.data || [], systems = systemsRes.data || [];

  const { data: rep } = await sb.from('profiles').select('active_coach_id, full_name, initials').eq('id', deal.rep_id).single();
  let model = 'claude-sonnet-4-20250514';
  const cid = rep?.active_coach_id || null;
  if (cid) {
    const { data: coach } = await sb.from('coaches').select('model').eq('id', cid).single();
    if (coach?.model) model = coach.model;
  }

  const redFlags = flags.filter((f: any) => f.flag_type === 'red');
  const greenFlags = flags.filter((f: any) => f.flag_type === 'green');
  const transcriptSources = sources.filter((s: any) => s.source_origin === 'transcript');
  const researchSources = sources.filter((s: any) => s.source_origin === 'research');

  const context = `DEAL: ${deal.company_name}\n` +
    `Stage: ${deal.stage} | Forecast: ${deal.forecast_category} | Value: $${deal.deal_value || 0} | CMRR: $${deal.cmrr || 0}\n` +
    `Close: ${deal.target_close_date || 'TBD'} | Fit: ${deal.fit_score || '?'}/10 | Health: ${deal.deal_health_score || '?'}/10 | ICP: ${deal.icp_fit_score || '?'}/100\n` +
    `Next Steps: ${deal.next_steps || 'None'}\n\n` +
    `COMPANY:\n${clean(company?.overview)}\nIndustry: ${clean(company?.industry)} | Revenue: ${clean(company?.revenue)} | Employees: ${clean(company?.employee_count)}\n` +
    `Tech Stack: ${clean(company?.tech_stack)}\nBusiness Goals: ${clean(company?.business_goals)}\nBusiness Priorities: ${clean(company?.business_priorities)}\nCompetitive Landscape: ${clean(company?.competitive_landscape)}\n\n` +
    `CURRENT SYSTEMS (${systems.length}):\n${systems.map((s: any) => `- ${s.system_name} [${s.system_category}]${s.confirmed ? ' CONFIRMED' : ''}`).join('\n') || 'None'}\n\n` +
    `SIZING: ${sizing ? `Users: ${sizing.full_users || '?'} | Entities: ${sizing.entity_count || '?'}` : 'Not captured'}\n\n` +
    `ANALYSIS:\nPains: ${clean(analysis?.pain_points)}\nQuantified: ${clean(analysis?.quantified_pain)}\nBudget: ${clean(analysis?.budget)}\nChampion: ${clean(analysis?.champion)} | EB: ${clean(analysis?.economic_buyer)}\nDecision Criteria: ${clean(analysis?.decision_criteria)}\nProcess: ${clean(analysis?.decision_process)}\nTimeline: ${clean(analysis?.timeline_drivers)}\n\n` +
    `CONTACTS (${contacts.length}):\n${contacts.map((c: any) => `- ${c.name} | ${c.title || '?'} | ${c.role_in_deal || '?'}${c.is_champion ? ' [CHAMP]' : ''}${c.is_economic_buyer ? ' [EB]' : ''}`).join('\n') || 'None'}\n\n` +
    `COMPETITORS (${competitors.length}):\n${competitors.map((c: any) => `- ${c.competitor_name}: ${clean(c.strengths)} / ${clean(c.weaknesses)}`).join('\n') || 'None'}\n\n` +
    `PAIN POINTS (${pains.length}):\n${pains.map((p: any) => `- ${p.pain_description}${p.annual_cost ? ' ($' + p.annual_cost + '/yr)' : ''} [${p.category}]`).join('\n') || 'None'}\n\n` +
    `COMPELLING EVENTS (${events.length}):\n${events.map((e: any) => `- ${e.event_description} [${e.strength}]${e.event_date ? ' by ' + e.event_date : ''}`).join('\n') || 'None'}\n\n` +
    `CATALYSTS (${catalysts.length}):\n${catalysts.map((c: any) => `- ${c.catalyst} [${c.category}]`).join('\n') || 'None'}\n\n` +
    `RISKS (${risks.length}):\n${risks.map((r: any) => `- [${r.severity}] ${r.risk_description}`).join('\n') || 'None'}\n\n` +
    `RED FLAGS:\n${redFlags.map((f: any) => `- ${f.description}`).join('\n') || 'None'}\n\n` +
    `GREEN FLAGS:\n${greenFlags.map((f: any) => `- ${f.description}`).join('\n') || 'None'}\n\n` +
    `TASKS (${tasks.length}):\n${tasks.map((t: any) => `- [${t.completed ? 'DONE' : t.priority}] ${t.title}`).join('\n') || 'None'}\n\n` +
    `CALL HISTORY (${convs.length}):\n${convs.map((c: any) => `- ${c.call_date || '?'} [${c.call_type}]: ${(c.ai_summary || '').substring(0, 200)}`).join('\n') || 'None'}\n\n` +
    `MSP (${mspStages.length} steps):\n${mspStages.map((s: any) => `- [${s.status}] ${s.stage_name}`).join('\n') || 'None'}\n\n` +
    `EVIDENCE (${sources.length}): ${researchSources.length} research, ${transcriptSources.length} transcript\n` +
    `Transcripts:\n${transcriptSources.slice(0, 15).map((s: any) => `- [${s.field_category}] ${s.speaker || '?'}: "${(s.quote || '').substring(0, 100)}"`).join('\n') || 'None'}`;

  return { context, deal, rep, cid, model };
}

async function buildPipelineContext(sb: any, user_id: string): Promise<{ context: string; orgId: string | null; cid: string | null; model: string }> {
  const { data: profile } = await sb.from('profiles').select('active_coach_id, org_id, full_name, initials').eq('id', user_id).single();
  const cid = profile?.active_coach_id || null;
  const orgId = profile?.org_id || null;
  let model = 'claude-sonnet-4-20250514';
  if (cid) {
    const { data: coach } = await sb.from('coaches').select('model').eq('id', cid).single();
    if (coach?.model) model = coach.model;
  }

  const { data: deals } = await sb.from('deals').select('id, company_name, stage, forecast_category, deal_value, cmrr, target_close_date, next_steps, fit_score, deal_health_score').eq('rep_id', user_id).not('stage', 'in', '(closed_won,closed_lost,disqualified)').order('target_close_date', { ascending: true }).limit(50);

  const { data: tasks } = await sb.from('tasks').select('title, priority, due_date, deals(company_name)').eq('completed', false).order('due_date', { ascending: true }).limit(30);

  const dealLines = (deals || []).map((d: any) => `- ${d.company_name} | ${d.stage} | ${d.forecast_category} | $${d.deal_value || 0} | Close: ${d.target_close_date || 'TBD'} | Fit: ${d.fit_score || '?'}/10 | Health: ${d.deal_health_score || '?'}/10\n    Next: ${d.next_steps || 'None'}`);
  const taskLines = (tasks || []).map((t: any) => `- [${t.priority}] ${t.title}${t.deals?.company_name ? ' (' + t.deals.company_name + ')' : ''}${t.due_date ? ' due ' + t.due_date.substring(0, 10) : ''}`);

  const context = `REP: ${profile?.full_name || 'Unknown'} (${profile?.initials || '??'})\n\n` +
    `ACTIVE DEALS (${(deals || []).length}):\n${dealLines.join('\n') || 'None'}\n\n` +
    `OPEN TASKS (${(tasks || []).length}):\n${taskLines.join('\n') || 'None'}`;

  return { context, orgId, cid, model };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'v13: ANTHROPIC_API_KEY not configured' }, 500);
    const { deal_id, session_id, message, user_id, context_type } = await req.json();
    const ctxType = context_type || (deal_id ? 'deal' : 'general');
    if (!message) return jsonResponse({ error: 'v13: message required' }, 400);
    if (ctxType === 'deal' && !deal_id) return jsonResponse({ error: 'v13: deal_id required for context_type=deal' }, 400);
    if ((ctxType === 'pipeline' || ctxType === 'coaching' || ctxType === 'help' || ctxType === 'general') && !user_id) return jsonResponse({ error: 'v13: user_id required for this context_type' }, 400);

    // Resolve or create session
    let activeSessionId = session_id;
    if (!activeSessionId) {
      const { data: newSession } = await sb.from('deal_chat_sessions').insert({
        deal_id: ctxType === 'deal' ? deal_id : null,
        user_id, title: message.substring(0, 60),
        context_type: ctxType,
      }).select('id').single();
      activeSessionId = newSession?.id;
    }

    await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id: ctxType === 'deal' ? deal_id : null, role: 'user', content: message });

    const { data: history } = await sb.from('deal_chat_messages').select('role, content').eq('session_id', activeSessionId).order('created_at').limit(20);

    let dealContext = '', model = 'claude-sonnet-4-20250514', cid: string | null = null, deal: any = null, rep: any = null, orgId: string | null = null;

    if (ctxType === 'deal') {
      const built = await buildDealContext(sb, deal_id);
      if (!built.deal) return jsonResponse({ error: 'v13: Deal not found' }, 404);
      dealContext = built.context; model = built.model; cid = built.cid; deal = built.deal; rep = built.rep;
      const { data: repProfile } = await sb.from('profiles').select('org_id').eq('id', deal.rep_id).single();
      orgId = repProfile?.org_id || null;
    } else if (ctxType === 'pipeline') {
      const built = await buildPipelineContext(sb, user_id);
      dealContext = built.context; model = built.model; cid = built.cid; orgId = built.orgId;
    } else {
      // coaching, help, general — no deal/pipeline context, just coach config
      const { data: profile } = await sb.from('profiles').select('active_coach_id, org_id').eq('id', user_id).single();
      cid = profile?.active_coach_id || null;
      orgId = profile?.org_id || null;
      if (cid) {
        const { data: coach } = await sb.from('coaches').select('model').eq('id', cid).single();
        if (coach?.model) model = coach.model;
      }
    }

    let assembledCoachPrompt = '';
    if (cid) {
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', { p_coach_id: cid, p_call_type: null, p_action: 'chat' });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          assembledCoachPrompt = assembled;
          await recordAssembledPrompt(sb, cid, null, 'chat', assembled);
        }
      } catch (e) { console.log('assemble_coach_prompt error (chat, non-fatal):', e); }
    }

    const systemPromptParts: string[] = [];
    if (assembledCoachPrompt) systemPromptParts.push(assembledCoachPrompt);
    systemPromptParts.push(systemPromptFor(ctxType));
    if (dealContext) systemPromptParts.push(dealContext);
    const finalSystem = systemPromptParts.join('\n\n');

    const messages = (history || []).map((m: any) => ({ role: m.role, content: m.content }));

    // Tools only available in deal context (mutations target the deal)
    const useTools = ctxType === 'deal';

    const claudeRes = await callClaudeWithRetry({
      model, max_tokens: 4000, temperature: 0.3, system: finalSystem,
      ...(useTools ? { tools: TOOLS } : {}),
      messages,
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return jsonResponse({ error: `v13: Claude API error: ${claudeRes.status}`, details: errText }, 500);
    }

    const claudeData = await claudeRes.json();
    const usage = claudeData.usage || {};
    const actionsTaken: any[] = [];
    let responseText = '';

    for (const block of (claudeData.content || [])) {
      if (block.type === 'text') responseText += block.text;
      else if (block.type === 'tool_use' && useTools && deal) {
        const toolResult = await executeTool(sb, deal_id, rep?.full_name || '', block.name, block.input);
        actionsTaken.push({ type: block.name, input: block.input, result: toolResult });
      }
    }

    if (useTools && actionsTaken.length > 0 && claudeData.stop_reason === 'tool_use') {
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

    await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id: ctxType === 'deal' ? deal_id : null, role: 'assistant', content: responseText, actions_taken: actionsTaken.length > 0 ? actionsTaken : [], ai_model_used: model, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens });

    try {
      if (orgId) await sb.rpc('deduct_credits', { p_org_id: orgId, p_user_id: user_id || deal?.rep_id, p_amount: 1, p_type: 'chat', p_description: `Chat (${ctxType}): ${deal?.company_name || ctxType}`, p_reference_id: null });
    } catch (e) { console.log('Credit deduction failed:', e); }

    return jsonResponse({ success: true, version: 'v13', session_id: activeSessionId, context_type: ctxType, message: responseText, actions_taken: actionsTaken, tokens: { input: usage.input_tokens, output: usage.output_tokens } });

  } catch (err: any) {
    console.error('deal-chat v13 error:', err);
    return jsonResponse({ error: `v13: ${err.message}`, success: false }, 500);
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
