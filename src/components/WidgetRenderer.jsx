import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatCurrency, formatDate } from '../lib/theme'
import { Badge, ScoreBar, inputStyle } from './Shared'
import { executeWidgetQuery, aggregate, resolveField } from '../lib/widgetQuery'
import { executeSavedReport, fetchSavedReport, groupAndAggregate, scalarAggregate } from '../lib/reportQuery'

const CHART_PALETTE = ['#5DADE2', '#28a745', '#f59e0b', '#8b5cf6', '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6', '#f97316', '#6366f1']

const BADGE_COLORS = {
  qualify: '#f59e0b', discovery: '#f97316', solution_validation: '#8b5cf6', confirming_value: '#0ea5e9', selection: '#10b981',
  closed_won: '#28a745', closed_lost: '#dc3545', disqualified: '#999',
  pipeline: '#9ca3af', upside: '#f59e0b', forecast: '#0ea5e9', commit: '#10b981',
  high: '#dc3545', medium: '#f59e0b', low: '#6c757d',
  critical: '#dc3545', strong: '#28a745', weak: '#dc3545',
  open: '#dc3545', mitigating: '#f59e0b', mitigated: '#28a745', accepted: '#999', closed: '#999',
  red: '#dc3545', green: '#28a745',
}

function formatValue(val, format, fieldConfig) {
  if (val == null || val === '' || val === 'Unknown') {
    if (format?.type === 'currency') return '$0'
    if (format?.type === 'number') return '0'
    return val === 'Unknown' ? <span style={{ color: '#dc3545', fontStyle: 'italic' }}>Unknown</span> : '\u2014'
  }
  switch (format?.type) {
    case 'currency': return <span style={{ color: '#2ecc71', fontWeight: 700 }}>{formatCurrency(Number(val))}</span>
    case 'number': return Number(val).toLocaleString()
    case 'percentage': return Math.round(Number(val)) + '%'
    case 'date': return formatDate(val)
    case 'badge': {
      const color = BADGE_COLORS[val] || (format.badge_map?.[val]) || T.textMuted
      return <Badge color={color}>{String(val).replace(/_/g, ' ')}</Badge>
    }
    case 'boolean': return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: val ? '#28a745' : '#dc3545' }} />
    case 'score': return <ScoreBar score={Number(val) || 0} max={10} />
    default: return String(val)
  }
}

function applyConditionalStyle(row, rules, fieldId) {
  if (!rules?.length) return {}
  for (const rule of rules) {
    if (rule.scope === 'cell' && rule.target_field !== fieldId) continue
    const match = (rule.conditions || []).every(cond => {
      const val = row[cond.field] ?? resolveField(row, { field: cond.field })
      switch (cond.operator) {
        case 'is_unknown': return val === 'Unknown' || val == null || val === ''
        case 'is_empty': return val == null || val === ''
        case 'is_not_empty': return val != null && val !== ''
        case 'equals': return val == cond.value
        case 'not_equals': return val != cond.value
        case 'less_than': return Number(val) < Number(cond.value)
        case 'greater_than': return Number(val) > Number(cond.value)
        case 'contains': return String(val).toLowerCase().includes(String(cond.value).toLowerCase())
        default: return false
      }
    })
    if (match) return rule.style || {}
  }
  return {}
}

function CellValue({ row, field, section, navigate }) {
  const val = resolveField(row, field)
  const style = applyConditionalStyle(row, section.conditional_rules, field.id)
  const formatted = formatValue(val, field.format || { type: field.type }, field)
  const action = field.click_action

  if (action?.type === 'navigate_deal' && row.id) {
    return <span style={{ color: T.primary, cursor: 'pointer', textDecoration: 'underline', ...style }} onClick={() => navigate('/deal/' + row.id)}>{formatted}</span>
  }
  if (action?.type === 'open_url' && val) {
    const href = String(val).startsWith('http') ? val : 'https://' + val
    return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: T.primary, textDecoration: 'none', ...style }}>{formatted} {'\u2197'}</a>
  }
  if (action?.type === 'copy') {
    return <span style={{ cursor: 'pointer', textDecoration: 'underline dashed', ...style }} onClick={() => { navigator.clipboard.writeText(String(val || '')) }}>{formatted}</span>
  }
  if (action?.type === 'inline_edit') {
    return <InlineEditCell row={row} field={field} section={section} val={val} formatted={formatted} style={style} />
  }
  return <span style={style}>{formatted}</span>
}

