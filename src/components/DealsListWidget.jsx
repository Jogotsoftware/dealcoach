import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, STAGES } from '../lib/theme'
import { Button, SkeletonCards } from './Shared'
import DisqualifyDealModal from './DisqualifyDealModal'

// Shared list-of-deal-cards widget. Rendered in two filtered instances on the
// AE pipeline dashboard:
//   <DealsListWidget stageFilter={['qualify']} title="QDC" sortBy="created_asc" />
//   <DealsListWidget stageFilter={['discovery','solution_validation','confirming_value','selection']}
//                    title="Pipeline" sortBy="target_close_date_asc" />
//
// Filters to the current user's deals (rep_id = profile.id). The widget owns
// its own fetch + state so it can live independently in the grid; the page
// already loads `deals` for other widgets but with a wider filter and join
// shape we don't want to depend on here.

const PAGE_SIZE = 50

const STAGE_LABEL = Object.fromEntries(STAGES.map(s => [s.key, s.label]))

function relativeTime(dateStr) {
  if (!dateStr) return ''
  const ms = Date.now() - new Date(dateStr).getTime()
  if (ms < 0) return 'just now'
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) {
    const hrs = Math.max(1, Math.floor(ms / 3_600_000))
    return `${hrs}h ago`
  }
  if (days < 14) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 8) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}

function shortDate(dateStr) {
  if (!dateStr) return null
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Pick the contact most likely to be "primary": champion > economic buyer
// > signer > earliest-created. Mirrors how DealDetail surfaces stakeholders.
function pickPrimaryContact(contacts) {
  if (!contacts?.length) return null
  return (
    contacts.find(c => c.is_champion) ||
    contacts.find(c => c.is_economic_buyer) ||
    contacts.find(c => c.is_signer) ||
    contacts[0]
  )
}

// Returns the next stage key in the canonical pipeline, or null if there
// isn't one (Selection has no forward step here — closing the deal is a
// separate explicit action on the deal page).
function nextStageOf(stage) {
  const idx = STAGES.findIndex(s => s.key === stage)
  if (idx < 0) return null
  const next = STAGES[idx + 1]
  return next ? next.key : null
}

export default function DealsListWidget({ stageFilter = [], title = 'Deals', sortBy = 'created_asc' }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [deals, setDeals] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAll, setShowAll] = useState(false)
  const [advancingId, setAdvancingId] = useState(null)
  const [disqualifyDeal, setDisqualifyDeal] = useState(null)
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)

  function flashToast(msg, isError = false) {
    setToast({ msg, isError })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2800)
  }

  // Stable key for the filter so we don't refetch on every render.
  const filterKey = useMemo(() => [...stageFilter].sort().join(','), [stageFilter])

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!profile?.id) return
      setLoading(true)
      setError(null)
      try {
        // Pull deals + contacts (for primary contact name) + QDC conversations
        // (for the most-recent QDC call date — display only). We always
        // exclude the closed/disqualified stages defensively even though the
        // caller's stageFilter shouldn't include them.
        const stages = stageFilter.filter(s => !['disqualified', 'closed_won', 'closed_lost'].includes(s))
        if (stages.length === 0) {
          if (!cancelled) { setDeals([]); setLoading(false) }
          return
        }
        const { data, error: e } = await supabase
          .from('deals')
          .select(`
            id, company_name, stage, created_at, target_close_date, bdr_lead_id, org_id,
            contacts(id, name, is_champion, is_economic_buyer, is_signer, created_at),
            conversations(call_type, call_date, created_at)
          `)
          .eq('rep_id', profile.id)
          .in('stage', stages)
        if (e) throw e

        const rows = (data || []).map(d => {
          // Newest QDC call (display only — NOT used for sort in v1).
          const qdcCalls = (d.conversations || []).filter(c => c.call_type === 'qdc')
          qdcCalls.sort((a, b) => new Date(b.call_date || b.created_at || 0) - new Date(a.call_date || a.created_at || 0))
          const lastQdc = qdcCalls[0]
          const primaryContact = pickPrimaryContact(d.contacts || [])
          return {
            id: d.id,
            company_name: d.company_name,
            stage: d.stage,
            created_at: d.created_at,
            target_close_date: d.target_close_date,
            bdr_lead_id: d.bdr_lead_id,
            org_id: d.org_id,
            primary_contact_name: primaryContact?.name || null,
            last_qdc_at: lastQdc?.call_date || lastQdc?.created_at || null,
            // TODO(BDR/intake overhaul): replace with the per-deal QDC quality
            // score once the BDR submission flow writes one. Until then this
            // stays null and the badge renders as "—".
            qdc_quality_score: null,
          }
        })

        rows.sort((a, b) => {
          if (sortBy === 'target_close_date_asc') {
            // Deals without a target close date drop to the bottom so the
            // user's eye lands on dated ones first.
            const av = a.target_close_date || '9999-12-31'
            const bv = b.target_close_date || '9999-12-31'
            return av.localeCompare(bv)
          }
          // 'created_asc' — oldest first so the stalest QDC-stage deals surface.
          // TODO(BDR/intake overhaul): once a `scheduled_qdc_at` field exists
          // on deals, switch the QDC widget's sort to "closest upcoming QDC
          // first" (ascending scheduled_qdc_at, deals with no scheduled
          // QDC last).
          return new Date(a.created_at || 0) - new Date(b.created_at || 0)
        })

        if (!cancelled) setDeals(rows)
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile?.id, filterKey, sortBy])

  async function handleAdvance(deal) {
    const next = nextStageOf(deal.stage)
    if (!next) return
    const { error: e } = await supabase.from('deals').update({
      stage: next,
      stage_changed_at: new Date().toISOString(),
    }).eq('id', deal.id)
    setAdvancingId(null)
    if (e) {
      flashToast('Advance failed: ' + e.message, true)
      return
    }
    setDeals(prev => prev.filter(d => d.id !== deal.id))
    flashToast(`Moved to ${STAGE_LABEL[next] || next}`)
  }

  function handleDqClick(deal) {
    setDisqualifyDeal(deal)
  }

  function handleDqDone(dealId) {
    setDeals(prev => prev.filter(d => d.id !== dealId))
    setDisqualifyDeal(null)
    flashToast('Disqualified')
  }

  if (loading) {
    return <div style={{ padding: '4px 2px' }}><SkeletonCards count={3} /></div>
  }
  if (error) {
    return <div style={{ padding: 12, fontSize: 12, color: T.error }}>Couldn't load deals: {error}</div>
  }
  if (deals.length === 0) {
    const isQdc = filterKey === 'qualify'
    return (
      <div style={{ padding: '28px 12px', textAlign: 'center', color: T.textMuted, fontSize: 12, lineHeight: 1.55 }}>
        {isQdc
          ? 'No deals waiting on QDC. New deals show up here when created.'
          : 'No active pipeline. Move deals out of QDC to see them here.'}
      </div>
    )
  }

  const visible = showAll ? deals : deals.slice(0, PAGE_SIZE)
  const hidden = deals.length - visible.length

  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.map(deal => (
          <DealCard
            key={deal.id}
            deal={deal}
            onOpen={() => navigate(`/deal/${deal.id}`)}
            onAdvanceClick={() => setAdvancingId(deal.id)}
            advancing={advancingId === deal.id}
            onAdvanceConfirm={() => handleAdvance(deal)}
            onAdvanceCancel={() => setAdvancingId(null)}
            onDqClick={() => handleDqClick(deal)}
          />
        ))}
      </div>

      {hidden > 0 && (
        <div style={{ paddingTop: 10, textAlign: 'center' }}>
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 12, fontWeight: 600, color: T.primary, fontFamily: T.font, padding: '4px 8px',
            }}>
            Show {hidden} more
          </button>
        </div>
      )}

      {disqualifyDeal && (
        <DisqualifyDealModal
          deal={disqualifyDeal}
          onClose={() => setDisqualifyDeal(null)}
          onDone={() => handleDqDone(disqualifyDeal.id)}
        />
      )}

      {toast && (
        <div style={{
          position: 'absolute', bottom: 8, right: 8, zIndex: 20,
          background: toast.isError ? T.error : T.text, color: '#fff',
          fontSize: 11, fontWeight: 600, padding: '6px 12px',
          borderRadius: 6, fontFamily: T.font, boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
        }}>{toast.msg}</div>
      )}
    </div>
  )
}

