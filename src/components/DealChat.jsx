import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { callDealChat } from '../lib/webhooks'
import { track } from '../lib/analytics'
import { theme as T } from '../lib/theme'

const SUGGESTIONS = [
  'What are the biggest risks?',
  'Who should I talk to next?',
  'Questions for the next call?',
  'Create a follow-up task',
  'Summarize this deal',
  "What's my competitive strategy?",
]

function relativeTime(date) {
  if (!date) return ''
  const now = new Date()
  const d = new Date(date)
  const diffMs = now - d
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function parseMarkdown(text) {
  if (!text) return null
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function MessageContent({ content }) {
  if (!content) return null
  const lines = content.split('\n')
  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
          return (
            <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 2, paddingLeft: 4 }}>
              <span style={{ color: T.textMuted, flexShrink: 0 }}>&bull;</span>
              <span>{parseMarkdown(trimmed.substring(2))}</span>
            </div>
          )
        }
        if (trimmed === '') return <div key={i} style={{ height: 8 }} />
        return <div key={i} style={{ marginBottom: 2 }}>{parseMarkdown(line)}</div>
      })}
    </div>
  )
}

const THUMBS_DOWN_REASONS = [
  { key: 'wrong_info', label: 'Wrong info' },
  { key: 'not_helpful', label: 'Not helpful' },
  { key: 'off_topic', label: 'Off topic' },
  { key: 'other', label: 'Other' },
]

