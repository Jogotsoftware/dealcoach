// dealroom-access v21
// v21 changes: Business Overview tab, the first tab a customer WRITES to.
// deal_rooms grew show_business_overview_tab (visibleTabs/tabAllowed cover
// 'business_overview'). get-tab-anon accepts tab `business_overview` (authed:
// get-business-overview-tab) and returns the deal's deal_business_overviews
// row plus the company name and a website that reads like one. Writes:
// save-business-overview-anon { share_token, patch } for the open link --
// 51 of 52 rooms are open_token, so this is the path customers actually use --
// and save-business-overview { magic_token, patch } for a named viewer. Both
// refuse an archived room or a hidden tab, check the patch's shape (flat
// snake_case keys; strings, or rows whose cells are strings; size caps) and
// merge it through the business_overview_merge RPC, so a rep and a customer
// editing different fields never overwrite each other.
//
// v20 changes: the deal payload (validate-share, validate-token) carries
// customer_logo_bg -- the optional background plate the rep put behind the
// customer logo (deals.metadata.logo_bg), so the customer's room header draws
// the logo the way the rep set it. Only that one key is read out of metadata
// (it also holds internal notes such as qdc_prep_notes), and anything that is
// not a #rrggbb hex goes out as null.
//
// v19 changes: Models payload. (1) Each model quote now carries
// discount_total, list_subtotal, blended_discount_pct, finance_charges_total
// and finance_charges_list, so the customer's cards can show List Price and
// Subscription Discount and keep a first-year-only surcharge out of later
// years, the way the rep's TCO tab does. (2) Scenarios saved on a quote's
// tco_scenarios that the rep hid (hidden: true) are dropped SERVER-SIDE, as
// hidden quotes have been since v16 -- they were shipped to the anonymous
// customer's browser and merely not drawn.
//
// v18 changes: open-access enforcement actually works. The guard tested
// room.allow_open_access, a column that does not exist on deal_rooms, so the
// expression was always `undefined === false` and never fired -- every room
// was readable by anyone holding the share token regardless of how it was
// configured. The real column is access_mode ('magic_link' | 'open_token').
// A magic_link room now requires a personal link, as its setting always said
// it did.
//
// v17 changes: the implementation schedule moved from its own tab to a section
// under Schedules, so its payload rides along with the schedules response.
// 'implementation' is no longer advertised in visibleTabs (the standalone tab
// endpoint still answers, for anything already calling it), and
// show_implementation_tab now governs whether the section is included at all
// rather than whether a tab appears.
//
// v16 changes: Models tab now returns every quote on the deal, not only those
// sharing a comparison_group_id -- a second quote used to silently never
// appear -- and quotes flagged deal_room_display_config.model_hidden are
// dropped SERVER-SIDE. They were previously included in the payload and merely
// not rendered by the client, which put a hidden quote's full financials in an
// anonymous customer's browser.
//
// v15 changes: Implementation schedule tab. deal_rooms grew
// show_implementation_tab + implementation_anchor_date; visibleTabs/tabAllowed
// cover 'implementation'. The payload stays raw (rows, the anchor override,
// and the MSP dates the anchor falls back to) so the client keeps the single
// resolveAnchor implementation in lib/implementationSchedule.js rather than
// this function growing a second copy of that rule.
//
// v14 changes: ROI calculator tab. deal_rooms grew show_roi_tab; visibleTabs/
// tabAllowed cover 'roi'. get-tab-anon accepts tab `roi` (and authed
// get-roi-tab): returns the minimal pieces the client's buildRoiSetup needs:
// quote investment totals + contract-term YoY caps (locked rows), the deal's
// current_system_cost, the lead's revenue/finance-team size, and the AE's
// saved roi_scenarios inputs. Customer-side slider changes are ephemeral by
// design: there is no write path for scenarios through this function.
//
// v12 changes: Evaluation Room app tabs. deal_rooms grew show_models_tab and
// show_schedules_tab; visibleTabs/tabAllowed now cover 'models' and 'schedules'
// (additive — DealCoach's DealRoomViewer filters a fixed 3-key list, unaffected).
// get-tab-anon accepts new tabs `quote` (Investment Summary, gated by
// show_proposal_tab), `models`, `schedules`, and `deck` (published room_proposals
// row, gated by show_proposal_tab + status='published'). Authed equivalents:
// get-quote-tab / get-models-tab / get-schedules-tab / get-deck-tab.
// Quote payloads respect quote_lines.show_in_deal_room, payment-schedule rows
// respect show_in_proposal, and implementation schedule rows are dropped when
// the deal has no SOW on file (mirrors QuoteBuilder's SowStrip gating).
//
// v10 changes: anonymous open share support. New action `validate-share` takes
// only `share_token` (no magic_token) and loads the room for an anonymous viewer.
// Anonymous viewers can read all visible tabs but cannot write (no comments, no
// change requests, no email-AE). Anonymous loads count as views (ip_hash + UA)
// but are NOT attributed to a viewer row and do NOT fire first_view notifications.
// New action `get-tab-anon` lets anonymous viewers fetch msp/library/proposal tabs
// using share_token (same payload as the magic-link variants, minus pending_requests).
// Pairs with DealRoomViewer.jsx falling back to validate-share when ?t= is absent.
//
// v8 changes: AE preview support. When the viewer row has is_ae_preview=true,
// validate-token + log-view skip view logging, viewer-counter increments, and
// first-view notifications. The AE clicks "Preview customer view" → DealRoomPreview
// finds/creates that synthetic viewer and redirects to /room/:shareToken?t=:magic
// so the customer URL is the source of truth for what the AE sees.
//
// v7 changes: per-tab visibility — deal_rooms.show_msp_tab/show_library_tab/show_proposal_tab.
// validate-token returns the filtered `tabs` array; get-*-tab requests for a hidden tab are rejected with 403.
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") || "https://aidealcoach.netlify.app"

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
function resp(d: unknown, s = 200) {
  return new Response(JSON.stringify(d), { status: s, headers: { ...cors(), 'Content-Type': 'application/json' } })
}
async function hashIp(ip: string): Promise<string> {
  if (!ip) return ''
  const data = new TextEncoder().encode('dealroom:' + ip)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}

