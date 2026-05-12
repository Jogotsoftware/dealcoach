// PathToCloseWidget — Sage canon Path to Close v4
// Visual contract: docs/mockups/lumen-path-to-close-v4.html
// Single visible methodology surface on the deal page. Every interactive element
// links out to a dedicated page in a new tab (the "Draft demo invite" inline
// action is the one exception — calls onAskLumen with a templated prompt).

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { theme as T, formatDate, daysUntil } from '../../lib/theme'

// Stage trail order
const STAGE_TRAIL = [
  { key: 'qualify', label: 'Qualify' },
  { key: 'discovery', label: 'Discovery' },
  { key: 'solution_validation', label: 'Solution Validation' },
  { key: 'confirming_value', label: 'Confirming Value' },
  { key: 'selection', label: 'Selection' },
  { key: 'closed_won', label: 'Closed Won' },
]

const NEXT_STAGE_LABEL = {
  qualify: 'Discovery',
  discovery: 'Solution Validation',
  solution_validation: 'Confirming Value',
  confirming_value: 'Selection',
  selection: 'Closed Won',
}

const DIMENSIONS = ['need_fit', 'power', 'timeline', 'budget', 'hygiene']
const DIM_LABEL = {
  need_fit: 'Need',
  power: 'Power',
  timeline: 'Timeline',
  budget: 'Budget',
  hygiene: 'Hygiene',
}

// Warm-yellow palette for the barrier hero — matches the v4 mockup
const WARN_BG_TOP = '#fff8eb'
const WARN_BG_BOTTOM = T.warningLight
const WARN_BG_HOVER_TOP = '#fbeacc'
const WARN_BORDER = '#f5cba7'
const SUCCESS_DARK = '#1e8449'
const WARNING_DARK = '#b9770e'
const NEUTRAL_LIGHT = '#f0f3f5'
const BORDER_STRONG = '#d5dbe0'
const TEXT_FAINT = '#c4ccd2'

// External-link arrow used in linked-out affordances
function ExtIcon({ size = 9, color = 'currentColor', style = {} }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.7, marginLeft: 2, ...style }} aria-hidden="true">
      <path d="M3 3h4v4M7 3L3 7" />
    </svg>
  )
}

function CheckDot() {
  return (
    <span style={{ width: 11, height: 11, borderRadius: '50%', background: T.success, color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width="6" height="6" viewBox="0 0 8 8" fill="none" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 2L3 6 1 4" />
      </svg>
    </span>
  )
}

function FutureDot() {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: TEXT_FAINT, flexShrink: 0 }} />
}

function StageSep() {
  return <span style={{ color: TEXT_FAINT, fontSize: 10 }}>{'›'}</span>
}

function GateDot({ met }) {
  return (
    <span style={{
      width: 7, height: 7, borderRadius: '50%',
      background: met ? T.success : NEUTRAL_LIGHT,
      border: met ? `1px solid ${T.success}` : `1px solid ${BORDER_STRONG}`,
      flexShrink: 0,
    }} />
  )
}