// Resolve which (table, row id) the inline-edit should write to. The widget
// query joins related tables via `<table>(*)`, so a joined record sits at
// row[field.table] as an object (one-to-one) or array (one-to-many).
//   field on base table        → write to baseTable WHERE id = row.id
//   field on joined object     → write to field.table WHERE id = row[field.table].id
//   field on joined array      → write to first element's id (mirrors how
//                                resolveField reads the value back)
// Returns { table, id, applyLocal(next) } or null if nothing addressable.
function resolveEditTarget(row, field, baseTable) {
  if (!field?.table || !field?.field) return null
  if (field.table === baseTable || !(field.table in row)) {
    if (!row?.id) return null
    return {
      table: baseTable || field.table,
      id: row.id,
      applyLocal: (next) => { row[field.field] = next },
    }
  }
  const joined = row[field.table]
  if (Array.isArray(joined)) {
    const first = joined[0]
    if (!first?.id) return null
    return {
      table: field.table,
      id: first.id,
      applyLocal: (next) => { first[field.field] = next },
    }
  }
  if (joined && typeof joined === 'object') {
    if (!joined.id) return null
    return {
      table: field.table,
      id: joined.id,
      applyLocal: (next) => { joined[field.field] = next },
    }
  }
  return null
}

// Click a cell, edit in place, save on blur or Enter. Resolves the right
// target table + id even when the column lives on a joined table.
function InlineEditCell({ row, field, section, val, formatted, style }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(val == null ? '' : String(val))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(val == null ? '' : String(val)) }, [val])

  const baseTable = section?.data_source?.base_table

  async function commit() {
    if (saving) return
    const cur = val == null ? '' : String(val)
    if (draft === cur) { setEditing(false); return }
    const target = resolveEditTarget(row, field, baseTable)
    if (!target) {
      alert('Cannot edit this cell — no addressable id for ' + (field?.table || 'this field') + '.')
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      let next = draft
      if (field.type === 'number' || field.type === 'currency' || field.type === 'percentage' || field.type === 'score') {
        next = draft === '' ? null : Number(draft)
        if (Number.isNaN(next)) { alert('Not a number.'); setSaving(false); return }
      } else if (next === '') {
        next = null
      }
      const { error } = await supabase.from(target.table).update({ [field.field]: next }).eq('id', target.id)
      if (error) {
        console.error('inline_edit update failed:', error)
        alert('Save failed: ' + error.message)
        setDraft(cur)
        setSaving(false)
        return
      }
      // Mirror the change into the in-memory row so the cell reflects the
      // new value without forcing the widget to re-fetch.
      target.applyLocal(next)
    } catch (e) {
      console.error('inline_edit threw:', e)
      alert('Save failed: ' + (e?.message || 'unknown error'))
      setDraft(cur)
    }
    setSaving(false)
    setEditing(false)
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        title="Click to edit"
        style={{ cursor: 'pointer', borderBottom: `1px dashed ${T.border}`, padding: '0 2px', ...style }}
      >
        {formatted || <span style={{ color: T.textMuted, fontStyle: 'italic' }}>\u2014</span>}
      </span>
    )
  }
  return (
    <input
      autoFocus
      value={draft}
      type={field.type === 'date' ? 'date' : (field.type === 'number' || field.type === 'currency' || field.type === 'percentage' || field.type === 'score') ? 'number' : 'text'}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') { e.preventDefault(); commit() }
        if (e.key === 'Escape') { setDraft(val == null ? '' : String(val)); setEditing(false) }
      }}
      style={{ ...inputStyle, fontSize: 12, padding: '2px 6px', width: '100%', minWidth: 0 }}
    />
  )
}

// === SECTION RENDERERS ===

