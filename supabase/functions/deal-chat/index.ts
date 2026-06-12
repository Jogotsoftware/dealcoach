import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deal-chat v23
// v23: Auto deal-context classifier. Haiku reads the user's message against the
//      rep's open deals and emits one of four branches:
//      A) high-confidence + no/matching focus → auto-focus the detected deal,
//         proceed with main response, return auto_focused indicator.
//      B) high-confidence + different deal already focused → return a
//         switch_suggestion card payload, NO main Claude call. Frontend
//         re-fires after user picks.
//      C) medium confidence → return a clarifying_question card payload,
//         NO main Claude call.
//      D) low / null → proceed normally.
//      Skip rules: message < 20 chars, recent continuation on same deal,
//      rep has no open deals, or cross_deal_question flag set by frontend.
//      Audit lives in assembled_prompt_versions sidecar `auto_focus_payload`.
// v22: Reports off by default. Reports were over-firing and showing raw DB
//      field names. Until the proper fix lands (prompt tightening, label
//      dictionary), org-level kill switch organizations.enable_chat_reports
//      defaults FALSE and gates the entire reports surface — when off we
//      skip schema introspection, skip reportToolGuide injection in the
//      system prompt, and drop the build_report tool from the tools array.
//      Frontend has a defense-in-depth guard for stray emissions.
// v21: Web search toggle — when profiles.chat_web_search_enabled AND
//      organizations.allow_chat_web_search are BOTH true, fires a Haiku
//      classifier in parallel with context build. If the classifier returns
//      needs_web_search=true, calls Perplexity Sonar Pro with the suggested
//      query, injects a WEB SEARCH RESULTS block before RELEVANT EXCERPTS,
//      charges chat_web_search credit (3) instead of chat (1). Citations are
//      written to deal_sources with source_origin='ai_web_search' (deal
//      context only). Full audit trail persisted to
//      assembled_prompt_versions.web_search_payload. Perplexity failure is
//      caught and degrades to no-web-search response with chat credit and an
//      error_kind='perplexity_failed' audit row — never blocks the response.
// v20: Context expansion — Lux now reads four additional memory layers that
//      the schema already supported but the prior version ignored:
//      1. ai_memory deal-scoped — durable facts (corrections, observations,
//         SME answers) keyed to this deal.
//      2. ai_memory org-scoped (deal_id IS NULL) — org-wide policy / SME
//         knowledge that applies across all deals. Phase A made deal_id
//         nullable; the partial index idx_ai_memory_org_scoped optimizes this.
//      3. deal_retrospectives from similar closed deals via the
//         get_similar_deal_retrospectives RPC (industry + competitor scored).
//      4. org_ai_patterns — winning patterns aggregated across closed deals
//         (read path wired now; populated by a separate nightly compute job).
//      Adds a MEMORY PRECEDENCE directive at the top of the assembled prompt
//      so the model knows which layer to trust when they conflict.
//      Adds correction_payload handler: when the rep submits a "Correct this"
//      from the chat UI, fires Haiku fact-extraction → writes an ai_memory
//      row with memory_type='correction' AND auto-creates a paired
//      sme_questions validation row (linked via ai_correction_memory_id).
//      Adds substring-match surfacing tracker — increments times_surfaced /
//      last_surfaced_at on any ai_memory row whose first 30 chars appear in
//      the response text.
// v19: RAG over deal_context_chunks. For deal-context queries we embed the
//      user's message via OpenAI text-embedding-3-small and pull the top
//      semantically-relevant excerpts (transcripts, research, pain points,
//      flags) from pgvector. Injected as a "RELEVANT EXCERPTS" section so
//      the AI can quote the actual language the prospect used instead of
//      paraphrasing the summary dump.
// v18: unified assistant + PRODUCT_SOP + page_context.
// v17: schema introspection via introspect_reportable_columns() RPC.

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jsonResponse(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }); }
function clean(v: any): string { if (!v || v === 'Unknown') return 'Not available'; return String(v); }

// Per-org gate for the v22/v23 Lux chat features (web search, auto-focus
// classifier, correction handler, new memory layers, reports kill switch
// behavior, SME citation prompting). Demo orgs run the new paths; other
// orgs fall through to baseline v19 behavior so a parallel team can ship
// their own deal-chat changes without conflict.
//   0acebff8 = Intacct - Direct - NA
//   c8a7ea52 = Sage Intacct — Demo
const DEMO_ORG_IDS = new Set([
  '0acebff8-8827-4984-b478-cbcad404539d',
  'c8a7ea52-42b8-4b66-9d38-91c9b1dda883',
]);
function isDemoOrgId(id: string | null | undefined): boolean { return !!id && DEMO_ORG_IDS.has(id); }

const REPORTABLE_TABLES: Record<string, { join: string | null; multi: boolean }> = {
  deals: { join: null, multi: false },
  deal_analysis: { join: 'deal_id', multi: false },
  company_profile: { join: 'deal_id', multi: false },
  deal_sizing: { join: 'deal_id', multi: false },
  contacts: { join: 'deal_id', multi: true },
  tasks: { join: 'deal_id', multi: true },
  conversations: { join: 'deal_id', multi: true },
  compelling_events: { join: 'deal_id', multi: true },
  business_catalysts: { join: 'deal_id', multi: true },
  deal_competitors: { join: 'deal_id', multi: true },
  deal_flags: { join: 'deal_id', multi: true },
  deal_risks: { join: 'deal_id', multi: true },
  deal_pain_points: { join: 'deal_id', multi: true },
  company_systems: { join: 'deal_id', multi: true },
  deal_sources: { join: 'deal_id', multi: true },
  call_analyses: { join: 'deal_id', multi: true },
  deal_scores: { join: 'deal_id', multi: true },
};

let schemaCache: { fetchedAt: number; schema: Record<string, Record<string, { type: string }>> } | null = null;

function normaliseType(pgType: string): string {
  const t = (pgType || '').toLowerCase();
  if (t.includes('int') || t === 'numeric' || t === 'double precision' || t === 'real' || t === 'bigint' || t === 'smallint') return 'number';
  if (t === 'boolean') return 'boolean';
  if (t === 'date' || t === 'timestamp without time zone' || t === 'timestamp with time zone' || t === 'time') return 'date';
  if (t === 'jsonb' || t === 'json') return 'jsonb';
  if (t === 'array' || t.endsWith('[]')) return 'array';
  if (t === 'uuid') return 'uuid';
  return 'text';
}

async function getSchema(sb: any): Promise<Record<string, Record<string, { type: string }>>> {
  if (schemaCache && (Date.now() - schemaCache.fetchedAt) < 10 * 60 * 1000) return schemaCache.schema;
  const schema: Record<string, Record<string, { type: string }>> = {};
  try {
    const { data, error } = await sb.rpc('introspect_reportable_columns');
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        const tbl = row.table_name; const col = row.column_name;
        if (!REPORTABLE_TABLES[tbl]) continue;
        if (!schema[tbl]) schema[tbl] = {};
        schema[tbl][col] = { type: normaliseType(row.data_type) };
      }
    } else if (error) { console.log('introspect RPC error:', error.message); }
  } catch (e: any) { console.log('introspect RPC exception:', e?.message); }

  for (const tbl of Object.keys(REPORTABLE_TABLES)) {
    if (schema[tbl] && Object.keys(schema[tbl]).length > 0) continue;
    try {
      const { data: rows, error: e } = await sb.from(tbl).select('*').limit(1);
      if (e || !rows || rows.length === 0) continue;
      const row = rows[0];
      const tblSchema: Record<string, { type: string }> = {};
      for (const k of Object.keys(row)) {
        const v = row[k];
        let type = 'text';
        if (typeof v === 'number') type = 'number';
        else if (typeof v === 'boolean') type = 'boolean';
        else if (v && /^\d{4}-\d{2}-\d{2}/.test(String(v))) type = 'date';
        else if (Array.isArray(v)) type = 'array';
        else if (v !== null && typeof v === 'object') type = 'jsonb';
        tblSchema[k] = { type };
      }
      schema[tbl] = tblSchema;
    } catch {}
  }

  schemaCache = { fetchedAt: Date.now(), schema };
  return schema;
}

function formatSchemaForPrompt(schema: Record<string, Record<string, { type: string }>>): string {
  const lines: string[] = [];
  for (const [table, cols] of Object.entries(schema)) {
    const meta = REPORTABLE_TABLES[table];
    if (!meta) continue;
    const label = meta.join ? `(join via ${meta.join}${meta.multi ? ', multi' : ''})` : '(base)';
    const fieldLine = Object.entries(cols).map(([k, v]) => `${k}:${v.type}`).join(', ');
    lines.push(`- ${table} ${label}: ${fieldLine}`);
  }
  return lines.join('\n');
}

function findFieldLocations(schema: Record<string, Record<string, { type: string }>>, field: string): string[] {
  const locations: string[] = [];
  for (const [table, cols] of Object.entries(schema)) if (cols[field]) locations.push(table);
  return locations;
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function recordAssembledPrompt(sb: any, coachId: string | null, callType: string | null, action: string, content: string, webSearchPayload?: any | null, autoFocusPayload?: any | null) {
  try {
    const hash = await sha256Hex(content);
    const { data: existing } = await sb.from('assembled_prompt_versions').select('id, use_count').eq('prompt_hash', hash).limit(1).maybeSingle();
    if (existing?.id) {
      const update: any = { last_used_at: new Date().toISOString(), use_count: (existing.use_count || 0) + 1 };
      // v21: stamp the web_search_payload on every use so audit always shows
      // the most recent classifier/Perplexity activity for this assembled prompt.
      if (webSearchPayload) update.web_search_payload = webSearchPayload;
      // v23: same idea for auto_focus_payload.
      if (autoFocusPayload) update.auto_focus_payload = autoFocusPayload;
      await sb.from('assembled_prompt_versions').update(update).eq('id', existing.id);
    } else {
      await sb.from('assembled_prompt_versions').insert({ prompt_hash: hash, coach_id: coachId, call_type: callType, action, assembled_content: content, web_search_payload: webSearchPayload || null, auto_focus_payload: autoFocusPayload || null });
    }
  } catch (e) { console.log('recordAssembledPrompt error:', e); }
}

// ---------------------------------------------------------------------------
// RAG helpers — embed the user's message and pull top-K relevant chunks from
// deal_context_chunks. Requires OPENAI_API_KEY. Fails silent (returns '') if
// the API is unavailable or returns an empty result — chat still works, just
// without the precision boost.
// ---------------------------------------------------------------------------
async function embedQuery(text: string): Promise<number[] | null> {
  if (!OPENAI_API_KEY) return null;
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text.slice(0, 8000) }),
    });
    if (!response.ok) { console.log('embed error:', response.status); return null; }
    const data = await response.json();
    return data?.data?.[0]?.embedding || null;
  } catch (e: any) { console.log('embed exception:', e?.message); return null; }
}

