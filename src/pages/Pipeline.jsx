import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { callUpdateCoachingSummary } from '../lib/webhooks'
import {
  theme as T, STAGES, FORECAST_CATEGORIES, TERMINAL_STAGES,
  formatCurrency, formatDate, daysUntil, pctOf, getNext3Months, getFiscalPeriods,
} from '../lib/theme'
import { Badge, ForecastBadge, StageBadge, ScoreBar, StatusDot, Spinner, Button } from '../components/Shared'
import TranscriptUpload from '../components/TranscriptUpload'
import CompanyLogo from '../components/CompanyLogo'
import WidgetRenderer from '../components/WidgetRenderer'
import { Responsive, WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
const ResponsiveGridLayout = WidthProvider(Responsive)

const PIPELINE_LAYOUT = [
  { i: 'forecast_summary', x: 0, y: 0, w: 12, h: 2, minW: 8, minH: 2 },
  { i: 'quota_tracker', x: 0, y: 2, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'coaching_feedback', x: 6, y: 2, w: 6, h: 3, minW: 4, minH: 2 },
  { i: 'pipeline_view', x: 0, y: 5, w: 12, h: 6, minW: 8, minH: 4 },
  { i: 'scoreboard', x: 0, y: 11, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'task_list', x: 6, y: 11, w: 6, h: 4, minW: 4, minH: 3 },
  { i: 'recent_activity', x: 0, y: 15, w: 6, h: 3, minW: 4, minH: 2 },
]

const PIPELINE_WIDGETS = [
  { id: 'forecast_summary', title: 'Forecast Summary', visible: true },
  { id: 'pipeline_view', title: 'Pipeline', visible: true },
  { id: 'quota_tracker', title: 'Quota Tracker', visible: true },
  { id: 'coaching_feedback', title: 'Coaching Feedback', visible: true },
  { id: 'scoreboard', title: 'Scoreboard', visible: true },
  { id: 'task_list', title: 'Tasks', visible: true },
  { id: 'recent_activity', title: 'Recent Activity', visible: true },
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

// Fiscal helpers
function getFiscalYear(date = new Date()) { const d = new Date(date); return d.getMonth() >= 9 ? d.getFullYear() + 1 : d.getFullYear() }
function getFiscalQuarter(date = new Date()) { const m = new Date(date).getMonth(); if (m >= 9 && m <= 11) return 1; if (m >= 0 && m <= 2) return 2; if (m >= 3 && m <= 5) return 3; return 4 }
function isInCurrentMonth(dateStr) { if (!dateStr) return false; const d = new Date(dateStr), n = new Date(); return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear() }
function isInCurrentQuarter(dateStr) {
  if (!dateStr) return false
  const d = new Date(dateStr), now = new Date(), fy = getFiscalYear(now), fq = getFiscalQuarter(now), yb = fy - 1
  const qs = { 1: [new Date(yb, 9, 1), new Date(yb, 11, 31)], 2: [new Date(fy, 0, 1), new Date(fy, 2, 31)], 3: [new Date(fy, 3, 1), new Date(fy, 5, 30)], 4: [new Date(fy, 6, 1), new Date(fy, 8, 30)] }
  const [s, e] = qs[fq] || []; return s && d >= s && d <= e
}
function getARR(deal) { return deal.deal_value || (deal.cmrr ? deal.cmrr * 12 : 0) }

export default function Pipeline() {
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Data
  const [deals, setDeals] = useState([])
  const [tasks, setTasks] = useState([])
  const [coachingSummary, setCoachingSummary] = useState(null)
  const [activity, setActivity] = useState([])
  const [quota, setQuota] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showTranscript, setShowTranscript] = useState(false)

  // Filters
  const [dealFilter, setDealFilter] = useState('my')
  const [forecastPeriod, setForecastPeriod] = useState('full')
  const [pipelineView, setPipelineView] = useState('kanban')
  const [selectedForecast, setSelectedForecast] = useState(null)
  const [taskFilter, setTaskFilter] = useState('all')
  const [sort, setSort] = useState('deal_value')
  const [dir, setDir] = useState('desc')

  // Widget layout
  const [pLayout, setPLayout] = useState(PIPELINE_LAYOUT)
  const [pWidgets, setPWidgets] = useState(PIPELINE_WIDGETS)
  const [pOrgLayoutId, setPOrgLayoutId] = useState(null)
  const [editMode, setEditMode] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [customWidgetDefs, setCustomWidgetDefs] = useState([])

  // Force WidthProvider remeasure after sidebar animation
  useEffect(() => {
    const timers = [
      setTimeout(() => window.dispatchEvent(new Event('resize')), 100),
      setTimeout(() => window.dispatchEvent(new Event('resize')), 300),
      setTimeout(() => window.dispatchEvent(new Event('resize')), 600),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  useEffect(() => { if (profile) loadData() }, [profile, dealFilter])

  async function loadData() {
    setLoading(true)
    try {
      let dq = supabase.from('deals').select('*, company_profile(logo_url)')
      if (dealFilter === 'all' && profile.org_id) dq = dq.eq('org_id', profile.org_id)
      else dq = dq.eq('rep_id', profile.id)

      const [dealsRes, tasksRes, quotaRes, csRes, actRes] = await Promise.all([
        dq,
        supabase.from('tasks').select('*, deals(company_name)'),
        supabase.from('rep_quotas').select('*').eq('rep_id', profile.id).limit(1),
        supabase.from('rep_coaching_summary').select('*').eq('user_id', profile.id).single(),
        supabase.from('ai_response_log').select('response_type, status, created_at, deal_id').eq('triggered_by', profile.id).order('created_at', { ascending: false }).limit(15),
      ])
      setDeals(dealsRes.data || [])
      setTasks(tasksRes.data || [])
      if (quotaRes.data?.[0]) setQuota(quotaRes.data[0].annual_quota || 0)
      else setQuota(profile.annual_quota || 0)
      setCoachingSummary(csRes.data || null)
      setActivity(actRes.data || [])
      if (profile?.org_id) {
        const { data: cwds } = await supabase.from('custom_widget_definitions').select('*').eq('org_id', profile.org_id).eq('widget_type', 'pipeline').eq('active', true)
        setCustomWidgetDefs(cwds || [])
      }
    } catch (err) { console.error('Error loading pipeline:', err) }
    finally { setLoading(false) }
  }

  // Load pipeline layout
  useEffect(() => {
    async function loadPipelineLayout() {
      if (!profile?.org_id) return
      const { data: orgLayout } = await supabase.from('org_widget_layouts')
        .select('*').eq('org_id', profile.org_id).eq('page', 'pipeline').eq('is_default', true).single()
      if (orgLayout) { setPOrgLayoutId(orgLayout.id); setPLayout(orgLayout.layout || PIPELINE_LAYOUT); setPWidgets(orgLayout.widgets || PIPELINE_WIDGETS) }
      if (profile.role !== 'admin' && profile.role !== 'system_admin') {
        const { data: override } = await supabase.from('user_widget_overrides').select('*').eq('user_id', profile.id).eq('page', 'pipeline').single()
        if (override) { setPLayout(override.layout); setPWidgets(override.widgets) }
      }
    }
    if (profile?.id) loadPipelineLayout()
  }, [profile])

  function addPipelineWidget(widgetId) {
    if (!widgetId) return
    const isNew = !pWidgets.some(w => w.id === widgetId)
    const customDef = customWidgetDefs.find(w => w.id === widgetId)

    let updated
    if (isNew && customDef) {
      updated = [...pWidgets, { id: customDef.id, title: customDef.name, visible: true }]
    } else {
      updated = pWidgets.map(w => w.id === widgetId ? { ...w, visible: true } : w)
    }
    setPWidgets(updated)

    if (!pLayout.find(l => l.i === widgetId)) {
      const maxY = pLayout.reduce((max, l) => Math.max(max, l.y + l.h), 0)
      setPLayout(prev => [...prev, {
        i: widgetId, x: 0, y: maxY,
        w: customDef?.default_w || 6, h: customDef?.default_h || 4,
        minW: customDef?.min_w || 2, minH: customDef?.min_h || 1,
      }])
    }
  }

  async function savePipelineLayout(newLayout) {
    setPLayout(newLayout)
    const isAdmin = profile.role === 'admin' || profile.role === 'system_admin'
    if (isAdmin && pOrgLayoutId) await supabase.from('org_widget_layouts').update({ layout: newLayout, widgets: pWidgets }).eq('id', pOrgLayoutId)
    else if (pOrgLayoutId) await supabase.from('user_widget_overrides').upsert({ user_id: profile.id, org_layout_id: pOrgLayoutId, page: 'pipeline', layout: newLayout, widgets: pWidgets }, { onConflict: 'user_id,page' })
  }

  // Computed
  const active = deals.filter(d => !TERMINAL_STAGES.includes(d.stage))
  const closedDeals = deals.filter(d => d.stage === 'closed_won')
  const fp = getFiscalPeriods()
  const fy = getFiscalYear()
  const fq = getFiscalQuarter()

  function filterDealsByPeriod(d) {
    const a = d.filter(dd => !TERMINAL_STAGES.includes(dd.stage))
    if (forecastPeriod === 'month') return a.filter(dd => isInCurrentMonth(dd.target_close_date))
    if (forecastPeriod === 'quarter') return a.filter(dd => isInCurrentQuarter(dd.target_close_date))
    return a
  }

  const sorted = useMemo(() => {
    return [...active].sort((a, b) => {
      const d = dir === 'desc' ? -1 : 1
      if (sort === 'target_close_date') return d * (a.target_close_date || '9999').localeCompare(b.target_close_date || '9999')
      if (sort === 'most_active') return d * ((tasks.filter(t => t.deal_id === a.id && !t.completed).length) - (tasks.filter(t => t.deal_id === b.id && !t.completed).length))
      return d * ((a[sort] || 0) - (b[sort] || 0))
    })
  }, [active, sort, dir, tasks])

  // ============ WIDGETS ============

  function ForecastSummaryWidget() {
    const periodDeals = filterDealsByPeriod(deals)
    const categories = [
      { key: 'commit', label: 'Commit', color: '#27ae60' },
      { key: 'forecast', label: 'Forecast', color: '#3498db' },
      { key: 'upside', label: 'Upside', color: '#f39c12' },
      { key: 'pipeline', label: 'Pipeline', color: '#8899aa' },
    ]
    return (
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {['month', 'quarter', 'full'].map(p => (
            <button key={p} onClick={() => setForecastPeriod(p)} style={{
              padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: forecastPeriod === p ? T.primary : T.surfaceAlt, color: forecastPeriod === p ? '#fff' : T.textMuted,
            }}>{p === 'month' ? 'In-Month' : p === 'quarter' ? 'In-Quarter' : 'Full Pipeline'}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 10 }}>
          {categories.map(cat => {
            const catDeals = periodDeals.filter(d => d.forecast_category === cat.key)
            const totalARR = catDeals.reduce((s, d) => s + getARR(d), 0)
            const isSelected = selectedForecast === cat.key
            return (
              <div key={cat.key} onClick={() => setSelectedForecast(isSelected ? null : cat.key)} style={{
                background: isSelected ? cat.color + '15' : T.surfaceAlt, borderRadius: 8, padding: 14,
                textAlign: 'center', cursor: 'pointer', borderLeft: '4px solid ' + cat.color,
                border: isSelected ? '1px solid ' + cat.color : '1px solid transparent', transition: 'all 0.15s',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: cat.color, textTransform: 'uppercase' }}>{cat.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginTop: 4 }}>{formatCurrency(totalARR)}</div>
                <div style={{ fontSize: 11, color: T.textMuted }}>{catDeals.length} deal{catDeals.length !== 1 ? 's' : ''}</div>
              </div>
            )
          })}
          <div style={{ background: T.surfaceAlt, borderRadius: 8, padding: 14, textAlign: 'center', borderLeft: '4px solid ' + T.text }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Total</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text, marginTop: 4 }}>{formatCurrency(periodDeals.reduce((s, d) => s + getARR(d), 0))}</div>
            <div style={{ fontSize: 11, color: T.textMuted }}>{periodDeals.length} deals</div>
          </div>
        </div>
      </div>
    )
  }

  function PipelineViewWidget() {
    const filteredDeals = selectedForecast ? active.filter(d => d.forecast_category === selectedForecast) : active
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center' }}>
          {['kanban', 'table'].map(v => (
            <button key={v} onClick={() => setPipelineView(v)} style={{
              padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: pipelineView === v ? T.primary : T.surfaceAlt, color: pipelineView === v ? '#fff' : T.textMuted,
            }}>{v === 'kanban' ? 'Kanban' : 'Table'}</button>
          ))}
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ marginLeft: 8, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 11, color: T.text, fontFamily: T.font, cursor: 'pointer' }}>
            {[['deal_value', 'Value'], ['target_close_date', 'Close'], ['fit_score', 'Fit']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <button onClick={() => setDir(d => d === 'desc' ? 'asc' : 'desc')} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 4, padding: '3px 6px', fontSize: 11, cursor: 'pointer', color: T.textMuted }}>{dir === 'desc' ? '\u2193' : '\u2191'}</button>
          {selectedForecast && <span style={{ fontSize: 11, color: T.primary, marginLeft: 8 }}>Filtered: {selectedForecast} <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => setSelectedForecast(null)}>clear</span></span>}
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {pipelineView === 'kanban' ? <KanbanView deals={filteredDeals} /> : <TableView deals={filteredDeals} />}
        </div>
      </div>
    )
  }

  function KanbanView({ deals: kDeals }) {
    const kSorted = [...kDeals].sort((a, b) => { const d = dir === 'desc' ? -1 : 1; return d * ((a[sort] || 0) - (b[sort] || 0)) })
    return (
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', height: '100%' }}>
        {STAGES.map(stage => {
          const stageDeals = kSorted.filter(d => d.stage === stage.key)
          const stageValue = stageDeals.reduce((s, d) => s + getARR(d), 0)
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
                const days = daysUntil(deal.target_close_date)
                return (
                  <div key={deal.id} onClick={() => navigate(`/deal/${deal.id}`)} style={{
                    background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius,
                    padding: '12px 14px', cursor: 'pointer', borderLeft: `3px solid ${stage.color}`,
                    marginBottom: 8, boxShadow: T.shadow, transition: 'box-shadow 0.15s',
                  }} onMouseEnter={e => e.currentTarget.style.boxShadow = T.shadowMd} onMouseLeave={e => e.currentTarget.style.boxShadow = T.shadow}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <CompanyLogo logoUrl={deal.company_profile?.logo_url} companyName={deal.company_name} size="sm" />
                      <span style={{ fontSize: 13, fontWeight: 600, color: T.text, flex: 1 }}>{deal.company_name}</span>
                      {deal.icp_fit_score != null && <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: deal.icp_fit_score >= 70 ? T.success : deal.icp_fit_score >= 40 ? T.warning : T.error }} title={`ICP: ${deal.icp_fit_score}/100`} />}
                      <ForecastBadge category={deal.forecast_category} />
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"', marginBottom: 6 }}>{formatCurrency(getARR(deal))}</div>
                    <ScoreBar score={deal.fit_score || 0} label="Fit" />
                    <ScoreBar score={deal.deal_health_score || 0} label="Health" />
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: `1px solid ${T.borderLight}`, paddingTop: 6, marginTop: 6, fontSize: 11 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: T.textSecondary }}><StatusDot text={deal.next_steps} /><span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{deal.next_steps?.split(',')[0]?.substring(0, 25) || 'No next steps'}</span></div>
                      <span style={{ fontWeight: 600, fontFeatureSettings: '"tnum"', color: days != null && days < 0 ? T.error : days != null && days <= 30 ? T.warning : T.textMuted }}>{days != null ? (days < 0 ? `${Math.abs(days)}d late` : `${days}d`) : '--'}</span>
                    </div>
                  </div>
                )
              })}
              {stageDeals.length === 0 && <div style={{ padding: 20, textAlign: 'center', fontSize: 12, color: T.textMuted, border: `1px dashed ${T.border}`, borderRadius: T.radius, background: T.surfaceAlt }}>No deals</div>}
            </div>
          )
        })}
      </div>
    )
  }

  function TableView({ deals: tDeals }) {
    const [tSort, setTSort] = useState('deal_value')
    const [tDir, setTDir] = useState('desc')
    const tSorted = [...tDeals].sort((a, b) => {
      const d = tDir === 'desc' ? -1 : 1
      if (tSort === 'company_name') return d * (a.company_name || '').localeCompare(b.company_name || '')
      if (tSort === 'target_close_date') return d * (a.target_close_date || '9999').localeCompare(b.target_close_date || '9999')
      return d * ((a[tSort] || 0) - (b[tSort] || 0))
    })
    function th(key, label) {
      return <th onClick={() => { if (tSort === key) setTDir(d => d === 'desc' ? 'asc' : 'desc'); else { setTSort(key); setTDir('desc') } }}
        style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: tSort === key ? T.primary : '#8899aa', textTransform: 'uppercase', cursor: 'pointer', whiteSpace: 'nowrap', borderBottom: `1px solid ${T.border}` }}>{label}{tSort === key ? (tDir === 'desc' ? ' \u2193' : ' \u2191') : ''}</th>
    }
    return (
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{th('company_name', 'Company')}{th('stage', 'Stage')}{th('forecast_category', 'Forecast')}{th('deal_value', 'ARR')}{th('target_close_date', 'Close')}{th('fit_score', 'Fit')}{th('deal_health_score', 'Health')}<th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', borderBottom: `1px solid ${T.border}` }}>Next Steps</th></tr></thead>
        <tbody>
          {tSorted.map(d => {
            const days = daysUntil(d.target_close_date)
            return (
              <tr key={d.id} onClick={() => navigate(`/deal/${d.id}`)} style={{ cursor: 'pointer', borderBottom: `1px solid ${T.borderLight}` }}
                onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '8px', fontWeight: 600 }}><div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CompanyLogo logoUrl={d.company_profile?.logo_url} companyName={d.company_name} size="sm" />{d.company_name}</div></td>
                <td style={{ padding: '8px' }}><StageBadge stage={d.stage} /></td>
                <td style={{ padding: '8px' }}><ForecastBadge category={d.forecast_category} /></td>
                <td style={{ padding: '8px', fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{formatCurrency(getARR(d))}</td>
                <td style={{ padding: '8px', color: days != null && days < 0 ? T.error : T.textMuted, fontFeatureSettings: '"tnum"' }}>{d.target_close_date ? formatDate(d.target_close_date) : '--'}</td>
                <td style={{ padding: '8px' }}>{d.fit_score ?? '--'}</td>
                <td style={{ padding: '8px' }}>{d.deal_health_score ?? '--'}</td>
                <td style={{ padding: '8px', color: T.textMuted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11 }}>{d.next_steps?.substring(0, 60) || '--'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  function QuotaTrackerWidget() {
    const monthClosed = closedDeals.filter(d => isInCurrentMonth(d.target_close_date)).reduce((s, d) => s + getARR(d), 0)
    const quarterClosed = closedDeals.filter(d => isInCurrentQuarter(d.target_close_date)).reduce((s, d) => s + getARR(d), 0)
    const fyClosed = closedDeals.filter(d => d.target_close_date && getFiscalYear(new Date(d.target_close_date)) === fy).reduce((s, d) => s + getARR(d), 0)
    const mQ = quota / 12, qQ = quota / 4
    const periods = [
      { label: 'Monthly', closed: monthClosed, q: mQ },
      { label: 'Q' + fq + ' FY' + fy, closed: quarterClosed, q: qQ },
      { label: 'FY' + fy, closed: fyClosed, q: quota },
    ]
    if (quota <= 0) return <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>Set your quota in Settings to see attainment.</div>
    return (
      <div>
        {periods.map(p => {
          const pct = p.q > 0 ? Math.min(120, Math.round((p.closed / p.q) * 100)) : 0
          const c = pct >= 100 ? '#27ae60' : pct >= 70 ? '#f39c12' : '#e74c3c'
          return (
            <div key={p.label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>{p.label}</span>
                <span style={{ fontWeight: 800, color: c }}>{pct}%</span>
              </div>
              <div style={{ background: T.border, borderRadius: 6, height: 10, overflow: 'hidden' }}>
                <div style={{ width: Math.min(100, pct) + '%', height: '100%', background: c, borderRadius: 6, transition: 'width 0.5s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textMuted, marginTop: 2 }}>
                <span>{formatCurrency(p.closed)} closed</span>
                <span>{formatCurrency(p.q)}</span>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  function CoachingFeedbackWidget() {
    const [updating, setUpdating] = useState(false)
    async function updateCoaching() {
      setUpdating(true)
      const res = await callUpdateCoachingSummary(profile.id)
      if (res.success || res.strengths) {
        setCoachingSummary({ top_strengths: res.strengths || res.top_strengths, top_improvements: res.improvements || res.top_improvements, score_averages: res.score_averages, calls_analyzed: res.calls_analyzed, last_updated_at: new Date().toISOString() })
      }
      setUpdating(false)
    }
    if (!coachingSummary) return (
      <div style={{ textAlign: 'center', padding: 20 }}>
        <div style={{ color: T.textMuted, fontSize: 12, marginBottom: 8 }}>No coaching data yet</div>
        <button onClick={updateCoaching} disabled={updating} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 16px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>{updating ? 'Analyzing...' : 'Generate Coaching Summary'}</button>
      </div>
    )
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: T.textMuted }}>Based on {coachingSummary.calls_analyzed || '?'} calls{coachingSummary.last_updated_at && ' \u2022 Updated ' + formatDate(coachingSummary.last_updated_at?.split('T')[0])}</span>
          <button onClick={updateCoaching} disabled={updating} style={{ background: 'none', border: '1px solid ' + T.border, borderRadius: 4, padding: '2px 8px', fontSize: 10, color: T.textMuted, cursor: 'pointer' }}>{updating ? '...' : 'Refresh'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#27ae60', textTransform: 'uppercase', marginBottom: 6 }}>Top Strengths</div>
            {(coachingSummary.top_strengths || []).map((s, i) => (
              <div key={i} style={{ fontSize: 12, padding: '4px 0', borderLeft: '3px solid #27ae60', paddingLeft: 8, marginBottom: 4, lineHeight: 1.4 }}>
                {typeof s === 'string' ? s : s.text}
                {s.frequency && <div style={{ fontSize: 10, color: T.textMuted }}>{s.frequency}</div>}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#e74c3c', textTransform: 'uppercase', marginBottom: 6 }}>Areas to Improve</div>
            {(coachingSummary.top_improvements || []).map((s, i) => (
              <div key={i} style={{ fontSize: 12, padding: '4px 0', borderLeft: '3px solid #e74c3c', paddingLeft: 8, marginBottom: 4, lineHeight: 1.4 }}>
                {typeof s === 'string' ? s : s.text}
                {s.frequency && <div style={{ fontSize: 10, color: T.textMuted }}>{s.frequency}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  function ScoreboardWidget() {
    const avgFit = active.filter(d => d.fit_score).length ? active.reduce((s, d) => s + (d.fit_score || 0), 0) / active.filter(d => d.fit_score).length : 0
    const avgHealth = active.filter(d => d.deal_health_score).length ? active.reduce((s, d) => s + (d.deal_health_score || 0), 0) / active.filter(d => d.deal_health_score).length : 0
    const sa = coachingSummary?.score_averages || {}
    const st = coachingSummary?.score_trends || {}
    function ScoreRow({ label, value, max, trend }) {
      if (value == null || isNaN(value)) return null
      const pct = Math.min(100, (value / max) * 100)
      const c = value / max >= 0.7 ? '#27ae60' : value / max >= 0.5 ? '#f39c12' : '#e74c3c'
      const arrow = trend?.direction === 'up' ? ' \u2191' : trend?.direction === 'down' ? ' \u2193' : ''
      const ac = trend?.direction === 'up' ? '#27ae60' : trend?.direction === 'down' ? '#e74c3c' : T.textMuted
      return (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
            <span style={{ fontWeight: 600 }}>{label}</span>
            <span style={{ fontWeight: 800, color: c }}>{(Math.round(value * 10) / 10)}/{max}{arrow && <span style={{ color: ac, marginLeft: 4 }}>{arrow}</span>}</span>
          </div>
          <div style={{ background: T.border, borderRadius: 4, height: 6, overflow: 'hidden' }}>
            <div style={{ width: pct + '%', height: '100%', background: c, borderRadius: 4 }} />
          </div>
        </div>
      )
    }
    return (
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>Deal Averages</div>
        <ScoreRow label="Fit Score" value={avgFit} max={10} />
        <ScoreRow label="Deal Health" value={avgHealth} max={10} />
        {Object.keys(sa).length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginTop: 12, marginBottom: 8 }}>Coaching Averages</div>
            <ScoreRow label="Discovery Depth" value={sa.discovery_depth_score} max={10} trend={st?.discovery_depth_score} />
            <ScoreRow label="Curiosity" value={sa.curiosity_score} max={10} trend={st?.curiosity_score} />
            <ScoreRow label="Challenger" value={sa.challenger_score} max={10} trend={st?.challenger_score} />
            <ScoreRow label="Value Articulation" value={sa.value_articulation_score} max={10} trend={st?.value_articulation_score} />
            <ScoreRow label="Next Steps Quality" value={sa.next_steps_quality_score} max={10} trend={st?.next_steps_quality_score} />
          </>
        )}
      </div>
    )
  }

  function TaskListWidget() {
    const [showAddTask, setShowAddTask] = useState(false)
    const [newTask, setNewTask] = useState({ title: '', deal_id: '', priority: 'medium', due_date: '' })
    const filtered = taskFilter === 'high' ? tasks.filter(t => !t.completed && t.priority === 'high')
      : taskFilter === 'overdue' ? tasks.filter(t => !t.completed && t.due_date && new Date(t.due_date) < new Date())
      : tasks.filter(t => !t.completed)
    async function addTask() {
      if (!newTask.title.trim()) return
      const { data, error } = await supabase.from('tasks').insert({ title: newTask.title, deal_id: newTask.deal_id || null, priority: newTask.priority, due_date: newTask.due_date || null, auto_generated: false, completed: false }).select('*, deals(company_name)').single()
      if (!error && data) { setTasks(prev => [data, ...prev]); setShowAddTask(false); setNewTask({ title: '', deal_id: '', priority: 'medium', due_date: '' }) }
    }
    async function toggleTask(taskId) {
      const task = tasks.find(t => t.id === taskId); if (!task) return
      await supabase.from('tasks').update({ completed: !task.completed }).eq('id', taskId)
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, completed: !t.completed } : t))
    }
    return (
      <div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'high', 'overdue'].map(f => (
              <button key={f} onClick={() => setTaskFilter(f)} style={{ padding: '3px 10px', borderRadius: 4, fontSize: 10, fontWeight: 600, border: 'none', cursor: 'pointer', background: taskFilter === f ? T.primary : T.surfaceAlt, color: taskFilter === f ? '#fff' : T.textMuted }}>{f === 'all' ? 'All' : f === 'high' ? 'High Priority' : 'Overdue'}</button>
            ))}
          </div>
          <button onClick={() => setShowAddTask(!showAddTask)} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 4, padding: '3px 10px', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>+ Add</button>
        </div>
        {showAddTask && (
          <div style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, marginBottom: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <input placeholder="Task title" value={newTask.title} onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))} onKeyDown={e => e.key === 'Enter' && addTask()}
              style={{ flex: 2, minWidth: 150, padding: '4px 8px', fontSize: 12, background: T.surface, border: '1px solid ' + T.border, borderRadius: 4, color: T.text, fontFamily: T.font }} />
            <select value={newTask.deal_id} onChange={e => setNewTask(p => ({ ...p, deal_id: e.target.value }))}
              style={{ flex: 1, minWidth: 100, padding: '4px 8px', fontSize: 11, background: T.surface, border: '1px solid ' + T.border, borderRadius: 4, color: T.text, fontFamily: T.font }}>
              <option value="">General</option>
              {active.map(d => <option key={d.id} value={d.id}>{d.company_name}</option>)}
            </select>
            <select value={newTask.priority} onChange={e => setNewTask(p => ({ ...p, priority: e.target.value }))}
              style={{ width: 80, padding: '4px 8px', fontSize: 11, background: T.surface, border: '1px solid ' + T.border, borderRadius: 4, color: T.text, fontFamily: T.font }}>
              <option value="high">High</option><option value="medium">Med</option><option value="low">Low</option>
            </select>
            <input type="date" value={newTask.due_date} onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))}
              style={{ width: 120, padding: '4px 8px', fontSize: 11, background: T.surface, border: '1px solid ' + T.border, borderRadius: 4, color: T.text, fontFamily: T.font }} />
            <button onClick={addTask} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Add</button>
          </div>
        )}
        <div style={{ overflow: 'auto' }}>
          {filtered.map(t => {
            const overdue = t.due_date && new Date(t.due_date) < new Date()
            return (
              <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + T.borderLight }}>
                <input type="checkbox" checked={!!t.completed} onChange={() => toggleTask(t.id)} style={{ cursor: 'pointer' }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: t.priority === 'high' ? '#e74c3c' : t.priority === 'medium' ? '#f39c12' : '#8899aa', flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: t.priority === 'high' ? 700 : 500, color: T.text }}>{t.title}</div>
                  {t.deals?.company_name ? <span style={{ fontSize: 10, color: T.primary, cursor: 'pointer' }} onClick={() => navigate('/deal/' + t.deal_id)}>{t.deals.company_name}</span> : <span style={{ fontSize: 10, color: T.textMuted }}>General</span>}
                </div>
                {t.due_date && <span style={{ fontSize: 10, fontWeight: 600, color: overdue ? '#e74c3c' : T.textMuted }}>{formatDate(t.due_date)}</span>}
              </div>
            )
          })}
          {filtered.length === 0 && <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>No tasks match filter</div>}
        </div>
      </div>
    )
  }

  function RecentActivityWidget() {
    const typeLabels = { company_research: 'Research', transcript_analysis: 'Transcript', email: 'Email', chat: 'Chat' }
    const typeColors = { company_research: '#3498db', transcript_analysis: '#9b59b6', email: '#f39c12', chat: '#27ae60' }
    return activity.length === 0 ? <div style={{ color: T.textMuted, fontSize: 12, textAlign: 'center', padding: 20 }}>No recent activity</div> : (
      <div>
        {activity.map((a, i) => {
          const deal = deals.find(d => d.id === a.deal_id)
          const ago = Math.round((Date.now() - new Date(a.created_at).getTime()) / 60000)
          const timeStr = ago < 60 ? ago + 'm ago' : ago < 1440 ? Math.round(ago / 60) + 'h ago' : Math.round(ago / 1440) + 'd ago'
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid ' + T.borderLight, fontSize: 12 }}>
              <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, whiteSpace: 'nowrap', background: (typeColors[a.response_type] || '#8899aa') + '20', color: typeColors[a.response_type] || '#8899aa' }}>{typeLabels[a.response_type] || a.response_type}</span>
              <span style={{ flex: 1, color: T.text }}>{deal?.company_name || 'Unknown deal'}</span>
              <span style={{ fontSize: 10, color: T.textMuted, whiteSpace: 'nowrap' }}>{timeStr}</span>
            </div>
          )
        })}
      </div>
    )
  }

  function PipelineAtRiskWidget() {
    const atRisk = deals.filter(d =>
      !TERMINAL_STAGES.includes(d.stage) &&
      ((d.deal_health_score != null && d.deal_health_score < 5) ||
       (d.target_close_date && daysUntil(d.target_close_date) < 0))
    )
    return atRisk.length === 0 ? <div style={{ color: T.textMuted, fontSize: 12, fontStyle: 'italic', padding: 8 }}>No at-risk deals</div> : (
      <>
        {atRisk.map(d => (
          <div key={d.id} onClick={() => navigate('/deal/' + d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid ' + T.borderLight, cursor: 'pointer' }}>
            <CompanyLogo logoUrl={d.company_profile?.logo_url} companyName={d.company_name} size="sm" />
            <span style={{ fontSize: 13, fontWeight: 700, color: T.text, flex: 1 }}>{d.company_name}</span>
            <StageBadge stage={d.stage} />
            {d.deal_health_score != null && <span style={{ fontSize: 12, fontWeight: 700, color: d.deal_health_score < 5 ? T.error : T.warning }}>{d.deal_health_score}/10</span>}
            {d.target_close_date && daysUntil(d.target_close_date) < 0 && <Badge color={T.error}>Overdue</Badge>}
          </div>
        ))}
      </>
    )
  }

  function FallbackWidget({ id }) {
    const custom = customWidgetDefs.find(w => w.id === id || w.name === id)
    if (custom?.config) return <WidgetRenderer config={custom.config} context={{ user_id: profile?.id }} />
    return <div style={{ color: T.textMuted, fontSize: 12, padding: 8 }}>Unknown widget: {id}</div>
  }

  function renderWidget(id) {
    switch (id) {
      case 'forecast_summary': return <ForecastSummaryWidget />
      case 'pipeline_view':
      case 'pipeline_kanban':
      case 'kanban':
      case 'deal_table':
        return <PipelineViewWidget />
      case 'quota_tracker':
      case 'pipeline_attainment':
      case 'monthly_pipeline':
      case '3_month_pipeline':
      case 'pipeline_3month':
        return <QuotaTrackerWidget />
      case 'coaching_feedback': return <CoachingFeedbackWidget />
      case 'scoreboard':
      case 'pipeline_forecast':
        return <ScoreboardWidget />
      case 'task_list':
      case 'pipeline_tasks':
        return <TaskListWidget />
      case 'recent_activity':
      case 'pipeline_upcoming':
        return <RecentActivityWidget />
      case 'pipeline_at_risk':
        return <PipelineAtRiskWidget />
      default: return <FallbackWidget id={id} />
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <style>{`
        .react-grid-layout { position: relative !important; width: 100% !important; }
        .react-grid-item { transition: all 200ms ease; }
        .react-grid-item.react-draggable-dragging { transition: none; z-index: 100; opacity: 0.9; box-shadow: 0 8px 32px rgba(0,0,0,0.3); }
        .react-grid-item.react-grid-placeholder { background: rgba(93,173,226,0.1); border: 2px dashed rgba(93,173,226,0.4); border-radius: 10px; }
        .react-resizable-handle { position: absolute; width: 20px; height: 20px; }
        .react-resizable-handle::after { content: ""; position: absolute; right: 3px; bottom: 3px; width: 8px; height: 8px; border-right: 2px solid rgba(136,153,170,0.4); border-bottom: 2px solid rgba(136,153,170,0.4); }
      `}</style>

      {/* Header */}
      <div style={{ padding: '16px 24px', borderBottom: '1px solid ' + T.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: T.text }}>Pipeline</h1>
          {profile?.org_id && (
            <div style={{ display: 'flex', gap: 4 }}>
              {['my', 'all'].map(f => (
                <button key={f} onClick={() => setDealFilter(f)} style={{
                  padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer',
                  background: dealFilter === f ? T.primary : T.surfaceAlt, color: dealFilter === f ? '#fff' : T.textMuted,
                }}>{f === 'my' ? 'My Deals' : 'All Deals'}</button>
              ))}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button onClick={() => setShowTranscript(true)}>Transcript</Button>
          <Button primary onClick={() => navigate('/deal/new')}>+ New Deal</Button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowMoreMenu(!showMoreMenu)} style={{ background: 'none', border: '1px solid ' + T.border, borderRadius: 6, padding: '6px 12px', cursor: 'pointer', color: T.textMuted, fontSize: 18, lineHeight: 1 }}>{'\u2026'}</button>
            {showMoreMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setShowMoreMenu(false)} />
                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 1000, background: T.surface, border: '1px solid ' + T.border, borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 200, padding: '4px 0' }}>
                  <MoreMenuItem label={editMode ? 'Lock Dashboard' : 'Edit Dashboard'} onClick={() => { setEditMode(!editMode); setShowMoreMenu(false) }} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {showTranscript && <TranscriptUpload deals={deals} onClose={() => setShowTranscript(false)} onUploaded={() => loadData()} />}

      {/* Edit bar */}
      {editMode && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 16px', margin: '12px 24px 0', background: 'rgba(93,173,226,0.08)', border: '1px solid rgba(93,173,226,0.2)', borderRadius: 8 }}>
          <span style={{ fontSize: 12, color: '#5DADE2', fontWeight: 600 }}>Editing pipeline layout {(profile.role === 'admin' || profile.role === 'system_admin') ? '(org default)' : '(your view)'}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select style={{ background: T.surfaceAlt, border: '1px solid ' + T.border, borderRadius: 6, padding: '4px 8px', color: T.text, fontSize: 11, cursor: 'pointer', fontFamily: T.font }}
              value="" onChange={e => { if (e.target.value) { addPipelineWidget(e.target.value); e.target.value = '' } }}>
              <option value="">+ Add Widget</option>
              {pWidgets.filter(w => !w.visible).map(w => <option key={w.id} value={w.id}>{w.title}</option>)}
              {customWidgetDefs.filter(cw => cw.widget_type === 'pipeline' && !pWidgets.some(w => w.id === cw.id)).map(cw => (
                <option key={cw.id} value={cw.id}>[Custom] {cw.name}</option>
              ))}
            </select>
            <button onClick={() => { setPLayout(PIPELINE_LAYOUT); setPWidgets(PIPELINE_WIDGETS) }} style={{ background: 'none', border: '1px solid ' + T.border, borderRadius: 6, padding: '4px 10px', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font }}>Reset</button>
            <button onClick={() => { setEditMode(false); savePipelineLayout(pLayout) }} style={{ background: '#5DADE2', border: 'none', borderRadius: 6, padding: '4px 14px', color: '#fff', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>Done</button>
          </div>
        </div>
      )}

      {/* Widget Grid */}
      <div style={{ padding: '12px 24px 24px', width: '100%' }}>
        {editMode && (
          <style>{`
            .react-grid-layout {
              background-image: linear-gradient(to right, rgba(93,173,226,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(93,173,226,0.05) 1px, transparent 1px);
              background-size: calc(100% / 12) 60px; min-height: 200px;
            }
          `}</style>
        )}
        <div style={{ width: '100%', minWidth: 0 }}>
          <ResponsiveGridLayout
            className="layout"
            layouts={{ lg: pLayout.filter(l => pWidgets.find(w => w.id === l.i && w.visible)) }}
            breakpoints={{ lg: 1200, md: 996, sm: 768 }}
            cols={{ lg: 12, md: 12, sm: 6 }}
            rowHeight={60}
            margin={[12, 12]}
            containerPadding={[0, 0]}
            isDraggable={editMode}
            isResizable={editMode}
            compactType="vertical"
            useCSSTransforms={true}
            preventCollision={false}
            draggableHandle=".widget-drag-handle"
            measureBeforeMount={false}
            onLayoutChange={(newLayout) => {
              if (!editMode) return
              const merged = newLayout.map(item => {
                const orig = pLayout.find(l => l.i === item.i)
                return { ...item, minW: orig?.minW || 4, minH: orig?.minH || 2 }
              })
              setPLayout(merged)
            }}
          >
            {(() => {
              const wbc = { forecast_summary: '#3498db', pipeline_view: '#9b59b6', quota_tracker: '#f39c12', coaching_feedback: '#27ae60', scoreboard: '#f39c12', task_list: '#e74c3c', recent_activity: '#8899aa' }
              return pWidgets.filter(w => w.visible).map(w => (
                <div key={w.id} style={{ background: T.surface, border: editMode ? '1px dashed rgba(93,173,226,0.3)' : '1px solid ' + T.border, borderLeft: '3px solid ' + (wbc[w.id] || '#8899aa'), borderRadius: 10, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '6px 10px', borderBottom: '1px solid ' + T.border, display: 'flex', alignItems: 'center', gap: 8, background: T.surfaceAlt, flexShrink: 0 }}>
                    {editMode && <span className="widget-drag-handle" style={{ cursor: 'grab', color: T.textMuted, fontSize: 14, userSelect: 'none' }}>{'\u2807'}</span>}
                    <span style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.text, flex: 1 }}>{w.title}</span>
                    {editMode && <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 16, lineHeight: 1 }} onClick={() => setPWidgets(pw => pw.map(ww => ww.id === w.id ? { ...ww, visible: false } : ww))}>&times;</span>}
                  </div>
                  <div style={{ padding: 10, overflow: 'auto', flex: 1, fontSize: 12 }}>
                    {renderWidget(w.id)}
                  </div>
                </div>
              ))
            })()}
          </ResponsiveGridLayout>
        </div>
      </div>
    </div>
  )
}
