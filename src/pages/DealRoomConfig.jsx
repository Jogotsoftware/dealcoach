import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatDate } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import CompanyLogo from '../components/CompanyLogo'
import MSPEditor from '../components/MSPEditor'
import VisibilityToggleIcon from '../components/VisibilityToggleIcon'
import QuoteBuilder, { ResourcesTab } from './QuoteBuilder'

// Re-export so existing callers keep working until everyone imports from the
// component module directly.
export { VisibilityToggleIcon }

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

export default function DealRoomConfig({ embedded = false, dealId: dealIdProp } = {}) {
  // When embedded inside another page (e.g. DealDetail's "Deal Room" sub-tab),
  // the parent passes dealId directly. The standalone route /deal/:dealId/room
  // still works because useParams returns the URL param.
  const params = useParams()
  const dealId = dealIdProp || params.dealId
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
  const [noteDrafts, setNoteDrafts] = useState({ msp: '', library: '', proposal: '' })
  const [noteSavedAt, setNoteSavedAt] = useState({ msp: null, library: null, proposal: null })
  const [commentFilter, setCommentFilter] = useState('unresolved')   // 'all' | 'unresolved' | 'resolved'
  const [requestFilter, setRequestFilter] = useState('pending')       // 'pending' | 'accepted' | 'rejected' | 'all'
  const [themeOpen, setThemeOpen] = useState(false)
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

  // Auto-create a blank quote the first time a deal-room has none. Guarded by a
  // ref so multiple Quotes-tab visits within one session don't double-seed if
  // the user manually deletes the only quote we just made.
  const autoQuotedRef = useRef(false)
  useEffect(() => {
    if (loading) return
    if (autoQuotedRef.current) return
    if (!org?.id) return
    if (quotes.length > 0) return
    if (tab !== 'quotes') return
    autoQuotedRef.current = true
    createQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, tab, quotes.length, org?.id])

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
      // Seed per-tab note drafts. If the per-tab columns are empty AND the
      // legacy room-wide note is set, mirror it into MSP so the AE sees
      // their existing copy on the most-visited tab while editing.
      setNoteDrafts({
        msp: roomRes.data?.ae_notes_msp ?? (roomRes.data?.ae_notes || ''),
        library: roomRes.data?.ae_notes_library ?? '',
        proposal: roomRes.data?.ae_notes_proposal ?? '',
      })
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

  // Create a new quote inline so the AE never has to leave the Deal Room.
  // Mirrors QuotesList.createQuote — first quote becomes primary automatically.
  async function createQuote() {
    if (!org?.id) { setError('No org'); return }
    setBusy(true)
    setError('')
    try {
      const today = new Date().toISOString().slice(0, 10)
      const nextNum = (quotes.length || 0) + 1
      const { data, error: insErr } = await supabase.from('quotes').insert({
        org_id: org.id,
        deal_id: dealId,
        name: `Quote ${nextNum}`,
        version: 1,
        status: 'draft',
        is_primary: quotes.length === 0,
        contract_start_date: today,
        billing_cadence: 'annual',
        free_months: 0,
        free_months_placement: 'back',
        global_discount_pct: 0,
        signing_bonus_amount: 0,
        signing_bonus_months: 0,
        created_by: profile?.id,
      }).select('id').single()
      if (insErr) throw insErr
      await load()
      setSelectedQuoteId(data.id)
    } catch (e) {
      console.error('[DealRoomConfig] createQuote failed:', e)
      setError(e?.message || 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  async function duplicateQuote(quoteId) {
    const quote = quotes.find(q => q.id === quoteId)
    if (!quote) return
    if (!confirm(`Duplicate "${quote.name}"?`)) return
    setBusy(true)
    try {
      // Re-fetch the full source row — the in-memory list only has light fields.
      const { data: src, error: srcErr } = await supabase.from('quotes').select('*').eq('id', quote.id).single()
      if (srcErr) throw srcErr

      const { data: newQuote, error: qErr } = await supabase.from('quotes').insert({
        org_id: src.org_id,
        deal_id: src.deal_id,
        name: `${src.name} (copy)`,
        version: (src.version || 1) + 1,
        is_primary: false,
        status: 'draft',
        notes: src.notes,
        contract_term_id: src.contract_term_id,
        contract_start_date: src.contract_start_date,
        free_months: src.free_months,
        free_months_placement: src.free_months_placement,
        billing_cadence: src.billing_cadence,
        global_discount_pct: src.global_discount_pct,
        signing_bonus_amount: src.signing_bonus_amount,
        signing_bonus_months: src.signing_bonus_months,
        created_by: profile?.id,
      }).select('id').single()
      if (qErr) throw qErr

      // Copy subscription lines (two-pass to re-link parent_line_id)
      const { data: srcLines } = await supabase.from('quote_lines').select('*').eq('quote_id', src.id).order('line_order')
      if (srcLines?.length) {
        const idMap = new Map()
        for (const ln of srcLines) {
          const { data: insLine } = await supabase.from('quote_lines').insert({
            quote_id: newQuote.id,
            product_id: ln.product_id,
            parent_line_id: null,
            line_order: ln.line_order,
            quantity: ln.quantity,
            unit_price: ln.unit_price,
            discount_pct: ln.discount_pct,
            extended: ln.extended,
            notes: ln.notes,
            custom_fields: ln.custom_fields || {},
            apply_global_discount: ln.apply_global_discount,
          }).select('id').single()
          if (insLine?.id) idMap.set(ln.id, insLine.id)
        }
        for (const ln of srcLines) {
          if (!ln.parent_line_id) continue
          const newId = idMap.get(ln.id)
          const newParentId = idMap.get(ln.parent_line_id)
          if (newId && newParentId) {
            await supabase.from('quote_lines').update({ parent_line_id: newParentId }).eq('id', newId)
          }
        }
      }

      // Copy implementation items
      const { data: srcImpl } = await supabase.from('quote_implementation_items').select('*').eq('quote_id', src.id)
      if (srcImpl?.length) {
        await supabase.from('quote_implementation_items').insert(srcImpl.map(i => ({
          quote_id: newQuote.id,
          source: i.source,
          implementor_name: i.implementor_name,
          name: i.name,
          description: i.description,
          total_amount: i.total_amount,
          billing_type: i.billing_type,
          tm_weeks: i.tm_weeks,
          estimated_start_date: i.estimated_start_date,
          estimated_completion_date: i.estimated_completion_date,
          sort_order: i.sort_order,
          notes: i.notes,
        })))
      }

      // Copy partner blocks + lines
      const { data: srcBlocks } = await supabase.from('quote_partner_blocks').select('*').eq('quote_id', src.id)
      if (srcBlocks?.length) {
        for (const b of srcBlocks) {
          const { data: newBlock } = await supabase.from('quote_partner_blocks').insert({
            quote_id: newQuote.id,
            partner_name: b.partner_name,
            term_years: b.term_years,
            billing_cadence: b.billing_cadence,
            partner_global_discount_pct: b.partner_global_discount_pct,
            notes: b.notes,
            sort_order: b.sort_order,
          }).select('id').single()
          if (!newBlock?.id) continue
          const { data: srcPartnerLines } = await supabase.from('quote_partner_lines').select('*').eq('block_id', b.id)
          if (srcPartnerLines?.length) {
            await supabase.from('quote_partner_lines').insert(srcPartnerLines.map(l => ({
              quote_id: newQuote.id,
              block_id: newBlock.id,
              sku: l.sku,
              name: l.name,
              description: l.description,
              quantity: l.quantity,
              unit_price: l.unit_price,
              discount_pct: l.discount_pct,
              extended: l.extended,
              sort_order: l.sort_order,
              notes: l.notes,
            })))
          }
        }
      }

      try { await supabase.rpc('compute_quote', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_quote on dup failed:', e) }
      try { await supabase.rpc('compute_partner_lines', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_partner_lines on dup failed:', e) }
      try { await supabase.rpc('recompute_quote_totals', { p_quote_id: newQuote.id }) } catch (e) { console.warn('recompute on dup failed:', e) }

      await load()
      setSelectedQuoteId(newQuote.id)
    } catch (e) {
      console.error('[DealRoomConfig] duplicate failed:', e)
      setError(e?.message || 'Duplicate failed')
    } finally {
      setBusy(false)
    }
  }

  async function deleteQuote(quoteId) {
    const quote = quotes.find(q => q.id === quoteId)
    if (!quote) return
    if (!confirm(`Delete "${quote.name}"? This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error: delErr } = await supabase.from('quotes').delete().eq('id', quote.id)
      if (delErr) throw delErr
      // If we just deleted the active one, fall back to whatever's left.
      if (selectedQuoteId === quote.id) setSelectedQuoteId('')
      await load()
    } catch (e) {
      console.error('[DealRoomConfig] delete failed:', e)
      setError(e?.message || 'Delete failed')
    } finally {
      setBusy(false)
    }
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

  async function saveTabNote(tabKey) {
    const col = `ae_notes_${tabKey}`
    const next = (noteDrafts[tabKey] || '').trim() || null
    const current = room?.[col] ?? null
    if (next === current) return
    try {
      const patch = { [col]: next }
      // Once any per-tab note is set, retire the legacy room-wide note so it
      // stops bleeding through as a fallback on tabs without their own copy.
      if (room?.ae_notes) patch.ae_notes = null
      await saveRoom(patch)
      setNoteSavedAt(prev => ({ ...prev, [tabKey]: Date.now() }))
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
      {/* ════════════ Header strip — sticky when standalone, in-flow when embedded ════════════ */}
      <div style={embedded
        ? { background: T.surface, borderBottom: `1px solid ${T.border}` }
        : { position: 'sticky', top: 0, zIndex: 20, background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        {/* Row 1: identity + preview — hidden in embedded mode (DealDetail provides this). */}
        {!embedded && (
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
        )}

        {/* Single share row — URL with inline copy + mode + expiration + enabled + Preview */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 24px', paddingRight: 72, flexWrap: 'wrap' }}>
          {archived && <Badge color={T.warning}>Archived</Badge>}

          {/* Share URL with inline copy icon */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, overflow: 'hidden' }}>
            <input readOnly value={shareUrl}
              onClick={e => e.target.select()}
              style={{ border: 'none', outline: 'none', padding: '6px 10px', fontFamily: T.mono, fontSize: 11, color: T.text, width: 220, background: 'transparent' }} />
            <button onClick={copyShareUrl} title="Copy link"
              style={{ background: 'transparent', border: 'none', borderLeft: `1px solid ${T.borderLight}`, cursor: 'pointer', padding: '6px 10px', color: T.textMuted, display: 'inline-flex', alignItems: 'center' }}
              onMouseEnter={e => e.currentTarget.style.color = T.primary}
              onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>

          {/* Mode pills */}
          <div style={{ display: 'inline-flex', border: `1px solid ${T.border}`, borderRadius: 6, overflow: 'hidden' }}>
            {[
              { k: 'open_token', l: 'Open' },
              { k: 'magic_link', l: 'Magic' },
            ].map((m, i) => (
              <button key={m.k}
                onClick={() => saveRoom({ access_mode: m.k })}
                style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, border: 'none', borderLeft: i > 0 ? `1px solid ${T.border}` : 'none', background: room.access_mode === m.k ? T.primary : T.surface, color: room.access_mode === m.k ? '#fff' : T.textMuted, cursor: 'pointer', fontFamily: T.font }}>
                {m.l}
              </button>
            ))}
          </div>

          {/* Expiration — empty input means "no expiration"; clearing it null's the column */}
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Expires</span>
            <input type="date" defaultValue={room.expires_at ? new Date(room.expires_at).toISOString().split('T')[0] : ''}
              onChange={e => {
                const v = e.target.value ? new Date(e.target.value + 'T23:59:59').toISOString() : null
                if (v !== room.expires_at) saveRoom({ expires_at: v })
              }}
              title={room.expires_at ? `Expires ${new Date(room.expires_at).toLocaleDateString()}` : 'No expiration set'}
              style={{ ...inputStyle, padding: '4px 8px', fontSize: 11, width: 132, color: room.expires_at ? T.text : T.textMuted }} />
            {room.expires_at && (
              <span style={{ fontSize: 10, color: expiringInDays < 0 ? T.error : T.textMuted, whiteSpace: 'nowrap' }}>
                {expiringInDays >= 0 ? `${expiringInDays}d left` : `${Math.abs(expiringInDays)}d ago`}
              </span>
            )}
          </div>

          {/* Enabled toggle */}
          <button onClick={() => saveRoom({ enabled: !room.enabled })} disabled={busy}
            title={room.enabled ? 'Click to disable customer access' : 'Click to enable customer access'}
            style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', border: `1px solid ${room.enabled ? T.success : T.error}40`, borderRadius: 999, background: room.enabled ? T.success + '18' : T.error + '18', color: room.enabled ? T.success : T.error, cursor: 'pointer', fontFamily: T.font }}>
            {room.enabled ? 'Enabled' : 'Disabled'}
          </button>

          <div style={{ flex: 1 }} />

          {/* Theme colors — button opens a popover with the triad picker */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setThemeOpen(o => !o)} title="Edit customer theme colors"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
              {/* Three-stripe icon hinting at the triad */}
              <span style={{ display: 'inline-flex', gap: 2 }}>
                <span style={{ width: 6, height: 14, borderRadius: 2, background: room?.theme_color || T.primary }} />
                <span style={{ width: 6, height: 14, borderRadius: 2, background: room?.theme_color_secondary || T.success }} />
                <span style={{ width: 6, height: 14, borderRadius: 2, background: room?.theme_color_tertiary || T.warning }} />
              </span>
              Theme
            </button>
            {themeOpen && (
              <>
                <div onClick={() => setThemeOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
                <div style={{ position: 'absolute', right: 0, top: '110%', zIndex: 501, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 10px 30px rgba(0,0,0,0.15)', padding: 14, width: 340 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>Customer theme colors</div>
                  <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 10 }}>
                    Three colors drive every customer-facing accent. Click any swatch for advanced color picking.
                  </div>
                  <ThemeColorTriad
                    primary={room?.theme_color || ''}
                    secondary={room?.theme_color_secondary || ''}
                    tertiary={room?.theme_color_tertiary || ''}
                    onChangePrimary={(hex) => saveRoom({ theme_color: hex || null })}
                    onChangeSecondary={(hex) => saveRoom({ theme_color_secondary: hex || null })}
                    onChangeTertiary={(hex) => saveRoom({ theme_color_tertiary: hex || null })}
                  />
                </div>
              </>
            )}
          </div>

          {/* Preview customer view — sleek icon button */}
          <button onClick={openCustomerPreview} title="Preview customer view"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, cursor: 'pointer', fontFamily: T.font, fontSize: 12, fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
            Preview
          </button>
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
            <PerTabNoteEditor
              tabKey="msp"
              value={noteDrafts.msp}
              onChange={(v) => setNoteDrafts(prev => ({ ...prev, msp: v }))}
              onBlurSave={() => saveTabNote('msp')}
              savedAt={noteSavedAt.msp}
            />
            <Card title="Project Plan" action={
              <VisibilityToggleIcon
                visible={room?.show_msp_tab !== false}
                onChange={(v) => saveRoom({ show_msp_tab: v })}
                label="the Project Plan tab"
              />
            }>
              <MSPEditor dealId={dealId} mode="embedded" />
            </Card>
          </>
        )}

        {/* ════════════ LIBRARY TAB (read-only summary) ════════════ */}
        {tab === 'library' && (
          <>
          <PerTabNoteEditor
            tabKey="library"
            value={noteDrafts.library}
            onChange={(v) => setNoteDrafts(prev => ({ ...prev, library: v }))}
            onBlurSave={() => saveTabNote('library')}
            savedAt={noteSavedAt.library}
          />
          {/* Full Library editor: + New, From library, Save to library on each card.
              The Deal Room IS where this lives — no link out to QuoteBuilder.
              The visibility toggle lives next to the "Files & Links" card title
              inside ResourcesTab via the headerExtra prop. */}
          <ResourcesTab
            deal={deal}
            onDealUpdated={() => load()}
            headerExtra={
              <VisibilityToggleIcon
                visible={room?.show_library_tab !== false}
                onChange={(v) => saveRoom({ show_library_tab: v })}
                label="the Library tab"
              />
            }
          />
          </>
        )}

        {/* ════════════ QUOTES TAB ════════════ */}
        {tab === 'quotes' && (
          <>
          <PerTabNoteEditor
            tabKey="proposal"
            value={noteDrafts.proposal}
            onChange={(v) => setNoteDrafts(prev => ({ ...prev, proposal: v }))}
            onBlurSave={() => saveTabNote('proposal')}
            savedAt={noteSavedAt.proposal}
          />

          {/* Single unified header — the active-quote selector, + New / Duplicate /
              Delete actions, snapshot push, and visibility toggle all live INSIDE
              the embedded QuoteBuilder header (no separate outer Card). */}
          {selectedQuoteId ? (
            <div style={{ margin: '0 -24px' }}>
              <QuoteBuilder
                embedded
                forcedTab="quote"
                dealId={dealId}
                quoteId={selectedQuoteId}
                headerQuotes={quotes}
                onChangeQuote={(id) => setSelectedQuoteId(id)}
                onCreateQuote={createQuote}
                onDuplicateQuote={duplicateQuote}
                onDeleteQuote={deleteQuote}
                headerBusy={busy}
                headerShareMenuItems={[{
                  label: snapshotting
                    ? 'Pushing…'
                    : `Push to customer Proposal tab${room.proposal_snapshotted_at ? ` (last pushed ${relativeTime(room.proposal_snapshotted_at)})` : ''}`,
                  onClick: refreshProposalSnapshot,
                  disabled: snapshotting,
                }]}
                headerVisibilityToggle={
                  <VisibilityToggleIcon
                    visible={room?.show_proposal_tab !== false}
                    onChange={(v) => saveRoom({ show_proposal_tab: v })}
                    label="the Proposal tab"
                  />
                }
                columnVisibility={room?.proposal_column_visibility}
                onColumnVisibilityChange={async (patch) => {
                  const next = { ...(room?.proposal_column_visibility || { columns: {} }) }
                  next.columns = { ...(next.columns || {}), ...patch }
                  await supabase.from('deal_rooms').update({ proposal_column_visibility: next }).eq('id', room.id)
                  setRoom(prev => ({ ...prev, proposal_column_visibility: next }))
                }}
              />
            </div>
          ) : (
            <Card title="Quote" action={
              <VisibilityToggleIcon
                visible={room?.show_proposal_tab !== false}
                onChange={(v) => saveRoom({ show_proposal_tab: v })}
                label="the Proposal tab"
              />
            }>
              <div style={{ padding: 28, textAlign: 'center', color: T.textMuted, fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                <div>No quotes yet — start building one for this deal.</div>
                <Button primary disabled={busy} onClick={createQuote} style={{ padding: '8px 18px', fontSize: 13 }}>
                  + New Quote
                </Button>
              </div>
            </Card>
          )}

          </>
        )}

        {/* ════════════ MODELS TAB ════════════ */}
        {/* Models inherits the quote selected on the Quotes tab — no header,
            no picker, no Save/Preview/Status row. Just ROI / Payment Schedule
            / TCO for the active quote. */}
        {tab === 'models' && (
          selectedQuoteId ? (
            <div style={{ margin: '-16px -24px 0' }}>
              <QuoteBuilder embedded forcedTab="models" hideHeader dealId={dealId} quoteId={selectedQuoteId} />
            </div>
          ) : (
            <Card title="Models">
              <div style={{ padding: 28, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>
                Build a quote first — ROI, payment schedules, and TCO are computed from quote data.
              </div>
            </Card>
          )
        )}

        {/* ════════════ INBOX TAB ════════════ */}
        {tab === 'inbox' && (
          <>
            <Card title="Inbox" action={inboxBadge > 0 ? <Badge color={T.error}>{inboxBadge} unread</Badge> : null}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                {/* Comments column */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Comments</span>
                    <FilterChips
                      value={commentFilter}
                      onChange={setCommentFilter}
                      options={[
                        { k: 'unresolved', l: `Unresolved (${unresolvedCommentCount})` },
                        { k: 'resolved',   l: `Resolved (${viewerComments.length - unresolvedCommentCount})` },
                        { k: 'all',        l: `All (${viewerComments.length})` },
                      ]}
                    />
                  </div>
                  {(() => {
                    const filtered = viewerComments.filter(c => {
                      if (commentFilter === 'unresolved') return !c.resolved
                      if (commentFilter === 'resolved')   return !!c.resolved
                      return true
                    })
                    if (filtered.length === 0) {
                      return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>
                        {commentFilter === 'unresolved' ? 'No unresolved comments' : commentFilter === 'resolved' ? 'No resolved comments yet' : 'No comments yet'}
                      </div>
                    }
                    // Group by tab in a fixed order, hide empty groups
                    const groups = [
                      { tab: 'msp',      label: 'Project Plan' },
                      { tab: 'library',  label: 'Library' },
                      { tab: 'proposal', label: 'Proposal' },
                      { tab: 'general',  label: 'General' },
                    ].map(g => ({ ...g, items: filtered.filter(c => (c.tab || 'general') === g.tab) }))
                      .filter(g => g.items.length > 0)
                    return groups.map(g => (
                      <div key={g.tab} style={{ marginBottom: 14 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6, paddingBottom: 4, borderBottom: `1px solid ${T.borderLight}` }}>
                          {g.label} ({g.items.length})
                        </div>
                        {g.items.map(c => {
                          const replies = aeReplies(c.id)
                          const draft = reply[c.id] || ''
                          return (
                            <div key={c.id} style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${c.resolved ? T.success : T.primary}` }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <strong style={{ fontSize: 12 }}>{c.author_name || c.author_email}</strong>
                                <span style={{ fontSize: 10, color: T.textMuted }}>{relativeTime(c.created_at)}</span>
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
                    ))
                  })()}
                </div>

                {/* Change requests column */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Change requests</span>
                    <FilterChips
                      value={requestFilter}
                      onChange={setRequestFilter}
                      options={[
                        { k: 'pending',  l: `Pending (${pendingRequests.length})` },
                        { k: 'accepted', l: `Accepted (${requests.filter(r => r.status === 'accepted').length})` },
                        { k: 'rejected', l: `Rejected (${requests.filter(r => r.status === 'rejected').length})` },
                        { k: 'all',      l: `All (${requests.length})` },
                      ]}
                    />
                  </div>
                  {(() => {
                    const visible = requestFilter === 'all' ? requests : requests.filter(r => r.status === requestFilter)
                    if (visible.length === 0) {
                      return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 12 }}>
                        {requestFilter === 'pending' ? 'No pending change requests' : `No ${requestFilter} change requests`}
                      </div>
                    }
                    return visible.map(r => {
                      const isPending = r.status === 'pending'
                      return (
                        <div key={r.id} style={{ marginBottom: 10, padding: 10, background: isPending ? T.warningLight : T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${isPending ? T.warning : (r.status === 'accepted' ? T.success : T.error)}` }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <strong style={{ fontSize: 12 }}>{r.requester_name || r.requester_email}</strong>
                              {!isPending && <Badge color={r.status === 'accepted' ? T.success : T.error}>{r.status}</Badge>}
                            </div>
                            <span style={{ fontSize: 10, color: T.textMuted }}>{relativeTime(r.decided_at || r.created_at)}</span>
                          </div>
                          <div style={{ fontSize: 12, color: T.text, marginBottom: 4 }}>{describeRequestedChange(r)}</div>
                          {r.reason && <div style={{ fontSize: 11, color: T.textSecondary, marginBottom: 6, fontStyle: 'italic' }}>"{r.reason}"</div>}
                          {r.decision_notes && !isPending && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', marginBottom: 6 }}>Decision note: {r.decision_notes}</div>}
                          {isPending && (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <Button primary onClick={() => acceptRequest(r)} disabled={busy} style={{ padding: '4px 10px', fontSize: 10 }}>Accept</Button>
                              <Button onClick={() => rejectRequest(r)} disabled={busy} style={{ padding: '4px 10px', fontSize: 10 }}>Reject</Button>
                            </div>
                          )}
                        </div>
                      )
                    })
                  })()}
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

// Compact filter chip strip for the Inbox columns. Each option shows its
// label and is highlighted when active.
function FilterChips({ value, onChange, options }) {
  return (
    <div style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map(o => {
        const active = value === o.k
        return (
          <button key={o.k} onClick={() => onChange(o.k)}
            style={{
              padding: '3px 9px', fontSize: 10, fontWeight: 600, fontFamily: T.font,
              border: `1px solid ${active ? T.primary : T.border}`,
              borderRadius: 999,
              background: active ? T.primaryLight : T.surface,
              color: active ? T.primary : T.textMuted,
              cursor: 'pointer',
            }}>
            {o.l}
          </button>
        )
      })}
    </div>
  )
}

// Per-tab AE note editor card. Three of these live across the MSP, Library,
// and Quotes tabs. Each writes into its own deal_rooms.ae_notes_<tab> column
// so the note appears only on the matching tab in the customer viewer.

function PerTabNoteEditor({ tabKey, value, onChange, onBlurSave, savedAt }) {
  const justSaved = savedAt && Date.now() - savedAt < 2000
  return (
    <div style={{ position: 'relative', marginBottom: 14 }}>
      <label style={{ ...labelStyle, marginBottom: 4 }}>Notes for client</label>
      <textarea
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlurSave}
        placeholder={
          tabKey === 'msp'      ? 'e.g. Here\'s our current plan — let me know if any of these dates need to shift.' :
          tabKey === 'library'  ? 'e.g. Start with the demo videos at the top, then dig into the docs as you have questions.' :
                                  'e.g. Pricing reflects the multi-year commit we discussed. Questions on Year-1 vs Year-2 — drop a comment below.'
        }
        rows={2}
        style={{ ...inputStyle, fontFamily: T.font, fontSize: 13, lineHeight: 1.5, resize: 'vertical' }}
      />
      {justSaved && (
        <span style={{ position: 'absolute', top: 0, right: 0, fontSize: 10, color: T.textMuted }}>saved</span>
      )}
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

// Three swatches stacked vertically. Each opens a popover with the same
// preset palette + hex input + a native color input that surfaces the OS
// hue/sliders picker.
const TRIAD_SLOTS = [
  { key: 'primary',   label: 'Primary',   help: 'Tab highlight, Year 1 Total band, request-change buttons, contact icons.' },
  { key: 'secondary', label: 'Secondary', help: 'Section header bars, callouts, Investment Summary header (when applicable).' },
  { key: 'tertiary',  label: 'Tertiary',  help: 'Discount text, signing bonus text, anything subtracted from totals.' },
]

function ThemeColorTriad({ primary, secondary, tertiary, onChangePrimary, onChangeSecondary, onChangeTertiary }) {
  const values = { primary, secondary, tertiary }
  const setters = { primary: onChangePrimary, secondary: onChangeSecondary, tertiary: onChangeTertiary }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {TRIAD_SLOTS.map(slot => (
        <ThemeSlotRow
          key={slot.key}
          label={slot.label}
          help={slot.help}
          value={values[slot.key]}
          onChange={setters[slot.key]}
        />
      ))}
    </div>
  )
}

function ThemeSlotRow({ label, help, value, onChange }) {
  const [open, setOpen] = useState(false)
  const current = value || ''
  const swatchColor = current || T.primary
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        title={`Edit ${label.toLowerCase()} color`}
        style={{ width: 36, height: 36, borderRadius: 6, background: swatchColor, border: `1px solid ${T.borderLight}`, cursor: 'pointer', padding: 0, flexShrink: 0 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{label} {!current && <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 500 }}>(default)</span>}</div>
        <div style={{ fontSize: 10, color: T.textMuted, lineHeight: 1.35 }}>{help}</div>
      </div>
      <code style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{current || '—'}</code>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
          <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, padding: 12, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, boxShadow: '0 10px 40px rgba(0,0,0,0.18)', zIndex: 501, width: 280 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 8 }}>
              {THEME_COLOR_PRESETS.map(c => {
                const selected = current.toLowerCase() === c.toLowerCase()
                return (
                  <button key={c} onClick={() => { onChange(c); setOpen(false) }}
                    title={c}
                    style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: 4, background: c, cursor: 'pointer',
                      border: selected ? `2px solid ${T.text}` : `1px solid ${T.borderLight}`, padding: 0 }} />
                )
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input
                  type="color"
                  value={current || '#5DADE2'}
                  onChange={e => onChange(e.target.value)}
                  style={{ width: 38, height: 32, padding: 0, border: `1px solid ${T.borderLight}`, borderRadius: 4, cursor: 'pointer', background: T.surface }}
                  title="Open the system color wheel and sliders"
                />
                <span style={{ fontSize: 11, color: T.textSecondary }}>Wheel & sliders</span>
              </label>
              <input
                type="text"
                value={current}
                onChange={e => onChange(e.target.value)}
                placeholder="#5DADE2"
                style={{ ...inputStyle, width: 96, padding: '5px 8px', fontSize: 11, fontFamily: T.mono }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <button
                onClick={() => { onChange(''); setOpen(false) }}
                style={{ padding: '5px 10px', fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}
              >
                Reset to default
              </button>
              <button
                onClick={() => setOpen(false)}
                style={{ padding: '5px 12px', fontSize: 10, fontWeight: 600, border: 'none', borderRadius: 4, background: T.primary, color: '#fff', cursor: 'pointer', fontFamily: T.font }}
              >
                Done
              </button>
            </div>
          </div>
        </>
      )}
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