async function fetchRelevantExcerpts(sb: any, dealId: string, query: string): Promise<string> {
  const embedding = await embedQuery(query);
  if (!embedding) return '';
  try {
    const { data, error } = await sb.rpc('search_deal_chunks', {
      p_deal_id: dealId,
      p_embedding: JSON.stringify(embedding),
      p_match_count: 8,
      p_match_threshold: 0.35,
    });
    if (error) { console.log('search_deal_chunks error:', error.message); return ''; }
    if (!Array.isArray(data) || data.length === 0) return '';
    const lines = data.map((r: any, i: number) => {
      const header = r.chunk_type === 'transcript'
        ? `[${i + 1}] transcript · ${r.speaker || 'unknown'} · ${r.call_type || 'call'} ${r.call_date ? '· ' + r.call_date : ''} (similarity ${r.similarity?.toFixed(2)})`
        : `[${i + 1}] ${r.chunk_type} (similarity ${r.similarity?.toFixed(2)})`;
      const body = String(r.content || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      return `${header}\n${body}`;
    });
    return lines.join('\n\n');
  } catch (e: any) { console.log('RAG exception:', e?.message); return ''; }
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

const DEAL_TOOLS = [
  { name: 'create_task', description: 'Create a task/action item for this deal.', input_schema: { type: 'object', properties: { title: { type: 'string' }, priority: { type: 'string', enum: ['high', 'medium', 'low'] }, due_days: { type: 'number' }, notes: { type: 'string' } }, required: ['title'] } },
  { name: 'update_deal_field', description: 'Update a field on deals, deal_analysis, or company_profile.', input_schema: { type: 'object', properties: { table: { type: 'string', enum: ['deals', 'deal_analysis', 'company_profile'] }, field: { type: 'string' }, value: { type: 'string' } }, required: ['table', 'field', 'value'] } },
  { name: 'add_contact', description: 'Add a new contact to this deal.', input_schema: { type: 'object', properties: { name: { type: 'string' }, title: { type: 'string' }, email: { type: 'string' }, role_in_deal: { type: 'string' }, is_champion: { type: 'boolean' }, is_economic_buyer: { type: 'boolean' } }, required: ['name'] } },
  { name: 'add_risk', description: 'Add a risk to this deal.', input_schema: { type: 'object', properties: { risk_description: { type: 'string' }, category: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] } }, required: ['risk_description'] } },
];

const REPORT_TOOL = {
  name: 'build_report',
  description: 'Draft and run a data report. Always use when the user asks ANY data question. The server executes the query (with count) and returns sample rows so you can verify the draft is sensible before presenting. If the field you need lives on a related table (e.g. annual_cost is on deal_pain_points, NOT deals), you MUST use a {join, field} object and include that table in included_relations.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      report_type: { type: 'string', enum: ['tabular', 'summary', 'matrix'] },
      base_entity: { type: 'string' },
      included_relations: { type: 'array', items: { type: 'string' } },
      fields: { type: 'array', items: {} },
      filters: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, operator: { type: 'string', enum: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'not_like', 'is_null', 'not_null', 'in', 'not_in'] }, value: {}, join: { type: 'string' } }, required: ['field', 'operator'] } },
      filter_expression: { type: 'string' },
      groups: { type: 'array', items: { type: 'string' } },
      pivot_column: { type: 'string' },
      summary_aggregate: { type: 'object', properties: { type: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] }, field: { type: 'string' } } },
      column_totals: { type: 'object' },
      show_details: { type: 'boolean' },
      order_by: { type: 'string' },
      order_dir: { type: 'string', enum: ['asc', 'desc'] },
      limit: { type: 'number' },
    },
    required: ['report_type', 'base_entity'],
  },
};

// ---------------------------------------------------------------------------
// PRODUCT_SOP — the help library. Compact step-by-step guidance for every major
// workflow. The AI should use it to walk users through tasks when they ask
// "how do I...?" or when page_context tells us they are on a page where they
// are likely trying to accomplish one of these flows.
// ---------------------------------------------------------------------------
const PRODUCT_SOP = `
# REVENUE INSTRUMENTS / DEALCOACH — PRODUCT SOP (internal reference)

## Top-level navigation
- Left sidebar is the main nav. Hover to expand. Sections: Workspace (Home/Pipeline, Coach, Reports, Team, Settings), Admin (Organization, Widgets — admin only), Super Admin (platform admin only).
- The blue chat button (bottom-right, that's me) follows the user everywhere. It auto-detects what page they're on.

## Create a new deal
1. Click "+ New Deal" on the pipeline (/). Or navigate to /deal/new.
2. Enter company name, stage, value, close date, and assign a rep.
3. On save, research fires automatically (Perplexity + Apollo + logo lookup) and company_profile + deal_analysis are auto-created.

## Upload a transcript / add a call
1. Open the deal → Transcripts tab.
2. Click "Add transcript" → paste text, upload a file, or paste a Fathom/Gong URL.
3. Set call_type (Discovery / Demo / Technical / Decision / etc.) and call_date.
4. AI processing fires within seconds — tasks, contacts, catalysts, events, pain points, flags, and scores all get extracted.
5. Review the extracted items. Each should have a source citation linking back to the transcript excerpt.

## Review AI extraction / fix a miss
- Transcripts tab: click a call → CallDetail view shows the full transcript, AI summary, coaching score.
- If something is wrong, thumbs down the specific extracted item and pick a reason. That feeds back into the learning loop.

## Manage tasks on a deal
- Deal → Tasks tab. Check the box to complete. Priority badge is color-coded.
- AI-generated tasks have a small sparkle icon. Editing or completing them tracks \`ai_suggestion_tracking\` silently.
- Bulk-select tasks to complete / delete in one action.

## Build or customize your coach
- Settings → "My Coach" — pick which coach is active for you.
- /coach → Coach Admin (admin role required). Tabs: Prompts, Documents, Scoring, MSP Templates, Email Templates, ICP, Personas, Flags, Extraction Rules.
- /coach/builder → 8-step wizard that walks through company, market, value props, buyers, process. End writes to \`coaches\` + \`coach_icp\`.
- Assembled prompt layers: Platform Core (locked) → Methodology baseline (locked) → Coach context (editable) → ICP context (editable). Changes to the coach cascade into every AI action within 10 min.

## Write an email with AI
- Deal → any contact → "Draft email". Choose template (cold outreach / follow-up / recap / reopen).
- The AI uses deal context + the email template prompt. Edit inline, then send via your own email client.

## Build a report
- /reports → click "+ New report" (or just ask me in chat — I can draft and run one).
- Top bar: name + base table pill + Save / Save & Run / Run / Close + Auto-preview toggle.
- Left sidebar has two tabs: Outline (base table, joined tables, fields, groups, summary/pivot), Filters (numbered filters + optional boolean expression like "1 AND (2 OR 3)").
- Report types:
  - **Tabular** — flat list of rows.
  - **Summary** — rows grouped by one or more fields. Can show details or just totals.
  - **Matrix** — pivot. Rows grouped by one field, columns by another, cell = aggregate.
- Multi-table reports: toggle included_relations (Tasks, Contacts, Pain Points, Competitors, etc.) — any field from a joined table shows up in the field list.
- Drag fields from the sidebar straight onto the preview. Drag column borders to resize. Drag a column header to the drop zone to group by it (Summary/Matrix).
- Per-column Σ menu on the header sets aggregate (count/sum/avg/min/max) and toggles "Show in footer" for column totals.
- Save to \`saved_reports\`. Favorite or file into folders from the Reports list.

## Build a widget / dashboard
- /admin/widgets → Widget Builder (admin). Pick a data source (a saved report, a raw table, or a custom query) and a visualization (KPI, bar, line, table).
- Add to the Home/Pipeline page via the widget layout grid or drop it into any dashboard.

## Manage the team & quota
- Settings → Team. Admins invite teammates by email, set roles, assign quotas.
- CSV/Excel quota upload is under Settings → Quota. Download the template, fill in monthly targets, upload.

## MSP (Mutual Success Plan) / DealRoom
- Deal → MSP tab (or /deal/:id/msp). Stages left-to-right: Discovery → Eval → Decision → Commit → Launch. Each stage has milestones + a completion %.
- "Share link" generates a public /msp/shared/:token URL for the buyer to see progress. They can't see internal fields.
- Coach Admin → MSP Templates section lets you prescribe default stage shapes for new deals.

## QuoteBuilder / Proposal
- Deal → Proposal tab → "New quote" opens QuoteEditor. Add line items from pricebook, set billing frequency, payment schedule, TCO.
- Proposal Builder assembles the cover page, value narrative, pricing table, and next steps into a shareable proposal page.

## Retrospective on a closed deal
- When you set a deal to closed_won / closed_lost / disqualified, a modal captures primary_reason + what_helped_hurt + key_lesson.
- The retrospective then auto-runs — AI evaluates prediction accuracy + rep execution and writes to \`deal_retrospectives\`.
- /deal/:id/retrospective shows the full analysis.

## Settings
- Profile, email signature, quota, active coach, preferences.
- Admins also see Organization (plan, members, billing), Integrations, Credits.

## Credits
- Every AI action (transcript analysis, research, email, chat, slides) debits credits. Cost is in \`credit_costs\`.
- Balance shown in the sidebar footer. Upgrade from Org Settings.

## Beta feedback
- Click the pencil icon in the chat header, or use the feedback modal that opens there. Writes to \`beta_feedback\`.

## Common questions I should answer directly
- "Where do I find X?" → Point to the left sidebar route.
- "Why is the AI wrong?" → Thumbs-down the specific output + pick a reason. Learning loop picks it up.
- "Can I export?" → Reports support CSV export via the Export button on the run view.
- "How do I share with my buyer?" → MSP share link or Proposal share link.
- "What's the difference between catalyst and compelling event?" → Catalyst = forces driving change in their business (funding, new exec, reg, system EOL). Compelling event = specific bad thing that happens if they don't act (dated, material). Pain points = day-to-day operational problems.
`;

// ---------------------------------------------------------------------------
// INTACCT_KNOWLEDGE — Sage Intacct product knowledge layer (publicly-documented
// facts only). Always injected so the assistant can map a prospect's stated
// needs to the right modules and position competitively — especially for the
// SC, who asks questions before/after the FDC. This is PRODUCT knowledge, not
// customer facts: never invent what THIS prospect said. Ground deal-specific
// claims in the transcripts/research in context; use this block for what Sage
// Intacct is and does.
// ---------------------------------------------------------------------------
const INTACCT_KNOWLEDGE = `
# SAGE INTACCT — PRODUCT KNOWLEDGE (reference)
Use this to map a prospect's requirements to the right capabilities and to position competitively. It describes the PRODUCT. For anything about THIS prospect, rely only on the deal context, transcripts, and research provided — never fabricate customer specifics.

## What it is
Sage Intacct is a cloud-native, best-in-class financial management and accounting platform for the mid-market. It is the AICPA's preferred provider of financial applications. Strength is depth of financials + automation + real-time visibility, delivered as true multi-tenant SaaS.

## Multi-dimensional General Ledger (the core differentiator)
Instead of a long, segmented chart of accounts, transactions are tagged with DIMENSIONS — Entity, Location, Department, Project, Customer, Vendor, Employee, Item, Class, plus custom dimensions. This keeps the COA short while enabling reporting/slicing by any dimension or combination, in real time, without rebuilding the COA.

## Core modules
- General Ledger, Accounts Payable, Accounts Receivable, Cash Management, Order Management, Purchasing — the financial core, with automation and approval workflows.
- Multi-Entity & Global Consolidations: real-time consolidation across many entities and currencies; automatic inter-entity transactions and eliminations; faster close. (Maps to "we consolidate in spreadsheets / close takes weeks.")
- Project Accounting / PSA: project costing, time & expense, project billing, resource and utilization tracking. (Maps to project-based / services businesses.)
- Revenue Recognition: ASC 606 / IFRS 15 compliant; contract and subscription billing. (Maps to SaaS / subscription / complex rev-rec.)
- Spend Management, Dynamic Allocations, Fixed Assets, Inventory (light), Sage Intacct Planning (budgeting & forecasting).
- Reporting & Dashboards: real-time, role-based operational + financial dashboards; multi-book accounting (e.g., GAAP + tax + management books).
- Platform: open REST API and a marketplace; native Salesforce integration; integrations with ADP, expense and AP-automation tools, etc.

## Typical buyer triggers (what to listen for)
Outgrowing QuickBooks; multi-entity consolidation done manually in Excel; slow/painful month-end close; no real-time or dimensional visibility; audit/compliance pressure; subscription or rev-rec complexity; M&A adding entities; need to scale without adding headcount.

## Competitive positioning (high level, neutral, public)
- vs QuickBooks: scalability, multi-entity, automation, controls/audit trail, dimensional reporting.
- vs NetSuite: best-of-breed depth of financials and the dimensional GL vs an all-in-one suite; often a faster close and cleaner reporting; NetSuite leans broader ERP (e.g., heavier inventory/e-commerce). Position on the buyer's actual priorities — don't disparage.
Always tie positioning back to what the prospect actually said they need.
`;

