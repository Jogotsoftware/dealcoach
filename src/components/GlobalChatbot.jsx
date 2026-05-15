import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { callDealChat } from '../lib/webhooks'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { track } from '../lib/analytics'
import { theme as T } from '../lib/theme'
import BetaFeedbackModal from './BetaFeedbackModal'
import { executeReportQueryStandalone } from '../pages/Reports'
import { escalateToSme, recordSmeCitation } from '../lib/sme'

// Curated demo overrides — when the user (in a demo org) asks one of these
// patterns, short-circuit the chat backend and return the canned response so
// the demo narrative stays bullet-proof. Without this, Lux's RAG can surface
// unrelated deals (Riverside, Cargo) instead of the Chaberton + Campfire
// story the demo turns on.
const DEMO_CHAT_OVERRIDES = [
  {
    pattern: /\b(best (chance|shot|probability) (of |to )?clos|closes? (soon|next|first|this (month|quarter))|most likely to clos|highest (chance|probability|confidence)|likely to clos)/i,
    response: `**Chaberton Energy** — your highest-conviction deal in the next 30 days.

**Why it's likely to close:**
- **Compelling Event verified** — their NetSuite contract renewal lands Sept 30. Hard date, hard money, board-mandated decision.
- **Strong product fit** — multi-entity consolidation + project costing maps cleanly to Intacct's strengths.
- **Champion + Economic Buyer engaged** — Joe has both threaded across 4 conversations.

**The risk to manage:**
- **Campfire came in at ~1/4 of our price.** The buyer told Joe he was going with them — he only paused when Joe asked if we could revise the numbers. The deal is alive *because* of that opening, but the gap is real and we need to close it fast.

**Recommended next move:** see how you can bridge the gap on pricing — open the Deal Room to review the quote, restructure terms (multi-year ramp, timing of services, modules), and post a revised proposal back into the customer portal.`,
    navActions: [
      { label: 'Open Deal Room', route: '/deal/16b2bf8d-ba97-4a02-b614-246603c3e48b/room', kind: 'navigate' },
      { label: 'View Chaberton Deal', route: '/deal/16b2bf8d-ba97-4a02-b614-246603c3e48b', kind: 'navigate' },
    ],
  },
  {
    pattern: /\b(biggest risk|main risk|what.{0,8}risk|risks? (in|on|to) (this |my )?(pipeline|chaberton|deal))/i,
    response: `The biggest risk in your pipeline right now is on **Chaberton Energy** — the Campfire price gap.

**The situation:** Campfire bid roughly **1/4 of our list price**. The buyer told Joe he was going with them; the deal is only still open because Joe asked if we could revise.

**Why it's still winnable:**
- Compelling Event is verified (NetSuite renewal Sept 30 — hard date)
- Product fit on multi-entity consolidation + project costing favors us
- Champion + Economic Buyer are both threaded

**What needs to happen this week:**
1. Restructure the quote — multi-year ramp, services timing, module unbundling
2. Land the multi-entity TCO story before Selection
3. Revised proposal back into the customer portal in the Deal Room`,
    navActions: [
      { label: 'Open Deal Room', route: '/deal/16b2bf8d-ba97-4a02-b614-246603c3e48b/room', kind: 'navigate' },
    ],
  },
  {
    pattern: /\b(chaberton|netsuite renewal|campfire)/i,
    response: `**Chaberton Energy** is Joe Pacheco's flagship Q3 deal.

**Compelling Event:** NetSuite contract renewal — Sept 30 hard date, board-mandated.

**Risk:** **Campfire came in at ~1/4 of our price.** The buyer told Joe he was going with them; only paused when Joe asked if we could revise. The deal is alive *because* of that opening — but we need to close the gap fast.

**Why we still win:** strong product fit on multi-entity consolidation + project costing, both Champion and Economic Buyer threaded across 4 conversations.

**Next move:** open the Deal Room, restructure the quote (multi-year ramp, services timing, modules), post a revised proposal.`,
    navActions: [
      { label: 'Open Deal Room', route: '/deal/16b2bf8d-ba97-4a02-b614-246603c3e48b/room', kind: 'navigate' },
      { label: 'View Chaberton Deal', route: '/deal/16b2bf8d-ba97-4a02-b614-246603c3e48b', kind: 'navigate' },
    ],
  },
]

function findDemoOverride(userMsg) {
  if (!userMsg) return null
  for (const o of DEMO_CHAT_OVERRIDES) {
    if (o.pattern.test(userMsg)) return o
  }
  return null
}

// PR A (thinking indicator): inline component, 3-dot Carolina-blue pulse.
// Keyframes live in src/styles/index.css (also handles prefers-reduced-motion).
function ThinkingDots() {
  const dot = (i) => ({
    width: 6, height: 6, borderRadius: '50%', background: '#5DADE2',
    animation: `lux-thinking-pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
  })
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 4px', height: 20 }}>
      <span className="lux-thinking-dot" style={dot(0)} />
      <span className="lux-thinking-dot" style={dot(1)} />
      <span className="lux-thinking-dot" style={dot(2)} />
    </div>
  )
}

// v21 / SME: detect when Lux can't confidently answer, so the "Ask the team"
// affordance renders prominently inline. Catches both hard "I don't know"
// signals AND softer hedges ("varies by company", "you'll need to confirm",
// "depends on your org") that are equally good triggers for escalation.
const LOW_CONFIDENCE_REGEX = /\b(i (?:do(?:n'?| no)?t know|am not sure|don'?t have access|cannot determine|can'?t (?:say|tell|confirm)|don'?t have visibility)|outside (?:my|the scope)|can'?t say for sure|might want to verify|should be escalated|escalat(?:e|ing) to|ask (?:an? )?(?:sme|subject matter expert|expert|teammate|the team)|varies (?:by|widely)|depends on (?:your|the (?:specific|exact))|you'?ll need to (?:confirm|check|verify|ask)|this (?:might|could) be documented|reach out to (?:your|a) (?:manager|lead|sme|expert))\b/i

// Also fire the inline "Ask the team" card when the USER's last message
// indicates they want to escalate, even if Lux's response wasn't itself a hedge.
// e.g. user typed "if you don't know, escalate this" — the helpful move is to
// render the one-click submit button right there, not make them hunt for it.
const USER_ESCALATION_REGEX = /\b(ask (?:an? )?(?:sme|subject matter expert|expert|teammate|the team)|escalat(?:e|ed|ing|ion)|need (?:an? )?(?:expert|sme|human))\b/i

// Pull fenced ```report {json}``` blocks out of an assistant message.
// Returns { displayText, drafts[] } — drafts array can have 0+ entries.
function parseReportBlocks(content) {
  if (!content) return { displayText: content || '', drafts: [] }
  const drafts = []
  const displayText = content.replace(/```report\s*([\s\S]*?)```/g, (_, raw) => {
    try {
      const cfg = JSON.parse(raw.trim())
      drafts.push(cfg)
      return ''
    } catch { return '' }
  }).trim()
  return { displayText, drafts }
}

// v21: pull fenced ```source {json}``` blocks out of an assistant message.
// Each block represents a single citation (web_search, sme_answer, etc.).
// We replace it with a placeholder token and render an inline pill via the
// SourcePill component when displaying.
function parseSourceBlocks(content) {
  if (!content) return { segments: [{ kind: 'text', value: '' }], sources: [] }
  const sources = []
  const segments = []
  let cursor = 0
  const re = /```source\s*\n([\s\S]*?)\n```/g
  let m
  while ((m = re.exec(content)) !== null) {
    if (m.index > cursor) segments.push({ kind: 'text', value: content.slice(cursor, m.index) })
    try {
      const parsed = JSON.parse(m[1].trim())
      const idx = sources.length
      sources.push(parsed)
      segments.push({ kind: 'source', idx })
    } catch {
      // Malformed block — show the raw text so the user can see something is off.
      segments.push({ kind: 'text', value: m[0] })
    }
    cursor = m.index + m[0].length
  }
  if (cursor < content.length) segments.push({ kind: 'text', value: content.slice(cursor) })
  return { segments, sources }
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

// v21: small inline pill for a parsed source block. type='web_search' opens
// the URL; type='sme_answer' will deep-link to /sme/question/:id once that
// route ships in PR 4 (renders as a non-clickable badge for now).
function SourcePill({ src }) {
  const t = src?.type
  if (t === 'web_search' && src.url) {
    const host = src.hostname || hostnameOf(src.url) || 'web'
    return (
      <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.snippet || src.url}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, margin: '0 2px', padding: '1px 6px', borderRadius: 10, background: T.primaryLight || 'rgba(93,173,226,0.12)', border: `1px solid ${T.primary}40`, color: T.primary, fontSize: 9, fontWeight: 600, textDecoration: 'none', verticalAlign: 'middle' }}>
        {host}
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
      </a>
    )
  }
  if (t === 'sme_answer' && src.sme_question_id) {
    const name = src.sme_name || 'SME'
    const date = (src.answered_at || '').slice(0, 10)
    const helpful = typeof src.helpful_marks === 'number' ? ` · ${src.helpful_marks} helpful` : ''
    return (
      <a href={`/sme/question/${src.sme_question_id}`} title={`SME answer · ${name}${helpful}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, margin: '0 2px', padding: '1px 6px', borderRadius: 10, background: '#fef3c7', border: `1px solid #f59e0b40`, color: '#92400e', fontSize: 9, fontWeight: 600, textDecoration: 'none', verticalAlign: 'middle' }}>
        SME: {name}{date ? ` · ${date}` : ''}{helpful}
      </a>
    )
  }
  return null
}

