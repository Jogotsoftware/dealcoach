import React, { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle, EmptyState } from '../components/Shared'
import { Navigate } from 'react-router-dom'
import { TABLES } from '../lib/widgetSchema'
import { evalFormula } from '../lib/widgetQuery'

const CATEGORY_COLORS = { performance: T.primary, pipeline: T.success, forecast: T.warning, quality: '#8b5cf6', coaching: '#e67e22', custom: T.textMuted }

const TYPE_COLORS = {
  text: '#8899aa', number: '#0ea5e9', currency: '#2ecc71', date: '#f59e0b',
  badge: '#8b5cf6', boolean: '#6c757d', score: '#10b981', percentage: '#f97316',
  formula: '#e67e22',
}

const OPERATORS = [
  { key: 'eq', label: 'equals' },
  { key: 'neq', label: 'does not equal' },
  { key: 'gt', label: '>' },
  { key: 'gte', label: '≥' },
  { key: 'lt', label: '<' },
  { key: 'lte', label: '≤' },
  { key: 'like', label: 'contains' },
  { key: 'not_like', label: 'does not contain' },
  { key: 'is_null', label: 'is empty' },
  { key: 'not_null', label: 'is set' },
  { key: 'in', label: 'in list (,)' },
  { key: 'not_in', label: 'not in list (,)' },
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
    // Report shape — 'tabular' (flat), 'summary' (grouped rows), 'matrix' (row x col pivot)
    report_type: 'tabular',
    base_entity: 'deals',
    // Related tables to include in this report type — e.g. ['tasks','contacts'].
    // Only tables listed here surface in the Outline sidebar's "Related objects".
    // Query engine still auto-joins whenever a field references a table.
    included_relations: [],
    // Fields can be: 'field_name' (base table), {join, field, label} (joined table),
    // or {formula, label, key} (calculated column)
    fields: [],
    // Per-column widths keyed by column id — persisted across sessions
    column_widths: {},
    // Flat list of filters (numbered 1, 2, 3…). Logic is expressed via filter_expression.
    filters: [],
    // Filter expression — e.g. "1 AND 2 AND (3 OR 4)". Defaults to AND-of-all.
    filter_expression: '',
    cross_filters: [],         // [{ type, report_id, local_field, remote_field }]
    order_by: null, order_dir: 'desc', limit: 500,
    aggregate: { type: 'none', field: null, group_by: null, group_aggs: [] },
    // Row groups (ordered). Summary = groups[0+]; Matrix = groups[0] rows.
    groups: [],
    // Matrix column-pivot field (single). Only used when report_type = 'matrix'.
    pivot_column: null,
    // Summary/matrix cell aggregate — { type: 'count' | 'sum' | 'avg' | 'min' | 'max', field }
    summary_aggregate: { type: 'count', field: null },
  }
}

// Evaluate a boolean filter expression: "1 AND 2 AND (3 OR 4)" where each number
// refers to a 1-indexed filter. Returns a function (pass: bool[]) => bool.
// If expression is empty, defaults to ALL true (every filter must pass).
function compileFilterExpression(expr, count) {
  if (!expr || !expr.trim()) return (passes) => passes.every(Boolean)
  // Tokenize: numbers, AND, OR, NOT, (, )
  const tokens = expr.match(/\d+|\bAND\b|\bOR\b|\bNOT\b|\(|\)/gi)
  if (!tokens) return () => true
  // Validate — only digits, operators, parens
  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      const n = Number(t)
      if (n < 1 || n > count) throw new Error(`Filter ${n} doesn't exist (you have ${count} filter${count === 1 ? '' : 's'}).`)
    }
  }
  return (passes) => {
    // Translate tokens to JS-safe expression using passes[idx]
    const js = tokens.map(t => {
      if (/^\d+$/.test(t)) return String(Boolean(passes[Number(t) - 1]))
      if (/^AND$/i.test(t)) return '&&'
      if (/^OR$/i.test(t)) return '||'
      if (/^NOT$/i.test(t)) return '!'
      return t
    }).join(' ')
    // Safety: only allow true/false/&&/||/!/()
    if (!/^[\s&|!()truefals]+$/.test(js.replace(/\s/g, ''))) return passes.every(Boolean)
    try { /* eslint-disable no-new-func */ return Function(`"use strict";return (${js})`)() } catch { return passes.every(Boolean) }
  }
}