// POWER_OF_7 — the "Power of 7" value framework. Awaiting authoritative content
// from the customer; injected only when non-empty so we never ship a half-empty
// section. Drop the framework text here and redeploy to make it live.
const POWER_OF_7 = '';

// ---------------------------------------------------------------------------
// System prompts — unified assistant. The chatbot always gets methodology +
// PRODUCT_SOP + schema + (if on a deal page) deal context. page_context is
// appended as a route-specific hint.
// ---------------------------------------------------------------------------
const UNIFIED_SYSTEM_PROMPT = `You are the Lumen assistant — an always-on AI coach embedded in Lumen. You help sales reps close more deals AND help them use the product.

WHAT YOU CAN SEE:
- The full database of the rep's deals, contacts, calls, tasks, scores, catalysts, pain points, flags, retrospectives.
- Their pipeline at a glance (all active deals, open tasks).
- The product itself — use the PRODUCT SOP below to walk them through any workflow.
- Their current page — use page_context to tailor advice ("since you're on the Coach Admin page, you can edit the assembled prompt here...").

HOW YOU OPERATE:
- Direct, concise, sourced. Bullets over paragraphs. Reference deal names, dates, exact quotes.
- For product how-to questions, walk them through step by step using PRODUCT_SOP. Reference the exact page/button.
- For methodology questions, ground answers in public-source frameworks (BANT, MEDDPICC, SPIN, Challenger, Solution Selling, Sandler, JOLT, Command of the Message). Be opinionated, but label methodology suggestions as guidance — never present them as facts about the deal.
- If a question is out of scope (something the product can't do yet), say so plainly and suggest they file beta feedback (pencil icon in the chat header).
- If the user seems stuck on a page, offer to guide them: "Want me to walk you through building your first report?"
- 1-3 sentences when possible. Long only when walking through multi-step flows.

KEY DEFINITIONS (never conflate):
- Business Catalyst = high-level force driving change (funding, exec hire, M&A, regulation, system EOL, strategic initiative). NOT operational pain.
- Compelling Event = specific dated bad-thing-if-no-change. Material consequence.
- Pain Point = day-to-day operational problem.
- ICP Fit = how well the account matches the coach's ICP config (score 0-100).
- Deal Health = composite signal of engagement + momentum + risk (score 0-10).

ANSWERING DISCIPLINE (STRICT — applies to every answer):
- Facts only. State something as true ONLY if it is in the deal context, transcripts, research, product knowledge, or a public-source framework given to you. Never guess, assume, extrapolate, or invent — above all about what THIS prospect said, what they need, or any number, date, name, or product capability.
- If you do not have it, say so plainly — e.g. "I don't have that in this deal's calls or research." Do NOT fill the gap with a plausible-sounding answer. When useful, name what would answer it (e.g. "that would come from the FDC transcript").
- Separate fact from guidance. Every deal/product fact must be sourced. Methodology or strategy suggestions are guidance — label them as such.
- Cite the source for each deal fact: call type + date + speaker, or the research source. Quote verbatim when the exact wording matters.
- Be concise and structured. Lead with the answer. Use short bullet points and bold titles/labels. No preamble, no filler, do not restate the question.
`;

// Demo-org-only directive: only injected for demo turns where the new memory
// layers / web search / SME citations actually flow into the assembled prompt.
// For other orgs this would describe sources that don't exist in their context.
const MEMORY_PRECEDENCE_INSTRUCTION = `
# MEMORY PRECEDENCE
When the answer involves a fact that could change over time, prefer in this order:
1. WEB SEARCH RESULTS (if present in this turn)
2. WHAT LUX REMEMBERS ABOUT THIS DEAL (deal-scoped corrections + observations + SME answers)
3. ORG-LEVEL FACTS (org-wide policy + SME-vetted answers)
4. LESSONS FROM SIMILAR DEALS (retrospectives — guidance, not gospel)
5. ACTIVE DEAL CONTEXT (current structured deal data)
6. RELEVANT EXCERPTS (semantic-search snippets)
Cite the layer you used when it matters: "Per a similar deal (Acme, lost March 2026)..." or
"Org policy (per SME Jane D)..." or "From the call on 4/22..."
`;

function reportToolGuide(schemaForPrompt: string): string {
  return `
# DATA REPORTING (build_report tool)
When the user asks a data question (counts, lists, groupings, cross-tabs, sums), CALL the build_report tool. The tool runs the query and returns the real total count + a few sample rows, so use that feedback to refine the draft before presenting.

HARD RULES:
1. A bare-string field (e.g. "company_name") MUST exist on base_entity.
2. A joined-table field MUST be { "join": "<table>", "field": "<field>" } AND that table MUST be in included_relations.
3. Filters work the same way.
4. Never invent a column. Scan the schema below before emitting.
5. If the server returns a schema_error, the response lists the correct table — re-draft using {join, field}.

WORKED EXAMPLE — "Deals with summed pain cost":
  annual_cost lives on deal_pain_points, NOT deals.
  Correct:
    { "base_entity": "deals", "report_type": "summary",
      "included_relations": ["deal_pain_points"],
      "fields": [ "company_name", "stage", { "join": "deal_pain_points", "field": "annual_cost", "label": "Pain Cost" } ],
      "groups": ["stage"],
      "summary_aggregate": { "type": "sum", "field": "deal_pain_points_annual_cost" }
    }

LIVE DATABASE SCHEMA (source of truth; do not reference any field not listed here):
${schemaForPrompt}

OPERATORS: eq, neq, gt, gte, lt, lte, like, not_like, is_null, not_null, in (comma-separated string), not_in.

DON'T call build_report for methodology, coaching, opinion, or product-help questions.
`;
}

function pageContextBlock(pageContext: any): string {
  if (!pageContext || typeof pageContext !== 'object') return '';
  const { path, page_name, hint } = pageContext;
  if (!page_name && !path) return '';
  return `\n# WHERE THE USER IS RIGHT NOW\npage: ${page_name || 'unknown'}\npath: ${path || ''}${hint ? `\ncontext: ${hint}` : ''}\nUse this to tailor product guidance. If they ask "how do I do this" without naming a flow, assume they mean something on this page.\n`;
}

function buildSystemPrompt(opts: {
  schemaBlock: string;
  dealContext: string;
  pipelineContext: string;
  pageContext: any;
  assembledCoachPrompt: string;
  ragExcerpts: string;
  whatLuxRemembers: string;
  orgFacts: string;
  similarDealLessons: string;
  orgPatterns: string;
  webSearchBlock: string;
  reportsEnabled: boolean;
  isDemoOrg: boolean;
}) {
  const parts: string[] = [];
  if (opts.assembledCoachPrompt) parts.push(opts.assembledCoachPrompt);
  parts.push(UNIFIED_SYSTEM_PROMPT);
  // Demo-org-only: MEMORY PRECEDENCE only makes sense when the new layers actually flow.
  if (opts.isDemoOrg) parts.push(MEMORY_PRECEDENCE_INSTRUCTION);
  parts.push(PRODUCT_SOP);
  // Sage Intacct product knowledge — always on, so the assistant can map needs
  // to modules and position competitively (Power of 7 injected once provided).
  parts.push(INTACCT_KNOWLEDGE);
  if (POWER_OF_7) parts.push(POWER_OF_7);
  // v22: report tool guide only injects when the org has reports enabled. When
  // off, the entire reports surface (tool guide + build_report tool) is omitted.
  if (opts.reportsEnabled) parts.push(reportToolGuide(opts.schemaBlock));
  if (opts.pageContext) parts.push(pageContextBlock(opts.pageContext));
  // v20 memory layers — ordered per MEMORY PRECEDENCE in UNIFIED_SYSTEM_PROMPT.
  if (opts.whatLuxRemembers) parts.push(opts.whatLuxRemembers);
  if (opts.orgFacts) parts.push(opts.orgFacts);
  if (opts.similarDealLessons) parts.push(opts.similarDealLessons);
  if (opts.orgPatterns) parts.push(opts.orgPatterns);
  // v21: web search block comes BEFORE RELEVANT EXCERPTS so the model sees the
  // freshest source of truth first. Citation instruction appended once.
  if (opts.webSearchBlock) {
    parts.push(opts.webSearchBlock);
    parts.push(WEB_SEARCH_CITATION_INSTRUCTION);
  }
  if (opts.dealContext) parts.push(`\n# ACTIVE DEAL CONTEXT\n${opts.dealContext}`);
  if (opts.ragExcerpts) parts.push(`\n# RELEVANT EXCERPTS (retrieved by semantic similarity to the user's question)\nQuote these verbatim when answering — they are the actual language used on calls and in research. Cite the number in brackets.\n\n${opts.ragExcerpts}`);
  if (opts.pipelineContext) parts.push(`\n# PIPELINE CONTEXT\n${opts.pipelineContext}`);
  return parts.join('\n\n');
}

function validateDraft(cfg: any, schema: Record<string, Record<string, { type: string }>>) {
  const errors: any[] = [];
  const base = cfg.base_entity;
  if (!base) errors.push({ error: 'base_entity is required' });
  else if (!schema[base]) errors.push({ error: `base_entity '${base}' is not a reportable table`, valid_tables: Object.keys(schema) });

  const validateField = (field: string, join: string | null | undefined, context: string) => {
    const table = join || base;
    if (!table || !schema[table]) {
      errors.push({ error: `${context}: table '${table}' not in schema`, hint: `valid tables: ${Object.keys(schema).join(', ')}` });
      return;
    }
    if (!schema[table][field]) {
      const locations = findFieldLocations(schema, field);
      errors.push({
        error: `${context}: field '${field}' does not exist on '${table}'`,
        hint: locations.length
          ? `field '${field}' exists on: ${locations.join(', ')}. Use { "join": "${locations[0]}", "field": "${field}" } and add '${locations[0]}' to included_relations.`
          : `field '${field}' does not exist on any reportable table. Check the schema in the system prompt.`,
        available_on_target: Object.keys(schema[table] || {}).slice(0, 30),
      });
    }
  };

  for (const f of (cfg.fields || [])) {
    if (typeof f === 'string') validateField(f, null, `fields[${cfg.fields.indexOf(f)}]`);
    else if (f && typeof f === 'object' && f.formula) continue;
    else if (f && typeof f === 'object' && f.field) validateField(f.field, f.join || null, `fields[${f.field}]`);
  }
  for (const [i, f] of (cfg.filters || []).entries()) {
    if (f?.field) validateField(f.field, f.join || null, `filters[${i}]`);
  }
  for (const g of (cfg.groups || [])) validateField(g, null, `groups: ${g}`);
  if (cfg.order_by) validateField(cfg.order_by, null, `order_by: ${cfg.order_by}`);
  if (cfg.pivot_column) validateField(cfg.pivot_column, null, `pivot_column: ${cfg.pivot_column}`);
  if (cfg.summary_aggregate?.field) validateField(cfg.summary_aggregate.field, null, `summary_aggregate.field: ${cfg.summary_aggregate.field}`);

  return errors;
}

