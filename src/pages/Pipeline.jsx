import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  theme as T, STAGES, FORECAST_CATEGORIES, TERMINAL_STAGES,
  formatCurrency, formatDate, daysUntil, pctOf, getNext3Months, getFiscalPeriods,
} from '../lib/theme'
import { Badge, ForecastBadge, ScoreBar, StatusDot, Spinner, Button } from '../components/Shared'
import TranscriptUpload from '../components/TranscriptUpload'

export default function Pipeline() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [deals, setDeals] = useState([])
  const [tasks, setTasks] = useState([])
  const [quota, setQuota] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState('deal_value')
  const [dir, setDir] = useState('desc')
  const [showTranscript, setShowTranscript] = useState(false)

  // Load data from Supabase
  useEffect(() => {
    loadData()
  }, [profile])

  async function loadData() {
    if (!profile) return
    setLoading(true)
    try {
      const [dealsRes, tasksRes, quotaRes] = await Promise.all([
        supabase.from('deals').select('*').eq('rep_id', profile.id),
        supabase.from('tasks').select('*'),
        supabase.from('rep_quotas').select('*').eq('rep_id', profile.id).limit(1),
      ])

      setDeals(dealsRes.data || [])
      setTasks(tasksRes.data || [])
      if (quotaRes.data?.[0]) setQuota(quotaRes.data[0].annual_quota || 0)
      else setQuota(profile.annual_quota || 0)
    } catch (err) {
      console.error('Error loading pipeline data:', err)
    } finally {
      setLoading(false)
    }
  }

  const active = deals.filter(d => !TERMINAL_STAGES.includes(d.stage))
  const months = getNext3Months()
  const fp = getFiscalPeriods()
  const mQ = quota / 12
  const qQ = quota / 4

  // Closed-won totals for attainment (from deals with stage = closed_won)
  const closedDeals = deals.filter(d => d.stage === 'closed_won')
  const closedInPeriod = (start, end) =>
    closedDeals.filter(d => d.updated_at >= start && d.updated_at <= end + 'T23:59:59')
      .reduce((s, d) => s + (d.deal_value || 0), 0)
  const pipeInPeriod = (start, end) =>
    active.filter(d => d.target_close_date >= start && d.target_close_date <= end)
      .reduce((s, d) => s + (d.deal_value || 0), 0)

  const closedM = closedInPeriod(fp.monthStart, fp.monthEnd)
  const closedQ = closedInPeriod(fp.quarterStart, fp.quarterEnd)
  const closedY = closedDeals.reduce((s, d) => s + (d.deal_value || 0), 0)

  const sorted = useMemo(() => {
    return [...active].sort((a, b) => {
      const d = dir === 'desc' ? -1 : 1
      if (sort === 'target_close_date') {
        return d * (a.target_close_date || '9999').localeCompare(b.target_close_date || '9999')
      }
      if (sort === 'most_active') {
        const at = tasks.filter(t => t.deal_id === a.id && !t.completed).length
        const bt = tasks.filter(t => t.deal_id === b.id && !t.completed).length
        return d * (at - bt)
      }
      return d * ((a[sort] || 0) - (b[sort] || 0))
    })
  }, [active, sort, dir, tasks])

  if (loading) return <Spinner />

  return (
    <div>
      {/* Header */}
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.surface,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Pipeline</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={sort}
            onChange={e => setSort(e.target.value)}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 5,
              padding: '6px 10px', fontSize: 12, color: T.text, fontFamily: T.font,
              cursor: 'pointer', outline: 'none', fontWeight: 500,
            }}
          >
            {[['deal_value', 'Value'], ['target_close_date', 'Close Date'], ['most_active', 'Most Active'], ['fit_score', 'Fit']].map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button
            onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')}
            style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 5,
              padding: '5px 8px', cursor: 'pointer', fontSize: 12, color: T.textSecondary, fontFamily: T.font,
            }}
          >
            {dir === 'desc' ? '\u2193' : '\u2191'}
          </button>
          <Button onClick={() => setShowTranscript(true)}>&#9654; Transcript</Button>
          <Button primary onClick={() => navigate('/deal/new')}>+ New Deal</Button>
        </div>
      </div>

      {showTranscript && (
        <TranscriptUpload
          deals={deals}
          onClose={() => setShowTranscript(false)}
          onUploaded={() => loadData()}
        />
      )}

      {/* Metrics */}
      <div style={{ padding: '16px 24px', display: 'flex', gap: 14 }}>
        {/* 3-month pipeline */}
        <div style={{ display: 'flex', gap: 12, flex: 2 }}>
          {months.map((mo, i) => {
            const md = active.filter(d => d.target_close_date >= mo.start && d.target_close_date <= mo.end)
            const total = md.reduce((s, d) => s + (d.deal_value || 0), 0)
            return (
              <div key={i} style={{
                flex: 1, background: T.surface,
                border: `1px solid ${mo.isCurrent ? T.primaryBorder : T.border}`,
                borderRadius: T.radius, padding: '14px 16px', boxShadow: T.shadow,
                borderTop: mo.isCurrent ? `3px solid ${T.primary}` : 'none',
              }}>
                <div style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                  color: mo.isCurrent ? T.primary : T.textMuted, marginBottom: 6,
                }}>
                  {mo.label}{mo.isCurrent ? ' (now)' : ''}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', marginBottom: 4 }}>
                  {formatCurrency(total)}
                </div>
                <div style={{ fontSize: 11, color: T.textSecondary }}>
                  {md.length} deal{md.length !== 1 ? 's' : ''}
                </div>
              </div>
            )
          })}
        </div>

        {/* Attainment */}
        {quota > 0 && (
          <div style={{
            flex: 1, minWidth: 220, background: T.surface,
            border: `1px solid ${T.border}`, borderRadius: T.radius, padding: '14px 18px', boxShadow: T.shadow,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: T.textMuted,
              textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
            }}>
              FY{fp.fy} Attainment
            </div>
            {[
              ['Month', closedM, mQ, pipeInPeriod(fp.monthStart, fp.monthEnd)],
              [`Q${fp.fq}`, closedQ, qQ, pipeInPeriod(fp.quarterStart, fp.quarterEnd)],
              ['Annual', closedY, quota, active.reduce((s, d) => s + (d.deal_value || 0), 0)],
            ].map(([label, closed, q, pipe]) => {
              const att = pctOf(closed, q)
              const c = att >= 100 ? T.success : att >= 70 ? T.primary : att >= 40 ? T.warning : T.error
              return (
                <div key={label} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: T.text, textTransform: 'uppercase' }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: c }}>{att}%</span>
                  </div>
                  <div style={{ height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                    <div style={{ height: '100%', width: `${Math.min(att, 100)}%`, background: c, borderRadius: 3, position: 'absolute' }} />
                    <div style={{
                      height: '100%', background: c, opacity: 0.2,
                      width: `${Math.max(Math.min(pctOf(closed + pipe, q), 100) - Math.min(att, 100), 0)}%`,
                      position: 'absolute', left: `${Math.min(att, 100)}%`, borderRadius: '0 3px 3px 0',
                    }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textSecondary, marginTop: 2 }}>
                    <span>{formatCurrency(closed)} closed</span>
                    <span>{formatCurrency(q)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'flex', gap: 14, padding: '4px 24px 24px', overflowX: 'auto', minHeight: 'calc(100vh - 300px)' }}>
        {STAGES.map(stage => {
          const stageDeals = sorted.filter(d => d.stage === stage.key)
          const stageValue = stageDeals.reduce((s, d) => s + (d.deal_value || 0), 0)

          return (
            <div key={stage.key} style={{ flex: 1, minWidth: 250, maxWidth: 320 }}>
              {/* Column header */}
              <div style={{
                padding: '10px 12px', marginBottom: 8, borderBottom: `2px solid ${stage.color}`,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {stage.label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 600, color: T.textMuted, background: T.surfaceAlt,
                    padding: '2px 7px', borderRadius: 10,
                  }}>
                    {stageDeals.length}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: T.textMuted, fontFeatureSettings: '"tnum"' }}>
                  {formatCurrency(stageValue)}
                </span>
              </div>

              {/* Deal cards */}
              {stageDeals.map(deal => {
                const dealTasks = tasks.filter(t => t.deal_id === deal.id && !t.completed)
                const blocking = dealTasks.filter(t => t.is_blocking)
                const days = daysUntil(deal.target_close_date)

                return (
                  <div
                    key={deal.id}
                    onClick={() => navigate(`/deal/${deal.id}`)}
                    style={{
                      background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
                      padding: '14px 16px', cursor: 'pointer', borderLeft: `3px solid ${stage.color}`,
                      marginBottom: 10, boxShadow: T.shadow, transition: 'box-shadow 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.boxShadow = T.shadowMd }}
                    onMouseLeave={e => { e.currentTarget.style.boxShadow = T.shadow }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{deal.company_name}</span>
                      <ForecastBadge category={deal.forecast_category} />
                    </div>

                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', marginBottom: 8 }}>
                      {formatCurrency(deal.deal_value)}
                    </div>

                    <ScoreBar score={deal.fit_score || 0} label="Fit" />
                    <ScoreBar score={deal.deal_health_score || 0} label="Health" />

                    {dealTasks.length > 0 && (
                      <div style={{
                        display: 'flex', gap: 6, padding: '5px 8px', marginTop: 6,
                        background: blocking.length > 0 ? T.errorLight : T.surfaceAlt,
                        borderRadius: 4, fontSize: 11,
                        color: blocking.length > 0 ? T.error : T.textSecondary,
                      }}>
                        <span style={{ fontWeight: 600 }}>{dealTasks.length} task{dealTasks.length !== 1 ? 's' : ''}</span>
                        {blocking.length > 0 && <span style={{ fontWeight: 700 }}>({blocking.length} blocking)</span>}
                      </div>
                    )}

                    <div style={{
                      display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.borderLight}`,
                      paddingTop: 8, marginTop: 8,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textSecondary }}>
                        <StatusDot text={deal.next_steps} />
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {deal.next_steps?.split(',')[0]?.substring(0, 25) || 'No next steps'}
                        </span>
                      </div>
                      <span style={{
                        fontSize: 11, fontWeight: 600, fontFeatureSettings: '"tnum"',
                        color: days != null && days < 0 ? T.error : days != null && days <= 30 ? T.warning : T.textMuted,
                      }}>
                        {days != null ? (days < 0 ? `${Math.abs(days)}d late` : `${days}d`) : '--'}
                      </span>
                    </div>
                  </div>
                )
              })}

              {stageDeals.length === 0 && (
                <div style={{
                  padding: 24, textAlign: 'center', fontSize: 12, color: T.textMuted,
                  border: `1px dashed ${T.border}`, borderRadius: T.radius, background: T.surfaceAlt,
                }}>
                  No deals
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
