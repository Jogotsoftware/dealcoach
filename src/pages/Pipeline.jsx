import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import {
  theme as T, STAGES, FORECAST_CATEGORIES, TERMINAL_STAGES,
  formatCurrency, formatDate, daysUntil, pctOf, getNext3Months, getFiscalPeriods,
} from '../lib/theme'
import { Badge, ForecastBadge, StageBadge, ScoreBar, StatusDot, Spinner, Button } from '../components/Shared'
import TranscriptUpload from '../components/TranscriptUpload'
import { ResponsiveGridLayout, useContainerWidth, getCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

const PIPELINE_DEFAULT_LAYOUT = [
  { i: 'pipeline_3month', x: 0, y: 0, w: 8, h: 3, minW: 4, minH: 2 },
  { i: 'pipeline_attainment', x: 8, y: 0, w: 4, h: 3, minW: 3, minH: 2 },
  { i: 'pipeline_kanban', x: 0, y: 3, w: 12, h: 8, minW: 8, minH: 4 },
  { i: 'pipeline_tasks', x: 0, y: 11, w: 6, h: 4, minW: 4, minH: 2 },
  { i: 'pipeline_at_risk', x: 6, y: 11, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'pipeline_forecast', x: 6, y: 14, w: 6, h: 3, minW: 4, minH: 2 },
]

const PIPELINE_DEFAULT_WIDGETS = [
  { id: 'pipeline_kanban', title: 'Pipeline Kanban', visible: true },
  { id: 'pipeline_3month', title: '3-Month Pipeline', visible: true },
  { id: 'pipeline_attainment', title: 'FY Attainment', visible: true },
  { id: 'pipeline_tasks', title: 'My Open Tasks', visible: true },
  { id: 'pipeline_at_risk', title: 'At Risk Deals', visible: true },
  { id: 'pipeline_forecast', title: 'Forecast Summary', visible: true },
  { id: 'pipeline_upcoming', title: 'Upcoming Calls', visible: false },
]

function MoreMenuItem({ label, onClick }) {
  const [h, setH] = useState(false)
  return (
    <button onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)} onClick={onClick}
      style={{ display: 'block', width: '100%', padding: '9px 16px', textAlign: 'left',
        background: h ? T.surfaceAlt : 'transparent', border: 'none', cursor: 'pointer',
        fontSize: 13, color: T.text, fontFamily: 'inherit' }}>{label}</button>
  )
}

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
  const [dealView, setDealView] = useState('my')
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Widget layout state
  const [pLayout, setPLayout] = useState(PIPELINE_DEFAULT_LAYOUT)
  const [pWidgets, setPWidgets] = useState(PIPELINE_DEFAULT_WIDGETS)
  const [pOrgLayoutId, setPOrgLayoutId] = useState(null)
  const [editMode, setEditMode] = useState(false)

  const { width: gridWidth, containerRef: gridContainerRef } = useContainerWidth({ initialWidth: 1200 })

  // Load data
  useEffect(() => { loadData() }, [profile, dealView])

  async function loadData() {
    if (!profile) return
    setLoading(true)
    try {
      let dealsQuery = supabase.from('deals').select('*')
      if (dealView === 'all' && profile.org_id) {
        dealsQuery = dealsQuery.eq('org_id', profile.org_id)
      } else {
        dealsQuery = dealsQuery.eq('rep_id', profile.id)
      }
      const [dealsRes, tasksRes, quotaRes] = await Promise.all([
        dealsQuery,
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

  // Load pipeline widget layout
  useEffect(() => {
    async function loadPipelineLayout() {
      if (!profile?.org_id) return
      const { data: orgLayout } = await supabase.from('org_widget_layouts')
        .select('*').eq('org_id', profile.org_id).eq('page', 'pipeline').eq('is_default', true).single()
      if (orgLayout) {
        setPOrgLayoutId(orgLayout.id)
        setPLayout(orgLayout.layout || PIPELINE_DEFAULT_LAYOUT)
        setPWidgets(orgLayout.widgets || PIPELINE_DEFAULT_WIDGETS)
      }
      if (profile.role !== 'admin' && profile.role !== 'system_admin') {
        const { data: override } = await supabase.from('user_widget_overrides')
          .select('*').eq('user_id', profile.id).eq('page', 'pipeline').single()
        if (override) { setPLayout(override.layout); setPWidgets(override.widgets) }
      }
    }
    if (profile?.id) loadPipelineLayout()
  }, [profile])

  async function savePipelineLayout(newLayout) {
    setPLayout(newLayout)
    const isAdmin = profile.role === 'admin' || profile.role === 'system_admin'
    if (isAdmin && pOrgLayoutId) {
      await supabase.from('org_widget_layouts').update({ layout: newLayout, widgets: pWidgets }).eq('id', pOrgLayoutId)
    } else if (pOrgLayoutId) {
      await supabase.from('user_widget_overrides').upsert({
        user_id: profile.id, org_layout_id: pOrgLayoutId, page: 'pipeline', layout: newLayout, widgets: pWidgets,
      }, { onConflict: 'user_id,page' })
    }
  }

  function resetPipelineLayout() {
    setPLayout(PIPELINE_DEFAULT_LAYOUT)
    setPWidgets(PIPELINE_DEFAULT_WIDGETS)
  }

  // Data computations
  const active = deals.filter(d => !TERMINAL_STAGES.includes(d.stage))
  const months = getNext3Months()
  const fp = getFiscalPeriods()
  const mQ = quota / 12
  const qQ = quota / 4
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
      if (sort === 'target_close_date') return d * (a.target_close_date || '9999').localeCompare(b.target_close_date || '9999')
      if (sort === 'most_active') {
        const at = tasks.filter(t => t.deal_id === a.id && !t.completed).length
        const bt = tasks.filter(t => t.deal_id === b.id && !t.completed).length
        return d * (at - bt)
      }
      return d * ((a[sort] || 0) - (b[sort] || 0))
    })
  }, [active, sort, dir, tasks])

  // === WIDGET RENDERERS ===
  function PipelineKanbanWidget() {
    return (
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', height: '100%' }}>
        {STAGES.map(stage => {
          const stageDeals = sorted.filter(d => d.stage === stage.key)
          const stageValue = stageDeals.reduce((s, d) => s + (d.deal_value || 0), 0)
          return (
            <div key={stage.key} style={{ flex: 1, minWidth: 220 }}>
              <div style={{ padding: '10px 12px', marginBottom: 8, borderBottom: `2px solid ${stage.color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.text, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{stage.label}</span>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, background: T.surfaceAlt, padding: '2px 7px', borderRadius: 10 }}>{stageDeals.length}</span>
                </div>
                <span style={{ fontSize: 11, color: T.textMuted, fontFeatureSettings: '"tnum"' }}>{formatCurrency(stageValue)}</span>
              </div>
              {stageDeals.map(deal => {
                const dealTasks = tasks.filter(t => t.deal_id === deal.id && !t.completed)
                const blocking = dealTasks.filter(t => t.is_blocking)
                const days = daysUntil(deal.target_close_date)
                return (
                  <div key={deal.id} onClick={() => navigate(`/deal/${deal.id}`)} style={{
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
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', marginBottom: 8 }}>{formatCurrency(deal.deal_value)}</div>
                    <ScoreBar score={deal.fit_score || 0} label="Fit" />
                    <ScoreBar score={deal.deal_health_score || 0} label="Health" />
                    {dealTasks.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, padding: '5px 8px', marginTop: 6, background: blocking.length > 0 ? T.errorLight : T.surfaceAlt, borderRadius: 4, fontSize: 11, color: blocking.length > 0 ? T.error : T.textSecondary }}>
                        <span style={{ fontWeight: 600 }}>{dealTasks.length} task{dealTasks.length !== 1 ? 's' : ''}</span>
                        {blocking.length > 0 && <span style={{ fontWeight: 700 }}>({blocking.length} blocking)</span>}
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.borderLight}`, paddingTop: 8, marginTop: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: T.textSecondary }}>
                        <StatusDot text={deal.next_steps} />
                        <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.next_steps?.split(',')[0]?.substring(0, 25) || 'No next steps'}</span>
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, fontFeatureSettings: '"tnum"', color: days != null && days < 0 ? T.error : days != null && days <= 30 ? T.warning : T.textMuted }}>
                        {days != null ? (days < 0 ? `${Math.abs(days)}d late` : `${days}d`) : '--'}
                      </span>
                    </div>
                  </div>
                )
              })}
              {stageDeals.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: T.radius, background: T.surfaceAlt }}>No deals</div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function Pipeline3MonthWidget() {
    return (
      <div style={{ display: 'flex', gap: 12, height: '100%' }}>
        {months.map((mo, i) => {
          const md = active.filter(d => d.target_close_date >= mo.start && d.target_close_date <= mo.end)
          const total = md.reduce((s, d) => s + (d.deal_value || 0), 0)
          return (
            <div key={i} style={{
              flex: 1, background: T.surfaceAlt, border: `1px solid ${mo.isCurrent ? T.primaryBorder : T.borderLight}`,
              borderRadius: 6, padding: '14px 16px', borderTop: mo.isCurrent ? `3px solid ${T.primary}` : 'none',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: mo.isCurrent ? T.primary : T.textMuted, marginBottom: 6 }}>
                {mo.label}{mo.isCurrent ? ' (now)' : ''}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', marginBottom: 4 }}>{formatCurrency(total)}</div>
              <div style={{ fontSize: 11, color: T.textSecondary }}>{md.length} deal{md.length !== 1 ? 's' : ''}</div>
            </div>
          )
        })}
      </div>
    )
  }

  function PipelineAttainmentWidget() {
    if (quota <= 0) return <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>Set your quota in Settings to see attainment.</div>
    return (
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>FY{fp.fy} Attainment</div>
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
                <div style={{ height: '100%', background: c, opacity: 0.2, width: `${Math.max(Math.min(pctOf(closed + pipe, q), 100) - Math.min(att, 100), 0)}%`, position: 'absolute', left: `${Math.min(att, 100)}%`, borderRadius: '0 3px 3px 0' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textSecondary, marginTop: 2 }}>
                <span>{formatCurrency(closed)} closed</span>
                <span>{formatCurrency(q)}</span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function PipelineTasksWidget() {
    const allTasks = tasks.filter(t => !t.completed).sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 }
      return (pOrder[a.priority] || 2) - (pOrder[b.priority] || 2)
    })
    return (
      <>
        {allTasks.slice(0, 15).map(t => (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: `1px solid ${T.borderLight}`, fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: t.priority === 'high' ? T.error : t.priority === 'medium' ? T.warning : T.textMuted, flexShrink: 0 }} />
            <span style={{ flex: 1, fontWeight: 600, color: T.text }}>{t.title}</span>
            <span style={{ color: T.textMuted, fontSize: 11 }}>{deals.find(d => d.id === t.deal_id)?.company_name || ''}</span>
            <span style={{ fontSize: 11, color: t.due_date && daysUntil(t.due_date) < 0 ? T.error : T.textMuted }}>{t.due_date ? formatDate(t.due_date) : ''}</span>
          </div>
        ))}
        {allTasks.length === 0 && <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>No open tasks</div>}
      </>
    )
  }

  function PipelineAtRiskWidget() {
    const atRisk = deals.filter(d =>
      !TERMINAL_STAGES.includes(d.stage) &&
      ((d.deal_health_score != null && d.deal_health_score < 5) ||
       (d.target_close_date && daysUntil(d.target_close_date) < 0))
    )
    return (
      <>
        {atRisk.map(d => (
          <div key={d.id} onClick={() => navigate('/deal/' + d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}`, cursor: 'pointer' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>{d.company_name}</span>
            <StageBadge stage={d.stage} />
            {d.deal_health_score != null && <span style={{ fontSize: 12, fontWeight: 700, color: d.deal_health_score < 5 ? T.error : T.warning }}>{d.deal_health_score}/10</span>}
            {d.target_close_date && daysUntil(d.target_close_date) < 0 && <Badge color={T.error}>Overdue</Badge>}
          </div>
        ))}
        {atRisk.length === 0 && <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>No at-risk deals</div>}
      </>
    )
  }

  function PipelineForecastWidget() {
    const categories = ['commit', 'forecast', 'upside', 'pipeline']
    return (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {categories.map(cat => {
          const catDeals = active.filter(d => d.forecast_category === cat)
          const total = catDeals.reduce((s, d) => s + (d.deal_value || 0), 0)
          const colors = { commit: T.success, forecast: T.primary, upside: T.warning, pipeline: T.textMuted }
          return (
            <div key={cat} style={{ textAlign: 'center', padding: 10, background: T.surfaceAlt, borderRadius: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: colors[cat], marginBottom: 4 }}>{cat}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: T.text }}>{formatCurrency(total)}</div>
              <div style={{ fontSize: 10, color: T.textMuted }}>{catDeals.length} deal{catDeals.length !== 1 ? 's' : ''}</div>
            </div>
          )
        })}
      </div>
    )
  }

  function renderPipelineWidget(widgetId) {
    switch (widgetId) {
      case 'pipeline_kanban': return <PipelineKanbanWidget />
      case 'pipeline_3month': return <Pipeline3MonthWidget />
      case 'pipeline_attainment': return <PipelineAttainmentWidget />
      case 'pipeline_tasks': return <PipelineTasksWidget />
      case 'pipeline_at_risk': return <PipelineAtRiskWidget />
      case 'pipeline_forecast': return <PipelineForecastWidget />
      case 'pipeline_upcoming': return <div style={{ color: T.textMuted, fontSize: 12 }}>Coming soon</div>
      default: return null
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      {/* CSS overrides */}
      <style>{`
        .react-grid-layout { position: relative; }
        .react-grid-item { transition: all 200ms ease; }
        .react-grid-item.cssTransforms { transition-property: transform; }
        .react-grid-item.react-draggable-dragging { transition: none !important; z-index: 100; opacity: 0.9; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .react-grid-item.resizing { transition: none !important; z-index: 100; }
        .react-grid-item > .react-resizable-handle { position: absolute; width: 20px; height: 20px; }
        .react-grid-item > .react-resizable-handle::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 8px; height: 8px; border-right: 2px solid rgba(136,153,170,0.4); border-bottom: 2px solid rgba(136,153,170,0.4); }
        .react-grid-item.react-grid-placeholder { background: rgba(93,173,226,0.1) !important; border: 2px dashed rgba(93,173,226,0.4) !important; border-radius: 10px; }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.surface,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Pipeline</h2>
          {profile?.org_id && (
            <div style={{ display: 'flex', borderRadius: 5, overflow: 'hidden', border: `1px solid ${T.border}` }}>
              {[['my', 'My Deals'], ['all', 'All Deals']].map(([key, label]) => (
                <button key={key} onClick={() => setDealView(key)} style={{
                  padding: '5px 12px', fontSize: 11, fontWeight: 600, fontFamily: T.font,
                  border: 'none', cursor: 'pointer',
                  background: dealView === key ? T.primary : T.surfaceAlt,
                  color: dealView === key ? '#fff' : T.textSecondary,
                }}>{label}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: '6px 10px', fontSize: 12, color: T.text, fontFamily: T.font,
            cursor: 'pointer', outline: 'none', fontWeight: 500,
          }}>
            {[['deal_value', 'Value'], ['target_close_date', 'Close Date'], ['most_active', 'Most Active'], ['fit_score', 'Fit']].map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <button onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')} style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 5,
            padding: '5px 8px', cursor: 'pointer', fontSize: 12, color: T.textSecondary, fontFamily: T.font,
          }}>{dir === 'desc' ? '\u2193' : '\u2191'}</button>
          <Button onClick={() => setShowTranscript(true)}>&#9654; Transcript</Button>
          <Button primary onClick={() => navigate('/deal/new')}>+ New Deal</Button>
          {/* Three-dot menu */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMoreMenu(!showMoreMenu)} style={{
              background: 'none', border: `1px solid ${T.border}`, borderRadius: 6,
              padding: '6px 12px', cursor: 'pointer', color: T.textMuted, fontSize: 18, lineHeight: 1,
            }}>{'\u2026'}</button>
            {showMoreMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowMoreMenu(false)} />
                <div style={{
                  position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 1000,
                  background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 200, padding: '4px 0',
                }}>
                  <MoreMenuItem label={editMode ? 'Lock Dashboard' : 'Edit Dashboard'} onClick={() => { setEditMode(!editMode); setShowMoreMenu(false) }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showTranscript && (
        <TranscriptUpload deals={deals} onClose={() => setShowTranscript(false)} onUploaded={() => loadData()} />
      )}

      {/* Edit mode bar */}
      {editMode && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 16px', margin: '12px 24px 0',
          background: 'rgba(93,173,226,0.08)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 8,
        }}>
          <span style={{ fontSize: 12, color: '#5DADE2', fontWeight: 600 }}>
            Editing pipeline layout {(profile.role === 'admin' || profile.role === 'system_admin') ? '(org default)' : '(your view)'}
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 8px', color: T.text, fontSize: 11, cursor: 'pointer', fontFamily: T.font }}
              value="" onChange={e => { if (e.target.value) { setPWidgets(pw => pw.map(w => w.id === e.target.value ? { ...w, visible: true } : w)); e.target.value = '' } }}>
              <option value="">+ Add Widget</option>
              {pWidgets.filter(w => !w.visible).map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
            </select>
            <button onClick={resetPipelineLayout} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font }}>Reset</button>
            <button onClick={() => { setEditMode(false); savePipelineLayout(pLayout) }} style={{ background: '#5DADE2', border: 'none', borderRadius: 6, padding: '4px 14px', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Done</button>
          </div>
        </div>
      )}

      {/* Widget Grid */}
      <div style={{ padding: '12px 24px 24px', width: '100%' }}>
        {editMode && (
          <style>{`
            .react-grid-layout {
              background-image:
                linear-gradient(to right, rgba(93,173,226,0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(93,173,226,0.05) 1px, transparent 1px);
              background-size: calc(100% / 12) 60px;
              min-height: 200px;
            }
          `}</style>
        )}
        <div ref={gridContainerRef} style={{ width: '100%' }}>
          <ResponsiveGridLayout
            className="layout"
            width={gridWidth}
            layouts={{ lg: pLayout.filter(l => pWidgets.find(w => w.id === l.i && w.visible)) }}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={{ lg: 12, md: 12, sm: 6 }}
            rowHeight={60}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            compactor={getCompactor("vertical")}
            dragConfig={{ enabled: editMode, handle: '.widget-drag-handle' }}
            resizeConfig={{ enabled: editMode }}
            onLayoutChange={(newLayout) => {
              if (!editMode) return
              const merged = newLayout.map(item => {
                const orig = pLayout.find(l => l.i === item.i)
                return { ...item, minW: orig?.minW || 4, minH: orig?.minH || 2 }
              })
              setPLayout(merged)
            }}
          >
            {pWidgets.filter(w => w.visible).map(w => (
              <div key={w.id} style={{
                background: T.surface,
                border: editMode ? '1px dashed rgba(93,173,226,0.3)' : `1px solid ${T.border}`,
                borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column',
              }}>
                <div style={{
                  padding: '8px 14px', borderBottom: `1px solid ${T.border}`,
                  display: 'flex', alignItems: 'center', gap: 8, background: T.surfaceAlt, flexShrink: 0,
                }}>
                  {editMode && <span className="widget-drag-handle" style={{ cursor: 'grab', color: T.textMuted, fontSize: 14, userSelect: 'none' }}>{'\u2807'}</span>}
                  <span style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.text, flex: 1 }}>{w.title}</span>
                  {editMode && <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 16, lineHeight: 1 }} onClick={() => setPWidgets(pw => pw.map(ww => ww.id === w.id ? { ...ww, visible: false } : ww))}>&times;</span>}
                </div>
                <div style={{ padding: 14, overflow: 'auto', flex: 1 }}>
                  {renderPipelineWidget(w.id)}
                </div>
              </div>
            ))}
          </ResponsiveGridLayout>
        </div>
      </div>
    </div>
  )
}