async function runReportQuery(sb: any, cfg: any, orgScope: { org_id?: string | null }) {
  const base = cfg.base_entity;
  if (!base) return { error: 'base_entity required' };
  const rawFields = (cfg.fields || []).filter((f: any) => typeof f === 'string');
  const joinedFields = (cfg.fields || []).filter((f: any) => typeof f === 'object' && f?.join && f?.field);

  const joinTables = new Set<string>(joinedFields.map((f: any) => f.join));
  for (const f of (cfg.filters || [])) if (f.join) joinTables.add(f.join);
  for (const rel of (cfg.included_relations || [])) joinTables.add(rel);

  const selectFields = rawFields.length ? rawFields : ['*'];
  const selectParts = [selectFields.join(', ')];
  for (const t of joinTables) selectParts.push(`${t}(*)`);
  let q = sb.from(base).select(selectParts.join(', '), { count: 'exact' });

  if (orgScope.org_id && base === 'deals') q = q.eq('org_id', orgScope.org_id);

  for (const f of (cfg.filters || [])) {
    if (f.join) continue;
    const v = f.value;
    switch (f.operator) {
      case 'eq': q = q.eq(f.field, v); break;
      case 'neq': q = q.neq(f.field, v); break;
      case 'gt': q = q.gt(f.field, v); break;
      case 'gte': q = q.gte(f.field, v); break;
      case 'lt': q = q.lt(f.field, v); break;
      case 'lte': q = q.lte(f.field, v); break;
      case 'like': q = q.ilike(f.field, `%${v}%`); break;
      case 'not_like': q = q.not(f.field, 'ilike', `%${v}%`); break;
      case 'is_null': q = q.is(f.field, null); break;
      case 'not_null': q = q.not(f.field, 'is', null); break;
      case 'in': q = q.in(f.field, String(v).split(',').map((s: string) => s.trim()).filter(Boolean)); break;
      case 'not_in': { const list = String(v).split(',').map((s: string) => s.trim()).filter(Boolean); if (list.length) q = q.not(f.field, 'in', `(${list.join(',')})`); break; }
    }
  }

  if (cfg.order_by) q = q.order(cfg.order_by, { ascending: cfg.order_dir === 'asc' });
  q = q.limit(Math.min(Math.max(Number(cfg.limit) || 100, 1), 500));

  const { data, count, error } = await q;
  if (error) return { error: error.message };
  return { count: count ?? (data || []).length, rows: data || [] };
}

