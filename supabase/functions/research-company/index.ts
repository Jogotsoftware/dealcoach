import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// research-company v36
// CHANGES FROM v34 (extraction overhaul Phase 3 — facts-only research):
// - Claims-with-citations contract ENFORCED IN CODE: row facts (pains, CEs,
//   systems, news, hiring, criteria) without a source_url are dropped, not
//   written. Profile scalar fields require a per-field citation in
//   profile_citations; uncited fields stay Unknown.
// - Suspected red/green flags + speculative risks no longer touch fact
//   tables (deal_flags / deal_risks / deal_analysis.red_flags/green_flags).
//   They land in deal_hypotheses (generated_by='research') with
//   basis_source_ids pointing at the deal_sources rows for their citations.
// - Every accepted fact writes a deal_sources row (source_origin='research',
//   URL + title + accessed_at).
// - sizing.entity_count routes through the shared provenance writer to the
//   canonical home (deal_sizing.entity_count, source='research'),
//   change-aware.
// - Pre-call ICP fit computes over verified facts only and labels itself
//   "fit based on N verified facts".
// - Canonical-home deprecation: stops writing deal_analysis.pain_points
//   text blob (relational deal_pain_points is canonical).
// - Logo: cosmetic favicon fallback writes company_profile.logo_url when
//   empty (Google s2 favicon endpoint; failures silent).
// - Source-quality ordering in the prompt: primary sources first, forums
//   excluded as fact sources.

import { writeFact } from "../_shared/provenance-writer.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const SCHEMA = `{"company_profile":{"overview":"string","industry":"string","revenue":"string","employee_count":"string","headquarters":"string","founded":"string","revenue_streams":["stream"],"tech_stack":["system"],"international_operations":"string","business_goals":["goal"],"business_priorities":["priority"],"growth_plans":["plan"],"recent_news":[{"date":"YYYY-MM","headline":"string","source_url":"URL REQUIRED"}],"other_initiatives":["initiative"],"tax_ids_locations":"string","ownership":"string"},"profile_citations":{"overview":"URL","industry":"URL","revenue":"URL","employee_count":"URL","headquarters":"URL","founded":"URL","international_operations":"URL","ownership":"URL"},"sizing":{"entity_count":{"value":0,"source_url":"URL REQUIRED"}},"contacts":[{"name":"full name","title":"title","department":"dept","email":"email","linkedin":"REAL LinkedIn URL from Apollo/search ONLY","role_in_deal":"Economic Buyer|Champion|Technical Evaluator|Decision Maker|Influencer","influence_level":"high|medium|low","is_economic_buyer":false,"is_champion":false,"is_signer":false,"alignment_status":"aligned|neutral|resistant|unknown","background":"2-3 previous roles","previous_erp_experience":"ERP systems or null","org_relationship":"prospect_employee|vendor|partner|reference|other — default prospect_employee for people who work at the company","source":"Apollo|LinkedIn|website","source_url":"URL REQUIRED"}],"company_systems":[{"system_category":"accounting|billing_invoicing|crm|project_management|inventory|payroll|expenses|fpa|front_end_operational|banks_credit_cards|other","system_name":"name","relationship":"current|competitor|prior|evaluating|complementary — current = they run it now; competitor = a vendor we compete with; only current is their tech stack","confidence":"high|medium|low","is_current":true,"is_needed":false,"integration_purpose":"null or string","source_url":"URL REQUIRED","notes":"evidence"}],"competitors":[{"name":"name","website":"URL","relevance":"why"}],"pain_points":[{"pain_description":"pain stated in a cited source, NOT inferred","category":"financial|operational|compliance|growth|competitive|technology|personnel","annual_cost":null,"annual_hours":null,"impact_text":"business impact","solution_component":"module or null","reasoning":"evidence","source_url":"URL REQUIRED"}],"compelling_events":[{"event_description":"consequence of inaction, from a cited source","event_date":"YYYY-MM-DD or null","strength":"strong|medium|weak","impact":"urgency","source_url":"URL REQUIRED"}],"hypotheses":[{"hypothesis_type":"red_flag|green_flag","hypothesis":"suspected pattern about this deal","reasoning":"why you believe this","confidence":"high|medium|low","basis_urls":["URLs the reasoning drew on"]}],"decision_criteria":[{"criterion":"what they evaluate on","importance":"high|medium|low","our_position":"strong|neutral|weak","notes":"context","source_url":"URL REQUIRED"}],"analysis":{"quantified_pain":"summary of CITED pains only","driving_factors":"summary","decision_process":"string","decision_method":"string","business_impact":[{"impact":"string","category":"string","cost":null}],"ideal_solution":[{"component":"string","description":"string"}],"timeline_drivers":[{"driver":"string","date":"null","urgency":"high|medium|low"}]},"hiring_signals":[{"job_title":"title","key_requirements":"software","implications":"meaning","source_url":"URL REQUIRED"}],"icp_fit":{"score":"0-100","summary":"string","verified_fact_count":0}}`;

