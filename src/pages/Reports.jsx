import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { theme as T, formatCurrency } from '../lib/theme'
import { Card, Badge, Button, Spinner, TabBar } from '../components/Shared'
import { Navigate } from 'react-router-dom'

const CATEGORY_COLORS = { performance: T.primary, pipeline: T.success, forecast: T.warning, quality: '#8b5cf6', coaching: '#e67e22' }

export default function Reports() {
  const { profile } = useAuth()
  const { hasModule, loading: modulesLoading } = useModules()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [runningReport, setRunningReport] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => { loadReports() }, [])

  if (modulesLoading) return <Spinner />
  if (!hasModule('reports')) return <Navigate to="/" replace />

  async function loadReports() {
    setLoading(true)
    const { data } = await supabase.from('saved_reports').select('*').order('sort_order').order('created_at', { ascending: false })
    setReports(data || [])
    setLoading(false)
  }

  async function runReport(report) {
    setSelectedReport(report)
    setRunningReport(true)
    setReportData(null)

    // Execute report based on base_entity
    let data = null
    const base = report.config?.base_entity || report.base_entity || 'deals'

    if (base === 'deals') {
      const { data: deals } = await supabase.from('deals').select('*, company_profile(industry, revenue, employee_count), deal_analysis(champion, economic_buyer, budget)')
      data = { rows: deals || [], columns: ['company_name', 'stage', 'deal_value', 'target_close_date', 'fit_score', 'deal_health_score'] }
    } else if (base === 'conversations') {
      const { data: convs } = await supabase.from('conversations').select('*, deals(company_name)').eq('processed', true).order('call_date', { ascending: false }).limit(100)
      data = { rows: convs || [], columns: ['title', 'call_type', 'call_date', 'deals.company_name'] }
    } else if (base === 'ai_response_log') {
      const { data: logs } = await supabase.from('ai_response_log').select('*').order('created_at', { ascending: false }).limit(200)
      data = { rows: logs || [], columns: ['response_type', 'status', 'processing_time_ms', 'prompt_tokens', 'completion_tokens', 'created_at'] }
    } else if (base === 'profiles') {
      const { data: profiles } = await supabase.from('profiles').select('*, organizations(name)').order('created_at', { ascending: false })
      data = { rows: profiles || [], columns: ['full_name', 'email', 'role', 'organizations.name', 'created_at'] }
    } else {
      const { data: rows } = await supabase.from(base).select('*').limit(200)
      data = { rows: rows || [], columns: Object.keys((rows || [])[0] || {}).slice(0, 8) }
    }

    setReportData(data)
    setRunningReport(false)
  }

  const filtered = filter === 'all' ? reports : reports.filter(r => r.category === filter)
  const categories = [...new Set(reports.map(r => r.category).filter(Boolean))]

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Reports</h2>
      </div>

      <div style={{ padding: '16px 24px' }}>
        {/* Category filters */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          <button onClick={() => setFilter('all')} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === 'all' ? T.primary : T.surfaceAlt, color: filter === 'all' ? '#fff' : T.textMuted }}>All</button>
          {categories.map(c => (
            <button key={c} onClick={() => setFilter(c)} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === c ? (CATEGORY_COLORS[c] || T.primary) : T.surfaceAlt, color: filter === c ? '#fff' : T.textMuted }}>{c}</button>
          ))}
        </div>

        {/* Report cards */}
        {!selectedReport ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {filtered.map(r => (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{r.name}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {r.is_prebuilt && <Badge color={T.textMuted}>Prebuilt</Badge>}
                    {r.category && <Badge color={CATEGORY_COLORS[r.category] || T.primary}>{r.category}</Badge>}
                  </div>
                </div>
                {r.description && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>{r.description}</div>}
                <Button primary onClick={() => runReport(r)} style={{ padding: '5px 14px', fontSize: 11 }}>Run Report</Button>
              </Card>
            ))}
          </div>
        ) : (
          /* Report results view */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <button onClick={() => { setSelectedReport(null); setReportData(null) }} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>{selectedReport.name}</h3>
              {selectedReport.category && <Badge color={CATEGORY_COLORS[selectedReport.category] || T.primary}>{selectedReport.category}</Badge>}
            </div>

            {runningReport ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spinner /><div style={{ fontSize: 13, color: T.textMuted, marginTop: 8 }}>Running report...</div></div>
            ) : reportData ? (
              <Card>
                <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>{reportData.rows.length} rows</div>
                <div style={{ overflow: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                        {reportData.columns.map(c => (
                          <th key={c} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase' }}>{c.replace(/_/g, ' ')}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.rows.slice(0, 100).map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                          {reportData.columns.map(c => {
                            const parts = c.split('.')
                            const val = parts.length > 1 ? row[parts[0]]?.[parts[1]] : row[c]
                            return <td key={c} style={{ padding: '6px 8px', color: T.text }}>{val != null ? String(val).substring(0, 80) : '--'}</td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