async function buildDealContext(sb: any, deal_id: string): Promise<{ context: string; deal: any; rep: any; cid: string | null; model: string }> {
  const [dealRes, analysisRes, companyRes, contactsRes, competitorsRes, tasksRes, convsRes, painsRes, risksRes, eventsRes, catalystsRes, mspRes, flagsRes, sizingRes, sourcesRes, systemsRes] = await Promise.all([
    sb.from('deals').select('*').eq('id', deal_id).single(),
    sb.from('deal_analysis').select('*').eq('deal_id', deal_id).single(),
    sb.from('company_profile').select('*').eq('deal_id', deal_id).single(),
    sb.from('contacts').select('*').eq('deal_id', deal_id),
    sb.from('deal_competitors').select('*').eq('deal_id', deal_id),
    sb.from('tasks').select('*').eq('deal_id', deal_id).order('completed', { ascending: true }),
    sb.from('conversations').select('id, title, call_type, call_date, ai_summary, transcript').eq('deal_id', deal_id).order('call_date', { ascending: false }).limit(15),
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

  const context = `DEAL: ${deal.company_name}\nStage: ${deal.stage} | Forecast: ${deal.forecast_category} | Value: $${deal.deal_value || 0} | CMRR: $${deal.cmrr || 0}\nClose: ${deal.target_close_date || 'TBD'} | Fit: ${deal.fit_score || '?'}/10 | Health: ${deal.deal_health_score || '?'}/10 | ICP: ${deal.icp_fit_score || '?'}/100\nNext Steps: ${deal.next_steps || 'None'}\n\nCOMPANY:\n${clean(company?.overview)}\nIndustry: ${clean(company?.industry)} | Revenue: ${clean(company?.revenue)} | Employees: ${clean(company?.employee_count)}\nTech Stack: ${clean(company?.tech_stack)}\nBusiness Goals: ${clean(company?.business_goals)}\nBusiness Priorities: ${clean(company?.business_priorities)}\n\nCURRENT SYSTEMS (${systems.length}):\n${systems.map((s: any) => `- ${s.system_name} [${s.system_category}]`).join('\n') || 'None'}\n\nANALYSIS:\nPains: ${clean(analysis?.pain_points)}\nQuantified: ${clean(analysis?.quantified_pain)}\nBudget: ${clean(analysis?.budget)}\nChampion: ${clean(analysis?.champion)} | EB: ${clean(analysis?.economic_buyer)}\nDecision Criteria: ${clean(analysis?.decision_criteria)}\nTimeline: ${clean(analysis?.timeline_drivers)}\n\nCONTACTS (${contacts.length}):\n${contacts.map((c: any) => `- ${c.name} | ${c.title || '?'} | ${c.role_in_deal || '?'}${c.is_champion ? ' [CHAMP]' : ''}${c.is_economic_buyer ? ' [EB]' : ''}`).join('\n') || 'None'}\n\nCOMPETITORS (${competitors.length}):\n${competitors.map((c: any) => `- ${c.competitor_name}`).join('\n') || 'None'}\n\nPAIN POINTS (${pains.length}):\n${pains.map((p: any) => `- ${p.pain_description}${p.annual_cost ? ' ($' + p.annual_cost + '/yr)' : ''}`).join('\n') || 'None'}\n\nRED FLAGS: ${redFlags.map((f: any) => f.description).join(' | ') || 'None'}\nGREEN FLAGS: ${greenFlags.map((f: any) => f.description).join(' | ') || 'None'}\n\nTASKS (${tasks.length}):\n${tasks.map((t: any) => `- [${t.completed ? 'DONE' : t.priority}] ${t.title}`).join('\n') || 'None'}\n\nCALL HISTORY (${convs.length}):\n${convs.map((c: any) => `- ${c.call_date || '?'} [${c.call_type}]: ${(c.ai_summary || '').substring(0, 200)}`).join('\n') || 'None'}\n\nEVIDENCE: ${researchSources.length} research, ${transcriptSources.length} transcript sources.`;

  // FULL transcript text (newest-first, budget-capped). The ai_summary above is
  // only a recap — detail questions (user counts, names, who-said-what, exact
  // numbers) must be answered from the verbatim transcripts, not the summary.
  const PER_CALL_CAP = 60000, TOTAL_CAP = 160000;
  let used = 0;
  const tParts: string[] = [];
  for (const c of convs) {
    const full = (c.transcript || '').trim();
    if (!full) continue;
    if (used >= TOTAL_CAP) {
      tParts.push(`## ${c.call_date || '?'} [${c.call_type}]\n[Full transcript omitted to stay within context budget — open the call in the Transcripts tab, or ask me to focus on this specific call.]`);
      continue;
    }
    let body = full, note = '';
    if (body.length > PER_CALL_CAP) { body = body.slice(0, PER_CALL_CAP); note = `\n…[transcript truncated — ${full.length - PER_CALL_CAP} more chars in the Transcripts tab]`; }
    if (used + body.length > TOTAL_CAP) { body = body.slice(0, TOTAL_CAP - used); note = `\n…[transcript truncated to fit context budget]`; }
    used += body.length;
    tParts.push(`## ${c.call_date || '?'} [${c.call_type}]\n${body}${note}`);
  }
  const transcriptBlock = tParts.length
    ? `\n\n# FULL CALL TRANSCRIPTS (verbatim — newest first)\nThese are the actual call transcripts. Answer detail questions from these, quoting verbatim. If something is not present in these transcripts, say you don't see it — do not infer it from the summaries.\n\n${tParts.join('\n\n')}`
    : '';

  return { context: context + transcriptBlock, deal, rep, cid, model };
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

  const dealLines = (deals || []).map((d: any) => `- ${d.company_name} | ${d.stage} | ${d.forecast_category} | $${d.deal_value || 0} | Close: ${d.target_close_date || 'TBD'} | Fit: ${d.fit_score || '?'}/10 | Health: ${d.deal_health_score || '?'}/10`);
  const taskLines = (tasks || []).map((t: any) => `- [${t.priority}] ${t.title}${t.deals?.company_name ? ' (' + t.deals.company_name + ')' : ''}`);

  const context = `REP: ${profile?.full_name || 'Unknown'} (${profile?.initials || '??'})\n\nACTIVE DEALS (${(deals || []).length}):\n${dealLines.join('\n') || 'None'}\n\nOPEN TASKS (${(tasks || []).length}):\n${taskLines.join('\n') || 'None'}`;

  return { context, orgId, cid, model };
}

// ---------------------------------------------------------------------------
// v20 — context expansion helpers. Each helper returns a formatted string block
// (or '' when no data) so buildSystemPrompt can splice them in cleanly.
// ---------------------------------------------------------------------------

type AiMemoryRow = {
  id: string;
  deal_id: string | null;
  memory_type: string;
  content: string;
  priority: string;
  related_field: string | null;
  created_at: string;
  source_type: string | null;
};

async function fetchAiMemoryForDeal(sb: any, dealId: string, orgId: string): Promise<{ deal: AiMemoryRow[]; org: AiMemoryRow[] }> {
  if (!orgId) return { deal: [], org: [] };
  try {
    // One query, split client-side. The .or() lets us pull deal-scoped + org-scoped rows together.
    const { data, error } = await sb.from('ai_memory')
      .select('id, deal_id, memory_type, content, priority, related_field, created_at, source_type')
      .eq('org_id', orgId)
      .eq('active', true)
      .or(`deal_id.eq.${dealId},deal_id.is.null`)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(40);
    if (error) { console.log('fetchAiMemoryForDeal error:', error.message); return { deal: [], org: [] }; }
    const rows: AiMemoryRow[] = data || [];
    const deal = rows.filter(r => r.deal_id === dealId).slice(0, 20);
    const org = rows.filter(r => r.deal_id === null && ['sme_qa', 'org_policy', 'org_fact'].includes(r.memory_type)).slice(0, 15);
    return { deal, org };
  } catch (e: any) { console.log('fetchAiMemoryForDeal exception:', e?.message); return { deal: [], org: [] }; }
}

async function fetchOrgAiMemory(sb: any, orgId: string): Promise<AiMemoryRow[]> {
  if (!orgId) return [];
  try {
    const { data, error } = await sb.from('ai_memory')
      .select('id, deal_id, memory_type, content, priority, related_field, created_at, source_type')
      .is('deal_id', null)
      .eq('org_id', orgId)
      .eq('active', true)
      .in('memory_type', ['sme_qa', 'org_policy', 'org_fact'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(15);
    if (error) { console.log('fetchOrgAiMemory error:', error.message); return []; }
    return data || [];
  } catch (e: any) { console.log('fetchOrgAiMemory exception:', e?.message); return []; }
}

async function fetchSimilarDealLessons(sb: any, dealId: string, orgId: string): Promise<any[]> {
  if (!dealId || !orgId) return [];
  try {
    const { data, error } = await sb.rpc('get_similar_deal_retrospectives', { p_deal_id: dealId, p_org_id: orgId, p_limit: 5 });
    if (error) { console.log('get_similar_deal_retrospectives error:', error.message); return []; }
    return Array.isArray(data) ? data : [];
  } catch (e: any) { console.log('fetchSimilarDealLessons exception:', e?.message); return []; }
}

async function fetchOrgPatterns(sb: any, orgId: string): Promise<any[]> {
  if (!orgId) return [];
  try {
    const { data, error } = await sb.from('org_ai_patterns')
      .select('pattern_type, content, deal_count, evidence')
      .eq('org_id', orgId)
      .eq('active', true)
      .order('deal_count', { ascending: false })
      .limit(10);
    if (error) { console.log('fetchOrgPatterns error:', error.message); return []; }
    return data || [];
  } catch (e: any) { console.log('fetchOrgPatterns exception:', e?.message); return []; }
}

function formatMemoryLine(m: AiMemoryRow): string {
  const date = (m.created_at || '').slice(0, 10);
  const tag = m.memory_type + (m.source_type ? ' · ' + m.source_type : '');
  return `[${m.priority} · ${date} · ${tag}] ${m.content}`;
}

function whatLuxRemembersBlock(rows: AiMemoryRow[]): string {
  if (!rows.length) return '';
  return `\n# WHAT LUX REMEMBERS ABOUT THIS DEAL\n(durable facts captured from prior corrections, transcript processing, and SME answers. Treat as authoritative for this deal.)\n${rows.map(formatMemoryLine).join('\n')}\n`;
}

function orgFactsBlock(rows: AiMemoryRow[]): string {
  if (!rows.length) return '';
  return `\n# ORG-LEVEL FACTS (apply across all deals in this org)\n${rows.map(formatMemoryLine).join('\n')}\n`;
}

function similarDealLessonsBlock(rows: any[]): string {
  if (!rows.length) return '';
  const lines: string[] = ['\n# LESSONS FROM SIMILAR DEALS IN YOUR ORG', '(retrospectives from closed deals matched on industry + competitor similarity)\n'];
  rows.forEach((r: any, i: number) => {
    const date = (r.generated_at || '').slice(0, 10);
    const score = r.similarity_score != null ? ` · sim=${r.similarity_score}` : '';
    lines.push(`DEAL ${i + 1}: ${r.company_name || '?'} (${r.outcome || '?'} · ${date}${score})`);
    if (Array.isArray(r.key_lessons) && r.key_lessons.length) lines.push(`  Lessons: ${r.key_lessons.slice(0, 4).join(' | ')}`);
    if (Array.isArray(r.what_worked) && r.what_worked.length) lines.push(`  What worked: ${r.what_worked.slice(0, 3).join(' | ')}`);
    if (Array.isArray(r.what_didnt) && r.what_didnt.length) lines.push(`  What didn't: ${r.what_didnt.slice(0, 3).join(' | ')}`);
    lines.push('');
  });
  return lines.join('\n');
}

function orgPatternsBlock(rows: any[]): string {
  if (!rows.length) return '';
  const lines = rows.map((p: any) => `[deal_count=${p.deal_count || 0} · ${p.pattern_type || 'pattern'}] ${p.content || ''}`);
  return `\n# YOUR ORG'S WINNING PATTERNS\n${lines.join('\n')}\n`;
}

// Substring-match surfacing tracker: increment times_surfaced + last_surfaced_at
// for any ai_memory row whose first 30 chars of content appear in the response.
async function recordMemorySurfacing(sb: any, candidates: AiMemoryRow[], responseText: string): Promise<void> {
  if (!candidates.length || !responseText) return;
  const lowered = responseText.toLowerCase();
  const hits: string[] = [];
  for (const m of candidates) {
    const probe = (m.content || '').slice(0, 30).toLowerCase().trim();
    if (probe.length < 10) continue;
    if (lowered.includes(probe)) hits.push(m.id);
  }
  if (!hits.length) return;
  try {
    await sb.rpc('increment_memory_surfaced', { memory_ids: hits });
  } catch (e: any) {
    // Fallback if the RPC isn't deployed: best-effort direct update.
    try {
      await sb.from('ai_memory').update({ last_surfaced_at: new Date().toISOString() }).in('id', hits);
    } catch {}
  }
}

// Correction handler: extract a durable fact from the user's correction, write
// it as ai_memory with memory_type='correction', and auto-create a paired
// sme_questions row with status='routed' so an SME can validate.
async function handleCorrectionPayload(sb: any, opts: {
  dealId: string;
  orgId: string;
  userId: string;
  sessionId: string | null;
  originalMessageId: string | null;
  originalAssistantText: string;
  correctionText: string;
}): Promise<{ memory_id: string | null; sme_question_id: string | null }> {
  if (!ANTHROPIC_API_KEY) return { memory_id: null, sme_question_id: null };
  // 1. Extract durable fact + topic tags via Haiku.
  let memoryContent: string | null = null;
  let relatedField: string | null = null;
  let priority: 'high' | 'medium' | 'low' = 'high';
  let topicTags: string[] = [];
  try {
    const extractPrompt = `A rep just corrected an AI response. Extract the durable fact that should be remembered for this deal.
Return ONLY JSON: { "memory_content": "...", "related_field": "...", "priority": "high|medium|low", "topic_tags": ["...", "..."] }
Return memory_content=null if no durable fact is present (style preference, etc.).

AI said: ${opts.originalAssistantText.slice(0, 2000)}
Rep corrected: ${opts.correctionText.slice(0, 2000)}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 400, temperature: 0, messages: [{ role: 'user', content: extractPrompt }] }),
    });
    if (r.ok) {
      const j = await r.json();
      const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (parsed.memory_content && typeof parsed.memory_content === 'string') memoryContent = parsed.memory_content;
        if (parsed.related_field && typeof parsed.related_field === 'string') relatedField = parsed.related_field;
        if (['high', 'medium', 'low'].includes(parsed.priority)) priority = parsed.priority;
        if (Array.isArray(parsed.topic_tags)) topicTags = parsed.topic_tags.filter((t: any) => typeof t === 'string').slice(0, 3);
      }
    }
  } catch (e: any) { console.log('correction extract error:', e?.message); }

  if (!memoryContent) return { memory_id: null, sme_question_id: null };

  // 2. Write the ai_memory row (always priority=high per spec — corrections take precedence).
  let memoryId: string | null = null;
  try {
    const { data, error } = await sb.from('ai_memory').insert({
      deal_id: opts.dealId,
      org_id: opts.orgId,
      memory_type: 'correction',
      content: memoryContent,
      priority: 'high',
      source_type: 'chat_correction',
      source_conversation_id: null,
      related_field: relatedField,
      active: true,
      resolved: false,
    }).select('id').single();
    if (error) { console.log('correction ai_memory insert error:', error.message); }
    else memoryId = data?.id || null;
  } catch (e: any) { console.log('correction ai_memory exception:', e?.message); }

  if (!memoryId) return { memory_id: null, sme_question_id: null };

  // 3. Auto-create paired sme_questions validation row.
  let smeQuestionId: string | null = null;
  try {
    let routedTo: string | null = null;
    if (topicTags.length) {
      try {
        const { data: routeData } = await sb.rpc('get_sme_for_topic', { p_org_id: opts.orgId, p_topic_tag: topicTags[0] });
        // RPC may return a uuid or null; tolerate either shape.
        if (typeof routeData === 'string') routedTo = routeData;
        else if (routeData && typeof routeData === 'object' && routeData.sme_user_id) routedTo = routeData.sme_user_id;
      } catch (e: any) { console.log('get_sme_for_topic non-fatal:', e?.message); }
    }
    const truncated = opts.originalAssistantText.slice(0, 600);
    const questionText = `Lux said: "${truncated}${opts.originalAssistantText.length > 600 ? '...' : ''}". User corrected: "${opts.correctionText.slice(0, 600)}${opts.correctionText.length > 600 ? '...' : ''}". Please validate.`;
    const { data, error } = await sb.from('sme_questions').insert({
      org_id: opts.orgId,
      asked_by_user_id: opts.userId,
      deal_id: opts.dealId,
      chat_session_id: opts.sessionId,
      chat_message_id: opts.originalMessageId,
      question_text: questionText,
      ai_question_context: memoryContent,
      topic_tags: topicTags.length ? topicTags : ['unmatched'],
      status: 'routed',
      visibility: 'org',
      routed_to_sme_id: routedTo,
      routed_at: routedTo ? new Date().toISOString() : null,
      ai_correction_memory_id: memoryId,
    }).select('id').single();
    if (error) { console.log('correction sme_questions insert error:', error.message); }
    else smeQuestionId = data?.id || null;
  } catch (e: any) { console.log('correction sme_questions exception:', e?.message); }

  return { memory_id: memoryId, sme_question_id: smeQuestionId };
}

// ---------------------------------------------------------------------------
// v21 — web search helpers. Org + user toggle, Haiku classifier, Perplexity
// Sonar Pro call, citation block formatter. Every external call has a try
// boundary so Perplexity outages degrade cleanly to no-web-search responses.
// ---------------------------------------------------------------------------

const WEB_SEARCH_CITATION_INSTRUCTION = `
# WEB SEARCH CITATIONS
When you use information from WEB SEARCH RESULTS, cite the source inline using the existing source-block format:
\`\`\`source
{"url": "<full URL>", "hostname": "<hostname>", "snippet": "<10-15 word snippet>", "fetched_at": "<ISO timestamp>", "type": "web_search"}
\`\`\`
Place the source block immediately after the sentence it supports.
Do not invent URLs. Only cite URLs that appear in WEB SEARCH RESULTS.
Prefer paraphrasing over direct quotation; if quoting, keep under 15 words.

# SME ANSWER CITATIONS
When you use information from a COACH DOCUMENTS section labeled "## SME Q&A" or
from an ai_memory entry where the content begins with [sme_question_id=...],
cite the source inline using the source-block format IMMEDIATELY after the
sentence the citation supports:

\`\`\`source
{"sme_question_id": "<uuid>", "sme_name": "<name>", "answered_at": "<iso date>", "helpful_marks": <count>, "type": "sme_answer"}
\`\`\`

Pull the values directly from the Citation Metadata block at the top of the
SME Q&A section, OR from the [sme_question_id=... sme_name="..." answered_at=...
helpful_marks=...] prefix on the ai_memory entry. Do not fabricate or paraphrase
them. The sme_question_id MUST be the exact UUID from the source; if you cannot
find a valid UUID, do not emit the citation.

PREFER source-block citation over prose attribution. Do not write "Based on
[Name]'s SME answer..." — emit the source block instead. The system uses these
blocks to track citation usage and award SME contribution credit.
`;

async function fetchWebSearchFlags(sb: any, userId: string | null, orgId: string | null): Promise<{ userFlag: boolean; orgFlag: boolean; effective: boolean }> {
  if (!userId || !orgId) return { userFlag: false, orgFlag: false, effective: false };
  try {
    const [userRes, orgRes] = await Promise.all([
      sb.from('profiles').select('chat_web_search_enabled').eq('id', userId).single(),
      sb.from('organizations').select('allow_chat_web_search').eq('id', orgId).single(),
    ]);
    const userFlag = !!userRes?.data?.chat_web_search_enabled;
    const orgFlag = orgRes?.data?.allow_chat_web_search !== false; // default true if missing
    return { userFlag, orgFlag, effective: userFlag && orgFlag };
  } catch (e: any) { console.log('fetchWebSearchFlags error:', e?.message); return { userFlag: false, orgFlag: false, effective: false }; }
}

async function classifyForWebSearch(message: string, history: { role: string; content: string }[]): Promise<{ needs_web_search: boolean; suggested_query: string }> {
  if (!ANTHROPIC_API_KEY) return { needs_web_search: false, suggested_query: '' };
  const recent = history.slice(-2).map((m: any) => `${m.role}: ${typeof m.content === 'string' ? m.content.slice(0, 400) : ''}`).join('\n');
  const sys = `You decide whether a user question needs a live web search.
Return ONLY JSON: { "needs_web_search": true|false, "suggested_query": "..." }
needs_web_search=true ONLY when the answer requires fresh facts the model couldn't reliably have from training (current prices, who-holds-position, recent news, named-product specs, dated events, "today/this week/latest" questions). Return false for methodology, internal product, deal-context, or general advice questions.`;
  const usr = `User question: ${message.slice(0, 2000)}\nRecent context (last 2 messages, for disambiguation only):\n${recent}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, temperature: 0, system: sys, messages: [{ role: 'user', content: usr }] }),
    });
    if (!r.ok) { console.log('classifier non-2xx:', r.status); return { needs_web_search: false, suggested_query: '' }; }
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { needs_web_search: false, suggested_query: '' };
    const parsed = JSON.parse(match[0]);
    return {
      needs_web_search: !!parsed.needs_web_search,
      suggested_query: typeof parsed.suggested_query === 'string' ? parsed.suggested_query : '',
    };
  } catch (e: any) { console.log('classifier exception:', e?.message); return { needs_web_search: false, suggested_query: '' }; }
}

type PerplexityCitation = { url: string; title?: string; snippet?: string };
type PerplexityResult = {
  ok: boolean;
  content: string;
  citations: PerplexityCitation[];
  raw_excerpt: string;
  error?: string;
};

function extractHostname(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

async function callPerplexity(query: string): Promise<PerplexityResult> {
  if (!PERPLEXITY_API_KEY) return { ok: false, content: '', citations: [], raw_excerpt: '', error: 'PERPLEXITY_API_KEY not configured' };
  if (!query) return { ok: false, content: '', citations: [], raw_excerpt: '', error: 'empty query' };
  try {
    const r = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${PERPLEXITY_API_KEY}` },
      body: JSON.stringify({
        model: 'sonar-pro',
        max_tokens: 600,
        return_citations: true,
        return_images: false,
        messages: [{ role: 'user', content: query }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      return { ok: false, content: '', citations: [], raw_excerpt: '', error: `Perplexity ${r.status}: ${errText.slice(0, 200)}` };
    }
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || '';
    // Perplexity returns citations either as array of URLs or array of objects depending on version.
    const rawCitations: any[] = Array.isArray(j?.citations) ? j.citations : (Array.isArray(j?.search_results) ? j.search_results : []);
    const citations: PerplexityCitation[] = rawCitations.map((c: any) => {
      if (typeof c === 'string') return { url: c };
      return { url: c.url || c.link || '', title: c.title || c.name || undefined, snippet: c.snippet || c.text || undefined };
    }).filter(c => !!c.url);
    return { ok: true, content, citations, raw_excerpt: content.slice(0, 500) };
  } catch (e: any) {
    return { ok: false, content: '', citations: [], raw_excerpt: '', error: e?.message || 'Perplexity fetch threw' };
  }
}

function formatWebSearchBlock(query: string, content: string, citations: PerplexityCitation[]): string {
  const ts = new Date().toISOString();
  const lines: string[] = [`\n# WEB SEARCH RESULTS (Perplexity Sonar — ${ts})`, `Query: ${query}`, '', content.trim()];
  if (citations.length) {
    lines.push('', 'Sources:');
    citations.forEach((c, i) => {
      lines.push(`[${i + 1}] ${c.url}${c.title ? ' — ' + c.title : ''}`);
    });
  }
  return lines.join('\n');
}

// Parse fenced source blocks of type 'web_search' out of the assistant response.
// Returns the set of unique URLs cited.
function extractWebSearchCitations(responseText: string): { url: string; hostname: string; snippet: string; fetched_at: string }[] {
  const out: { url: string; hostname: string; snippet: string; fetched_at: string }[] = [];
  const seen = new Set<string>();
  const fenceRe = /```source\s*\n([\s\S]*?)\n```/g;
  let m: RegExpExecArray | null;
  while ((m = fenceRe.exec(responseText)) !== null) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (parsed && parsed.type === 'web_search' && parsed.url && !seen.has(parsed.url)) {
        seen.add(parsed.url);
        out.push({
          url: String(parsed.url),
          hostname: String(parsed.hostname || extractHostname(parsed.url)),
          snippet: String(parsed.snippet || '').slice(0, 500),
          fetched_at: String(parsed.fetched_at || new Date().toISOString()),
        });
      }
    } catch {}
  }
  return out;
}

// ---------------------------------------------------------------------------
// v23 — auto-focus classifier. Detects which deal a rep's message is about and
// either auto-focuses (high confidence), suggests a switch (high confidence
// + different deal already focused), or asks a clarifying question (medium).
// ---------------------------------------------------------------------------

type AutoFocusClassifier = {
  detected_deal_id: string | null;
  detected_company_name: string | null;
  confidence: 'high' | 'medium' | 'low';
};

async function classifyAutoFocusDeal(message: string, openDeals: { id: string; company_name: string; stage: string }[]): Promise<AutoFocusClassifier> {
  if (!ANTHROPIC_API_KEY || openDeals.length === 0) return { detected_deal_id: null, detected_company_name: null, confidence: 'low' };
  const dealList = openDeals.map(d => `- ${d.company_name} (id: ${d.id}, stage: ${d.stage})`).join('\n');
  const sys = `You detect which deal a sales rep's message is about. The rep has these open deals:

${dealList}

Return ONLY JSON: { "detected_deal_id": "<uuid|null>", "detected_company_name": "<name|null>", "confidence": "high|medium|low" }

Rules:
- "high" = the message names a deal/company directly and unambiguously matches one in the list
- "medium" = the message references a deal but the match is partial (nickname, partial name, "the manufacturing deal")
- "low" = the message could plausibly be about a deal but it's not certain, OR the message is generic (no deal reference at all)
- If detected_deal_id is null, confidence is "low"
- Do not guess. When in doubt, return low confidence with null id.`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 150, temperature: 0, system: sys, messages: [{ role: 'user', content: message.slice(0, 2000) }] }),
    });
    if (!r.ok) return { detected_deal_id: null, detected_company_name: null, confidence: 'low' };
    const j = await r.json();
    const text = (j.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { detected_deal_id: null, detected_company_name: null, confidence: 'low' };
    const parsed = JSON.parse(m[0]);
    // Validate the returned uuid actually matches one in the supplied list — Haiku occasionally hallucinates.
    const detectedId = typeof parsed.detected_deal_id === 'string' ? parsed.detected_deal_id : null;
    const validId = detectedId && openDeals.some(d => d.id === detectedId) ? detectedId : null;
    const conf = ['high', 'medium', 'low'].includes(parsed.confidence) ? parsed.confidence : 'low';
    return {
      detected_deal_id: validId,
      detected_company_name: validId ? (openDeals.find(d => d.id === validId)?.company_name || null) : null,
      confidence: validId ? conf : 'low',
    };
  } catch (e: any) { console.log('classifyAutoFocusDeal error:', e?.message); return { detected_deal_id: null, detected_company_name: null, confidence: 'low' }; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'v23: ANTHROPIC_API_KEY not configured' }, 500);
    const { deal_id: deal_id_in, session_id, message, user_id, context_type, page_context, correction_payload, cross_deal_question } = await req.json();
    // v23: deal_id and ctxType may be reassigned by the auto-focus classifier (Branch A). Mutable locals.
    let deal_id = deal_id_in;
    let ctxType = context_type || (deal_id ? 'deal' : 'general');
    if (!message) return jsonResponse({ error: 'v23: message required' }, 400);
    // v23: deal_id is only required at ctxType==='deal' AFTER the auto-focus classifier has had a chance to promote a generic message.
    // For now we just require user_id everywhere (it's needed to load open deals).
    if (!user_id && !deal_id) return jsonResponse({ error: 'v23: user_id or deal_id required' }, 400);

    // v22: schema introspection is only needed when the report tool is on.
    // Defer it until after we know the org's enable_chat_reports flag.
    let schema: Record<string, Record<string, { type: string }>> = {};
    let schemaBlock = '';
    let reportsEnabled = false;

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
    const { data: history } = await sb.from('deal_chat_messages').select('role, content, deal_id').eq('session_id', activeSessionId).order('created_at').limit(20);

    // v23: auto-focus classifier — runs before the heavy context build so we can
    // short-circuit into Branch B / C and skip the main Claude call entirely.
    // Demo-org-only: other orgs skip the entire classifier path.
    let autoFocusPayload: any = { classifier_fired: false, classifier_skipped: true };
    let autoFocusedTurn: { deal_id: string; company_name: string } | null = null;

    // Resolve user's org early so we can gate on demo-org status.
    let userOrgId: string | null = null;
    if (user_id) {
      try {
        const { data: up } = await sb.from('profiles').select('org_id').eq('id', user_id).single();
        userOrgId = up?.org_id || null;
      } catch {}
    }
    const isDemoOrg = isDemoOrgId(userOrgId);

    if (user_id && !cross_deal_question && isDemoOrg) {
      const messageTrim = String(message || '').trim();
      // Skip rule 1: very short messages (likely continuation like "yes", "more").
      if (messageTrim.length < 20) {
        autoFocusPayload.skip_reason = 'message_too_short';
      } else {
        const { data: openDeals } = await sb.from('deals')
          .select('id, company_name, stage')
          .eq('rep_id', user_id)
          .not('stage', 'in', '("closed_won","closed_lost","disqualified")')
          .order('updated_at', { ascending: false })
          .limit(30);
        const dealsList = openDeals || [];
        if (dealsList.length === 0) {
          autoFocusPayload.skip_reason = 'no_open_deals';
        } else {
          // Skip rule 2: continuation — last 2 messages in this thread were already about the current focused deal.
          const recent = (history || []).slice(-2);
          const isContinuation = deal_id && recent.length >= 1 && recent.every((m: any) => m.deal_id === deal_id);
          if (isContinuation) {
            autoFocusPayload.skip_reason = 'continuation';
          } else {
            autoFocusPayload = { classifier_fired: true, classifier_skipped: false };
            const cls = await classifyAutoFocusDeal(messageTrim, dealsList);
            autoFocusPayload.classifier_response = cls;

            if (cls.confidence === 'high' && cls.detected_deal_id) {
              if (!deal_id) {
                // Branch A — auto-focus
                deal_id = cls.detected_deal_id;
                ctxType = 'deal';  // downstream context build is gated on this
                autoFocusPayload.branch_taken = 'A';
                autoFocusPayload.auto_focused_deal_id = deal_id;
                autoFocusedTurn = { deal_id: cls.detected_deal_id, company_name: cls.detected_company_name || '' };
              } else if (deal_id !== cls.detected_deal_id) {
                // Branch B — switch suggestion. Short-circuit the main call.
                autoFocusPayload.branch_taken = 'B';
                const currentDeal = await sb.from('deals').select('id, company_name').eq('id', deal_id).single();
                // Audit even though we're returning early.
                try {
                  await sb.from('assembled_prompt_versions').insert({
                    prompt_hash: 'pre-main-' + (await sha256Hex(`switch:${cls.detected_deal_id}:${deal_id}:${Date.now()}`)),
                    coach_id: null, call_type: null, action: 'chat_auto_focus_audit',
                    assembled_content: `Switch suggestion: ${currentDeal?.data?.company_name} → ${cls.detected_company_name}`,
                    auto_focus_payload: autoFocusPayload,
                  });
                } catch {}
                return jsonResponse({
                  success: true, version: 'v23', session_id: activeSessionId, context_type: ctxType,
                  type: 'switch_suggestion',
                  current_focused: { id: deal_id, company_name: currentDeal?.data?.company_name || '' },
                  suggested: { id: cls.detected_deal_id, company_name: cls.detected_company_name || '' },
                  user_message: message,
                  auto_focus: autoFocusPayload,
                });
              } else {
                autoFocusPayload.branch_taken = 'high_match_no_change';
              }
            } else if (cls.confidence === 'medium' && cls.detected_deal_id) {
              // Branch C — clarifying question. Short-circuit.
              autoFocusPayload.branch_taken = 'C';
              try {
                await sb.from('assembled_prompt_versions').insert({
                  prompt_hash: 'pre-main-' + (await sha256Hex(`clarify:${cls.detected_deal_id}:${Date.now()}`)),
                  coach_id: null, call_type: null, action: 'chat_auto_focus_audit',
                  assembled_content: `Clarifying question: ${cls.detected_company_name}`,
                  auto_focus_payload: autoFocusPayload,
                });
              } catch {}
              return jsonResponse({
                success: true, version: 'v23', session_id: activeSessionId, context_type: ctxType,
                type: 'clarifying_question',
                suggested_deal: { id: cls.detected_deal_id, company_name: cls.detected_company_name || '' },
                user_message: message,
                auto_focus: autoFocusPayload,
              });
            } else {
              autoFocusPayload.branch_taken = 'D';
            }
          }
        }
      }
    } else if (cross_deal_question) {
      autoFocusPayload = { classifier_fired: false, classifier_skipped: true, skip_reason: 'cross_deal_question' };
    } else if (!isDemoOrg) {
      autoFocusPayload = { classifier_fired: false, classifier_skipped: true, skip_reason: 'non_demo_org' };
    }
    // If we promoted to deal context via Branch A, downstream code that checks ctxType==='deal' needs to see it.
    const effectiveCtxType = autoFocusedTurn ? 'deal' : ctxType;

    let dealContext = '', pipelineContext = '', ragExcerpts = '', model = 'claude-sonnet-4-20250514', cid: string | null = null, deal: any = null, rep: any = null, orgId: string | null = null;
    let memoryRows: AiMemoryRow[] = [];
    let memoryBlockDeal = '', memoryBlockOrg = '', similarLessonsBlock = '', orgPatternsBlockText = '';

    // v21: web search state. webSearchBlock is empty unless we actually ran a
    // successful Perplexity call AND the model is given the citation instruction.
    let webSearchBlock = '';
    let webSearchPayload: any | null = null;
    let webSearchUsed = false;
    let webSearchErrorKind: string | null = null;
    // Pre-fetch the user's profile-level flag (org gating happens after orgId
    // is known — speculative classifier won't fire for non-demo orgs even if
    // userWebFlag is true, because we won't call Perplexity).
    let userWebFlag = false;
    if (user_id) {
      try {
        const { data: up } = await sb.from('profiles').select('chat_web_search_enabled, org_id').eq('id', user_id).single();
        userWebFlag = !!up?.chat_web_search_enabled && isDemoOrgId(up?.org_id);
      } catch {}
    }
    // Speculative classifier — fires only when user flag is on AND user is in
    // the demo org. If the org kill switch is off, we'll discard the result
    // and never call Perplexity.
    const classifierPromise: Promise<{ needs_web_search: boolean; suggested_query: string }> = userWebFlag
      ? classifyForWebSearch(message, [])
      : Promise.resolve({ needs_web_search: false, suggested_query: '' });

    if (ctxType === 'deal') {
      // First we need orgId before we can fetch ai_memory/retrospectives in parallel.
      // Kick off the deal+RAG fetch first (cheap), then enrichment fetches once we know orgId.
      const [built, ragResult] = await Promise.all([
        buildDealContext(sb, deal_id),
        fetchRelevantExcerpts(sb, deal_id, message),
      ]);
      if (!built.deal) return jsonResponse({ error: 'v23: Deal not found' }, 404);
      dealContext = built.context; model = built.model; cid = built.cid; deal = built.deal; rep = built.rep;
      ragExcerpts = ragResult;
      const { data: repProfile } = await sb.from('profiles').select('org_id').eq('id', deal.rep_id).single();
      orgId = repProfile?.org_id || null;

      // v20: pull the four memory layers in parallel — demo-org-only feature.
      const [memSplit, similar, patterns, pctxResult] = await Promise.all([
        orgId && isDemoOrg ? fetchAiMemoryForDeal(sb, deal_id, orgId) : Promise.resolve({ deal: [], org: [] }),
        orgId && isDemoOrg ? fetchSimilarDealLessons(sb, deal_id, orgId) : Promise.resolve([]),
        orgId && isDemoOrg ? fetchOrgPatterns(sb, orgId) : Promise.resolve([]),
        buildPipelineContext(sb, deal.rep_id).catch(() => null),
      ]);
      memoryRows = [...memSplit.deal, ...memSplit.org];
      memoryBlockDeal = whatLuxRemembersBlock(memSplit.deal);
      memoryBlockOrg = orgFactsBlock(memSplit.org);
      similarLessonsBlock = similarDealLessonsBlock(similar);
      orgPatternsBlockText = orgPatternsBlock(patterns);
      if (pctxResult && pctxResult.context) pipelineContext = pctxResult.context;
    } else if (ctxType === 'pipeline') {
      const built = await buildPipelineContext(sb, user_id);
      pipelineContext = built.context; model = built.model; cid = built.cid; orgId = built.orgId;
      if (orgId && isDemoOrg) {
        const [orgMem, patterns] = await Promise.all([fetchOrgAiMemory(sb, orgId), fetchOrgPatterns(sb, orgId)]);
        memoryRows = orgMem;
        memoryBlockOrg = orgFactsBlock(orgMem);
        orgPatternsBlockText = orgPatternsBlock(patterns);
      }
    } else {
      // coaching / help / general — no deal, but still load lightweight pipeline
      // so the AI can reference the rep's deals if they bring one up.
      const built = await buildPipelineContext(sb, user_id);
      pipelineContext = built.context; model = built.model; cid = built.cid; orgId = built.orgId;
      if (orgId && isDemoOrg) {
        const [orgMem, patterns] = await Promise.all([fetchOrgAiMemory(sb, orgId), fetchOrgPatterns(sb, orgId)]);
        memoryRows = orgMem;
        memoryBlockOrg = orgFactsBlock(orgMem);
        orgPatternsBlockText = orgPatternsBlock(patterns);
      }
    }

    // v21: settle the web search decision now that we know orgId.
    // v22: also pick up enable_chat_reports in the same lookup. When off,
    // we skip schema introspection entirely (saves latency + tokens).
    const classifierResult = await classifierPromise;
    let orgWebFlag = true;
    if (orgId && isDemoOrg) {
      try {
        const { data: org } = await sb.from('organizations').select('allow_chat_web_search, enable_chat_reports').eq('id', orgId).single();
        orgWebFlag = org?.allow_chat_web_search !== false; // default true
        reportsEnabled = org?.enable_chat_reports === true; // demo respects the kill switch (default off)
      } catch {}
    } else {
      // Non-demo orgs: preserve baseline (pre-v22) behavior where reports were always on.
      reportsEnabled = true;
    }
    // Web search is demo-only; non-demo orgs always get effectiveWebFlag=false.
    const effectiveWebFlag = isDemoOrg && userWebFlag && orgWebFlag;
    if (reportsEnabled) {
      schema = await getSchema(sb);
      schemaBlock = formatSchemaForPrompt(schema);
    }
    // Build the audit payload regardless of whether Perplexity actually fires —
    // makes "classifier said no" runs traceable too.
    if (effectiveWebFlag) {
      webSearchPayload = {
        enabled: true,
        classifier_decision: String(classifierResult.needs_web_search),
        suggested_query: classifierResult.suggested_query || null,
        perplexity_query_sent: null,
        perplexity_citations: [],
        perplexity_raw_excerpt: null,
        error: null,
      };
    }
    if (effectiveWebFlag && classifierResult.needs_web_search && classifierResult.suggested_query) {
      const ppx = await callPerplexity(classifierResult.suggested_query);
      if (ppx.ok) {
        webSearchUsed = true;
        webSearchBlock = formatWebSearchBlock(classifierResult.suggested_query, ppx.content, ppx.citations);
        webSearchPayload.perplexity_query_sent = classifierResult.suggested_query;
        webSearchPayload.perplexity_citations = ppx.citations;
        webSearchPayload.perplexity_raw_excerpt = ppx.raw_excerpt;
      } else {
        webSearchErrorKind = 'perplexity_failed';
        webSearchPayload.error = ppx.error || 'perplexity unavailable';
        console.log('v21 Perplexity failure (graceful fallback):', ppx.error);
      }
    }

    let assembledCoachPrompt = '';
    let assembledPromptRecorded = false;
    if (cid) {
      try {
        const { data: assembled } = await sb.rpc('assemble_coach_prompt', { p_coach_id: cid, p_call_type: null, p_action: 'chat' });
        if (assembled && typeof assembled === 'string' && assembled.length > 0) {
          assembledCoachPrompt = assembled;
          await recordAssembledPrompt(sb, cid, null, 'chat', assembled, webSearchPayload, autoFocusPayload);
          assembledPromptRecorded = true;
        }
      } catch (e) { console.log('assemble_coach_prompt error (chat, non-fatal):', e); }
    }
    // v21: when web search machinery ran (toggle on) but the coach-prompt audit
    // row wasn't written (no coach_id, or assemble_coach_prompt failed/returned
    // empty), persist a standalone audit row so the web_search_payload column
    // is always populated for turns that touched the web search flow — even
    // when the classifier said no and no Perplexity call fired.
    if (webSearchPayload && !assembledPromptRecorded) {
      try {
        const auditContent = webSearchBlock
          ? webSearchBlock
          : `# WEB SEARCH AUDIT (classifier=${webSearchPayload.classifier_decision}) — ${classifierResult.suggested_query || message.slice(0, 80)}`;
        await recordAssembledPrompt(sb, cid, null, 'chat_web_search_audit', auditContent, webSearchPayload, autoFocusPayload);
      } catch (e) { console.log('web_search audit row insert error:', e); }
    }

    // v23: cross-deal-question note. Frontend sends cross_deal_question=true when
    // the user picked "Keep current deal, answer about Acme anyway" — the assistant
    // should NOT use the currently-focused deal's data, just respond using
    // general knowledge / pipeline context.
    const crossDealNote = cross_deal_question
      ? `\n\n# CROSS-DEAL QUESTION\nThe user has explicitly chosen to ask a question that is NOT about the currently-focused deal. Do NOT use the focused deal's structured data, transcripts, or scores to answer. Use general knowledge, methodology, or the rep's broader pipeline context. If the question is about a different deal entirely, treat it as a generic deal-strategy question rather than a deal-specific one.\n`
      : '';

    const finalSystem = buildSystemPrompt({
      schemaBlock, dealContext, pipelineContext, pageContext: page_context, assembledCoachPrompt, ragExcerpts,
      whatLuxRemembers: memoryBlockDeal,
      orgFacts: memoryBlockOrg,
      similarDealLessons: similarLessonsBlock,
      orgPatterns: orgPatternsBlockText,
      webSearchBlock,
      reportsEnabled,
      isDemoOrg,
    }) + crossDealNote;

    const messages = (history || []).map((m: any) => ({ role: m.role, content: m.content }));
    // v22: filter out build_report when reports are off for this org.
    const baseTools = ctxType === 'deal' ? [...DEAL_TOOLS, REPORT_TOOL] : [REPORT_TOOL];
    const tools = reportsEnabled ? baseTools : baseTools.filter((t: any) => t.name !== 'build_report');

    const claudeRes = await callClaudeWithRetry({
      model, max_tokens: 4000, temperature: 0.3, system: finalSystem, tools, messages,
    });
    if (!claudeRes.ok) { const errText = await claudeRes.text(); return jsonResponse({ error: `v23: Claude API error: ${claudeRes.status}`, details: errText }, 500); }
    let claudeData = await claudeRes.json();
    let usage = claudeData.usage || {};
    const actionsTaken: any[] = [];
    let responseText = '';
    let currentMessages = messages;
    // v22/v23 defense: build a set of registered tool names so hallucinated
    // tool_use blocks (e.g. for a tool that was filtered out) get rejected
    // without server-side execution.
    const registeredToolNames = new Set(tools.map((t: any) => t.name));
    let round = 0;
    while (round < 4 && claudeData.stop_reason === 'tool_use') {
      round++;
      const toolResults: any[] = [];
      for (const block of (claudeData.content || [])) {
        if (block.type === 'tool_use') {
          let result: any;
          if (!registeredToolNames.has(block.name)) {
            result = { success: false, error: `tool '${block.name}' is not available in this turn (org policy or feature flag)` };
            console.log(`v23: rejected hallucinated tool_use for '${block.name}' (not in registered tools)`);
          } else {
            result = await executeTool(sb, { dealId: deal_id, orgId, repName: rep?.full_name || '', schema }, block.name, block.input);
          }
          actionsTaken.push({ type: block.name, input: block.input, result });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result), is_error: result?.success === false });
        }
      }
      currentMessages = [...currentMessages, { role: 'assistant', content: claudeData.content }, { role: 'user', content: toolResults }];
      const follow = await callClaudeWithRetry({ model, max_tokens: 3000, temperature: 0.3, system: finalSystem, tools, messages: currentMessages });
      if (!follow.ok) break;
      claudeData = await follow.json();
      const fu = claudeData.usage || {};
      usage.input_tokens = (usage.input_tokens || 0) + (fu.input_tokens || 0);
      usage.output_tokens = (usage.output_tokens || 0) + (fu.output_tokens || 0);
    }

    for (const block of (claudeData.content || [])) {
      if (block.type === 'text') responseText += block.text;
    }
    if (!responseText && actionsTaken.length > 0) {
      responseText = actionsTaken.map((a: any) => {
        if (a.type === 'build_report') return a.result?.success === false ? `(report draft failed: ${a.result?.error || 'unknown'})` : `Drafted a report (${a.result?.total_count ?? '?'} matches).`;
        return `Action: ${a.type}`;
      }).join(' ');
    }

    const { data: assistantMsg } = await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id: ctxType === 'deal' ? deal_id : null, role: 'assistant', content: responseText, actions_taken: actionsTaken.length > 0 ? actionsTaken : [], ai_model_used: model, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens }).select('id').single();

    // v21: charge chat_web_search (3) when Perplexity actually ran, otherwise chat (1).
    // Perplexity failure path falls back to chat (1) per spec — never punish the user
    // for an upstream outage.
    const creditAction = webSearchUsed ? 'chat_web_search' : 'chat';
    const creditAmount = webSearchUsed ? 3 : 1;
    try {
      if (orgId) await sb.rpc('deduct_credits', { p_org_id: orgId, p_user_id: user_id || deal?.rep_id, p_amount: creditAmount, p_type: creditAction, p_description: `Chat (${ctxType})${webSearchUsed ? ' + web search' : ''}: ${deal?.company_name || ctxType}`, p_reference_id: null });
    } catch (e) { console.log('Credit deduction failed:', e); }

    // v21: log Perplexity outages to ai_response_log so we can monitor degraded turns.
    if (webSearchErrorKind === 'perplexity_failed') {
      try {
        await sb.from('ai_response_log').insert({
          deal_id: ctxType === 'deal' ? deal_id : null,
          response_type: 'chat_web_search_failure',
          coach_id: cid,
          ai_model_used: model,
          status: 'partial',
          error_message: webSearchPayload?.error || 'perplexity_failed',
          extraction_summary: { error_kind: 'perplexity_failed', classifier_decision: webSearchPayload?.classifier_decision, suggested_query: webSearchPayload?.suggested_query },
          triggered_by: user_id || deal?.rep_id || null,
        });
      } catch (e) { console.log('ai_response_log perplexity_failed insert error:', e); }
    }

    // v21: write deal_sources rows for each unique web_search citation Lux actually
    // emitted in this response (only for ctxType==='deal'). Cited URLs are parsed
    // from fenced ```source``` blocks in the assistant text.
    if (webSearchUsed && ctxType === 'deal' && responseText) {
      const cited = extractWebSearchCitations(responseText);
      for (const c of cited) {
        try {
          await sb.from('deal_sources').insert({
            deal_id,
            source_origin: 'ai_web_search',
            field_category: 'web_search',
            field_name: c.hostname || extractHostname(c.url) || 'web',
            confidence: 'mentioned',
            summary: c.snippet || null,
            source_url: c.url,
            source_title: c.hostname || extractHostname(c.url) || null,
            accessed_at: c.fetched_at || new Date().toISOString(),
          });
        } catch (e: any) { console.log('deal_sources web_search insert error:', e?.message); }
      }
    }

    // v20: handle correction_payload AFTER the response (non-blocking — log errors, don't fail the chat).
    // Demo-org-only: other orgs ignore correction_payload entirely.
    let correctionResult: { memory_id: string | null; sme_question_id: string | null } | null = null;
    if (correction_payload && typeof correction_payload === 'object' && correction_payload.correction_text && ctxType === 'deal' && orgId && user_id && isDemoOrg) {
      try {
        let originalAssistantText = '';
        if (correction_payload.original_message_id) {
          const { data: origMsg } = await sb.from('deal_chat_messages').select('content').eq('id', correction_payload.original_message_id).single();
          originalAssistantText = origMsg?.content || '';
        }
        correctionResult = await handleCorrectionPayload(sb, {
          dealId: deal_id,
          orgId,
          userId: user_id,
          sessionId: activeSessionId,
          originalMessageId: correction_payload.original_message_id || null,
          originalAssistantText: originalAssistantText || '(original assistant message unavailable)',
          correctionText: String(correction_payload.correction_text),
        });
      } catch (e: any) { console.log('correction handler error (non-fatal):', e?.message); }
    }

    // v20: substring-match surfacing tracker. Best-effort, non-blocking via EdgeRuntime.waitUntil where available.
    if (memoryRows.length && responseText) {
      const surfacingPromise = recordMemorySurfacing(sb, memoryRows, responseText).catch((e: any) => console.log('surfacing tracker error:', e?.message));
      // @ts-ignore — EdgeRuntime is a Deno Deploy global
      if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(surfacingPromise);
    }

    return jsonResponse({
      success: true,
      version: "v23",
      session_id: activeSessionId,
      assistant_message_id: assistantMsg?.id || null,
      context_type: ctxType,
      message: responseText,
      actions_taken: actionsTaken,
      tokens: { input: usage.input_tokens, output: usage.output_tokens },
      correction: correctionResult,
      web_search: {
        enabled: effectiveWebFlag,
        classifier_decision: effectiveWebFlag ? classifierResult.needs_web_search : null,
        used: webSearchUsed,
        error_kind: webSearchErrorKind,
        credit_action: creditAction,
      },
      // v23: when Branch A fired, surface the auto-focused deal so the
      // frontend can render the indicator chip above the assistant message.
      auto_focused: autoFocusedTurn,
      auto_focus: autoFocusPayload,
    });

  } catch (err: any) {
    console.error('deal-chat v23 error:', err);
    return jsonResponse({ error: `v23: ${err.message}`, success: false }, 500);
  }
});

