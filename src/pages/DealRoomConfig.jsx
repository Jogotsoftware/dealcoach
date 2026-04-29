import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatDate } from '../lib/theme'
import { Card, Badge, Button, Spinner, EmptyState, inputStyle, labelStyle } from '../components/Shared'
import CompanyLogo from '../components/CompanyLogo'
import MSPCalendar from '../components/MSPCalendar'

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
        supabase.from('deal_resources').select('id, resource_type, title').eq('deal_id', dealId),
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

  async function copyShareUrl() {
    const url = `${APP_BASE}/room/${room.share_token}`
    try { await navigator.clipboard.writeText(url); alert('Share URL copied') } catch { window.prompt('Copy this URL:', url) }
  }

  async function openCustomerPreview() {
    // The AE doesn't have a magic_token; passing none means the public viewer
    // will show the "invalid token" page. For preview, we'll create a temp
    // viewer for the AE's email if profile is available — or just open the URL
    // and let them paste in a token if needed.
    if (!profile?.email) { window.open(`${APP_BASE}/room/${room.share_token}`, '_blank'); return }
    try {
      const { data: existing } = await supabase.from('deal_room_viewers').select('magic_token').eq('deal_room_id', room.id).eq('email', profile.email.toLowerCase()).maybeSingle()
      let token = existing?.magic_token
      if (!existing) {
        const { data: created } = await supabase.from('deal_room_viewers').insert({
          deal_room_id: room.id, email: profile.email.toLowerCase(), name: profile.full_name || 'AE Preview', added_by: 'rep',
        }).select('magic_token').single()
        token = created?.magic_token
      }
      window.open(`${APP_BASE}/room/${room.share_token}?t=${token}`, '_blank')
    } catch (e) {
      console.error('preview failed:', e)
      window.open(`${APP_BASE}/room/${room.share_token}`, '_blank')
    }
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

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button onClick={() => nav(`/deal/${dealId}`)} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; {deal?.company_name}</button>
          <CompanyLogo
            logoUrl={null}
            customerLogoUrl={deal?.customer_logo_url}
            companyName={deal?.company_name}
            size="lg"
            editable
            dealId={deal?.id}
            currentStoragePath={deal?.customer_logo_storage_path}
            onUploaded={(url, path) => setDeal(prev => prev ? { ...prev, customer_logo_url: url, customer_logo_storage_path: path } : prev)}
          />
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, margin: 0 }}>Deal Room</h2>
            <div style={{ fontSize: 13, color: T.textSecondary }}>{deal?.company_name}</div>
          </div>
          {archived && <Badge color={T.warning}>Archived</Badge>}
          <Button onClick={openCustomerPreview} style={{ padding: '8px 16px' }}>Preview customer view →</Button>
        </div>
      </div>

      {error && (
        <div style={{ margin: '10px 24px 0', padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, border: `1px solid ${T.error}30` }}>{error}</div>
      )}

      <div style={{ padding: '16px 24px' }}>
        {/* Card 1: Share & Access */}
        <Card title="Share & Access">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
            <div>
              <label style={labelStyle}>Share URL</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input readOnly value={shareUrl} style={{ ...inputStyle, fontFamily: T.mono, fontSize: 11, flex: 1 }} />
                <Button onClick={copyShareUrl} style={{ padding: '6px 14px', fontSize: 11 }}>Copy</Button>
              </div>
              <div style={{ marginTop: 12 }}>
                <label style={labelStyle}>Access mode</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { k: 'magic_link', l: 'Magic link (default)' },
                    { k: 'open_token', l: 'Open link' },
                  ].map(m => (
                    <label key={m.k} style={{ flex: 1, padding: '6px 10px', border: `1px solid ${room.access_mode === m.k ? T.primary : T.border}`, borderRadius: 4, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: room.access_mode === m.k ? T.primary : T.text, background: room.access_mode === m.k ? T.primaryLight : T.surface, textAlign: 'center' }}>
                      <input type="radio" checked={room.access_mode === m.k} onChange={() => saveRoom({ access_mode: m.k })} style={{ display: 'none' }} />
                      {m.l}
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label style={labelStyle}>Expires</label>
              <input type="date" defaultValue={room.expires_at ? new Date(room.expires_at).toISOString().split('T')[0] : ''}
                onBlur={e => {
                  const v = e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null
                  if (v !== room.expires_at) saveRoom({ expires_at: v })
                }}
                style={inputStyle} />
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                {!room.expires_at ? 'No expiration' : (expiringInDays >= 0 ? `Active for ${expiringInDays} day${expiringInDays === 1 ? '' : 's'}` : `Expired ${Math.abs(expiringInDays)} day${Math.abs(expiringInDays) === 1 ? '' : 's'} ago — archived`)}
              </div>

              <div style={{ marginTop: 14 }}>
                <label style={{ ...labelStyle, marginBottom: 8 }}>Enabled (kill switch)</label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
                  <input type="checkbox" checked={room.enabled} onChange={e => saveRoom({ enabled: e.target.checked })} disabled={busy} />
                  {room.enabled ? <Badge color={T.success}>Active</Badge> : <Badge color={T.error}>Disabled</Badge>}
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/* Card 2: What customer will see */}
        <Card title="What the customer will see">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
            <Stat label="MSP" value={`${stages.length} stages, ${milestones.length} milestones`} />
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
          </div>
        </Card>

        {/* Card 3: MSP (calendar view + open editor link) */}
        <Card title="MSP" action={<Button onClick={() => nav(`/deal/${dealId}/msp`)} style={{ padding: '4px 10px', fontSize: 11 }}>Open full MSP editor</Button>}>
          <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>
            Calendar view shows the rolling 6-month window the customer will see. Click an event to jump to it in the MSP editor.
          </div>
          {stages.length === 0 ? (
            <EmptyState title="No MSP stages yet" message="Build your stages and milestones in the MSP editor." action={<Button primary onClick={() => nav(`/deal/${dealId}/msp`)}>Open MSP editor</Button>} />
          ) : (
            <MSPCalendar
              stages={stages}
              milestones={milestones}
              onSelectEvent={(evt) => {
                // Send the AE to the MSP editor — they edit there, not here
                nav(`/deal/${dealId}/msp`)
              }}
              onMoveStage={async (stage, newStart, newEnd) => {
                const startStr = newStart.toISOString().split('T')[0]
                const endStr = newEnd.toISOString().split('T')[0]
                await supabase.from('msp_stages').update({ start_date: startStr, end_date: endStr, due_date: endStr }).eq('id', stage.id)
                await load()
              }}
              onResizeStage={async (stage, newStart, newEnd) => {
                const startStr = newStart.toISOString().split('T')[0]
                const endStr = newEnd.toISOString().split('T')[0]
                await supabase.from('msp_stages').update({ start_date: startStr, end_date: endStr, due_date: endStr }).eq('id', stage.id)
                await load()
              }}
            />
          )}
        </Card>

        {/* Card 4: Viewers & Activity */}
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

        {/* Card 5: Inbox */}
        <Card title="Inbox">
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
      </div>
    </div>
  )
}

const thStyle = { textAlign: 'left', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }

function Stat({ label, value, note }) {
  return (
    <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${T.primary}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{value}</div>
      {note && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{note}</div>}
    </div>
  )
}
