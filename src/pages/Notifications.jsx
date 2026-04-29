import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, EmptyState } from '../components/Shared'

const FILTERS = [
  { k: 'all',                     l: 'All' },
  { k: 'unread',                  l: 'Unread' },
  { k: 'comment_added',           l: 'Comments' },
  { k: 'change_request_created',  l: 'Change Requests' },
  { k: 'viewer_added',            l: 'Viewers' },
  { k: 'email_ae',                l: 'Emails' },
  { k: 'first_view',              l: 'First Views' },
]

const KIND_LABELS = {
  comment_added:          (p) => `${p.viewer_name || p.viewer_email} commented on ${p.deal_company || 'a deal'}'s ${p.tab || 'room'}`,
  change_request_created: (p) => `${p.requester_name || p.requester_email} requested a change on ${p.deal_company || 'a deal'}`,
  viewer_added:           (p) => `${p.added_name || p.added_email} was added to ${p.deal_company || 'a deal'}'s room`,
  first_view:             (p) => `${p.viewer_name || p.viewer_email} first viewed ${p.deal_company || 'a deal'}'s deal room`,
  email_ae:               (p) => `${p.viewer_name || p.viewer_email}: ${p.subject || ''}`,
}

const KIND_COLORS = {
  comment_added: T.primary,
  change_request_created: T.warning,
  viewer_added: T.sageGreen,
  first_view: T.success,
  email_ae: '#a855f7',
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

function bucketByDate(d) {
  const ms = Date.now() - new Date(d).getTime()
  const days = Math.floor(ms / 86400000)
  if (days < 1) return 'Today'
  if (days < 2) return 'Yesterday'
  if (days < 7) return 'This Week'
  return 'Earlier'
}

const PAGE_SIZE = 50

export default function NotificationsPage() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)

  useEffect(() => { setItems([]); setPage(0); load(0, true) }, [filter, profile?.id])

  async function load(pg = page, reset = false) {
    if (!profile?.id) return
    setLoading(true)
    try {
      let q = supabase.from('deal_room_notifications').select('*')
        .eq('ae_user_id', profile.id)
        .order('created_at', { ascending: false })
        .range(pg * PAGE_SIZE, pg * PAGE_SIZE + PAGE_SIZE - 1)
      if (filter === 'unread') q = q.is('read_at', null)
      else if (filter !== 'all') q = q.eq('kind', filter)
      const { data, error } = await q
      if (error) throw error
      setItems(prev => reset ? (data || []) : [...prev, ...(data || [])])
      setHasMore((data || []).length === PAGE_SIZE)
    } catch (e) { console.error('notifications load failed:', e) }
    finally { setLoading(false) }
  }

  async function markRead(n) {
    try {
      await supabase.from('deal_room_notifications').update({ read_at: new Date().toISOString() }).eq('id', n.id)
      setItems(prev => prev.map(x => x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))
    } catch (e) { console.warn('mark read failed:', e) }
  }

  async function markAllRead() {
    try {
      await supabase.from('deal_room_notifications').update({ read_at: new Date().toISOString() }).eq('ae_user_id', profile.id).is('read_at', null)
      setItems(prev => prev.map(x => x.read_at ? x : { ...x, read_at: new Date().toISOString() }))
    } catch (e) { console.warn('mark all read failed:', e) }
  }

  async function openItem(n) {
    if (!n.read_at) await markRead(n)
    if (n.deal_room_id) {
      try {
        const { data } = await supabase.from('deal_rooms').select('deal_id').eq('id', n.deal_room_id).single()
        if (data?.deal_id) nav(`/deal/${data.deal_id}/room`)
      } catch (e) { console.warn('nav lookup failed:', e) }
    }
  }

  // Group by date bucket
  const grouped = useMemo(() => {
    const out = {}
    for (const n of items) {
      const b = bucketByDate(n.created_at)
      if (!out[b]) out[b] = []
      out[b].push(n)
    }
    return out
  }, [items])

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', alignItems: 'center', gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text, flex: 1 }}>Notifications</h2>
        <Button onClick={markAllRead}>Mark all as read</Button>
      </div>

      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.borderLight}`, background: T.surfaceAlt, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${filter === f.k ? T.primary : T.border}`, borderRadius: 999, background: filter === f.k ? T.primary : T.surface, color: filter === f.k ? '#fff' : T.text, cursor: 'pointer', fontFamily: T.font }}>
            {f.l}
          </button>
        ))}
      </div>

      <div style={{ padding: '16px 24px' }}>
        {loading && items.length === 0 ? <Spinner /> : items.length === 0 ? (
          <EmptyState title="No notifications" message="You're all caught up." />
        ) : (
          <>
            {['Today', 'Yesterday', 'This Week', 'Earlier'].map(bucket => {
              const list = grouped[bucket]
              if (!list || list.length === 0) return null
              return (
                <div key={bucket} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>{bucket}</div>
                  <Card>
                    {list.map(n => {
                      const labelFn = KIND_LABELS[n.kind]
                      const text = labelFn ? labelFn(n.payload || {}) : n.kind
                      const color = KIND_COLORS[n.kind] || T.textMuted
                      return (
                        <div key={n.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 4px', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer', background: n.read_at ? 'transparent' : T.primaryLight + '40' }}
                          onClick={() => openItem(n)}>
                          {!n.read_at && <span style={{ width: 8, height: 8, borderRadius: '50%', background: T.primary, marginTop: 6, flexShrink: 0 }} />}
                          <Badge color={color}>{(n.kind || '').replace(/_/g, ' ')}</Badge>
                          <div style={{ flex: 1, fontSize: 13, color: T.text, lineHeight: 1.4 }}>{text}</div>
                          <span style={{ fontSize: 11, color: T.textMuted, whiteSpace: 'nowrap' }}>{relativeTime(n.created_at)}</span>
                          {!n.read_at && (
                            <button onClick={(e) => { e.stopPropagation(); markRead(n) }} style={{ background: 'none', border: `1px solid ${T.border}`, color: T.textMuted, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Mark read</button>
                          )}
                        </div>
                      )
                    })}
                  </Card>
                </div>
              )
            })}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <Button onClick={() => { const next = page + 1; setPage(next); load(next) }} disabled={loading}>
                  {loading ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
