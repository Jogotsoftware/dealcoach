import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'

const KIND_LABELS = {
  comment_added:          (p) => `${p.viewer_name || p.viewer_email} commented on ${p.deal_company || 'a deal'}'s ${p.tab || 'room'}`,
  change_request_created: (p) => `${p.requester_name || p.requester_email} requested a change on ${p.deal_company || 'a deal'}`,
  viewer_added:           (p) => `${p.added_name || p.added_email} was added to ${p.deal_company || 'a deal'}'s room`,
  first_view:             (p) => `${p.viewer_name || p.viewer_email} first viewed ${p.deal_company || 'a deal'}'s deal room`,
  email_ae:               (p) => `${p.viewer_name || p.viewer_email} messaged you about ${p.deal_company || 'a deal'}: ${p.subject || ''}`,
}

function relativeTime(d) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function NotificationBell() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState([])
  const closeRef = useRef(null)

  useEffect(() => {
    if (!profile?.id) return
    poll()
    const t = setInterval(poll, 30000)
    return () => clearInterval(t)
  }, [profile?.id])

  async function poll() {
    if (!profile?.id) return
    try {
      const { count } = await supabase.from('deal_room_notifications').select('id', { count: 'exact', head: true })
        .eq('ae_user_id', profile.id).is('read_at', null)
      setUnread(count || 0)
    } catch (e) { console.warn('notification poll failed:', e) }
  }

  async function loadDropdown() {
    try {
      const { data } = await supabase.from('deal_room_notifications').select('*')
        .eq('ae_user_id', profile.id).order('created_at', { ascending: false }).limit(10)
      setItems(data || [])
    } catch (e) { console.warn('notification load failed:', e) }
  }

  async function markRead(notification) {
    try {
      await supabase.from('deal_room_notifications').update({ read_at: new Date().toISOString() }).eq('id', notification.id)
      setItems(prev => prev.map(n => n.id === notification.id ? { ...n, read_at: new Date().toISOString() } : n))
      setUnread(prev => Math.max(0, prev - 1))
    } catch (e) { console.warn('mark read failed:', e) }
  }

  async function clickItem(n) {
    if (!n.read_at) await markRead(n)
    setOpen(false)
    // Navigate to the room
    if (n.deal_room_id) {
      try {
        const { data } = await supabase.from('deal_rooms').select('deal_id').eq('id', n.deal_room_id).single()
        if (data?.deal_id) nav(`/deal/${data.deal_id}/room`)
      } catch (e) { console.warn('nav lookup failed:', e) }
    }
  }

  function toggle() {
    if (!open) loadDropdown()
    setOpen(!open)
  }

  return (
    <div style={{ position: 'relative' }} ref={closeRef}>
      <button onClick={toggle} title="Notifications"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6, position: 'relative', display: 'flex', alignItems: 'center', color: '#8899aa' }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -4,
            minWidth: 14, height: 14, borderRadius: 7,
            background: T.error, color: '#fff',
            fontSize: 9, fontWeight: 700,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', lineHeight: 1,
            border: `2px solid ${T.surface}`,
            boxSizing: 'content-box',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: -8, width: 360, maxHeight: 460, overflowY: 'auto', zIndex: 999, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', background: T.surfaceAlt }}>
              <strong style={{ fontSize: 13, color: T.text, flex: 1 }}>Notifications</strong>
              <button onClick={() => { nav('/notifications'); setOpen(false) }}
                style={{ background: 'none', border: 'none', color: T.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>View all</button>
            </div>
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No notifications yet</div>
            ) : items.map(n => {
              const labelFn = KIND_LABELS[n.kind]
              const text = labelFn ? labelFn(n.payload || {}) : n.kind
              return (
                <div key={n.id} onClick={() => clickItem(n)}
                  style={{ padding: '10px 14px', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer', background: n.read_at ? T.surface : T.primaryLight }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = n.read_at ? T.surface : T.primaryLight}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {!n.read_at && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.primary, marginTop: 5, flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>{text}</div>
                      <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{relativeTime(n.created_at)}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