async function executeTool(sb: any, ctx: { dealId?: string; orgId: string | null; repName: string; schema: Record<string, Record<string, { type: string }>> }, toolName: string, input: any) {
  try {
    switch (toolName) {
      case 'build_report': {
        const errors = validateDraft(input, ctx.schema);
        if (errors.length) {
          return { success: false, error: 'schema_error', validation_errors: errors, hint: 'Fix the field references above and call build_report again. All joined-table fields need a {join: "<table>", field: "<field>"} object and the table in included_relations.' };
        }
        const { count, rows, error } = await runReportQuery(sb, input, { org_id: ctx.orgId });
        if (error) return { success: false, error };
        const sample = (rows || []).slice(0, 5).map((r: any) => {
          const out: any = {};
          for (const k of Object.keys(r)) {
            const v = r[k];
            out[k] = typeof v === 'object' ? JSON.stringify(v).substring(0, 120) : (v == null ? null : String(v).substring(0, 120));
          }
          return out;
        });
        return { success: true, total_count: count, sample_rows: sample, config: input };
      }
      case 'create_task': {
        if (!ctx.dealId) return { success: false, error: 'no deal context' };
        const dueDate = input.due_days ? new Date(Date.now() + input.due_days * 86400000).toISOString() : null;
        const { data, error } = await sb.from('tasks').insert({ deal_id: ctx.dealId, title: input.title, priority: input.priority || 'medium', due_date: dueDate, notes: input.notes || null, auto_generated: true, completed: false, owner: ctx.repName }).select('id, title').single();
        if (error) return { success: false, error: error.message };
        return { success: true, task_id: data.id, title: data.title };
      }
      case 'update_deal_field': {
        if (!ctx.dealId) return { success: false, error: 'no deal context' };
        const { table, field, value } = input;
        if (!['deals', 'deal_analysis', 'company_profile'].includes(table)) return { success: false, error: 'Invalid table' };
        const idField = table === 'deals' ? 'id' : 'deal_id';
        const { error } = await sb.from(table).update({ [field]: value }).eq(idField, ctx.dealId);
        if (error) return { success: false, error: error.message };
        return { success: true, table, field, value };
      }
      case 'add_contact': {
        if (!ctx.dealId) return { success: false, error: 'no deal context' };
        const { data, error } = await sb.from('contacts').insert({ deal_id: ctx.dealId, name: input.name, title: input.title || null, email: input.email || null, role_in_deal: input.role_in_deal || 'Unknown', is_champion: input.is_champion || false, is_economic_buyer: input.is_economic_buyer || false }).select('id, name').single();
        if (error) return { success: false, error: error.message };
        return { success: true, contact_id: data.id, name: data.name };
      }
      case 'add_risk': {
        if (!ctx.dealId) return { success: false, error: 'no deal context' };
        const { data, error } = await sb.from('deal_risks').insert({ deal_id: ctx.dealId, risk_description: input.risk_description, category: input.category || 'deal', severity: input.severity || 'medium', source: 'chat', status: 'open' }).select('id').single();
        if (error) return { success: false, error: error.message };
        return { success: true, risk_id: data.id };
      }
      default: return { success: false, error: 'Unknown tool' };
    }
  } catch (err: any) { return { success: false, error: err.message }; }
}
