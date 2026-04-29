import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatDate } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import CompanyLogo from '../components/CompanyLogo'
import MSPEditor from '../components/MSPEditor'

const APP_BASE = (typeof window !== 'undefined' && window.location.origin) || ''

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

function describeRequestedChange(req) {
  if (!req || !req.requested_change) return 'Unknown change'
  const c = req.requested_change
  const tableLabel = req.target_table === 'msp_stages' ? 'stage' : 'milestone'
  const field = c.field || ''
  const fromV = c.current ?? '—'
  const toV = c.proposed ?? '—'
  const fmt = (v) => (v === null || v === undefined || v === '') ? '(empty)' : String(v)
  return `${tableLabel} · change ${field} from "${fmt(fromV)}" to "${fmt(toV)}"`
}

export default function DealRoomConfig() {
  const { dealId } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const { org } = useOrg() || {}

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deal, setDeal] = useState(null)
  const [room, setRoom] = useState(null)
  const [quotes, setQuotes] = useState([])
  const [selectedQuoteId, setSelectedQuoteId] = useState('')
  const [stages, setStages] = useState([])
  const [milestones, setMilestones] = useState([])
  const [resources, setResources] = useState([])
  const [viewers, setViewers] = useState([])
  const [recentViews, setRecentViews] = useState([])
  const [comments, setComments] = useState([])
  const [requests, setRequests] = useState([])

  const [busy, setBusy] = useState(false)
  const [snapshotting, setSnapshotting] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteName, setInviteName] = useState('')
  const [reply, setReply] = useState({})  // commentId → draft reply text
  const [aeNotesDraft, setAeNotesDraft] = useState('')
  const [aeNotesSavedAt, setAeNotesSavedAt] = useState(null)
  const [tab, setTab] = useState(() => {
    if (typeof window === 'undefined') return 'msp'
    const h = (window.location.hash || '').replace('#', '')
    return ['msp', 'library', 'quotes', 'models', 'inbox'].includes(h) ? h : 'msp'
  })

  function selectTab(next) {
    setTab(next)
    try { window.history.replaceState(null, '', `#${next}`) } catch { /* ignore */ }
  }

  useEffect(() => { load(true) }, [dealId])

  async function load(spinner = false) {
    if (spinner) setLoading(true)
    setError('')
    try {
      const [dealRes, roomRes, quotesRes, stagesRes, milestonesRes, resRes, viewersRes, viewsRes, commentsRes, requestsRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, customer_logo_url, customer_logo_storage_path, rep_id, org_id').eq('id', dealId).single(),
        supabase.from('deal_rooms').select('*').eq('deal_id', dealId).single(),
        supabase.from('quotes').select('id, name, version, is_primary, status').eq('deal_id', dealId).order('created_at', { ascending: false }),
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        supabase.from('deal_resources').select('id, resource_type, title, notes, url, storage_path, mime_type, file_size, sort_order').eq('deal_id', dealId).order('sort_order').order('created_at'),
        // viewers + views read deal_room_id from the room we'll fetch, but we don't have it yet — fetch by deal_room_id in a follow-up
        Promise.resolve({ data: [] }),
        Promise.resolve({ data: [] }),
        Promise.resolve({ data: [] }),
        Promise.resolve({ data: [] }),
      ])
      if (dealRes.error) throw dealRes.error
      if (roomRes.error) throw roomRes.error
      setDeal(dealRes.data)
      setRoom(roomRes.data)
      setAeNotesDraft(roomRes.data?.ae_notes || '')
      setQuotes(quotesRes.data || [])
      const primary = (quotesRes.data || []).find(q => q.is_primary)
      setSelectedQuoteId(primary?.id || quotesRes.data?.[0]?.id || '')
      setStages(stagesRes.data || [])
      setMilestones(milestonesRes.data || [])
      setResources(resRes.data || [])

      // Now fetch room-scoped collections
      const roomId = roomRes.data.id
      const [vRes, recentRes, cRes, rReqRes] = await Promise.all([
        supabase.from('deal_room_viewers').select('*').eq('deal_room_id', roomId).order('invited_at', { ascending: false }),
        supabase.from('deal_room_views').select('id, viewer_id, viewer_email, tab, viewed_at').eq('deal_room_id', roomId).order('viewed_at', { ascending: false }).limit(50),
        supabase.from('deal_room_comments').select('*').eq('deal_room_id', roomId).order('created_at'),
        supabase.from('deal_room_change_requests').select('*').eq('deal_room_id', roomId).order('created_at', { ascending: false }),
      ])
      setViewers(vRes.data || [])
      setRecentViews(recentRes.data || [])
      setComments(cRes.data || [])
      setRequests(rReqRes.data || [])
    } catch (e) {
      console.error('[DealRoomConfig] load failed:', e)
      setError(e?.message || 'Load failed')
    } finally {
      if (spinner) setLoading(false)
    }
  }

  async function saveRoom(patch) {
    setBusy(true)
    try {
      const { error: e } = await supabase.from('deal_rooms').update(patch).eq('id', room.id)
      if (e) throw e
      setRoom(prev => ({ ...prev, ...patch }))
    } catch (e) { setError(e?.message || 'Save failed') }
    finally { setBusy(false) }
  }

  async function refreshProposalSnapshot() {
    if (!selectedQuoteId) return
    setSnapshotting(true)
    setError('')
    try {
      const { error: e } = await supabase.rpc('snapshot_proposal', { p_quote_id: selectedQuoteId })
      if (e) throw e
      await load()
    } catch (e) {
      console.error('snapshot_proposal failed:', e)
      setError(e?.message || 'Snapshot failed')
    } finally { setSnapshotting(false) }
  }

  async function inviteViewer() {
    const email = inviteEmail.trim().toLowerCase()
    if (!email) return
    setBusy(true)
    try {
      // Check if viewer exists
      const { data: existing } = await supabase.from('deal_room_viewers').select('id, magic_token').eq('deal_room_id', room.id).eq('email', email).maybeSingle()
      let token = existing?.magic_token
      if (!existing) {
        const { data: created, error } = await supabase.from('deal_room_viewers').insert({
          deal_room_id: room.id, email, name: inviteName.trim() || null,
          added_by: 'rep',
        }).select('magic_token').single()
        if (error) throw error
        token = created.magic_token
      }
      const link = `${APP_BASE}/room/${room.share_token}?t=${token}`
      try { await navigator.clipboard.writeText(link) } catch { /* ignore */ }
      alert(`Magic link copied to clipboard. Send it to ${email} however you'd like.\n\n${link}`)
      setInviteEmail(''); setInviteName('')
      await load()
    } catch (e) {
      console.error('inviteViewer failed:', e)
      alert(e?.message || 'Invite failed')
    } finally { setBusy(false) }
  }

  async function saveAeNotes() {
    const next = (aeNotesDraft || '').trim() || null
    const current = room?.ae_notes || null
    if (next === current) return
    try {
      await saveRoom({ ae_notes: next })
      setAeNotesSavedAt(Date.now())
    } catch (e) { /* error already surfaced via setError in saveRoom */ }
  }

  async function copyShareUrl() {
    const url = `${APP_BASE}/room/${room.share_token}`
    try { await navigator.clipboard.writeText(url); alert('Link copied — paste it into a message to your team or your customer.') } catch { window.prompt('Copy this URL:', url) }
  }

  function openCustomerPreview() {
    // Authenticated AE preview route. Does NOT create a viewer row, does NOT
    // log a view, and does NOT fire first-view notifications. Reads room
    // data via RLS using the AE's session.
    window.open(`${APP_BASE}/deal/${dealId}/room/preview`, '_blank')
  }

  async function aeReply(parentComment, text) {
    const txt = (text || '').trim()
    if (!txt) return
    try {
      await supabase.from('deal_room_comments').insert({
        deal_room_id: room.id,
        parent_comment_id: parentComment.id,
        tab: parentComment.tab,
        reference_kind: parentComment.reference_kind,
        reference_id: parentComment.reference_id,
        author_kind: 'ae',
        author_user_id: profile?.id,
        author_email: profile?.email,
        author_name: profile?.full_name,
        body: txt,
      })
      setReply(prev => ({ ...prev, [parentComment.id]: '' }))
      await load()
    } catch (e) { alert(e?.message || 'Reply failed') }
  }

  async function markCommentResolved(comment) {
    try {
      await supabase.from('deal_room_comments').update({
        resolved: !comment.resolved,
        resolved_by: !comment.resolved ? profile?.id : null,
        resolved_at: !comment.resolved ? new Date().toISOString() : null,
      }).eq('id', comment.id)
      await load()
    } catch (e) { alert(e?.message || 'Update failed') }
  }

  async function acceptRequest(req) {
    setBusy(true)
    try {
      const { error: e } = await supabase.rpc('accept_change_request', { p_request_id: req.id })
      if (e) throw e
      await load()
    } catch (e) { alert(e?.message || 'Accept failed') }
    finally { setBusy(false) }
  }

  async function rejectRequest(req) {
    const notes = window.prompt('Reason for rejection (optional):') || null
    setBusy(true)
    try {
      const { error: e } = await supabase.rpc('reject_change_request', { p_request_id: req.id, p_notes: notes })
      if (e) throw e
      await load()
    } catch (e) { alert(e?.message || 'Reject failed') }
    finally { setBusy(false) }
  }

  if (loading) return <Spinner />
  if (error && !room) return <div style={{ padding: 40, color: T.error }}>{error}</div>
  if (!room) return <div style={{ padding: 40, color: T.textMuted }}>No deal room found.</div>

  const shareUrl = `${APP_BASE}/room/${room.share_token}`
  const expiringInDays = room.expires_at ? Math.ceil((new Date(room.expires_at) - new Date()) / 86400000) : null
  const archived = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now()
  const viewerComments = comments.filter(c => c.author_kind === 'viewer' && !c.parent_comment_id)
  const aeReplies = (parentId) => comments.filter(c => c.parent_comment_id === parentId)
  const pendingRequests = requests.filter(r => r.status === 'pending')
  const decidedRequests = requests.filter(r => r.status !== 'pending')

  const unresolvedCommentCount = comments.filter(c => c.author_kind === 'viewer' && !c.resolved && !c.parent_comment_id).length
  const inboxBadge = unresolvedCommentCount + pendingRequests.length
  const primaryQuoteId = (quotes.find(q => q.is_primary) || quotes[0])?.id || null

  const TABS = [
    { key: 'msp',     label: 'Project Plan' },
    { key: 'library', label: 'Library' },
    { key: 'quotes',  label: 'Quotes' },
    { key: 'models',  label: 'Models' },
    { key: 'inbox',   label: 'Inbox' },
  ]

  return (
    <div>
      {/* ════════════ Sticky header strip ════════════ */}
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        {/* Row 1: identity + preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 24px 8px' }}>
          <button onClick={() => nav(`/deal/${dealId}`)}
            title="Back to deal"
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, padding: '0 4px', lineHeight: 1, fontFamily: T.font }}>
            ‹
          </button>
          <CompanyLogo
            logoUrl={null}
            customerLogoUrl={deal?.customer_logo_url}
            companyName={deal?.company_name}
            size="md"
            bare
            editable
            dealId={deal?.id}
            currentStoragePath={deal?.customer_logo_storage_path}
            onUploaded={(url, path) => setDeal(prev => prev ? { ...prev, customer_logo_url: url, customer_logo_storage_path: path } : prev)}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Deal Room — {deal?.company_name}
            </h2>
          </div>
          {archived && <Badge color={T.warning}>Archived</Badge>}
          <Button onClick={openCustomerPreview} style={{ padding: '8px 16px', fontSize: 12 }}>Preview customer view ↗</Button>
        </div>

        {/* Row 2: share row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px 10px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 280 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Share</span>
            <input readOnly value={shareUrl}
              onClick={e => e.target.select()}
              style={{ ...inputStyle, fontFamily: T.mono, fontSize: 11, flex: 1, padding: '5px 8px' }} />
            <Button primary onClick={copyShareUrl} style={{ padding: '5px 12px', fontSize: 11, whiteSpace: 'nowrap' }}>Share With Your Team</Button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginRight: 2 }}>Mode</span>
            {[
              { k: 'open_token', l: 'Open' },
              { k: 'magic_link', l: 'Magic' },
            ].map(m => (
              <button key={m.k}
                onClick={() => saveRoom({ access_mode: m.k })}
                style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${room.access_mode === m.k ? T.primary : T.border}`, borderRadius: 4, background: room.access_mode === m.k ? T.primaryLight : T.surface, color: room.access_mode === m.k ? T.primary : T.textMuted, cursor: 'pointer', fontFamily: T.font }}>
                {m.l}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Expires</span>
            <input type="date" defaultValue={room.expires_at ? new Date(room.expires_at).toISOString().split('T')[0] : ''}
              onBlur={e => {
                const v = e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null
                if (v !== room.expires_at) saveRoom({ expires_at: v })
              }}
              style={{ ...inputStyle, padding: '4px 8px', fontSize: 11, width: 132 }} />
            <span style={{ fontSize: 10, color: T.textMuted, whiteSpace: 'nowrap' }}>
              {!room.expires_at ? 'No expiration' : (expiringInDays >= 0 ? `${expiringInDays}d left` : `${Math.abs(expiringInDays)}d ago`)}
            </span>
          </div>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11 }}>
            <input type="checkbox" checked={room.enabled} onChange={e => saveRoom({ enabled: e.target.checked })} disabled={busy} />
            {room.enabled ? <Badge color={T.success}>Enabled</Badge> : <Badge color={T.error}>Disabled</Badge>}
          </label>
        </div>

        {/* Row 3: sub-tabs */}
        <div style={{ display: 'flex', gap: 0, padding: '0 24px', borderTop: `1px solid ${T.borderLight}` }}>
          {TABS.map(t => {
            const active = tab === t.key
            const showBadge = t.key === 'inbox' && inboxBadge > 0
            return (
              <button key={t.key} onClick={() => selectTab(t.key)}
                style={{ padding: '11px 18px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600, color: active ? T.primary : T.textMuted, borderBottom: active ? `3px solid ${T.primary}` : '3px solid transparent', marginBottom: -1, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {t.label}
                {showBadge && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 18, height: 18, padding: '0 6px', borderRadius: 9, background: T.error, color: '#fff', fontSize: 10, fontWeight: 800, fontFeatureSettings: '"tnum"' }}>
                    {inboxBadge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div style={{ margin: '10px 24px 0', padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, border: `1px solid ${T.error}30` }}>{error}</div>
      )}

      <div style={{ padding: '16px 24px' }}>
        {/* ════════════ MSP TAB ════════════ */}
        {tab === 'msp' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, marginBottom: 14 }}>
              <Card title={`Notes from ${profile?.full_name || 'you'} (shown on every tab)`}>
                <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 8 }}>
                  A short personal note that appears at the top of every tab in the customer's Evaluation Room. Use it for context, a welcome message, or what to focus on.
                </div>
                <textarea
                  value={aeNotesDraft}
                  onChange={e => setAeNotesDraft(e.target.value)}
                  onBlur={saveAeNotes}
                  placeholder="e.g. Hey team — start with the Project Plan tab to align on dates, then review the proposal. Reach out anytime."
                  rows={3}
                  style={{ ...inputStyle, fontFamily: T.font, fontSize: 13, lineHeight: 1.55, resize: 'vertical' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, fontSize: 10, color: T.textMuted }}>
                  <span>{(aeNotesDraft || '').length} characters{aeNotesSavedAt && Date.now() - aeNotesSavedAt < 4000 ? ' · saved' : ''}</span>
                  <span>Saves automatically when you click outside the box.</span>
                </div>
              </Card>
              <Card title="Theme color">
                <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 8 }}>
                  Sets the primary accent color the customer sees throughout the Evaluation Room.
                </div>
                <ThemeColorPicker
                  value={room?.theme_color || ''}
                  onChange={(hex) => saveRoom({ theme_color: hex || null })}
                />
              </Card>
            </div>
            <Card title="Project Plan" action={<Button onClick={() => nav(`/deal/${dealId}/msp`)} style={{ padding: '4px 10px', fontSize: 11 }}>Open standalone editor</Button>}>
              <MSPEditor dealId={dealId} mode="embedded" />
            </Card>
          </>
        )}

        {/* ════════════ LIBRARY TAB (read-only summary) ════════════ */}
        {tab === 'library' && (
          <Card
            title={`Library — what the customer sees (${resources.length} ${resources.length === 1 ? 'resource' : 'resources'})`}
            action={primaryQuoteId
              ? <Button primary onClick={() => nav(`/deal/${dealId}/quote/${primaryQuoteId}#resources`)} style={{ padding: '4px 12px', fontSize: 11 }}>Edit resources in QuoteBuilder →</Button>
              : <Button primary onClick={() => nav(`/deal/${dealId}/quotes`)} style={{ padding: '4px 12px', fontSize: 11 }}>Build a quote first</Button>}
          >
            <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 12 }}>
              Read-only preview of the cards the customer sees in the Library tab of their Evaluation Room. Add, edit, and reorder resources in QuoteBuilder; this view auto-syncs.
            </div>
            {resources.length === 0 ? (
              <div style={{ padding: 28, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surfaceAlt, borderRadius: 8 }}>
                No resources yet. {primaryQuoteId
                  ? <>Add demos, decks, links, and documents in <a onClick={() => nav(`/deal/${dealId}/quote/${primaryQuoteId}#resources`)} style={{ color: T.primary, cursor: 'pointer', textDecoration: 'underline' }}>QuoteBuilder Resources</a>.</>
                  : 'Build a quote first, then add resources from its Resources tab.'}
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {resources.map(r => {
                  const meta = LIBRARY_RESOURCE_META[r.resource_type] || LIBRARY_RESOURCE_META.misc
                  return (
                    <div key={r.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <span style={{ display: 'inline-block', alignSelf: 'flex-start', padding: '3px 10px', background: meta.color + '18', color: meta.color, fontSize: 10, fontWeight: 700, borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{r.title}</div>
                      {r.notes && <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>{r.notes}</div>}
                      {r.storage_path && r.file_size != null && (
                        <div style={{ fontSize: 10, color: T.textMuted }}>{Math.round(r.file_size / 1024)} KB · {r.mime_type || 'file'}</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Card>
        )}

        {/* ════════════ QUOTES TAB ════════════ */}
        {tab === 'quotes' && (
          <Card title="What the customer will see in the Proposal tab">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
              <Stat label="Project Plan" value={`${stages.length} stages, ${milestones.length} milestones`} />
              <Stat label="Library" value={`${resources.length} resources`} note="Manage in QuoteBuilder Resources tab" />
              <Stat label="Proposal"
                value={room.proposal_snapshotted_at ? `Last refreshed ${relativeTime(room.proposal_snapshotted_at)}` : 'No proposal shared yet'}
                note={room.proposal_snapshot_quote_id ? (() => { const q = quotes.find(x => x.id === room.proposal_snapshot_quote_id); return q ? `${q.name} v${q.version}` : '' })() : ''}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <label style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>Quote:</label>
              <select value={selectedQuoteId} onChange={e => setSelectedQuoteId(e.target.value)} style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', maxWidth: 280, cursor: 'pointer' }}>
                {quotes.length === 0 && <option value="">No quotes yet</option>}
                {quotes.map(q => <option key={q.id} value={q.id}>{q.name} v{q.version}{q.is_primary ? ' · primary' : ''}</option>)}
              </select>
              <Button primary onClick={refreshProposalSnapshot} disabled={!selectedQuoteId || snapshotting} style={{ padding: '6px 14px', fontSize: 12 }}>
                {snapshotting ? 'Snapshotting…' : 'Refresh proposal snapshot'}
              </Button>
              {selectedQuoteId && <Button onClick={() => nav(`/deal/${dealId}/quote/${selectedQuoteId}`)} style={{ padding: '6px 14px', fontSize: 12 }}>Open quote →</Button>}
            </div>
          </Card>
        )}

        {/* ════════════ MODELS TAB ════════════ */}
        {tab === 'models' && (
          <Card title="Models">
            <div style={{ padding: 28, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
              ROI, payment schedules, and TCO live inside QuoteBuilder under the <strong>Models</strong> tab. Engagement analytics for this room (read time per tab, scroll depth, hot pages) will land here in a future sprint.
              {primaryQuoteId && (
                <div style={{ marginTop: 14 }}>
                  <Button primary onClick={() => nav(`/deal/${dealId}/quote/${primaryQuoteId}#models`)} style={{ padding: '6px 14px', fontSize: 12 }}>Open Models in QuoteBuilder →</Button>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ════════════ INBOX TAB ════════════ */}
        {tab === 'inbox' && (
          <>
            <Card title="Inbox" action={inboxBadge > 0 ? <Badge color={T.error}>{inboxBadge} unread</Badge> : null}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                {/* Comments */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Comments ({viewerComments.length})</div>
                  {viewerComments.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No comments yet</div>
                  ) : viewerComments.map(c => {
                    const replies = aeReplies(c.id)
                    const draft = reply[c.id] || ''
                    return (
                      <div key={c.id} style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${c.resolved ? T.success : T.primary}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <strong style={{ fontSize: 12 }}>{c.author_name || c.author_email}</strong>
                          <span style={{ fontSize: 10, color: T.textMuted }}>{relativeTime(c.created_at)} · {c.tab}</span>
                        </div>
                        <div style={{ fontSize: 12, color: T.text, whiteSpace: 'pre-wrap', marginBottom: 6 }}>{c.body}</div>
                        {replies.length > 0 && (
                          <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: `2px solid ${T.borderLight}` }}>
                            {replies.map(r => (
                              <div key={r.id} style={{ fontSize: 11, color: T.textSecondary, marginBottom: 4 }}>
                                <strong>{r.author_name || 'You'}:</strong> {r.body}
                              </div>
                            ))}
                          </div>
                        )}
                        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                          <input value={draft} onChange={e => setReply(prev => ({ ...prev, [c.id]: e.target.value }))} placeholder="Reply…"
                            onKeyDown={e => { if (e.key === 'Enter') aeReply(c, draft) }}
                            style={{ ...inputStyle, fontSize: 11, padding: '4px 6px', flex: 1 }} />
                          <Button onClick={() => aeReply(c, draft)} disabled={!draft.trim()} style={{ padding: '4px 10px', fontSize: 10 }}>Reply</Button>
                          <Button onClick={() => markCommentResolved(c)} style={{ padding: '4px 10px', fontSize: 10 }}>{c.resolved ? 'Reopen' : 'Resolve'}</Button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Change requests */}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Change requests · pending ({pendingRequests.length})</div>
                  {pendingRequests.length === 0 ? (
                    <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>No pending change requests</div>
                  ) : pendingRequests.map(r => (
                    <div key={r.id} style={{ marginBottom: 10, padding: 10, background: T.warningLight, borderRadius: 6, borderLeft: `3px solid ${T.warning}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <strong style={{ fontSize: 12 }}>{r.requester_name || r.requester_email}</strong>
                        <span style={{ fontSize: 10, color: T.textMuted }}>{relativeTime(r.created_at)}</span>
                      </div>
                      <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>{describeRequestedChange(r)}</div>
                      {r.reason && <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 6, fontStyle: 'italic' }}>"{r.reason}"</div>}
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button primary onClick={() => acceptRequest(r)} disabled={busy} style={{ padding: '4px 10px', fontSize: 10 }}>Accept</Button>
                        <Button onClick={() => rejectRequest(r)} disabled={busy} style={{ padding: '4px 10px', fontSize: 10 }}>Reject</Button>
                      </div>
                    </div>
                  ))}

                  {decidedRequests.length > 0 && (
                    <details style={{ marginTop: 12 }}>
                      <summary style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', cursor: 'pointer' }}>Decided ({decidedRequests.length})</summary>
                      <div style={{ marginTop: 8 }}>
                        {decidedRequests.slice(0, 20).map(r => (
                          <div key={r.id} style={{ padding: 8, marginBottom: 6, background: T.surfaceAlt, borderRadius: 4, fontSize: 11 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                              <Badge color={r.status === 'accepted' ? T.success : T.error}>{r.status}</Badge>
                              <span style={{ color: T.textMuted, fontSize: 10 }}>{relativeTime(r.decided_at || r.created_at)}</span>
                            </div>
                            <div style={{ color: T.textSecondary }}>{describeRequestedChange(r)}</div>
                            {r.decision_notes && <div style={{ color: T.textMuted, fontStyle: 'italic', marginTop: 2 }}>{r.decision_notes}</div>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </div>
            </Card>

            <Card title="Viewers & Activity">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Invite viewer</div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="email@company.com"
                      style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', flex: 1 }} />
                    <input value={inviteName} onChange={e => setInviteName(e.target.value)} placeholder="Name"
                      style={{ ...inputStyle, fontSize: 12, padding: '6px 10px', flex: 1 }} />
                    <Button primary onClick={inviteViewer} disabled={!inviteEmail.trim() || busy} style={{ padding: '6px 12px', fontSize: 11 }}>+ Invite</Button>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Viewers ({viewers.length})</div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
                          <th style={{ ...thStyle, padding: '6px 8px' }}>Email</th>
                          <th style={{ ...thStyle, padding: '6px 8px' }}>Name</th>
                          <th style={{ ...thStyle, padding: '6px 8px', textAlign: 'right' }}>Views</th>
                          <th style={{ ...thStyle, padding: '6px 8px' }}>Last seen</th>
                        </tr>
                      </thead>
                      <tbody>
                        {viewers.length === 0 ? (
                          <tr><td colSpan={4} style={{ padding: 12, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No viewers yet</td></tr>
                        ) : viewers.map(v => (
                          <tr key={v.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                            <td style={{ padding: '6px 8px', fontFamily: T.mono, fontSize: 11 }}>{v.email}</td>
                            <td style={{ padding: '6px 8px' }}>{v.name || '—'}</td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{v.view_count || 0}</td>
                            <td style={{ padding: '6px 8px', fontSize: 11, color: T.textMuted }}>{v.last_viewed_at ? relativeTime(v.last_viewed_at) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Recent activity</div>
                  <div style={{ maxHeight: 280, overflowY: 'auto', fontSize: 12 }}>
                    {recentViews.length === 0 ? (
                      <div style={{ padding: 12, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No activity yet</div>
                    ) : recentViews.map(v => (
                      <div key={v.id} style={{ padding: '6px 8px', borderBottom: `1px solid ${T.borderLight}`, display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>{v.viewer_email}</strong>{v.tab ? ` opened ${v.tab}` : ' opened the room'}</span>
                        <span style={{ color: T.textMuted, fontSize: 11 }}>{relativeTime(v.viewed_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

// Resource type metadata mirroring what the customer sees in the public
// viewer's Library tab. Kept local to avoid an import cycle with
// DealRoomViewer; if the source-of-truth shape changes there, mirror here.
const LIBRARY_RESOURCE_META = {
  demo:       { label: 'Demo',       color: '#a855f7' },
  link:       { label: 'Link',       color: T.primary },
  powerpoint: { label: 'PowerPoint', color: '#dc6b2f' },
  document:   { label: 'Document',   color: T.sageGreen },
  misc:       { label: 'Other',      color: T.textMuted },
}

const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }

// Quick-pick palette for the Evaluation Room theme. Hand-picked across the
// spectrum so an AE can grab a brand-adjacent color in one click; the native
// color input below the swatches gives them the full spectrum if they want
// something exact.
const THEME_COLOR_PRESETS = [
  '#5DADE2', // Carolina Blue (default)
  '#2563eb', // royal blue
  '#0ea5e9', // sky
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#22c55e', // green
  '#84cc16', // lime
  '#eab308', // yellow
  '#f59e0b', // amber
  '#f97316', // orange
  '#dc2626', // red
  '#e11d48', // rose
  '#ec4899', // pink
  '#a855f7', // violet
  '#7c3aed', // purple
  '#4f46e5', // indigo
  '#0f172a', // slate-900
  '#374151', // gray-700
]

function ThemeColorPicker({ value, onChange }) {
  const current = value || ''
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
        {THEME_COLOR_PRESETS.map(c => {
          const selected = current.toLowerCase() === c.toLowerCase()
          return (
            <button
              key={c}
              onClick={() => onChange(c)}
              title={c}
              style={{
                width: 30, height: 30, borderRadius: 6, background: c, cursor: 'pointer',
                border: selected ? `2px solid ${T.text}` : `1px solid ${T.borderLight}`,
                padding: 0, position: 'relative', boxShadow: selected ? `0 0 0 2px ${T.surface}` : 'none',
              }}
            >
              {selected && <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 14, fontWeight: 900, textShadow: '0 1px 2px rgba(0,0,0,0.5)' }}>✓</span>}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="color"
            value={current || '#5DADE2'}
            onChange={e => onChange(e.target.value)}
            style={{ width: 36, height: 36, padding: 0, border: `1px solid ${T.borderLight}`, borderRadius: 6, cursor: 'pointer', background: T.surface }}
            title="Pick any color"
          />
          <span style={{ fontSize: 11, color: T.textSecondary }}>Pick any color</span>
        </label>
        <input
          type="text"
          value={current}
          onChange={e => onChange(e.target.value)}
          placeholder="#5DADE2"
          style={{ ...inputStyle, width: 110, padding: '6px 8px', fontSize: 12, fontFamily: T.mono }}
        />
        <button
          onClick={() => onChange('')}
          style={{ padding: '6px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}
        >
          Reset
        </button>
        <div style={{ flex: 1 }} />
        <div title="Live preview" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', borderRadius: 6, background: (current || T.primary), color: '#fff', fontSize: 11, fontWeight: 700 }}>
          Preview
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, note }) {
  return (
    <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${T.primary}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{note}</div>}
    </div>
  )
}
