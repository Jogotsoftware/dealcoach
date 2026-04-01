import { useState } from 'react'
import { theme as T } from '../lib/theme'
import { TABLES } from '../lib/widgetSchema'
import { Button } from './Shared'

export default function WidgetFieldPicker({ onSelect, onClose }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState(null)

  const tables = Object.entries(TABLES).filter(([, t]) => {
    if (!search) return true
    const q = search.toLowerCase()
    return t.label.toLowerCase().includes(q) || Object.entries(t.fields).some(([k, f]) => f.label.toLowerCase().includes(q) || k.includes(q))
  })

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} onClick={onClose} />
      <div style={{ position: 'relative', zIndex: 3001, background: T.surface, border: '1px solid ' + T.border, borderRadius: 12, width: 520, maxHeight: '80vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid ' + T.border, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Select Field</span>
          <span style={{ cursor: 'pointer', color: T.textMuted, fontSize: 18 }} onClick={onClose}>&times;</span>
        </div>
        <div style={{ padding: '10px 20px', borderBottom: '1px solid ' + T.border }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tables and fields..."
            style={{ width: '100%', padding: '8px 12px', border: '1px solid ' + T.border, borderRadius: 6, fontSize: 13, outline: 'none', fontFamily: T.font, color: T.text, background: T.surface }} autoFocus />
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
          {tables.map(([tableKey, table]) => (
            <div key={tableKey}>
              <div onClick={() => setExpanded(expanded === tableKey ? null : tableKey)}
                style={{ padding: '8px 20px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: expanded === tableKey ? T.primaryLight : 'transparent' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: expanded === tableKey ? T.primary : T.text }}>{table.label}</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {table.multi && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: T.warningLight, color: T.warning, fontWeight: 600 }}>multi-row</span>}
                  {table.join && <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: T.surfaceAlt, color: T.textMuted }}>{table.join}</span>}
                  <span style={{ fontSize: 11, color: T.textMuted }}>{expanded === tableKey ? '\u25B2' : '\u25BC'}</span>
                </div>
              </div>
              {expanded === tableKey && (
                <div style={{ padding: '4px 20px 8px 32px' }}>
                  {Object.entries(table.fields)
                    .filter(([k, f]) => !search || f.label.toLowerCase().includes(search.toLowerCase()) || k.includes(search.toLowerCase()))
                    .map(([fieldKey, field]) => (
                      <div key={fieldKey} onClick={() => onSelect({ table: tableKey, field: fieldKey, label: field.label, type: field.type, options: field.options })}
                        style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, transition: 'background 0.1s' }}
                        onMouseEnter={e => e.currentTarget.style.background = T.surfaceHover}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        <span style={{ fontWeight: 500, color: T.text }}>{field.label}</span>
                        <span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{tableKey}.{fieldKey} <span style={{ color: T.primary, marginLeft: 4 }}>{field.type}</span></span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
