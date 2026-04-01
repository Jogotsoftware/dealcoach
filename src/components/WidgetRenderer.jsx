import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { theme as T, formatCurrency, formatDate } from '../lib/theme'
import { Badge, ScoreBar } from './Shared'
import { executeWidgetQuery, aggregate, resolveField } from '../lib/widgetQuery'

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
  return <span style={style}>{formatted}</span>
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

// === MAIN RENDERER ===

export default function WidgetRenderer({ config, context }) {
  const navigate = useNavigate()
  const [sectionData, setSectionData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
  }, [config, context?.deal_id])

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