// v20: the rep's background plate behind the customer logo -- a #rrggbb hex
// or null, never anything else out of deals.metadata.
function logoBgOf(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null
}

type Sb = ReturnType<typeof createClient>

async function loadViewer(sb: Sb, magic_token: string) {
  if (!magic_token) return { error: 'v7: magic_token required' }
  const { data: viewer, error } = await sb.from('deal_room_viewers').select('*').eq('magic_token', magic_token).maybeSingle()
  if (error) return { error: `v7: viewer lookup failed: ${error.message}` }
  if (!viewer) return { error: 'v7: invalid token' }
  const { data: room, error: roomErr } = await sb.from('deal_rooms').select('*').eq('id', viewer.deal_room_id).single()
  if (roomErr || !room) return { error: `v7: room missing for viewer` }
  if (!room.enabled) return { error: 'v7: this room is disabled' }
  const archived = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now()
  return { viewer, room, archived }
}

// v10: anonymous open share. Only share_token required — no viewer row, no email.
async function loadRoomByShare(sb: Sb, share_token: string) {
  if (!share_token) return { error: 'v10: share_token required' }
  const { data: room, error } = await sb.from('deal_rooms').select('*').eq('share_token', share_token).maybeSingle()
  if (error) return { error: `v10: room lookup failed: ${error.message}` }
  if (!room) return { error: 'v10: invalid share link' }
  if (!room.enabled) return { error: 'v10: this room is disabled' }
  // access_mode is the real column. Anything that is not explicitly
  // open_token requires a personal magic link.
  if (room.access_mode && room.access_mode !== 'open_token') {
    return { error: 'v18: this room requires a personal link — ask your AE to send you one' }
  }
  const archived = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now()
  return { room, archived }
}

function visibleTabs(room: Record<string, unknown>): string[] {
  const out: string[] = []
  if (room.show_msp_tab !== false) out.push('msp')
  if (room.show_library_tab !== false) out.push('library')
  if (room.show_proposal_tab !== false) out.push('proposal')
  if (room.show_models_tab !== false) out.push('models')
  if (room.show_schedules_tab !== false) out.push('schedules')
  if (room.show_roi_tab !== false) out.push('roi')
  if (room.show_business_overview_tab !== false) out.push('business_overview')
  return out
}

function tabAllowed(room: Record<string, unknown>, tab: string): boolean {
  if (tab === 'msp') return room.show_msp_tab !== false
  if (tab === 'library') return room.show_library_tab !== false
  // 'quote' (Investment Summary) and the slide deck share the proposal flag.
  if (tab === 'proposal' || tab === 'quote' || tab === 'deck') return room.show_proposal_tab !== false
  if (tab === 'models') return room.show_models_tab !== false
  if (tab === 'schedules') return room.show_schedules_tab !== false
  if (tab === 'roi') return room.show_roi_tab !== false
  if (tab === 'implementation') return room.show_implementation_tab !== false
  if (tab === 'business_overview') return room.show_business_overview_tab !== false
  return true
}

// v14: ROI tab payload: the minimal inputs the client-side calculator merges
// (see evaluation-room src/lib/roiPrefill.js). Every field here is already
// customer-facing elsewhere in the room or exists to be shown in the calculator.
// v15: the implementation schedule as the customer sees it. Rows are already
// customer-safe (phase names, labels, weeks, dates); the SOW contributes only
// its two stated durations, never its pricing.
async function loadImplementationTab(sb: Sb, dealId: unknown, room: Record<string, unknown>) {
  const [itemsRes, sowRes, msRes, stRes] = await Promise.all([
    sb.from('implementation_items')
      .select('id, kind, phase_name, label, start_week, end_week, start_date, end_date, date_source, color, sort_order')
      .eq('deal_id', dealId).order('sort_order'),
    sb.from('sow_documents')
      .select('duration_to_live_weeks, duration_to_complete_weeks')
      .eq('deal_id', dealId).order('created_at', { ascending: false }).limit(1),
    sb.from('msp_milestones').select('milestone_name, due_date').eq('deal_id', dealId),
    sb.from('msp_stages').select('start_date').eq('deal_id', dealId),
  ])
  if (itemsRes.error) return { error: `v15: implementation load failed: ${itemsRes.error.message}` }
  return {
    items: itemsRes.data || [],
    sow: (sowRes.data || [])[0] || null,
    room: { implementation_anchor_date: room.implementation_anchor_date ?? null },
    milestones: msRes.data || [],
    stages: stRes.data || [],
  }
}

async function loadRoiTab(sb: Sb, dealId: unknown) {
  const [quoteRes, dealRes, leadRes, scenRes] = await Promise.all([
    sb.from('quotes')
      .select('id, contract_term_id, sage_subscription_total, sage_implementation_total, signing_bonus_amount, signing_bonus_months, free_months, is_primary, created_at')
      .eq('deal_id', dealId).order('is_primary', { ascending: false }).order('created_at', { ascending: false }).limit(1),
    sb.from('deals').select('current_system_cost').eq('id', dealId).maybeSingle(),
    sb.from('bdr_leads').select('annual_revenue, accounting_team_size').eq('deal_id', dealId).limit(1).maybeSingle(),
    sb.from('roi_scenarios').select('inputs, model_version, updated_at').eq('deal_id', dealId).maybeSingle(),
  ])
  if (quoteRes.error) return { error: `v14: quote lookup failed: ${quoteRes.error.message}` }
  const quote = (quoteRes.data || [])[0] || null
  let contractTerm: Record<string, unknown> | null = null
  if (quote?.contract_term_id) {
    const { data: term } = await sb.from('contract_terms').select('yoy_caps').eq('id', quote.contract_term_id).maybeSingle()
    contractTerm = term || null
  }
  return {
    quote: quote ? {
      sage_subscription_total: quote.sage_subscription_total,
      sage_implementation_total: quote.sage_implementation_total,
      signing_bonus_amount: quote.signing_bonus_amount,
      signing_bonus_months: quote.signing_bonus_months,
      free_months: quote.free_months,
    } : null,
    contract_term: contractTerm,
    deal: { current_system_cost: dealRes.data?.current_system_cost ?? null },
    lead: leadRes.data || null,
    scenario: scenRes.data || null,
  }
}

