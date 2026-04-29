// AE-side preview of the customer-facing Evaluation Room.
//
// IMPORTANT: this route uses the AE's authenticated session to read the
// room directly (RLS allows AE org access). It does NOT call the public
// dealroom-access edge function, so no `deal_room_viewers` row is created
// for the AE, no view is logged, and no first-view notification fires.
//
// All write actions (comment, request change, email AE, add teammate) are
// disabled with a banner explaining preview mode.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T } from '../lib/theme'
import { Spinner } from '../components/Shared'
import MSPEditor from '../components/MSPEditor'
import { ProposalTabContent } from './DealRoomViewer'

const RESOURCE_TYPE_META = {
  demo:       { label: 'Demo',       color: '#a855f7', cta: 'Watch demo' },
  link:       { label: 'Link',       color: T.primary, cta: 'Open link' },
  powerpoint: { label: 'PowerPoint', color: '#dc6b2f', cta: 'View slides' },
  document:   { label: 'Document',   color: T.sageGreen, cta: 'View document' },
  misc:       { label: 'Other',      color: T.textMuted, cta: 'Open' },
}

export default function DealRoomPreview() {
  const { dealId } = useParams()
  const { profile } = useAuth()
  const { org } = useOrg() || {}

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [room, setRoom] = useState(null)
  const [deal, setDeal] = useState(null)
  const [stages, setStages] = useState([])
  const [milestones, setMilestones] = useState([])
  const [resources, setResources] = useState([])
  const [pendingRequests, setPendingRequests] = useState([])
  const [commentCounts, setCommentCounts] = useState({})
  const [tab, setTab] = useState('msp')

  useEffect(() => { load() /* eslint-disable-next-line */ }, [dealId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [dealRes, roomRes] = await Promise.all([
        supabase.from('deals').select('id, company_name, customer_logo_url').eq('id', dealId).single(),
        supabase.from('deal_rooms').select('*').eq('deal_id', dealId).single(),
      ])
      if (dealRes.error) throw dealRes.error
      if (roomRes.error) throw roomRes.error
      setDeal(dealRes.data)
      setRoom(roomRes.data)

      const roomId = roomRes.data.id
      const [stagesRes, milestonesRes, resRes, reqsRes, commentsRes] = await Promise.all([
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_milestones').select('*').eq('deal_id', dealId).order('milestone_order'),
        supabase.from('deal_resources').select('id, resource_type, title, notes, url, storage_path, mime_type, file_size').eq('deal_id', dealId).order('sort_order').order('created_at'),
        supabase.from('deal_room_change_requests').select('id, target_table, target_id, requested_change, reason, status').eq('deal_room_id', roomId).eq('status', 'pending'),
        supabase.from('deal_room_comments').select('id, tab, reference_kind, reference_id').eq('deal_room_id', roomId).eq('tab', 'msp'),
      ])
      setStages(stagesRes.data || [])
      setMilestones(milestonesRes.data || [])
      setResources(resRes.data || [])
      setPendingRequests(reqsRes.data || [])
      const counts = {}
      for (const c of commentsRes.data || []) {
        if (c.reference_kind && c.reference_id) {
          const key = `${c.reference_kind}:${c.reference_id}`
          counts[key] = (counts[key] || 0) + 1
        }
      }
      setCommentCounts(counts)
    } catch (e) {
      console.error('[DealRoomPreview] load failed:', e)
      setError(e?.message || 'Failed to load room')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!deal) return
    document.title = `Preview · ${deal.company_name}`
    const head = document.head
    const previous = []
    head.querySelectorAll('link[rel~="icon"]').forEach(l => { previous.push({ node: l, parent: l.parentNode }); l.remove() })
    const link = document.createElement('link')
    link.rel = 'icon'
    let cancelled = false
    const probe = new Image()
    probe.onload = () => { if (!cancelled) { link.type = 'image/png'; link.href = '/evaluation-room.png' } }
    probe.onerror = () => { if (!cancelled) { link.type = 'image/svg+xml'; link.href = '/evaluation-room.svg' } }
    probe.src = '/evaluation-room.png'
    head.appendChild(link)
    return () => {
      cancelled = true
      link.remove()
      previous.forEach(({ node, parent }) => parent && parent.appendChild(node))
    }
  }, [deal])

  if (loading) return <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>
  if (error || !room) {
    return (
      <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: T.font }}>
        <div style={{ maxWidth: 480, padding: 32, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 10 }}>Preview unavailable</div>
          <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6 }}>{error || 'No deal room found for this deal.'}</div>
        </div>
      </div>
    )
  }

  const themeColor = (room.theme_color && /^#[0-9a-f]{3,8}$/i.test(room.theme_color)) ? room.theme_color : T.primary
  const archived = !!room.expires_at && new Date(room.expires_at).getTime() <= Date.now()
  const tabNoteByKey = { msp: room.ae_notes_msp, library: room.ae_notes_library, proposal: room.ae_notes_proposal }
  const activeNote = (tabNoteByKey[tab] && tabNoteByKey[tab].trim())
    ? tabNoteByKey[tab]
    : (room.ae_notes && room.ae_notes.trim() ? room.ae_notes : null)
  const pendingByTarget = new Map(pendingRequests.map(r => [`${r.target_table}:${r.target_id}`, r]))
  const commentCountsMap = new Map(Object.entries(commentCounts))

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font, color: T.text }}>
      {/* Preview banner */}
      <div style={{ background: T.warningLight, borderBottom: `1px solid ${T.warning}40`, padding: '8px 24px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: T.warning }}>
        You're viewing as a customer would. Interactions are disabled in preview — comments, request-change, email AE, and add-teammate buttons are inert.
      </div>

      {/* Header */}
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', alignItems: 'center', gap: 18, maxWidth: 1200, margin: '0 auto' }}>
          <div>
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name} style={{ maxWidth: 140, maxHeight: 50, objectFit: 'contain' }} />
            ) : (
              <div style={{ fontSize: 16, fontWeight: 800, color: themeColor }}>{org?.name || 'Revenue Instruments'}</div>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{deal.company_name}</div>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>Welcome — preview as {profile?.full_name || profile?.email || 'AE'}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {deal.customer_logo_url && (
              <img src={deal.customer_logo_url} alt={deal.company_name} style={{ maxWidth: 140, maxHeight: 50, objectFit: 'contain', marginLeft: 'auto' }} />
            )}
          </div>
        </div>
      </header>

      {archived && (
        <div style={{ background: T.warningLight, color: T.warning, padding: '10px 24px', textAlign: 'center', fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${T.warning}30` }}>
          This room is archived. The customer can review the content below but can no longer add comments or requests.
        </div>
      )}

      {/* Tab bar */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '0 24px' }}>
        <div style={{ display: 'flex', gap: 0, maxWidth: 1200, margin: '0 auto', alignItems: 'center' }}>
          {[
            { key: 'msp', label: 'Project Plan' },
            { key: 'library', label: 'Library' },
            { key: 'proposal', label: 'Proposal' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '14px 24px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600, color: tab === t.key ? themeColor : T.textMuted, borderBottom: tab === t.key ? `3px solid ${themeColor}` : '3px solid transparent', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
        </div>
      </div>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {activeNote && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${themeColor}`, borderRadius: 8, padding: '14px 18px', marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Notes from {profile?.full_name || 'your AE'}
            </div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{activeNote}</div>
          </div>
        )}

        {tab === 'msp' && (
          <MSPEditor
            dealId={dealId}
            mode="readonly"
            injectedData={{ stages, milestones, company_name: deal.company_name }}
            readonlyAdapter={{
              archived: true,  // forces no Request Change buttons
              themeColor,
              pendingRequestsByTarget: pendingByTarget,
              commentCountsByRef: commentCountsMap,
              onRequestChange: () => alert('Preview mode — interactions are disabled.'),
              onComment: async () => { alert('Preview mode — interactions are disabled.'); return false },
            }}
          />
        )}

        {tab === 'library' && <PreviewLibrary resources={resources} />}

        {tab === 'proposal' && (
          room.proposal_snapshot
            ? <ProposalTabContent
                data={{ snapshot: room.proposal_snapshot, snapshotted_at: room.proposal_snapshotted_at }}
                archived
                onComment={async () => { alert('Preview mode — interactions are disabled.'); return false }}
                themeColor={themeColor}
                themeColorSecondary={room.theme_color_secondary}
                themeColorTertiary={room.theme_color_tertiary}
                columnVisibility={room.proposal_column_visibility}
              />
            : <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>No proposal snapshot yet. Snapshot one from the Quotes tab to see the customer view here.</div>
        )}
      </main>

      <footer style={{ background: T.surface, borderTop: `1px solid ${T.border}`, padding: '16px 24px', marginTop: 32 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button disabled style={{ padding: '8px 14px', border: `1px dashed ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'not-allowed', fontFamily: T.font }}>+ Add a teammate (disabled in preview)</button>
          <button disabled style={{ padding: '8px 14px', border: `1px dashed ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, fontSize: 12, fontWeight: 600, cursor: 'not-allowed', fontFamily: T.font }}>Email your AE (disabled in preview)</button>
          <div style={{ flex: 1 }} />
        </div>
      </footer>
    </div>
  )
}

function PreviewLibrary({ resources }) {
  if (!resources || resources.length === 0) {
    return <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>No resources shared yet.</div>
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
      {resources.map(r => {
        const meta = RESOURCE_TYPE_META[r.resource_type] || RESOURCE_TYPE_META.misc
        return (
          <div key={r.id} style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${meta.color}`, borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <span style={{ display: 'inline-block', alignSelf: 'flex-start', padding: '3px 10px', background: meta.color + '18', color: meta.color, fontSize: 10, fontWeight: 700, borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{meta.label}</span>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{r.title}</div>
            {r.notes && <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>{r.notes}</div>}
            {r.storage_path && r.file_size && (
              <div style={{ fontSize: 10, color: T.textMuted }}>{Math.round(r.file_size / 1024)} KB · {r.mime_type || 'file'}</div>
            )}
            <div style={{ marginTop: 'auto' }}>
              {r.url && (
                <a href={r.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'inline-block', padding: '8px 18px', background: meta.color, color: '#fff', fontSize: 12, fontWeight: 700, borderRadius: 6, textDecoration: 'none' }}>
                  {meta.cta} →
                </a>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

