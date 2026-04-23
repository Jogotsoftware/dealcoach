import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// process-transcript v31
// CHANGES FROM v30:
// - Calls ingest-deal-knowledge instead of embed-chunks directly (wraps + chunks
//   company_profile + deal_analysis in addition to the conversation)
// CHANGES FROM v29:
// - Uses assemble_coach_prompt RPC for 4-layer system prompt (platform core + methodology + coach + ICP)
// - Upserts assembled_prompt_versions (dedup by SHA-256 hash, increments use_count on repeat)
// - Enforces source linkage on business_catalysts / compelling_events / deal_pain_points:
//   every row must have transcript_excerpt, speaker, timestamp_in_call, quote
// - Writes parallel deal_sources rows with field_category linking back to the extracted entity
// - Strict catalyst vs pain_point separation enforced in the extraction prompt

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const EXTRACTION_SCHEMA = `Return a JSON object with ALL of these fields:
{
  "summary": "3-5 sentence call summary",
  "coaching_notes": "Detailed coaching analysis per the call type prompt",
  "call_analysis": {
    "overall_score": 0-100,
    "score_independently_wealthy": 0-10,
    "independently_wealthy_reason": "Specific examples from the call of where the rep did or did not sell from a position of strength. Cite exact moments.",
    "score_curiosity": 0-10,
    "score_discovery_depth": 0-10,
    "score_challenger": 0-10,
    "score_value_articulation": 0-10,
    "score_next_steps_quality": 0-10,
    "score_objection_handling": 0-10,
    "strengths": "2-4 specific things the rep did well, with examples",
    "improvements": "2-4 specific things to improve, with examples of what they should have done",
    "methodology_gaps": "Specific methodology steps skipped or executed poorly",
    "questions_asked": [{"question": "exact question", "quality": "good|adequate|missed_opportunity", "notes": "why"}],
    "questions_should_have_asked": [{"question": "missed question", "methodology": "BANT|MEDDPICC|SPIN|Challenger|General", "why": "why it matters"}],
    "questions_for_next_call": [{"question": "recommended question", "priority": "high|medium|low", "context": "why now"}],
    "top_3_deal_killers": ["string"],
    "top_3_ways_to_win": ["string"]
  },
  "pain_points_discovered": [{"pain_description": "specific pain", "category": "financial|operational|compliance|growth|competitive|technology|personnel", "annual_cost": 50000, "annual_hours": 200, "impact_text": "business consequence", "solution_component": "module", "transcript_excerpt": "exact 15-30 word verbatim quote from the transcript", "speaker": "who said it", "timestamp_in_call": "MM:SS or null", "quote": "tight quote snippet", "speaker_name": "who", "affected_team": "team"}],
  "risks_identified": [{"risk_description": "threat to deal closing", "category": "timing|competition|champion|budget|technical|political|legal|resource|deal|custom", "severity": "critical|high|medium|low"}],
  "flags": [{"flag_type": "red|green", "description": "signal observed on THIS call", "category": "timing|competition|champion|budget|technical|political|fit|engagement|process|custom"}],
  "compelling_events": [{"event_description": "Event that DEMANDS action with time pressure. Bad things happen if they miss deadline.", "event_date": "YYYY-MM-DD or null", "strength": "strong|medium|weak", "impact": "what goes wrong", "transcript_excerpt": "exact 15-30 word verbatim quote", "speaker": "who said it", "timestamp_in_call": "MM:SS or null", "quote": "tight quote snippet"}],
  "catalysts": [{"catalyst": "Business force driving change (funding round, new exec hire, M&A, regulatory change, system EOL, strategic initiative). NOT operational pain.", "category": "growth|compliance|operational|financial|competitive|technology|personnel|custom", "urgency": "high|medium|low", "transcript_excerpt": "exact 15-30 word verbatim quote", "speaker": "who said it", "timestamp_in_call": "MM:SS or null", "quote": "tight quote snippet"}],
  "decision_criteria": [{"criterion": "what they evaluate on", "importance": "high|medium|low", "our_position": "strong|neutral|weak", "notes": "context"}],
  "systems_mentioned": [{"system_name": "name", "system_category": "accounting|billing_invoicing|crm|project_management|inventory|payroll|expenses|fpa|front_end_operational|banks_credit_cards|other", "confirmed": true, "is_current": true, "is_needed": false}],
  "contacts_mentioned": [{"name": "full name", "title": "title", "role_in_deal": "Economic Buyer|Champion|Technical Evaluator|End User|Decision Maker|Influencer", "department": "dept", "alignment_status": "aligned|neutral|resistant|unknown", "alignment_notes": "how they reacted"}],
  "deal_updates": {"champion": "string or null", "economic_buyer": "string or null", "budget": "string or null", "current_spend": "string or null", "decision_process": "string or null", "decision_method": "string or null", "quantified_pain": "summary", "business_impact": "summary", "driving_factors": "summary", "ideal_solution": "string", "integrations_needed": "string", "timeline_drivers": "string", "exec_alignment": "string"},
  "commitments": [{"title": "specific commitment", "committed_by": "rep|prospect", "committed_by_name": "who", "category": "Follow Up|Internal|Send Materials|Deal Action|CRM Update|Research", "priority": "high|medium|low", "notes": "context"}],
  "memory_observations": [{"memory_type": "commitment_tracking|contradiction|unanswered_question|competitive_signal|champion_risk|stakeholder_gap|coaching_observation|budget_signal|timeline_signal", "content": "Specific observation to remember for next call. Be concrete.", "priority": "critical|high|medium|low", "related_contact_name": "name or null", "resolved_memory_ids": ["uuid of previous memory this call resolved"]}],
  "next_steps_suggestion": "formatted next steps shorthand",
  "score_suggestions": {"fit_score": null, "deal_health_score": null}
}`;