// v12: shared read-only loaders for the quote-backed tabs. dealId comes from the
// room row, so RLS-free service-role reads stay scoped to the shared deal.
async function loadPrimaryQuote(sb: Sb, dealId: unknown) {
  const { data: quotes, error } = await sb.from('quotes')
    .select('id, name, version, status, list_subtotal, discount_total, net_total, global_discount_pct, blended_discount_pct, contract_term_id, contract_start_date, free_months, free_months_placement, billing_cadence, signing_bonus_amount, signing_bonus_months, signing_bonus_label, sage_subscription_total, sage_implementation_total, sage_total, solution_total, partner_subscription_total, partner_implementation_total, partner_total, finance_charges_total, finance_charges_list, tco_scenarios, deal_room_display_config, signer_contact_id, proposal_customer_logo_url, proposal_org_logo_url, is_primary, updated_at')
    .eq('deal_id', dealId).order('is_primary', { ascending: false }).order('created_at', { ascending: false }).limit(1)
  if (error) return { error: `v12: quote lookup failed: ${error.message}` }
  const quote = (quotes || [])[0]
  if (!quote) return { quote: null }
  // v22: implementation rows carry source/implementor_name and the quote's
  // partner blocks + lines ride along, so the customer's Investment Summary
  // can show partner pricing (MindCloud, DataBlend) beside the Sage lines.
  const [linesRes, implRes, termRes, signerRes, partnerBlocksRes, partnerLinesRes] = await Promise.all([
    sb.from('quote_lines').select('id, product_id, parent_line_id, line_order, quantity, unit_price, discount_pct, effective_discount_pct, discount_amount, extended, notes, show_in_deal_room').eq('quote_id', quote.id).order('line_order'),
    sb.from('quote_implementation_items').select('id, name, description, total_amount, billing_type, hours, rate_per_hour, estimated_start_date, estimated_completion_date, sort_order, sow_document_id, source, implementor_name').eq('quote_id', quote.id).order('sort_order'),
    quote.contract_term_id ? sb.from('contract_terms').select('id, name, term_years, yoy_caps, description').eq('id', quote.contract_term_id).maybeSingle() : Promise.resolve({ data: null }),
    quote.signer_contact_id ? sb.from('contacts').select('id, name, title').eq('id', quote.signer_contact_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('quote_partner_blocks').select('id, partner_name, term_years, billing_cadence, notes, sort_order').eq('quote_id', quote.id).order('sort_order'),
    sb.from('quote_partner_lines').select('id, block_id, sku, name, description, quantity, unit_price, discount_pct, extended, sort_order').eq('quote_id', quote.id).order('sort_order'),
  ])
  const lines = (linesRes.data || []).filter((l: Record<string, unknown>) => l.show_in_deal_room !== false)
  const productIds = [...new Set(lines.map((l: Record<string, unknown>) => l.product_id).filter(Boolean))]
  let products: unknown[] = []
  if (productIds.length) {
    const { data: prodRows } = await sb.from('products').select('id, name, sku, is_bundle').in('id', productIds)
    products = prodRows || []
  }
  return { quote, lines, products, implementation_items: implRes.data || [], contract_term: termRes.data || null, signer: signerRes.data || null, partner_blocks: partnerBlocksRes.data || [], partner_lines: partnerLinesRes.data || [] }
}

async function dealHasSow(sb: Sb, dealId: unknown): Promise<boolean> {
  const { count } = await sb.from('sow_documents').select('id', { count: 'exact', head: true }).eq('deal_id', dealId)
  return (count || 0) > 0
}

// v12: Models tab — the primary quote plus its comparison-group siblings
// (scenario quotes), each with the contract term needed for TCO math.
async function loadModelScenarios(sb: Sb, dealId: unknown) {
  const q = await loadPrimaryQuote(sb, dealId)
  if ((q as Record<string, unknown>).error) return q
  const primary = (q as Record<string, unknown>).quote as Record<string, unknown> | null
  if (!primary) return { quotes: [], contract_terms: [] }
  // v16: every quote on the deal is a model. Hidden ones are dropped here, not
  // left to the client to skip rendering.
  const { data: allQuotes } = await sb.from('quotes')
    .select('id, name, version, status, net_total, list_subtotal, discount_total, blended_discount_pct, sage_subscription_total, sage_implementation_total, partner_subscription_total, partner_implementation_total, finance_charges_total, finance_charges_list, contract_term_id, contract_start_date, free_months, free_months_placement, billing_cadence, signing_bonus_amount, signing_bonus_months, signing_bonus_label, tco_scenarios, deal_room_display_config, scenario_type, scenario_label, comparison_group_id, is_primary, created_at')
    .eq('deal_id', dealId)
  const isHidden = (row: Record<string, unknown>) =>
    !!(row?.deal_room_display_config as Record<string, unknown> | null)?.model_hidden
  // v19: a scenario the rep hid on the TCO tab never leaves the server.
  const withoutHiddenScenarios = (row: Record<string, unknown>) => ({
    ...row,
    tco_scenarios: (Array.isArray(row.tco_scenarios) ? row.tco_scenarios as Record<string, unknown>[] : [])
      .filter(t => t && !t.hidden),
  })
  let scenarioQuotes: Record<string, unknown>[] = (allQuotes || []).filter(sq => !isHidden(sq)).map(withoutHiddenScenarios)
  if (!scenarioQuotes.length) scenarioQuotes = isHidden(primary) ? [] : [withoutHiddenScenarios(primary)]
  scenarioQuotes.sort((a, b) => {
    if (!!b.is_primary !== !!a.is_primary) return b.is_primary ? 1 : -1
    return String(b.created_at || '').localeCompare(String(a.created_at || ''))
  })
  const termIds = [...new Set(scenarioQuotes.map(sq => sq.contract_term_id).filter(Boolean))]
  let terms: unknown[] = []
  if (termIds.length) {
    const { data: termRows } = await sb.from('contract_terms').select('id, name, term_years, yoy_caps, description').in('id', termIds)
    terms = termRows || []
  }
  // v22: each model quote's partner blocks and lines, so the customer's cards
  // draw a partner's recurring price and set-up the way the rep's TCO tab does.
  const modelQuoteIds = scenarioQuotes.map(sq => sq.id).filter(Boolean)
  let partnerBlocks: unknown[] = []
  let partnerLines: unknown[] = []
  let partnerSetup: unknown[] = []
  if (modelQuoteIds.length) {
    const [pb, pl, ps] = await Promise.all([
      sb.from('quote_partner_blocks').select('id, quote_id, partner_name, term_years, billing_cadence, notes, sort_order').in('quote_id', modelQuoteIds).order('sort_order'),
      sb.from('quote_partner_lines').select('id, quote_id, block_id, sku, name, description, quantity, unit_price, discount_pct, extended, sort_order').in('quote_id', modelQuoteIds).order('sort_order'),
      sb.from('quote_implementation_items').select('id, quote_id, source, implementor_name, name, total_amount, billing_type, sort_order').eq('source', 'partner').in('quote_id', modelQuoteIds).order('sort_order'),
    ])
    partnerBlocks = pb.data || []
    partnerLines = pl.data || []
    partnerSetup = ps.data || []
  }
  return { quotes: scenarioQuotes, contract_terms: terms, partner_blocks: partnerBlocks, partner_lines: partnerLines, partner_setup: partnerSetup }
}

// v21: Business Overview. The website on the deal row is sometimes a rep's
// note typed into the wrong box, so it goes out as the starting value only
// when it reads like an address (evaluation-room looksLikeWebsite: same rule).
function websiteOrNull(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s || s.length > 200 || /\s/.test(s) || !s.includes('.')) return null
  return s
}