const RULES = 'RULES: 1)ONLY JSON. 2)null=unknown — NEVER guess. 3)LinkedIn from Apollo/search only. 4)FACTS REQUIRE CITATIONS: any pain/event/system/news/hiring/criteria/profile claim without a real source_url WILL BE DROPPED by the server. Do not fabricate URLs. 5)Suspicions and pattern-reasoning go ONLY in hypotheses[], never as facts. 6)Events=consequences of INACTION. 7)Competitors=INDUSTRY peers. 8)ARRAYS not semicolons. 9)icp_fit scores ONLY verified cited facts; set verified_fact_count. 10)SOURCE QUALITY ORDER: company website > press releases > SEC EDGAR > state business registries > official marketplaces/case studies > reputable trade press > aggregators. Forums and low-quality aggregators are NOT fact sources (leads to verify only).';

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
    if (!ANTHROPIC_API_KEY) return resp({ error: 'v36: No API key' }, 500);
    const { deal_id } = await req.json(); if (!deal_id) return resp({ error: 'v36: deal_id required' }, 400);
    const { data: deal } = await sb.from('deals').select('*').eq('id', deal_id).single(); if (!deal) return resp({ error: 'v36: Deal not found' }, 404);
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

    console.log(`Research v36: ${deal.company_name}, model=${model}, px=${usePx}, ap=${useAp}`);

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
    if (!cr.ok) { const e = await cr.text(); console.error('Claude error:', cr.status, e); await ulog(sb, logId, 'failed', `v36: Claude ${cr.status}: ${e.substring(0, 200)}`, t0); return resp({ error: `v36: Claude ${cr.status}` }, 500); }
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
      await ulog(sb, logId, 'partial', `v36: ${e.message}`, t0, usage);
      return resp({ success: true, status: 'partial' });
    }

    const sum: any = { perplexity: !!pxR, apollo: !!(apP || apC), model: pxM, version: 'v36', dropped_uncited: 0 };
    const researchOrgId = rep?.org_id || deal.org_id;
    const observedAt = new Date().toISOString();

    // Citation gate + deal_sources ledger. Returns the source row id, or null
    // when the claim has no URL (claim is then dropped by the caller).
    const hasUrl = (u: unknown) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
    async function citedSource(fieldCategory: string, fieldName: string, summary: string, url: unknown, title?: string): Promise<string | null> {
      if (!hasUrl(url)) { sum.dropped_uncited++; return null; }
      try {
        const { data } = await sb.from('deal_sources').insert({
          deal_id, source_origin: 'research', field_category: fieldCategory, field_name: fieldName,
          summary: String(summary || '').slice(0, 500), source_url: String(url).trim(),
          source_title: title || null, accessed_at: observedAt,
        }).select('id').single();
        return data?.id || null;
      } catch (e: any) { console.error('v36 deal_sources insert:', e?.message); return null; }
    }

    // ========== CLEAR OLD RESEARCH DATA ==========
    console.log('Clearing old data...');
    await sb.from('deal_pain_points').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('compelling_events').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('company_systems').delete().eq('deal_id', deal_id).like('notes', '%AI research%');
    await sb.from('deal_decision_criteria').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('company_news').delete().eq('deal_id', deal_id);
    // Open research hypotheses refresh on re-run; resolved ones are history.
    await sb.from('deal_hypotheses').delete().eq('deal_id', deal_id).eq('generated_by', 'research').eq('status', 'open');
    // NOTE v36: deal_risks / deal_flags from research are no longer written
    // (hypothesis layer owns research reasoning), so no clearing either —
    // except one-time cleanup of pre-v36 research rows:
    await sb.from('deal_risks').delete().eq('deal_id', deal_id).eq('source', 'ai_research');
    await sb.from('deal_flags').delete().eq('deal_id', deal_id).eq('source', 'ai_research');

    // ========== COMPANY PROFILE (per-field citations required) ==========
    try {
      if (p.company_profile) {
        const cp = p.company_profile;
        const cites = (p.profile_citations && typeof p.profile_citations === 'object') ? p.profile_citations : {};
        const u: any = { researched_at: observedAt, raw_research: p };
        for (const f of ['overview', 'industry', 'revenue', 'employee_count', 'headquarters', 'founded', 'international_operations', 'ownership']) {
          if (cp[f] == null) continue;
          const sid = await citedSource('company_profile', f, String(cp[f]), cites[f]);
          if (sid) u[f] = String(cp[f]);
          // uncited scalar claims stay Unknown (dropped by the citation gate)
        }
        if (cp.tax_ids_locations != null) u.tax_ids_locations = String(cp.tax_ids_locations);
        // List fields are synthesis (goals/priorities/plans) rather than
        // checkable single facts — kept, but recorded without fact status.
        const ra = arr(cp.revenue_streams); u.revenue_streams = join(ra); u.revenue_streams_list = ra;
        const ga = arr(cp.business_goals); u.business_goals = join(ga); u.business_goals_list = ga;
        const pa = arr(cp.business_priorities); u.business_priorities = join(pa); u.business_priorities_list = pa;
        const gr = arr(cp.growth_plans); u.growth_plans = join(gr); u.growth_plans_list = gr;
        const ia = arr(cp.other_initiatives); u.other_initiatives = join(ia); u.other_initiatives_list = ia;
        const ta = arr(cp.tech_stack); u.tech_stack = join(ta);
        // News requires a URL per item (dropped otherwise).
        if (Array.isArray(cp.recent_news)) {
          const cited = cp.recent_news.filter((n: any) => typeof n === 'object' && n.headline && hasUrl(n.source_url));
          u.recent_news = cited.map((n: any) => `[${n.date || ''}] ${n.headline}`).join('; ');
          for (const n of cited) {
            try { await sb.from('company_news').insert({ deal_id, headline: n.headline, date_text: n.date || null, source_url: n.source_url, source: 'ai_research' }); } catch {}
            await citedSource('company_news', 'recent_news', n.headline, n.source_url);
          }
          sum.dropped_uncited += (cp.recent_news.length - cited.length);
        }
        await sb.from('company_profile').update(u).eq('deal_id', deal_id);
        sum.profile = Object.keys(u).length;
      }
      // sizing.entity_count routes through the shared provenance writer to the
      // canonical home with research provenance (change-aware vs prior value).
      if (p.sizing?.entity_count && typeof p.sizing.entity_count.value === 'number' && hasUrl(p.sizing.entity_count.source_url)) {
        const wr = await writeFact(sb, {
          org_id: researchOrgId, deal_id,
          field_key: 'entity_count', field_type: 'number',
          storage_target: 'deal_sizing.entity_count',
          value: p.sizing.entity_count.value,
          prov: { source: 'research', source_url: p.sizing.entity_count.source_url, observed_at: observedAt },
        });
        sum.entity_count = wr.disposition;
      }
    } catch (e: any) { console.error('Profile error:', e.message); }

    // ========== CONTACTS ==========
    let cc = 0;
    try {
      if (p.contacts?.length) {
        for (const c of p.contacts) {
          if (!c.name) continue;
          const { data: ex } = await sb.from('contacts').select('id').eq('deal_id', deal_id).ilike('name', `%${c.name}%`).limit(1);
          const ORG_REL = ['prospect_employee', 'vendor', 'partner', 'reference', 'other'];
          const d: any = { name: c.name, title: c.title || null, department: c.department || null, email: c.email || null, linkedin: c.linkedin || null, role_in_deal: c.role_in_deal || 'Unknown', influence_level: ['high', 'medium', 'low'].includes(c.influence_level) ? c.influence_level : 'Unknown', is_economic_buyer: c.is_economic_buyer || false, is_champion: c.is_champion || false, is_signer: c.is_signer || false, background: c.background || null, previous_erp_experience: c.previous_erp_experience || null, personality_notes: c.personality_notes || null, org_relationship: ORG_REL.includes(c.org_relationship) ? c.org_relationship : 'prospect_employee', source_url: c.source_url || null, notes: c.source ? `Source: ${c.source}` : null };
          if (ALIGN.has(c.alignment_status)) d.alignment_status = c.alignment_status;
          if (ex?.length) { await sb.from('contacts').update(d).eq('id', ex[0].id); }
          else { const { error } = await sb.from('contacts').insert({ ...d, deal_id }); if (!error) cc++; }
        }
        sum.contacts = cc;
      }
    } catch (e: any) { console.error('Contacts error:', e.message); }

    // ========== SYSTEMS (citation required) ==========
    try {
      if (p.company_systems?.length) {
        let written = 0;
        for (const s of p.company_systems) {
          if (!s.system_name) continue;
          const sid = await citedSource('company_systems', s.system_name, `${s.system_category}: ${s.system_name}`, s.source_url);
          if (!sid) continue;
          const SYS_REL = ['current', 'competitor', 'prior', 'evaluating', 'complementary'];
          const sRel = SYS_REL.includes(s.relationship) ? s.relationship : 'current';
          await sb.from('company_systems').insert({ deal_id, system_category: SYS_CATS.has(s.system_category) ? s.system_category : 'other', system_name: s.system_name, relationship: sRel, confidence: s.confidence || 'medium', is_current: sRel === 'current' ? (s.is_current !== false) : false, is_needed: s.is_needed || false, integration_purpose: s.integration_purpose || null, source_url: s.source_url, observed_at: observedAt, notes: `AI research: ${s.notes || ''}` });
          written++;
        }
        sum.systems = written;
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

    // ========== HYPOTHESES (quarantined — never fact tables) ==========
    try {
      const hyps: any[] = Array.isArray(p.hypotheses) ? p.hypotheses : [];
      // Back-compat: a model still emitting risks/flags routes them here too.
      for (const r of (p.risks || [])) if (r?.risk_description) hyps.push({ hypothesis_type: 'red_flag', hypothesis: r.risk_description, reasoning: r.category ? `risk category: ${r.category}` : null, confidence: r.severity || null, basis_urls: hasUrl(r.source_url) ? [r.source_url] : [] });
      for (const f of (p.flags || [])) if (f?.description) hyps.push({ hypothesis_type: f.flag_type === 'green' ? 'green_flag' : 'red_flag', hypothesis: f.description, reasoning: f.category ? `flag category: ${f.category}` : null, confidence: f.severity || null, basis_urls: hasUrl(f.source_url) ? [f.source_url] : [] });
      let written = 0;
      for (const h of hyps) {
        if (!h?.hypothesis) continue;
        const basisIds: string[] = [];
        for (const u of (Array.isArray(h.basis_urls) ? h.basis_urls : [])) {
          const sid = await citedSource('hypothesis', h.hypothesis_type || 'red_flag', h.hypothesis, u);
          if (sid) basisIds.push(sid);
        }
        await sb.from('deal_hypotheses').insert({
          org_id: researchOrgId, deal_id,
          hypothesis_type: h.hypothesis_type === 'green_flag' ? 'green_flag' : 'red_flag',
          hypothesis: h.hypothesis, reasoning: h.reasoning || null,
          basis_source_ids: basisIds, confidence: h.confidence || null,
          generated_by: 'research', status: 'open',
        });
        written++;
      }
      sum.hypotheses = written;
    } catch (e: any) { console.error('Hypotheses error:', e.message); }

    // ========== PAIN POINTS (citation required) ==========
    try {
      if (p.pain_points?.length) {
        let written = 0;
        for (const x of p.pain_points) {
          if (!x.pain_description) continue;
          const sid = await citedSource('deal_pain_points', 'pain', x.pain_description, x.source_url);
          if (!sid) continue;
          await sb.from('deal_pain_points').insert({ deal_id, pain_description: x.pain_description, category: PAIN_CATS.has(x.category) ? x.category : 'operational', annual_cost: typeof x.annual_cost === 'number' ? x.annual_cost : null, annual_hours: typeof x.annual_hours === 'number' ? x.annual_hours : null, impact_text: x.impact_text || null, solution_component: x.solution_component || null, source: 'ai_research', verified: false, observed_at: observedAt, notes: x.reasoning || null, source_url: x.source_url });
          written++;
        }
        sum.pains = written;
      }
    } catch (e: any) { console.error('Pains error:', e.message); }

    // ========== EVENTS (citation required) ==========
    try {
      if (p.compelling_events?.length) {
        let written = 0;
        for (const e of p.compelling_events) {
          if (!e.event_description) continue;
          const sid = await citedSource('compelling_events', 'event', e.event_description, e.source_url);
          if (!sid) continue;
          await sb.from('compelling_events').insert({ deal_id, event_description: e.event_description, event_date: e.event_date && validDate(e.event_date) ? e.event_date : null, strength: STRS.has(e.strength) ? e.strength : 'medium', impact: e.impact || null, verified: false, source: 'ai_research', observed_at: observedAt, source_url: e.source_url });
          written++;
        }
        sum.events = written;
      }
    } catch (e: any) { console.error('Events error:', e.message); }

    // v36: research writes NO deal_risks and NO deal_flags — that reasoning
    // lives in deal_hypotheses until evidence confirms or refutes it.

    // ========== DECISION CRITERIA (citation required) ==========
    try {
      if (p.decision_criteria?.length) {
        let written = 0;
        for (const dc of p.decision_criteria) {
          if (!dc.criterion) continue;
          const sid = await citedSource('deal_decision_criteria', 'criterion', dc.criterion, dc.source_url);
          if (!sid) continue;
          await sb.from('deal_decision_criteria').insert({ deal_id, criterion: dc.criterion, importance: ['high', 'medium', 'low'].includes(dc.importance) ? dc.importance : 'medium', our_position: ['strong', 'neutral', 'weak'].includes(dc.our_position) ? dc.our_position : 'neutral', notes: dc.notes || null, source: 'ai_research', observed_at: observedAt });
          written++;
        }
        sum.criteria = written;
      }
    } catch (e: any) { console.error('Criteria error:', e.message); }

    // ========== DEAL ANALYSIS (no flag seeding; no pain_points blob) ==========
    try {
      const au: any = {};
      // v36 canonical-home deprecation: pain_points text blob no longer
      // written (deal_pain_points is canonical). red_flags/green_flags are
      // verified-fact territory — research never writes them.
      if (p.hiring_signals?.length) {
        const cited = p.hiring_signals.filter((h: any) => hasUrl(h.source_url));
        if (cited.length) {
          au.custom_fields = { hiring_signals: cited };
          for (const h of cited) await citedSource('hiring_signals', h.job_title || 'posting', h.implications || h.job_title, h.source_url);
        }
        sum.dropped_uncited += (p.hiring_signals.length - cited.length);
      }
      const an = p.analysis || {};
      if (an.quantified_pain) au.quantified_pain = an.quantified_pain;
      if (an.driving_factors) au.driving_factors = an.driving_factors;
      if (an.decision_process) au.decision_process = an.decision_process;
      if (an.decision_method) au.decision_method = an.decision_method;
      if (an.business_impact?.length) au.business_impact_list = an.business_impact;
      if (an.ideal_solution?.length) au.ideal_solution_list = an.ideal_solution;
      if (an.timeline_drivers?.length) au.timeline_drivers_list = an.timeline_drivers;
      if (Object.keys(au).length) await sb.from('deal_analysis').update(au).eq('deal_id', deal_id);
    } catch (e: any) { console.error('Analysis error:', e.message); }

    // ========== ICP (verified facts only, labeled) ==========
    try {
      if (p.icp_fit) {
        const verifiedCount = Number(p.icp_fit.verified_fact_count) || (sum.pains || 0) + (sum.events || 0) + (sum.systems || 0) + (sum.profile || 0);
        const breakdown = { ...p.icp_fit, basis: `fit based on ${verifiedCount} verified facts`, computed_over: 'verified_facts_only', version: 'v36' };
        await sb.from('deals').update({ icp_fit_score: clamp(p.icp_fit.score, 0, 100), icp_fit_breakdown: breakdown }).eq('id', deal_id);
        sum.icp = p.icp_fit.score;
      }
      await sb.from('deals').update({ last_researched_at: new Date().toISOString() }).eq('id', deal_id);
    } catch (e: any) { console.error('Scores error:', e.message); }

    // ========== LOGO (cosmetic fallback; failures silent) ==========
    try {
      const { data: cprof } = await sb.from('company_profile').select('id, logo_url').eq('deal_id', deal_id).maybeSingle();
      if (cprof && !cprof.logo_url && deal.website) {
        const dom = deal.website.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
        if (dom) {
          const favUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(dom)}&sz=128`;
          let logoUrl: string | null = null;
          try {
            const fr = await fetch(favUrl);
            if (fr.ok) {
              const bytes = new Uint8Array(await fr.arrayBuffer());
              if (bytes.length > 200) { // skip the 16px default globe
                const path = `${deal_id}/favicon-128.png`;
                const { error: upErr } = await sb.storage.from('company-logos').upload(path, bytes, { contentType: 'image/png', upsert: true });
                if (!upErr) {
                  const { data: pub } = sb.storage.from('company-logos').getPublicUrl(path);
                  logoUrl = pub?.publicUrl || null;
                }
              }
            }
          } catch (_) { /* silent */ }
          if (!logoUrl) logoUrl = favUrl; // direct hotlink fallback
          await sb.from('company_profile').update({ logo_url: logoUrl }).eq('id', cprof.id);
          sum.logo = true;
        }
      }
    } catch (e: any) { console.error('Logo error (non-fatal):', e.message); }

    console.log('Research complete:', JSON.stringify(sum));
    await ulog(sb, logId, 'completed', null, t0, usage, sum);
    return resp({ success: true, version: 'v36', status: 'completed', summary: sum });

  } catch (err: any) {
    console.error('FATAL v36:', err.message, err.stack);
    await ulog(sb, logId, 'failed', `v36: ${err.message}`, t0);
    return resp({ error: `v36: ${err.message}` }, 500);
  }
});

async function ulog(sb: any, id: string | null, s: string, e: string | null, t0: number, u?: any, sum?: any) {
  if (!id) return;
  try {
    await sb.from('ai_response_log').update({ status: s, error_message: e, processing_time_ms: Date.now() - t0, prompt_tokens: u?.input_tokens || null, completion_tokens: u?.output_tokens || null, total_tokens: (u?.input_tokens || 0) + (u?.output_tokens || 0) || null, extraction_summary: sum || {} }).eq('id', id);
  } catch {}
}