const EXTRACTION_RULES = `CRITICAL RULES — SOURCE LINKAGE REQUIRED:
For every pain_point, catalyst, and compelling_event you extract, you MUST include:
- transcript_excerpt: exact 15-30 word verbatim quote from the transcript that supports this extraction
- speaker: who said it (from speaker labels in the transcript)
- timestamp_in_call: MM:SS if available from the transcript format, else null
- quote: tight 5-15 word snippet for UI display
If you cannot source a catalyst/event/pain to a specific transcript moment, DO NOT extract it. Empty arrays are preferred over fabricated entries.

CATALYST vs PAIN POINT (strict separation):
- CATALYST = high-level business force driving change: funding round, PE acquisition, new CFO/exec hire, M&A, regulatory change, system EOL, strategic initiative, growth plan, IPO prep, audit finding.
  NOT operational pain. NOT workflow inefficiencies. NOT feature gaps.
- PAIN POINT = operational/functional problem experienced day-to-day: slow close, manual reconciliation, AP errors, reporting delays, user frustration, integration pain.
- COMPELLING EVENT = the specific bad thing that happens if they don't act. Has a deadline. Material consequence.

If a single observation could be a pain OR a catalyst, prefer pain_point. Catalysts must be strategic/structural, not operational.

EXTRACT DOLLAR AMOUNTS:
- "costs us $50K a year" -> annual_cost: 50000
- "we spend about $200K" -> annual_cost: 200000
- "takes 20 hours a month" -> annual_hours: 240
- "2 FTEs doing this" -> annual_hours: 4160
- impact_text = BUSINESS CONSEQUENCE (not restating the pain)
- solution_component = specific product module

COMMITMENTS: ONLY explicit commitments someone made on the call. committed_by = rep or prospect.
FLAGS vs RISKS: FLAGS = signals on THIS call. RISKS = strategic threats to DEAL closing.
CONTACTS: Only PROSPECT-SIDE contacts. Do NOT include the rep, SCs, partners, or selling team.
MEMORY OBSERVATIONS: What should the AI remember for the next call? Track commitments, contradictions, unanswered questions, competitive signals, champion risks, stakeholder gaps. Be specific. If a previous observation was addressed, include its ID in resolved_memory_ids.`;

function cors() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jr(d: any, s = 200) { return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } }); }

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

async function callClaude(body: any, retries = 3): Promise<Response> {
  for (let i = 1; i <= retries; i++) {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
    if (r.ok) return r;
    if ([429, 500, 503, 529].includes(r.status)) { await new Promise(resolve => setTimeout(resolve, 2000 * Math.pow(2, i - 1))); continue; }
    return r;
  }
  return fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' }, body: JSON.stringify(body) });
}

async function safeInsertNoReturn(sb: any, table: string, data: any): Promise<boolean> {
  try { const { error } = await sb.from(table).insert(data); if (error) { console.log(`Insert ${table} error:`, error.message); return false; } return true; } catch (e) { console.log(`Insert ${table} exception:`, e); return false; }
}

async function insertDealSource(sb: any, row: any): Promise<string | null> {
  try {
    const { data, error } = await sb.from('deal_sources').insert(row).select('id').single();
    if (error) { console.log('deal_sources insert error:', error.message); return null; }
    return data?.id || null;
  } catch (e) { console.log('deal_sources exception:', e); return null; }
}