function DealCard({ deal, onOpen, onAdvanceClick, advancing, onAdvanceConfirm, onAdvanceCancel, onDqClick }) {
  const [hover, setHover] = useState(false)
  const next = nextStageOf(deal.stage)
  const qdcDateLabel = deal.last_qdc_at ? shortDate(deal.last_qdc_at) : '—'

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        background: T.surface,
        border: `1px solid ${hover ? T.primaryBorder || T.border : T.borderLight}`,
        borderRadius: 8,
        padding: '10px 12px',
        cursor: 'pointer',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hover ? '0 1px 4px rgba(0,0,0,0.06)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}>
      {/* Top row: name + score badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {deal.company_name || 'Untitled deal'}
          </div>
          {deal.primary_contact_name && (
            <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {deal.primary_contact_name}
            </div>
          )}
        </div>
        {/* QDC quality score badge — reserved for BDR/intake overhaul. */}
        <span title="QDC quality score (coming with BDR/intake overhaul)"
          style={{
            flexShrink: 0, fontSize: 10, fontWeight: 700,
            padding: '2px 7px', borderRadius: 10,
            background: T.surfaceAlt, color: T.textMuted,
            border: `1px solid ${T.borderLight}`,
            fontFeatureSettings: '"tnum"',
          }}>
          {deal.qdc_quality_score != null ? deal.qdc_quality_score : '—'}
        </span>
      </div>

      {/* Meta row: created + QDC date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: T.textMuted, flexWrap: 'wrap' }}>
        <span>{relativeTime(deal.created_at)}</span>
        <span style={{ color: T.borderLight }}>·</span>
        <span>QDC: {qdcDateLabel}</span>
      </div>

      {/* Action row */}
      <div
        onClick={e => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
        {advancing ? (
          <>
            <span style={{ fontSize: 11, color: T.textSecondary, marginRight: 4 }}>
              Move to <strong style={{ color: T.text }}>{STAGE_LABEL[next] || next || '—'}</strong>?
            </span>
            <Button primary onClick={onAdvanceConfirm} style={{ padding: '3px 10px', fontSize: 11 }}>Confirm</Button>
            <Button onClick={onAdvanceCancel} style={{ padding: '3px 10px', fontSize: 11 }}>Cancel</Button>
          </>
        ) : (
          <>
            <Button
              onClick={onAdvanceClick}
              disabled={!next}
              title={next ? `Move to ${STAGE_LABEL[next]}` : 'No next stage'}
              style={{ padding: '3px 10px', fontSize: 11 }}>
              Advance
            </Button>
            <Button
              danger
              onClick={onDqClick}
              style={{ padding: '3px 10px', fontSize: 11 }}>
              DQ
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
