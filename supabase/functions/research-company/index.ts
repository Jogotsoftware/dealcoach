import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// research-company v34
// CHANGES FROM v33:
// - Replaces direct coach.system_prompt read with assemble_coach_prompt RPC (p_action='research')
//   so platform core + methodology + coach context + ICP are all injected.
// - Upserts assembled_prompt_versions (dedup on SHA-256 hash, increments use_count).
// - coach.research_prompt is still used as the research-specific user-prompt template (unchanged).

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SCHEMA = `{"company_profile":{"overview":"string","industry":"string","revenue":"string","employee_count":"string","headquarters":"string","founded":"string","revenue_streams":["stream"],"tech_stack":["system"],"international_operations":"string","business_goals":["goal"],"business_priorities":["priority"],"growth_plans":["plan"],"recent_news":[{"date":"YYYY-MM","headline":"string","source_url":"URL or null"}],"other_initiatives":["initiative"],"tax_ids_locations":"string","ownership":"string"},"contacts":[{"name":"full name","title":"title","department":"dept","email":"email","linkedin":"REAL LinkedIn URL from Apollo/search ONLY","role_in_deal":"Economic Buyer|Champion|Technical Evaluator|Decision Maker|Influencer","influence_level":"high|medium|low","is_economic_buyer":false,"is_champion":false,"is_signer":false,"alignment_status":"aligned|neutral|resistant|unknown","background":"2-3 previous roles","previous_erp_experience":"ERP systems or null","source":"Apollo|LinkedIn|website","source_url":"URL"}],"company_systems":[{"system_category":"accounting|billing_invoicing|crm|project_management|inventory|payroll|expenses|fpa|front_end_operational|banks_credit_cards|other","system_name":"name","confidence":"high|medium|low","is_current":true,"is_needed":false,"integration_purpose":"null or string","source_url":"URL","notes":"evidence"}],"competitors":[{"name":"name","website":"URL","relevance":"why"}],"pain_points":[{"pain_description":"pain","category":"financial|operational|compliance|growth|competitive|technology|personnel","annual_cost":null,"annual_hours":null,"impact_text":"business impact","solution_component":"module or null","reasoning":"evidence","source_url":"URL or null"}],"compelling_events":[{"event_description":"consequence of inaction","event_date":"YYYY-MM-DD or null","strength":"strong|medium|weak","impact":"urgency","source_url":"URL or null"}],"risks":[{"risk_description":"risk","category":"timing|competition|champion|budget|technical|political|legal|resource|deal|custom","severity":"critical|high|medium|low","source_url":"URL or null"}],"flags":[{"flag_type":"red|green","description":"flag","category":"timing|competition|champion|budget|technical|political|fit|engagement|process|custom","severity":"critical|high|medium|low|null","source_url":"URL or null"}],"decision_criteria":[{"criterion":"what they evaluate on","importance":"high|medium|low","our_position":"strong|neutral|weak","notes":"context"}],"analysis":{"quantified_pain":"summary","driving_factors":"summary","decision_process":"string","decision_method":"string","business_impact":[{"impact":"string","category":"string","cost":null}],"ideal_solution":[{"component":"string","description":"string"}],"timeline_drivers":[{"driver":"string","date":"null","urgency":"high|medium|low"}]},"hiring_signals":[{"job_title":"title","key_requirements":"software","implications":"meaning","source_url":"URL"}],"fit_score":"0-10","deal_health_score":"0-10","icp_fit":{"score":"0-100","summary":"string"}}`;

const RULES = 'RULES: 1)ONLY JSON. 2)null=unknown. 3)LinkedIn from Apollo/search only. 4)source_url on everything. 5)Events=consequences of INACTION. 6)Competitors=INDUSTRY peers. 7)ARRAYS not semicolons. 8)pain_points need impact_text and solution_component.';

function clamp(v: unknown, lo: number, hi: number): number | null { if (v == null) return null; const n = Number(v); return isNaN(n) ? null : Math.max(lo, Math.min(hi, Math.round(n))); }
function validDate(d: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)); }
function arr(v: any): any[] { return Array.isArray(v) ? v : typeof v === 'string' ? v.split(';').map((s: string) => s.trim()).filter(Boolean) : []; }
function join(a: any[], k?: string): string { return a.map(x => typeof x === 'string' ? x : k ? x[k] : '').filter(Boolean).join('; '); }