async function loadBusinessOverview(sb: Sb, dealId: unknown) {
  const [ovRes, dealRes] = await Promise.all([
    sb.from('deal_business_overviews')
      .select('data, updated_at, updated_by_kind, updated_by_name, customer_updated_at')
      .eq('deal_id', dealId).maybeSingle(),
    sb.from('deals').select('company_name, website').eq('id', dealId).maybeSingle(),
  ])
  if (ovRes.error) return { error: `v21: business overview load failed: ${ovRes.error.message}` }
  return {
    overview: ovRes.data || null,
    deal: { company_name: dealRes.data?.company_name ?? null, website: websiteOrNull(dealRes.data?.website) },
  }
}

// A customer's patch comes from an anonymous browser, so its shape is checked
// rather than trusted: snake_case keys (evaluation-room lib/businessOverview.js
// KEY_PATTERN -- keep the two in step), each value a string or a list of rows
// whose cells are strings, with caps so one link cannot fill the table.
const BO_KEY = /^[a-z][a-z0-9_]{0,47}$/
function cleanOverviewPatch(raw: unknown): { patch?: Record<string, unknown>, error?: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'v21: patch must be an object' }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (!entries.length) return { error: 'v21: patch is empty' }
  if (entries.length > 60) return { error: 'v21: too many fields in one save' }
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) {
    if (!BO_KEY.test(k)) return { error: `v21: invalid field '${k.slice(0, 48)}'` }
    if (v === null || typeof v === 'string' || typeof v === 'number') {
      const s = v === null ? '' : String(v)
      if (s.length > 10000) return { error: `v21: '${k}' is too long` }
      out[k] = s
    } else if (Array.isArray(v)) {
      if (v.length > 200) return { error: `v21: '${k}' has too many rows` }
      const rows: Record<string, string>[] = []
      for (const row of v) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: `v21: '${k}' rows must be objects` }
        const cells = Object.entries(row as Record<string, unknown>)
        if (cells.length > 12) return { error: `v21: '${k}' rows have too many columns` }
        const clean: Record<string, string> = {}
        for (const [ck, cv] of cells) {
          if (!BO_KEY.test(ck)) return { error: `v21: invalid column '${ck.slice(0, 48)}'` }
          const s = cv == null ? '' : String(cv)
          if (s.length > 2000) return { error: `v21: '${k}.${ck}' is too long` }
          clean[ck] = s
        }
        rows.push(clean)
      }
      out[k] = rows
    } else {
      return { error: `v21: '${k}' has an unsupported value` }
    }
  }
  return { patch: out }
}

async function saveBusinessOverview(sb: Sb, room: Record<string, unknown>, archived: boolean, rawPatch: unknown, name: string | null) {
  if (archived) return resp({ error: 'v21: This room is archived. Contact the AE to make changes.' }, 403)
  if (!tabAllowed(room, 'business_overview')) return resp({ error: 'v21: this tab is not visible in this room' }, 403)
  const { patch, error } = cleanOverviewPatch(rawPatch)
  if (error || !patch) return resp({ error: error || 'v21: patch required' }, 400)
  const { data, error: rpcErr } = await sb.rpc('business_overview_merge', {
    p_deal_id: room.deal_id, p_patch: patch, p_kind: 'customer', p_name: name,
  })
  if (rpcErr) return resp({ error: `v21: save failed: ${rpcErr.message}` }, 500)
  const out = (data || {}) as Record<string, unknown>
  if (!out.ok) return resp({ error: `v21: ${out.error || 'save failed'}` }, 400)
  return resp({ ...out, ok: true })
}

