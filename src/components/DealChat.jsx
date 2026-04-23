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

export default function DealChat({ dealId, userId, isOpen, onClose, onAction }) {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loaded, setLoaded] = useState(false)
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

    if (res.actions_taken?.length > 0 && onAction) onAction()
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
        <div onClick={onClose} style={{
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
          <button onClick={onClose} style={{
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
                <div style={{ fontSize: 10, color: msg.role === 'user' ? 'rgba(255,255,255,0.6)' : T.textMuted, marginTop: 4 }}>
                  {relativeTime(msg.created_at)}
                </div>
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
      </div>
    </>
  )
}
