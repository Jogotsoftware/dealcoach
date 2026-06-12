import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'

// Unified notification bell — reads two source tables in parallel, merges
// client-side by created_at DESC. Each row carries `source` so the dropdown
// can route + render with the right icon. Plugging in another source later is
// just one more parallel query + a mapper.

const DEAL_ROOM_LABELS = {
  comment_added:          (p) => `${p.viewer_name || p.viewer_email} commented on ${p.deal_company || 'a deal'}'s ${p.tab || 'room'}`,
  change_request_created: (p) => `${p.requester_name || p.requester_email} requested a change on ${p.deal_company || 'a deal'}`,
  viewer_added:           (p) => `${p.added_name || p.added_email} was added to ${p.deal_company || 'a deal'}'s room`,
  first_view:             (p) => `${p.viewer_name || p.viewer_email} first viewed ${p.deal_company || 'a deal'}'s deal room`,
  email_ae:               (p) => `${p.viewer_name || p.viewer_email} messaged you about ${p.deal_company || 'a deal'}: ${p.subject || ''}`,
}

// The AE<->SC loop (internal_notifications). payload carries actor_name +
// deal_company so the row renders without extra lookups, matching the
// deal_room pattern.
const co = (p) => p.deal_company ? ` · ${p.deal_company}` : ''
const INTERNAL_LABELS = {
  sc_viewed_notes:          (p) => `${p.actor_name || 'The SC'} viewed the discovery notes${co(p)}`,
  ae_viewed_sc_notes:       (p) => `${p.actor_name || 'The AE'} viewed your SC notes${co(p)}`,
  sc_selected_demo_modules: (p) => `${p.actor_name || 'The SC'} updated the demo modules${co(p)}`,
  ae_updated_quote:         (p) => `${p.actor_name || 'The AE'} updated the quote${co(p)}`,
  ae_updated_msp:           (p) => `${p.actor_name || 'The AE'} updated the project plan${co(p)}`,
  ae_pushed_to_sc:          (p) => `${p.actor_name || 'The AE'} handed you ${p.deal_company || 'a deal'}`,
  sc_uploaded_demo_video:   (p) => `${p.actor_name || 'The SC'} uploaded a demo video${co(p)}`,
  sc_scheduled_demo:        (p) => `${p.actor_name || 'The SC'} scheduled a demo${co(p)}`,
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

const SOURCE_META = {
  deal_room: { color: T.primary, label: 'Deal room' },
  sme:       { color: '#a855f7', label: 'SME' },
  bdr:       { color: T.success, label: 'My leads' },
  internal:  { color: '#0d9488', label: 'Deal' },
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
      const [dr, sme, bdr, internal] = await Promise.all([
        supabase.from('deal_room_notifications').select('id', { count: 'exact', head: true })
          .eq('ae_user_id', profile.id).is('read_at', null),
        supabase.from('sme_notifications').select('id', { count: 'exact', head: true })
          .eq('recipient_user_id', profile.id).is('read_at', null),
        supabase.from('bdr_notifications').select('id', { count: 'exact', head: true })
          .eq('recipient_user_id', profile.id).is('read_at', null),
        supabase.from('internal_notifications').select('id', { count: 'exact', head: true })
          .eq('recipient_user_id', profile.id).is('read_at', null),
      ])
      setUnread((dr.count || 0) + (sme.count || 0) + (bdr.count || 0) + (internal.count || 0))
    } catch (e) { console.warn('notification poll failed:', e) }
  }

  async function loadDropdown() {
    if (!profile?.id) return
    try {
      const [drRes, smeRes, bdrRes, internalRes] = await Promise.all([
        supabase.from('deal_room_notifications').select('*').eq('ae_user_id', profile.id).order('created_at', { ascending: false }).limit(10),
        supabase.from('sme_notifications').select('*').eq('recipient_user_id', profile.id).order('created_at', { ascending: false }).limit(10),
        supabase.from('bdr_notifications').select('*').eq('recipient_user_id', profile.id).order('created_at', { ascending: false }).limit(10),
        supabase.from('internal_notifications').select('*').eq('recipient_user_id', profile.id).order('created_at', { ascending: false }).limit(10),
      ])
      const dealRoom = (drRes.data || []).map(r => ({
        source: 'deal_room', id: r.id, table: 'deal_room_notifications',
        text: (DEAL_ROOM_LABELS[r.kind] || (() => r.kind))(r.payload || {}),
        read_at: r.read_at, created_at: r.created_at,
        ref: { kind: 'deal_room', deal_room_id: r.deal_room_id },
      }))
      const smeItems = (smeRes.data || []).map(r => ({
        source: 'sme', id: r.id, table: 'sme_notifications',
        text: r.title + (r.body ? `  ·  ${r.body}` : ''),
        read_at: r.read_at, created_at: r.created_at,
        ref: { kind: r.notification_type, reference_id: r.reference_id, reference_table: r.reference_table },
      }))
      const bdrItems = (bdrRes.data || []).map(r => ({
        source: 'bdr', id: r.id, table: 'bdr_notifications',
        text: r.title + (r.body ? `  ·  ${r.body}` : ''),
        read_at: r.read_at, created_at: r.created_at,
        ref: { kind: r.notification_type, reference_id: r.reference_id, reference_table: r.reference_table },
      }))
      const internalItems = (internalRes.data || []).map(r => ({
        source: 'internal', id: r.id, table: 'internal_notifications',
        text: (INTERNAL_LABELS[r.kind] || (() => r.kind.replace(/_/g, ' ')))(r.payload || {}),
        read_at: r.read_at, created_at: r.created_at,
        ref: { kind: 'internal', deal_id: r.deal_id },
      }))
      const merged = [...dealRoom, ...smeItems, ...bdrItems, ...internalItems]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 12)
      setItems(merged)
    } catch (e) { console.warn('notification load failed:', e) }
  }

  async function markRead(item) {
    try {
      await supabase.from(item.table).update({ read_at: new Date().toISOString() }).eq('id', item.id)
      setItems(prev => prev.map(n => (n.id === item.id && n.table === item.table) ? { ...n, read_at: new Date().toISOString() } : n))
      setUnread(prev => Math.max(0, prev - 1))
    } catch (e) { console.warn('mark read failed:', e) }
  }

  async function clickItem(item) {
    if (!item.read_at) await markRead(item)
    setOpen(false)
    if (item.source === 'deal_room' && item.ref.deal_room_id) {
      try {
        const { data } = await supabase.from('deal_rooms').select('deal_id').eq('id', item.ref.deal_room_id).single()
        if (data?.deal_id) nav(`/deal/${data.deal_id}/room`)
      } catch (e) { console.warn('nav lookup failed:', e) }
    } else if (item.source === 'sme') {
      // sme notifications all reference a sme_question (questions, flags, badges all link to a question)
      if (item.ref.reference_table === 'sme_questions' && item.ref.reference_id) {
        nav(`/sme/question/${item.ref.reference_id}`)
      } else {
        nav('/sme/inbox')
      }
    } else if (item.source === 'bdr') {
      // BDR notifications reference a bdr_leads row — link to the lead detail.
      if (item.ref.reference_id) {
        nav(`/bdr/leads/${item.ref.reference_id}`)
      } else {
        nav('/bdr/my-leads')
      }
    } else if (item.source === 'internal') {
      // AE<->SC loop — route by role: SC into the SC workspace, others into
      // the AE deal view.
      if (item.ref.deal_id) {
        nav(profile?.role === 'sc' ? `/sc/deals/${item.ref.deal_id}` : `/deal/${item.ref.deal_id}`)
      }
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
          <div style={{ position: 'absolute', top: 'calc(100% + 6px)', right: -8, width: 380, maxHeight: 480, overflowY: 'auto', zIndex: 999, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.18)' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', background: T.surfaceAlt }}>
              <strong style={{ fontSize: 13, color: T.text, flex: 1 }}>Notifications</strong>
              <button onClick={() => { nav('/notifications'); setOpen(false) }}
                style={{ background: 'none', border: 'none', color: T.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>View all</button>
            </div>
            {items.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No notifications yet</div>
            ) : items.map(n => {
              const meta = SOURCE_META[n.source] || { color: T.textMuted, label: n.source }
              return (
                <div key={`${n.table}:${n.id}`} onClick={() => clickItem(n)}
                  style={{ padding: '10px 14px', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer', background: n.read_at ? T.surface : T.primaryLight }}
                  onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                  onMouseLeave={e => e.currentTarget.style.background = n.read_at ? T.surface : T.primaryLight}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    {!n.read_at && <span style={{ width: 6, height: 6, borderRadius: '50%', background: meta.color, marginTop: 5, flexShrink: 0 }} />}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.text, lineHeight: 1.4 }}>{n.text}</div>
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