function Skeleton() {
  const cell = { padding: '14px 18px', borderRight: `1px solid ${T.border}` }
  const bar = { background: NEUTRAL_LIGHT, borderRadius: 4, height: 20, animation: 'pulse 1.4s ease-in-out infinite' }
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, ...bar, height: 18 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr' }}>
        <div style={cell}><div style={{ ...bar, width: '70%' }} /></div>
        <div style={cell}><div style={{ ...bar, width: '50%' }} /></div>
        <div style={{ padding: '14px 18px' }}><div style={{ ...bar, width: '60%' }} /></div>
      </div>
      <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.border}`, background: T.surfaceAlt, ...bar, height: 16 }} />
      <div style={{ padding: '16px 18px', background: WARN_BG_BOTTOM, ...bar, height: 64 }} />
      <div style={{ padding: '12px 18px', ...bar, height: 18 }} />
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 24, textAlign: 'center' }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted, marginBottom: 8 }}>Path to Close</div>
      <div style={{ fontSize: 13, color: T.textSecondary, lineHeight: 1.5 }}>{message}</div>
    </div>
  )
}

export default function PathToCloseWidget({ dealId, dealStage, dealCloseDate, onAskLumen }) {
  const [loading, setLoading] = useState(true)
  const [forecast, setForecast] = useState(null)
  const [topBarrier, setTopBarrier] = useState(null)
  const [openBarrierCount, setOpenBarrierCount] = useState(0)
  const [dimStats, setDimStats] = useState({}) // { need_fit: { met, total }, ... }
  const [criteriaTotal, setCriteriaTotal] = useState(0)
  const [criteriaMet, setCriteriaMet] = useState(0)
  const [barrierHover, setBarrierHover] = useState(false)
  const [goHover, setGoHover] = useState(false)

  const nextStageLabel = NEXT_STAGE_LABEL[dealStage] || null
  const stageActive = STAGE_TRAIL.findIndex((s) => s.key === dealStage)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        // Latest forecast prediction
        const fp = supabase
          .from('deal_forecast_predictions')
          .select('predicted_close_date, confidence_score, confidence_factors, biggest_lever_dimension')
          .eq('deal_id', dealId)
          .order('predicted_at', { ascending: false })
          .limit(1).maybeSingle()

        // Top open barrier + count
        const ob = supabase
          .from('deal_open_barriers_v')
          .select('state_id, criterion_key, criterion_title, dimension, state, evidence_quote, source_speaker, source_date, source_conversation_id, suggested_action, impact_score')
          .eq('deal_id', dealId)
          .order('impact_score', { ascending: false })
          .limit(10)

        // Gate criteria state aggregated by dimension (for the current stage)
        const gs = supabase
          .from('deal_gate_criteria_state')
          .select('state, criterion_id, coach_gate_criteria(dimension, required_to_advance_from)')
          .eq('deal_id', dealId)

        const [fpRes, obRes, gsRes] = await Promise.all([fp, ob, gs])
        if (cancelled) return

        setForecast(fpRes.data || null)

        const barriers = obRes.data || []
        setTopBarrier(barriers[0] || null)
        setOpenBarrierCount(Math.max(0, barriers.length - 1))

        const stats = { need_fit: { met: 0, total: 0 }, power: { met: 0, total: 0 }, timeline: { met: 0, total: 0 }, budget: { met: 0, total: 0 }, hygiene: { met: 0, total: 0 } }
        let met = 0, total = 0
        for (const row of (gsRes.data || [])) {
          const dim = row.coach_gate_criteria?.dimension
          if (!dim || !stats[dim]) continue
          // Only count rows for the deal's current stage transition
          if (row.coach_gate_criteria?.required_to_advance_from !== dealStage) continue
          if (row.state === 'not_applicable') continue
          stats[dim].total += 1
          total += 1
          if (row.state === 'met') { stats[dim].met += 1; met += 1 }
        }
        setDimStats(stats)
        setCriteriaTotal(total)
        setCriteriaMet(met)
      } catch (e) {
        console.error('PathToCloseWidget load', e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    if (dealId) load()
    return () => { cancelled = true }
  }, [dealId, dealStage])

  const days = useMemo(() => {
    const predicted = forecast?.predicted_close_date || dealCloseDate
    return predicted ? daysUntil(predicted) : null
  }, [forecast?.predicted_close_date, dealCloseDate])

  const predictedLabel = useMemo(() => {
    const d = forecast?.predicted_close_date || dealCloseDate
    return d ? formatDate(d) : '—'
  }, [forecast?.predicted_close_date, dealCloseDate])

  const confidence = forecast?.confidence_score != null ? Math.round(Number(forecast.confidence_score)) : null
  const confWarn = confidence != null && confidence < 60

  const allCriteriaMet = criteriaTotal > 0 && criteriaMet === criteriaTotal
  const gateDefined = criteriaTotal > 0

  if (loading) return <Skeleton />
  if (!forecast && !topBarrier && criteriaTotal === 0) {
    return <EmptyState message="Run a discovery call to evaluate the path to close." />
  }

  function openInNewTab(path) {
    window.open(path, '_blank', 'noopener')
  }

  function handleBarrierAction(e) {
    e.preventDefault()
    e.stopPropagation()
    const promptText = topBarrier
      ? `Draft a demo invite for the AE to forward to ${topBarrier.source_speaker || 'the champion'}, covering: ${topBarrier.criterion_title}. Suggested action: ${topBarrier.suggested_action || '(none)'}.`
      : 'Draft a next-step suggestion for this deal.'
    if (typeof onAskLumen === 'function') onAskLumen(promptText)
    else console.log('Ask Lumen:', promptText)
  }

  // STYLES (inline tokens)
  const cardStyle = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }
  const cardHead = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', borderBottom: `1px solid ${T.border}` }
  const cardTitle = { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted }
  const cardSubtitle = { fontSize: 12, color: T.textMuted, fontWeight: 500, fontStyle: 'italic' }
  const cardActionLink = { fontSize: 11, fontWeight: 600, color: T.primary, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }

  const predRow = { display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr' }
  const predCell = { padding: '14px 18px', borderRight: `1px solid ${T.border}` }
  const predCellLast = { padding: '14px 18px' }
  const labelStyle = { display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: T.textMuted, marginBottom: 5 }
  const predValue = { fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em', color: T.text, lineHeight: 1.1 }

  const stageStrip = { display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', borderTop: `1px solid ${T.border}`, background: T.surfaceAlt, flexWrap: 'wrap' }
  const stagePillDone = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: T.textSecondary }
  const stagePillCurrent = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: T.primary, padding: '2px 9px', background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, borderRadius: 999 }
  const stagePillFuture = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: T.textMuted }

  const barrierBg = barrierHover
    ? `linear-gradient(180deg, ${WARN_BG_HOVER_TOP} 0%, ${WARN_BG_BOTTOM} 100%)`
    : `linear-gradient(180deg, ${WARN_BG_TOP} 0%, ${WARN_BG_BOTTOM} 100%)`
  const barrierStyle = { position: 'relative', display: 'block', padding: '16px 18px', background: barrierBg, borderTop: `1px solid ${WARN_BORDER}`, borderBottom: `1px solid ${WARN_BORDER}`, cursor: 'pointer', textDecoration: 'none', color: T.text, transition: 'background 0.15s' }
  const barrierGoStyle = { position: 'absolute', top: 16, right: 18, width: 22, height: 22, borderRadius: 5, background: barrierHover ? T.warning : T.surface, border: `1px solid ${barrierHover ? T.warning : WARN_BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: barrierHover ? 'translateX(2px)' : 'translateX(0)', transition: 'transform 0.15s, background 0.15s' }

  const gateStrip = { padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }
  const gateMeta = { fontSize: 11, color: T.textMuted, fontWeight: 600 }
  const gateMetaCount = { color: T.text, fontWeight: 700 }
  const gateDimChip = (state) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '4px 8px', borderRadius: 5, textDecoration: 'none', color: state === 'gap' ? T.error : state === 'partial' ? T.warning : T.text, fontWeight: state === 'strong' ? 700 : 600, fontSize: 11 })

  // ALL CRITERIA MET — green success treatment in place of barrier hero
  function AllMetHero() {
    return (
      <div style={{ padding: '16px 18px', background: T.successLight, borderTop: `1px solid #b8e0c8`, borderBottom: `1px solid #b8e0c8` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 22, height: 22, borderRadius: '50%', background: T.success, color: 'white', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3L4.5 8.5 2 6" /></svg>
          </span>
          <div style={{ fontSize: 13, fontWeight: 700, color: SUCCESS_DARK }}>
            Path is clear to {nextStageLabel || 'next stage'} — all {criteriaTotal} criteria met
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={cardStyle}>
      <style>{`@keyframes pulse { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }`}</style>

      {/* HEAD */}
      <div style={cardHead}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
          <span style={cardTitle}>Path to Close</span>
          <span style={cardSubtitle}>How do we close this?</span>
        </div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <a style={cardActionLink} onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/path`) }} href={`/deal/${dealId}/path`} target="_blank" rel="noopener noreferrer">Full view<ExtIcon /></a>
          <a style={cardActionLink} onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/msp`) }} href={`/deal/${dealId}/msp`} target="_blank" rel="noopener noreferrer">MSP<ExtIcon /></a>
        </div>
      </div>

      {/* PREDICTION STRIP */}
      <div style={predRow}>
        <div style={predCell}>
          <span style={labelStyle}>Predicted close</span>
          <div style={predValue}>
            {predictedLabel}
            {days != null && <span style={{ fontSize: 12, fontWeight: 500, color: T.textMuted, marginLeft: 6 }}>in {days} days</span>}
          </div>
        </div>
        <div style={predCell}>
          <span style={labelStyle}>Confidence</span>
          <a onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/confidence`) }} href={`/deal/${dealId}/confidence`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, padding: '2px 7px', margin: '-2px -7px', borderRadius: 5, cursor: 'pointer', textDecoration: 'none' }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: confidence == null ? T.textMuted : (confWarn ? WARNING_DARK : SUCCESS_DARK), letterSpacing: '-0.01em', lineHeight: 1.1 }}>
              {confidence != null ? `${confidence}%` : '—'}
            </span>
            <span style={{ fontSize: 11, color: T.primary, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Why<ExtIcon /></span>
          </a>
        </div>
        <div style={predCellLast}>
          <span style={labelStyle}>Stage</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 13 }}>
            <span style={{ fontWeight: 700, color: T.text }}>{STAGE_TRAIL.find((s) => s.key === dealStage)?.label || dealStage}</span>
            {nextStageLabel && <>
              <span style={{ color: T.textMuted, fontSize: 11 }}>{'→'}</span>
              <span style={{ color: T.textSecondary, fontWeight: 600 }}>{nextStageLabel}</span>
            </>}
          </div>
        </div>
      </div>

      {/* STAGE TRAIL */}
      <div style={stageStrip}>
        {STAGE_TRAIL.map((s, i) => {
          const isCurrent = s.key === dealStage
          const isDone = stageActive >= 0 && i < stageActive
          return (
            <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {isCurrent ? (
                <span style={stagePillCurrent}>{s.label}</span>
              ) : isDone ? (
                <span style={stagePillDone}><CheckDot />{s.label}</span>
              ) : (
                <span style={stagePillFuture}><FutureDot />{s.label}</span>
              )}
              {i < STAGE_TRAIL.length - 1 && <StageSep />}
            </span>
          )
        })}
      </div>

      {/* BARRIER HERO or ALL-MET HERO */}
      {allCriteriaMet ? <AllMetHero /> : topBarrier ? (
        <a
          href={`/deal/${dealId}/barriers/${topBarrier.state_id}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/barriers/${topBarrier.state_id}`) }}
          onMouseEnter={() => setBarrierHover(true)}
          onMouseLeave={() => setBarrierHover(false)}
          style={barrierStyle}
        >
          <div style={barrierGoStyle} aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke={barrierHover ? 'white' : T.warning} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h4v4M7 3L3 7" /></svg>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, paddingRight: 36 }}>
            <span style={{ width: 18, height: 18, borderRadius: '50%', background: T.warning, color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 11, fontWeight: 700 }}>!</span>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: WARNING_DARK }}>Single biggest barrier</span>
            {openBarrierCount > 0 && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: T.primary, fontWeight: 600 }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openInNewTab(`/deal/${dealId}/barriers`) }}>+ {openBarrierCount} more open</span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: T.text, letterSpacing: '-0.01em', marginBottom: 6, paddingRight: 36 }}>
            {topBarrier.criterion_title}
          </div>
          {topBarrier.suggested_action && (
            <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55, marginBottom: 10, paddingRight: 36 }}>
              {topBarrier.suggested_action}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', paddingRight: 36 }}>
            <span onClick={handleBarrierAction} onMouseEnter={() => setGoHover(true)} onMouseLeave={() => setGoHover(false)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', background: goHover ? T.warning : T.surface, border: `1px solid ${WARN_BORDER}`, borderRadius: 6, fontSize: 12, fontWeight: 600, color: goHover ? 'white' : T.text, cursor: 'pointer' }}>
              Draft demo invite for Marcus to forward
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 1l4 4-4 4" /></svg>
            </span>
            {topBarrier.evidence_quote && (
              <span style={{ fontSize: 11, color: T.textSecondary, flex: 1, minWidth: 200, overflowWrap: 'anywhere' }}>
                {topBarrier.source_speaker && <span style={{ fontWeight: 600 }}>{topBarrier.source_speaker}{topBarrier.source_date ? ` · ${formatDate(topBarrier.source_date)}` : ''}: </span>}
                <span style={{ fontStyle: 'italic' }}>"{topBarrier.evidence_quote}"</span>
              </span>
            )}
          </div>
        </a>
      ) : null}

      {/* GATE STRIP */}
      <div style={gateStrip}>
        <span style={gateMeta}>
          Gate to {nextStageLabel || '—'}
          {gateDefined && <> &middot; <span style={gateMetaCount}>{criteriaMet} of {criteriaTotal}</span></>}
        </span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {DIMENSIONS.map((dim) => {
            const s = dimStats[dim] || { met: 0, total: 0 }
            const state = !gateDefined ? 'muted' : s.total === 0 ? 'muted' : s.met === s.total ? 'strong' : s.met === 0 ? 'gap' : 'partial'
            return (
              <a key={dim} href={`/deal/${dealId}/gate/${dim}`} target="_blank" rel="noopener noreferrer"
                onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/gate/${dim}`) }}
                style={{ ...gateDimChip(state), color: state === 'muted' ? T.textMuted : gateDimChip(state).color }}>
                <span>{DIM_LABEL[dim]}</span>
                <span style={{ display: 'inline-flex', gap: 3 }}>
                  {s.total > 0 ? (
                    Array.from({ length: s.total }).map((_, i) => <GateDot key={i} met={i < s.met} />)
                  ) : (
                    <span style={{ fontSize: 11, color: T.textMuted }}>{'—'}</span>
                  )}
                </span>
              </a>
            )
          })}
        </div>
        <a href={`/deal/${dealId}/gate`} target="_blank" rel="noopener noreferrer"
          onClick={(e) => { e.preventDefault(); openInNewTab(`/deal/${dealId}/gate`) }}
          style={{ fontSize: 11, color: T.primary, fontWeight: 600, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          All criteria<ExtIcon />
        </a>
      </div>

      {!gateDefined && (
        <div style={{ padding: '10px 18px', borderTop: `1px solid ${T.border}`, fontSize: 11, color: T.textMuted, background: T.surfaceAlt }}>
          Gate criteria for {STAGE_TRAIL.find((s) => s.key === dealStage)?.label || dealStage} not yet defined. Path to Close becomes fully active in Confirming Value.
        </div>
      )}
    </div>
  )
}
