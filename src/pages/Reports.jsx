import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle, EmptyState } from '../components/Shared'
import { Navigate } from 'react-router-dom'
import { TABLES } from '../lib/widgetSchema'
import { evalFormula } from '../lib/widgetQuery'

const CATEGORY_COLORS = { performance: T.primary, pipeline: T.success, forecast: T.warning, quality: '#8b5cf6', coaching: '#e67e22', custom: T.textMuted }

const OPERATORS = [
  { key: 'eq', label: '=' },
  { key: 'neq', label: '≠' },
  { key: 'gt', label: '>' },
  { key: 'gte', label: '≥' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '≤' },
  { key: 'like', label: 'contains' },
  { key: 'is_null', label: 'is empty' },
  { key: 'not_null', label: 'is set' },
  { key: 'in', label: 'in list (,)' },
]

const AGGREGATES = [
  { key: 'none', label: 'Row list' },
  { key: 'count', label: 'Count rows' },
  { key: 'sum', label: 'Sum of field' },
  { key: 'avg', label: 'Average of field' },
  { key: 'min', label: 'Min of field' },
  { key: 'max', label: 'Max of field' },
  { key: 'group_by', label: 'Group by field' },
]

function emptyConfig() {
  return {
    base_entity: 'deals',
    fields: [],                // ['field_name'] or {formula, label, key}
    filter_groups: [{ logic: 'and', conditions: [] }],
    cross_filters: [],         // [{ type: 'in'|'not_in', report_id, local_field, remote_field }]
    order_by: null, order_dir: 'desc', limit: 500,
    aggregate: { type: 'none', field: null, group_by: null, group_aggs: [] },
  }
}

// Back-compat: migrate legacy `filters: [...]` to a single AND filter group
function migrateConfig(cfg) {
  if (!cfg) return emptyConfig()
  const out = { ...emptyConfig(), ...cfg }
  if (Array.isArray(cfg.filters) && (!cfg.filter_groups || !cfg.filter_groups.length)) {
    out.filter_groups = [{ logic: 'and', conditions: cfg.filters }]
  }
  if (!out.filter_groups?.length) out.filter_groups = [{ logic: 'and', conditions: [] }]
  if (!out.cross_filters) out.cross_filters = []
  if (!out.aggregate) out.aggregate = { type: 'none', field: null }
  return out
}

// Apply a single PostgREST filter to the supabase query builder.
function applyFilter(q, f) {
  if (!f.field || !f.operator) return q
  const v = f.value
  switch (f.operator) {
    case 'eq': return q.eq(f.field, v)
    case 'neq': return q.neq(f.field, v)
    case 'gt': return q.gt(f.field, v)
    case 'gte': return q.gte(f.field, v)
    case 'lt': return q.lt(f.field, v)
    case 'lte': return q.lte(f.field, v)
    case 'like': return q.ilike(f.field, `%${v}%`)
    case 'is_null': return q.is(f.field, null)
    case 'not_null': return q.not(f.field, 'is', null)
    case 'in': return q.in(f.field, String(v).split(',').map(s => s.trim()).filter(Boolean))
    default: return q
  }
}

