import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// onboard-organization v9
// CHANGES FROM v8:
// - Accepts new Phase E onboarding fields: dealSize, salesCycle, primaryBuyer,
//   competitors[], valuePropositions, greenFlags[], redFlags[], objections,
//   personas[], icpGeographies[]
// - coaches insert: now sets value_propositions, competitor_context, general_notes
// - coach_icp insert: now sets personas, green_flags, red_flags, geographies
// - Wizard context sent to Claude now includes the new fields

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function resp(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

async function callClaude(body: any): Promise<any> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (r.ok) return await r.json();
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); continue; }
    throw new Error(`Claude ${r.status}: ${await r.text()}`);
  }
  throw new Error('Claude max retries');
}

async function pxQuery(q: string, key: string): Promise<string> {
  try {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({ model: 'sonar', messages: [{ role: 'user', content: q }], max_tokens: 3000 }),
    });
    if (!r.ok) return '';
    const d = await r.json();
    return d.choices?.[0]?.message?.content || '';
  } catch { return ''; }
}

function slugify(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50); }

function extractJSON(text: string): any {
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const m = clean.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON found in response');
  return JSON.parse(m[0]);
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    const input = await req.json();
    const { user_id } = input;
    if (!user_id) return resp({ error: 'v9: user_id required' }, 400);

    console.log('=== ONBOARD v9 START ===', input.companyName);

    // ─── 1. CREATE ORG ───
    const slug = slugify(input.companyName || 'org');
    const domain = input.website?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '') || null;
    const { data: plans } = await sb.from('plans').select('id').eq('active', true).order('sort_order').limit(1);
    const planId = plans?.[0]?.id || null;
    const { data: org, error: orgErr } = await sb.from('organizations').insert({
      name: input.companyName,
      slug: slug + '-' + Date.now().toString(36),
      domain, plan_id: planId, status: 'trial',
      trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
      owner_id: user_id,
      max_users: input.teamSize === '50+' ? 100 : input.teamSize === '16-50' ? 50 : input.teamSize === '6-15' ? 15 : 5,
      settings: { onboarding: input, created_via: 'onboarding_wizard' },
    }).select('id').single();
    if (orgErr) throw new Error(`v9: Org create failed: ${orgErr.message}`);
    const orgId = org.id;

    // ─── 2. UPDATE PROFILE ───
    await sb.from('profiles').update({ org_id: orgId, role: 'admin' }).eq('id', user_id);

    // ─── 3. INIT CREDITS ───
    await sb.from('org_credits').insert({ org_id: orgId, balance: 500, total_granted: 500, last_grant_at: new Date().toISOString() });
    await sb.from('credit_ledger').insert({ org_id: orgId, user_id, amount: 500, balance_after: 500, transaction_type: 'admin_grant', description: 'Onboarding welcome credits' });

    // ─── 4. PERPLEXITY RESEARCH (optional) ───
    let marketResearch = '';
    if (PERPLEXITY_API_KEY && input.companyName) {
      const queries = [
        `${input.companyName} company overview what they sell products services market position`,
        `${input.productName || input.companyName} competitors market landscape alternatives`,
        `${input.icpIndustries?.join(' ')} ${input.icpCompanySizes?.join(' ')} B2B sales process typical buying journey`,
      ];
      const results = await Promise.all(queries.map(q => pxQuery(q, PERPLEXITY_API_KEY!)));
      marketResearch = results.filter(Boolean).join('\n\n---\n\n');
    }

    const methodNames = (input.methodologies || []).map((id: string) => {
      const map: Record<string, string> = { bant: 'BANT', meddpicc: 'MEDDPICC', challenger: 'Challenger Sale', sandler: 'Sandler', spin: 'SPIN Selling', solution_selling: 'Solution Selling', jolt: 'JOLT Effect', command_message: 'Command of the Message', rif: 'Revenue Instruments Framework' };
      return map[id] || id;
    });

    const coachStyleMap: Record<string, string> = {
      independently_wealthy: 'Expert Advisor — qualify ruthlessly, never chase bad deals, act as a trusted advisor not a hungry rep',
      supportive: 'Supportive Coach — encouraging, developmental, focused on growth and positive reinforcement',
      data_driven: 'Data-Driven Analyst — score everything, quantify pain, measure every deal signal objectively',
      blended: 'Blended — adapts coaching style to the situation',
    };
    const coachStyle = coachStyleMap[input.coachingStyle] || 'Blended';

    const activeStages = (input.stages || []).filter((s: any) => s.active).map((s: any) => s.name);
    const activeCalls = (input.callTypes || []).filter((c: any) => c.active);
    const activeScores = (input.scoreCategories || []).filter((s: any) => s.active);

    // Phase E enrichment data
    const competitorsList: string[] = Array.isArray(input.competitors) ? input.competitors.filter((c: any) => c && String(c).trim()) : [];
    const valueProps: string = input.valuePropositions || '';
    const greenFlagsArr: string[] = Array.isArray(input.greenFlags) ? input.greenFlags : [];
    const redFlagsArr: string[] = Array.isArray(input.redFlags) ? input.redFlags : [];
    const objections: string = input.objections || '';
    const personasArr: any[] = Array.isArray(input.personas) ? input.personas.filter((p: any) => p?.title?.trim()) : [];
    const geosArr: string[] = Array.isArray(input.icpGeographies) ? input.icpGeographies : (input.icpGeos || []);

    const wizardContext = `
COMPANY: ${input.companyName || 'Unknown'}
WEBSITE: ${input.website || 'N/A'}
PRODUCT: ${input.productName || 'Unknown'}
PRODUCT DESCRIPTION: ${input.productDescription || 'N/A'}
DEAL SIZE: ${input.dealSize || 'N/A'}
SALES CYCLE: ${input.salesCycle || 'N/A'}
PRIMARY BUYER: ${input.primaryBuyer || 'N/A'}
VALUE PROPOSITIONS: ${valueProps || 'N/A'}
COMPETITORS: ${competitorsList.join(', ') || 'N/A'}
METHODOLOGIES: ${methodNames.join(', ')}
COACHING PHILOSOPHY: ${coachStyle}
ICP INDUSTRIES: ${input.icpIndustries?.join(', ') || 'N/A'}
ICP COMPANY SIZES: ${input.icpCompanySizes?.join(', ') || 'N/A'}
ICP REVENUE: ${input.icpRevenueRanges?.join(', ') || 'N/A'}
ICP GEOGRAPHIES: ${geosArr.join(', ') || 'N/A'}
GREEN FLAGS: ${greenFlagsArr.join(', ') || 'N/A'}
RED FLAGS: ${redFlagsArr.join(', ') || 'N/A'}
COMMON OBJECTIONS: ${objections || 'N/A'}
BUYER PERSONAS: ${personasArr.map((p: any) => `${p.title} (${p.role_in_decision || 'unknown role'}) pains=${p.pain_points || 'n/a'}`).join('; ') || 'None'}
DEAL STAGES: ${activeStages.join(' → ')}
CALL TYPES: ${activeCalls.map((c: any) => `${c.name}: ${c.desc || ''}`).join('; ')}
SCORING CATEGORIES: ${activeScores.map((s: any) => s.name).join('; ')}
${marketResearch ? `\nMARKET RESEARCH:\n${marketResearch}` : ''}
`;

    // ─── 6. CLAUDE: SYSTEM PROMPT ───
    console.log('Generating coach system prompt...');
    const sysPromptResult = await callClaude({
      model: 'claude-sonnet-4-20250514', max_tokens: 8000, temperature: 0.3,
      system: 'You generate sales coaching AI system prompts. Return ONLY a JSON object with the key "system_prompt" containing the full system prompt text. No markdown, no explanation.',
      messages: [{ role: 'user', content: `Generate a comprehensive AI sales coaching system prompt for the following setup. The prompt should reference methodologies, product value props, competitive positioning, buyer personas, and ICP criteria. 2000-4000 words.\n\n${wizardContext}\n\nReturn JSON: {"system_prompt": "..."}` }],
    });
    const sysPromptText = extractJSON(sysPromptResult.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')).system_prompt;

    // ─── 7. CLAUDE: CALL TYPE PROMPTS ───
    console.log('Generating call type prompts...');
    const callPromptResult = await callClaude({
      model: 'claude-sonnet-4-20250514', max_tokens: 8000, temperature: 0.3,
      system: 'You generate call-type-specific coaching prompts. Return ONLY a JSON object. No markdown, no explanation.',
      messages: [{ role: 'user', content: `Generate coaching prompt for EACH call type. 500-1500 words each. Reference methodologies: ${methodNames.join(', ')}. Context:\n${wizardContext}\n\nCall types:\n${activeCalls.map((c: any) => `- ${c.id}: ${c.name}`).join('\n')}\n\nReturn JSON: {"prompts": {"call_type_id": {"label": "...", "prompt": "...", "extraction_rules": "..."}}}` }],
    });
    const callPrompts = extractJSON(callPromptResult.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')).prompts || {};

    // ─── 8. CLAUDE: SCORING CRITERIA ───
    console.log('Generating scoring criteria...');
    const scoringResult = await callClaude({
      model: 'claude-sonnet-4-20250514', max_tokens: 6000, temperature: 0.2,
      system: 'You generate deal scoring criteria configurations. Return ONLY a JSON object. No markdown.',
      messages: [{ role: 'user', content: `Generate weighted scoring criteria. 5-8 criteria per category summing to 100.\n\nCategories:\n${activeScores.map((s: any) => `${s.id} (${s.name})`).join('\n')}\n\nReturn JSON: {"scoring": {"score_type_id": {"label": "...", "description": "...", "criteria": [{"name": "...", "weight": 20, "description": "..."}]}}}` }],
    });
    const scoringConfigs = extractJSON(scoringResult.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('')).scoring || {};

    // ─── 9. CREATE COACH with new fields ───
    const competitorContext = competitorsList.length ? `Key competitors:\n${competitorsList.map(c => `- ${c}`).join('\n')}` : null;
    const generalNotes = objections ? `Common objections this team encounters:\n${objections}` : null;

    const { data: coach, error: coachErr } = await sb.from('coaches').insert({
      name: `${input.companyName} Sales Coach`,
      description: `AI coaching persona for ${input.companyName} — ${methodNames.join(' + ')} framework with ${coachStyle.split(' — ')[0]} style`,
      system_prompt: sysPromptText,
      research_prompt: `Research this company as a potential customer for ${input.productName || 'our product'}. Focus on: ${greenFlagsArr.join(', ') || 'good-fit signals'}. Watch for: ${redFlagsArr.join(', ') || 'bad-fit signals'}. Evaluate against ICP: ${input.icpIndustries?.join(', ')}, ${input.icpCompanySizes?.join(', ')}, ${input.icpRevenueRanges?.join(', ')}.`,
      model: 'claude-sonnet-4-20250514', temperature: 0.1, active: true,
      created_by: user_id, org_id: orgId,
      product_context: `${input.productName || ''}: ${input.productDescription || ''}`,
      industry_context: `Target: ${input.icpIndustries?.join(', ') || 'various'} companies with ${input.icpCompanySizes?.join(', ') || 'various'} employees`,
      value_propositions: valueProps || null,
      competitor_context: competitorContext,
      general_notes: generalNotes,
    }).select('id').single();
    if (coachErr) throw new Error(`v9: Coach create failed: ${coachErr.message}`);
    const coachId = coach.id;

    // ─── 10. SET ADMIN ACTIVE COACH ───
    await sb.from('profiles').update({ active_coach_id: coachId }).eq('id', user_id);

    // ─── 11. CREATE COACH ICP with new fields ───
    const revRanges = input.icpRevenueRanges || [];
    const empRanges = input.icpCompanySizes || [];
    const empMap: Record<string, [number, number]> = { '1-50': [1, 50], '51-200': [51, 200], '201-1000': [201, 1000], '1000-5000': [1000, 5000], '5000+': [5000, 50000] };
    const revMap: Record<string, [number, number]> = { '< $5M': [0, 5000000], '$5M-$25M': [5000000, 25000000], '$25M-$100M': [25000000, 100000000], '$100M-$500M': [100000000, 500000000], '$500M+': [500000000, 10000000000] };
    let empMin: number | null = null, empMax: number | null = null, revMin: number | null = null, revMax: number | null = null;
    for (const e of empRanges) { const r = empMap[e]; if (r) { if (empMin === null || r[0] < empMin) empMin = r[0]; if (empMax === null || r[1] > empMax) empMax = r[1]; } }
    for (const rv of revRanges) { const r = revMap[rv]; if (r) { if (revMin === null || r[0] < revMin) revMin = r[0]; if (revMax === null || r[1] > revMax) revMax = r[1]; } }

    await sb.from('coach_icp').insert({
      coach_id: coachId,
      name: `${input.companyName} ICP`,
      industries: input.icpIndustries || [],
      geographies: geosArr,
      revenue_min: revMin, revenue_max: revMax,
      employee_min: empMin, employee_max: empMax,
      buying_signals: greenFlagsArr.length ? greenFlagsArr : (input.goodFitIndicators ? input.goodFitIndicators.split(',').map((s: string) => s.trim()).filter(Boolean) : []),
      disqualifiers: input.badFitIndicators ? input.badFitIndicators.split(',').map((s: string) => s.trim()).filter(Boolean) : [],
      personas: personasArr,
      green_flags: greenFlagsArr,
      red_flags: redFlagsArr,
      active: true,
    });

    // ─── 12. RESEARCH CONFIG ───
    await sb.from('coach_research_config').insert({
      coach_id: coachId,
      focus_areas: [
        ...(input.productName ? [`current systems related to ${input.productName}`] : []),
        'key finance/accounting leadership',
        'growth plans and M&A activity',
        'technology modernization initiatives',
      ],
      custom_instructions: `This coach sells ${input.productName || 'software'}. Focus research on good-fit signals: ${greenFlagsArr.join(', ') || 'N/A'}. Watch for bad fit: ${redFlagsArr.join(', ') || 'N/A'}.`,
      use_perplexity: !!PERPLEXITY_API_KEY,
      research_model: 'claude-sonnet-4-20250514',
    });

    // ─── 13. CALL TYPE PROMPTS ───
    const validCallTypes = new Set(['qdc', 'functional_discovery', 'demo', 'scoping', 'proposal', 'negotiation', 'sync', 'custom']);
    for (const ct of activeCalls) {
      const generated = callPrompts[ct.id];
      const callType = validCallTypes.has(ct.id) ? ct.id : 'custom';
      await sb.from('call_type_prompts').insert({
        coach_id: coachId,
        call_type: callType,
        label: generated?.label || ct.name,
        prompt: generated?.prompt || `Analyze this ${ct.name} call.`,
        extraction_rules: generated?.extraction_rules || `Extract key findings.`,
        active: true,
      });
    }

    // ─── 14. SCORING CONFIGS ───
    const validScoreTypes = new Set(['fit', 'champion', 'power', 'deal_health', 'custom']);
    for (const sc of activeScores) {
      const generated = scoringConfigs[sc.id];
      const scoreType = validScoreTypes.has(sc.id) ? sc.id : 'custom';
      await sb.from('scoring_configs').insert({
        coach_id: coachId, score_type: scoreType,
        label: generated?.label || sc.name,
        description: generated?.description || sc.desc,
        criteria: generated?.criteria || [{ name: sc.name, weight: 100, description: sc.desc }],
        max_score: 10, active: true,
      });
    }

    // ─── 15. MSP TEMPLATE ───
    const { data: tmpl } = await sb.from('msp_templates').insert({
      coach_id: coachId,
      template_name: `${input.companyName} Default Pipeline`,
      description: `Auto-generated from onboarding: ${activeStages.length} stages`,
      is_default: true, active: true,
    }).select('id').single();
    if (tmpl) {
      for (let i = 0; i < activeStages.length; i++) {
        await sb.from('msp_template_stages').insert({ template_id: tmpl.id, stage_name: activeStages[i], stage_order: i, status: 'pending' });
      }
    }

    // ─── 16. EMAIL TEMPLATES ───
    const emailDefaults = [
      { name: 'SC Briefing Notes', email_type: 'sc_briefing', description: 'Solutions Consultant briefing before a call', recipient_type: 'internal', include_pain_points: true, include_contacts: true, include_competition: true, include_deal_analysis: true, include_company_profile: true },
      { name: 'Post-Call Follow Up', email_type: 'post_call', description: 'Follow-up email after a prospect call', recipient_type: 'external', include_pain_points: true, include_contacts: true, include_deal_analysis: true, include_company_profile: true },
      { name: 'Internal Deal Update', email_type: 'internal_update', description: 'Internal stakeholder deal status update', recipient_type: 'internal', include_pain_points: true, include_contacts: true, include_competition: true, include_deal_analysis: true, include_scores: true },
      { name: 'Executive Alignment Email', email_type: 'exec_alignment', description: 'Email to executive sponsor', recipient_type: 'external', include_company_profile: true, include_deal_analysis: true },
      { name: 'Scoping KT Email', email_type: 'scoping_kt', description: 'Knowledge transfer for scoping phase', recipient_type: 'internal', include_pain_points: true, include_contacts: true, include_company_profile: true, include_deal_analysis: true, include_transcripts: true },
    ];
    for (const et of emailDefaults) {
      await sb.from('email_templates').insert({ coach_id: coachId, ...et, active: true });
    }

    // ─── 17. WIDGET LAYOUT ───
    try {
      const defaultWidgets = ['deal_header', 'company_profile', 'deal_analysis', 'contacts', 'pain_points', 'deal_risks', 'compelling_events', 'tasks', 'competitors', 'msp_stages', 'deal_scores', 'conversations'];
      await sb.from('org_widget_layouts').insert({
        org_id: orgId, page: 'deal_overview', name: 'Default', is_default: true,
        widgets: defaultWidgets.map((w, i) => ({ id: w, visible: true, order: i })),
        layout: defaultWidgets.map((w, i) => ({ i: w, x: 0, y: i * 4, w: 12, h: 4 })),
        created_by: user_id,
      });
    } catch (e: any) { console.log('Widget layout skipped:', e.message); }

    // ─── 18. TEAM INVITATIONS ───
    const teamMembers = input.teamMembers || [];
    let inviteCount = 0;
    for (const member of teamMembers) {
      if (!member.email) continue;
      try { await sb.from('invitations').insert({ org_id: orgId, email: member.email, role: 'rep', invited_by: user_id, status: 'pending' }); inviteCount++; }
      catch (e: any) { console.log(`Invite skip ${member.email}:`, e.message); }
    }
    for (const member of teamMembers) {
      try { await sb.from('user_team_members').insert({ user_id, name: member.name, title: member.role, email: member.email || null, member_type: 'other', is_active: true, is_default_team: false }); }
      catch (e: any) { console.log(`Team member skip ${member.name}:`, e.message); }
    }

    console.log('=== ONBOARD v9 COMPLETE ===');
    return resp({
      success: true, org_id: orgId, coach_id: coachId, version: 'v9',
      summary: {
        organization: input.companyName,
        coach: `${input.companyName} Sales Coach`,
        methodologies: methodNames,
        coaching_style: coachStyle.split(' — ')[0],
        call_type_prompts: activeCalls.length,
        scoring_configs: activeScores.length,
        pipeline_stages: activeStages.length,
        email_templates: emailDefaults.length,
        team_invitations: inviteCount,
        team_members: teamMembers.length,
        perplexity_research: !!marketResearch,
        credits_granted: 500,
        personas_captured: personasArr.length,
        green_flags_captured: greenFlagsArr.length,
        red_flags_captured: redFlagsArr.length,
        competitors_captured: competitorsList.length,
      },
    });

  } catch (err: any) {
    console.error('ONBOARD v9 FATAL:', err.message, err.stack);
    return resp({ error: `v9: ${err.message}` }, 500);
  }
});
