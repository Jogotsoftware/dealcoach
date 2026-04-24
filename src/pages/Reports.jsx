import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'
import { Navigate } from 'react-router-dom'
import { TABLES } from '../lib/widgetSchema'

const CATEGORY_COLORS = { performance: T.primary, pipeline: T.success, forecast: T.warning, quality: '#8b5cf6', coaching: '#e67e22', custom: T.textMuted }

const OPERATORS = [
  { key: 'eq', label: '=' },
  { key: 'neq', label: '!=' },
  { key: 'gt', label: '>' },
  { key: 'gte', label: '>=' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '<=' },
  { key: 'like', label: 'contains' },
  { key: 'is_null', label: 'is empty' },
  { key: 'not_null', label: 'is set' },
]

const AGGREGATES = [
  { key: 'none', label: 'Row list' },
  { key: 'count', label: 'Count rows' },
  { key: 'sum', label: 'Sum of field' },
  { key: 'avg', label: 'Average of field' },
]

function emptyConfig() {
  return { base_entity: 'deals', fields: [], filters: [], order_by: null, order_dir: 'desc', limit: 500, aggregate: { type: 'none', field: null } }
}

export default function Reports() {
  const { profile } = useAuth()
  const { hasModule, loading: modulesLoading } = useModules()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedReport, setSelectedReport] = useState(null)
  const [reportData, setReportData] = useState(null)
  const [runningReport, setRunningReport] = useState(false)
  const [filter, setFilter] = useState('all')
  const [mode, setMode] = useState('list') // list | build | run
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', description: '', category: 'custom', config: emptyConfig() })
  const [saving, setSaving] = useState(false)
  const [runError, setRunError] = useState(null)

  useEffect(() => { loadReports() }, [])

  if (modulesLoading) return <Spinner />
  if (!hasModule('reports')) return <Navigate to="/" replace />

  async function loadReports() {
    setLoading(true)
    const { data } = await supabase.from('saved_reports').select('*').order('sort_order', { nullsFirst: false }).order('created_at', { ascending: false })
    setReports(data || [])
    setLoading(false)
  }

  function startNew() {
    setEditingId(null)
    setForm({ name: '', description: '', category: 'custom', config: emptyConfig() })
    setMode('build')
  }

  function startEdit(r) {
    setEditingId(r.id)
    const cfg = r.query_config || {}
    setForm({
      name: r.name || '',
      description: r.description || '',
      category: r.category || 'custom',
      config: {
        base_entity: cfg.base_entity || r.base_entity || 'deals',
        fields: Array.isArray(cfg.fields) ? cfg.fields : [],
        filters: Array.isArray(cfg.filters) ? cfg.filters : [],
        order_by: cfg.order_by || null,
        order_dir: cfg.order_dir || 'desc',
        limit: cfg.limit || 500,
        aggregate: cfg.aggregate || { type: 'none', field: null },
      },
    })
    setMode('build')
  }

  async function saveReport() {
    if (!form.name.trim()) return
    setSaving(true)
    const record = {
      org_id: profile?.org_id,
      created_by: profile?.id,
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || 'custom',
      base_entity: form.config.base_entity,
      query_config: form.config,
      is_prebuilt: false,
    }
    let result
    if (editingId) {
      result = await supabase.from('saved_reports').update(record).eq('id', editingId).select().single()
    } else {
      result = await supabase.from('saved_reports').insert(record).select().single()
    }
    setSaving(false)
    if (result.error) { alert('Save failed: ' + result.error.message); return }
    await loadReports()
    setMode('list')
  }

  async function deleteReport(id) {
    if (!window.confirm('Delete this report?')) return
    await supabase.from('saved_reports').delete().eq('id', id)
    loadReports()
  }

  async function runReport(report) {
    setMode('run')
    setSelectedReport(report)
    setRunningReport(true)
    setReportData(null)
    setRunError(null)

    const cfg = report.query_config || {}
    const base = cfg.base_entity || report.base_entity || 'deals'
    const fields = Array.isArray(cfg.fields) && cfg.fields.length ? cfg.fields : Object.keys(TABLES[base]?.fields || { id: {} }).slice(0, 8)
    const filters = Array.isArray(cfg.filters) ? cfg.filters : []
    const aggregate = cfg.aggregate || { type: 'none' }

    try {
      const select = (aggregate.type === 'count') ? 'id' : fields.join(', ') || '*'
      let q = supabase.from(base).select(select, aggregate.type === 'count' ? { count: 'exact' } : {})
      for (const f of filters) {
        if (!f.field || !f.operator) continue
        if (f.operator === 'is_null') q = q.is(f.field, null)
        else if (f.operator === 'not_null') q = q.not(f.field, 'is', null)
        else if (f.operator === 'like') q = q.ilike(f.field, `%${f.value}%`)
        else if (f.operator === 'eq') q = q.eq(f.field, f.value)
        else if (f.operator === 'neq') q = q.neq(f.field, f.value)
        else if (f.operator === 'gt') q = q.gt(f.field, f.value)
        else if (f.operator === 'gte') q = q.gte(f.field, f.value)
        else if (f.operator === 'lt') q = q.lt(f.field, f.value)
        else if (f.operator === 'lte') q = q.lte(f.field, f.value)
      }
      if (cfg.order_by) q = q.order(cfg.order_by, { ascending: cfg.order_dir === 'asc' })
      q = q.limit(Math.min(Math.max(Number(cfg.limit) || 500, 1), 5000))
      const { data, error, count } = await q
      if (error) throw error

      if (aggregate.type === 'count') {
        setReportData({ columns: ['count'], rows: [{ count: count ?? (data || []).length }], aggregate: true })
      } else if (aggregate.type === 'sum' && aggregate.field) {
        const total = (data || []).reduce((s, r) => s + (Number(r[aggregate.field]) || 0), 0)
        setReportData({ columns: [aggregate.field + '_sum'], rows: [{ [aggregate.field + '_sum']: total }], aggregate: true })
      } else if (aggregate.type === 'avg' && aggregate.field) {
        const vals = (data || []).map(r => Number(r[aggregate.field])).filter(n => !isNaN(n))
        const avg = vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : 0
        setReportData({ columns: [aggregate.field + '_avg'], rows: [{ [aggregate.field + '_avg']: Math.round(avg * 100) / 100 }], aggregate: true })
      } else {
        setReportData({ columns: fields, rows: data || [], aggregate: false })
      }
    } catch (err) {
      console.error('Report run failed:', err)
      setRunError(err.message || 'Report failed to run')
    } finally {
      setRunningReport(false)
    }
  }

  function exportCsv() {
    if (!reportData) return
    const lines = [reportData.columns.join(',')]
    for (const row of reportData.rows) {
      lines.push(reportData.columns.map(c => {
        const v = row[c]
        if (v == null) return ''
        const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${selectedReport?.name || 'report'}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  const filtered = filter === 'all' ? reports : reports.filter(r => r.category === filter)
  const categories = [...new Set(reports.map(r => r.category).filter(Boolean))]
  const baseFields = TABLES[form.config.base_entity]?.fields || {}

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Reports</h2>
        {mode === 'list' && <Button primary onClick={startNew}>+ Build Report</Button>}
        {mode !== 'list' && <Button onClick={() => { setMode('list'); setSelectedReport(null); setReportData(null); setRunError(null) }}>&larr; Back to reports</Button>}
      </div>

      <div style={{ padding: '16px 24px' }}>
        {mode === 'list' && (
          <>
            <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
              <button onClick={() => setFilter('all')} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === 'all' ? T.primary : T.surfaceAlt, color: filter === 'all' ? '#fff' : T.textMuted }}>All ({reports.length})</button>
              {categories.map(c => (
                <button key={c} onClick={() => setFilter(c)} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === c ? (CATEGORY_COLORS[c] || T.primary) : T.surfaceAlt, color: filter === c ? '#fff' : T.textMuted }}>{c}</button>
              ))}
            </div>
            {filtered.length === 0 ? (
              <Card>
                <div style={{ textAlign: 'center', padding: 40, color: T.textMuted }}>
                  <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: T.text }}>No reports yet</div>
                  <div style={{ fontSize: 12, marginBottom: 14 }}>Build your first report to slice and dice deals, conversations, tasks, and more.</div>
                  <Button primary onClick={startNew}>+ Build Report</Button>
                </div>
              </Card>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                {filtered.map(r => (
                  <Card key={r.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                      <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                        {r.is_prebuilt && <Badge color={T.textMuted}>Prebuilt</Badge>}
                        {r.category && <Badge color={CATEGORY_COLORS[r.category] || T.primary}>{r.category}</Badge>}
                      </div>
                    </div>
                    {r.description && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10, lineHeight: 1.5 }}>{r.description}</div>}
                    <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 10, fontFamily: T.mono }}>
                      {r.base_entity || 'deals'}
                      {r.query_config?.fields?.length ? ` · ${r.query_config.fields.length} fields` : ''}
                      {r.query_config?.filters?.length ? ` · ${r.query_config.filters.length} filters` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button primary onClick={() => runReport(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Run</Button>
                      {!r.is_prebuilt && <Button onClick={() => startEdit(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>}
                      {!r.is_prebuilt && <Button onClick={() => deleteReport(r.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'build' && (
          <div>
            <Card title={editingId ? 'Edit Report' : 'New Report'} action={
              <div style={{ display: 'flex', gap: 6 }}>
                <Button onClick={() => setMode('list')} style={{ padding: '4px 12px', fontSize: 11 }}>Cancel</Button>
                <Button primary onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '4px 12px', fontSize: 11 }}>{saving ? 'Saving...' : 'Save Report'}</Button>
              </div>
            }>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Open deals over $50k" autoFocus /></div>
                <div>
                  <label style={labelStyle}>Category</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    {['performance', 'pipeline', 'forecast', 'quality', 'coaching', 'custom'].map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Base Table</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.config.base_entity}
                    onChange={e => setForm(p => ({ ...p, config: { ...p.config, base_entity: e.target.value, fields: [], order_by: null, aggregate: { type: 'none', field: null } } }))}>
                    {Object.entries(TABLES).map(([key, val]) => <option key={key} value={key}>{val.label || key}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>Description</label>
                <input style={inputStyle} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What this report answers..." />
              </div>
            </Card>

            <Card title="Fields" action={<div style={{ fontSize: 11, color: T.textMuted }}>Pick columns to include. Leave empty to show all.</div>}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
                {Object.entries(baseFields).map(([key, meta]) => {
                  const checked = form.config.fields.includes(key)
                  return (
                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text, cursor: 'pointer', padding: '4px 8px', background: checked ? T.primaryLight : T.surfaceAlt, borderRadius: 4, border: `1px solid ${checked ? T.primary + '55' : T.borderLight}` }}>
                      <input type="checkbox" checked={checked} onChange={() => setForm(p => {
                        const next = checked ? p.config.fields.filter(f => f !== key) : [...p.config.fields, key]
                        return { ...p, config: { ...p.config, fields: next } }
                      })} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label || key}</span>
                      <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{meta.type}</span>
                    </label>
                  )
                })}
              </div>
            </Card>

            <Card title="Filters" action={<Button onClick={() => setForm(p => ({ ...p, config: { ...p.config, filters: [...p.config.filters, { field: '', operator: 'eq', value: '' }] } }))} style={{ padding: '4px 10px', fontSize: 11 }}>+ Add filter</Button>}>
              {form.config.filters.length === 0 ? (
                <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: 6 }}>No filters. Add one to narrow the results.</div>
              ) : form.config.filters.map((f, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr 2fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                  <select style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} value={f.field} onChange={e => setForm(p => ({ ...p, config: { ...p.config, filters: p.config.filters.map((x, j) => j === i ? { ...x, field: e.target.value } : x) } }))}>
                    <option value="">— pick field —</option>
                    {Object.entries(baseFields).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
                  </select>
                  <select style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} value={f.operator} onChange={e => setForm(p => ({ ...p, config: { ...p.config, filters: p.config.filters.map((x, j) => j === i ? { ...x, operator: e.target.value } : x) } }))}>
                    {OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                  </select>
                  {f.operator === 'is_null' || f.operator === 'not_null' ? (
                    <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>(no value needed)</span>
                  ) : (
                    <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} value={f.value ?? ''} onChange={e => setForm(p => ({ ...p, config: { ...p.config, filters: p.config.filters.map((x, j) => j === i ? { ...x, value: e.target.value } : x) } }))} placeholder="value" />
                  )}
                  <button onClick={() => setForm(p => ({ ...p, config: { ...p.config, filters: p.config.filters.filter((_, j) => j !== i) } }))} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 14, cursor: 'pointer' }}>&times;</button>
                </div>
              ))}
            </Card>

            <Card title="Sort, Limit, Aggregate">
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={labelStyle}>Sort by</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.config.order_by || ''} onChange={e => setForm(p => ({ ...p, config: { ...p.config, order_by: e.target.value || null } }))}>
                    <option value="">(none)</option>
                    {Object.entries(baseFields).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Direction</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.config.order_dir} onChange={e => setForm(p => ({ ...p, config: { ...p.config, order_dir: e.target.value } }))}>
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Row limit</label>
                  <input type="number" style={inputStyle} value={form.config.limit} onChange={e => setForm(p => ({ ...p, config: { ...p.config, limit: Number(e.target.value) || 500 } }))} min={1} max={5000} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
                <div>
                  <label style={labelStyle}>Output</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.config.aggregate.type} onChange={e => setForm(p => ({ ...p, config: { ...p.config, aggregate: { ...p.config.aggregate, type: e.target.value } } }))}>
                    {AGGREGATES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                </div>
                {form.config.aggregate.type === 'sum' || form.config.aggregate.type === 'avg' ? (
                  <div>
                    <label style={labelStyle}>Field to {form.config.aggregate.type}</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.config.aggregate.field || ''} onChange={e => setForm(p => ({ ...p, config: { ...p.config, aggregate: { ...p.config.aggregate, field: e.target.value || null } } }))}>
                      <option value="">— pick numeric field —</option>
                      {Object.entries(baseFields).filter(([, m]) => m.type === 'number' || m.type === 'currency' || m.type === 'score').map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
                    </select>
                  </div>
                ) : null}
              </div>
            </Card>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <Button onClick={() => runReport({ ...form, query_config: form.config, base_entity: form.config.base_entity })} style={{ padding: '6px 14px', fontSize: 12 }}>Preview Results</Button>
              <Button primary onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '6px 14px', fontSize: 12 }}>{saving ? 'Saving...' : 'Save Report'}</Button>
            </div>
          </div>
        )}

        {mode === 'run' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>{selectedReport?.name}</h3>
              {selectedReport?.category && <Badge color={CATEGORY_COLORS[selectedReport.category] || T.primary}>{selectedReport.category}</Badge>}
              <div style={{ flex: 1 }} />
              {reportData && <Button onClick={exportCsv} style={{ padding: '4px 12px', fontSize: 11 }}>Export CSV</Button>}
              {selectedReport?.id && !selectedReport?.is_prebuilt && <Button onClick={() => startEdit(selectedReport)} style={{ padding: '4px 12px', fontSize: 11 }}>Edit</Button>}
            </div>

            {runningReport ? (
              <div style={{ textAlign: 'center', padding: 40 }}><Spinner /><div style={{ fontSize: 13, color: T.textMuted, marginTop: 8 }}>Running report...</div></div>
            ) : runError ? (
              <Card>
                <div style={{ color: T.error, fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Report failed</div>
                <div style={{ color: T.textMuted, fontSize: 12, fontFamily: T.mono }}>{runError}</div>
              </Card>
            ) : reportData ? (
              <Card>
                <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>{reportData.rows.length} {reportData.aggregate ? 'result' : 'row' + (reportData.rows.length === 1 ? '' : 's')}</div>
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
                      {reportData.rows.slice(0, 500).map((row, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                          {reportData.columns.map(c => {
                            const val = row[c]
                            const disp = val == null ? '--' : typeof val === 'object' ? JSON.stringify(val).substring(0, 80) : String(val).substring(0, 120)
                            return <td key={c} style={{ padding: '6px 8px', color: T.text }}>{disp}</td>
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {reportData.rows.length > 500 && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 6, textAlign: 'center' }}>Showing first 500 of {reportData.rows.length} rows. Export CSV for full results.</div>}
              </Card>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