// Turn a condition into a PostgREST `or` expression fragment.
function filterToPgrest(f) {
  if (!f.field || !f.operator) return null
  const v = f.value
  switch (f.operator) {
    case 'eq': return `${f.field}.eq.${v}`
    case 'neq': return `${f.field}.neq.${v}`
    case 'gt': return `${f.field}.gt.${v}`
    case 'gte': return `${f.field}.gte.${v}`
    case 'lt': return `${f.field}.lt.${v}`
    case 'lte': return `${f.field}.lte.${v}`
    case 'like': return `${f.field}.ilike.*${v}*`
    case 'is_null': return `${f.field}.is.null`
    case 'not_null': return `${f.field}.not.is.null`
    case 'in': return `${f.field}.in.(${String(v).split(',').map(s => s.trim()).filter(Boolean).join(',')})`
    default: return null
  }
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
  const [mode, setMode] = useState('list')
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
    const cfg = migrateConfig(r.query_config)
    setForm({ name: r.name || '', description: r.description || '', category: r.category || 'custom', config: cfg })
    setMode('build')
  }

  async function saveReport() {
    if (!form.name.trim()) return
    setSaving(true)
    const record = {
      org_id: profile?.org_id, created_by: profile?.id,
      name: form.name.trim(), description: form.description || null,
      category: form.category || 'custom',
      base_entity: form.config.base_entity,
      query_config: form.config, is_prebuilt: false,
    }
    const result = editingId
      ? await supabase.from('saved_reports').update(record).eq('id', editingId).select().single()
      : await supabase.from('saved_reports').insert(record).select().single()
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

  // Run a saved report's query and return { columns, rows, data } — used standalone and as cross-filter source.
  async function executeReportQuery(report) {
    const cfg = migrateConfig(report.query_config)
    const base = cfg.base_entity || report.base_entity || 'deals'
    // Raw non-formula field names for the select clause
    const rawFields = (cfg.fields || []).filter(f => typeof f === 'string')
    const formulaFields = (cfg.fields || []).filter(f => typeof f === 'object' && f?.formula)
    const selectFields = rawFields.length ? rawFields : Object.keys(TABLES[base]?.fields || {}).slice(0, 8)

    // Evaluate cross-filters first — collect allow/deny id sets
    const allowSets = []
    const denySets = []
    for (const cf of (cfg.cross_filters || [])) {
      if (!cf.report_id || !cf.local_field) continue
      const { data: sourceRep } = await supabase.from('saved_reports').select('*').eq('id', cf.report_id).single()
      if (!sourceRep) continue
      const { rows: sourceRows } = await executeReportQuery(sourceRep)
      const remote = cf.remote_field || cf.local_field
      const ids = (sourceRows || []).map(r => r[remote]).filter(v => v != null)
      if (cf.type === 'not_in') denySets.push({ field: cf.local_field, ids })
      else allowSets.push({ field: cf.local_field, ids })
    }

    const select = selectFields.join(', ') || '*'
    let q = supabase.from(base).select(select)

    // Apply cross-filter constraints
    for (const a of allowSets) q = a.ids.length ? q.in(a.field, a.ids) : q.eq(a.field, '__no_match__')
    for (const d of denySets) if (d.ids.length) q = q.not(d.field, 'in', `(${d.ids.join(',')})`)

    // Apply filter groups
    for (const grp of (cfg.filter_groups || [])) {
      const conds = grp.conditions || []
      if (!conds.length) continue
      if ((grp.logic || 'and') === 'or') {
        const parts = conds.map(filterToPgrest).filter(Boolean)
        if (parts.length) q = q.or(parts.join(','))
      } else {
        for (const f of conds) q = applyFilter(q, f)
      }
    }

    if (cfg.order_by) q = q.order(cfg.order_by, { ascending: cfg.order_dir === 'asc' })
    q = q.limit(Math.min(Math.max(Number(cfg.limit) || 500, 1), 5000))

    const { data, error } = await q
    if (error) throw error

    // Evaluate formula columns per row
    const rows = (data || []).map(row => {
      const out = { ...row }
      for (const ff of formulaFields) {
        out[ff.key || ff.label] = evalFormula(ff.formula, row)
      }
      return out
    })

    // Apply aggregate
    const agg = cfg.aggregate || { type: 'none' }
    if (agg.type === 'count') {
      return { columns: ['count'], rows: [{ count: rows.length }], aggregate: true, data: rows }
    }
    if ((agg.type === 'sum' || agg.type === 'avg' || agg.type === 'min' || agg.type === 'max') && agg.field) {
      const vals = rows.map(r => Number(r[agg.field])).filter(n => !isNaN(n))
      const v = agg.type === 'sum' ? vals.reduce((s, n) => s + n, 0)
              : agg.type === 'avg' ? (vals.length ? vals.reduce((s, n) => s + n, 0) / vals.length : 0)
              : agg.type === 'min' ? (vals.length ? Math.min(...vals) : 0)
              : (vals.length ? Math.max(...vals) : 0)
      const key = `${agg.field}_${agg.type}`
      return { columns: [key], rows: [{ [key]: agg.type === 'avg' ? Math.round(v * 100) / 100 : v }], aggregate: true, data: rows }
    }
    if (agg.type === 'group_by' && agg.group_by) {
      const groups = new Map()
      for (const r of rows) {
        const k = r[agg.group_by] ?? '(null)'
        if (!groups.has(k)) groups.set(k, [])
        groups.get(k).push(r)
      }
      const aggList = Array.isArray(agg.group_aggs) && agg.group_aggs.length ? agg.group_aggs : [{ type: 'count' }]
      const groupRows = [...groups.entries()].map(([k, items]) => {
        const out = { [agg.group_by]: k, count: items.length }
        for (const a of aggList) {
          if (!a.field) continue
          const vals = items.map(r => Number(r[a.field])).filter(n => !isNaN(n))
          const key = `${a.type}_${a.field}`
          out[key] = a.type === 'sum' ? vals.reduce((s, n) => s + n, 0)
                   : a.type === 'avg' ? (vals.length ? Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 100) / 100 : 0)
                   : a.type === 'min' ? (vals.length ? Math.min(...vals) : 0)
                   : a.type === 'max' ? (vals.length ? Math.max(...vals) : 0)
                   : items.length
        }
        return out
      })
      const columns = [agg.group_by, 'count', ...aggList.filter(a => a.field).map(a => `${a.type}_${a.field}`)]
      return { columns, rows: groupRows.sort((a, b) => (b.count || 0) - (a.count || 0)), aggregate: true, data: rows }
    }
    // Raw row list — columns = selectFields + formula keys
    const columns = [...selectFields, ...formulaFields.map(f => f.key || f.label)]
    return { columns, rows, aggregate: false, data: rows }
  }

  async function runReport(report) {
    setMode('run')
    setSelectedReport(report)
    setRunningReport(true)
    setReportData(null)
    setRunError(null)
    try {
      const result = await executeReportQuery(report)
      setReportData(result)
    } catch (err) {
      console.error('Report run failed:', err)
      setRunError(err?.message || String(err))
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
      <div style={{ padding: '12px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Reports</h2>
        {mode === 'list' && <Button primary onClick={startNew}>+ Build Report</Button>}
        {mode !== 'list' && <Button onClick={() => { setMode('list'); setSelectedReport(null); setReportData(null); setRunError(null) }}>&larr; Back to reports</Button>}
      </div>

      <div style={{ padding: '16px 24px' }}>
        {mode === 'list' && <ListView reports={reports} filtered={filtered} categories={categories} filter={filter} setFilter={setFilter} runReport={runReport} startEdit={startEdit} deleteReport={deleteReport} startNew={startNew} />}

        {mode === 'build' && (
          <BuildView
            form={form}
            setForm={setForm}
            editingId={editingId}
            baseFields={baseFields}
            reports={reports}
            saving={saving}
            saveReport={saveReport}
            cancel={() => setMode('list')}
            previewReport={() => runReport({ ...form, query_config: form.config, base_entity: form.config.base_entity })}
          />
        )}

        {mode === 'run' && (
          <RunView selectedReport={selectedReport} reportData={reportData} runningReport={runningReport} runError={runError} exportCsv={exportCsv} startEdit={startEdit} />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function ListView({ reports, filtered, categories, filter, setFilter, runReport, startEdit, deleteReport, startNew }) {
  return (
    <>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === 'all' ? T.primary : T.surfaceAlt, color: filter === 'all' ? '#fff' : T.textMuted }}>All ({reports.length})</button>
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ padding: '4px 12px', fontSize: 11, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font, background: filter === c ? (CATEGORY_COLORS[c] || T.primary) : T.surfaceAlt, color: filter === c ? '#fff' : T.textMuted }}>{c}</button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="≡" title="No reports yet" message="Build your first report — slice and dice deals, conversations, tasks, contacts, anything. Combine filters with AND/OR, add calculated columns, cross-reference other reports."
          action={<Button primary onClick={startNew}>+ Build Report</Button>} />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {filtered.map(r => {
            const cfg = r.query_config || {}
            const filterCount = (cfg.filter_groups || []).reduce((s, g) => s + (g.conditions?.length || 0), 0) + (cfg.filters?.length || 0)
            return (
              <Card key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    {r.is_prebuilt && <Badge color={T.textMuted}>Prebuilt</Badge>}
                    {r.category && <Badge color={CATEGORY_COLORS[r.category] || T.primary}>{r.category}</Badge>}
                  </div>
                </div>
                {r.description && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, lineHeight: 1.5 }}>{r.description}</div>}
                <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 8, fontFamily: T.mono }}>
                  {r.base_entity || 'deals'}
                  {cfg.fields?.length ? ` · ${cfg.fields.length} fields` : ''}
                  {filterCount ? ` · ${filterCount} filters` : ''}
                  {cfg.cross_filters?.length ? ` · ${cfg.cross_filters.length} x-refs` : ''}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button primary onClick={() => runReport(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Run</Button>
                  {!r.is_prebuilt && <Button onClick={() => startEdit(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>}
                  {!r.is_prebuilt && <Button onClick={() => deleteReport(r.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>}
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </>
  )
}

// ────────────────────────────────────────────────────────
function BuildView({ form, setForm, editingId, baseFields, reports, saving, saveReport, cancel, previewReport }) {
  const cfg = form.config
  const setCfg = (patch) => setForm(p => ({ ...p, config: { ...p.config, ...patch } }))

  function updateGroup(gi, patch) {
    setCfg({ filter_groups: cfg.filter_groups.map((g, i) => i === gi ? { ...g, ...patch } : g) })
  }
  function addCondition(gi) {
    updateGroup(gi, { conditions: [...(cfg.filter_groups[gi].conditions || []), { field: '', operator: 'eq', value: '' }] })
  }
  function updateCondition(gi, ci, patch) {
    updateGroup(gi, { conditions: cfg.filter_groups[gi].conditions.map((c, i) => i === ci ? { ...c, ...patch } : c) })
  }
  function removeCondition(gi, ci) {
    updateGroup(gi, { conditions: cfg.filter_groups[gi].conditions.filter((_, i) => i !== ci) })
  }
  function addGroup() {
    setCfg({ filter_groups: [...cfg.filter_groups, { logic: 'or', conditions: [] }] })
  }
  function removeGroup(gi) {
    setCfg({ filter_groups: cfg.filter_groups.filter((_, i) => i !== gi) })
  }

  function addFormulaField() {
    const key = `calc_${Math.random().toString(36).slice(2, 6)}`
    setCfg({ fields: [...cfg.fields, { key, label: 'Calculated', formula: '' }] })
  }
  function updateField(idx, patch) {
    setCfg({ fields: cfg.fields.map((f, i) => i === idx ? (typeof f === 'string' ? f : { ...f, ...patch }) : f) })
  }
  function removeField(idx) {
    setCfg({ fields: cfg.fields.filter((_, i) => i !== idx) })
  }

  function addCrossFilter() {
    setCfg({ cross_filters: [...(cfg.cross_filters || []), { type: 'in', report_id: '', local_field: 'id', remote_field: 'id' }] })
  }
  function updateCrossFilter(idx, patch) {
    setCfg({ cross_filters: cfg.cross_filters.map((c, i) => i === idx ? { ...c, ...patch } : c) })
  }
  function removeCrossFilter(idx) {
    setCfg({ cross_filters: cfg.cross_filters.filter((_, i) => i !== idx) })
  }

  const formulaFields = cfg.fields.filter(f => typeof f === 'object')
  const rawSelected = cfg.fields.filter(f => typeof f === 'string')

  return (
    <div>
      <Card title={editingId ? 'Edit Report' : 'New Report'} action={
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={cancel} style={{ padding: '4px 12px', fontSize: 11 }}>Cancel</Button>
          <Button primary onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '4px 12px', fontSize: 11 }}>{saving ? 'Saving...' : 'Save Report'}</Button>
        </div>
      }>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Open deals over $50k" autoFocus /></div>
          <div>
            <label style={labelStyle}>Category</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
              {['performance', 'pipeline', 'forecast', 'quality', 'coaching', 'custom'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Base Table</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.base_entity}
              onChange={e => setCfg({ base_entity: e.target.value, fields: [], order_by: null, aggregate: { type: 'none' } })}>
              {Object.entries(TABLES).map(([key, val]) => <option key={key} value={key}>{val.label || key}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>Description</label>
          <input style={inputStyle} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What this report answers..." />
        </div>
      </Card>

      <Card title="Fields" action={<Button onClick={addFormulaField} style={{ padding: '3px 10px', fontSize: 11 }}>+ Calculated column</Button>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6, marginBottom: formulaFields.length > 0 ? 10 : 0 }}>
          {Object.entries(baseFields).map(([key, meta]) => {
            const checked = rawSelected.includes(key)
            return (
              <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: T.text, cursor: 'pointer', padding: '4px 8px', background: checked ? T.primaryLight : T.surfaceAlt, borderRadius: 4, border: `1px solid ${checked ? T.primary + '55' : T.borderLight}` }}>
                <input type="checkbox" checked={checked} onChange={() => {
                  const next = checked ? cfg.fields.filter(f => f !== key) : [...cfg.fields, key]
                  setCfg({ fields: next })
                }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta.label || key}</span>
                <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{meta.type}</span>
              </label>
            )
          })}
        </div>
        {formulaFields.length > 0 && (
          <div style={{ paddingTop: 10, borderTop: `1px solid ${T.borderLight}` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', marginBottom: 6 }}>Calculated columns</div>
            {cfg.fields.map((f, i) => typeof f === 'object' ? (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 3fr auto', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Label" />
                <input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} value={f.formula} onChange={e => updateField(i, { formula: e.target.value })} placeholder="e.g. (fit_score + deal_health_score) / 2" />
                <button onClick={() => removeField(i)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 14, cursor: 'pointer' }}>×</button>
              </div>
            ) : null)}
            <div style={{ fontSize: 10, color: T.textMuted }}>
              Use field names + arithmetic: <code>+ − × ÷ ( )</code>. Safe numeric-only eval.
            </div>
          </div>
        )}
      </Card>

      <Card title="Filters" action={<Button onClick={addGroup} style={{ padding: '3px 10px', fontSize: 11 }}>+ Filter group (OR)</Button>}>
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>Conditions inside a group combine with AND or OR. Groups always AND together — classic <code>A AND (B OR C)</code>.</div>
        {cfg.filter_groups.map((grp, gi) => (
          <div key={gi} style={{ border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: 10, marginBottom: 8, background: T.surfaceAlt }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Group {gi + 1}</span>
                <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden', marginLeft: 6 }}>
                  {['and', 'or'].map(l => (
                    <button key={l} onClick={() => updateGroup(gi, { logic: l })}
                      style={{ padding: '2px 10px', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', background: (grp.logic || 'and') === l ? T.primary : T.surface, color: (grp.logic || 'and') === l ? '#fff' : T.textMuted, textTransform: 'uppercase' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button onClick={() => addCondition(gi)} style={{ padding: '3px 10px', fontSize: 10 }}>+ Condition</Button>
                {cfg.filter_groups.length > 1 && <Button onClick={() => removeGroup(gi)} style={{ padding: '3px 10px', fontSize: 10, color: T.error }}>Remove group</Button>}
              </div>
            </div>
            {(grp.conditions || []).length === 0 ? (
              <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: 4 }}>No conditions yet.</div>
            ) : grp.conditions.map((f, ci) => (
              <div key={ci} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 2fr auto', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }} value={f.field} onChange={e => updateCondition(gi, ci, { field: e.target.value })}>
                  <option value="">— field —</option>
                  {Object.entries(baseFields).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
                </select>
                <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }} value={f.operator} onChange={e => updateCondition(gi, ci, { operator: e.target.value })}>
                  {OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
                </select>
                {['is_null', 'not_null'].includes(f.operator) ? (
                  <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: '4px 8px' }}>(no value)</span>
                ) : (
                  <input style={{ ...inputStyle, padding: '3px 8px', fontSize: 12 }} value={f.value ?? ''} onChange={e => updateCondition(gi, ci, { value: e.target.value })} placeholder="value" />
                )}
                <button onClick={() => removeCondition(gi, ci)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 14, cursor: 'pointer' }}>×</button>
              </div>
            ))}
          </div>
        ))}
      </Card>

      <Card title="Cross-reference other reports" action={<Button onClick={addCrossFilter} style={{ padding: '3px 10px', fontSize: 11 }}>+ Cross-ref</Button>}>
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>Pull rows from another report and require <code>id</code> (or any field) to appear (or NOT appear) in it.</div>
        {(cfg.cross_filters || []).length === 0 ? (
          <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>No cross-references.</div>
        ) : (
          cfg.cross_filters.map((cf, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr 1fr auto', gap: 6, alignItems: 'center', marginBottom: 6 }}>
              <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }} value={cf.type} onChange={e => updateCrossFilter(i, { type: e.target.value })}>
                <option value="in">id IN report</option>
                <option value="not_in">id NOT in report</option>
              </select>
              <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 12, cursor: 'pointer' }} value={cf.report_id} onChange={e => updateCrossFilter(i, { report_id: e.target.value })}>
                <option value="">— pick report —</option>
                {reports.filter(r => r.id !== editingId).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <input style={{ ...inputStyle, padding: '3px 8px', fontSize: 12 }} value={cf.local_field} onChange={e => updateCrossFilter(i, { local_field: e.target.value })} placeholder="local field (e.g. id)" />
              <input style={{ ...inputStyle, padding: '3px 8px', fontSize: 12 }} value={cf.remote_field} onChange={e => updateCrossFilter(i, { remote_field: e.target.value })} placeholder="remote field (e.g. id)" />
              <button onClick={() => removeCrossFilter(i)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 14, cursor: 'pointer' }}>×</button>
            </div>
          ))
        )}
      </Card>

      <Card title="Sort, Limit, Aggregate">
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 10, marginBottom: 10 }}>
          <div>
            <label style={labelStyle}>Sort by</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.order_by || ''} onChange={e => setCfg({ order_by: e.target.value || null })}>
              <option value="">(none)</option>
              {Object.entries(baseFields).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Direction</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.order_dir} onChange={e => setCfg({ order_dir: e.target.value })}>
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>Row limit</label>
            <input type="number" style={inputStyle} value={cfg.limit} onChange={e => setCfg({ limit: Number(e.target.value) || 500 })} min={1} max={5000} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>Output</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.aggregate.type} onChange={e => setCfg({ aggregate: { ...cfg.aggregate, type: e.target.value } })}>
              {AGGREGATES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          {['sum', 'avg', 'min', 'max'].includes(cfg.aggregate.type) && (
            <div>
              <label style={labelStyle}>Field to {cfg.aggregate.type}</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.aggregate.field || ''} onChange={e => setCfg({ aggregate: { ...cfg.aggregate, field: e.target.value || null } })}>
                <option value="">— pick numeric field —</option>
                {Object.entries(baseFields).filter(([, m]) => ['number', 'currency', 'score', 'percentage'].includes(m.type)).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
              </select>
            </div>
          )}
          {cfg.aggregate.type === 'group_by' && (
            <div>
              <label style={labelStyle}>Group by field</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={cfg.aggregate.group_by || ''} onChange={e => setCfg({ aggregate: { ...cfg.aggregate, group_by: e.target.value || null } })}>
                <option value="">— pick field —</option>
                {Object.entries(baseFields).map(([key, meta]) => <option key={key} value={key}>{meta.label || key}</option>)}
              </select>
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <Button onClick={previewReport} style={{ padding: '6px 14px', fontSize: 12 }}>Preview Results</Button>
        <Button primary onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '6px 14px', fontSize: 12 }}>{saving ? 'Saving...' : 'Save Report'}</Button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function RunView({ selectedReport, reportData, runningReport, runError, exportCsv, startEdit }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
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
                      const disp = val == null ? '—' : typeof val === 'object' ? JSON.stringify(val).substring(0, 80) : String(val).substring(0, 120)
                      return <td key={c} style={{ padding: '6px 8px', color: T.text, fontFeatureSettings: '"tnum"' }}>{disp}</td>
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
  )
}