const VP = ['financial','operational','compliance','growth','competitive','technology','personnel'];
const VR = ['timing','competition','champion','budget','technical','political','legal','resource','deal','custom'];
const VS = ['critical','high','medium','low'];
const VST = ['strong','medium','weak'];
const VSY = ['accounting','billing_invoicing','crm','project_management','inventory','payroll','expenses','fpa','front_end_operational','banks_credit_cards','other'];
const VF = ['timing','competition','champion','budget','technical','political','fit','engagement','process','custom'];
const VA = ['aligned','neutral','resistant','unknown'];
const VM = ['commitment_tracking','contradiction','unanswered_question','competitive_signal','champion_risk','stakeholder_gap','coaching_observation','budget_signal','timeline_signal'];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() });
  const t0 = Date.now();
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jr({ error: 'v31: No API key' }, 500);
    const reqBody = await req.json();
    console.log('process-transcript v31 keys:', Object.keys(reqBody));

    const conversation_id = reqBody.conversation_id || reqBody.conversationId || reqBody.id;
    if (!conversation_id) return jr({ error: `v31: no conversation_id. Keys: ${Object.keys(reqBody).join(', ')}` }, 400);

    const { data: conv } = await sb.from('conversations').select('*').eq('id', conversation_id).single();
    if (!conv) return jr({ error: 'v31: Conversation not found' }, 404);
    if (!conv.transcript) return jr({ error: 'v31: No transcript' }, 400);

    const deal_id = reqBody.deal_id || reqBody.dealId || conv.deal_id;
    if (!deal_id) return jr({ error: 'v31: No deal_id' }, 400);

    const { data: deal } = await sb.from('deals').select('*').eq('id', deal_id).single();
    if (!deal) return jr({ error: 'v31: Deal not found' }, 404);

    const { data: rep } = await sb.from('profiles').select('active_coach_id, org_id, full_name, initials, email').eq('id', deal.rep_id).single();
    const cid = rep?.active_coach_id;

    let memoryEnabled = true;
    let learningEnabled = true;
    if (rep?.org_id) {
      const { data: org } = await sb.from('organizations').select('settings').eq('id', rep.org_id).single();
      if (org?.settings?.ai_features?.memory_enabled === false) memoryEnabled = false;
      if (org?.settings?.ai_features?.prompt_learning_enabled === false) learningEnabled = false;
    }

    let model = 'claude-sonnet-4-20250514';
    let temp = 0.1;
    let callTypePrompt = '', extractionRules = '', docs = '';

    if (cid) {
      const { data: coach } = await sb.from('coaches').select('model, temperature').eq('id', cid).single();
      if (coach) { model = coach.model || model; temp = Number(coach.temperature) || temp; }
      const { data: ctp } = await sb.from('call_type_prompts').select('*').eq('coach_id', cid).eq('call_type', conv.call_type).single();
      if (ctp) { callTypePrompt = ctp.prompt || ''; extractionRules = ctp.extraction_rules || ''; }
      const { data: d } = await sb.from('coach_documents').select('name, content').eq('coach_id', cid).eq('active', true);
      if (d?.length) docs = d.map((x: any) => `--- ${x.name} ---\n${x.content}`).join('\n\n');
    }

    // ── Assemble system prompt via RPC (4-layer: platform core + methodology + coach + ICP) ──
    let sysPrompt = 'You are an expert B2B sales coach analyzing call transcripts.';
    if (cid) {
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', {
          p_coach_id: cid,
          p_call_type: conv.call_type || null,
          p_action: 'process_transcript',
        });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          sysPrompt = assembled;
          await recordAssembledPrompt(sb, cid, conv.call_type || null, 'process_transcript', sysPrompt);
        }
      } catch (e) { console.log('assemble_coach_prompt error (using fallback):', e); }
    }

    const { data: analysis } = await sb.from('deal_analysis').select('champion, budget, economic_buyer').eq('deal_id', deal_id).single();
    const { data: profile } = await sb.from('company_profile').select('overview, industry, employee_count').eq('deal_id', deal_id).single();
    const { data: existingPains } = await sb.from('deal_pain_points').select('pain_description').eq('deal_id', deal_id);
    const { data: existingSystems } = await sb.from('company_systems').select('system_name').eq('deal_id', deal_id);

    const internalLastNames = new Set<string>();
    try {
      const { data: teamMbrs } = await sb.from('user_team_members').select('name').eq('user_id', deal.rep_id);
      (teamMbrs || []).forEach((tm: any) => { if (tm.name) { const p = tm.name.trim().split(/\s+/); if (p.length) internalLastNames.add(p[p.length-1].toLowerCase()); } });
      if (rep?.org_id) {
        const { data: orgProfs } = await sb.from('profiles').select('full_name').eq('org_id', rep.org_id);
        (orgProfs || []).forEach((pr: any) => { if (pr.full_name) { const p = pr.full_name.trim().split(/\s+/); if (p.length) internalLastNames.add(p[p.length-1].toLowerCase()); } });
      }
    } catch (e) { console.log('Internal names load error:', e); }

    let memories: any[] = [];
    let memoryContext = '';
    if (memoryEnabled) {
      const { data: mems } = await sb.from('ai_memory').select('id, memory_type, content, priority, created_at').eq('deal_id', deal_id).eq('active', true).eq('resolved', false).order('priority').limit(20);
      memories = mems || [];
      if (memories.length) {
        memoryContext = `\n\nAI OBSERVATIONS FROM PREVIOUS CALLS (address these in your coaching analysis, note which ones were resolved on this call):\n${memories.map(m => `- [${m.id}] [${m.priority}] [${m.memory_type}] ${m.content}`).join('\n')}`;
      }
    }

    let learningsContext = '';
    let learningsInjectedCount = 0;
    if (learningEnabled && rep?.org_id) {
      try {
        const { data: learnings } = await sb.from('prompt_learnings').select('category, content, confidence').eq('applied', true).eq('active', true).or(`org_id.eq.${rep.org_id},org_id.is.null`).order('confidence', { ascending: false }).limit(30);
        if (learnings?.length) {
          learningsContext = `\n\nLEARNED FROM PREVIOUS DEALS (apply these corrections to your analysis):\n${learnings.map(l => `- [${l.category}] ${l.content}`).join('\n')}`;
          learningsInjectedCount = learnings.length;
        }
      } catch (e) { console.log('Learnings load error:', e); }
    }

    const ctx = `DEAL: ${deal.company_name} (${deal.stage})\nIndustry: ${profile?.industry || '?'}\nEmployees: ${profile?.employee_count || '?'}\nChampion: ${analysis?.champion || '?'}\nBudget: ${analysis?.budget || '?'}\nKnown pains: ${(existingPains || []).map(p => p.pain_description).join('; ') || 'None'}\nKnown systems: ${(existingSystems || []).map(s => s.system_name).join(', ') || 'None'}${memoryContext}${learningsContext}`;

    const prompt = `Analyze this ${conv.call_type?.toUpperCase() || 'SALES'} call transcript.\n\n${callTypePrompt ? `COACHING FRAMEWORK:\n${callTypePrompt}\n\n` : ''}${extractionRules ? `EXTRACTION RULES:\n${extractionRules}\n\n` : ''}${docs ? `REFERENCE DOCS:\n${docs}\n\n` : ''}DEAL CONTEXT:\n${ctx}\n\n${EXTRACTION_RULES}\n\nTRANSCRIPT:\n${conv.transcript.substring(0, 100000)}\n\nReturn ONLY valid JSON:\n${EXTRACTION_SCHEMA}`;

    const { data: log } = await sb.from('ai_response_log').insert({ deal_id, response_type: 'transcript_analysis', coach_id: cid, ai_model_used: model, temperature: temp, status: 'processing', triggered_by: deal.rep_id }).select('id').single();

    const cr = await callClaude({ model, max_tokens: 8000, temperature: temp, system: sysPrompt, messages: [{ role: 'user', content: prompt }] });
    if (!cr.ok) { const e = await cr.text(); await ulog(sb, log?.id, 'failed', `v31: ${e}`, t0); return jr({ error: `v31: Claude ${cr.status}` }, 500); }

    const cd = await cr.json();
    const usage = cd.usage || {};
    const raw = (cd.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');

    let p: any;
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON');
      p = JSON.parse(match[0]);
    } catch (e: any) { await ulog(sb, log?.id, 'partial', `v31: ${e.message}`, t0, usage); return jr({ success: true, status: 'partial', error: e.message }); }

    await sb.from('conversations').update({ ai_summary: p.summary || null, ai_coaching_notes: p.coaching_notes || null, ai_raw_response: cd, processed: true }).eq('id', conversation_id);

    const sum: any = { learnings_injected: learningsInjectedCount };

    // ── PAIN POINTS (with source linkage) ──
    if (p.pain_points_discovered?.length) {
      let ct = 0;
      for (const x of p.pain_points_discovered) {
        if (!x.pain_description) continue;
        if ((existingPains||[]).some(ep => ep.pain_description.substring(0,50).toLowerCase() === x.pain_description.substring(0,50).toLowerCase())) continue;
        const dsId = await insertDealSource(sb, {
          deal_id, source_origin: 'transcript', field_category: 'pain_point',
          field_name: x.pain_description.substring(0, 200), confidence: 'mentioned',
          summary: x.pain_description, conversation_id,
          speaker: x.speaker || x.speaker_name || null, quote: x.quote || x.transcript_excerpt || null,
          call_date: conv.call_date || null, call_type: conv.call_type || null,
          timestamp_in_call: x.timestamp_in_call || null,
        });
        const ok = await safeInsertNoReturn(sb, 'deal_pain_points', {
          deal_id, pain_description: x.pain_description,
          category: VP.includes(x.category) ? x.category : 'operational',
          annual_cost: typeof x.annual_cost === 'number' ? x.annual_cost : null,
          annual_hours: typeof x.annual_hours === 'number' ? x.annual_hours : null,
          impact_text: x.impact_text || null, solution_component: x.solution_component || null,
          transcript_excerpt: x.transcript_excerpt || null,
          speaker_name: x.speaker_name || x.speaker || null,
          timestamp_in_call: x.timestamp_in_call || null,
          quote: x.quote || null,
          affected_team: x.affected_team || null,
          source: 'ai_transcript', source_conversation_id: conversation_id,
          deal_source_id: dsId, verified: false,
        });
        if (ok) ct++;
      }
      sum.pains = ct;
    }

    // ── RISKS ──
    if (p.risks_identified?.length) {
      let ct = 0;
      for (const r of p.risks_identified) {
        if (!r.risk_description) continue;
        const { data: ex } = await sb.from('deal_risks').select('id').eq('deal_id', deal_id).ilike('risk_description', `%${r.risk_description.substring(0,40)}%`).limit(1);
        if (ex?.length) continue;
        await safeInsertNoReturn(sb, 'deal_risks', { deal_id, risk_description: r.risk_description, category: VR.includes(r.category) ? r.category : 'deal', severity: VS.includes(r.severity) ? r.severity : 'medium', source: 'ai_transcript', source_conversation_id: conversation_id, status: 'open' });
        ct++;
      }
      sum.risks = ct;
    }

    // ── FLAGS ──
    if (p.flags?.length) {
      let ct = 0;
      for (const f of p.flags) {
        if (!f.description) continue;
        const { data: ex } = await sb.from('deal_flags').select('id').eq('deal_id', deal_id).ilike('description', `%${f.description.substring(0,40)}%`).limit(1);
        if (ex?.length) continue;
        await safeInsertNoReturn(sb, 'deal_flags', { deal_id, flag_type: f.flag_type === 'green' ? 'green' : 'red', description: f.description, category: VF.includes(f.category) ? f.category : 'custom', source: 'ai_transcript', source_conversation_id: conversation_id });
        ct++;
      }
      sum.flags = ct;
    }

    // ── COMPELLING EVENTS (with source linkage) ──
    if (p.compelling_events?.length) {
      let ct = 0;
      for (const e of p.compelling_events) {
        if (!e.event_description) continue;
        const { data: ex } = await sb.from('compelling_events').select('id').eq('deal_id', deal_id).ilike('event_description', `%${e.event_description.substring(0,40)}%`).limit(1);
        if (ex?.length) continue;
        const dsId = await insertDealSource(sb, {
          deal_id, source_origin: 'transcript', field_category: 'compelling_event',
          field_name: e.event_description.substring(0, 200), confidence: 'mentioned',
          summary: e.event_description, conversation_id,
          speaker: e.speaker || null, quote: e.quote || e.transcript_excerpt || null,
          call_date: conv.call_date || null, call_type: conv.call_type || null,
          timestamp_in_call: e.timestamp_in_call || null,
        });
        const ok = await safeInsertNoReturn(sb, 'compelling_events', {
          deal_id, event_description: e.event_description,
          event_date: e.event_date && /^\d{4}-\d{2}-\d{2}$/.test(e.event_date) ? e.event_date : null,
          strength: VST.includes(e.strength) ? e.strength : 'medium',
          impact: e.impact || null,
          transcript_excerpt: e.transcript_excerpt || null,
          speaker: e.speaker || null,
          timestamp_in_call: e.timestamp_in_call || null,
          quote: e.quote || null,
          source: 'ai_transcript', source_conversation_id: conversation_id,
          deal_source_id: dsId, verified: false,
        });
        if (ok) ct++;
      }
      sum.events = ct;
    }

    // ── CATALYSTS (with source linkage + strict definition enforcement) ──
    if (p.catalysts?.length) {
      let ct = 0;
      for (const c of p.catalysts) {
        if (!c.catalyst) continue;
        // Require source linkage — skip fabricated catalysts
        if (!c.transcript_excerpt && !c.quote) {
          console.log('Skipping unsourced catalyst:', c.catalyst);
          continue;
        }
        const { data: ex } = await sb.from('business_catalysts').select('id').eq('deal_id', deal_id).ilike('catalyst', `%${c.catalyst.substring(0,40)}%`).limit(1);
        if (ex?.length) continue;
        const dsId = await insertDealSource(sb, {
          deal_id, source_origin: 'transcript', field_category: 'business_catalyst',
          field_name: c.catalyst.substring(0, 200), confidence: 'mentioned',
          summary: c.catalyst, conversation_id,
          speaker: c.speaker || null, quote: c.quote || c.transcript_excerpt || null,
          call_date: conv.call_date || null, call_type: conv.call_type || null,
          timestamp_in_call: c.timestamp_in_call || null,
        });
        const ok = await safeInsertNoReturn(sb, 'business_catalysts', {
          deal_id, catalyst: c.catalyst,
          category: c.category || 'custom',
          urgency: c.urgency || 'medium',
          transcript_excerpt: c.transcript_excerpt || null,
          speaker: c.speaker || null,
          timestamp_in_call: c.timestamp_in_call || null,
          quote: c.quote || null,
          source: 'ai_transcript', source_conversation_id: conversation_id,
          deal_source_id: dsId, verified: false,
        });
        if (ok) ct++;
      }
      sum.catalysts = ct;
    }

    // ── DECISION CRITERIA ──
    if (p.decision_criteria?.length) {
      let ct = 0;
      for (const dc of p.decision_criteria) {
        if (!dc.criterion) continue;
        const { data: ex } = await sb.from('deal_decision_criteria').select('id').eq('deal_id', deal_id).ilike('criterion', `%${dc.criterion.substring(0,40)}%`).limit(1);
        if (ex?.length) continue;
        await safeInsertNoReturn(sb, 'deal_decision_criteria', { deal_id, criterion: dc.criterion, importance: ['high','medium','low'].includes(dc.importance) ? dc.importance : 'medium', our_position: ['strong','neutral','weak'].includes(dc.our_position) ? dc.our_position : 'neutral', notes: dc.notes || null, source: 'ai_transcript', source_conversation_id: conversation_id });
        ct++;
      }
      sum.criteria = ct;
    }

    // ── SYSTEMS ──
    if (p.systems_mentioned?.length) {
      for (const s of p.systems_mentioned) {
        if (!s.system_name) continue;
        const { data: ex } = await sb.from('company_systems').select('id,confirmed').eq('deal_id', deal_id).ilike('system_name', `%${s.system_name}%`).limit(1);
        if (ex?.length) {
          if (s.confirmed) await sb.from('company_systems').update({ confirmed: true, is_current: s.is_current !== false, is_needed: s.is_needed || false, notes: `Confirmed ${conv.call_date}` }).eq('id', ex[0].id);
        } else {
          await safeInsertNoReturn(sb, 'company_systems', { deal_id, system_name: s.system_name, system_category: VSY.includes(s.system_category) ? s.system_category : 'other', confidence: s.confirmed ? 'high' : 'medium', confirmed: s.confirmed || false, is_current: s.is_current !== false, is_needed: s.is_needed || false, notes: `From call ${conv.call_date}` });
        }
      }
      sum.systems = p.systems_mentioned.length;
    }

    // ── CONTACTS ──
    if (p.contacts_mentioned?.length) {
      let skip = 0;
      for (const c of p.contacts_mentioned) {
        if (!c.name) continue;
        const parts = c.name.trim().split(/\s+/);
        const ln = parts.length > 1 ? parts[parts.length-1] : parts[0];
        if (internalLastNames.has(ln.toLowerCase())) { skip++; continue; }
        const { data: ex } = await sb.from('contacts').select('id').eq('deal_id', deal_id).ilike('name', `%${ln}%`).limit(1);
        if (ex?.length) {
          const u: any = {};
          if (c.title) u.title = c.title;
          if (c.role_in_deal) u.role_in_deal = c.role_in_deal;
          if (c.department) u.department = c.department;
          if (VA.includes(c.alignment_status)) u.alignment_status = c.alignment_status;
          if (c.alignment_notes) u.alignment_notes = c.alignment_notes;
          if (Object.keys(u).length) await sb.from('contacts').update(u).eq('id', ex[0].id);
        } else {
          await safeInsertNoReturn(sb, 'contacts', { deal_id, name: c.name, title: c.title || null, role_in_deal: c.role_in_deal || 'Unknown', department: c.department || null, alignment_status: VA.includes(c.alignment_status) ? c.alignment_status : 'unknown', alignment_notes: c.alignment_notes || null, notes: 'Source: transcript' });
        }
      }
      sum.contacts = p.contacts_mentioned.length;
      if (skip) sum.contacts_skipped_internal = skip;
    }

    // ── COMMITMENTS ──
    if (p.commitments?.length) {
      const { data: cats } = await sb.from('categories').select('id,name');
      for (const t of p.commitments) {
        if (!t.title) continue;
        const cat = cats?.find((c: any) => c.name.toLowerCase() === (t.category||'').toLowerCase());
        await safeInsertNoReturn(sb, 'tasks', { deal_id, conversation_id, title: t.title, category_id: cat?.id || null, priority: t.priority || 'medium', notes: t.notes || null, committed_by: t.committed_by === 'prospect' ? 'prospect' : 'rep', committed_by_name: t.committed_by_name || null, owner: t.committed_by === 'prospect' ? (t.committed_by_name || 'Prospect') : (rep?.full_name || null), rep_email: rep?.email || null, rep_name: rep?.full_name || null, auto_generated: true });
      }
      sum.commitments = p.commitments.length;
    }

    // ── DEAL UPDATES ──
    if (p.deal_updates) {
      const du = p.deal_updates; const au: any = {};
      for (const f of ['champion','economic_buyer','budget','current_spend','decision_process','decision_method','quantified_pain','business_impact','driving_factors','ideal_solution','integrations_needed','timeline_drivers','exec_alignment']) {
        if (du[f] && du[f] !== 'Unknown') au[f] = du[f];
      }
      if (Object.keys(au).length) await sb.from('deal_analysis').update(au).eq('deal_id', deal_id);
    }

    // ── CALL ANALYSIS ──
    if (p.call_analysis) {
      const ca = p.call_analysis;
      try {
        await sb.from('call_analyses').insert({ conversation_id, deal_id, coach_id: cid, overall_score: typeof ca.overall_score === 'number' ? Math.min(100, Math.max(0, ca.overall_score)) : null, discovery_depth_score: ca.score_discovery_depth || null, curiosity_score: ca.score_curiosity || null, challenger_score: ca.score_challenger || null, value_articulation_score: ca.score_value_articulation || null, next_steps_quality_score: ca.score_next_steps_quality || null, objection_handling_score: ca.score_objection_handling || null, independently_wealthy_score: ca.score_independently_wealthy || null, independently_wealthy_reason: ca.independently_wealthy_reason || null, top_deal_killers: ca.top_3_deal_killers || [], top_ways_to_win: ca.top_3_ways_to_win || [], strengths: ca.strengths || null, improvements: ca.improvements || null, methodology_gaps: ca.methodology_gaps || null, questions_asked: ca.questions_asked || [], questions_should_have_asked: ca.questions_should_have_asked || [], questions_for_next_call: ca.questions_for_next_call || [], scored_by: 'ai' });
        sum.call_analysis = true;
      } catch (e) { console.log('call_analyses error:', e); sum.call_analysis_error = String(e); }
    }

    // ── SCORE SUGGESTIONS ──
    if (p.score_suggestions) {
      const su: any = {};
      if (typeof p.score_suggestions.fit_score === 'number') su.fit_score = Math.min(10, Math.max(0, p.score_suggestions.fit_score));
      if (typeof p.score_suggestions.deal_health_score === 'number') su.deal_health_score = Math.min(10, Math.max(0, p.score_suggestions.deal_health_score));
      if (Object.keys(su).length) await sb.from('deals').update(su).eq('id', deal_id);
    }

    // ── RUNNING COSTS ──
    try {
      const { data: allPains } = await sb.from('deal_pain_points').select('annual_cost,annual_hours').eq('deal_id', deal_id);
      if (allPains?.length) {
        const tc = allPains.reduce((s: number, pp: any) => s + (Number(pp.annual_cost) || 0), 0);
        const th = allPains.reduce((s: number, pp: any) => s + (Number(pp.annual_hours) || 0), 0);
        if (tc || th) await sb.from('deal_analysis').update({ running_problem_cost_dollars: tc || null, running_problem_cost_hours: th || null }).eq('deal_id', deal_id);
      }
    } catch (e) { console.log('Cost error:', e); }

    // ── AI MEMORY ──
    if (memoryEnabled && p.memory_observations?.length) {
      let memCt = 0;
      for (const m of p.memory_observations) {
        if (!m.content) continue;
        let contactId = null;
        if (m.related_contact_name) {
          const { data: ct } = await sb.from('contacts').select('id').eq('deal_id', deal_id).ilike('name', `%${m.related_contact_name}%`).limit(1);
          if (ct?.length) contactId = ct[0].id;
        }
        await safeInsertNoReturn(sb, 'ai_memory', { deal_id, org_id: rep?.org_id || null, memory_type: VM.includes(m.memory_type) ? m.memory_type : 'coaching_observation', content: m.content, priority: VS.includes(m.priority) ? m.priority : 'medium', source_type: 'transcript', source_conversation_id: conversation_id, source_ai_log_id: log?.id || null, related_contact_id: contactId, active: true, resolved: false });
        memCt++;
      }
      sum.memories_created = memCt;
      const resolvedIds: string[] = [];
      for (const m of p.memory_observations) { if (m.resolved_memory_ids?.length) resolvedIds.push(...m.resolved_memory_ids); }
      if (resolvedIds.length) {
        const validIds = resolvedIds.filter(id => /^[0-9a-f-]{36}$/.test(id));
        if (validIds.length) {
          await sb.from('ai_memory').update({ resolved: true, resolved_at: new Date().toISOString(), resolved_reason: 'Addressed on call' }).in('id', validIds);
          sum.memories_resolved_by_ai = validIds.length;
        }
      }
      if (memories.length) {
        let autoResolved = 0;
        for (const mem of memories) {
          if (mem.memory_type === 'commitment_tracking') {
            const kw = mem.content.substring(0,40).replace(/[^a-zA-Z ]/g,'').trim();
            if (!kw) continue;
            const { data: done } = await sb.from('tasks').select('id').eq('deal_id', deal_id).eq('completed', true).ilike('title', `%${kw.substring(0,30)}%`).limit(1);
            if (done?.length) {
              await sb.from('ai_memory').update({ resolved: true, resolved_at: new Date().toISOString(), resolved_reason: 'Linked task completed' }).eq('id', mem.id);
              autoResolved++;
            }
          }
        }
        if (autoResolved) sum.memories_auto_resolved = autoResolved;
        try { await sb.rpc('increment_memory_surfaced', { memory_ids: memories.map(m => m.id) }); } catch (e) {}
      }
    }

    // ── ICP SCORING ──
    if (cid) {
      try {
        const { data: icpResult } = await sb.rpc('compute_icp_score', { p_deal_id: deal_id, p_coach_id: cid });
        if (icpResult?.score != null) sum.icp_score = icpResult.score;
      } catch (e) { console.log('ICP score error (non-fatal):', e); }
    }

    // ── CREDITS ──
    try {
      if (rep?.org_id) await sb.rpc('deduct_credits', { p_org_id: rep.org_id, p_user_id: deal.rep_id, p_amount: 3, p_type: 'transcript', p_description: `Transcript: ${deal.company_name} (${conv.call_type})`, p_reference_id: log?.id || null });
    } catch (e) { console.log('Credit error:', e); }

    // ── TRIGGER EMBED-CHUNKS ──
    try {
      // ingest-deal-knowledge: chunks this conversation + refreshes company_profile/deal_analysis chunks
      fetch(`${SUPABASE_URL}/functions/v1/ingest-deal-knowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'apikey': SUPABASE_SERVICE_ROLE_KEY }, body: JSON.stringify({ deal_id }) }).catch(e => console.log('ingest error:', e));
    } catch (e) {}

    await ulog(sb, log?.id, 'completed', null, t0, usage, sum);
    return jr({ success: true, version: 'v31', summary: sum, commitments_created: sum.commitments || 0, contacts_found: sum.contacts || 0, memories_created: sum.memories_created || 0, icp_score: sum.icp_score || null });

  } catch (e: any) {
    console.error('process-transcript v31 error:', e);
    return jr({ error: `v31: ${e.message}` }, 500);
  }
});

async function ulog(sb: any, id: string | null, s: string, e: string | null, t0: number, u?: any, sum?: any) {
  if (!id) return;
  try { await sb.from('ai_response_log').update({ status: s, error_message: e, processing_time_ms: Date.now()-t0, prompt_tokens: u?.input_tokens || null, completion_tokens: u?.output_tokens || null, total_tokens: (u?.input_tokens || 0) + (u?.output_tokens || 0) || null, extraction_summary: sum || {} }).eq('id', id); } catch (e) { console.log('Log error:', e); }
}
