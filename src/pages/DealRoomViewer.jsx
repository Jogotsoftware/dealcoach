import { useEffect, useMemo, useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { theme as T, formatDate } from '../lib/theme'
import { Spinner } from '../components/Shared'
import MSPCalendar from '../components/MSPCalendar'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

const RESOURCE_TYPE_META = {
  demo:       { label: 'Demo',       color: '#a855f7', cta: 'Watch demo' },
  link:       { label: 'Link',       color: T.primary, cta: 'Open link' },
  powerpoint: { label: 'PowerPoint', color: '#dc6b2f', cta: 'View slides' },
  document:   { label: 'Document',   color: T.sageGreen, cta: 'View document' },
  misc:       { label: 'Other',      color: T.textMuted, cta: 'Open' },
}

const STATUS_COLORS = { pending: T.textMuted, in_progress: T.primary, completed: T.success, blocked: T.error, at_risk: T.warning }
const STAGE_FIELDS = [
  { key: 'date_label', label: 'Date label', kind: 'text' },
  { key: 'due_date',   label: 'Due date',   kind: 'date' },
  { key: 'start_date', label: 'Start date', kind: 'date' },
  { key: 'end_date',   label: 'End date',   kind: 'date' },
  { key: 'duration',   label: 'Duration',   kind: 'text' },
  { key: 'stage_name', label: 'Title',      kind: 'text' },
  { key: 'status',     label: 'Status',     kind: 'status' },
  { key: 'notes',      label: 'Notes',      kind: 'textarea' },
]
const MILESTONE_FIELDS = [
  { key: 'date_label',     label: 'Date label', kind: 'text' },
  { key: 'due_date',       label: 'Due date',   kind: 'date' },
  { key: 'milestone_name', label: 'Title',      kind: 'text' },
  { key: 'status',         label: 'Status',     kind: 'status' },
  { key: 'notes',          label: 'Notes',      kind: 'textarea' },
]

function displayDate(item) {
  if (item?.date_label && String(item.date_label).trim()) return item.date_label
  if (item?.due_date) return formatDate(item.due_date)
  if (item?.start_date) return formatDate(item.start_date)
  return 'TBD'
}
function displayColor(item, parent) {
  return item?.color || parent?.color || T.primary
}

async function callDealRoom(action, magicToken, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/dealroom-access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
    body: JSON.stringify({ action, magic_token: magicToken, ...body }),
  })
  return res.json()
}

