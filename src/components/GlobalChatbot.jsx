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
  const { profile } = useAuth()
  const { org } = useOrg() || {}
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

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return

    setInput('')
    setSending(true)
    track('chatbot_message_sent', { context_type: activeContextType, has_deal: !!activeDealId, message_length: text.length })
    setMessages(prev => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])

    const pageContext = { path: location.pathname, page_name: routePageName, hint: routeHint }
    const res = await callDealChat(activeDealId, sessionId, text, profile?.id, activeContextType, pageContext)
    setSending(false)

    if (res.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + res.error, created_at: new Date().toISOString() }])
      return
    }

    if (!sessionId && res.session_id) setSessionId(res.session_id)
    setMessages(prev => [...prev, { role: 'assistant', content: res.message || '', actions_taken: res.actions_taken || [], created_at: new Date().toISOString() }])

    const sid = res.session_id || sessionId
    if (sid) {
      const { data, error: refetchErr } = await supabase.from('deal_chat_messages').select('*').eq('session_id', sid).order('created_at')
      if (refetchErr) console.error('deal_chat_messages refetch failed:', refetchErr)
      if (data?.length) setMessages(data)
    }
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
      {/* Floating button — clean speech-bubble icon, no emoji */}
      {!open && (
        <button onClick={openBot} title="Revenue Instruments assistant"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
            width: 48, height: 48, borderRadius: '50%',
            background: T.primary, color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 6px 18px rgba(93, 173, 226, 0.35)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform 0.12s ease, box-shadow 0.12s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 8px 22px rgba(93, 173, 226, 0.45)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 18px rgba(93, 173, 226, 0.35)' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
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
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>Revenue Instruments</div>
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
                    <div style={{ fontWeight: 700, color: T.text, fontSize: 13, marginBottom: 6 }}>Hi {profile?.full_name?.split(' ')[0] || 'there'} 👋</div>
                    <div>Ask me anything — your deals, pipeline, methodology, or to build reports. I'll use whatever context is most relevant based on where you are.</div>
                    {routeHint && <div style={{ marginTop: 8, fontSize: 10, color: T.textMuted, fontStyle: 'italic' }}>Noticed you're {routeHint}.</div>}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px', background: m.role === 'user' ? T.primary : T.surfaceAlt, color: m.role === 'user' ? '#fff' : T.text, fontSize: 12, lineHeight: 1.5, border: m.role === 'user' ? 'none' : `1px solid ${T.borderLight}` }}>
                      {(() => {
                        if (m.role !== 'assistant') return <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                        const { displayText } = parseReportBlocks(m.content)
                        return <div style={{ whiteSpace: 'pre-wrap' }}>{displayText || m.content}</div>
                      })()}
                      {m.role === 'assistant' && m.id && (() => {
                        const fb = feedbackState[m.id] || {}
                        return (
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 6, fontSize: 10, color: T.textMuted }}>
                            <span style={{ flex: 1 }}>{relativeTime(m.created_at)}</span>
                            <button onClick={() => !fb.submitted && submitThumbs(m, 'thumbs_up')}
                              style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', fontSize: 11, padding: 0, opacity: fb.sentiment === 'thumbs_up' ? 1 : 0.5 }}>👍</button>
                            <button onClick={() => !fb.submitted && setFeedbackState(s => ({ ...s, [m.id]: { ...s[m.id], showPicker: true, sentiment: 'thumbs_down' } }))}
                              style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', fontSize: 11, padding: 0, opacity: fb.sentiment === 'thumbs_down' ? 1 : 0.5 }}>👎</button>
                          </div>
                        )
                      })()}
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
                    {/* Report drafts emitted by the assistant */}
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
                {sending && (
                  <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 10 }}>
                    <div style={{ padding: '8px 14px', borderRadius: '10px 10px 10px 2px', background: T.surfaceAlt, border: `1px solid ${T.borderLight}` }}>
                      <span style={{ fontSize: 11, color: T.textMuted }}>thinking...</span>
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
        <span style={{ fontSize: 14 }}>📊</span>
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