function MetricSection({ section, data }) {
  const fields = section.data_source?.fields || []
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {fields.map(f => {
        const agg = f.aggregate || 'count'
        const val = aggregate(data, f.field, agg)
        const formatted = formatValue(val, f.format || { type: f.type }, f)
        return (
          <div key={f.id || f.field} style={{ flex: 1, minWidth: 80, textAlign: 'center', padding: 10, background: T.surfaceAlt, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', marginBottom: 4 }}>{f.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{formatted}</div>
          </div>
        )
      })}
    </div>
  )
}

function TableSection({ section, data, navigate }) {
  const fields = section.data_source?.fields || []
  const [sortField, setSortField] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const sorted = [...data].sort((a, b) => {
    if (!sortField) return 0
    const av = resolveField(a, sortField), bv = resolveField(b, sortField)
    const d = sortDir === 'asc' ? 1 : -1
    if (av == null) return d
    if (bv == null) return -d
    if (typeof av === 'number') return d * (av - bv)
    return d * String(av).localeCompare(String(bv))
  })

  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>{fields.map(f => (
            <th key={f.id || f.field} onClick={() => { if (f.sortable !== false) { setSortField(f); setSortDir(d => sortField === f && d === 'asc' ? 'desc' : 'asc') } }}
              style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: sortField === f ? T.primary : '#8899aa', textTransform: 'uppercase', borderBottom: '1px solid ' + T.border, cursor: f.sortable !== false ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
              {f.label}{sortField === f ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : ''}
            </th>
          ))}</tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => {
            const rowStyle = applyConditionalStyle(row, section.conditional_rules?.filter(r => r.scope === 'row'))
            return (
              <tr key={row.id || i} style={{ borderBottom: '1px solid ' + T.borderLight, ...rowStyle }}>
                {fields.map(f => (
                  <td key={f.id || f.field} style={{ padding: '8px' }}>
                    <CellValue row={row} field={f} section={section} navigate={navigate} />
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.length === 0 && <div style={{ textAlign: 'center', padding: 16, color: T.textMuted, fontSize: 12 }}>No data</div>}
    </div>
  )
}

function CardSection({ section, data, navigate }) {
  const fields = section.data_source?.fields || []
  const cols = section.layout?.columns || 2
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {fields.map(f => {
        const val = data[0] ? resolveField(data[0], f) : null
        return (
          <div key={f.id || f.field} style={{ padding: 8, background: T.surfaceAlt, borderRadius: 6 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', marginBottom: 2 }}>{f.label}</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{data[0] ? <CellValue row={data[0]} field={f} section={section} navigate={navigate} /> : '\u2014'}</div>
          </div>
        )
      })}
    </div>
  )
}

function GridSection({ section, data, navigate }) {
  const fields = section.data_source?.fields || []
  const cols = section.layout?.columns || 3
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 8 }}>
      {data.map((row, i) => (
        <div key={row.id || i} style={{ padding: 10, background: T.surfaceAlt, borderRadius: 6, border: '1px solid ' + T.borderLight }}>
          {fields.map(f => (
            <div key={f.id || f.field} style={{ marginBottom: 2 }}>
              <CellValue row={row} field={f} section={section} navigate={navigate} />
            </div>
          ))}
        </div>
      ))}
      {data.length === 0 && <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 12, color: T.textMuted, fontSize: 12 }}>No data</div>}
    </div>
  )
}

function ListSection({ section, data, navigate }) {
  const fields = section.data_source?.fields || []
  const primaryField = fields[0]
  const secondaryFields = fields.slice(1)
  return (
    <div>
      {data.map((row, i) => {
        const rowStyle = applyConditionalStyle(row, section.conditional_rules?.filter(r => r.scope === 'row'))
        return (
          <div key={row.id || i} style={{ padding: '6px 0', borderBottom: '1px solid ' + T.borderLight, borderLeft: '3px solid ' + T.border, paddingLeft: 10, ...rowStyle }}>
            {primaryField && <div style={{ fontSize: 12, fontWeight: 600 }}><CellValue row={row} field={primaryField} section={section} navigate={navigate} /></div>}
            {secondaryFields.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                {secondaryFields.map(f => <span key={f.id || f.field} style={{ fontSize: 10, color: T.textMuted }}><CellValue row={row} field={f} section={section} navigate={navigate} /></span>)}
              </div>
            )}
          </div>
        )
      })}
      {data.length === 0 && <div style={{ textAlign: 'center', padding: 12, color: T.textMuted, fontSize: 12 }}>No data</div>}
    </div>
  )
}

// === SAVED-REPORT-BACKED WIDGET ===
// Rendered when a custom_widget_definitions row has config.source = 'saved_report'.
// Pulls the saved_report's data once and displays it per config.visualization.