function requireWrite(archived: boolean) {
  if (archived) {
    return resp({ error: 'v7: This room is archived. Contact the AE for the current proposal.' }, 403)
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors() })
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const ipHeader = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || ''
  const ipHash = await hashIp(ipHeader.split(',')[0].trim())
  const userAgent = (req.headers.get('user-agent') || '').slice(0, 300)

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty body */ }

  const action = String(body.action || '').trim()
  const magic_token = String(body.magic_token || '')
  const share_token = String(body.share_token || '')

  try {
    // v10: anonymous open share — same response shape as validate-token, minus
    // viewer attribution. Read-only. Logs a view (no viewer_id, no email).
    if (action === 'validate-share') {
      const v = await loadRoomByShare(sb, share_token)
      if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
      const { room, archived } = v as { room: Record<string, unknown>, archived: boolean }

      const { data: deal } = await sb.from('deals').select('id, company_name, customer_logo_url, logo_bg:metadata->>logo_bg, org_id, rep_id').eq('id', room.deal_id).single()
      const { data: org } = deal ? await sb.from('organizations').select('name, logo_url').eq('id', deal.org_id).single() : { data: null }
      const { data: rep } = deal?.rep_id ? await sb.from('profiles').select('full_name, email, phone').eq('id', deal.rep_id).maybeSingle() : { data: null }

      try { await sb.from('deal_room_views').insert({ deal_room_id: room.id, viewer_id: null, viewer_email: null, tab: null, user_agent: userAgent, ip_hash: ipHash }) } catch (e) { console.warn('v10: anon view log failed', e) }

      return resp({
        ok: true,
        anonymous: true,
        viewer: null,
        deal_room_id: room.id,
        share_token: room.share_token,
        deal: deal ? { company_name: deal.company_name, customer_logo_url: deal.customer_logo_url, customer_logo_bg: logoBgOf(deal.logo_bg) } : null,
        org: org ? { name: org.name, logo_url: org.logo_url } : null,
        rep: rep ? { full_name: rep.full_name, email: rep.email, phone: rep.phone } : null,
        ae_notes: room.ae_notes || null,
        ae_notes_msp: room.ae_notes_msp || null,
        ae_notes_library: room.ae_notes_library || null,
        ae_notes_proposal: room.ae_notes_proposal || null,
        theme_color: room.theme_color || null,
        theme_color_secondary: room.theme_color_secondary || null,
        theme_color_tertiary: room.theme_color_tertiary || null,
        hide_line_pricing: !!room.hide_line_pricing,
        hide_discounts: !!room.hide_discounts,
        proposal_column_visibility: room.proposal_column_visibility || null,
        tabs: visibleTabs(room),
        expires_at: room.expires_at,
        archived,
        has_proposal_snapshot: !!room.proposal_snapshot,
      })
    }

    // v10: anonymous tab fetch. Read-only — no comments, no pending requests.
    if (action === 'get-tab-anon') {
      const v = await loadRoomByShare(sb, share_token)
      if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
      const { room, archived } = v as { room: Record<string, unknown>, archived: boolean }
      const tab = String(body.tab || '')
      if (!['msp', 'library', 'proposal', 'quote', 'models', 'schedules', 'deck', 'roi', 'implementation', 'business_overview'].includes(tab)) return resp({ error: 'v10: invalid tab' }, 400)
      if (!tabAllowed(room, tab)) return resp({ error: 'v10: this tab is not visible in this room' }, 403)
      const dealId = room.deal_id

      // v21: Business Overview payload. Writes go through
      // save-business-overview-anon.
      if (tab === 'business_overview') {
        const bo = await loadBusinessOverview(sb, dealId)
        if ((bo as Record<string, unknown>).error) return resp({ error: (bo as Record<string, unknown>).error }, 500)
        return resp({ ok: true, ...bo, can_edit: !archived })
      }

      // v15: implementation schedule payload.
      if (tab === 'implementation') {
        const im = await loadImplementationTab(sb, dealId, room)
        if ((im as Record<string, unknown>).error) return resp({ error: (im as Record<string, unknown>).error }, 500)
        return resp({ ok: true, ...im })
      }

      // v14: ROI calculator payload.
      if (tab === 'roi') {
        const r = await loadRoiTab(sb, dealId)
        if ((r as Record<string, unknown>).error) return resp({ error: (r as Record<string, unknown>).error }, 500)
        return resp({ ok: true, ...r })
      }

      // v12 tabs — read-only quote-backed payloads for the Evaluation Room app.
      if (tab === 'quote' || tab === 'models') {
        const q = await loadPrimaryQuote(sb, dealId)
        if ((q as Record<string, unknown>).error) return resp({ error: (q as Record<string, unknown>).error }, 500)
        if (tab === 'models') {
          const m = await loadModelScenarios(sb, dealId)
          if ((m as Record<string, unknown>).error) return resp({ error: (m as Record<string, unknown>).error }, 500)
          return resp({ ok: true, ...m })
        }
        return resp({ ok: true, ...q })
      }
      if (tab === 'schedules') {
        const q = await loadPrimaryQuote(sb, dealId)
        if ((q as Record<string, unknown>).error) return resp({ error: (q as Record<string, unknown>).error }, 500)
        const quote = (q as Record<string, unknown>).quote as Record<string, unknown> | null
        if (!quote) return resp({ ok: true, quote: null, schedule: [], has_sow: false })
        const hasSow = await dealHasSow(sb, dealId)
        const { data: schedRows, error: schedErr } = await sb.from('quote_payment_schedule').select('id, sequence_number, payment_type, invoice_date, period_start, period_end, amount, description, line_breakdown, source, implementor_name, implementation_item_id, show_in_proposal').eq('quote_id', quote.id).order('sequence_number')
        if (schedErr) return resp({ error: `v12: schedule load failed: ${schedErr.message}` }, 500)
        const schedule = (schedRows || []).filter((r: Record<string, unknown>) => r.show_in_proposal !== false)
          .filter((r: Record<string, unknown>) => hasSow || (!r.implementation_item_id && r.source !== 'implementation'))
        const impl = room.show_implementation_tab !== false ? await loadImplementationTab(sb, dealId, room) : null
        return resp({ ok: true, quote: { id: quote.id, name: quote.name, billing_cadence: quote.billing_cadence, contract_start_date: quote.contract_start_date }, schedule, has_sow: hasSow, implementation_items: hasSow ? (q as Record<string, unknown>).implementation_items : [], implementation: impl && !(impl as Record<string, unknown>).error ? impl : null })
      }
      if (tab === 'deck') {
        const { data: deck, error: deckErr } = await sb.from('room_proposals').select('id, title, cover_headline, cover_subhead, cover_title, cover_subtitle, cover_logo_url, hero_image_url, hero_wash_color, hero_wash_opacity, theme_color, status, published_at, sections, agenda_items, intro_people, solution_map, map_legend, company_overview, slide_excluded, custom_elements, slides, updated_at').eq('deal_room_id', room.id).eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle()
        if (deckErr) return resp({ error: `v12: deck load failed: ${deckErr.message}` }, 500)
        if (!deck) return resp({ ok: true, deck: null, message: 'Proposal not yet published' })
        return resp({ ok: true, deck })
      }

      if (tab === 'msp') {
        const [stagesRes, milestonesRes] = await Promise.all([
          sb.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
          sb.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        ])
        return resp({ ok: true, stages: stagesRes.data || [], milestones: milestonesRes.data || [], pending_requests: [], comment_counts: {} })
      }
      if (tab === 'library') {
        const { data, error } = await sb.from('deal_resources').select('id, resource_type, title, notes, url, storage_path, mime_type, file_size').eq('deal_id', dealId).order('sort_order').order('created_at')
        if (error) return resp({ error: `v10: library load failed: ${error.message}` }, 500)
        return resp({ ok: true, resources: data || [] })
      }
      if (tab === 'proposal') {
        if (!room.proposal_snapshot) return resp({ ok: true, snapshot: null, message: 'Proposal not yet shared' })
        return resp({ ok: true, snapshot: room.proposal_snapshot, snapshotted_at: room.proposal_snapshotted_at })
      }
      return resp({ error: 'v10: unreachable' }, 500)
    }

    // v21: the open link may fill in the Business Overview -- and write
    // nothing else.
    if (action === 'save-business-overview-anon') {
      const v = await loadRoomByShare(sb, share_token)
      if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
      const { room, archived } = v as { room: Record<string, unknown>, archived: boolean }
      return await saveBusinessOverview(sb, room, archived, body.patch, null)
    }

    if (action === 'validate-token') {
      const v = await loadViewer(sb, magic_token)
      if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
      const { viewer, room, archived } = v as { viewer: Record<string, unknown>, room: Record<string, unknown>, archived: boolean }

      const { data: deal } = await sb.from('deals').select('id, company_name, customer_logo_url, logo_bg:metadata->>logo_bg, org_id, rep_id').eq('id', room.deal_id).single()
      const { data: org } = deal ? await sb.from('organizations').select('name, logo_url').eq('id', deal.org_id).single() : { data: null }
      const { data: rep } = deal?.rep_id ? await sb.from('profiles').select('full_name, email, phone').eq('id', deal.rep_id).maybeSingle() : { data: null }

      // AE-preview viewers don't generate analytics or notifications. The AE
      // is using the customer URL just to see what the customer would see.
      if (!viewer.is_ae_preview) {
        const wasFirstView = !viewer.last_viewed_at && (viewer.view_count || 0) === 0
        try { await sb.from('deal_room_views').insert({ deal_room_id: viewer.deal_room_id, viewer_id: viewer.id, viewer_email: viewer.email, tab: null, user_agent: userAgent, ip_hash: ipHash }) } catch (e) { console.warn('v8: view log failed', e) }
        try { await sb.from('deal_room_viewers').update({ last_viewed_at: new Date().toISOString(), view_count: (Number(viewer.view_count) || 0) + 1 }).eq('id', viewer.id) } catch (e) { console.warn('v8: viewer counter update failed', e) }
        if (wasFirstView && deal?.rep_id) {
          try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'first_view', payload: { viewer_email: viewer.email, viewer_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v8: first_view notification failed', e) }
        }
      }

      return resp({
        ok: true,
        viewer: { id: viewer.id, email: viewer.email, name: viewer.name },
        deal_room_id: viewer.deal_room_id,
        share_token: room.share_token,
        deal: deal ? { company_name: deal.company_name, customer_logo_url: deal.customer_logo_url, customer_logo_bg: logoBgOf(deal.logo_bg) } : null,
        org: org ? { name: org.name, logo_url: org.logo_url } : null,
        rep: rep ? { full_name: rep.full_name, email: rep.email, phone: rep.phone } : null,
        ae_notes: room.ae_notes || null,
        ae_notes_msp: room.ae_notes_msp || null,
        ae_notes_library: room.ae_notes_library || null,
        ae_notes_proposal: room.ae_notes_proposal || null,
        theme_color: room.theme_color || null,
        theme_color_secondary: room.theme_color_secondary || null,
        theme_color_tertiary: room.theme_color_tertiary || null,
        hide_line_pricing: !!room.hide_line_pricing,
        hide_discounts: !!room.hide_discounts,
        proposal_column_visibility: room.proposal_column_visibility || null,
        tabs: visibleTabs(room),
        expires_at: room.expires_at,
        archived,
        has_proposal_snapshot: !!room.proposal_snapshot,
      })
    }

    const v = await loadViewer(sb, magic_token)
    if ((v as Record<string, unknown>).error) return resp({ error: (v as Record<string, unknown>).error }, 401)
    const { viewer, room, archived } = v as { viewer: Record<string, unknown>, room: Record<string, unknown>, archived: boolean }
    const dealId = room.deal_id

    if (action === 'get-msp-tab') {
      if (!tabAllowed(room, 'msp')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const [stagesRes, milestonesRes, requestsRes, commentsRes] = await Promise.all([
        sb.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        sb.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        sb.from('deal_room_change_requests').select('id, target_table, target_id, requested_change, reason, status').eq('deal_room_id', viewer.deal_room_id).eq('status', 'pending'),
        sb.from('deal_room_comments').select('id, tab, reference_kind, reference_id, body, author_kind, author_name, author_email, created_at').eq('deal_room_id', viewer.deal_room_id).eq('tab', 'msp'),
      ])
      const counts: Record<string, number> = {}
      for (const c of commentsRes.data || []) {
        if (c.reference_kind && c.reference_id) {
          const key = `${c.reference_kind}:${c.reference_id}`
          counts[key] = (counts[key] || 0) + 1
        }
      }
      return resp({ ok: true, stages: stagesRes.data || [], milestones: milestonesRes.data || [], pending_requests: requestsRes.data || [], comment_counts: counts })
    }

    if (action === 'get-library-tab') {
      if (!tabAllowed(room, 'library')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const { data, error } = await sb.from('deal_resources').select('id, resource_type, title, notes, url, storage_path, mime_type, file_size').eq('deal_id', dealId).order('sort_order').order('created_at')
      if (error) return resp({ error: `v7: library load failed: ${error.message}` }, 500)
      return resp({ ok: true, resources: data || [] })
    }

    if (action === 'get-proposal-tab') {
      if (!tabAllowed(room, 'proposal')) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      if (!room.proposal_snapshot) return resp({ ok: true, snapshot: null, message: 'Proposal not yet shared' })
      return resp({ ok: true, snapshot: room.proposal_snapshot, snapshotted_at: room.proposal_snapshotted_at })
    }

    // v12: authed (magic-link) equivalents of the new anonymous tabs.
    if (action === 'get-quote-tab' || action === 'get-models-tab') {
      const tab = action === 'get-quote-tab' ? 'quote' : 'models'
      if (!tabAllowed(room, tab)) return resp({ error: 'v12: this tab is not visible in this room' }, 403)
      const q = await loadPrimaryQuote(sb, dealId)
      if ((q as Record<string, unknown>).error) return resp({ error: (q as Record<string, unknown>).error }, 500)
      if (tab === 'models') {
        const m = await loadModelScenarios(sb, dealId)
        if ((m as Record<string, unknown>).error) return resp({ error: (m as Record<string, unknown>).error }, 500)
        return resp({ ok: true, ...m })
      }
      return resp({ ok: true, ...q })
    }
    if (action === 'get-implementation-tab') {
      if (!tabAllowed(room, 'implementation')) return resp({ error: 'v15: this tab is not visible in this room' }, 403)
      const im = await loadImplementationTab(sb, dealId, room)
      if ((im as Record<string, unknown>).error) return resp({ error: (im as Record<string, unknown>).error }, 500)
      return resp({ ok: true, ...im })
    }
    if (action === 'get-roi-tab') {
      if (!tabAllowed(room, 'roi')) return resp({ error: 'v14: this tab is not visible in this room' }, 403)
      const r = await loadRoiTab(sb, dealId)
      if ((r as Record<string, unknown>).error) return resp({ error: (r as Record<string, unknown>).error }, 500)
      return resp({ ok: true, ...r })
    }
    if (action === 'get-schedules-tab') {
      if (!tabAllowed(room, 'schedules')) return resp({ error: 'v12: this tab is not visible in this room' }, 403)
      const q = await loadPrimaryQuote(sb, dealId)
      if ((q as Record<string, unknown>).error) return resp({ error: (q as Record<string, unknown>).error }, 500)
      const quote = (q as Record<string, unknown>).quote as Record<string, unknown> | null
      if (!quote) return resp({ ok: true, quote: null, schedule: [], has_sow: false })
      const hasSow = await dealHasSow(sb, dealId)
      const { data: schedRows, error: schedErr } = await sb.from('quote_payment_schedule').select('id, sequence_number, payment_type, invoice_date, period_start, period_end, amount, description, line_breakdown, source, implementor_name, implementation_item_id, show_in_proposal').eq('quote_id', quote.id).order('sequence_number')
      if (schedErr) return resp({ error: `v12: schedule load failed: ${schedErr.message}` }, 500)
      const schedule = (schedRows || []).filter((r: Record<string, unknown>) => r.show_in_proposal !== false)
        .filter((r: Record<string, unknown>) => hasSow || (!r.implementation_item_id && r.source !== 'implementation'))
      const implA = room.show_implementation_tab !== false ? await loadImplementationTab(sb, dealId, room) : null
      return resp({ ok: true, quote: { id: quote.id, name: quote.name, billing_cadence: quote.billing_cadence, contract_start_date: quote.contract_start_date }, schedule, has_sow: hasSow, implementation_items: hasSow ? (q as Record<string, unknown>).implementation_items : [], implementation: implA && !(implA as Record<string, unknown>).error ? implA : null })
    }
    if (action === 'get-deck-tab') {
      if (!tabAllowed(room, 'deck')) return resp({ error: 'v12: this tab is not visible in this room' }, 403)
      const { data: deck, error: deckErr } = await sb.from('room_proposals').select('id, title, cover_headline, cover_subhead, cover_title, cover_subtitle, cover_logo_url, hero_image_url, hero_wash_color, hero_wash_opacity, theme_color, status, published_at, sections, agenda_items, intro_people, solution_map, map_legend, company_overview, slide_excluded, custom_elements, slides, updated_at').eq('deal_room_id', viewer.deal_room_id).eq('status', 'published').order('published_at', { ascending: false }).limit(1).maybeSingle()
      if (deckErr) return resp({ error: `v12: deck load failed: ${deckErr.message}` }, 500)
      if (!deck) return resp({ ok: true, deck: null, message: 'Proposal not yet published' })
      return resp({ ok: true, deck })
    }

    // v21: Business Overview for a named viewer, whose edits carry their name.
    if (action === 'get-business-overview-tab') {
      if (!tabAllowed(room, 'business_overview')) return resp({ error: 'v21: this tab is not visible in this room' }, 403)
      const bo = await loadBusinessOverview(sb, dealId)
      if ((bo as Record<string, unknown>).error) return resp({ error: (bo as Record<string, unknown>).error }, 500)
      return resp({ ok: true, ...bo, can_edit: !archived })
    }
    if (action === 'save-business-overview') {
      return await saveBusinessOverview(sb, room, archived, body.patch, String(viewer.name || viewer.email || '') || null)
    }

    if (action === 'add-comment') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const tab = String(body.tab || 'general')
      if (!['msp', 'library', 'proposal', 'general'].includes(tab)) return resp({ error: 'v7: invalid tab' }, 400)
      if (tab !== 'general' && !tabAllowed(room, tab)) return resp({ error: 'v7: this tab is not visible in this room' }, 403)
      const txt = String(body.body || '').trim()
      if (!txt) return resp({ error: 'v7: comment body required' }, 400)
      const { data, error } = await sb.from('deal_room_comments').insert({
        deal_room_id: viewer.deal_room_id, parent_comment_id: body.parent_comment_id || null,
        tab, reference_kind: body.reference_kind || null, reference_id: body.reference_id || null,
        author_kind: 'viewer', author_email: viewer.email, author_name: viewer.name, body: txt,
      }).select('id').single()
      if (error) return resp({ error: `v7: comment insert failed: ${error.message}` }, 500)
      return resp({ ok: true, comment_id: data?.id })
    }

    if (action === 'request-change') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const target_table = String(body.target_table || '')
      const target_id = String(body.target_id || '')
      const requested_change = body.requested_change
      const reason = body.reason ? String(body.reason) : null
      if (!['msp_milestones', 'msp_stages'].includes(target_table)) return resp({ error: 'v7: invalid target_table' }, 400)
      if (!tabAllowed(room, 'msp')) return resp({ error: 'v7: project plan is not visible in this room' }, 403)
      if (!target_id) return resp({ error: 'v7: target_id required' }, 400)
      if (!requested_change || typeof requested_change !== 'object') return resp({ error: 'v7: requested_change must be an object' }, 400)
      const fieldWhitelist: Record<string, string[]> = {
        msp_milestones: ['due_date', 'date_label', 'status', 'milestone_name', 'notes'],
        msp_stages: ['start_date', 'end_date', 'due_date', 'date_label', 'duration', 'stage_name', 'status', 'notes'],
      }
      const field = String((requested_change as Record<string, unknown>).field || '')
      if (!fieldWhitelist[target_table].includes(field)) return resp({ error: `v7: field '${field}' not allowed for ${target_table}` }, 400)
      const { data, error } = await sb.from('deal_room_change_requests').insert({
        deal_room_id: viewer.deal_room_id, target_table, target_id, requested_change, reason, status: 'pending',
        requester_email: viewer.email, requester_name: viewer.name,
      }).select('id').single()
      if (error) return resp({ error: `v7: change request insert failed: ${error.message}` }, 500)
      return resp({ ok: true, request_id: data?.id })
    }

    if (action === 'email-ae') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const subject = String(body.subject || '').trim()
      const text = String(body.body || '').trim()
      if (!subject || !text) return resp({ error: 'v7: subject and body required' }, 400)
      const { data: deal } = await sb.from('deals').select('rep_id, company_name').eq('id', dealId).single()
      if (deal?.rep_id) {
        try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'email_ae', payload: { subject, body: text, viewer_email: viewer.email, viewer_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v7: email-ae notification failed', e) }
      }
      try { await sb.from('deal_room_comments').insert({ deal_room_id: viewer.deal_room_id, tab: 'general', author_kind: 'viewer', author_email: viewer.email, author_name: viewer.name, body: subject + '\n\n' + text }) } catch (e) { console.warn('v7: email-ae comment failed', e) }
      return resp({ ok: true })
    }

    if (action === 'add-viewer') {
      const archivedResp = requireWrite(archived); if (archivedResp) return archivedResp
      const email = String(body.email || '').trim().toLowerCase()
      const name = body.name ? String(body.name) : null
      if (!email) return resp({ error: 'v7: email required' }, 400)
      const { data: existing } = await sb.from('deal_room_viewers').select('id, magic_token').eq('deal_room_id', viewer.deal_room_id).eq('email', email).maybeSingle()
      if (existing) {
        const link = `${APP_BASE_URL}/room/${room.share_token}?t=${existing.magic_token}`
        return resp({ ok: true, viewer_id: existing.id, magic_link: link, already_existed: true })
      }
      const { data: newViewer, error } = await sb.from('deal_room_viewers').insert({
        deal_room_id: viewer.deal_room_id, email, name, added_by: viewer.email,
      }).select('id, magic_token').single()
      if (error) return resp({ error: `v7: viewer insert failed: ${error.message}` }, 500)
      const { data: deal } = await sb.from('deals').select('rep_id, company_name').eq('id', dealId).single()
      if (deal?.rep_id) {
        try { await sb.from('deal_room_notifications').insert({ deal_room_id: viewer.deal_room_id, ae_user_id: deal.rep_id, kind: 'viewer_added', payload: { added_email: email, added_name: name, by_email: viewer.email, by_name: viewer.name, deal_company: deal.company_name } }) } catch (e) { console.warn('v7: viewer_added notification failed', e) }
      }
      const link = `${APP_BASE_URL}/room/${room.share_token}?t=${newViewer.magic_token}`
      return resp({ ok: true, viewer_id: newViewer.id, magic_link: link })
    }

    if (action === 'log-view') {
      const tab = String(body.tab || '')
      // AE-preview viewers don't show up in tab analytics either.
      if (!viewer.is_ae_preview) {
        try { await sb.from('deal_room_views').insert({ deal_room_id: viewer.deal_room_id, viewer_id: viewer.id, viewer_email: viewer.email, tab: tab || null, user_agent: userAgent, ip_hash: ipHash }) } catch (e) { console.warn('v8: log-view failed', e) }
        try { await sb.from('deal_room_viewers').update({ last_viewed_at: new Date().toISOString() }).eq('id', viewer.id) } catch (e) { console.warn('v8: log-view counter failed', e) }
      }
      return resp({ ok: true })
    }

    return resp({ error: `v8: unknown action '${action}'` }, 400)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('v7 fatal:', msg)
    return resp({ error: `v7: ${msg}` }, 500)
  }
})