const PAIN_CATS = new Set(['financial','operational','compliance','growth','competitive','technology','personnel']);
const RISK_CATS = new Set(['timing','competition','champion','budget','technical','political','legal','resource','deal','custom']);
const SEVS = new Set(['critical','high','medium','low']);
const STRS = new Set(['strong','medium','weak']);
const SYS_CATS = new Set(['accounting','billing_invoicing','crm','project_management','inventory','payroll','expenses','fpa','front_end_operational','banks_credit_cards','other']);
const FLAG_CATS = new Set(['timing','competition','champion','budget','technical','political','fit','engagement','process','custom']);
const ALIGN = new Set(['aligned','neutral','resistant','unknown']);

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function resp(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

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

async function claude(body: any): Promise<Response> {
  for (let i = 1; i <= 3; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise(r => setTimeout(r, 2000 * Math.pow(2, i))); continue; }
    return r;
  }
  return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
}

async function pxq(q: string, key: string, model: string): Promise<string> {
  try {
    const r = await fetch('https://api.perplexity.ai/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: 'user', content: q }], max_tokens: 4000 }) });
    if (!r.ok) return '';
    const d = await r.json(); const t = d.choices?.[0]?.message?.content || ''; const c = d.citations || [];
    return t + (c.length ? '\nSOURCES: ' + c.map((x: string, i: number) => `[${i + 1}] ${x}`).join(' | ') : '');
  } catch { return ''; }
}

async function pxRun(name: string, site: string, focus: string[], inst: string, key: string, model: string): Promise<string> {
  const qs = [`${name} ${site || ''} company overview revenue employees headquarters industry founding ownership subsidiaries`, `"${name}" leadership CFO Controller "VP Finance" CEO COO CTO LinkedIn career background`, `"${name}" accounting software ERP QuickBooks NetSuite Sage technology CRM payroll job postings`, `"${name}" recent news 2024 2025 2026 acquisitions funding changes expansion competitors`];
  if (focus.length) qs.push(`"${name}" ${focus.slice(0, 3).join(' ')}`);
  if (inst) qs.push(`"${name}" ${inst.substring(0, 200)}`);
  const res: string[] = [];
  for (let i = 0; i < qs.length; i += 3) res.push(...await Promise.all(qs.slice(i, i + 3).map(q => pxq(q, key, model))));
  return res.filter(Boolean).map((r, i) => `--- PX${i + 1} ---\n${r}`).join('\n\n');
}

async function apPeople(name: string, site: string, key: string): Promise<string> {
  try {
    const dom = site?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''); if (!dom) return '';
    const r = await fetch('https://api.apollo.io/v1/mixed_people/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Api-Key': key }, body: JSON.stringify({ q_organization_domains: dom, page: 1, per_page: 10, person_titles: ['CFO', 'Chief Financial Officer', 'Controller', 'VP Controller', 'VP Finance', 'Director of Finance', 'Director of Accounting', 'Accounting Manager', 'FP&A Director', 'CEO', 'President', 'Owner', 'Founder', 'COO', 'CTO', 'CIO'], reveal_personal_emails: false, reveal_phone_number: false }) });
    if (!r.ok) return ''; const pp = (await r.json()).people || []; if (!pp.length) return '';
    return '--- Apollo Contacts ---\n' + pp.map((p: any) => { const x = [`Name: ${p.first_name} ${p.last_name}`, `Title: ${p.title || '?'}`]; if (p.linkedin_url) x.push(`LinkedIn: ${p.linkedin_url}`); if (p.email) x.push(`Email: ${p.email}`); if (p.departments?.length) x.push(`Dept: ${p.departments.join(', ')}`); if (p.employment_history?.length) x.push(`Career: ${p.employment_history.slice(0, 3).map((e: any) => `${e.title || '?'} at ${e.organization_name || '?'}`).join('; ')}`); return x.join(' | '); }).join('\n');
  } catch { return ''; }
}

