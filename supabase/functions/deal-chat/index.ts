import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// deal-chat v19
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
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function corsHeaders() { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }; }
function jsonResponse(data: any, status = 200) { return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } }); }
function clean(v: any): string { if (!v || v === 'Unknown') return 'Not available'; return String(v); }

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
// System prompts — unified assistant. The chatbot always gets methodology +
// PRODUCT_SOP + schema + (if on a deal page) deal context. page_context is
// appended as a route-specific hint.
// ---------------------------------------------------------------------------
const UNIFIED_SYSTEM_PROMPT = `You are the Revenue Instruments assistant — an always-on AI coach embedded in DealCoach. You help sales reps close more deals AND help them use the product.

WHAT YOU CAN SEE:
- The full database of the rep's deals, contacts, calls, tasks, scores, catalysts, pain points, flags, retrospectives.
- Their pipeline at a glance (all active deals, open tasks).
- The product itself — use the PRODUCT SOP below to walk them through any workflow.
- Their current page — use page_context to tailor advice ("since you're on the Coach Admin page, you can edit the assembled prompt here...").

HOW YOU OPERATE:
- Direct, concise, sourced. Bullets over paragraphs. Reference deal names, dates, exact quotes.
- For data questions (counts, lists, groupings, sums, cross-tabs), CALL the build_report tool. Don't estimate — run the query.
- For product how-to questions, walk them through step by step using PRODUCT_SOP. Reference the exact page/button.
- For methodology questions, ground answers in public-source frameworks (BANT, MEDDPICC, SPIN, Challenger, Solution Selling, Sandler, JOLT, Command of the Message). Be opinionated.
- If a question is out of scope (something the product can't do yet), say so plainly and suggest they file beta feedback (pencil icon in the chat header).
- If the user seems stuck on a page, offer to guide them: "Want me to walk you through building your first report?"
- 1-3 sentences when possible. Long only when walking through multi-step flows.

KEY DEFINITIONS (never conflate):
- Business Catalyst = high-level force driving change (funding, exec hire, M&A, regulation, system EOL, strategic initiative). NOT operational pain.
- Compelling Event = specific dated bad-thing-if-no-change. Material consequence.
- Pain Point = day-to-day operational problem.
- ICP Fit = how well the account matches the coach's ICP config (score 0-100).
- Deal Health = composite signal of engagement + momentum + risk (score 0-10).
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

function buildSystemPrompt(opts: { schemaBlock: string; dealContext: string; pipelineContext: string; pageContext: any; assembledCoachPrompt: string; ragExcerpts: string }) {
  const parts: string[] = [];
  if (opts.assembledCoachPrompt) parts.push(opts.assembledCoachPrompt);
  parts.push(UNIFIED_SYSTEM_PROMPT);
  parts.push(PRODUCT_SOP);
  parts.push(reportToolGuide(opts.schemaBlock));
  if (opts.pageContext) parts.push(pageContextBlock(opts.pageContext));
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

  const context = `DEAL: ${deal.company_name}\nStage: ${deal.stage} | Forecast: ${deal.forecast_category} | Value: $${deal.deal_value || 0} | CMRR: $${deal.cmrr || 0}\nClose: ${deal.target_close_date || 'TBD'} | Fit: ${deal.fit_score || '?'}/10 | Health: ${deal.deal_health_score || '?'}/10 | ICP: ${deal.icp_fit_score || '?'}/100\nNext Steps: ${deal.next_steps || 'None'}\n\nCOMPANY:\n${clean(company?.overview)}\nIndustry: ${clean(company?.industry)} | Revenue: ${clean(company?.revenue)} | Employees: ${clean(company?.employee_count)}\nTech Stack: ${clean(company?.tech_stack)}\nBusiness Goals: ${clean(company?.business_goals)}\nBusiness Priorities: ${clean(company?.business_priorities)}\n\nCURRENT SYSTEMS (${systems.length}):\n${systems.map((s: any) => `- ${s.system_name} [${s.system_category}]`).join('\n') || 'None'}\n\nANALYSIS:\nPains: ${clean(analysis?.pain_points)}\nQuantified: ${clean(analysis?.quantified_pain)}\nBudget: ${clean(analysis?.budget)}\nChampion: ${clean(analysis?.champion)} | EB: ${clean(analysis?.economic_buyer)}\nDecision Criteria: ${clean(analysis?.decision_criteria)}\nTimeline: ${clean(analysis?.timeline_drivers)}\n\nCONTACTS (${contacts.length}):\n${contacts.map((c: any) => `- ${c.name} | ${c.title || '?'} | ${c.role_in_deal || '?'}${c.is_champion ? ' [CHAMP]' : ''}${c.is_economic_buyer ? ' [EB]' : ''}`).join('\n') || 'None'}\n\nCOMPETITORS (${competitors.length}):\n${competitors.map((c: any) => `- ${c.competitor_name}`).join('\n') || 'None'}\n\nPAIN POINTS (${pains.length}):\n${pains.map((p: any) => `- ${p.pain_description}${p.annual_cost ? ' ($' + p.annual_cost + '/yr)' : ''}`).join('\n') || 'None'}\n\nRED FLAGS: ${redFlags.map((f: any) => f.description).join(' | ') || 'None'}\nGREEN FLAGS: ${greenFlags.map((f: any) => f.description).join(' | ') || 'None'}\n\nTASKS (${tasks.length}):\n${tasks.map((t: any) => `- [${t.completed ? 'DONE' : t.priority}] ${t.title}`).join('\n') || 'None'}\n\nCALL HISTORY (${convs.length}):\n${convs.map((c: any) => `- ${c.call_date || '?'} [${c.call_type}]: ${(c.ai_summary || '').substring(0, 200)}`).join('\n') || 'None'}\n\nEVIDENCE: ${researchSources.length} research, ${transcriptSources.length} transcript sources.`;

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

  const dealLines = (deals || []).map((d: any) => `- ${d.company_name} | ${d.stage} | ${d.forecast_category} | $${d.deal_value || 0} | Close: ${d.target_close_date || 'TBD'} | Fit: ${d.fit_score || '?'}/10 | Health: ${d.deal_health_score || '?'}/10`);
  const taskLines = (tasks || []).map((t: any) => `- [${t.priority}] ${t.title}${t.deals?.company_name ? ' (' + t.deals.company_name + ')' : ''}`);

  const context = `REP: ${profile?.full_name || 'Unknown'} (${profile?.initials || '??'})\n\nACTIVE DEALS (${(deals || []).length}):\n${dealLines.join('\n') || 'None'}\n\nOPEN TASKS (${(tasks || []).length}):\n${taskLines.join('\n') || 'None'}`;

  return { context, orgId, cid, model };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (!ANTHROPIC_API_KEY) return jsonResponse({ error: 'v19: ANTHROPIC_API_KEY not configured' }, 500);
    const { deal_id, session_id, message, user_id, context_type, page_context } = await req.json();
    const ctxType = context_type || (deal_id ? 'deal' : 'general');
    if (!message) return jsonResponse({ error: 'v19: message required' }, 400);
    if (ctxType === 'deal' && !deal_id) return jsonResponse({ error: 'v19: deal_id required for context_type=deal' }, 400);
    if (ctxType !== 'deal' && !user_id) return jsonResponse({ error: 'v19: user_id required' }, 400);

    const schema = await getSchema(sb);
    const schemaBlock = formatSchemaForPrompt(schema);

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

    let dealContext = '', pipelineContext = '', ragExcerpts = '', model = 'claude-sonnet-4-20250514', cid: string | null = null, deal: any = null, rep: any = null, orgId: string | null = null;

    if (ctxType === 'deal') {
      // Kick off context build, pipeline, and RAG in parallel.
      const [built, ragResult] = await Promise.all([
        buildDealContext(sb, deal_id),
        fetchRelevantExcerpts(sb, deal_id, message),
      ]);
      if (!built.deal) return jsonResponse({ error: 'v19: Deal not found' }, 404);
      dealContext = built.context; model = built.model; cid = built.cid; deal = built.deal; rep = built.rep;
      ragExcerpts = ragResult;
      const { data: repProfile } = await sb.from('profiles').select('org_id').eq('id', deal.rep_id).single();
      orgId = repProfile?.org_id || null;
      try {
        const pctx = await buildPipelineContext(sb, deal.rep_id);
        pipelineContext = pctx.context;
      } catch {}
    } else if (ctxType === 'pipeline') {
      const built = await buildPipelineContext(sb, user_id);
      pipelineContext = built.context; model = built.model; cid = built.cid; orgId = built.orgId;
    } else {
      // coaching / help / general — no deal, but still load lightweight pipeline
      // so the AI can reference the rep's deals if they bring one up.
      const built = await buildPipelineContext(sb, user_id);
      pipelineContext = built.context; model = built.model; cid = built.cid; orgId = built.orgId;
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

    const finalSystem = buildSystemPrompt({ schemaBlock, dealContext, pipelineContext, pageContext: page_context, assembledCoachPrompt, ragExcerpts });

    const messages = (history || []).map((m: any) => ({ role: m.role, content: m.content }));
    const tools = ctxType === 'deal' ? [...DEAL_TOOLS, REPORT_TOOL] : [REPORT_TOOL];

    const claudeRes = await callClaudeWithRetry({
      model, max_tokens: 4000, temperature: 0.3, system: finalSystem, tools, messages,
    });
    if (!claudeRes.ok) { const errText = await claudeRes.text(); return jsonResponse({ error: `v19: Claude API error: ${claudeRes.status}`, details: errText }, 500); }
    let claudeData = await claudeRes.json();
    let usage = claudeData.usage || {};
    const actionsTaken: any[] = [];
    let responseText = '';
    let currentMessages = messages;
    let round = 0;
    while (round < 4 && claudeData.stop_reason === 'tool_use') {
      round++;
      const toolResults: any[] = [];
      for (const block of (claudeData.content || [])) {
        if (block.type === 'tool_use') {
          const result = await executeTool(sb, { dealId: deal_id, orgId, repName: rep?.full_name || '', schema }, block.name, block.input);
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

    await sb.from('deal_chat_messages').insert({ session_id: activeSessionId, deal_id: ctxType === 'deal' ? deal_id : null, role: 'assistant', content: responseText, actions_taken: actionsTaken.length > 0 ? actionsTaken : [], ai_model_used: model, prompt_tokens: usage.input_tokens, completion_tokens: usage.output_tokens });

    try {
      if (orgId) await sb.rpc('deduct_credits', { p_org_id: orgId, p_user_id: user_id || deal?.rep_id, p_amount: 1, p_type: 'chat', p_description: `Chat (${ctxType}): ${deal?.company_name || ctxType}`, p_reference_id: null });
    } catch (e) { console.log('Credit deduction failed:', e); }

    return jsonResponse({ success: true, version: "v19", session_id: activeSessionId, context_type: ctxType, message: responseText, actions_taken: actionsTaken, tokens: { input: usage.input_tokens, output: usage.output_tokens } });

  } catch (err: any) {
    console.error('deal-chat v19 error:', err);
    return jsonResponse({ error: `v19: ${err.message}`, success: false }, 500);
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
