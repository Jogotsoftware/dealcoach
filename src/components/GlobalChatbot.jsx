import { useState, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { callDealChat } from '../lib/webhooks'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { track } from '../lib/analytics'
import { theme as T } from '../lib/theme'
import BetaFeedbackModal from './BetaFeedbackModal'

const HIDDEN_ROUTES = ['/login']
const HIDDEN_PREFIXES = ['/msp/shared/', '/partner']

const TOPICS = [
  { key: 'deal', label: 'Deal', desc: 'Ask about a specific deal' },
  { key: 'pipeline', label: 'Pipeline', desc: 'Strategic pipeline questions' },
  { key: 'coaching', label: 'Coaching', desc: 'Methodology guidance' },
  { key: 'help', label: 'Help', desc: 'Product help' },
  { key: 'feedback', label: 'Feedback', desc: 'Send beta feedback' },
]

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

export default function GlobalChatbot() {
  const { profile } = useAuth()
  const { org } = useOrg() || {}
  const location = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState(null) // 'deal' | 'pipeline' | 'coaching' | 'help' | 'feedback'
  const [dealPickerOpen, setDealPickerOpen] = useState(false)
  const [deals, setDeals] = useState([])
  const [dealSearch, setDealSearch] = useState('')
  const [selectedDealId, setSelectedDealId] = useState(null)
  const [sessionId, setSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [feedbackState, setFeedbackState] = useState({})
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false)
  const messagesEndRef = useRef(null)

  // Auto-route to Deal topic with the current deal selected when we're on a deal page
  useEffect(() => {
    const m = location.pathname.match(/^\/deal\/([0-9a-f-]{36})/)
    if (open && m && !topic) {
      setTopic('deal')
      setSelectedDealId(m[1])
    }
  }, [open, location.pathname, topic])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

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

  async function openBot() {
    setOpen(true)
    track('chatbot_opened', { route: location.pathname })
    loadSessions()
  }

  function pickTopic(key) {
    if (key === 'feedback') {
      track('chatbot_topic_selected', { context_type: 'feedback' })
      setFeedbackModalOpen(true)
      return
    }
    setTopic(key)
    setMessages([])
    setSessionId(null)
    setInput('')
    setFeedbackState({})
    track('chatbot_topic_selected', { context_type: key })
    if (key === 'deal') {
      const m = location.pathname.match(/^\/deal\/([0-9a-f-]{36})/)
      if (m) setSelectedDealId(m[1])
      else { setSelectedDealId(null); setDealPickerOpen(true); loadDeals() }
    }
  }

  function newChat() {
    setMessages([])
    setSessionId(null)
    setFeedbackState({})
    setTopic(null)
  }

  async function openSession(sess) {
    setTopic(sess.context_type || 'deal')
    setSelectedDealId(sess.deal_id || null)
    setSessionId(sess.id)
    const { data } = await supabase.from('deal_chat_messages').select('*').eq('session_id', sess.id).order('created_at')
    setMessages(data || [])
    setSessionsOpen(false)
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return
    if (topic === 'feedback') return // feedback has its own flow
    if (topic === 'deal' && !selectedDealId) { setDealPickerOpen(true); return }

    setInput('')
    setSending(true)
    track('chatbot_message_sent', { context_type: topic, has_deal: !!selectedDealId, message_length: text.length })
    setMessages(prev => [...prev, { role: 'user', content: text, created_at: new Date().toISOString() }])

    const res = await callDealChat(topic === 'deal' ? selectedDealId : null, sessionId, text, profile?.id, topic)
    setSending(false)

    if (res.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + res.error, created_at: new Date().toISOString() }])
      return
    }

    if (!sessionId && res.session_id) setSessionId(res.session_id)
    setMessages(prev => [...prev, { role: 'assistant', content: res.message || '', actions_taken: res.actions_taken || [], created_at: new Date().toISOString() }])

    // Refetch with IDs so thumbs work
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
      // Fallback: look up the latest assistant message in this session
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
      deal_id: selectedDealId || null,
      sentiment,
      target_type: 'chat_response',
      target_id: targetId,
      reason: reasonKey || null,
      notes: notes || null,
    })
    if (error) { console.error('ai_output_feedback insert failed:', error); return }
    const key = msg.id || targetId
    setFeedbackState(s => ({ ...s, [key]: { ...s[key], sentiment, submitted: true, showPicker: false } }))
    track('chatbot_thumbs', { sentiment, context_type: topic, reason: reasonKey })
  }

  function handleKeyDown(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }

  const filteredDeals = deals.filter(d => d.company_name?.toLowerCase().includes(dealSearch.toLowerCase()))

  // Close the whole panel
  function closePanel() {
    setOpen(false)
    setDealPickerOpen(false)
    setSessionsOpen(false)
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button onClick={openBot} title="Revenue Instruments assistant"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
            width: 52, height: 52, borderRadius: '50%',
            background: T.primary, color: '#fff', border: 'none', cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(93, 173, 226, 0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 700, fontFamily: T.font,
          }}>💬</button>
      )}

      {/* Panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
          width: 360, height: '72vh', maxHeight: 720,
          background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', fontFamily: T.font, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.success }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>Revenue Instruments</div>
            <button onClick={() => { setSessionsOpen(s => !s); loadSessions() }} title="History"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>⏱</button>
            <button onClick={newChat} title="New chat"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>＋</button>
            <button onClick={closePanel} title="Minimize"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: 2 }}>×</button>
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

          {/* Topic pills */}
          {!topic && (
            <div style={{ padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflow: 'auto' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>How can I help?</div>
              {TOPICS.map(t => (
                <button key={t.key} onClick={() => pickTopic(t.key)}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    padding: '10px 12px', border: `1px solid ${T.border}`, borderRadius: 8, background: T.surfaceAlt,
                    cursor: 'pointer', fontFamily: T.font, textAlign: 'left',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = T.primary; e.currentTarget.style.background = T.primaryLight || 'rgba(93,173,226,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.background = T.surfaceAlt }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: T.textMuted }}>{t.desc}</span>
                </button>
              ))}
            </div>
          )}

          {/* Active topic pill row */}
          {topic && (
            <div style={{ padding: '6px 10px', borderBottom: `1px solid ${T.borderLight}`, background: T.surface, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {TOPICS.map(t => (
                <button key={t.key} onClick={() => pickTopic(t.key)}
                  style={{
                    padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    border: `1px solid ${topic === t.key ? T.primary : T.border}`,
                    background: topic === t.key ? T.primary : 'transparent',
                    color: topic === t.key ? '#fff' : T.textMuted,
                    fontFamily: T.font,
                  }}>{t.label}</button>
              ))}
              {topic === 'deal' && selectedDealId && (
                <button onClick={() => { setDealPickerOpen(true); loadDeals() }}
                  style={{ padding: '3px 10px', borderRadius: 12, fontSize: 10, fontWeight: 600, border: `1px solid ${T.border}`, background: T.surfaceAlt, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font, marginLeft: 'auto' }}>
                  {deals.find(d => d.id === selectedDealId)?.company_name || 'Change deal'}
                </button>
              )}
            </div>
          )}

          {/* Deal picker */}
          {topic === 'deal' && dealPickerOpen && (
            <div style={{ position: 'absolute', top: 88, left: 0, right: 0, bottom: 0, background: T.surface, zIndex: 10, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: 10, borderBottom: `1px solid ${T.border}` }}>
                <input value={dealSearch} onChange={e => setDealSearch(e.target.value)} placeholder="Search deals..." autoFocus
                  style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }} />
              </div>
              <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredDeals.length === 0 ? (
                  <div style={{ padding: 20, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No deals found</div>
                ) : filteredDeals.map(d => (
                  <button key={d.id} onClick={() => { setSelectedDealId(d.id); setDealPickerOpen(false) }}
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

          {/* Chat body — hidden when feedback topic */}
          {topic && topic !== 'feedback' && !dealPickerOpen && (
            <>
              <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
                {messages.length === 0 && !sending && (
                  <div style={{ textAlign: 'center', padding: '24px 12px', color: T.textMuted, fontSize: 12 }}>
                    {topic === 'deal' ? (selectedDealId ? 'Ask anything about this deal' : 'Pick a deal to start') :
                     topic === 'pipeline' ? 'Which deals need attention? Where am I at risk?' :
                     topic === 'coaching' ? 'Ask about methodology, discovery, objections...' :
                     topic === 'help' ? 'How do I use DealCoach?' : 'Ask me anything'}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 10 }}>
                    <div style={{ maxWidth: '85%', padding: '8px 12px', borderRadius: m.role === 'user' ? '10px 10px 2px 10px' : '10px 10px 10px 2px', background: m.role === 'user' ? T.primary : T.surfaceAlt, color: m.role === 'user' ? '#fff' : T.text, fontSize: 12, lineHeight: 1.5, border: m.role === 'user' ? 'none' : `1px solid ${T.borderLight}` }}>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
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
                <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyDown} disabled={sending || (topic === 'deal' && !selectedDealId)}
                  placeholder={topic === 'deal' && !selectedDealId ? 'Pick a deal first...' : 'Type a message...'}
                  style={{ flex: 1, padding: '8px 12px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 20, background: T.surfaceAlt, color: T.text, fontFamily: T.font, outline: 'none' }} />
                <button onClick={sendMessage} disabled={sending || !input.trim() || (topic === 'deal' && !selectedDealId)}
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