function ReportTableView({ rows, columns, onColumnsChange }) {
  const navigate = useNavigate()
  if (!rows?.length) return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No data</div>
  const cols = columns?.length ? columns : Object.keys(rows[0]).filter(k => k !== 'id').slice(0, 6)
  const editable = typeof onColumnsChange === 'function'
  const removeCol = (c) => {
    if (!editable) return
    // If caller hasn't given us an explicit list yet, materialise the shown set then drop the column
    const base = columns?.length ? columns : cols
    onColumnsChange(base.filter(x => x !== c))
  }
  return (
    <div style={{ overflow: 'auto', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: T.surfaceAlt }}>
            {cols.map(c => (
              <th key={c} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', borderBottom: `1px solid ${T.border}`, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {c.replace(/_/g, ' ')}
                  {editable && (
                    <button
                      onClick={(e) => { e.stopPropagation(); removeCol(c) }}
                      title={`Remove "${c.replace(/_/g, ' ')}" from widget`}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.4, transition: 'opacity 0.1s, color 0.1s' }}
                      onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.color = T.error }}
                      onMouseLeave={e => { e.currentTarget.style.opacity = 0.4; e.currentTarget.style.color = T.textMuted }}>
                      ×
                    </button>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 500).map((r, i) => (
            <tr key={r.id || i} style={{ borderBottom: `1px solid ${T.borderLight}`, cursor: r.id && cols.includes('company_name') && !editable ? 'pointer' : 'default' }}
              onClick={() => { if (editable) return; if (r.id && cols.includes('company_name')) navigate('/deal/' + r.id) }}>
              {cols.map(c => {
                const val = r[c]
                const disp = val == null ? '—' : typeof val === 'object' ? JSON.stringify(val).substring(0, 40) : String(val)
                return <td key={c} style={{ padding: '6px 8px', color: T.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{disp}</td>
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BarChart({ data, horizontal = false }) {
  if (!data?.length) return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No data</div>
  const max = Math.max(...data.map(d => Number(d.value) || 0), 1)
  if (horizontal) {
    return (
      <div style={{ padding: '8px 4px', overflow: 'auto', height: '100%' }}>
        {data.slice(0, 20).map((d, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: T.text, width: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={d.label}>{d.label}</div>
            <div style={{ flex: 1, height: 16, background: T.surfaceAlt, borderRadius: 3, position: 'relative' }}>
              <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: CHART_PALETTE[i % CHART_PALETTE.length], borderRadius: 3, transition: 'width 0.3s' }} />
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.text, minWidth: 40, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{typeof d.value === 'number' && !Number.isInteger(d.value) ? d.value.toFixed(1) : d.value.toLocaleString?.() ?? d.value}</div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'flex-end', gap: 6, padding: '12px 8px 24px' }}>
      {data.slice(0, 20).map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{typeof d.value === 'number' && !Number.isInteger(d.value) ? d.value.toFixed(1) : d.value.toLocaleString?.() ?? d.value}</div>
          <div style={{ width: '100%', height: `${Math.max((d.value / max) * 100, 2)}%`, background: CHART_PALETTE[i % CHART_PALETTE.length], borderRadius: '3px 3px 0 0', transition: 'height 0.3s' }} />
          <div style={{ fontSize: 9, color: T.textMuted, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }} title={d.label}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}

function PieChart({ data }) {
  if (!data?.length) return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No data</div>
  const total = data.reduce((s, d) => s + (Number(d.value) || 0), 0)
  if (total <= 0) return <div style={{ padding: 16, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>No data</div>
  let accum = 0
  const slices = data.slice(0, 10).map((d, i) => {
    const start = (accum / total) * 360
    accum += Number(d.value) || 0
    const end = (accum / total) * 360
    return { ...d, start, end, color: CHART_PALETTE[i % CHART_PALETTE.length] }
  })
  // SVG pie using paths
  const r = 60, cx = 70, cy = 70
  function arcPath(start, end) {
    const s = (start - 90) * Math.PI / 180
    const e = (end - 90) * Math.PI / 180
    const x1 = cx + r * Math.cos(s), y1 = cy + r * Math.sin(s)
    const x2 = cx + r * Math.cos(e), y2 = cy + r * Math.sin(e)
    const large = end - start > 180 ? 1 : 0
    return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 8, height: '100%' }}>
      <svg width={140} height={140} viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
        {slices.map((s, i) => <path key={i} d={arcPath(s.start, s.end)} fill={s.color} stroke="#fff" strokeWidth="1" />)}
      </svg>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', maxHeight: 140 }}>
        {slices.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
            <span style={{ width: 10, height: 10, background: s.color, borderRadius: 2, flexShrink: 0 }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: T.text }} title={s.label}>{s.label}</span>
            <span style={{ fontWeight: 700, color: T.textMuted, fontFeatureSettings: '"tnum"' }}>{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function MetricTile({ value, label }) {
  const display = typeof value === 'number'
    ? (Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2))
    : String(value ?? '—')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: 16, gap: 8 }}>
      <div style={{ fontSize: 40, fontWeight: 800, color: T.primary, fontFeatureSettings: '"tnum"', lineHeight: 1 }}>{display}</div>
      {label && <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>{label}</div>}
    </div>
  )
}

function SavedReportWidget({ config, onColumnsChange }) {
  const [state, setState] = useState({ loading: true, report: null, rows: [], error: null })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setState(s => ({ ...s, loading: true, error: null }))
      try {
        const report = await fetchSavedReport(config.saved_report_id)
        if (!report) throw new Error('Report not found')
        const { rows } = await executeSavedReport(report, { limit: config.limit || 500 })
        if (!cancelled) setState({ loading: false, report, rows, error: null })
      } catch (err) {
        if (!cancelled) setState({ loading: false, report: null, rows: [], error: err.message || String(err) })
      }
    }
    load()
    return () => { cancelled = true }
  }, [config.saved_report_id, config.limit])

  if (state.loading) return <div style={{ padding: 12, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>Loading...</div>
  if (state.error) return <div style={{ padding: 12, fontSize: 11, color: T.error }}>{state.error}</div>

  const viz = config.visualization || 'table'
  const rows = state.rows
  const groupBy = config.group_by
  const valueField = config.value_field
  const aggregate = config.aggregate || 'count'

  if (viz === 'metric') {
    const v = scalarAggregate(rows, valueField, aggregate)
    const lbl = config.metric_label || state.report?.name || ''
    return <MetricTile value={v} label={lbl} />
  }
  if (viz === 'bar' || viz === 'hbar' || viz === 'pie') {
    const data = groupAndAggregate(rows, groupBy, valueField, aggregate)
    if (viz === 'pie') return <PieChart data={data} />
    return <BarChart data={data} horizontal={viz === 'hbar'} />
  }
  // Default: table
  return <ReportTableView rows={rows} columns={config.columns} onColumnsChange={onColumnsChange} />
}

// === MAIN RENDERER ===

export default function WidgetRenderer({ config, context, onColumnsChange }) {
  const navigate = useNavigate()
  const [sectionData, setSectionData] = useState({})
  const [loading, setLoading] = useState(true)

  const isReportBacked = config?.source === 'saved_report' && config?.saved_report_id

  useEffect(() => {
    if (isReportBacked) return
    async function load() {
      setLoading(true)
      const results = {}
      for (let i = 0; i < (config.sections || []).length; i++) {
        const section = config.sections[i]
        const { data } = await executeWidgetQuery(section, context)
        results[i] = data
      }
      setSectionData(results)
      setLoading(false)
    }
    load()
  }, [config, context?.deal_id, isReportBacked])

  if (isReportBacked) return <SavedReportWidget config={config} onColumnsChange={onColumnsChange} />

  if (loading) return <div style={{ padding: 12, textAlign: 'center', color: T.textMuted, fontSize: 11 }}>Loading...</div>

  return (
    <div>
      {(config.sections || []).map((section, i) => {
        const data = sectionData[i] || []
        switch (section.type) {
          case 'metric': return <MetricSection key={i} section={section} data={data} />
          case 'table': return <TableSection key={i} section={section} data={data} navigate={navigate} />
          case 'card': return <CardSection key={i} section={section} data={data} navigate={navigate} />
          case 'grid': return <GridSection key={i} section={section} data={data} navigate={navigate} />
          case 'list': return <ListSection key={i} section={section} data={data} navigate={navigate} />
          default: return <div key={i} style={{ color: T.textMuted, fontSize: 11 }}>Unknown section type: {section.type}</div>
        }
      })}
    </div>
  )
}
