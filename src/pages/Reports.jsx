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
  const formulaFields = (cfg.fields || []).filter(f => typeof f === 'object' && f?.formula)
  const selectFields = rawFields.length ? rawFields : Object.keys(TABLES[base]?.fields || {}).slice(0, 8)

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

  const select = selectFields.join(', ') || '*'
  let q = supabase.from(base).select(select)
  for (const a of allowSets) q = a.ids.length ? q.in(a.field, a.ids) : q.eq(a.field, '__no_match__')
  for (const d of denySets) if (d.ids.length) q = q.not(d.field, 'in', `(${d.ids.join(',')})`)

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

  const rows = (data || []).map(row => {
    const out = { ...row }
    for (const ff of formulaFields) out[ff.key || ff.label] = evalFormula(ff.formula, row)
    return out
  })

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
  const columns = [...selectFields, ...formulaFields.map(f => f.key || f.label)]
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
    await supabase.from('saved_reports').delete().eq('id', id)
    loadReports()
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
        {mode === 'list' && <ListView reports={reports} runReport={runReport} startEdit={startEdit} deleteReport={deleteReport} startNew={startNew} toggleFavorite={toggleFavorite} moveToFolder={moveToFolder} />}

        {mode === 'build' && (
          <>
            {reports.length === 0 && (
              <div style={{ background: T.primaryLight, border: `1px solid ${T.primary}40`, borderLeft: `4px solid ${T.primary}`, borderRadius: 6, padding: '12px 16px', marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 800, color: T.primary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Report writer</div>
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.55 }}>
                  Pick a base table, choose fields, stack filters with AND/OR, add calculated columns, cross-reference other reports, group + aggregate. Preview results before saving.
                </div>
              </div>
            )}
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
          </>
        )}

        {mode === 'run' && (
          <RunView selectedReport={selectedReport} reportData={reportData} runningReport={runningReport} runError={runError} exportCsv={exportCsv} startEdit={startEdit} />
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────
function ListView({ reports, runReport, startEdit, deleteReport, startNew, toggleFavorite, moveToFolder }) {
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {filtered.map(r => {
              const cfg = r.query_config || {}
              const filterCount = (cfg.filter_groups || []).reduce((s, g) => s + (g.conditions?.length || 0), 0) + (cfg.filters?.length || 0)
              return (
                <Card key={r.id}
                  style={{ opacity: draggingId === r.id ? 0.4 : 1, cursor: r.is_prebuilt ? 'default' : 'grab' }}
                >
                  <div draggable={!r.is_prebuilt}
                    onDragStart={e => { e.dataTransfer.setData('text/plain', r.id); e.dataTransfer.effectAllowed = 'move'; setDraggingId(r.id) }}
                    onDragEnd={() => setDraggingId(null)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6, gap: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
                        <button onClick={(e) => { e.stopPropagation(); toggleFavorite(r) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 0, color: r.is_favorite ? T.warning : T.borderLight, lineHeight: 1 }}
                          title={r.is_favorite ? 'Unfavorite' : 'Favorite'}>★</button>
                        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                      </div>
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
                      {r.folder ? ` · ${r.folder}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button primary onClick={() => runReport(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Run</Button>
                      {!r.is_prebuilt && <Button onClick={() => startEdit(r)} style={{ padding: '4px 10px', fontSize: 11 }}>Edit</Button>}
                      {!r.is_prebuilt && <Button onClick={() => deleteReport(r.id)} style={{ padding: '4px 10px', fontSize: 11, color: T.error }}>Delete</Button>}
                    </div>
                  </div>
                </Card>
              )
            })}
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