async function apCompany(site: string, key: string): Promise<string> {
  try {
    const dom = site?.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, ''); if (!dom) return '';
    const r = await fetch(`https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(dom)}`, { headers: { 'X-Api-Key': key } });
    if (!r.ok) return ''; const o = (await r.json()).organization; if (!o) return '';
    const x = [o.name && `Company: ${o.name}`, o.industry && `Industry: ${o.industry}`, o.estimated_num_employees && `Employees: ${o.estimated_num_employees}`, o.annual_revenue_printed && `Revenue: ${o.annual_revenue_printed}`, o.founded_year && `Founded: ${o.founded_year}`].filter(Boolean);
    if (o.current_technologies?.length) x.push(`Technologies: ${o.current_technologies.map((t: any) => t.name || t).join(', ')}`);
    return x.length ? '--- Apollo Company ---\n' + x.join('\n') : '';
  } catch { return ''; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  let logId: string | null = null;

  try {
    if (!ANTHROPIC_API_KEY) return resp({ error: 'v34: No API key' }, 500);
    const { deal_id } = await req.json(); if (!deal_id) return resp({ error: 'v34: deal_id required' }, 400);
    const { data: deal } = await sb.from('deals').select('*').eq('id', deal_id).single(); if (!deal) return resp({ error: 'v34: Deal not found' }, 404);
    const { data: rep } = await sb.from('profiles').select('active_coach_id, org_id').eq('id', deal.rep_id).single();
    const cid = rep?.active_coach_id;

    // Hardcoded fallback system prompt if no coach assigned
    let sys = 'You are a thorough sales research AI.';
    let rp = 'Research this company.', model = 'claude-sonnet-4-20250514', temp = 0.1, docs = '';
    if (cid) {
      const { data: c } = await sb.from('coaches').select('research_prompt, model, temperature').eq('id', cid).single();
      if (c) { rp = c.research_prompt || rp; model = c.model || model; temp = Number(c.temperature) || temp; }
      const { data: d } = await sb.from('coach_documents').select('name, content').eq('coach_id', cid).eq('active', true);
      if (d?.length) docs = d.map((x: any) => `--- ${x.name} ---\n${x.content}`).join('\n\n');

      // ── Assemble 4-layer system prompt via RPC ──
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', {
          p_coach_id: cid,
          p_call_type: null,
          p_action: 'research',
        });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          sys = assembled;
          await recordAssembledPrompt(sb, cid, null, 'research', assembled);
        }
      } catch (e) { console.log('assemble_coach_prompt error (research, non-fatal):', e); }
    }

    let focus: string[] = [], custom = '', pxK = PERPLEXITY_API_KEY || '', pxM = 'sonar', usePx = false, apK = '', useAp = false;
    if (cid) {
      const { data: cfg } = await sb.from('coach_research_config').select('*').eq('coach_id', cid).single();
      if (cfg) {
        focus = cfg.focus_areas || []; custom = cfg.custom_instructions || '';
        if (cfg.perplexity_api_key) pxK = cfg.perplexity_api_key;
        if (cfg.perplexity_model) pxM = cfg.perplexity_model;
        if (cfg.research_model) model = cfg.research_model;
        usePx = cfg.use_perplexity || false;
        if (cfg.apollo_api_key) apK = cfg.apollo_api_key;
        useAp = cfg.use_apollo || false;
      }
    }

    console.log(`Research v34: ${deal.company_name}, model=${model}, px=${usePx}, ap=${useAp}`);

    // Run data sources in parallel
    const [pxR, apP, apC] = await Promise.all([
      usePx && pxK ? pxRun(deal.company_name, deal.website || '', focus, custom, pxK, pxM) : '',
      useAp && apK && deal.website ? apPeople(deal.company_name, deal.website, apK) : '',
      useAp && apK && deal.website ? apCompany(deal.website, apK) : '',
    ]);

    console.log(`Data gathered: px=${pxR.length}chars, apP=${apP.length}chars, apC=${apC.length}chars`);

    let ext = '';
    if (pxR) ext += `\n\nPERPLEXITY (attach citation URLs as source_url):\n${pxR}`;
    if (apP) ext += `\n\nAPOLLO CONTACTS (use LinkedIn URLs, source="Apollo"):\n${apP}`;
    if (apC) ext += `\n\nAPOLLO COMPANY (verified tech):\n${apC}`;

    const prompt = `${rp}\n\nCompany: ${deal.company_name}\nWebsite: ${deal.website || 'N/A'}\nNotes: ${deal.notes || 'None'}\n\nRETURN ARRAYS not semicolons.\n${custom ? `\nINSTRUCTIONS:\n${custom}` : ''} ${docs ? `\nDOCS:\n${docs}` : ''} ${focus.length ? `\nFOCUS: ${focus.join('; ')}` : ''} ${ext}\n\n${RULES}\n\nReturn ONLY JSON:\n${SCHEMA}`;

    const { data: log } = await sb.from('ai_response_log').insert({ deal_id, response_type: 'company_research', coach_id: cid, ai_model_used: model, temperature: temp, status: 'processing', triggered_by: deal.rep_id }).select('id').single();
    logId = log?.id || null;

    const body: any = { model, max_tokens: 8000, temperature: temp, system: sys, messages: [{ role: 'user', content: prompt }] };
    if (!pxR && !apP) body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];

    console.log('Calling Claude...');
    const cr = await claude(body);
    if (!cr.ok) { const e = await cr.text(); console.error('Claude error:', cr.status, e); await ulog(sb, logId, 'failed', `v34: Claude ${cr.status}: ${e.substring(0, 200)}`, t0); return resp({ error: `v34: Claude ${cr.status}` }, 500); }
    const cd = await cr.json(); const usage = cd.usage || {};
    console.log(`Claude done: ${usage.input_tokens}in ${usage.output_tokens}out`);

    const raw = (cd.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    let p: any;
    try {
      const c = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const m = c.match(/\{[\s\S]*\}/); if (!m) throw new Error('No JSON');
      p = JSON.parse(m[0]);
    } catch (e: any) {
      console.error('Parse error:', e.message);
      await ulog(sb, logId, 'partial', `v34: ${e.message}`, t0, usage);
      return resp({ success: true, status: 'partial' });
    }

    const sum: any = { perplexity: !!pxR, apollo: !!(apP || apC), model: pxM, version: 'v34' };

    // ========== CLEAR OLD RESEARCH DATA ==========
    console.log('Clearing old data...');
    await sb.from('deal_pain_points').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('deal_risks').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('deal_flags').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('compelling_events').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('company_systems').delete().eq('deal_id', deal_id).like('notes', '%AI research%');
    await sb.from('deal_decision_criteria').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('company_news').delete().eq('deal_id', deal_id);

    // ========== COMPANY PROFILE ==========
    try {
      if (p.company_profile) {
        const cp = p.company_profile;
        const u: any = { researched_at: new Date().toISOString(), raw_research: p };
        for (const f of ['overview', 'industry', 'revenue', 'employee_count', 'headquarters', 'founded', 'international_operations', 'tax_ids_locations']) { if (cp[f] != null) u[f] = String(cp[f]); }
        const ra = arr(cp.revenue_streams); u.revenue_streams = join(ra); u.revenue_streams_list = ra;
        const ga = arr(cp.business_goals); u.business_goals = join(ga); u.business_goals_list = ga;
        const pa = arr(cp.business_priorities); u.business_priorities = join(pa); u.business_priorities_list = pa;
        const gr = arr(cp.growth_plans); u.growth_plans = join(gr); u.growth_plans_list = gr;
        const ia = arr(cp.other_initiatives); u.other_initiatives = join(ia); u.other_initiatives_list = ia;
        const ta = arr(cp.tech_stack); u.tech_stack = join(ta);
        if (Array.isArray(cp.recent_news)) { u.recent_news = cp.recent_news.map((n: any) => typeof n === 'string' ? n : `[${n.date || ''}] ${n.headline}`).join('; '); }
        await sb.from('company_profile').update(u).eq('deal_id', deal_id);
        if (Array.isArray(cp.recent_news)) { for (const n of cp.recent_news) { if (typeof n === 'object' && n.headline) { try { await sb.from('company_news').insert({ deal_id, headline: n.headline, date_text: n.date || null, source_url: n.source_url || null, source: 'ai_research' }); } catch {} } } }
        sum.profile = Object.keys(u).length;
      }
    } catch (e: any) { console.error('Profile error:', e.message); }

    // ========== CONTACTS ==========
    let cc = 0;
    try {
      if (p.contacts?.length) {
        for (const c of p.contacts) {
          if (!c.name) continue;
          const { data: ex } = await sb.from('contacts').select('id').eq('deal_id', deal_id).ilike('name', `%${c.name}%`).limit(1);
          const d: any = { name: c.name, title: c.title || null, department: c.department || null, email: c.email || null, linkedin: c.linkedin || null, role_in_deal: c.role_in_deal || 'Unknown', influence_level: ['high', 'medium', 'low'].includes(c.influence_level) ? c.influence_level : 'Unknown', is_economic_buyer: c.is_economic_buyer || false, is_champion: c.is_champion || false, is_signer: c.is_signer || false, background: c.background || null, previous_erp_experience: c.previous_erp_experience || null, personality_notes: c.personality_notes || null, source_url: c.source_url || null, notes: c.source ? `Source: ${c.source}` : null };
          if (ALIGN.has(c.alignment_status)) d.alignment_status = c.alignment_status;
          if (ex?.length) { await sb.from('contacts').update(d).eq('id', ex[0].id); }
          else { const { error } = await sb.from('contacts').insert({ ...d, deal_id }); if (!error) cc++; }
        }
        sum.contacts = cc;
      }
    } catch (e: any) { console.error('Contacts error:', e.message); }

    // ========== SYSTEMS ==========
    try {
      if (p.company_systems?.length) {
        for (const s of p.company_systems) {
          if (!s.system_name) continue;
          await sb.from('company_systems').insert({ deal_id, system_category: SYS_CATS.has(s.system_category) ? s.system_category : 'other', system_name: s.system_name, confidence: s.confidence || 'medium', is_current: s.is_current !== false, is_needed: s.is_needed || false, integration_purpose: s.integration_purpose || null, source_url: s.source_url || null, notes: `AI research: ${s.notes || ''}` });
        }
        sum.systems = p.company_systems.length;
      }
    } catch (e: any) { console.error('Systems error:', e.message); }

    // ========== COMPETITORS ==========
    try {
      if (p.competitors?.length) {
        for (const c of p.competitors) {
          if (!c.name) continue;
          const { data: ex } = await sb.from('deal_competitors').select('id').eq('deal_id', deal_id).ilike('competitor_name', `%${c.name}%`).limit(1);
          if (ex?.length) { await sb.from('deal_competitors').update({ website: c.website || null, notes: c.relevance || null, competitor_type: 'industry', source_url: c.source_url || null }).eq('id', ex[0].id); }
          else { await sb.from('deal_competitors').insert({ deal_id, competitor_name: c.name, website: c.website || null, notes: c.relevance || null, competitor_type: 'industry', source_url: c.source_url || null }); }
        }
        sum.competitors = p.competitors.length;
      }
    } catch (e: any) { console.error('Competitors error:', e.message); }

    // ========== FLAGS ==========
    try {
      if (p.flags?.length) {
        for (const f of p.flags) { if (!f.description) continue; await sb.from('deal_flags').insert({ deal_id, flag_type: f.flag_type === 'green' ? 'green' : 'red', description: f.description, category: FLAG_CATS.has(f.category) ? f.category : 'custom', severity: SEVS.has(f.severity) ? f.severity : null, source: 'ai_research', source_url: f.source_url || null }); }
        sum.flags = p.flags.length;
      }
    } catch (e: any) { console.error('Flags error:', e.message); }

    // ========== PAIN POINTS ==========
    try {
      if (p.pain_points?.length) {
        for (const x of p.pain_points) { if (!x.pain_description) continue; await sb.from('deal_pain_points').insert({ deal_id, pain_description: x.pain_description, category: PAIN_CATS.has(x.category) ? x.category : 'operational', annual_cost: typeof x.annual_cost === 'number' ? x.annual_cost : null, annual_hours: typeof x.annual_hours === 'number' ? x.annual_hours : null, impact_text: x.impact_text || null, solution_component: x.solution_component || null, source: 'ai_research', verified: false, notes: x.reasoning || null, source_url: x.source_url || null }); }
        sum.pains = p.pain_points.length;
      }
    } catch (e: any) { console.error('Pains error:', e.message); }

    // ========== EVENTS ==========
    try {
      if (p.compelling_events?.length) {
        for (const e of p.compelling_events) { if (!e.event_description) continue; await sb.from('compelling_events').insert({ deal_id, event_description: e.event_description, event_date: e.event_date && validDate(e.event_date) ? e.event_date : null, strength: STRS.has(e.strength) ? e.strength : 'medium', impact: e.impact || null, verified: false, source: 'ai_research', source_url: e.source_url || null }); }
        sum.events = p.compelling_events.length;
      }
    } catch (e: any) { console.error('Events error:', e.message); }

    // ========== RISKS ==========
    try {
      if (p.risks?.length) {
        for (const r of p.risks) { if (!r.risk_description) continue; await sb.from('deal_risks').insert({ deal_id, risk_description: r.risk_description, category: RISK_CATS.has(r.category) ? r.category : 'deal', severity: SEVS.has(r.severity) ? r.severity : 'medium', source: 'ai_research', status: 'open', source_url: r.source_url || null }); }
        sum.risks = p.risks.length;
      }
    } catch (e: any) { console.error('Risks error:', e.message); }

    // ========== DECISION CRITERIA ==========
    try {
      if (p.decision_criteria?.length) {
        for (const dc of p.decision_criteria) { if (!dc.criterion) continue; await sb.from('deal_decision_criteria').insert({ deal_id, criterion: dc.criterion, importance: ['high', 'medium', 'low'].includes(dc.importance) ? dc.importance : 'medium', our_position: ['strong', 'neutral', 'weak'].includes(dc.our_position) ? dc.our_position : 'neutral', notes: dc.notes || null, source: 'ai_research' }); }
        sum.criteria = p.decision_criteria.length;
      }
    } catch (e: any) { console.error('Criteria error:', e.message); }

    // ========== DEAL ANALYSIS ==========
    try {
      const au: any = {};
      if (p.pain_points?.length) au.pain_points = p.pain_points.map((x: any) => x.pain_description).join('; ');
      if (p.risks?.length) au.red_flags = p.risks.map((x: any) => x.risk_description).join('; ');
      if (p.flags?.length) { const gf = p.flags.filter((f: any) => f.flag_type === 'green').map((f: any) => f.description); if (gf.length) au.green_flags = gf.join('; '); }
      if (p.hiring_signals?.length) au.custom_fields = { hiring_signals: p.hiring_signals };
      const an = p.analysis || {};
      if (an.quantified_pain) au.quantified_pain = an.quantified_pain;
      if (an.driving_factors) au.driving_factors = an.driving_factors;
      if (an.decision_process) au.decision_process = an.decision_process;
      if (an.decision_method) au.decision_method = an.decision_method;
      if (an.business_impact?.length) au.business_impact_list = an.business_impact;
      if (an.ideal_solution?.length) au.ideal_solution_list = an.ideal_solution;
      if (an.timeline_drivers?.length) au.timeline_drivers_list = an.timeline_drivers;
      if (p.pain_points?.length) {
        const tc = p.pain_points.reduce((s: number, x: any) => s + (typeof x.annual_cost === 'number' ? x.annual_cost : 0), 0);
        const th = p.pain_points.reduce((s: number, x: any) => s + (typeof x.annual_hours === 'number' ? x.annual_hours : 0), 0);
        if (tc) au.running_problem_cost_dollars = tc;
        if (th) au.running_problem_cost_hours = th;
      }
      if (Object.keys(au).length) await sb.from('deal_analysis').update(au).eq('deal_id', deal_id);
    } catch (e: any) { console.error('Analysis error:', e.message); }

    // ========== ICP + SCORES ==========
    try {
      if (p.icp_fit) { await sb.from('deals').update({ icp_fit_score: clamp(p.icp_fit.score, 0, 100), icp_fit_breakdown: p.icp_fit }).eq('id', deal_id); sum.icp = p.icp_fit.score; }
      const fs = clamp(p.fit_score, 0, 10), hs = clamp(p.deal_health_score, 0, 10);
      if (fs != null || hs != null) { const u: any = {}; if (fs != null) u.fit_score = fs; if (hs != null) u.deal_health_score = hs; await sb.from('deals').update(u).eq('id', deal_id); }
      await sb.from('deals').update({ last_researched_at: new Date().toISOString() }).eq('id', deal_id);
    } catch (e: any) { console.error('Scores error:', e.message); }

    console.log('Research complete:', JSON.stringify(sum));
    await ulog(sb, logId, 'completed', null, t0, usage, sum);
    return resp({ success: true, version: 'v34', status: 'completed', summary: sum });

  } catch (err: any) {
    console.error('FATAL v34:', err.message, err.stack);
    await ulog(sb, logId, 'failed', `v34: ${err.message}`, t0);
    return resp({ error: `v34: ${err.message}` }, 500);
  }
});

async function ulog(sb: any, id: string | null, s: string, e: string | null, t0: number, u?: any, sum?: any) {
  if (!id) return;
  try {
    await sb.from('ai_response_log').update({ status: s, error_message: e, processing_time_ms: Date.now() - t0, prompt_tokens: u?.input_tokens || null, completion_tokens: u?.output_tokens || null, total_tokens: (u?.input_tokens || 0) + (u?.output_tokens || 0) || null, extraction_summary: sum || {} }).eq('id', id);
  } catch {}
}