const HIDDEN_ROUTES = ['/login']
const HIDDEN_PREFIXES = ['/projectplan/shared/', '/msp/shared/', '/partner']

const THUMBS_DOWN_REASONS = [
  { key: 'wrong_info', label: 'Wrong info' },
  { key: 'not_helpful', label: 'Not helpful' },
  { key: 'off_topic', label: 'Off topic' },
  { key: 'other', label: 'Other' },
]

function relativeTime(date) {
  if (!date) return ''
  const diffMs = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// Pick a context hint from the current route so the AI knows where the user
// is without making them choose from a pill menu. page_name is handed to the
// edge function so the AI can give page-specific guidance from its SOP library.
function routeContext(pathname) {
  const dealMatch = pathname.match(/^\/deal\/([0-9a-f-]{36})/)
  if (dealMatch) {
    if (pathname.includes('/call/')) return { contextType: 'deal', dealId: dealMatch[1], pageName: 'call_detail', hint: 'reviewing a call recording / transcript' }
    if (pathname.endsWith('/msp')) return { contextType: 'deal', dealId: dealMatch[1], pageName: 'msp_page', hint: 'on the Project Plan page' }
    if (pathname.includes('/quote/')) return { contextType: 'deal', dealId: dealMatch[1], pageName: 'quote_editor', hint: 'editing a quote' }
    if (pathname.endsWith('/proposal')) return { contextType: 'deal', dealId: dealMatch[1], pageName: 'proposal_builder', hint: 'on the proposal builder' }
    if (pathname.endsWith('/retrospective')) return { contextType: 'deal', dealId: dealMatch[1], pageName: 'deal_retrospective', hint: 'reviewing a closed deal retrospective' }
    return { contextType: 'deal', dealId: dealMatch[1], pageName: 'deal_detail', hint: 'on a deal page' }
  }
  if (pathname === '/deal/new') return { contextType: 'general', dealId: null, pageName: 'new_deal', hint: 'creating a new deal' }
  if (pathname === '/reports') return { contextType: 'general', dealId: null, pageName: 'reports', hint: 'on the reports page' }
  if (pathname === '/coach/builder') return { contextType: 'coaching', dealId: null, pageName: 'coach_builder', hint: 'in the Coach Builder wizard' }
  if (pathname === '/coach') return { contextType: 'coaching', dealId: null, pageName: 'coach_admin', hint: 'in Coach Admin' }
  if (pathname === '/settings' || pathname.startsWith('/settings/team')) return { contextType: 'help', dealId: null, pageName: 'settings', hint: 'on the settings page' }
  if (pathname.startsWith('/settings/organization')) return { contextType: 'help', dealId: null, pageName: 'org_settings', hint: 'on organization settings' }
  if (pathname.startsWith('/admin/widgets')) return { contextType: 'help', dealId: null, pageName: 'widget_builder', hint: 'in the Widget Builder' }
  if (pathname.startsWith('/admin/invitations')) return { contextType: 'help', dealId: null, pageName: 'invitations', hint: 'managing invitations' }
  if (pathname.startsWith('/admin/feedback')) return { contextType: 'help', dealId: null, pageName: 'beta_feedback', hint: 'reviewing beta feedback' }
  if (pathname.startsWith('/admin/extraction-definitions')) return { contextType: 'help', dealId: null, pageName: 'extraction_definitions', hint: 'on AI extraction rules' }
  if (pathname.startsWith('/admin')) return { contextType: 'help', dealId: null, pageName: 'admin_console', hint: 'in the admin console' }
  if (pathname === '/onboarding') return { contextType: 'help', dealId: null, pageName: 'onboarding', hint: 'in onboarding' }
  if (pathname === '/' || pathname.startsWith('/pipeline')) return { contextType: 'pipeline', dealId: null, pageName: 'pipeline', hint: 'on the pipeline page' }
  return { contextType: 'general', dealId: null, pageName: 'unknown', hint: null }
}

export default function GlobalChatbot() {
  const { profile, refreshProfile, setProfile } = useAuth()
  const { org, allowChatWebSearch, enableChatReports, isDemoOrg } = useOrg() || {}
  // v21 web search toggle. Optimistic local mirror of profile.chat_web_search_enabled.
  const webOn = !!profile?.chat_web_search_enabled
  async function toggleWebSearch() {
    if (!profile?.id) return
    const next = !webOn
    if (setProfile) setProfile({ ...profile, chat_web_search_enabled: next })
    const { error } = await supabase.from('profiles').update({ chat_web_search_enabled: next }).eq('id', profile.id)
    if (error) {
      console.error('toggleWebSearch failed:', error)
      if (setProfile) setProfile({ ...profile, chat_web_search_enabled: !next }) // rollback
      return
    }
    if (refreshProfile) refreshProfile()
    track('chatbot_web_search_toggled', { enabled: next })
  }
  // v21 Correct-this modal state.
  const [correctionFor, setCorrectionFor] = useState(null) // { messageId, originalText }
  const [correctionText, setCorrectionText] = useState('')
  const [correctionSubmitting, setCorrectionSubmitting] = useState(false)
  const [correctionToast, setCorrectionToast] = useState(null)
  // SME: Ask-an-SME modal state + recorded-citations debounce set.
  const [askSmeOpen, setAskSmeOpen] = useState(false)
  const [askSmePrefill, setAskSmePrefill] = useState('')
  const [askSmeSubmitting, setAskSmeSubmitting] = useState(false)
  const [askSmeToast, setAskSmeToast] = useState(null)
  const recordedCitationsRef = useRef(new Set())

  async function openAskSme(prefill) {
    setAskSmePrefill(prefill || '')
    setAskSmeOpen(true)
  }
  async function submitAskSme() {
    const text = (askSmePrefill || '').trim()
    if (!text || askSmeSubmitting) return
    setAskSmeSubmitting(true)
    const r = await escalateToSme({
      user_id: profile?.id, org_id: profile?.org_id,
      deal_id: activeDealId || null,
      chat_session_id: sessionId || null,
      chat_message_id: null,
      question_text: text,
    })
    setAskSmeSubmitting(false)
    if (r?.error) { setAskSmeToast({ kind: 'error', text: 'Escalation failed: ' + r.error }); return }
    const tag = r?.routed_tag ? ` (${r.routed_tag})` : ''
    setAskSmeToast({ kind: 'ok', text: r?.routed_to_sme_id ? `Sent to an SME${tag}. You'll be notified when they answer.` : 'Queued. An admin will route this question manually.' })
    setAskSmeOpen(false); setAskSmePrefill('')
    track('chatbot_sme_escalated', { has_deal: !!activeDealId, routed: !!r?.routed_to_sme_id })
    setTimeout(() => setAskSmeToast(null), 5000)
  }
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [dealPickerOpen, setDealPickerOpen] = useState(false)
  const [deals, setDeals] = useState([])
  const [dealSearch, setDealSearch] = useState('')
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpQuery, setJumpQuery] = useState('')
  const [jumpQuotes, setJumpQuotes] = useState([])
  const [recentPages, setRecentPages] = useState(() => {
    try { return JSON.parse(localStorage.getItem('chatbot.recent_pages') || '[]') } catch { return [] }
  })
  const [overrideDealId, setOverrideDealId] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  // PR B: auto-focus pending card. When deal-chat returns a switch_suggestion or
  // clarifying_question payload, we hold the card here and render after the user
  // message until they pick a branch. lastSentMessage stores the original user
  // text so re-firing on button click is exact.
  const [pendingFocusCard, setPendingFocusCard] = useState(null)
  const [lastSentMessage, setLastSentMessage] = useState('')
  // PR A: thinking indicator. Shown only after a 200ms grace so trivial sub-200ms
  // responses don't flash a wasted indicator.
  const [showThinking, setShowThinking] = useState(false)
  useEffect(() => {
    if (!sending) { setShowThinking(false); return }
    const t = setTimeout(() => setShowThinking(true), 200)
    return () => clearTimeout(t)
  }, [sending])
  const [feedbackState, setFeedbackState] = useState({})
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const messagesEndRef = useRef(null)

  const { contextType: routeContextType, dealId: routeDealId, pageName: routePageName, hint: routeHint } = routeContext(location.pathname)
  // Active deal: explicit override (user picked one) wins, otherwise inferred from route
  const activeDealId = overrideDealId ?? routeDealId
  const activeContextType = overrideDealId ? 'deal' : routeContextType

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  // SME citation recording: scan new assistant messages for fenced sme_answer
  // source blocks and fire record-sme-citation once per (question, message) tuple.
  useEffect(() => {
    if (!profile?.id) return
    for (const m of messages) {
      if (m.role !== 'assistant' || !m.id || !m.content) continue
      const { sources } = parseSourceBlocks(m.content)
      for (const s of (sources || [])) {
        if (s?.type !== 'sme_answer' || !s.sme_question_id) continue
        const key = `${s.sme_question_id}:${m.id}`
        if (recordedCitationsRef.current.has(key)) continue
        recordedCitationsRef.current.add(key)
        recordSmeCitation({ sme_question_id: s.sme_question_id, citing_user_id: profile.id, citing_chat_message_id: m.id })
          .catch(e => console.warn('record-sme-citation failed (non-fatal):', e))
      }
    }
  }, [messages, profile?.id])

  // Track recent visited routes in localStorage so the Jump panel can show them.
  useEffect(() => {
    const path = location.pathname
    if (HIDDEN_ROUTES.includes(path)) return
    if (HIDDEN_PREFIXES.some(p => path.startsWith(p))) return

    const ctx = routeContext(path)
    const pageLabel = (ctx.pageName || 'page').replace(/_/g, ' ')
    let label = pageLabel
    if (ctx.dealId) {
      const d = deals.find(x => x.id === ctx.dealId)
      label = d ? `${d.company_name} · ${pageLabel}` : `Deal · ${pageLabel}`
    } else if (path === '/') label = 'Pipeline'

    setRecentPages(prev => {
      const next = [{ path, label, ts: Date.now() }, ...prev.filter(p => p.path !== path)].slice(0, 10)
      try { localStorage.setItem('chatbot.recent_pages', JSON.stringify(next)) } catch { /* ignore quota errors */ }
      return next
    })
  }, [location.pathname, deals])

  const path = location.pathname
  if (HIDDEN_ROUTES.includes(path) || HIDDEN_PREFIXES.some(p => path.startsWith(p))) return null

  async function loadSessions() {
    if (!profile?.id) return
    const { data } = await supabase.from('deal_chat_sessions').select('id, title, context_type, deal_id, created_at')
      .eq('user_id', profile.id).order('updated_at', { ascending: false }).limit(5)
    setSessions(data || [])
  }

  async function loadDeals() {
    if (!profile?.id) return
    const { data } = await supabase.from('deals').select('id, company_name, stage')
      .eq('rep_id', profile.id).not('stage', 'in', '(closed_won,closed_lost,disqualified)')
      .order('updated_at', { ascending: false }).limit(100)
    setDeals(data || [])
  }

  async function loadQuotesForJump() {
    if (!profile?.id) return
    const { data } = await supabase.from('quotes')
      .select('id, name, deal_id, status, is_primary, deals(company_name)')
      .order('updated_at', { ascending: false })
      .limit(80)
    setJumpQuotes(data || [])
  }

  async function openJump() {
    setJumpOpen(true)
    setJumpQuery('')
    if (deals.length === 0) await loadDeals()
    await loadQuotesForJump()
  }

  function navigateAndClose(path) {
    setJumpOpen(false)
    setOpen(false)
    navigate(path)
  }

  async function openBot() {
    setOpen(true)
    track('chatbot_opened', { route: location.pathname, auto_context: activeContextType })
    loadSessions()
  }

  function newChat() {
    setMessages([])
    setSessionId(null)
    setFeedbackState({})
    setOverrideDealId(null)
  }

  async function openSession(sess) {
    setOverrideDealId(sess.deal_id || null)
    setSessionId(sess.id)
    const { data } = await supabase.from('deal_chat_messages').select('*').eq('session_id', sess.id).order('created_at')
    setMessages(data || [])
    setSessionsOpen(false)
  }

  async function sendMessage(opts) {
    const opt = opts || {}
    const text = (opt.overrideText !== undefined ? opt.overrideText : input).trim()
    if (!text || sending) return

    if (opt.overrideText === undefined) setInput('')
    setSending(true)
    setPendingFocusCard(null)
    setLastSentMessage(text)
    track('chatbot_message_sent', { context_type: activeContextType, has_deal: !!activeDealId, message_length: text.length, re_fired: !!opt.refire })
    if (!opt.skipLocalUserInsert) setMessages(prev => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])

    // Demo override — short-circuit specific intents in demo orgs with curated
    // responses so the demo narrative is bullet-proof. Without this Lux hits
    // the real RAG and may surface unrelated deals (Riverside, Cargo) instead
    // of the Chaberton + Campfire story the demo turns on.
    if (isDemoOrg) {
      const override = findDemoOverride(text)
      if (override) {
        await new Promise(r => setTimeout(r, 900)) // hold the sun spinner for a beat
        setSending(false)
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: override.response,
          actions_taken: [],
          nav_actions: override.navActions || [],
          created_at: new Date().toISOString(),
        }])
        return
      }
    }

    const pageContext = { path: location.pathname, page_name: routePageName, hint: routeHint }
    const dealForCall = opt.dealOverride !== undefined ? opt.dealOverride : activeDealId
    const res = await callDealChat(dealForCall, sessionId, text, profile?.id, activeContextType, pageContext, null, opt.cross_deal_question ? { cross_deal_question: true } : null)
    setSending(false)

    if (res.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + res.error, created_at: new Date().toISOString() }])
      return
    }
    if (!sessionId && res.session_id) setSessionId(res.session_id)

    // PR B: branch on response type. Card payloads short-circuit; no assistant message inserted yet.
    if (res.type === 'switch_suggestion') {
      setPendingFocusCard({ type: 'switch_suggestion', current_focused: res.current_focused, suggested: res.suggested, user_message: res.user_message || text })
      return
    }
    if (res.type === 'clarifying_question') {
      setPendingFocusCard({ type: 'clarifying_question', suggested_deal: res.suggested_deal, user_message: res.user_message || text })
      return
    }

    // PR B: if the edge function auto-focused us into a deal, mirror that into local state so future turns honor it.
    if (res.auto_focused?.deal_id && !overrideDealId) {
      setOverrideDealId(res.auto_focused.deal_id)
    }

    setMessages(prev => [...prev, { role: 'assistant', content: res.message || '', actions_taken: res.actions_taken || [], created_at: new Date().toISOString(), auto_focused: res.auto_focused || null }])

    const sid = res.session_id || sessionId
    if (sid) {
      const { data, error: refetchErr } = await supabase.from('deal_chat_messages').select('*').eq('session_id', sid).order('created_at')
      if (refetchErr) console.error('deal_chat_messages refetch failed:', refetchErr)
      if (data?.length) {
        // Carry the auto_focused field forward on the latest assistant message (DB doesn't store it).
        if (res.auto_focused && data.length) {
          const last = data[data.length - 1]
          if (last.role === 'assistant') last.auto_focused = res.auto_focused
        }
        setMessages(data)
      }
    }
  }

  // PR B: re-fire the original message after the user picks a branch in the card.
  async function focusCardChoice(choice) {
    if (!pendingFocusCard) return
    if (choice === 'switch') {
      setOverrideDealId(pendingFocusCard.suggested.id)
      await sendMessage({ overrideText: pendingFocusCard.user_message, dealOverride: pendingFocusCard.suggested.id, skipLocalUserInsert: true, refire: true })
    } else if (choice === 'keep') {
      await sendMessage({ overrideText: pendingFocusCard.user_message, skipLocalUserInsert: true, refire: true, cross_deal_question: true })
    } else if (choice === 'clarify_yes') {
      setOverrideDealId(pendingFocusCard.suggested_deal.id)
      await sendMessage({ overrideText: pendingFocusCard.user_message, dealOverride: pendingFocusCard.suggested_deal.id, skipLocalUserInsert: true, refire: true })
    } else if (choice === 'clarify_no') {
      setOverrideDealId(null)
      await sendMessage({ overrideText: pendingFocusCard.user_message, dealOverride: null, skipLocalUserInsert: true, refire: true })
    } else if (choice === 'clarify_pick') {
      setPendingFocusCard(null)
      setDealPickerOpen(true)
      loadDeals()
    }
  }

  async function submitCorrection() {
    if (!correctionFor || !correctionText.trim() || correctionSubmitting) return
    setCorrectionSubmitting(true)
    track('chatbot_correction_submitted', { has_deal: !!activeDealId, message_length: correctionText.length })
    const res = await callDealChat(
      activeDealId, sessionId,
      '(rep submitted a correction — see correction_payload)',
      profile?.id, activeContextType,
      { path: location.pathname, page_name: routePageName, hint: routeHint },
      { original_message_id: correctionFor.messageId, correction_text: correctionText.trim() },
    )
    setCorrectionSubmitting(false)
    if (res?.error) {
      setCorrectionToast({ kind: 'error', text: 'Correction failed: ' + res.error })
      return
    }
    const memoryWritten = !!res?.correction?.memory_id
    const smeRouted = !!res?.correction?.sme_question_id
    setCorrectionToast({
      kind: 'ok',
      text: memoryWritten
        ? `Correction logged.${smeRouted ? ' An SME has been asked to validate.' : ''} Lux will remember it for this deal.`
        : 'Correction noted but no durable fact extracted (Lux thought it was a style preference).',
    })
    setCorrectionFor(null)
    setCorrectionText('')
    setTimeout(() => setCorrectionToast(null), 5000)
  }

  async function submitThumbs(msg, sentiment, reasonKey, notes) {
    let targetId = msg.id
    if (!targetId && sessionId) {
      const { data: last } = await supabase
        .from('deal_chat_messages')
        .select('id')
        .eq('session_id', sessionId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(1)
      targetId = last?.[0]?.id
    }
    if (!targetId) { console.warn('submitThumbs: no message id available for feedback'); return }
    const { error } = await supabase.from('ai_output_feedback').insert({
      org_id: profile?.org_id || null,
      user_id: profile?.id,
      deal_id: activeDealId || null,
      sentiment,
      target_type: 'chat_response',
      target_id: targetId,
      reason: reasonKey || null,
      notes: notes || null,
    })
    if (error) { console.error('ai_output_feedback insert failed:', error); return }
    const key = msg.id || targetId
    setFeedbackState(s => ({ ...s, [key]: { ...s[key], sentiment, submitted: true, showPicker: false } }))
    track('chatbot_thumbs', { sentiment, context_type: activeContextType, reason: reasonKey })
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  const filteredDeals = deals.filter(d => d.company_name?.toLowerCase().includes(dealSearch.toLowerCase()))

  const [satPrompt, setSatPrompt] = useState(null)
  const [satSubmittedFor, setSatSubmittedFor] = useState(new Set())
  const [satScore, setSatScore] = useState(0)
  const [satNotes, setSatNotes] = useState('')

  async function submitSatisfaction(score, notes) {
    if (!satPrompt) return
    const thumbsUp = Object.values(feedbackState).filter(f => f?.sentiment === 'thumbs_up').length
    const thumbsDown = Object.values(feedbackState).filter(f => f?.sentiment === 'thumbs_down').length
    const { error } = await supabase.from('chatbot_session_feedback').insert({
      session_id: satPrompt,
      org_id: profile?.org_id || null,
      user_id: profile?.id,
      deal_id: activeDealId || null,
      message_count: messages.length,
      thumbs_up_count: thumbsUp,
      thumbs_down_count: thumbsDown,
      satisfaction_score: score,
      satisfaction_notes: notes || null,
    })
    if (error) console.error('chatbot_session_feedback insert failed:', error)
    track('chatbot_satisfaction_rated', { score, context_type: activeContextType, message_count: messages.length })
    setSatSubmittedFor(s => new Set(s).add(satPrompt))
    setSatPrompt(null)
    setSatScore(0)
    setSatNotes('')
    setOpen(false)
    setDealPickerOpen(false)
    setSessionsOpen(false)
  }

  function closePanel() {
    if (sessionId && messages.length >= 3 && !satSubmittedFor.has(sessionId) && !satPrompt) {
      setSatPrompt(sessionId)
      return
    }
    setOpen(false)
    setDealPickerOpen(false)
    setSessionsOpen(false)
    setSatPrompt(null)
  }

  // Context badge shown below the header — gives the user a clear signal of
  // what the AI can see right now, without making them click to configure it.
  const contextBadge = (() => {
    if (activeContextType === 'deal' && activeDealId) {
      const dealName = deals.find(d => d.id === activeDealId)?.company_name
      return { label: dealName ? `Deal: ${dealName}` : 'This deal', changeable: true }
    }
    if (activeContextType === 'deal') return { label: 'Pick a deal', changeable: true }
    if (activeContextType === 'pipeline') return { label: 'Your pipeline', changeable: true }
    if (activeContextType === 'coaching') return { label: 'Coaching methodology', changeable: true }
    if (activeContextType === 'help') return { label: 'Product help', changeable: true }
    return { label: 'General', changeable: true }
  })()

  const placeholder = (() => {
    if (activeContextType === 'deal' && !activeDealId) return 'Pick a deal to ask about...'
    if (activeContextType === 'deal') return 'Ask anything about this deal...'
    if (activeContextType === 'pipeline') return 'Which deals need attention?'
    if (activeContextType === 'coaching') return 'Ask about methodology, discovery, objections...'
    if (activeContextType === 'help') return 'How do I...?'
    return 'Ask anything — deals, methodology, reports...'
  })()

  return (
    <>
      {/* Floating button — yellow lightbulb (illumination = Lumen) on a white
          circular surface. On-brand without being a chat-bubble cliche. */}
      {!open && (
        <button onClick={openBot} title="Ask Lumen"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
            width: 56, height: 56, borderRadius: '50%',
            background: '#FFFFFF', border: '1.5px solid #5DADE2', cursor: 'pointer',
            padding: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(44, 62, 80, 0.15)',
            transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.04)'; e.currentTarget.style.boxShadow = '0 10px 22px rgba(255, 192, 0, 0.35)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(44, 62, 80, 0.15)' }}
          aria-label="Ask Lumen">
          <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
            {/* Lightbulb body — solid yellow fill */}
            <path
              d="M9 21h6v-1.5a1 1 0 0 0-.5-.87 6 6 0 1 1 -5 0a1 1 0 0 0 -.5.87V21z"
              fill="#FFC000"
              stroke="#E0A800"
              strokeWidth="0.5"
              strokeLinejoin="round"
            />
            {/* Filament — small inner mark for character */}
            <path
              d="M10.5 14 L12 11 L13.5 14"
              fill="none"
              stroke="#E0A800"
              strokeWidth="1"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Base bands */}
            <line x1="9.5" y1="20.2" x2="14.5" y2="20.2" stroke="#B8860B" strokeWidth="0.9" strokeLinecap="round" />
            <line x1="10" y1="22" x2="14" y2="22" stroke="#B8860B" strokeWidth="0.9" strokeLinecap="round" />
            {/* Tiny radiating glow lines above the bulb */}
            <g stroke="#FFC000" strokeWidth="1.2" strokeLinecap="round" opacity="0.85">
              <line x1="12" y1="2.5" x2="12" y2="4" />
              <line x1="5.5" y1="5.5" x2="6.7" y2="6.7" />
              <line x1="18.5" y1="5.5" x2="17.3" y2="6.7" />
              <line x1="3" y1="11" x2="4.5" y2="11" />
              <line x1="21" y1="11" x2="19.5" y2="11" />
            </g>
          </svg>
        </button>
      )}

      {/* Satisfaction prompt overlay (shown when closing a 3+ msg session) */}
      {satPrompt && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9100,
          width: 340, background: T.surface, border: `1px solid ${T.primary}`,
          borderRadius: 14, boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          padding: 18, fontFamily: T.font,
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 6 }}>How was this session?</div>
          <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Your feedback tunes future coaching.</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} onClick={() => setSatScore(n)}
                style={{ flex: 1, padding: '10px 0', background: satScore >= n ? T.primary : T.surfaceAlt, color: satScore >= n ? '#fff' : T.textMuted, border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 18, fontWeight: 700, fontFamily: T.font }}>
                ★
              </button>
            ))}
          </div>
          <textarea value={satNotes} onChange={e => setSatNotes(e.target.value)}
            placeholder="Optional — what worked or didn't?"
            style={{ width: '100%', minHeight: 60, padding: '8px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, fontFamily: T.font, resize: 'vertical', outline: 'none', marginBottom: 10, color: T.text, background: T.surface, boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => { setSatPrompt(null); setOpen(false) }}
              style={{ background: 'transparent', border: 'none', color: T.textMuted, fontSize: 12, cursor: 'pointer', padding: '6px 10px', fontFamily: T.font }}>Skip</button>
            <button onClick={() => submitSatisfaction(satScore, satNotes)}
              disabled={!satScore}
              style={{ background: satScore ? T.primary : T.surfaceAlt, color: satScore ? '#fff' : T.textMuted, border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 700, cursor: satScore ? 'pointer' : 'not-allowed', fontFamily: T.font }}>Submit</button>
          </div>
        </div>
      )}

      {/* Panel */}
      {open && !satPrompt && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
          width: 380, height: '74vh', maxHeight: 760,
          background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', fontFamily: T.font, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.success }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>Lux</div>
            <button onClick={openJump} title="Search opportunities, quotes, recent pages"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, padding: 2, display: 'inline-flex', alignItems: 'center' }}>
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="7" cy="7" r="4.5" />
                <line x1="10.5" y1="10.5" x2="14" y2="14" />
              </svg>
            </button>
            <button onClick={() => setFeedbackModalOpen(true)} title="Send beta feedback"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>✎</button>
            <button onClick={() => { setSessionsOpen(s => !s); loadSessions() }} title="History"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>⏱</button>
            <button onClick={newChat} title="New chat"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>＋</button>
            <button onClick={closePanel} title="Minimize"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: 2 }}>×</button>
          </div>

          {/* Context badge — auto-detected from route, clickable to pick a specific deal */}
          <div style={{ padding: '6px 12px', borderBottom: `1px solid ${T.borderLight}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ color: T.textMuted, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Context</span>
            <span style={{
              padding: '2px 8px', borderRadius: 10, background: T.primaryLight || 'rgba(93,173,226,0.12)',
              border: `1px solid ${T.primary}40`, color: T.primary, fontWeight: 600, fontSize: 10,
              maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{contextBadge.label}</span>
            <button onClick={() => { setDealPickerOpen(true); loadDeals() }}
              style={{ marginLeft: 'auto', background: 'none', border: 'none', color: T.textMuted, fontSize: 10, cursor: 'pointer', padding: 0, textDecoration: 'underline', fontFamily: T.font }}>
              {activeContextType === 'deal' && activeDealId ? 'Change deal' : 'Focus on a deal'}
            </button>
            {/* v21 web search toggle. Hidden entirely when org has disabled it OR when the org isn't the demo org. */}
            {allowChatWebSearch && isDemoOrg && (
              <button onClick={toggleWebSearch} title="When on, Lux can search the web. Costs 3× credits when used."
                style={{
                  marginLeft: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '2px 8px', borderRadius: 10,
                  background: webOn ? T.primary : T.surfaceAlt,
                  border: `1px solid ${webOn ? T.primary : T.border}`,
                  color: webOn ? '#fff' : T.textMuted,
                  fontWeight: 600, fontSize: 10, cursor: 'pointer', fontFamily: T.font,
                  boxShadow: webOn ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                </svg>
                Web: {webOn ? 'on' : 'off'}
              </button>
            )}
          </div>

          {/* Sessions dropdown */}
          {sessionsOpen && (
            <div style={{ borderBottom: `1px solid ${T.border}`, background: T.surface, maxHeight: 180, overflowY: 'auto' }}>
              {sessions.length === 0 ? (
                <div style={{ padding: 10, fontSize: 12, color: T.textMuted, textAlign: 'center' }}>No recent sessions</div>
              ) : sessions.map(s => (
                <button key={s.id} onClick={() => openSession(s)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.title || 'Untitled'}</div>
                  <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{s.context_type || 'deal'} · {relativeTime(s.created_at)}</div>
                </button>
              ))}
            </div>
          )}

          {/* Jump overlay — quick navigate to deals / quotes / recent pages */}
          {jumpOpen && (() => {
            const q = jumpQuery.trim().toLowerCase()
            const matchedDeals = q
              ? deals.filter(d => (d.company_name || '').toLowerCase().includes(q)).slice(0, 8)
              : deals.slice(0, 6)
            const matchedQuotes = q
              ? jumpQuotes.filter(x => (x.name || '').toLowerCase().includes(q) || (x.deals?.company_name || '').toLowerCase().includes(q)).slice(0, 8)
              : jumpQuotes.slice(0, 6)
            const matchedRecent = q
              ? recentPages.filter(p => p.label.toLowerCase().includes(q))
              : recentPages.slice(0, 5)

            return (
              <div style={{ position: 'absolute', top: 72, left: 0, right: 0, bottom: 0, background: T.surface, zIndex: 20, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: 10, borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 6 }}>
                  <input value={jumpQuery} onChange={e => setJumpQuery(e.target.value)}
                    placeholder="Jump to a deal, quote, or recent page…" autoFocus
                    onKeyDown={e => {
                      if (e.key === 'Escape') { setJumpOpen(false) }
                      if (e.key === 'Enter') {
                        const first = matchedRecent[0] || matchedDeals[0] || matchedQuotes[0]
                        if (!first) return
                        if (first.path) navigateAndClose(first.path)
                        else if (first.deal_id) navigateAndClose(`/deal/${first.deal_id}/quote/${first.id}`)
                        else if (first.id) navigateAndClose(`/deal/${first.id}`)
                      }
                    }}
                    style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }} />
                  <button onClick={() => setJumpOpen(false)}
                    style={{ padding: '6px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surfaceAlt, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Esc</button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {/* Recent */}
                  {matchedRecent.length > 0 && (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', background: T.surfaceAlt, borderBottom: `1px solid ${T.borderLight}` }}>Recent</div>
                      {matchedRecent.map(r => (
                        <button key={r.path} onClick={() => navigateAndClose(r.path)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</div>
                          <div style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.path}</div>
                        </button>
                      ))}
                    </>
                  )}
                  {/* Deals */}
                  {matchedDeals.length > 0 && (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', background: T.surfaceAlt, borderBottom: `1px solid ${T.borderLight}` }}>Deals</div>
                      {matchedDeals.map(d => (
                        <button key={d.id} onClick={() => navigateAndClose(`/deal/${d.id}`)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{d.company_name}</div>
                          <div style={{ fontSize: 10, color: T.textMuted }}>{d.stage}</div>
                        </button>
                      ))}
                    </>
                  )}
                  {/* Quotes */}
                  {matchedQuotes.length > 0 && (
                    <>
                      <div style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', background: T.surfaceAlt, borderBottom: `1px solid ${T.borderLight}` }}>Quotes</div>
                      {matchedQuotes.map(qt => (
                        <button key={qt.id} onClick={() => navigateAndClose(`/deal/${qt.deal_id}/quote/${qt.id}`)}
                          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
                            {qt.name}{qt.is_primary && <span style={{ color: T.primary, fontWeight: 700, fontSize: 10, marginLeft: 6 }}>PRIMARY</span>}
                          </div>
                          <div style={{ fontSize: 10, color: T.textMuted }}>{qt.deals?.company_name || ''} · {qt.status}</div>
                        </button>
                      ))}
                    </>
                  )}
                  {q && matchedRecent.length === 0 && matchedDeals.length === 0 && matchedQuotes.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>Nothing matches "{jumpQuery}"</div>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Deal picker overlay */}
          {dealPickerOpen && (
            <div style={{ position: 'absolute', top: 72, left: 0, right: 0, bottom: 0, background: T.surface, zIndex: 10, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 10, borderBottom: `1px solid ${T.border}`, display: 'flex', gap: 6 }}>
                <input value={dealSearch} onChange={e => setDealSearch(e.target.value)} placeholder="Search deals..." autoFocus
                  style={{ flex: 1, padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }} />
                <button onClick={() => { setOverrideDealId(null); setDealPickerOpen(false) }}
                  style={{ padding: '6px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surfaceAlt, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Clear</button>
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredDeals.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No deals found</div>
                ) : filteredDeals.map(d => (
                  <button key={d.id} onClick={() => { setOverrideDealId(d.id); setDealPickerOpen(false) }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: `1px solid ${T.borderLight}`, background: 'transparent', cursor: 'pointer', fontFamily: T.font }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{d.company_name}</div>
                    <div style={{ fontSize: 10, color: T.textMuted }}>{d.stage}</div>
                  </button>
                ))}
              </div>
              <div style={{ padding: 8, borderTop: `1px solid ${T.border}` }}>
                <button onClick={() => setDealPickerOpen(false)} style={{ width: '100%', padding: 6, fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
              </div>
            </div>
          )}

          {/* Chat body */}
          {!dealPickerOpen && !jumpOpen && (
            <>
              <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
                {messages.length === 0 && !sending && (
                  <div style={{ padding: '16px 12px', color: T.textMuted, fontSize: 12, lineHeight: 1.6 }}>
                    <div style={{ fontWeight: 700, color: T.text, fontSize: 13, marginBottom: 6 }}>Hi {profile?.full_name?.split(' ')[0] || 'there'},</div>
                    <div>Ask me anything — your deals, pipeline, methodology, or to build reports. I'll use whatever context is most relevant based on where you are.</div>
                    {routeHint && <div style={{ marginTop: 8, fontSize: 10, color: T.textMuted, fontStyle: 'italic' }}>Noticed you're {routeHint}.</div>}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px', background: m.role === 'user' ? T.primary : T.surfaceAlt, color: m.role === 'user' ? '#fff' : T.text, fontSize: 12, lineHeight: 1.5, border: m.role === 'user' ? 'none' : `1px solid ${T.borderLight}` }}>
                      {/* PR B: auto-focus indicator chip — only on assistant messages where Branch A auto-focused this turn. */}
                      {m.role === 'assistant' && m.auto_focused?.company_name && (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 9px', marginBottom: 6, background: T.primaryLight || 'rgba(93,173,226,0.12)', borderRadius: 10, fontSize: 10, color: T.primary, fontWeight: 600 }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                          Auto-focused on <strong style={{ marginLeft: 2 }}>{m.auto_focused.company_name}</strong>
                          <button onClick={() => { setDealPickerOpen(true); loadDeals() }} style={{ marginLeft: 4, background: 'none', border: 'none', color: T.primary, fontSize: 10, fontWeight: 600, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontFamily: T.font }}>change</button>
                        </div>
                      )}
                      {(() => {
                        if (m.role !== 'assistant') return <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                        // First strip ```report``` blocks, then split remaining text into source-aware segments.
                        const { displayText } = parseReportBlocks(m.content)
                        const { segments, sources } = parseSourceBlocks(displayText || m.content || '')
                        return (
                          <div style={{ whiteSpace: 'pre-wrap' }}>
                            {segments.map((seg, si) => {
                              if (seg.kind === 'text') return <span key={si}>{seg.value}</span>
                              const src = sources[seg.idx]
                              return <SourcePill key={si} src={src} />
                            })}
                          </div>
                        )
                      })()}
                      {/* Demo nav-action buttons — Carolina-blue pills under the
                          assistant text. Click closes the panel and routes. */}
                      {m.role === 'assistant' && Array.isArray(m.nav_actions) && m.nav_actions.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {m.nav_actions.map((a, ai) => (
                            <button key={ai}
                              onClick={() => { setOpen(false); navigate(a.route) }}
                              style={{
                                fontSize: 12, fontWeight: 600,
                                color: ai === 0 ? '#fff' : T.primary,
                                background: ai === 0 ? T.primary : 'transparent',
                                border: ai === 0 ? 'none' : `1px solid ${T.primary}`,
                                borderRadius: 6, padding: '6px 12px',
                                cursor: 'pointer', fontFamily: T.font,
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                              }}>
                              {a.label} <span style={{ fontSize: 13, marginLeft: 2 }}>&rarr;</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {m.role === 'assistant' && m.id && (() => {
                        const fb = feedbackState[m.id] || {}
                        return (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6, fontSize: 10, color: T.textMuted }}>
                            <span style={{ flex: 1 }}>{relativeTime(m.created_at)}</span>
                            <button title="Helpful" onClick={() => !fb.submitted && submitThumbs(m, 'thumbs_up')}
                              style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', padding: 2, display: 'inline-flex', color: fb.sentiment === 'thumbs_up' ? T.success : T.textMuted, opacity: fb.sentiment === 'thumbs_up' ? 1 : 0.5 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                            </button>
                            <button title="Not helpful" onClick={() => !fb.submitted && setFeedbackState(s => ({ ...s, [m.id]: { ...s[m.id], showPicker: true, sentiment: 'thumbs_down' } }))}
                              style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', padding: 2, display: 'inline-flex', color: fb.sentiment === 'thumbs_down' ? T.error : T.textMuted, opacity: fb.sentiment === 'thumbs_down' ? 1 : 0.5 }}>
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                            </button>
                            {/* v20 Correct-this affordance — only on deal-context turns AND only for demo-org users.
                                For other orgs the backend ignores correction_payload, so we hide the affordance to avoid confusion. */}
                            {activeContextType === 'deal' && activeDealId && isDemoOrg && (
                              <button title="Correct this — Lux will remember for this deal and an SME will validate" onClick={() => { setCorrectionFor({ messageId: m.id, originalText: m.content || '' }); setCorrectionText('') }}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex', color: T.textMuted, opacity: 0.6, fontSize: 9, fontWeight: 600 }}>
                                Correct
                              </button>
                            )}
                            {/* SME: Ask-the-team affordance — always available. Prefills with the user's prior message (the thing Lux was answering). */}
                            <button title="Ask the team — escalate to a human expert in your org" onClick={() => {
                                // Prefill with the most recent user message preceding this assistant turn.
                                const idx = messages.findIndex(x => x.id === m.id)
                                let prior = ''
                                for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === 'user') { prior = messages[i].content || ''; break } }
                                openAskSme(prior)
                              }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, display: 'inline-flex', color: T.textMuted, opacity: 0.6, fontSize: 9, fontWeight: 600 }}>
                              Ask the team ↗
                            </button>
                          </div>
                        )
                      })()}
                      {/* SME: prominent inline card when Lux hedges OR the user explicitly asked to escalate. */}
                      {m.role === 'assistant' && m.id && m.content && (() => {
                        const luxHedged = LOW_CONFIDENCE_REGEX.test(m.content)
                        // User-escalation trigger: look at the immediately preceding user message.
                        const idx = messages.findIndex(x => x.id === m.id)
                        let priorUser = ''
                        for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === 'user') { priorUser = messages[i].content || ''; break } }
                        const userAskedToEscalate = USER_ESCALATION_REGEX.test(priorUser)
                        return luxHedged || userAskedToEscalate
                      })() && (
                        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: '#fef3c7', border: '1px solid #fcd34d' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Lux isn't sure — ask the team</div>
                          <div style={{ fontSize: 10, color: '#92400e', marginBottom: 8, lineHeight: 1.4 }}>A teammate likely knows this. Submitting sends the question to an SME; you'll be notified when they answer, and the answer gets baked into Lux's knowledge for future asks.</div>
                          <button onClick={() => {
                              const idx = messages.findIndex(x => x.id === m.id)
                              let prior = ''
                              for (let i = idx - 1; i >= 0; i--) { if (messages[i].role === 'user') { prior = messages[i].content || ''; break } }
                              openAskSme(prior)
                            }}
                            style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', background: '#92400e', color: '#fff', cursor: 'pointer', fontFamily: T.font }}>
                            Ask the team →
                          </button>
                        </div>
                      )}
                      {m.role === 'assistant' && m.id && feedbackState[m.id]?.showPicker && !feedbackState[m.id]?.submitted && (
                        <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px solid ${T.borderLight}` }}>
                          <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4 }}>What was wrong?</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 4 }}>
                            {THUMBS_DOWN_REASONS.map(r => (
                              <button key={r.key} onClick={() => setFeedbackState(s => ({ ...s, [m.id]: { ...s[m.id], reasonKey: r.key } }))}
                                style={{ fontSize: 10, padding: '2px 6px', borderRadius: 8, border: `1px solid ${feedbackState[m.id]?.reasonKey === r.key ? T.primary : T.border}`, background: feedbackState[m.id]?.reasonKey === r.key ? T.primary : 'transparent', color: feedbackState[m.id]?.reasonKey === r.key ? '#fff' : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>{r.label}</button>
                            ))}
                          </div>
                          <input value={feedbackState[m.id]?.notes || ''} onChange={e => setFeedbackState(s => ({ ...s, [m.id]: { ...s[m.id], notes: e.target.value } }))} placeholder="Optional detail..."
                            style={{ width: '100%', padding: '4px 6px', fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, marginBottom: 4 }} />
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button disabled={!feedbackState[m.id]?.reasonKey} onClick={() => submitThumbs(m, 'thumbs_down', feedbackState[m.id]?.reasonKey, feedbackState[m.id]?.notes)}
                              style={{ fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, border: 'none', background: feedbackState[m.id]?.reasonKey ? T.primary : T.borderLight, color: '#fff', cursor: feedbackState[m.id]?.reasonKey ? 'pointer' : 'default', fontFamily: T.font }}>Submit</button>
                            <button onClick={() => setFeedbackState(s => ({ ...s, [m.id]: {} }))}
                              style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {/* Non-report action receipts — tasks, contacts, field updates, risks */}
                    {m.role === 'assistant' && (() => {
                      const actions = (m.actions_taken || []).filter(a => a.type !== 'build_report')
                      if (!actions.length) return null
                      return (
                        <div style={{ maxWidth: '85%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {actions.map((a, ai) => <ActionCard key={ai} action={a} onOpenDeal={() => { if (selectedDealIdFromMsg(m, activeDealId)) { navigate(`/deal/${selectedDealIdFromMsg(m, activeDealId)}`); setOpen(false) } }} />)}
                        </div>
                      )
                    })()}
                    {/* Report drafts emitted by the assistant — v22 defense in depth: when
                        the org has reports disabled, do not render the cards even if a stray
                        ```report``` block or build_report action somehow emitted. */}
                    {m.role === 'assistant' && (() => {
                      const toolDrafts = (m.actions_taken || [])
                        .filter(a => a.type === 'build_report' && a.result?.success !== false)
                        .map(a => ({ config: a.input, preview: a.result }))
                      const { drafts: legacyDrafts } = parseReportBlocks(m.content)
                      const drafts = [
                        ...toolDrafts,
                        ...legacyDrafts.map(c => ({ config: c, preview: null })),
                      ]
                      if (!drafts.length) return null
                      if (enableChatReports === false) {
                        console.debug('[Lux] Report block emitted but reports disabled for org')
                        return null
                      }
                      return (
                        <div style={{ maxWidth: '85%', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {drafts.map((d, di) => (
                            <ReportCard key={di} draft={d.config} preview={d.preview} onOpenInBuilder={() => {
                              const payload = { name: d.config.name, config: d.config }
                              const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_')
                              navigate(`/reports?draft=${b64}`)
                              setOpen(false)
                            }} />
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                ))}
                {/* PR A: 3-dot pulsing thinking indicator, gated on a 200ms debounce. */}
                {showThinking && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                    <div style={{ padding: '4px 12px', borderRadius: '10px 10px 10px 2px', background: T.surfaceAlt, border: `1px solid ${T.borderLight}` }}>
                      <ThinkingDots />
                    </div>
                  </div>
                )}
                {/* PR B: auto-focus decision cards — switch suggestion + clarifying question. */}
                {pendingFocusCard?.type === 'switch_suggestion' && !sending && (
                  <div style={{ marginBottom: 10, padding: 12, background: T.surface, border: `1px solid ${T.primary}40`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.primary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>One quick check</div>
                    <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>
                      Looks like you're asking about <strong>{pendingFocusCard.suggested.company_name}</strong>, not <strong>{pendingFocusCard.current_focused.company_name}</strong>. Switch deals?
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => focusCardChoice('switch')} style={{ flex: '1 1 auto', padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', background: T.primary, color: '#fff', cursor: 'pointer', fontFamily: T.font }}>
                        Switch to {pendingFocusCard.suggested.company_name}
                      </button>
                      <button onClick={() => focusCardChoice('keep')} style={{ flex: '1 1 auto', padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
                        Keep {pendingFocusCard.current_focused.company_name}, answer anyway
                      </button>
                    </div>
                  </div>
                )}
                {pendingFocusCard?.type === 'clarifying_question' && !sending && (
                  <div style={{ marginBottom: 10, padding: 12, background: T.surface, border: `1px solid ${T.primary}40`, borderRadius: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: T.primary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Help me focus</div>
                    <div style={{ fontSize: 12, color: T.text, lineHeight: 1.5, marginBottom: 10 }}>
                      Sounds like you're asking about <strong>{pendingFocusCard.suggested_deal.company_name}</strong> — should I focus there?
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button onClick={() => focusCardChoice('clarify_yes')} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 700, borderRadius: 6, border: 'none', background: T.primary, color: '#fff', cursor: 'pointer', fontFamily: T.font }}>
                        Yes, focus there
                      </button>
                      <button onClick={() => focusCardChoice('clarify_no')} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
                        No, answer without focusing
                      </button>
                      <button onClick={() => focusCardChoice('clarify_pick')} style={{ padding: '7px 12px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
                        Different deal
                      </button>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              {/* Input */}
              <div style={{ padding: 10, borderTop: `1px solid ${T.border}`, display: 'flex', gap: 6 }}>
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={sending}
                  placeholder={placeholder}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 20, background: T.surfaceAlt, color: T.text, fontFamily: T.font, outline: 'none' }} />
                <button onClick={sendMessage} disabled={sending || !input.trim()}
                  style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: input.trim() && !sending ? T.primary : T.borderLight, color: '#fff', cursor: input.trim() && !sending ? 'pointer' : 'default', fontSize: 14 }}>↑</button>
              </div>
            </>
          )}

        </div>
      )}

      {/* Beta feedback modal (rendered outside panel so it isn't clipped) */}
      {feedbackModalOpen && <BetaFeedbackModal onClose={() => setFeedbackModalOpen(false)} />}

      {/* v20 Correct-this modal */}
      {correctionFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !correctionSubmitting && setCorrectionFor(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, fontFamily: T.font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>Correct this answer</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Lux will remember the correction for this deal. An SME will be asked to validate so it can become org-wide knowledge.</div>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>What Lux said</div>
            <div style={{ fontSize: 11, color: T.textSecondary, background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: '8px 10px', marginBottom: 10, maxHeight: 100, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{(correctionFor.originalText || '').slice(0, 800)}{(correctionFor.originalText || '').length > 800 ? '…' : ''}</div>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>Your correction</div>
            <textarea value={correctionText} onChange={e => setCorrectionText(e.target.value)} autoFocus placeholder="What's actually correct? Be specific — Lux will keep this for the deal."
              style={{ width: '100%', minHeight: 90, padding: '8px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setCorrectionFor(null)} disabled={correctionSubmitting}
                style={{ padding: '6px 14px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: correctionSubmitting ? 'default' : 'pointer', fontFamily: T.font }}>Cancel</button>
              <button onClick={submitCorrection} disabled={correctionSubmitting || !correctionText.trim()}
                style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: correctionSubmitting || !correctionText.trim() ? T.borderLight : T.primary, color: '#fff', cursor: correctionSubmitting || !correctionText.trim() ? 'default' : 'pointer', fontFamily: T.font }}>
                {correctionSubmitting ? 'Submitting…' : 'Submit correction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v20 correction toast */}
      {correctionToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 16px', borderRadius: 10, background: correctionToast.kind === 'ok' ? T.primary : (T.error || '#e74c3c'),
          color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: T.font, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', zIndex: 70, maxWidth: 460,
        }}>{correctionToast.text}</div>
      )}

      {/* SME Ask-the-team modal */}
      {askSmeOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !askSmeSubmitting && setAskSmeOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, fontFamily: T.font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 6 }}>Ask the team</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>Send this question to an internal SME for an authoritative answer. They'll be routed automatically based on the topic. When they mark it helpful, the answer flows into Lux's long-term knowledge for the whole org.</div>
            <textarea value={askSmePrefill} onChange={e => setAskSmePrefill(e.target.value)} autoFocus placeholder="Phrase your question…"
              style={{ width: '100%', minHeight: 110, padding: '8px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, resize: 'vertical' }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button onClick={() => setAskSmeOpen(false)} disabled={askSmeSubmitting}
                style={{ padding: '6px 14px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: askSmeSubmitting ? 'default' : 'pointer', fontFamily: T.font }}>Cancel</button>
              <button onClick={submitAskSme} disabled={askSmeSubmitting || !askSmePrefill.trim()}
                style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: askSmeSubmitting || !askSmePrefill.trim() ? T.borderLight : T.primary, color: '#fff', cursor: askSmeSubmitting || !askSmePrefill.trim() ? 'default' : 'pointer', fontFamily: T.font }}>
                {askSmeSubmitting ? 'Sending…' : 'Send to SME'}
              </button>
            </div>
          </div>
        </div>
      )}

      {askSmeToast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          padding: '10px 16px', borderRadius: 10, background: askSmeToast.kind === 'ok' ? '#a855f7' : (T.error || '#e74c3c'),
          color: '#fff', fontSize: 12, fontWeight: 600, fontFamily: T.font, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', zIndex: 70, maxWidth: 460,
        }}>{askSmeToast.text}</div>
      )}
    </>
  )
}

// Resolve a deal id for the "view" link on an action card. Messages only have
// actions_taken, not deal_id, so we fall back to the chatbot's active deal.
function selectedDealIdFromMsg(msg, fallback) {
  return msg?.deal_id || fallback || null
}

// Compact action receipt rendered under assistant messages. Each row shows
// what the AI actually did: task created, field updated, contact added, risk
// logged. Green checkmark on success, red exclamation on failure.
function ActionCard({ action, onOpenDeal }) {
  const ok = action?.result?.success !== false
  const icon = ok ? '✓' : '!'
  const iconColor = ok ? '#2ecc71' : T.error || '#e74c3c'

  const label = (() => {
    if (!ok) {
      const err = action.result?.error || 'action failed'
      return { title: `${action.type.replace(/_/g, ' ')} — failed`, detail: String(err).slice(0, 140) }
    }
    switch (action.type) {
      case 'create_task': return {
        title: `Task created`,
        detail: action.input?.title || action.result?.title || '',
        meta: [action.input?.priority, action.input?.due_days ? `${action.input.due_days}d` : null].filter(Boolean).join(' · '),
      }
      case 'update_deal_field': return {
        title: `Updated ${action.input?.table || 'field'}`,
        detail: `${action.input?.field || ''} → ${String(action.input?.value || '').slice(0, 80)}`,
      }
      case 'add_contact': return {
        title: `Contact added`,
        detail: action.input?.name || action.result?.name || '',
        meta: [action.input?.title, action.input?.role_in_deal, action.input?.is_champion ? 'CHAMP' : null, action.input?.is_economic_buyer ? 'EB' : null].filter(Boolean).join(' · '),
      }
      case 'add_risk': return {
        title: `Risk logged`,
        detail: action.input?.risk_description || '',
        meta: [action.input?.severity, action.input?.category].filter(Boolean).join(' · '),
      }
      default: return { title: action.type, detail: '' }
    }
  })()

  return (
    <div style={{
      border: `1px solid ${ok ? '#2ecc7133' : (T.error || '#e74c3c') + '33'}`, borderRadius: 8, background: T.surface,
      padding: '6px 10px', display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11,
    }}>
      <span style={{ color: iconColor, fontWeight: 800, fontSize: 13, lineHeight: '16px', flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: T.text, fontSize: 11 }}>{label.title}</div>
        {label.detail && <div style={{ color: T.textSecondary, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label.detail}</div>}
        {label.meta && <div style={{ color: T.textMuted, fontSize: 9, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 1 }}>{label.meta}</div>}
      </div>
      {ok && onOpenDeal && (
        <button onClick={onOpenDeal} title="Open on deal page"
          style={{ background: 'none', border: 'none', color: T.primary, fontSize: 10, fontWeight: 700, cursor: 'pointer', padding: '2px 0', flexShrink: 0, fontFamily: T.font }}>
          View →
        </button>
      )}
    </div>
  )
}

// Inline report preview card rendered under assistant messages that emitted a
// ```report``` block. Run button executes the draft against the DB and shows
// the first 10 rows + total count inline. "Open in builder" deep-links to
// /reports?draft=<base64> so the user can tweak + save.
function ReportCard({ draft, preview, onOpenInBuilder }) {
  const initialResult = preview?.success !== false && preview?.sample_rows
    ? { rows: preview.sample_rows, columns: Object.keys(preview.sample_rows[0] || {}).slice(0, 6), aggregate: false, _serverTotal: preview.total_count }
    : null
  const [result, setResult] = useState(initialResult)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)
  const [expanded, setExpanded] = useState(!!initialResult)

  async function run() {
    setRunning(true); setError(null)
    try {
      const r = await executeReportQueryStandalone({ query_config: draft, base_entity: draft.base_entity })
      setResult(r)
      setExpanded(true)
    } catch (e) {
      setError(e?.message || String(e))
    } finally {
      setRunning(false)
    }
  }

  const baseLabel = (draft.base_entity || 'deals').replace(/_/g, ' ')
  const joins = (draft.included_relations || []).join(' + ')
  const typeLabel = (draft.report_type || 'tabular').toUpperCase()
  const filterCount = (draft.filters || []).length

  return (
    <div style={{ border: `1px solid ${T.primary}40`, borderRadius: 10, background: T.surface, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', background: T.primaryLight, borderBottom: `1px solid ${T.primary}30`, display: 'flex', alignItems: 'center', gap: 8 }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.primary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{draft.name || 'Report draft'}</div>
          <div style={{ fontSize: 9, color: T.textMuted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {typeLabel} · {baseLabel}{joins ? ' + ' + joins : ''}{filterCount ? ` · ${filterCount} filter${filterCount === 1 ? '' : 's'}` : ''}
          </div>
        </div>
      </div>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 6, alignItems: 'center' }}>
        <button onClick={run} disabled={running}
          style={{ padding: '5px 12px', fontSize: 11, fontWeight: 700, background: T.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: running ? 'wait' : 'pointer', fontFamily: T.font }}>
          {running ? 'Running…' : result ? 'Re-run' : 'Run'}
        </button>
        <button onClick={onOpenInBuilder}
          style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, background: T.surface, color: T.primary, border: `1px solid ${T.primary}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>
          Open in builder
        </button>
        {result && <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 'auto' }}>
          {result._serverTotal != null ? `${result._serverTotal.toLocaleString()} total` : `${result.rows.length} ${result.aggregate ? 'result' : 'row' + (result.rows.length === 1 ? '' : 's')}`}
        </span>}
      </div>
      {error && <div style={{ padding: '6px 12px 10px', fontSize: 11, color: T.error }}>{error}</div>}
      {result && expanded && (
        <div style={{ padding: '0 10px 10px' }}>
          <div style={{ overflow: 'auto', maxHeight: 240, border: `1px solid ${T.borderLight}`, borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt }}>
                <tr>{result.columns.map(c => (
                  <th key={c} style={{ textAlign: 'left', padding: '5px 7px', fontSize: 9, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>{c.replace(/_/g, ' ')}</th>
                ))}</tr>
              </thead>
              <tbody>
                {result.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    {result.columns.map(c => {
                      const v = row[c]
                      const d = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).substring(0, 50) : String(v).substring(0, 80)
                      return <td key={c} style={{ padding: '4px 7px', color: T.text, whiteSpace: 'nowrap', fontFeatureSettings: '"tnum"' }}>{d}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.rows.length > 10 && <div style={{ fontSize: 9, color: T.textMuted, marginTop: 4, textAlign: 'center' }}>Showing 10 of {result.rows.length}. Open in builder for the full view.</div>}
        </div>
      )}
    </div>
  )
}