export default function DealChat({ dealId, userId, isOpen, onClose, onAction, orgId }) {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // feedbackState: { [messageId]: { sentiment, showPicker, reasonKey, notes, submitted } }
  const [feedbackState, setFeedbackState] = useState({})
  const [satisfactionShown, setSatisfactionShown] = useState(false)
  const [satisfactionRating, setSatisfactionRating] = useState(null)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Load sessions on open
  useEffect(() => {
    if (isOpen && dealId && userId && !loaded) {
      loadSessions()
    }
    if (isOpen && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 300)
    }
  }, [isOpen, dealId, userId])

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  async function loadSessions() {
    const { data: sess } = await supabase.from('deal_chat_sessions').select('*')
      .eq('deal_id', dealId).eq('user_id', userId).order('updated_at', { ascending: false })
    setSessions(sess || [])
    if (sess?.length) {
      setSessionId(sess[0].id)
      const { data: msgs } = await supabase.from('deal_chat_messages').select('*')
        .eq('session_id', sess[0].id).order('created_at')
      setMessages(msgs || [])
    }
    setLoaded(true)
  }

  async function switchSession(sid) {
    setSessionId(sid)
    const { data: msgs } = await supabase.from('deal_chat_messages').select('*')
      .eq('session_id', sid).order('created_at')
    setMessages(msgs || [])
  }

  function newChat() {
    setSessionId(null)
    setMessages([])
  }

  async function sendMessage(text) {
    const userMsg = (text || input).trim()
    if (!userMsg || sending) return
    setInput('')
    setSending(true)
    track('chatbot_message_sent', { context_type: 'deal', deal_id: dealId, message_length: userMsg.length })
    setMessages(prev => [...prev, { role: 'user', content: userMsg, created_at: new Date().toISOString() }])

    const res = await callDealChat(dealId, sessionId, userMsg, userId)
    setSending(false)

    if (res.error) {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Error: ' + res.error, created_at: new Date().toISOString() }])
      return
    }

    if (!sessionId && res.session_id) {
      setSessionId(res.session_id)
      setSessions(prev => [{ id: res.session_id, title: userMsg.substring(0, 50) }, ...prev])
    }

    setMessages(prev => [...prev, {
      role: 'assistant', content: res.message,
      actions_taken: res.actions_taken || [], created_at: new Date().toISOString(),
    }])

    // Refetch with IDs so thumbs feedback can target the assistant message
    const sid = res.session_id || sessionId
    if (sid) {
      const { data: refetched } = await supabase.from('deal_chat_messages').select('*').eq('session_id', sid).order('created_at')
      if (refetched?.length) setMessages(refetched)
    }

    if (res.actions_taken?.length > 0 && onAction) onAction()
  }

  async function submitThumbs(message, sentiment, reasonKey, notes) {
    if (!message.id) return
    const { error } = await supabase.from('ai_output_feedback').insert({
      org_id: orgId || null,
      user_id: userId,
      deal_id: dealId,
      sentiment,
      target_type: 'chat_response',
      target_id: message.id,
      reason: reasonKey || null,
      notes: notes || null,
    })
    if (error) { console.error('ai_output_feedback insert failed:', error); return }
    setFeedbackState(s => ({ ...s, [message.id]: { ...s[message.id], sentiment, showPicker: false, submitted: true } }))
  }

  async function submitSatisfaction(score) {
    setSatisfactionRating(score)
    if (!sessionId) return
    const thumbsUp = Object.values(feedbackState).filter((f) => f?.sentiment === 'thumbs_up').length
    const thumbsDown = Object.values(feedbackState).filter((f) => f?.sentiment === 'thumbs_down').length
    const { error } = await supabase.from('chatbot_session_feedback').insert({
      session_id: sessionId,
      org_id: orgId || null,
      user_id: userId,
      deal_id: dealId,
      message_count: messages.length,
      thumbs_up_count: thumbsUp,
      thumbs_down_count: thumbsDown,
      satisfaction_score: score,
    })
    if (error) console.error('chatbot_session_feedback insert failed:', error)
  }

  function handleClose() {
    const assistantCount = messages.filter(m => m.role === 'assistant').length
    if (assistantCount >= 3 && !satisfactionShown) {
      setSatisfactionShown(true)
    } else {
      onClose()
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div onClick={handleClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 1099,
        }} />
      )}

      {/* Drawer */}
      <div style={{
        position: 'fixed', right: 0, top: 0, height: '100vh', width: 420,
        background: T.surface, borderLeft: `1px solid ${T.border}`,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', zIndex: 1100,
        transform: `translateX(${isOpen ? 0 : 420}px)`, transition: 'transform 0.3s ease',
        display: 'flex', flexDirection: 'column', fontFamily: T.font,
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 16px', borderBottom: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: T.text, flex: 1 }}>Ask Coach</div>
          {sessions.length > 1 && (
            <select style={{
              fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${T.border}`,
              background: T.surfaceAlt, color: T.text, cursor: 'pointer', fontFamily: T.font, maxWidth: 140,
            }} value={sessionId || ''} onChange={e => e.target.value ? switchSession(e.target.value) : newChat()}>
              <option value="">New Chat</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{(s.title || 'Chat').substring(0, 30)}</option>
              ))}
            </select>
          )}
          <button onClick={newChat} style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${T.border}`, background: T.surfaceAlt, color: T.primary,
            cursor: 'pointer', fontFamily: T.font,
          }}>New</button>
          <button onClick={handleClose} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted,
            fontSize: 20, padding: '0 4px', lineHeight: 1,
          }}>&times;</button>
        </div>

        {/* Messages */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {messages.length === 0 && !sending && (
            <div>
              <div style={{ textAlign: 'center', padding: '24px 0 16px', color: T.textMuted, fontSize: 13 }}>
                Ask your AI coach anything about this deal
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => sendMessage(s)} style={{
                    border: `1px solid ${T.border}`, borderRadius: 20, padding: '6px 14px',
                    fontSize: 12, cursor: 'pointer', background: T.surface, color: T.text,
                    fontFamily: T.font, transition: 'all 0.15s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = T.primaryLight; e.currentTarget.style.borderColor = T.primary }}
                    onMouseLeave={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.borderColor = T.border }}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: 12,
            }}>
              <div style={{
                maxWidth: '85%',
                padding: '10px 14px',
                borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: msg.role === 'user' ? T.primary : T.surfaceAlt,
                color: msg.role === 'user' ? '#fff' : T.text,
                fontSize: 13, lineHeight: 1.6,
                border: msg.role === 'user' ? 'none' : `1px solid ${T.borderLight}`,
              }}>
                {msg.role === 'user' ? msg.content : <MessageContent content={msg.content} />}
                {/* Action badges */}
                {msg.actions_taken?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {msg.actions_taken.map((a, ai) => (
                      <span key={ai} style={{
                        fontSize: 10, fontWeight: 600, color: T.success, background: T.successLight,
                        padding: '2px 8px', borderRadius: 10, border: `1px solid ${T.success}25`,
                      }}>
                        &#10003; {a.action || a.type || 'Action'}{a.title ? `: ${a.title}` : ''}
                      </span>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 10, color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : T.textMuted, marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>{relativeTime(msg.created_at)}</span>
                  {msg.role === 'assistant' && msg.id && (() => {
                    const fb = feedbackState[msg.id] || {}
                    return (
                      <>
                        <span style={{ flex: 1 }} />
                        <button title="Helpful" onClick={() => submitThumbs(msg, 'thumbs_up')}
                          style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', padding: 2, display: 'inline-flex', opacity: fb.sentiment === 'thumbs_up' ? 1 : 0.5, color: fb.sentiment === 'thumbs_up' ? T.success : T.textMuted }}
                          disabled={fb.submitted}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>
                        </button>
                        <button title="Not helpful" onClick={() => { if (fb.submitted) return; setFeedbackState(s => ({ ...s, [msg.id]: { ...s[msg.id], showPicker: true, sentiment: 'thumbs_down' } })) }}
                          style={{ background: 'none', border: 'none', cursor: fb.submitted ? 'default' : 'pointer', padding: 2, display: 'inline-flex', opacity: fb.sentiment === 'thumbs_down' ? 1 : 0.5, color: fb.sentiment === 'thumbs_down' ? T.error : T.textMuted }}
                          disabled={fb.submitted}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg>
                        </button>
                      </>
                    )
                  })()}
                </div>
                {/* Thumbs-down reason picker */}
                {msg.role === 'assistant' && msg.id && feedbackState[msg.id]?.showPicker && !feedbackState[msg.id]?.submitted && (
                  <div style={{ marginTop: 8, padding: 8, borderTop: `1px solid ${T.borderLight}` }}>
                    <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>What was wrong?</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                      {THUMBS_DOWN_REASONS.map(r => (
                        <button key={r.key} onClick={() => setFeedbackState(s => ({ ...s, [msg.id]: { ...s[msg.id], reasonKey: r.key } }))}
                          style={{ fontSize: 10, padding: '3px 8px', borderRadius: 10, border: `1px solid ${feedbackState[msg.id]?.reasonKey === r.key ? T.primary : T.border}`, background: feedbackState[msg.id]?.reasonKey === r.key ? T.primaryLight : 'transparent', color: feedbackState[msg.id]?.reasonKey === r.key ? T.primary : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>{r.label}</button>
                      ))}
                    </div>
                    <input type="text" placeholder="Optional detail..." value={feedbackState[msg.id]?.notes || ''}
                      onChange={e => setFeedbackState(s => ({ ...s, [msg.id]: { ...s[msg.id], notes: e.target.value } }))}
                      style={{ width: '100%', fontSize: 11, padding: '5px 8px', border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, marginBottom: 6 }} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => submitThumbs(msg, 'thumbs_down', feedbackState[msg.id]?.reasonKey, feedbackState[msg.id]?.notes)}
                        disabled={!feedbackState[msg.id]?.reasonKey}
                        style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4, border: 'none', background: feedbackState[msg.id]?.reasonKey ? T.primary : T.borderLight, color: '#fff', cursor: feedbackState[msg.id]?.reasonKey ? 'pointer' : 'default', fontFamily: T.font }}>Submit</button>
                      <button onClick={() => setFeedbackState(s => ({ ...s, [msg.id]: {} }))}
                        style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: `1px solid ${T.border}`, background: 'transparent', color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Typing indicator */}
          {sending && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
              <div style={{
                padding: '12px 18px', borderRadius: '12px 12px 12px 2px',
                background: T.surfaceAlt, border: `1px solid ${T.borderLight}`,
              }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {[0, 1, 2].map(n => (
                    <span key={n} style={{
                      width: 7, height: 7, borderRadius: '50%', background: T.textMuted,
                      animation: `dotPulse 1.2s ease-in-out ${n * 0.2}s infinite`,
                    }} />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div style={{
          borderTop: `1px solid ${T.border}`, padding: '10px 12px',
          display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0,
          background: T.surface,
        }}>
          <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown} disabled={sending}
            placeholder="Ask about this deal..."
            rows={1}
            style={{
              flex: 1, border: 'none', outline: 'none', resize: 'none',
              padding: '10px 14px', fontSize: 14, fontFamily: T.font,
              background: T.surfaceAlt, borderRadius: 20, color: T.text,
              maxHeight: 120, lineHeight: 1.4,
            }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px' }}
          />
          <button onClick={() => sendMessage()} disabled={sending || !input.trim()} style={{
            width: 38, height: 38, borderRadius: '50%', border: 'none',
            background: input.trim() && !sending ? T.primary : T.borderLight,
            color: '#fff', cursor: input.trim() && !sending ? 'pointer' : 'default',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0, transition: 'background 0.15s', fontSize: 16,
          }}>&#8593;</button>
        </div>

        <style>{`
          @keyframes dotPulse {
            0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
            40% { opacity: 1; transform: scale(1); }
          }
        `}</style>

        {/* End-of-session satisfaction overlay */}
        {satisfactionShown && isOpen && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: T.surface, borderRadius: 12, padding: 24, width: '100%', maxWidth: 320, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', textAlign: 'center' }}>
              {satisfactionRating ? (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.success, marginBottom: 6 }}>Thanks for the feedback!</div>
                  <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>This helps us improve the AI coach.</div>
                  <button onClick={onClose} style={{ padding: '8px 20px', background: T.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600, fontFamily: T.font, fontSize: 13 }}>Close</button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>How was this session?</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 14 }}>Rate your AI coach chat</div>
                  <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
                    {[1, 2, 3, 4, 5].map(n => (
                      <button key={n} onClick={() => submitSatisfaction(n)}
                        style={{ width: 36, height: 36, borderRadius: 8, border: `1px solid ${T.border}`, background: T.surfaceAlt, cursor: 'pointer', fontSize: 18, fontFamily: T.font, color: T.textMuted }}
                        onMouseEnter={e => { e.currentTarget.style.background = T.primaryLight; e.currentTarget.style.borderColor = T.primary }}
                        onMouseLeave={e => { e.currentTarget.style.background = T.surfaceAlt; e.currentTarget.style.borderColor = T.border }}>{n}</button>
                    ))}
                  </div>
                  <button onClick={onClose} style={{ fontSize: 11, color: T.textMuted, background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font }}>Skip</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