export default function DealRoomViewer() {
  const { shareToken } = useParams()
  const location = useLocation()
  const magicToken = useMemo(() => new URLSearchParams(location.search).get('t') || '', [location.search])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState(null)  // validate-token response
  const [tab, setTab] = useState('msp')

  const [msp, setMsp] = useState(null)
  const [library, setLibrary] = useState(null)
  const [proposal, setProposal] = useState(null)

  const [view, setView] = useState('timeline')

  // Modals
  const [changeModal, setChangeModal] = useState(null)  // { kind: 'stage'|'milestone', item, parent }
  const [emailModal, setEmailModal] = useState(false)
  const [teammateModal, setTeammateModal] = useState(false)

  useEffect(() => { validate() }, [shareToken, magicToken])

  useEffect(() => {
    if (!meta) return
    const company = meta.deal?.company_name
    document.title = company ? `Evaluation Room · ${company}` : 'Evaluation Room'
    const logoUrl = meta.org?.logo_url
    if (!logoUrl) return
    const head = document.head
    const previous = []
    head.querySelectorAll('link[rel~="icon"]').forEach(l => { previous.push({ node: l, parent: l.parentNode }); l.remove() })
    const link = document.createElement('link')
    link.rel = 'icon'
    link.href = logoUrl
    head.appendChild(link)
    return () => {
      link.remove()
      previous.forEach(({ node, parent }) => parent && parent.appendChild(node))
    }
  }, [meta])

  async function validate() {
    setLoading(true)
    setError('')
    try {
      if (!magicToken) {
        setError('This room link requires a personal access token. Ask your AE to send a magic link.')
        return
      }
      const res = await callDealRoom('validate-token', magicToken)
      if (!res.ok) {
        setError(res.error || 'This link is not active or has expired. Contact your AE.')
        return
      }
      setMeta(res)
      // Pre-load default tab
      await loadTab('msp', res)
    } catch (e) {
      console.error('validate failed:', e)
      setError(e?.message || 'Failed to load room')
    } finally { setLoading(false) }
  }

  async function loadTab(t, m = meta) {
    if (!m) return
    try {
      callDealRoom('log-view', magicToken, { tab: t }).catch(() => {})
      if (t === 'msp' && !msp) {
        const r = await callDealRoom('get-msp-tab', magicToken)
        if (r.ok) setMsp(r)
      } else if (t === 'library' && !library) {
        const r = await callDealRoom('get-library-tab', magicToken)
        if (r.ok) setLibrary(r)
      } else if (t === 'proposal' && !proposal) {
        const r = await callDealRoom('get-proposal-tab', magicToken)
        if (r.ok) setProposal(r)
      }
    } catch (e) { console.error('loadTab failed:', e) }
  }

  function selectTab(t) {
    setTab(t)
    loadTab(t)
  }

  async function refreshMsp() {
    setMsp(null)
    const r = await callDealRoom('get-msp-tab', magicToken)
    if (r.ok) setMsp(r)
  }

  async function submitComment(tabKey, body, opts = {}) {
    const res = await callDealRoom('add-comment', magicToken, { tab: tabKey, body, ...opts })
    if (!res.ok) { alert(res.error || 'Comment failed'); return false }
    if (tabKey === 'msp') await refreshMsp()
    return true
  }

  async function submitChangeRequest(target_table, target_id, field, current, proposed, reason) {
    const res = await callDealRoom('request-change', magicToken, {
      target_table, target_id, requested_change: { field, current, proposed }, reason: reason || null,
    })
    if (!res.ok) { alert(res.error || 'Submit failed'); return false }
    await refreshMsp()
    return true
  }

  async function emailAe(subject, body) {
    const res = await callDealRoom('email-ae', magicToken, { subject, body })
    if (!res.ok) { alert(res.error || 'Send failed'); return false }
    return true
  }

  async function addTeammate(email, name) {
    const res = await callDealRoom('add-viewer', magicToken, { email, name: name || null })
    if (!res.ok) { alert(res.error || 'Invite failed'); return null }
    return res.magic_link
  }

  if (loading) return <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Spinner /></div>

  if (error || !meta) {
    return (
      <div style={{ background: T.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, fontFamily: T.font }}>
        <div style={{ maxWidth: 480, padding: 32, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 10 }}>Link not active</div>
          <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.6 }}>{error || 'This link is not active or has expired. Contact your AE for a fresh one.'}</div>
        </div>
      </div>
    )
  }

  const { viewer, deal, org, rep, ae_notes, archived } = meta

  return (
    <div style={{ background: T.bg, minHeight: '100vh', fontFamily: T.font, color: T.text }}>
      {/* Header */}
      <header style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: '14px 24px', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', alignItems: 'center', gap: 18, maxWidth: 1200, margin: '0 auto' }}>
          <div>
            {org?.logo_url ? (
              <img src={org.logo_url} alt={org.name} style={{ maxWidth: 140, maxHeight: 50, objectFit: 'contain' }} />
            ) : (
              <div style={{ fontSize: 16, fontWeight: 800, color: T.primary }}>{org?.name || 'Revenue Instruments'}</div>
            )}
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{deal?.company_name}</div>
            <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>Welcome, {viewer.name || viewer.email}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {deal?.customer_logo_url && (
              <img src={deal.customer_logo_url} alt={deal.company_name} style={{ maxWidth: 140, maxHeight: 50, objectFit: 'contain', marginLeft: 'auto' }} />
            )}
          </div>
        </div>
      </header>

      {archived && (
        <div style={{ background: T.warningLight, color: T.warning, padding: '10px 24px', textAlign: 'center', fontSize: 13, fontWeight: 600, borderBottom: `1px solid ${T.warning}30` }}>
          This room is archived. You can review the content below but can no longer add comments or requests.
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
            <button key={t.key} onClick={() => selectTab(t.key)}
              style={{ padding: '14px 24px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600, color: tab === t.key ? T.primary : T.textMuted, borderBottom: tab === t.key ? `3px solid ${T.primary}` : '3px solid transparent', marginBottom: -1 }}>
              {t.label}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <RepContactIcons rep={rep} />
        </div>
      </div>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
        {ae_notes && ae_notes.trim() && (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${T.primary}`, borderRadius: 8, padding: '14px 18px', marginBottom: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
              Notes from {rep?.full_name || 'your AE'}
            </div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{ae_notes}</div>
          </div>
        )}
        {tab === 'msp' && (
          <MspTabContent
            data={msp}
            archived={archived}
            view={view}
            onView={setView}
            onComment={submitComment}
            onRequestChange={(payload) => setChangeModal(payload)}
          />
        )}

        {tab === 'library' && (
          <LibraryTabContent data={library} />
        )}

        {tab === 'proposal' && (
          <ProposalTabContent data={proposal} archived={archived} onComment={submitComment} />
        )}
      </main>

      {/* Footer */}
      <footer style={{ background: T.surface, borderTop: `1px solid ${T.border}`, padding: '16px 24px', marginTop: 32 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {!archived && (
            <>
              <button onClick={() => setTeammateModal(true)} style={{ padding: '8px 14px', border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>+ Add a teammate</button>
              <button onClick={() => setEmailModal(true)} style={{ padding: '8px 14px', border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Email your AE</button>
            </>
          )}
          <div style={{ flex: 1 }} />
        </div>
      </footer>

      {changeModal && (
        <ChangeRequestModal
          payload={changeModal}
          onClose={() => setChangeModal(null)}
          onSubmit={async (field, current, proposed, reason) => {
            const ok = await submitChangeRequest(changeModal.targetTable, changeModal.item.id, field, current, proposed, reason)
            if (ok) setChangeModal(null)
          }}
        />
      )}

      {emailModal && (
        <EmailAeModal onClose={() => setEmailModal(false)}
          onSubmit={async (s, b) => { const ok = await emailAe(s, b); if (ok) { setEmailModal(false); alert('Message sent.') } }} />
      )}

      {teammateModal && (
        <TeammateModal onClose={() => setTeammateModal(false)}
          onSubmit={async (e, n) => { const link = await addTeammate(e, n); if (link) { setTeammateModal(false); navigator.clipboard?.writeText(link).catch(() => {}); alert(`Send this to ${e}:\n\n${link}\n\n(copied to clipboard)`) } }} />
      )}
    </div>
  )
}

// ════════════════════════════════════════════
// MSP tab
// ════════════════════════════════════════════
function MspTabContent({ data, archived, view, onView, onComment, onRequestChange }) {
  if (!data) return <Spinner />
  const { stages = [], milestones = [], pending_requests = [], comment_counts = {} } = data
  const pendingByTarget = useMemo(() => {
    const m = new Map()
    for (const r of pending_requests) m.set(`${r.target_table}:${r.target_id}`, r)
    return m
  }, [pending_requests])

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[{ k: 'timeline', l: 'Timeline' }, { k: 'calendar', l: 'Calendar' }].map(v => (
          <button key={v.k} onClick={() => onView(v.k)}
            style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${view === v.k ? T.primary : T.border}`, borderRadius: 4, background: view === v.k ? T.primary : T.surface, color: view === v.k ? '#fff' : T.text, cursor: 'pointer', fontFamily: T.font }}>
            {v.l}
          </button>
        ))}
      </div>

      {view === 'calendar' && (
        <MSPCalendar
          stages={stages}
          milestones={milestones}
          readOnly
          onSelectEvent={(evt) => {
            const r = evt.resource || {}
            if (r.kind === 'stage') onRequestChange({ kind: 'stage', item: r.stage, parent: null, targetTable: 'msp_stages' })
            else if (r.kind === 'milestone') onRequestChange({ kind: 'milestone', item: r.milestone, parent: r.parentStage, targetTable: 'msp_milestones' })
          }}
        />
      )}

      {view === 'timeline' && stages.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          No stages yet — your AE is preparing this section.
        </div>
      )}

      {view === 'timeline' && stages.map(stage => {
        const stageReq = pendingByTarget.get(`msp_stages:${stage.id}`)
        const stageMs = milestones.filter(m => m.msp_stage_id === stage.id)
        const color = displayColor(stage)
        const dateText = displayDate(stage)
        return (
          <div key={stage.id} style={{ marginBottom: 14, background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${color}`, borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{stage.stage_name}</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4, fontSize: 12, color: T.textSecondary, flexWrap: 'wrap' }}>
                  <span><strong>Date:</strong> {dateText}</span>
                  {stage.duration && <span><strong>Duration:</strong> {stage.duration}</span>}
                  <StatusPill status={stage.status} />
                </div>
                {stage.notes && <div style={{ marginTop: 8, fontSize: 12, color: T.textSecondary, whiteSpace: 'pre-wrap' }}>{stage.notes}</div>}
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {stageReq ? (
                  <span style={{ padding: '4px 10px', background: T.warningLight, color: T.warning, fontSize: 10, fontWeight: 600, borderRadius: 999, border: `1px solid ${T.warning}30` }}>Change requested · pending review</span>
                ) : !archived && (
                  <button onClick={() => onRequestChange({ kind: 'stage', item: stage, parent: null, targetTable: 'msp_stages' })}
                    style={{ padding: '4px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
                    Request change
                  </button>
                )}
              </div>
            </div>

            {stageMs.length > 0 && (
              <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px dashed ${T.borderLight}` }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Milestones</div>
                {stageMs.map(m => {
                  const mReq = pendingByTarget.get(`msp_milestones:${m.id}`)
                  const mColor = displayColor(m, stage)
                  return (
                    <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', marginBottom: 4, background: T.surfaceAlt, borderRadius: 4, borderLeft: `3px solid ${mColor}`, flexWrap: 'wrap' }}>
                      <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.milestone_name}</div>
                        <div style={{ display: 'flex', gap: 10, fontSize: 11, color: T.textSecondary, marginTop: 2 }}>
                          <span>{displayDate(m)}</span>
                          <StatusPill status={m.status} />
                        </div>
                      </div>
                      {mReq ? (
                        <span style={{ padding: '2px 8px', background: T.warningLight, color: T.warning, fontSize: 10, fontWeight: 600, borderRadius: 999, border: `1px solid ${T.warning}30` }}>Change requested</span>
                      ) : !archived && (
                        <button onClick={() => onRequestChange({ kind: 'milestone', item: m, parent: stage, targetTable: 'msp_milestones' })}
                          style={{ padding: '3px 8px', fontSize: 10, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>
                          Request change
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {/* Per-item comment composer */}
            {!archived && (
              <CommentComposer
                onSubmit={(text) => onComment('msp', text, { reference_kind: 'msp_stage', reference_id: stage.id })}
                placeholder="Comment on this stage…"
                count={comment_counts[`msp_stage:${stage.id}`] || 0}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StatusPill({ status }) {
  const c = STATUS_COLORS[status] || T.textMuted
  return (
    <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, color: c, background: c + '18', border: `1px solid ${c}30`, textTransform: 'uppercase' }}>
      {(status || '').replace('_', ' ')}
    </span>
  )
}

function CommentComposer({ onSubmit, placeholder, count }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  return (
    <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${T.borderLight}` }}>
      {!open ? (
        <button onClick={() => setOpen(true)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 11, padding: 0, fontFamily: T.font }}>
          {count > 0 ? `${count} comment${count === 1 ? '' : 's'} · ` : ''}+ Add a comment
        </button>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <textarea value={text} onChange={e => setText(e.target.value)} placeholder={placeholder} rows={2}
            style={{ flex: 1, padding: 8, fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, resize: 'vertical' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <button onClick={async () => { if (text.trim()) { const ok = await onSubmit(text.trim()); if (ok) { setText(''); setOpen(false) } } }}
              style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: T.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Post</button>
            <button onClick={() => { setOpen(false); setText('') }}
              style={{ padding: '6px 10px', fontSize: 11, fontWeight: 600, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════
// Library tab — NO URLS visible to customer
// ════════════════════════════════════════════
function LibraryTabContent({ data }) {
  if (!data) return <Spinner />
  const { resources = [] } = data
  if (resources.length === 0) {
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
              <div style={{ fontSize: 10, color: T.textMuted }}>
                {Math.round(r.file_size / 1024)} KB · {r.mime_type || 'file'}
              </div>
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

// ════════════════════════════════════════════
// Proposal tab — render snapshot
// ════════════════════════════════════════════
function ProposalTabContent({ data, archived, onComment }) {
  if (!data) return <Spinner />
  const { snapshot, message } = data
  if (!snapshot) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
        {message || 'Your proposal is being prepared. Check back soon.'}
      </div>
    )
  }
  const sageLines = snapshot.sage_lines || []
  const sageImpl = snapshot.sage_implementation || []
  const partnerBlocks = snapshot.partner_blocks || []
  const term = snapshot.term
  const startDate = snapshot.contract_start_date
  const freeMonths = Number(snapshot.free_months) || 0
  const freeMonthsPlacement = snapshot.free_months_placement || 'back'
  const signingBonusAmountRaw = Number(snapshot.signing_bonus_amount) || 0
  const signingBonusMonths = Number(snapshot.signing_bonus_months) || 0

  const num = (n) => Number(n) || 0
  const fmtUSD = (n) => Math.round(num(n)).toLocaleString('en-US')
  const money = (n) => '$' + fmtUSD(n)
  const moneyNeg = (n) => '-$' + fmtUSD(Math.abs(num(n)))

  // Group: parents at top, children grouped underneath their parent
  const parents = sageLines.filter(l => !l.parent_line_id)
  const childrenOf = (parentId) => sageLines.filter(l => l.parent_line_id === parentId)

  // Sage subscription totals (computed from line items so the math always ties out)
  const annualListTotal = parents.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
  const annualNetTotal = parents.reduce((s, l) => s + num(l.extended), 0)
  const annualDiscountAmount = annualListTotal - annualNetTotal
  const blendedDiscountPct = annualListTotal > 0 ? (annualDiscountAmount / annualListTotal) * 100 : 0

  const implTotal = sageImpl.reduce((s, i) => s + num(i.extended || i.amount), 0)

  const monthlySubscription = annualNetTotal / 12
  const freeMonthsValue = freeMonths * monthlySubscription
  const signingBonusValue = signingBonusAmountRaw > 0 ? signingBonusAmountRaw : signingBonusMonths * monthlySubscription
  const signMonth = startDate ? new Date(startDate + 'T00:00:00').toLocaleString('en-US', { month: 'long' }) : null

  const year1Total = annualNetTotal + implTotal
    - (freeMonthsPlacement === 'front' ? freeMonthsValue : 0)
    - signingBonusValue

  const COL_WIDTHS = { qty: 56, list: 92, totalList: 100, discount: 78, totalPrice: 110 }
  const cellHead = { padding: '8px 10px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right' }
  const cellRight = { padding: '10px 10px', fontSize: 13, fontFeatureSettings: '"tnum"', textAlign: 'right', color: T.text }

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: 28, maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: T.text }}>Proposal</h1>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
            {snapshot.quote_name}{snapshot.quote_version ? ` v${snapshot.quote_version}` : ''}
            {snapshot.snapshotted_at ? ` · Captured ${new Date(snapshot.snapshotted_at).toLocaleDateString()}` : ''}
          </div>
        </div>
        {startDate && (
          <div style={{ fontSize: 11, color: T.textSecondary }}>
            Contract start: <strong style={{ color: T.text }}>{new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</strong>
          </div>
        )}
      </div>

      {/* Sage Annual Software Subscription */}
      {sageLines.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <ProposalSectionHeader>Sage Annual Software Subscription</ProposalSectionHeader>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                  <th style={{ ...cellHead, textAlign: 'left' }}>Item</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.qty }}>Qty</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.list }}>List</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.totalList }}>Total List</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.discount, background: '#fde9d9' }}>Discount</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.totalPrice, background: '#e2f0d9' }}>Total Price</th>
                </tr>
              </thead>
              <tbody>
                {parents.map(p => {
                  const kids = childrenOf(p.id)
                  const isBundle = !!p.is_bundle && kids.length > 0
                  const lineList = num(p.quantity) * num(p.unit_price)
                  return (
                    <tr key={p.id} style={{ borderBottom: `1px solid ${T.borderLight}`, verticalAlign: 'top' }}>
                      <td style={{ padding: '12px 10px', color: T.text }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name || p.sku || '—'}</div>
                        {isBundle && (
                          <div style={{ marginTop: 6, fontSize: 11.5, color: '#0f5132', lineHeight: 1.6 }}>
                            {kids.map(c => (
                              <div key={c.id}>- {c.name || c.sku}</div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td style={cellRight}>{num(p.quantity).toLocaleString()}</td>
                      <td style={{ ...cellRight, color: T.textSecondary }}>{money(p.unit_price)}</td>
                      <td style={cellRight}>{money(lineList)}</td>
                      <td style={{ ...cellRight, background: '#fdf2e9' }}>{num(p.discount_pct).toFixed(1)}%</td>
                      <td style={{ ...cellRight, background: '#eaf3e0', fontWeight: 700 }}>{money(p.extended)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ ...cellRight, fontWeight: 700 }}>Annual Subscription Total List Price</td>
                  <td style={{ ...cellRight, fontWeight: 700 }} />
                  <td style={{ ...cellRight, fontWeight: 800 }}>{money(annualListTotal)}</td>
                </tr>
                {annualDiscountAmount > 0 && (
                  <tr>
                    <td colSpan={4} style={{ ...cellRight, color: T.error, fontWeight: 700 }}>Discount Amount</td>
                    <td style={{ ...cellRight, color: T.error, fontWeight: 700 }}>{blendedDiscountPct.toFixed(0)}%</td>
                    <td style={{ ...cellRight, color: T.error, fontWeight: 800 }}>{money(annualDiscountAmount)}</td>
                  </tr>
                )}
                <tr style={{ background: '#eaf3e0' }}>
                  <td colSpan={5} style={{ ...cellRight, fontWeight: 800 }}>Net Annual Subscription Total</td>
                  <td style={{ ...cellRight, fontWeight: 900 }}>{money(annualNetTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* One Time Implementation */}
      {(sageImpl.length > 0 || implTotal > 0) && (
        <div style={{ marginTop: 28 }}>
          <ProposalSectionHeader>One Time Implementation</ProposalSectionHeader>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                  <th style={{ ...cellHead, textAlign: 'left' }}>Item</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.qty }}>Qty</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.list }}>Rate</th>
                  <th style={{ ...cellHead, width: COL_WIDTHS.totalPrice, background: '#e2f0d9' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {sageImpl.map((i, idx) => (
                  <tr key={i.id || idx} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '10px 10px', color: T.text, fontWeight: 600 }}>{i.description || i.name || 'Implementation'}</td>
                    <td style={cellRight}>{num(i.quantity || 1).toLocaleString()}</td>
                    <td style={{ ...cellRight, color: T.textSecondary }}>{i.unit_price != null ? money(i.unit_price) : '—'}</td>
                    <td style={{ ...cellRight, background: '#eaf3e0', fontWeight: 700 }}>{money(i.extended || i.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#eaf3e0' }}>
                  <td colSpan={3} style={{ ...cellRight, fontWeight: 800 }}>Implementation Total</td>
                  <td style={{ ...cellRight, fontWeight: 900 }}>{money(implTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Partners */}
      {partnerBlocks.map((pb, idx) => {
        const block = pb.block || {}
        const lines = pb.lines || []
        const impl = pb.implementation || []
        if (lines.length === 0 && impl.length === 0) return null
        const partnerSub = lines.reduce((s, l) => s + num(l.extended), 0)
        const partnerImpl = impl.reduce((s, l) => s + num(l.extended || l.amount), 0)
        return (
          <div key={block.id || idx} style={{ marginTop: 28 }}>
            <ProposalSectionHeader>Partner: {block.partner_name || 'Partner'}</ProposalSectionHeader>
            {lines.length > 0 && (
              <div style={{ overflowX: 'auto', marginBottom: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                      <th style={{ ...cellHead, textAlign: 'left' }}>Subscription</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.qty }}>Qty</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.list }}>Unit</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.totalPrice, background: '#e2f0d9' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={l.id || i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '10px 10px', color: T.text, fontWeight: 600 }}>{l.name || l.description || '—'}</td>
                        <td style={cellRight}>{num(l.quantity || 1).toLocaleString()}</td>
                        <td style={{ ...cellRight, color: T.textSecondary }}>{l.unit_price != null ? money(l.unit_price) : '—'}</td>
                        <td style={{ ...cellRight, background: '#eaf3e0', fontWeight: 700 }}>{money(l.extended)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#eaf3e0' }}>
                      <td colSpan={3} style={{ ...cellRight, fontWeight: 800 }}>Partner Subscription Total</td>
                      <td style={{ ...cellRight, fontWeight: 900 }}>{money(partnerSub)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            {impl.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `2px solid ${T.border}`, background: T.surfaceAlt }}>
                      <th style={{ ...cellHead, textAlign: 'left' }}>Implementation</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.qty }}>Qty</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.list }}>Rate</th>
                      <th style={{ ...cellHead, width: COL_WIDTHS.totalPrice, background: '#e2f0d9' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impl.map((l, i) => (
                      <tr key={l.id || i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '10px 10px', color: T.text, fontWeight: 600 }}>{l.description || l.name || 'Implementation'}</td>
                        <td style={cellRight}>{num(l.quantity || 1).toLocaleString()}</td>
                        <td style={{ ...cellRight, color: T.textSecondary }}>{(l.unit_price || l.amount) != null ? money(l.unit_price || l.amount) : '—'}</td>
                        <td style={{ ...cellRight, background: '#eaf3e0', fontWeight: 700 }}>{money(l.extended || l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#eaf3e0' }}>
                      <td colSpan={3} style={{ ...cellRight, fontWeight: 800 }}>Partner Implementation Total</td>
                      <td style={{ ...cellRight, fontWeight: 900 }}>{money(partnerImpl)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )
      })}

      {/* Promo & Incentives */}
      {(freeMonths > 0 || signingBonusValue > 0) && (
        <div style={{ marginTop: 28 }}>
          <ProposalSectionHeader>Promo & Incentives</ProposalSectionHeader>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {freeMonths > 0 && (
                <tr style={{ background: '#fdf2e9', borderBottom: `1px solid ${T.borderLight}` }}>
                  <td style={{ padding: '12px 14px', fontWeight: 700, color: T.text }}>
                    {freeMonths} Free Month{freeMonths === 1 ? '' : 's'}
                    <span style={{ marginLeft: 8, fontWeight: 500, color: T.textSecondary, fontSize: 12, textTransform: 'capitalize' }}>
                      (applied to {freeMonthsPlacement} of term)
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 800, color: T.error, width: 160 }}>
                    {moneyNeg(freeMonthsValue)}
                  </td>
                </tr>
              )}
              {signingBonusValue > 0 && (
                <tr style={{ background: '#fdf2e9' }}>
                  <td style={{ padding: '12px 14px', fontWeight: 700, color: T.text }}>
                    {signMonth ? `${signMonth} ` : ''}Signing Bonus
                  </td>
                  <td style={{ padding: '12px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 800, color: T.error, width: 160 }}>
                    {moneyNeg(signingBonusValue)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Contract Terms */}
      {term && (
        <div style={{ marginTop: 28 }}>
          <ProposalSectionHeader>Contract Terms</ProposalSectionHeader>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            {term.name && (
              <KvCard label="Term" value={term.name} />
            )}
            {term.term_years != null && (
              <KvCard label="Length" value={`${term.term_years} year${num(term.term_years) === 1 ? '' : 's'}`} />
            )}
            {term.yoy_caps && (
              <KvCard label="Year-over-Year Caps" value={Array.isArray(term.yoy_caps)
                ? term.yoy_caps.map(c => typeof c === 'number' ? `${c}%` : String(c)).join(' / ')
                : (typeof term.yoy_caps === 'object' ? JSON.stringify(term.yoy_caps) : String(term.yoy_caps))} />
            )}
            {snapshot.billing_cadence && (
              <KvCard label="Billing Cadence" value={String(snapshot.billing_cadence).replace(/_/g, ' ')} />
            )}
          </div>
          {term.description && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: T.surfaceAlt, borderRadius: 6, fontSize: 12, color: T.textSecondary, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
              {term.description}
            </div>
          )}
        </div>
      )}

      {/* Year 1 Total */}
      <div style={{ marginTop: 28, padding: '18px 22px', background: '#fff3a3', border: '2px solid #d4b500', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 18, fontWeight: 800, color: T.text, letterSpacing: '0.02em' }}>Year 1 Total</span>
        <span style={{ fontSize: 26, fontWeight: 900, color: T.text, fontFeatureSettings: '"tnum"' }}>{money(year1Total)}</span>
      </div>

      <div style={{ marginTop: 10, fontSize: 11, color: T.textMuted, textAlign: 'right' }}>
        Need a printable PDF version? Ask your AE — they can generate a document-style proposal.
      </div>

      {!archived && (
        <CommentComposer onSubmit={(text) => onComment('proposal', text)} placeholder="Comment on this proposal…" count={0} />
      )}
    </div>
  )
}

function ProposalSectionHeader({ children }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 800, color: T.text, paddingBottom: 8, marginBottom: 8, borderBottom: `2px solid ${T.text}`, letterSpacing: '0.02em' }}>
      {children}
    </div>
  )
}

function KvCard({ label, value }) {
  return (
    <div style={{ padding: '10px 12px', background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${T.primary}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{value}</div>
    </div>
  )
}

// ════════════════════════════════════════════
// Modals
// ════════════════════════════════════════════
function ChangeRequestModal({ payload, onClose, onSubmit }) {
  const fields = payload.kind === 'stage' ? STAGE_FIELDS : MILESTONE_FIELDS
  const [field, setField] = useState(fields[0].key)
  const [proposed, setProposed] = useState('')
  const [reason, setReason] = useState('')
  const fieldDef = fields.find(f => f.key === field)
  const current = payload.item?.[field] ?? ''

  return (
    <ModalShell title={`Request change · ${payload.kind}`} onClose={onClose}>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Field</label>
        <select value={field} onChange={e => { setField(e.target.value); setProposed('') }}
          style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font }}>
          {fields.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Current</label>
        <div style={{ padding: 8, background: T.surfaceAlt, fontFamily: T.mono, fontSize: 12, borderRadius: 4 }}>{current === null || current === '' ? '(empty)' : String(current)}</div>
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Proposed</label>
        {fieldDef.kind === 'date' && (
          <input type="date" value={proposed} onChange={e => setProposed(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font }} />
        )}
        {fieldDef.kind === 'text' && (
          <input value={proposed} onChange={e => setProposed(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font }} />
        )}
        {fieldDef.kind === 'textarea' && (
          <textarea value={proposed} onChange={e => setProposed(e.target.value)} rows={3} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, resize: 'vertical' }} />
        )}
        {fieldDef.kind === 'status' && (
          <select value={proposed} onChange={e => setProposed(e.target.value)} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font }}>
            <option value="">— Pick —</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
      </div>
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Reason (optional)</label>
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, resize: 'vertical' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={modalSecondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(field, current, proposed, reason)} disabled={!proposed} style={modalPrimaryBtn}>Submit</button>
      </div>
    </ModalShell>
  )
}

function EmailAeModal({ onClose, onSubmit }) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  return (
    <ModalShell title="Email your AE" onClose={onClose}>
      <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, marginBottom: 10 }} />
      <textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Message" rows={6} style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, marginBottom: 10, resize: 'vertical' }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={modalSecondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(subject, body)} disabled={!subject.trim() || !body.trim()} style={modalPrimaryBtn}>Send</button>
      </div>
    </ModalShell>
  )
}

function TeammateModal({ onClose, onSubmit }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  return (
    <ModalShell title="Add a teammate" onClose={onClose}>
      <input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@company.com" style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, marginBottom: 10 }} />
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" style={{ width: '100%', padding: '8px 10px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 4, fontFamily: T.font, marginBottom: 10 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onClose} style={modalSecondaryBtn}>Cancel</button>
        <button onClick={() => onSubmit(email, name)} disabled={!email.trim()} style={modalPrimaryBtn}>Generate magic link</button>
      </div>
    </ModalShell>
  )
}

function ModalShell({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: T.surface, borderRadius: 8, width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 12px 32px rgba(0,0,0,0.18)' }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: T.textMuted, lineHeight: 1, padding: 0 }}>×</button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  )
}

const modalPrimaryBtn = { padding: '8px 16px', fontSize: 12, fontWeight: 600, background: T.primary, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font }
const modalSecondaryBtn = { padding: '8px 16px', fontSize: 12, fontWeight: 600, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }

// ════════════════════════════════════════════
// Rep contact icons (header) — email / sms / call
// ════════════════════════════════════════════
function RepContactIcons({ rep }) {
  if (!rep || (!rep.email && !rep.phone)) return null
  const phoneDigits = rep.phone ? String(rep.phone).replace(/[^\d+]/g, '') : ''
  const items = []
  if (rep.email) {
    items.push({ key: 'email', href: `mailto:${rep.email}`, label: `Email ${rep.full_name || rep.email}`, icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 6 9-6" />
      </svg>
    )})
  }
  if (phoneDigits) {
    items.push({ key: 'sms', href: `sms:${phoneDigits}`, label: `Text ${rep.full_name || rep.phone}`, icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20l1.1-5.4A8.5 8.5 0 1 1 21 11.5z" />
      </svg>
    )})
    items.push({ key: 'call', href: `tel:${phoneDigits}`, label: `Call ${rep.full_name || rep.phone}`, icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
      </svg>
    )})
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} title={rep.full_name ? `Your AE: ${rep.full_name}` : undefined}>
      {items.map(it => (
        <a key={it.key} href={it.href} aria-label={it.label} title={it.label}
          style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.primary, textDecoration: 'none' }}>
          {it.icon}
        </a>
      ))}
    </div>
  )
}