// Evaluate a single filter condition against a row (client-side).
function evalCondition(row, f, base) {
  const fieldPath = f.join ? [f.join, f.field].join('.') : f.field
  let val
  if (f.join) {
    const j = row[f.join]
    val = Array.isArray(j) ? j[0]?.[f.field] : j?.[f.field]
  } else {
    val = row[f.field]
  }
  const v = f.value
  switch (f.operator) {
    case 'eq': return String(val ?? '') === String(v ?? '')
    case 'neq': return String(val ?? '') !== String(v ?? '')
    case 'gt': return Number(val) > Number(v)
    case 'gte': return Number(val) >= Number(v)
    case 'lt': return Number(val) < Number(v)
    case 'lte': return Number(val) <= Number(v)
    case 'like': return String(val ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'not_like': return !String(val ?? '').toLowerCase().includes(String(v ?? '').toLowerCase())
    case 'is_null': return val == null || val === ''
    case 'not_null': return val != null && val !== ''
    case 'in': return String(v ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(String(val ?? ''))
    case 'not_in': return !String(v ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(String(val ?? ''))
    default: return true
  }
}

// Back-compat: migrate legacy configs (filter_groups / flat filters) to the new shape
// where filters is a flat numbered list + filter_expression holds the boolean logic.
function migrateConfig(cfg) {
  if (!cfg) return emptyConfig()
  const out = { ...emptyConfig(), ...cfg }
  // Merge legacy filter_groups back into a flat filters[] + expression
  if (Array.isArray(cfg.filter_groups) && cfg.filter_groups.length && (!cfg.filters || !cfg.filters.length)) {
    const flat = []
    const parts = []
    for (const g of cfg.filter_groups) {
      const startIdx = flat.length
      for (const c of (g.conditions || [])) flat.push(c)
      const endIdx = flat.length
      if (endIdx === startIdx) continue
      const nums = []
      for (let i = startIdx + 1; i <= endIdx; i++) nums.push(String(i))
      parts.push(nums.length > 1 ? `(${nums.join(' ' + (g.logic || 'AND').toUpperCase() + ' ')})` : nums[0])
    }
    out.filters = flat
    out.filter_expression = parts.join(' AND ')
  }
  if (!Array.isArray(out.filters)) out.filters = []
  if (!out.cross_filters) out.cross_filters = []
  if (!out.aggregate) out.aggregate = { type: 'none', field: null }
  if (!Array.isArray(out.groups)) out.groups = []
  if (!Array.isArray(out.included_relations)) {
    // Infer from existing joined fields + filters so old reports keep working
    const rels = new Set()
    for (const f of (out.fields || [])) if (typeof f === 'object' && f.join) rels.add(f.join)
    for (const f of (out.filters || [])) if (f.join) rels.add(f.join)
    out.included_relations = [...rels]
  }
  delete out.filter_groups
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
    case 'not_like': return q.not(f.field, 'ilike', `%${v}%`)
    case 'is_null': return q.is(f.field, null)
    case 'not_null': return q.not(f.field, 'is', null)
    case 'in': return q.in(f.field, String(v).split(',').map(s => s.trim()).filter(Boolean))
    case 'not_in': {
      const list = String(v).split(',').map(s => s.trim()).filter(Boolean)
      return list.length ? q.not(f.field, 'in', `(${list.join(',')})`) : q
    }
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
    case 'not_like': return `${f.field}.not.ilike.*${v}*`
    case 'is_null': return `${f.field}.is.null`
    case 'not_null': return `${f.field}.not.is.null`
    case 'in': return `${f.field}.in.(${String(v).split(',').map(s => s.trim()).filter(Boolean).join(',')})`
    case 'not_in': return `${f.field}.not.in.(${String(v).split(',').map(s => s.trim()).filter(Boolean).join(',')})`
    default: return null
  }
}

// Execute a saved-report config against the DB. Exported-shape fn (not a hook)
// so BuildView can call it for live preview on debounced config changes.
async function executeReportQueryStandalone(report) {
  const cfg = migrateConfig(report.query_config)
  const base = cfg.base_entity || report.base_entity || 'deals'
  const rawFields = (cfg.fields || []).filter(f => typeof f === 'string')
  const joinedFields = (cfg.fields || []).filter(f => typeof f === 'object' && f?.join && f?.field)
  const formulaFields = (cfg.fields || []).filter(f => typeof f === 'object' && f?.formula)
  const selectFields = rawFields.length ? rawFields : Object.keys(TABLES[base]?.fields || {}).slice(0, 8)

  // Figure out which joined tables we need based on fields + filters
  const joinTables = new Set(joinedFields.map(f => f.join))
  for (const f of (cfg.filters || [])) if (f.join) joinTables.add(f.join)

  const allowSets = [], denySets = []
  for (const cf of (cfg.cross_filters || [])) {
    if (!cf.report_id || !cf.local_field) continue
    const { data: sourceRep } = await supabase.from('saved_reports').select('*').eq('id', cf.report_id).single()
    if (!sourceRep) continue
    const { rows: sourceRows } = await executeReportQueryStandalone(sourceRep)
    const remote = cf.remote_field || cf.local_field
    const ids = (sourceRows || []).map(r => r[remote]).filter(v => v != null)
    if (cf.type === 'not_in') denySets.push({ field: cf.local_field, ids })
    else allowSets.push({ field: cf.local_field, ids })
  }

  // Build select clause with joined table expansions
  const selectParts = [selectFields.join(', ') || '*']
  for (const t of joinTables) selectParts.push(`${t}(*)`)
  const select = selectParts.join(', ')

  let q = supabase.from(base).select(select)
  for (const a of allowSets) q = a.ids.length ? q.in(a.field, a.ids) : q.eq(a.field, '__no_match__')
  for (const d of denySets) if (d.ids.length) q = q.not(d.field, 'in', `(${d.ids.join(',')})`)

  // Server-side filters: apply only the simple ones on the base table.
  // Joined-table filters + compound boolean logic are evaluated client-side.
  const baseFilters = (cfg.filters || []).filter(f => !f.join)
  const joinFilters = (cfg.filters || []).filter(f => f.join)
  const usesComplexLogic = !!cfg.filter_expression && cfg.filter_expression.trim().length > 0

  if (!usesComplexLogic && baseFilters.length && !joinFilters.length) {
    // Simple AND path — push filters to Postgres
    for (const f of baseFilters) q = applyFilter(q, f)
  }
  // Else we still need the base-table rows; filter in-memory below

  if (cfg.order_by) q = q.order(cfg.order_by, { ascending: cfg.order_dir === 'asc' })
  q = q.limit(Math.min(Math.max(Number(cfg.limit) || 500, 1), 5000))

  const { data, error } = await q
  if (error) throw error

  let rows = (data || []).map(row => {
    const out = { ...row }
    // Flatten joined fields into namespaced columns: deal_analysis_champion
    for (const jf of joinedFields) {
      const j = row[jf.join]
      const val = Array.isArray(j) ? j[0]?.[jf.field] : j?.[jf.field]
      out[`${jf.join}_${jf.field}`] = val
    }
    for (const ff of formulaFields) out[ff.key || ff.label] = evalFormula(ff.formula, row)
    return out
  })

  // If we used complex logic OR have joined-table filters, evaluate the
  // full expression in-memory against the loaded rows.
  if (usesComplexLogic || joinFilters.length || baseFilters.length) {
    const allFilters = cfg.filters || []
    try {
      const matcher = compileFilterExpression(cfg.filter_expression, allFilters.length)
      rows = rows.filter(r => {
        const passes = allFilters.map(f => evalCondition(r, f, base))
        return matcher(passes)
      })
    } catch (e) {
      throw new Error(e.message || 'Bad filter expression')
    }
  }

  const agg = cfg.aggregate || { type: 'none' }
  if (agg.type === 'count') return { columns: ['count'], rows: [{ count: rows.length }], aggregate: true, data: rows }
  if (['sum', 'avg', 'min', 'max'].includes(agg.type) && agg.field) {
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
  const columns = [
    ...selectFields,
    ...joinedFields.map(f => `${f.join}_${f.field}`),
    ...formulaFields.map(f => f.key || f.label),
  ]
  return { columns, rows, aggregate: false, data: rows }
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
  // If the user has no saved reports yet, drop them straight into the builder
  // so the report writer is visible — not a tiny "+ Build Report" button in the corner.
  useEffect(() => {
    if (!loading && reports.length === 0 && mode === 'list') startNew()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, reports.length])

  if (modulesLoading) return <Spinner />
  if (!hasModule('reports')) return <Navigate to="/" replace />

  async function loadReports() {
    setLoading(true)
    const { data, error } = await supabase.from('saved_reports').select('*').order('created_at', { ascending: false })
    if (error) console.error('loadReports failed:', error)
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
    const { error } = await supabase.from('saved_reports').delete().eq('id', id)
    if (error) { alert('Delete failed: ' + error.message); return }
    loadReports()
  }

  // Open the builder with a prebuilt's config, but don't hold its id —
  // saving creates a new org-owned editable report.
  function duplicateReport(r) {
    setEditingId(null)
    const cfg = migrateConfig(r.query_config)
    setForm({
      name: `Copy of ${r.name || 'report'}`,
      description: r.description || '',
      category: r.category || 'custom',
      config: cfg,
    })
    setMode('build')
  }

  async function toggleFavorite(r) {
    const next = !r.is_favorite
    await supabase.from('saved_reports').update({ is_favorite: next }).eq('id', r.id)
    setReports(prev => prev.map(x => x.id === r.id ? { ...x, is_favorite: next } : x))
  }

  async function moveToFolder(r, folder) {
    await supabase.from('saved_reports').update({ folder: folder || null }).eq('id', r.id)
    setReports(prev => prev.map(x => x.id === r.id ? { ...x, folder: folder || null } : x))
  }

  async function runReport(report) {
    setMode('run')
    setSelectedReport(report)
    setRunningReport(true)
    setReportData(null)
    setRunError(null)
    try {
      const result = await executeReportQueryStandalone(report)
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
        {mode === 'list' && <ListView reports={reports} runReport={runReport} startEdit={startEdit} deleteReport={deleteReport} duplicateReport={duplicateReport} startNew={startNew} toggleFavorite={toggleFavorite} moveToFolder={moveToFolder} />}

        {mode === 'build' && (
          <BuildViewV2
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
function ListView({ reports, runReport, startEdit, deleteReport, duplicateReport, startNew, toggleFavorite, moveToFolder }) {
  const [activeFolder, setActiveFolder] = useState('__all__') // __all__ | __fav__ | __uncat__ | <folder name>
  const [search, setSearch] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [draggingId, setDraggingId] = useState(null)

  // Unique list of folders (excluding empty/nulls)
  const folders = useMemo(() => {
    const set = new Set()
    for (const r of reports) if (r.folder) set.add(r.folder)
    return [...set].sort()
  }, [reports])

  const filtered = useMemo(() => {
    let list = reports
    if (activeFolder === '__fav__') list = list.filter(r => r.is_favorite)
    else if (activeFolder === '__uncat__') list = list.filter(r => !r.folder)
    else if (activeFolder !== '__all__') list = list.filter(r => r.folder === activeFolder)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q) || r.category?.toLowerCase().includes(q))
    }
    return list
  }, [reports, activeFolder, search])

  const favCount = reports.filter(r => r.is_favorite).length
  const uncatCount = reports.filter(r => !r.folder).length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '220px 1fr', gap: 16, alignItems: 'start' }}>
      {/* SIDEBAR */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, position: 'sticky', top: 0 }}>
        <FolderItem active={activeFolder === '__all__'} onClick={() => setActiveFolder('__all__')} label="All reports" count={reports.length} icon="≡" />
        <FolderItem active={activeFolder === '__fav__'} onClick={() => setActiveFolder('__fav__')} label="Favorites" count={favCount} icon="★" color={T.warning} />
        <FolderItem active={activeFolder === '__uncat__'} onClick={() => setActiveFolder('__uncat__')} label="Uncategorized" count={uncatCount} icon="📄" />
        <div style={{ height: 1, background: T.borderLight, margin: '8px 0' }} />
        <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '4px 8px' }}>Folders</div>
        {folders.length === 0 && (
          <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: '4px 8px' }}>No folders yet.</div>
        )}
        {folders.map(f => (
          <FolderItem key={f}
            active={activeFolder === f}
            onClick={() => setActiveFolder(f)}
            label={f}
            count={reports.filter(r => r.folder === f).length}
            icon="▸"
            droppable
            onDrop={e => {
              e.preventDefault()
              const id = e.dataTransfer.getData('text/plain')
              const r = reports.find(x => x.id === id)
              if (r) moveToFolder(r, f)
              setDraggingId(null)
            }} />
        ))}
        <div style={{ height: 1, background: T.borderLight, margin: '8px 0' }} />
        <div style={{ padding: '4px 8px' }}>
          <input value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="+ New folder"
            onKeyDown={e => { if (e.key === 'Enter' && newFolder.trim()) { setActiveFolder(newFolder.trim()); setNewFolder('') } }}
            style={{ ...inputStyle, padding: '4px 8px', fontSize: 11 }} />
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>Drag a report onto a folder to move it. Enter to create.</div>
        </div>
      </div>

      {/* MAIN */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>
            {activeFolder === '__all__' ? 'All reports' : activeFolder === '__fav__' ? 'Favorites' : activeFolder === '__uncat__' ? 'Uncategorized' : activeFolder}
            <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 8 }}>({filtered.length})</span>
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search reports..."
            style={{ ...inputStyle, padding: '4px 10px', fontSize: 12, maxWidth: 240 }} />
        </div>
        {filtered.length === 0 ? (
          <EmptyState icon="≡" title="No reports here"
            message={activeFolder === '__all__' || activeFolder === '__uncat__'
              ? "Build your first report — slice and dice deals, conversations, tasks, contacts, anything. Combine filters with AND/OR, add calculated columns, cross-reference other reports."
              : activeFolder === '__fav__'
                ? "No favorites yet. Hit the ★ on any report to pin it here."
                : `"${activeFolder}" is empty. Drag reports onto it from the list.`}
            action={<Button primary onClick={startNew}>+ Build Report</Button>} />
        ) : (
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                  {['', 'Name', 'Category', 'Base', 'Fields', 'Filters', 'Folder', 'Type', ''].map((h, i) => (
                    <th key={i} style={{
                      textAlign: i === 0 ? 'center' : i >= 4 && i <= 5 ? 'right' : 'left',
                      padding: '8px 10px', fontSize: 10, fontWeight: 700,
                      color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const cfg = r.query_config || {}
                  const filterCount = (cfg.filter_groups || []).reduce((s, g) => s + (g.conditions?.length || 0), 0) + (cfg.filters?.length || 0)
                  const isDragging = draggingId === r.id
                  return (
                    <tr key={r.id}
                      draggable={!r.is_prebuilt}
                      onDragStart={e => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(r.id) }}
                      onDragEnd={() => setDraggingId(null)}
                      style={{
                        borderBottom: `1px solid ${T.borderLight}`,
                        opacity: isDragging ? 0.4 : 1,
                        cursor: r.is_prebuilt ? 'default' : 'grab',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = T.surfaceAlt }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(r) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, padding: 0, color: r.is_favorite ? T.warning : T.borderLight, lineHeight: 1 }}
                          title={r.is_favorite ? 'Unfavorite' : 'Favorite'}>★</button>
                      </td>
                      <td style={{ padding: '8px 10px', minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: T.text, cursor: 'pointer' }}
                          onClick={() => runReport(r)}
                          title="Run report">
                          {r.name || '(untitled)'}
                        </div>
                        {r.description && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, lineHeight: 1.4 }}>{r.description}</div>}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {r.category ? <Badge color={CATEGORY_COLORS[r.category] || T.primary}>{r.category}</Badge> : <span style={{ fontSize: 11, color: T.textMuted }}>—</span>}
                      </td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: T.textSecondary, fontFamily: T.mono }}>{r.base_entity || cfg.base_entity || 'deals'}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: T.textSecondary, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{cfg.fields?.length || 0}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: T.textSecondary, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{filterCount}{cfg.cross_filters?.length ? ` + ${cfg.cross_filters.length} xref` : ''}</td>
                      <td style={{ padding: '8px 10px', fontSize: 11, color: T.textMuted }}>{r.folder || '—'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {r.is_prebuilt ? <Badge color={T.textMuted}>Prebuilt</Badge> : <span style={{ fontSize: 11, color: T.textMuted }}>Custom</span>}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <Button primary onClick={() => runReport(r)} style={{ padding: '3px 10px', fontSize: 11 }}>Run</Button>
                          {r.is_prebuilt ? (
                            <Button onClick={() => duplicateReport(r)} style={{ padding: '3px 10px', fontSize: 11 }} title="Create an editable copy">Duplicate</Button>
                          ) : (
                            <>
                              <Button onClick={() => startEdit(r)} style={{ padding: '3px 10px', fontSize: 11 }}>Edit</Button>
                              <Button onClick={() => deleteReport(r.id)} style={{ padding: '3px 10px', fontSize: 11, color: T.error }}>Delete</Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function FolderItem({ active, onClick, label, count, icon, color, droppable, onDrop }) {
  const [hovering, setHovering] = useState(false)
  return (
    <div
      onClick={onClick}
      onDragOver={droppable ? (e) => { e.preventDefault(); setHovering(true) } : undefined}
      onDragLeave={droppable ? () => setHovering(false) : undefined}
      onDrop={droppable ? (e) => { onDrop(e); setHovering(false) } : undefined}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
        borderRadius: 5, cursor: 'pointer', marginBottom: 2, fontSize: 12,
        background: hovering ? T.primaryLight : active ? T.primaryLight : 'transparent',
        color: active ? T.primary : T.text,
        fontWeight: active ? 700 : 500,
        border: hovering ? `1px dashed ${T.primary}` : '1px solid transparent',
      }}>
      <span style={{ fontSize: 13, color: color || (active ? T.primary : T.textMuted), flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 600 }}>{count}</span>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function BuildView({ form, setForm, editingId, baseFields, reports, saving, saveReport, cancel, previewReport }) {
  const cfg = form.config
  const setCfg = (patch) => setForm(p => ({ ...p, config: { ...p.config, ...patch } }))
  const [fieldSearch, setFieldSearch] = useState('')

  // Live preview — debounced re-run whenever the config changes.
  const [livePreview, setLivePreview] = useState(null)
  const [liveRunning, setLiveRunning] = useState(false)
  const [liveError, setLiveError] = useState(null)
  useEffect(() => {
    const handle = setTimeout(async () => {
      setLiveRunning(true)
      setLiveError(null)
      try {
        const result = await executeReportQueryStandalone({ query_config: cfg, base_entity: cfg.base_entity })
        setLivePreview(result)
      } catch (e) {
        setLivePreview(null)
        setLiveError(e?.message || String(e))
      } finally {
        setLiveRunning(false)
      }
    }, 400)
    return () => clearTimeout(handle)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cfg)])

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

      <Card title="Fields" action={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search fields..." style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, width: 160 }} />
          <Button onClick={addFormulaField} style={{ padding: '3px 10px', fontSize: 11 }}>+ Calculated column</Button>
        </div>
      }>
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>
          Drag fields from the left into the right panel, or click a chip to toggle. Drag selected fields to reorder.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, minHeight: 200 }}>
          {/* LEFT: available fields */}
          <div style={{ border: `1px solid ${T.borderLight}`, borderRadius: 6, background: T.surfaceAlt, padding: 10, overflow: 'auto', maxHeight: 320 }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Available fields in {TABLES[cfg.base_entity]?.label || cfg.base_entity}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Object.entries(baseFields)
                .filter(([k, m]) => !fieldSearch || (m.label || '').toLowerCase().includes(fieldSearch.toLowerCase()) || k.includes(fieldSearch.toLowerCase()))
                .map(([key, meta]) => {
                const selected = rawSelected.includes(key)
                return (
                  <div key={key}
                    draggable
                    onDragStart={e => {
                      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'db-field', field: key, label: meta.label, type: meta.type }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => {
                      const next = selected ? cfg.fields.filter(f => f !== key) : [...cfg.fields, key]
                      setCfg({ fields: next })
                    }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      padding: '3px 8px', fontSize: 11, borderRadius: 16,
                      border: `1px solid ${selected ? T.primary : T.border}`,
                      background: selected ? T.primaryLight : T.surface,
                      cursor: 'grab', userSelect: 'none', fontFamily: T.font, color: T.text,
                    }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[meta.type] || T.textMuted, flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>{meta.label || key}</span>
                    <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{meta.type}</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* RIGHT: selected fields (drop target) */}
          <div
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={e => {
              e.preventDefault()
              try {
                const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                if (d?.kind === 'db-field' && !rawSelected.includes(d.field)) setCfg({ fields: [...cfg.fields, d.field] })
              } catch { /* noop */ }
            }}
            style={{ border: `2px dashed ${T.primary}40`, borderRadius: 6, padding: 10, background: T.surface, minHeight: 200, maxHeight: 320, overflow: 'auto' }}>
            <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Report columns ({cfg.fields.length})</div>
            {cfg.fields.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', textAlign: 'center', padding: 30 }}>
                Drop fields here or click chips on the left.<br /><span style={{ fontSize: 10 }}>Leave empty to show first 8 columns.</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cfg.fields.map((f, i) => {
                  const isFormula = typeof f === 'object'
                  const label = isFormula ? (f.label || 'Calculated') : (baseFields[f]?.label || f)
                  const type = isFormula ? 'formula' : (baseFields[f]?.type || 'text')
                  return (
                    <div key={i}
                      draggable={!isFormula}
                      onDragStart={e => {
                        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'reorder', fromIdx: i }))
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={e => { if (!isFormula) e.preventDefault() }}
                      onDrop={e => {
                        e.preventDefault()
                        e.stopPropagation()
                        try {
                          const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                          if (d?.kind === 'reorder' && d.fromIdx !== i) {
                            const arr = [...cfg.fields]
                            const [moved] = arr.splice(d.fromIdx, 1)
                            arr.splice(i, 0, moved)
                            setCfg({ fields: arr })
                          } else if (d?.kind === 'db-field' && !rawSelected.includes(d.field)) {
                            const arr = [...cfg.fields]
                            arr.splice(i, 0, d.field)
                            setCfg({ fields: arr })
                          }
                        } catch { /* noop */ }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                        background: isFormula ? T.primaryLight : T.surfaceAlt,
                        border: `1px solid ${isFormula ? T.primary + '55' : T.borderLight}`,
                        borderRadius: 6, fontSize: 12, cursor: isFormula ? 'default' : 'grab',
                      }}>
                      <span style={{ fontSize: 10, color: T.textMuted }}>⋮⋮</span>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[type] || T.textMuted, flexShrink: 0 }} />
                      {isFormula ? (
                        <>
                          <input style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, width: 120 }} value={f.label} onChange={e => updateField(i, { label: e.target.value })} placeholder="Label" />
                          <input style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, flex: 1, fontFamily: 'ui-monospace, monospace' }} value={f.formula} onChange={e => updateField(i, { formula: e.target.value })} placeholder="e.g. (fit_score + deal_health_score) / 2" />
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontWeight: 600, color: T.text }}>{label}</span>
                          <span style={{ fontSize: 9, color: T.textMuted, fontFamily: T.mono }}>{type}</span>
                        </>
                      )}
                      <button onClick={() => removeField(i)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 14, cursor: 'pointer', padding: 0 }}>×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
        {formulaFields.length > 0 && (
          <div style={{ fontSize: 10, color: T.textMuted, marginTop: 8 }}>
            Formula columns evaluate client-side per row. Use field names + arithmetic: <code>+ − × ÷ ( )</code>. Safe numeric-only eval.
          </div>
        )}
      </Card>

      <Card title="Filter Conditions" action={<Button onClick={addGroup} style={{ padding: '3px 10px', fontSize: 11 }}>+ Filter group</Button>}>
        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>
          Each <strong>condition</strong> is a field/operator/value. <strong>Filter logic</strong> — the AND/OR inside a group — controls how conditions combine.
          Groups always AND together, so you can build <code>A AND (B OR C)</code>.
        </div>
        {cfg.filter_groups.map((grp, gi) => (
          <div key={gi} style={{ border: `1px solid ${T.borderLight}`, borderRadius: 6, padding: 10, marginBottom: 8, background: T.surfaceAlt }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Group {gi + 1}</span>
                <span style={{ fontSize: 9, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Filter logic:</span>
                <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
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

      {/* Live Preview — auto-runs on every config change (debounced ~400ms) */}
      <Card title="Live Preview" action={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {liveRunning && <span style={{ fontSize: 10, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${T.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Running...
          </span>}
          {!liveRunning && livePreview && <span style={{ fontSize: 11, color: T.success, fontWeight: 600 }}>✓ Live</span>}
        </div>
      }>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        {liveError ? (
          <div style={{ color: T.error, fontSize: 12, padding: 8 }}>{liveError}</div>
        ) : !livePreview ? (
          <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic', padding: 8 }}>Pick fields or add a filter to see results.</div>
        ) : (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 6 }}>
              {livePreview.rows.length} {livePreview.aggregate ? 'result' : 'row' + (livePreview.rows.length === 1 ? '' : 's')}
              {livePreview.rows.length >= (cfg.limit || 500) && ` (hit row limit)`}
            </div>
            <div style={{ overflow: 'auto', maxHeight: 400, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt, zIndex: 1 }}>
                  <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                    {livePreview.columns.map(c => (
                      <th key={c} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{c.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {livePreview.rows.slice(0, 100).map((row, i) => (
                    <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      {livePreview.columns.map(c => {
                        const val = row[c]
                        const disp = val == null ? '—' : typeof val === 'object' ? JSON.stringify(val).substring(0, 80) : String(val).substring(0, 120)
                        return <td key={c} style={{ padding: '5px 8px', color: T.text, fontFeatureSettings: '"tnum"' }}>{disp}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {livePreview.rows.length > 100 && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6, textAlign: 'center' }}>Showing first 100 of {livePreview.rows.length} rows. Save + Run for full results.</div>}
          </>
        )}
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12, position: 'sticky', bottom: 10 }}>
        <Button onClick={cancel} style={{ padding: '6px 14px', fontSize: 12 }}>Cancel</Button>
        <Button primary onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '6px 14px', fontSize: 12 }}>{saving ? 'Saving...' : 'Save Report'}</Button>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
// BuildViewV2 — Salesforce-style report builder
// Top bar: inline name + base table + Save / Save&Run / Run / Close + Auto-preview toggle
// Left sidebar: Outline (Groups + Columns) | Filters (numbered cards + boolean expression)
// Right: live preview table
function BuildViewV2({ form, setForm, editingId, baseFields, reports, saving, saveReport, cancel, previewReport }) {
  const cfg = form.config
  const setCfg = (patch) => setForm(p => ({ ...p, config: { ...p.config, ...patch } }))

  const [sidebar, setSidebar] = useState('outline')
  const [autoPreview, setAutoPreview] = useState(() => {
    try { return localStorage.getItem('ri_reports_autopreview') !== 'false' } catch { return true }
  })
  useEffect(() => { try { localStorage.setItem('ri_reports_autopreview', String(autoPreview)) } catch {} }, [autoPreview])

  const [fieldSearch, setFieldSearch] = useState('')
  const [livePreview, setLivePreview] = useState(null)
  const [liveRunning, setLiveRunning] = useState(false)
  const [liveError, setLiveError] = useState(null)

  // All joinable tables for this base entity (full catalog)
  const availableRelations = useMemo(() => {
    return Object.entries(TABLES)
      .filter(([k, t]) => k !== cfg.base_entity && t.join === 'deal_id' && cfg.base_entity === 'deals')
      .map(([k, t]) => ({ key: k, label: t.label, fields: t.fields, multi: !!t.multi }))
  }, [cfg.base_entity])
  // Only the relations the user explicitly included in the report type
  const joinableTables = useMemo(() => {
    const included = new Set(cfg.included_relations || [])
    return availableRelations.filter(r => included.has(r.key))
  }, [availableRelations, cfg.included_relations])

  async function runLive() {
    setLiveRunning(true); setLiveError(null)
    try {
      const r = await executeReportQueryStandalone({ query_config: cfg, base_entity: cfg.base_entity })
      setLivePreview(r)
    } catch (e) { setLivePreview(null); setLiveError(e?.message || String(e)) }
    finally { setLiveRunning(false) }
  }

  useEffect(() => {
    if (!autoPreview) return
    const h = setTimeout(runLive, 400)
    return () => clearTimeout(h)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cfg), autoPreview])

  function addFilter(preset) { setCfg({ filters: [...cfg.filters, preset || { field: '', operator: 'eq', value: '' }] }); setSidebar('filters') }
  function updateFilter(i, patch) { setCfg({ filters: cfg.filters.map((f, j) => j === i ? { ...f, ...patch } : f) }) }
  function removeFilter(i) {
    const next = cfg.filters.filter((_, j) => j !== i)
    let expr = cfg.filter_expression || ''
    if (expr) {
      expr = expr.replace(/\d+/g, m => {
        const n = Number(m)
        if (n === i + 1) return 'TRUE'
        if (n > i + 1) return String(n - 1)
        return m
      }).replace(/\bTRUE\b/g, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\s+(AND|OR)\s+(AND|OR)/gi, ' $1 ')
        .replace(/^\s*(AND|OR)\s+/i, '')
        .replace(/\s+(AND|OR)\s*$/i, '')
        .trim()
    }
    setCfg({ filters: next, filter_expression: expr })
  }

  function addFormulaField() {
    const key = `calc_${Math.random().toString(36).slice(2, 6)}`
    setCfg({ fields: [...cfg.fields, { key, label: 'Calculated', formula: '' }] })
  }
  function updateField(idx, patch) { setCfg({ fields: cfg.fields.map((f, i) => i === idx ? (typeof f === 'string' ? f : { ...f, ...patch }) : f) }) }
  function removeField(idx) { setCfg({ fields: cfg.fields.filter((_, i) => i !== idx) }) }

  function toggleField(key, join) {
    const already = cfg.fields.some(f => (typeof f === 'string' ? f === key && !join : typeof f === 'object' && f.field === key && f.join === join))
    if (already) setCfg({ fields: cfg.fields.filter(f => !(typeof f === 'string' ? f === key && !join : typeof f === 'object' && f.field === key && f.join === join)) })
    else setCfg({ fields: [...cfg.fields, join ? { join, field: key, label: key } : key] })
  }

  function fieldChipLabel(f) {
    if (typeof f === 'string') return baseFields[f]?.label || f
    if (f.formula !== undefined) return f.label || 'Calculated'
    if (f.join) return `${TABLES[f.join]?.label || f.join} · ${TABLES[f.join]?.fields?.[f.field]?.label || f.field}`
    return f.label || f.field
  }
  function fieldChipType(f) {
    if (typeof f === 'string') return baseFields[f]?.type || 'text'
    if (f.formula !== undefined) return 'formula'
    if (f.join) return TABLES[f.join]?.fields?.[f.field]?.type || 'text'
    return 'text'
  }

  const filterCount = cfg.filters.length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 0, minHeight: 'calc(100vh - 110px)', border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', background: T.surface }}>
      {/* Left sidebar */}
      <div style={{ borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column', background: T.surface, overflow: 'hidden' }}>
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt }}>
          {[['outline', 'Outline', null], ['filters', 'Filters', filterCount]].map(([k, label, badge]) => (
            <button key={k} onClick={() => setSidebar(k)}
              style={{ flex: 1, padding: '10px 6px', background: 'transparent', border: 'none', borderBottom: sidebar === k ? `2px solid ${T.primary}` : '2px solid transparent', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: sidebar === k ? T.primary : T.textMuted, fontFamily: T.font, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              {label}{badge != null && <span style={{ background: T.primary, color: '#fff', fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 10 }}>{badge}</span>}
            </button>
          ))}
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {sidebar === 'outline' && (
            <>
              <Section title="Report Type" subtitle="Which tables contribute fields to this report.">
                <div style={{ padding: '6px 10px', background: T.primaryLight, border: `1px solid ${T.primary}55`, borderRadius: 4, fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>
                  {TABLES[cfg.base_entity]?.label || cfg.base_entity}
                  {(cfg.included_relations || []).length > 0 && (
                    <> + {(cfg.included_relations || []).map(k => TABLES[k]?.label || k).join(' + ')}</>
                  )}
                </div>
                {availableRelations.length > 0 ? (
                  <>
                    <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 4 }}>Include related objects:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {availableRelations.map(rel => {
                        const on = (cfg.included_relations || []).includes(rel.key)
                        return (
                          <button key={rel.key} onClick={() => {
                            const set = new Set(cfg.included_relations || [])
                            if (on) {
                              set.delete(rel.key)
                              // Also strip fields + filters that referenced it so they don't orphan
                              setCfg({
                                included_relations: [...set],
                                fields: (cfg.fields || []).filter(f => !(typeof f === 'object' && f.join === rel.key)),
                                filters: (cfg.filters || []).filter(f => f.join !== rel.key),
                              })
                            } else {
                              set.add(rel.key)
                              setCfg({ included_relations: [...set] })
                            }
                          }}
                            style={{
                              padding: '3px 10px', fontSize: 10, fontWeight: 700, borderRadius: 16,
                              border: `1px solid ${on ? T.primary : T.border}`,
                              background: on ? T.primary : T.surface,
                              color: on ? '#fff' : T.textMuted,
                              cursor: 'pointer', fontFamily: T.font,
                            }}>
                            {on ? '✓ ' : '+ '}{rel.label}
                            {rel.multi && <span style={{ fontSize: 8, marginLeft: 4, opacity: 0.7 }}>multi</span>}
                          </button>
                        )
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6 }}>
                      Add objects to report on them together. e.g. {TABLES[cfg.base_entity]?.label || cfg.base_entity} + Tasks + Contacts.
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 10, color: T.textMuted, fontStyle: 'italic' }}>
                    No related objects mapped for this base table yet.
                  </div>
                )}
              </Section>

              <Section title={cfg.report_type === 'matrix' ? 'Row Groups' : 'Groups'} subtitle={
                cfg.report_type === 'tabular' ? 'Adding a group auto-switches to Summary.' :
                cfg.report_type === 'matrix' ? 'Rows in the matrix pivot.' :
                'Drag a column header to the "Drop to group by" bar on the preview, or pick here.'
              }>
                {cfg.groups.length === 0 && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: '4px 0' }}>No groups.</div>}
                {cfg.groups.map((g, i) => (
                  <Chip key={i} label={baseFields[g]?.label || g} onRemove={() => {
                    const next = cfg.groups.filter((_, j) => j !== i)
                    // If removing last group from a summary/matrix, drop back to tabular
                    const patch = { groups: next }
                    if (!next.length && cfg.report_type !== 'matrix') patch.report_type = 'tabular'
                    setCfg(patch)
                  }} />
                ))}
                <select value="" onChange={e => {
                  if (!e.target.value) return
                  const patch = { groups: [...cfg.groups, e.target.value] }
                  if (cfg.report_type === 'tabular') patch.report_type = 'summary'
                  setCfg(patch)
                }} style={{ ...inputStyle, padding: '5px 8px', fontSize: 11, marginTop: 6 }}>
                  <option value="">+ Add group…</option>
                  {Object.entries(baseFields).filter(([k]) => !cfg.groups.includes(k)).map(([k, m]) => <option key={k} value={k}>{m.label || k}</option>)}
                </select>
              </Section>

              {cfg.report_type === 'matrix' && (
                <Section title="Column Pivot" subtitle="One field whose unique values become the matrix columns.">
                  <select value={cfg.pivot_column || ''} onChange={e => setCfg({ pivot_column: e.target.value || null })}
                    style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                    <option value="">— pick field —</option>
                    {Object.entries(baseFields).map(([k, m]) => <option key={k} value={k}>{m.label || k}</option>)}
                  </select>
                </Section>
              )}

              {(cfg.report_type === 'summary' || cfg.report_type === 'matrix') && (
                <Section title="Cell Aggregate" subtitle={cfg.report_type === 'matrix' ? 'Value shown in each matrix cell.' : 'Value shown on each group row.'}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <select value={cfg.summary_aggregate?.type || 'count'} onChange={e => setCfg({ summary_aggregate: { ...cfg.summary_aggregate, type: e.target.value } })}
                      style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                      <option value="count">Count</option>
                      <option value="sum">Sum</option>
                      <option value="avg">Average</option>
                      <option value="min">Min</option>
                      <option value="max">Max</option>
                    </select>
                    {cfg.summary_aggregate?.type !== 'count' && (
                      <select value={cfg.summary_aggregate?.field || ''} onChange={e => setCfg({ summary_aggregate: { ...cfg.summary_aggregate, field: e.target.value || null } })}
                        style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                        <option value="">— field —</option>
                        {Object.entries(baseFields).filter(([, m]) => ['number', 'currency', 'score', 'percentage'].includes(m.type)).map(([k, m]) => <option key={k} value={k}>{m.label || k}</option>)}
                      </select>
                    )}
                  </div>
                </Section>
              )}

              <Section title="Columns" subtitle="Click or drag fields to add. Drag chips to reorder.">
                <input value={fieldSearch} onChange={e => setFieldSearch(e.target.value)} placeholder="Search fields…" style={{ ...inputStyle, padding: '6px 8px', fontSize: 11, marginBottom: 8 }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                  {cfg.fields.length === 0 && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: 4 }}>No columns — first 8 shown by default.</div>}
                  {cfg.fields.map((f, i) => {
                    const isFormula = typeof f === 'object' && f.formula !== undefined
                    return (
                      <div key={i} draggable={!isFormula}
                        onDragStart={e => { e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'reorder', fromIdx: i })); e.dataTransfer.effectAllowed = 'move' }}
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => {
                          e.preventDefault()
                          try {
                            const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                            if (d?.kind === 'reorder' && d.fromIdx !== i) {
                              const arr = [...cfg.fields]
                              const [moved] = arr.splice(d.fromIdx, 1)
                              arr.splice(i, 0, moved)
                              setCfg({ fields: arr })
                            }
                          } catch {}
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, background: isFormula ? T.primaryLight : T.surfaceAlt, border: `1px solid ${isFormula ? T.primary + '55' : T.borderLight}`, cursor: isFormula ? 'default' : 'grab' }}>
                        <span style={{ fontSize: 10, color: T.textMuted }}>⋮⋮</span>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[fieldChipType(f)] || T.textMuted, flexShrink: 0 }} />
                        {isFormula ? (
                          <>
                            <input style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, width: 90 }} value={f.label} onChange={e => updateField(i, { label: e.target.value })} />
                            <input style={{ ...inputStyle, padding: '2px 6px', fontSize: 11, flex: 1, fontFamily: 'ui-monospace, monospace' }} value={f.formula} onChange={e => updateField(i, { formula: e.target.value })} placeholder="fit_score + deal_health_score" />
                          </>
                        ) : (
                          <span style={{ flex: 1, fontSize: 12, fontWeight: 600, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fieldChipLabel(f)}</span>
                        )}
                        <button onClick={() => removeField(i)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', padding: 0 }}>×</button>
                      </div>
                    )
                  })}
                </div>
                <Button onClick={addFormulaField} style={{ padding: '4px 10px', fontSize: 11, marginBottom: 10 }}>+ Calculated column</Button>

                <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{TABLES[cfg.base_entity]?.label || cfg.base_entity} fields</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
                  {Object.entries(baseFields)
                    .filter(([k, m]) => !fieldSearch || (m.label || '').toLowerCase().includes(fieldSearch.toLowerCase()) || k.includes(fieldSearch.toLowerCase()))
                    .map(([k, m]) => {
                      const selected = cfg.fields.some(f => typeof f === 'string' && f === k)
                      return (
                        <div key={k} draggable onClick={() => toggleField(k, null)}
                          onDragStart={e => { e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'add', field: k })); e.dataTransfer.effectAllowed = 'copy' }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', fontSize: 11, cursor: 'grab', borderRadius: 4, background: selected ? T.primaryLight : 'transparent' }}
                          onMouseEnter={e => { if (!selected) e.currentTarget.style.background = T.surfaceAlt }}
                          onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}>
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[m.type] || T.textMuted, flexShrink: 0 }} />
                          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text }}>{m.label || k}</span>
                          {selected && <span style={{ fontSize: 10, color: T.primary, fontWeight: 700 }}>✓</span>}
                        </div>
                      )
                    })}
                </div>

                {joinableTables.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, marginTop: 10 }}>Related objects</div>
                    {joinableTables.map(jt => <JoinedGroup key={jt.key} table={jt} fieldSearch={fieldSearch} cfg={cfg} toggleField={toggleField} />)}
                  </>
                )}
              </Section>
            </>
          )}

          {sidebar === 'filters' && (
            <>
              <Section title="Show Me" subtitle={`All ${TABLES[cfg.base_entity]?.label || cfg.base_entity}`}>
                <select value={cfg.base_entity}
                  onChange={e => setCfg({ base_entity: e.target.value, fields: [], filters: [], filter_expression: '', order_by: null, aggregate: { type: 'none' } })}
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 11 }}>
                  {Object.entries(TABLES).map(([k, v]) => <option key={k} value={k}>{v.label || k}</option>)}
                </select>
              </Section>

              <Section title="Include Rows Matching" subtitle="Combine filters with AND / OR / NOT and parentheses.">
                <input value={cfg.filter_expression || ''} onChange={e => setCfg({ filter_expression: e.target.value })}
                  placeholder={filterCount > 1 ? '1 AND 2 AND (3 OR 4)' : (filterCount === 1 ? '1' : 'Add a filter below…')}
                  style={{ ...inputStyle, padding: '6px 10px', fontSize: 12, fontFamily: 'ui-monospace, monospace' }} />
                <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4 }}>Blank = every filter must pass (implicit AND).</div>
              </Section>

              <Section title={`Filters (${filterCount})`}>
                {cfg.filters.length === 0 && <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic', padding: 4 }}>No filters yet.</div>}
                {cfg.filters.map((f, i) => (
                  <FilterCard key={i} index={i + 1} filter={f} baseFields={baseFields} joinableTables={joinableTables}
                    onUpdate={patch => updateFilter(i, patch)} onRemove={() => removeFilter(i)} />
                ))}
                <Button onClick={() => addFilter()} style={{ padding: '4px 10px', fontSize: 11, marginTop: 6 }}>+ Add filter</Button>
              </Section>
            </>
          )}
        </div>
      </div>

      {/* Right main area */}
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, background: T.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: `1px solid ${T.border}`, background: T.surface, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Report</div>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Untitled report"
              style={{ ...inputStyle, padding: '4px 8px', fontSize: 15, fontWeight: 700, border: '1px solid transparent', background: 'transparent' }} />
          </div>
          <div style={{ padding: '4px 10px', background: T.surfaceAlt, borderRadius: 4, fontSize: 11, fontWeight: 600, color: T.text, border: `1px solid ${T.border}` }}>
            {TABLES[cfg.base_entity]?.label || cfg.base_entity}
            {(cfg.included_relations || []).length > 0 && <span style={{ color: T.textMuted, fontWeight: 500 }}> + {(cfg.included_relations || []).map(k => TABLES[k]?.label || k).join(' + ')}</span>}
          </div>
          {/* Report type selector */}
          <div style={{ display: 'flex', border: `1px solid ${T.border}`, borderRadius: 4, overflow: 'hidden' }}>
            {[
              { k: 'tabular', label: 'Tabular', hint: 'Flat rows' },
              { k: 'summary', label: 'Summary', hint: 'Grouped rows + subtotals' },
              { k: 'matrix', label: 'Matrix', hint: 'Rows × columns pivot' },
            ].map(t => (
              <button key={t.k} onClick={() => setCfg({ report_type: t.k })}
                title={t.hint}
                style={{ padding: '4px 10px', fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer', background: cfg.report_type === t.k ? T.primary : T.surface, color: cfg.report_type === t.k ? '#fff' : T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {t.label}
              </button>
            ))}
          </div>
          <label style={{ fontSize: 10, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={autoPreview} onChange={e => setAutoPreview(e.target.checked)} />
            Update Preview Automatically
          </label>
          {!autoPreview && <Button onClick={runLive} style={{ padding: '5px 12px', fontSize: 11 }}>Preview</Button>}
          <Button onClick={saveReport} disabled={saving || !form.name.trim()} style={{ padding: '5px 12px', fontSize: 11 }}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button onClick={async () => { await saveReport(); previewReport() }} disabled={saving || !form.name.trim()} style={{ padding: '5px 12px', fontSize: 11 }}>Save &amp; Run</Button>
          <Button onClick={cancel} style={{ padding: '5px 12px', fontSize: 11 }}>Close</Button>
          <Button primary onClick={previewReport} style={{ padding: '5px 14px', fontSize: 12 }}>Run</Button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {liveRunning && (
            <div style={{ fontSize: 11, color: T.textMuted, padding: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, border: `2px solid ${T.primary}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'ri-spin 0.8s linear infinite' }} />
              Running preview…
              <style>{`@keyframes ri-spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}
          {liveError && <div style={{ padding: 14, background: T.errorLight, color: T.error, borderRadius: 6, border: `1px solid ${T.error}40`, fontSize: 12 }}>{liveError}</div>}
          {livePreview && (
            <PreviewTable
              data={livePreview}
              cfg={cfg}
              setCfg={setCfg}
              baseFields={baseFields}
            />
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: subtitle ? 2 : 6 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 6 }}>{subtitle}</div>}
      {children}
    </div>
  )
}
function Chip({ label, onRemove }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, background: T.primaryLight, border: `1px solid ${T.primary}55`, fontSize: 11, marginRight: 4, marginBottom: 4 }}>
      <span style={{ color: T.text, fontWeight: 600 }}>{label}</span>
      <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 13, padding: 0 }}>×</button>
    </div>
  )
}
function JoinedGroup({ table, fieldSearch, cfg, toggleField }) {
  const [expanded, setExpanded] = useState(false)
  const fields = Object.entries(table.fields).filter(([k, m]) => !fieldSearch || (m.label || '').toLowerCase().includes(fieldSearch.toLowerCase()) || k.includes(fieldSearch.toLowerCase()))
  if (fieldSearch && fields.length === 0) return null
  return (
    <div style={{ marginBottom: 4 }}>
      <div onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', fontSize: 11, fontWeight: 700, cursor: 'pointer', color: T.text, background: T.surfaceAlt, borderRadius: 4 }}>
        <span style={{ fontSize: 10, color: T.textMuted }}>{expanded ? '▾' : '▸'}</span>
        <span>{table.label}</span>
        {table.multi && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: T.warningLight, color: T.warning, fontWeight: 700 }}>MULTI</span>}
      </div>
      {expanded && fields.map(([k, m]) => {
        const selected = cfg.fields.some(f => typeof f === 'object' && f.join === table.key && f.field === k)
        return (
          <div key={k} onClick={() => toggleField(k, table.key)} draggable
            onDragStart={e => { e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'add', field: k, join: table.key })); e.dataTransfer.effectAllowed = 'copy' }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 20px', fontSize: 11, cursor: 'grab', borderRadius: 4, background: selected ? T.primaryLight : 'transparent' }}
            onMouseEnter={e => { if (!selected) e.currentTarget.style.background = T.surfaceAlt }}
            onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: TYPE_COLORS[m.type] || T.textMuted, flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text }}>{m.label || k}</span>
            {selected && <span style={{ fontSize: 10, color: T.primary, fontWeight: 700 }}>✓</span>}
          </div>
        )
      })}
    </div>
  )
}
function FilterCard({ index, filter, baseFields, joinableTables, onUpdate, onRemove }) {
  const joinTable = filter.join ? TABLES[filter.join] : null
  const fieldMeta = filter.join ? joinTable?.fields?.[filter.field] : baseFields[filter.field]
  const options = fieldMeta?.options
  const isBool = fieldMeta?.type === 'boolean'
  const isNumeric = ['number', 'currency', 'score', 'percentage'].includes(fieldMeta?.type)
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 6, padding: 8, marginBottom: 6, background: T.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: T.textMuted, fontWeight: 700 }}>Filter {index}</span>
        <button onClick={onRemove} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 13, cursor: 'pointer', padding: 0 }}>×</button>
      </div>
      <select value={`${filter.join || ''}|${filter.field || ''}`}
        onChange={e => { const [j, f] = e.target.value.split('|'); onUpdate({ join: j || null, field: f || '', value: '' }) }}
        style={{ ...inputStyle, padding: '4px 8px', fontSize: 11, marginBottom: 4 }}>
        <option value="|">— field —</option>
        <optgroup label="Base table">
          {Object.entries(baseFields).map(([k, m]) => <option key={k} value={`|${k}`}>{m.label || k}</option>)}
        </optgroup>
        {joinableTables.map(jt => (
          <optgroup key={jt.key} label={jt.label}>
            {Object.entries(jt.fields).map(([k, m]) => <option key={k} value={`${jt.key}|${k}`}>{m.label || k}</option>)}
          </optgroup>
        ))}
      </select>
      <select value={filter.operator} onChange={e => onUpdate({ operator: e.target.value })} style={{ ...inputStyle, padding: '4px 8px', fontSize: 11, marginBottom: 4 }}>
        {OPERATORS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
      {!['is_null', 'not_null'].includes(filter.operator) && (
        options ? (
          <select value={filter.value ?? ''} onChange={e => onUpdate({ value: e.target.value })} style={{ ...inputStyle, padding: '4px 8px', fontSize: 11 }}>
            <option value="">— select —</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : isBool ? (
          <select value={String(filter.value ?? 'true')} onChange={e => onUpdate({ value: e.target.value === 'true' })} style={{ ...inputStyle, padding: '4px 8px', fontSize: 11 }}>
            <option value="true">true</option><option value="false">false</option>
          </select>
        ) : (
          <input value={filter.value ?? ''} onChange={e => onUpdate({ value: isNumeric ? Number(e.target.value) || 0 : e.target.value })}
            type={isNumeric ? 'number' : 'text'} placeholder="value"
            style={{ ...inputStyle, padding: '4px 8px', fontSize: 11 }} />
        )
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────
// PreviewTable — handles tabular / summary / matrix rendering with
// column reorder, column resize, and drop-header-to-group behaviour.
function PreviewTable({ data, cfg, setCfg, baseFields }) {
  const rows = data?.rows || []
  const columns = data?.columns || []
  const [dragCol, setDragCol] = useState(null)              // column id being dragged in header
  const [dropOverTop, setDropOverTop] = useState(false)     // hover state on group drop zone
  const [collapsed, setCollapsed] = useState(new Set())     // collapsed group keys
  const widthsRef = useRef(cfg.column_widths || {})
  useEffect(() => { widthsRef.current = cfg.column_widths || {} }, [cfg.column_widths])

  // Resolve a column id → label for display
  function colLabel(id) {
    if (baseFields[id]?.label) return baseFields[id].label
    // joined-table column like deal_analysis_champion
    const parts = id.split('_')
    if (parts.length >= 2) {
      // try table/field match
      for (let i = parts.length - 1; i > 0; i--) {
        const tKey = parts.slice(0, i).join('_')
        const fKey = parts.slice(i).join('_')
        const jt = TABLES[tKey]
        if (jt?.fields?.[fKey]) return `${jt.label} · ${jt.fields[fKey].label || fKey}`
      }
    }
    // formula or custom label
    const f = (cfg.fields || []).find(x => typeof x === 'object' && (x.key === id || x.label === id))
    if (f) return f.label || id
    return id.replace(/_/g, ' ')
  }

  function setColumnWidth(id, w) {
    const next = { ...(cfg.column_widths || {}), [id]: w }
    setCfg({ column_widths: next })
  }

  // Drag column → reorder in cfg.fields
  function reorderFields(draggedId, targetId) {
    if (!draggedId || draggedId === targetId) return
    const fields = [...(cfg.fields || [])]
    const idOf = (f) => typeof f === 'string' ? f : (f.formula !== undefined ? (f.key || f.label) : `${f.join}_${f.field}`)
    const fromIdx = fields.findIndex(f => idOf(f) === draggedId)
    const toIdx = fields.findIndex(f => idOf(f) === targetId)
    if (fromIdx < 0 || toIdx < 0) return
    const [moved] = fields.splice(fromIdx, 1)
    fields.splice(toIdx, 0, moved)
    setCfg({ fields })
  }

  // Insert a sidebar-dragged field at a specific column position (or at the end)
  function insertFieldFromSidebar(payload, atIdx) {
    if (!payload) return false
    const entry = payload.join ? { join: payload.join, field: payload.field, label: payload.field } : payload.field
    if (!entry) return false
    const fields = [...(cfg.fields || [])]
    // Dedupe — if already present, just move to the target spot
    const idOf = (f) => typeof f === 'string' ? f : (f.join ? `${f.join}_${f.field}` : (f.key || f.label))
    const newId = payload.join ? `${payload.join}_${payload.field}` : payload.field
    const existingIdx = fields.findIndex(f => idOf(f) === newId)
    if (existingIdx >= 0) {
      const [moved] = fields.splice(existingIdx, 1)
      const targetIdx = atIdx == null ? fields.length : Math.min(atIdx, fields.length)
      fields.splice(targetIdx, 0, moved)
    } else {
      const targetIdx = atIdx == null ? fields.length : Math.min(atIdx, fields.length)
      fields.splice(targetIdx, 0, entry)
    }
    // If the field's from a related object, ensure the relation is included
    const patch = { fields }
    if (payload.join && !(cfg.included_relations || []).includes(payload.join)) {
      patch.included_relations = [...(cfg.included_relations || []), payload.join]
    }
    setCfg(patch)
    return true
  }

  // Parse a dataTransfer blob — handles both sidebar-add and header-reorder drags
  function parseDrag(e) {
    const raw = e.dataTransfer.getData('text/plain')
    if (!raw) return null
    try { return JSON.parse(raw) } catch { return { kind: 'reorder-existing', id: raw } }
  }

  // Drop header onto top bar → add as a group (Salesforce summary pattern)
  function groupByColumn(colId) {
    // Only works for base-table fields right now
    if (!baseFields[colId]) return
    if ((cfg.groups || []).includes(colId)) return
    const patch = { groups: [...(cfg.groups || []), colId] }
    if (cfg.report_type === 'tabular') patch.report_type = 'summary'
    setCfg(patch)
  }

  function toggleGroupCollapsed(key) {
    setCollapsed(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  // ── Shared header ──
  function HeaderCell({ id, label, width, last }) {
    const [resizing, setResizing] = useState(false)
    function onResizeStart(e) {
      e.preventDefault(); e.stopPropagation()
      setResizing(true)
      const startX = e.clientX
      const startW = width
      const onMove = (ev) => {
        const w = Math.max(60, startW + (ev.clientX - startX))
        widthsRef.current = { ...widthsRef.current, [id]: w }
        // Update inline style directly for 60fps feel
        const th = document.querySelector(`[data-rcol="${id}"]`)
        if (th) { th.style.width = w + 'px'; th.style.minWidth = w + 'px'; th.style.maxWidth = w + 'px' }
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        setResizing(false)
        setColumnWidth(id, widthsRef.current[id])
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }
    return (
      <th data-rcol={id}
        draggable
        onDragStart={e => { setDragCol(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id) }}
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }}
        onDrop={e => {
          e.preventDefault(); e.stopPropagation()
          const d = parseDrag(e)
          if (d?.kind === 'add') {
            // Sidebar field dropped onto this column header → insert at this position
            const targetIdx = columns.indexOf(id)
            insertFieldFromSidebar(d, targetIdx >= 0 ? targetIdx : null)
          } else {
            // Existing-column drag → reorder
            reorderFields(dragCol, id)
          }
          setDragCol(null)
        }}
        onDragEnd={() => setDragCol(null)}
        style={{
          textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700,
          color: '#8899aa', textTransform: 'uppercase', whiteSpace: 'nowrap',
          width, minWidth: width, maxWidth: width, position: 'relative',
          cursor: 'grab', userSelect: 'none',
          background: dragCol === id ? T.primaryLight : T.surfaceAlt,
          borderRight: `1px solid ${T.borderLight}`,
        }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-block', maxWidth: width - 16 }}>{label}</span>
        {!last && (
          <span onMouseDown={onResizeStart}
            style={{
              position: 'absolute', right: -3, top: 0, bottom: 0, width: 6,
              cursor: 'col-resize', background: resizing ? T.primary : 'transparent', zIndex: 2,
            }} />
        )}
      </th>
    )
  }

  const defaultW = 140
  const widthFor = (id) => cfg.column_widths?.[id] || defaultW
  const totalWidth = columns.reduce((s, id) => s + widthFor(id), 40)

  // ── Aggregate helpers ──
  function aggVal(items, agg) {
    const t = agg?.type || 'count'
    if (t === 'count') return items.length
    const vals = items.map(r => Number(r[agg.field])).filter(n => !isNaN(n))
    if (!vals.length) return 0
    if (t === 'sum') return vals.reduce((s, n) => s + n, 0)
    if (t === 'avg') return Math.round((vals.reduce((s, n) => s + n, 0) / vals.length) * 100) / 100
    if (t === 'min') return Math.min(...vals)
    if (t === 'max') return Math.max(...vals)
    return items.length
  }
  function aggLabel(agg) {
    if (!agg || agg.type === 'count') return 'Count'
    return `${agg.type[0].toUpperCase()}${agg.type.slice(1)} of ${agg.field}`
  }

  // ── Tabular render ──
  function renderTabular() {
    return (
      <div style={{ overflow: 'auto', maxHeight: 540, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
        <table style={{ width: totalWidth, borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt, zIndex: 1 }}>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th style={{ padding: '6px 8px', fontSize: 9, fontWeight: 700, color: T.textMuted, width: 40, minWidth: 40, maxWidth: 40, textAlign: 'right' }}>#</th>
              {columns.map((c, i) => <HeaderCell key={c} id={c} label={colLabel(c)} width={widthFor(c)} last={i === columns.length - 1} />)}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((row, i) => (
              <tr key={i} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ padding: '5px 8px', color: T.textMuted, textAlign: 'right', fontFamily: T.mono, width: 40, minWidth: 40, maxWidth: 40 }}>{i + 1}</td>
                {columns.map(c => {
                  const val = row[c]
                  const disp = val == null ? '—' : typeof val === 'object' ? JSON.stringify(val).substring(0, 80) : String(val).substring(0, 140)
                  const w = widthFor(c)
                  return <td key={c} style={{ padding: '5px 8px', color: T.text, fontFeatureSettings: '"tnum"', width: w, minWidth: w, maxWidth: w, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{disp}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  // ── Summary render: group rows by cfg.groups (nested) with subtotals ──
  function renderSummary() {
    const groups = cfg.groups || []
    const agg = cfg.summary_aggregate || { type: 'count' }
    if (!groups.length) return renderTabular()
    // Build nested structure
    function groupRows(items, depth = 0) {
      if (depth >= groups.length) return { leaves: items }
      const field = groups[depth]
      const buckets = new Map()
      for (const r of items) {
        const k = r[field] ?? '(blank)'
        if (!buckets.has(k)) buckets.set(k, [])
        buckets.get(k).push(r)
      }
      const out = []
      for (const [k, items2] of [...buckets.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
        out.push({ key: `${depth}:${k}`, field, value: k, items: items2, children: groupRows(items2, depth + 1) })
      }
      return out
    }
    const tree = groupRows(rows, 0)
    const totalAggForAll = aggVal(rows, agg)

    function renderLevel(nodes, depth) {
      return nodes.map(node => {
        const isLeaf = depth === groups.length - 1
        const isCollapsed = collapsed.has(node.key)
        const nodeAgg = aggVal(node.items, agg)
        return (
          <React.Fragment key={node.key}>
            <tr style={{ background: depth === 0 ? T.primaryLight : T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
              <td colSpan={columns.length + 1} style={{ padding: '5px 8px', fontSize: 12, fontWeight: 700, color: T.text, paddingLeft: 8 + depth * 16 }}>
                <button onClick={() => toggleGroupCollapsed(node.key)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, padding: '0 6px 0 0', fontSize: 11 }}>{isCollapsed ? '▸' : '▾'}</button>
                <span style={{ color: T.textMuted, fontSize: 10, fontWeight: 800, textTransform: 'uppercase', marginRight: 8 }}>{colLabel(node.field)}:</span>
                <span>{String(node.value)}</span>
                <span style={{ marginLeft: 12, color: T.primary, fontWeight: 800, fontFeatureSettings: '"tnum"' }}>
                  {aggLabel(agg)}: {typeof nodeAgg === 'number' ? nodeAgg.toLocaleString() : nodeAgg}
                </span>
                <span style={{ marginLeft: 8, color: T.textMuted, fontSize: 10 }}>({node.items.length} row{node.items.length === 1 ? '' : 's'})</span>
              </td>
            </tr>
            {!isCollapsed && (isLeaf
              ? node.items.map((row, i) => (
                  <tr key={`${node.key}-${i}`} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '5px 8px', color: T.textMuted, textAlign: 'right', width: 40, minWidth: 40, maxWidth: 40, paddingLeft: 8 + (depth + 1) * 16, fontFamily: T.mono }}>{i + 1}</td>
                    {columns.map(c => {
                      const val = row[c]
                      const disp = val == null ? '—' : typeof val === 'object' ? JSON.stringify(val).substring(0, 80) : String(val).substring(0, 140)
                      const w = widthFor(c)
                      return <td key={c} style={{ padding: '5px 8px', color: T.text, fontFeatureSettings: '"tnum"', width: w, minWidth: w, maxWidth: w, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{disp}</td>
                    })}
                  </tr>
                ))
              : renderLevel(node.children, depth + 1))}
          </React.Fragment>
        )
      })
    }

    return (
      <div style={{ overflow: 'auto', maxHeight: 540, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
        <table style={{ width: totalWidth, borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt, zIndex: 1 }}>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th style={{ padding: '6px 8px', fontSize: 9, fontWeight: 700, color: T.textMuted, width: 40, minWidth: 40, maxWidth: 40, textAlign: 'right' }}>#</th>
              {columns.map((c, i) => <HeaderCell key={c} id={c} label={colLabel(c)} width={widthFor(c)} last={i === columns.length - 1} />)}
            </tr>
          </thead>
          <tbody>
            {renderLevel(tree, 0)}
            <tr style={{ background: T.primaryLight, borderTop: `2px solid ${T.primary}`, fontWeight: 700 }}>
              <td colSpan={columns.length + 1} style={{ padding: '7px 10px', fontSize: 12, color: T.primary }}>
                Grand {aggLabel(agg)}:{' '}
                <span style={{ fontFeatureSettings: '"tnum"', fontWeight: 900 }}>{typeof totalAggForAll === 'number' ? totalAggForAll.toLocaleString() : totalAggForAll}</span>
                <span style={{ marginLeft: 8, color: T.textMuted, fontSize: 10, fontWeight: 600 }}>({rows.length} rows)</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  // ── Matrix render: rows × cols pivot ──
  function renderMatrix() {
    const rowGroup = (cfg.groups || [])[0]
    const colGroup = cfg.pivot_column
    const agg = cfg.summary_aggregate || { type: 'count' }
    if (!rowGroup || !colGroup) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Matrix needs a Row Group and a Column Pivot</div>
          <div style={{ fontSize: 12 }}>Pick one of each in the Outline sidebar. The cell value will be {aggLabel(agg).toLowerCase()}.</div>
        </div>
      )
    }
    const rowKeys = [...new Set(rows.map(r => r[rowGroup] ?? '(blank)'))].sort((a, b) => String(a).localeCompare(String(b)))
    const colKeys = [...new Set(rows.map(r => r[colGroup] ?? '(blank)'))].sort((a, b) => String(a).localeCompare(String(b)))
    const cellW = 100
    const firstW = widthFor(rowGroup) || 160
    const rowTotals = {}
    const colTotals = {}
    const grandItems = []
    const matrix = {}
    for (const rk of rowKeys) {
      matrix[rk] = {}
      const rItems = rows.filter(r => (r[rowGroup] ?? '(blank)') === rk)
      for (const ck of colKeys) {
        const items = rItems.filter(r => (r[colGroup] ?? '(blank)') === ck)
        matrix[rk][ck] = aggVal(items, agg)
        grandItems.push(...items)
      }
      rowTotals[rk] = aggVal(rItems, agg)
    }
    for (const ck of colKeys) {
      const items = rows.filter(r => (r[colGroup] ?? '(blank)') === ck)
      colTotals[ck] = aggVal(items, agg)
    }
    const grand = aggVal(rows, agg)

    return (
      <div style={{ overflow: 'auto', maxHeight: 540, border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, tableLayout: 'fixed' }}>
          <thead style={{ position: 'sticky', top: 0, background: T.surfaceAlt, zIndex: 1 }}>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 800, color: T.text, width: firstW, minWidth: firstW, background: T.surface, borderRight: `1px solid ${T.borderLight}`, textAlign: 'left' }}>
                {colLabel(rowGroup)} <span style={{ color: T.textMuted, fontWeight: 400, fontSize: 9, marginLeft: 4 }}>▾</span>
              </th>
              {colKeys.map(ck => (
                <th key={ck} style={{ padding: '6px 8px', fontSize: 10, fontWeight: 700, color: T.text, width: cellW, minWidth: cellW, textAlign: 'right', whiteSpace: 'nowrap', borderRight: `1px solid ${T.borderLight}` }}>{String(ck)}</th>
              ))}
              <th style={{ padding: '6px 8px', fontSize: 10, fontWeight: 800, color: T.primary, width: cellW, minWidth: cellW, textAlign: 'right', background: T.primaryLight }}>Row total</th>
            </tr>
          </thead>
          <tbody>
            {rowKeys.map(rk => (
              <tr key={rk} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ padding: '5px 8px', fontWeight: 700, color: T.text, background: T.surface, borderRight: `1px solid ${T.borderLight}`, width: firstW, minWidth: firstW }}>{String(rk)}</td>
                {colKeys.map(ck => (
                  <td key={ck} style={{ padding: '5px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.text, borderRight: `1px solid ${T.borderLight}` }}>
                    {typeof matrix[rk][ck] === 'number' ? matrix[rk][ck].toLocaleString() : matrix[rk][ck]}
                  </td>
                ))}
                <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 800, color: T.primary, background: T.primaryLight, fontFeatureSettings: '"tnum"' }}>
                  {typeof rowTotals[rk] === 'number' ? rowTotals[rk].toLocaleString() : rowTotals[rk]}
                </td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${T.primary}`, background: T.primaryLight, fontWeight: 800 }}>
              <td style={{ padding: '7px 10px', color: T.primary, borderRight: `1px solid ${T.border}` }}>Column total</td>
              {colKeys.map(ck => (
                <td key={ck} style={{ padding: '7px 10px', textAlign: 'right', fontFeatureSettings: '"tnum"', color: T.primary, borderRight: `1px solid ${T.border}` }}>
                  {typeof colTotals[ck] === 'number' ? colTotals[ck].toLocaleString() : colTotals[ck]}
                </td>
              ))}
              <td style={{ padding: '7px 10px', textAlign: 'right', color: T.primary, fontFeatureSettings: '"tnum"', fontWeight: 900 }}>
                {typeof grand === 'number' ? grand.toLocaleString() : grand}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <Card>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div>
          Previewing a limited number of records. Run the report to see everything. {rows.length} {data.aggregate ? 'result' : 'row' + (rows.length === 1 ? '' : 's')}.
          {cfg.report_type !== 'tabular' && <span style={{ marginLeft: 8, fontWeight: 700, color: T.primary, textTransform: 'uppercase', fontSize: 10 }}>{cfg.report_type}</span>}
        </div>
      </div>

      {/* Drop zone at top — accepts BOTH existing column headers AND sidebar field drags */}
      {cfg.report_type !== 'matrix' && (
        <div
          onDragOver={e => { e.preventDefault(); setDropOverTop(true); e.dataTransfer.dropEffect = 'copy' }}
          onDragLeave={() => setDropOverTop(false)}
          onDrop={e => {
            e.preventDefault(); setDropOverTop(false)
            const d = parseDrag(e)
            if (d?.kind === 'add') {
              // Sidebar field → add as group (base-table fields only for now)
              if (baseFields[d.field] && !d.join) groupByColumn(d.field)
              else if (d.join) {
                // Include the relation + group the joined-field column id
                const patch = {
                  included_relations: (cfg.included_relations || []).includes(d.join)
                    ? cfg.included_relations : [...(cfg.included_relations || []), d.join],
                }
                // Joined grouping not fully supported; add as column so at least it shows
                insertFieldFromSidebar(d)
                setCfg(patch)
              }
            } else if (dragCol) {
              groupByColumn(dragCol)
            }
            setDragCol(null)
          }}
          style={{
            padding: 8, marginBottom: 8, borderRadius: 6,
            border: `1px dashed ${dropOverTop ? T.primary : T.borderLight}`,
            background: dropOverTop ? T.primaryLight : T.surfaceAlt,
            fontSize: 11, color: dropOverTop ? T.primary : T.textMuted,
            textAlign: 'center', fontWeight: 600, transition: 'all 0.1s',
          }}>
          {(cfg.groups || []).length > 0
            ? <><strong>Grouped by:</strong> {(cfg.groups || []).map(g => colLabel(g)).join(' → ')} — drop another column or sidebar field to group further</>
            : <>Drop a column header or sidebar field here to group by it (switches to Summary)</>}
        </div>
      )}

      {/* Catch-all field drop zone — wraps the whole table so dropping anywhere in open
         space appends the field as a new column. Headers / group-bar / cells handle
         their own precise drops via stopPropagation. */}
      <div
        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
        onDrop={e => {
          e.preventDefault()
          const d = parseDrag(e)
          if (d?.kind === 'add') insertFieldFromSidebar(d)
        }}
      >

      {cfg.report_type === 'tabular' && renderTabular()}
      {cfg.report_type === 'summary' && renderSummary()}
      {cfg.report_type === 'matrix' && renderMatrix()}

      {rows.length > 200 && cfg.report_type === 'tabular' && (
        <div style={{ fontSize: 10, color: T.textMuted, marginTop: 6, textAlign: 'center' }}>Showing first 200 of {rows.length} rows.</div>
      )}
      </div>
    </Card>
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
