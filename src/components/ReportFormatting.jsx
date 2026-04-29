import React, { useState, useMemo, useEffect, useRef } from 'react'
import { theme as T } from '../lib/theme'
import { Button, inputStyle, labelStyle } from './Shared'
import { TABLES } from '../lib/widgetSchema'
import { evalTokens, validateTokens, formatValue, negativeColor, tokenChipColor, tokenChipLabel, FORMAT_TYPES } from '../lib/reportFormat'

// ─────────────────────────────────────────────────────────────────────────────
// formatCell — single source of truth for cell rendering inside the report grid.
// Used by tabular preview, summary detail rows, run view, and CSV export.
// `forCsv: true` returns plain text (no JSX, no color wrapping).
// `raw: true` skips formatting (Export Raw Values mode).
// ─────────────────────────────────────────────────────────────────────────────
export function formatCell(value, format, opts = {}) {
  const { forCsv = false, raw = false, fieldType = null } = opts
  if (value == null || value === '') return forCsv ? '' : '—'

  // Boolean derived flags render as Yes/No
  if (fieldType === 'boolean' || typeof value === 'boolean') {
    return value === true ? 'Yes' : value === false ? 'No' : ''
  }

  // Color chip — render the color word as a colored pill in UI; raw text in CSV
  if (fieldType === 'color_chip') {
    const v = String(value).toLowerCase()
    if (forCsv) return String(value)
    const color = v === 'red' ? '#dc2626' : v === 'green' ? '#16a34a' : T.textMuted
    return (
      <span style={{
        display: 'inline-block', padding: '2px 10px', borderRadius: 12,
        background: color + '22', color, fontSize: 11, fontWeight: 700, textTransform: 'capitalize',
      }}>{value}</span>
    )
  }

  // Bucket — Strong / Good / Weak chip
  if (fieldType === 'bucket') {
    if (forCsv) return String(value)
    const v = String(value)
    const color = v === 'Strong' ? '#16a34a' : v === 'Good' ? '#f59e0b' : v === 'Weak' ? '#dc2626' : T.textMuted
    return (
      <span style={{
        display: 'inline-block', padding: '2px 10px', borderRadius: 12,
        background: color + '22', color, fontSize: 11, fontWeight: 700,
      }}>{v}</span>
    )
  }

  if (raw || !format) {
    if (typeof value === 'object') return JSON.stringify(value).slice(0, 80)
    return String(value)
  }

  const formatted = formatValue(value, format)
  if (forCsv) return formatted

  const color = negativeColor(value, format)
  if (color) return <span style={{ color }}>{formatted}</span>
  return formatted
}

// ─────────────────────────────────────────────────────────────────────────────
// FormatMenu — popover triggered from a column header. Lets user pick:
//   type (number/decimal/currency/percentage/integer/abbreviated/custom)
//   precision, currency code, prefix, suffix, negative style
// Saves to cfg.column_formats[columnId].
// ─────────────────────────────────────────────────────────────────────────────
export function FormatMenu({ open, onClose, format, onChange, anchor = 'right' }) {
  if (!open) return null
  const f = format || { type: 'number', precision: 0 }
  const update = (patch) => onChange({ ...f, ...patch })

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 500 }} />
      <div style={{
        position: 'absolute', [anchor]: 0, top: '100%', zIndex: 501,
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.15)', padding: 10, minWidth: 240,
        fontFamily: T.font,
      }}>
        <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Format</div>
        <select value={f.type || 'number'} onChange={e => update({ type: e.target.value })} style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, marginBottom: 6 }}>
          <option value="number">Number — 1,234,567</option>
          <option value="decimal">Decimal — 1,234.56</option>
          <option value="currency">Currency — $1,234.56</option>
          <option value="percentage">Percentage — 12.34%</option>
          <option value="integer">Integer — 1,235</option>
          <option value="abbreviated">Abbreviated — 1.2M</option>
          <option value="custom">Custom — prefix/suffix</option>
        </select>

        {(f.type === 'decimal' || f.type === 'currency' || f.type === 'percentage' || f.type === 'abbreviated' || f.type === 'custom') && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: T.textMuted, flex: 1 }}>Precision</label>
            <select value={f.precision ?? 2} onChange={e => update({ precision: Number(e.target.value) })} style={{ ...inputStyle, padding: '3px 6px', fontSize: 12, width: 70 }}>
              {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        {f.type === 'currency' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: T.textMuted, flex: 1 }}>Currency</label>
            <select value={f.currency_code || 'USD'} onChange={e => update({ currency_code: e.target.value })} style={{ ...inputStyle, padding: '3px 6px', fontSize: 12, width: 90 }}>
              {['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        {f.type === 'percentage' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: T.text, marginBottom: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!f.percentage_already_pct} onChange={e => update({ percentage_already_pct: e.target.checked })} />
            Value already in 0–100 form
          </label>
        )}

        {(f.type === 'custom' || f.type === 'number' || f.type === 'integer' || f.type === 'decimal' || f.type === 'abbreviated') && (
          <>
            <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
              <input value={f.prefix || ''} onChange={e => update({ prefix: e.target.value })} placeholder="Prefix" style={{ ...inputStyle, padding: '3px 6px', fontSize: 11, flex: 1 }} />
              <input value={f.suffix || ''} onChange={e => update({ suffix: e.target.value })} placeholder="Suffix" style={{ ...inputStyle, padding: '3px 6px', fontSize: 11, flex: 1 }} />
            </div>
          </>
        )}

        <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '6px 0 4px' }}>Negative numbers</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
          {['minus', 'parens', 'red'].map(s => (
            <button key={s} onClick={() => update({ negative_style: s })}
              style={{
                flex: 1, padding: '4px 6px', fontSize: 10, fontWeight: 700,
                border: `1px solid ${(f.negative_style || 'minus') === s ? T.primary : T.border}`,
                background: (f.negative_style || 'minus') === s ? T.primaryLight : T.surface,
                color: (f.negative_style || 'minus') === s ? T.primary : T.text,
                borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize', fontFamily: T.font,
              }}>
              {s === 'minus' ? '−1,234' : s === 'parens' ? '(1,234)' : 'Red'}
            </button>
          ))}
        </div>

        <div style={{ borderTop: `1px solid ${T.borderLight}`, paddingTop: 6, marginTop: 4, fontSize: 10, color: T.textMuted }}>
          Preview: <span style={{ color: T.text, fontWeight: 700 }}>{formatValue(-1234.567, f) || '—'}</span>
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CalculatedColumnEditor — modal builder for tokenized formulas.
// Props:
//   field            — current calc-column object: { id, label, format, tokens }
//   baseEntity       — base table (e.g. 'deals') — used for field-tree drag source
//   sampleRow        — first row of preview data, for live preview
//   onSave(field)    — save handler
//   onCancel()       — close without saving
//   onDelete()       — remove this calculated column entirely (optional)
// ─────────────────────────────────────────────────────────────────────────────
export function CalculatedColumnEditor({ field, baseEntity, sampleRow, onSave, onCancel, onDelete }) {
  const [label, setLabel] = useState(field?.label || 'Calculated')
  const [tokens, setTokens] = useState(() => Array.isArray(field?.tokens) ? [...field.tokens] : [])
  const [format, setFormat] = useState(field?.format || { type: 'number', precision: 0 })
  const [literalInput, setLiteralInput] = useState('')
  const [error, setError] = useState(null)
  const [selectedIdx, setSelectedIdx] = useState(null)

  const validation = useMemo(() => validateTokens(tokens), [tokens])
  const previewValue = useMemo(() => {
    if (!validation.ok) return null
    if (!sampleRow) return null
    return evalTokens(tokens, sampleRow)
  }, [tokens, sampleRow, validation.ok])

  function addToken(tok) {
    setTokens(prev => {
      // If a token is selected and we're adding an op, replace it
      if (selectedIdx != null && tok.type === 'op' && prev[selectedIdx]?.type === 'op') {
        const next = [...prev]
        next[selectedIdx] = tok
        return next
      }
      return [...prev, tok]
    })
    setSelectedIdx(null)
  }

  function removeToken(idx) {
    setTokens(prev => prev.filter((_, i) => i !== idx))
    setSelectedIdx(null)
  }

  function moveToken(fromIdx, toIdx) {
    if (fromIdx === toIdx) return
    setTokens(prev => {
      const next = [...prev]
      const [m] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, m)
      return next
    })
  }

  function commitLiteral() {
    const n = Number(literalInput)
    if (Number.isFinite(n)) {
      addToken({ type: 'literal', value: n })
      setLiteralInput('')
    }
  }

  function save() {
    const v = validateTokens(tokens)
    if (!v.ok) {
      setError(v.error)
      return
    }
    onSave({
      type: 'calculated',
      id: field?.id || `calc_${Math.random().toString(36).slice(2, 8)}`,
      label: label.trim() || 'Calculated',
      format,
      tokens,
    })
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}
      onClick={onCancel}
    >
      <div onClick={e => e.stopPropagation()} style={{
        background: T.surface, borderRadius: 10, width: '90vw', maxWidth: 720,
        maxHeight: '90vh', overflow: 'auto', boxShadow: '0 14px 50px rgba(0,0,0,0.2)',
        fontFamily: T.font,
      }}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>{field?.tokens?.length ? 'Edit calculated column' : 'New calculated column'}</h3>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: T.textMuted }}>×</button>
        </div>

        <div style={{ padding: 18 }}>
          <label style={labelStyle}>Label</label>
          <input value={label} onChange={e => setLabel(e.target.value)} style={inputStyle} placeholder="e.g. ARR per employee" autoFocus />

          <label style={{ ...labelStyle, marginTop: 14 }}>Formula</label>
          <div
            onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
            onDrop={e => {
              e.preventDefault()
              try {
                const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                if (d?.kind === 'add' || d?.kind === 'db-field') {
                  const table = d.join || baseEntity
                  addToken({ type: 'field', table, column: d.field })
                }
              } catch {}
            }}
            style={{
              minHeight: 56, padding: 8, border: `2px dashed ${tokens.length ? T.primary + '55' : T.border}`,
              borderRadius: 6, background: T.surfaceAlt, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center',
            }}
            tabIndex={0}
            onKeyDown={e => {
              if (e.key === 'Backspace' && tokens.length) setTokens(prev => prev.slice(0, -1))
            }}
          >
            {tokens.length === 0 && (
              <span style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>
                Drag fields from the report builder field tree → drop here. Or use the operator buttons below.
              </span>
            )}
            {tokens.map((t, i) => (
              <div key={i}
                draggable
                onDragStart={e => { e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'token-move', fromIdx: i })); e.dataTransfer.effectAllowed = 'move' }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault(); e.stopPropagation()
                  try {
                    const d = JSON.parse(e.dataTransfer.getData('text/plain'))
                    if (d?.kind === 'token-move' && d.fromIdx !== i) moveToken(d.fromIdx, i)
                    else if (d?.kind === 'add' || d?.kind === 'db-field') {
                      const table = d.join || baseEntity
                      setTokens(prev => {
                        const next = [...prev]
                        next.splice(i, 0, { type: 'field', table, column: d.field })
                        return next
                      })
                    }
                  } catch {}
                }}
                onClick={() => setSelectedIdx(selectedIdx === i ? null : i)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 10px', borderRadius: 14, fontSize: 12, fontWeight: 600,
                  background: tokenChipColor(t) + '22', color: tokenChipColor(t),
                  border: `1px solid ${selectedIdx === i ? T.primary : tokenChipColor(t) + '55'}`,
                  cursor: 'grab', userSelect: 'none', fontFamily: t.type === 'op' ? T.mono : T.font,
                }}>
                {t.type === 'field' && (
                  <span style={{ fontSize: 9, opacity: 0.7, fontFamily: T.mono }}>{t.table}.</span>
                )}
                <span>{tokenChipLabel(t)}</span>
                <button onClick={(e) => { e.stopPropagation(); removeToken(i) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', opacity: 0.5, fontSize: 13, padding: 0 }}>×</button>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
            {[['+', '+'], ['-', '−'], ['*', '×'], ['/', '÷']].map(([v, lbl]) => (
              <button key={v} onClick={() => addToken({ type: 'op', value: v })}
                style={{
                  padding: '6px 14px', fontSize: 14, fontWeight: 700, border: `1px solid ${T.border}`,
                  background: T.surface, color: T.text, borderRadius: 6, cursor: 'pointer',
                  fontFamily: T.mono, minWidth: 36,
                }}>
                {lbl}
              </button>
            ))}
            <button onClick={() => addToken({ type: 'paren', value: '(' })}
              style={{ padding: '6px 14px', fontSize: 14, fontWeight: 700, border: `1px solid ${T.border}`, background: T.surface, color: T.text, borderRadius: 6, cursor: 'pointer', fontFamily: T.mono }}>
              (
            </button>
            <button onClick={() => addToken({ type: 'paren', value: ')' })}
              style={{ padding: '6px 14px', fontSize: 14, fontWeight: 700, border: `1px solid ${T.border}`, background: T.surface, color: T.text, borderRadius: 6, cursor: 'pointer', fontFamily: T.mono }}>
              )
            </button>
            <input value={literalInput} onChange={e => setLiteralInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commitLiteral() }}
              placeholder="123…"
              type="number"
              style={{ ...inputStyle, padding: '5px 8px', fontSize: 12, width: 90 }} />
            <button onClick={commitLiteral} disabled={!literalInput || !Number.isFinite(Number(literalInput))}
              style={{
                padding: '6px 12px', fontSize: 11, fontWeight: 700,
                border: `1px solid ${T.primary}`, background: T.primaryLight, color: T.primary,
                borderRadius: 6, cursor: literalInput ? 'pointer' : 'not-allowed', opacity: literalInput ? 1 : 0.5,
              }}>
              + Literal
            </button>
          </div>

          {!validation.ok && tokens.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: T.errorLight, color: T.error, borderRadius: 4, fontSize: 11, border: `1px solid ${T.error}40` }}>
              {validation.error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 16 }}>
            <div>
              <label style={labelStyle}>Format</label>
              <select value={format.type || 'number'} onChange={e => setFormat({ ...format, type: e.target.value })}
                style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
                <option value="number">Number</option>
                <option value="decimal">Decimal</option>
                <option value="currency">Currency</option>
                <option value="percentage">Percentage</option>
                <option value="integer">Integer</option>
                <option value="abbreviated">Abbreviated</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Precision</label>
              <select value={format.precision ?? 2} onChange={e => setFormat({ ...format, precision: Number(e.target.value) })}
                style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
                {[0, 1, 2, 3, 4, 5, 6].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {format.type === 'currency' && (
              <div>
                <label style={labelStyle}>Currency</label>
                <select value={format.currency_code || 'USD'} onChange={e => setFormat({ ...format, currency_code: e.target.value })}
                  style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}>
                  {['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY'].map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            )}
            {format.type === 'custom' && (
              <>
                <div>
                  <label style={labelStyle}>Prefix</label>
                  <input value={format.prefix || ''} onChange={e => setFormat({ ...format, prefix: e.target.value })} style={inputStyle} placeholder="" />
                </div>
                <div>
                  <label style={labelStyle}>Suffix</label>
                  <input value={format.suffix || ''} onChange={e => setFormat({ ...format, suffix: e.target.value })} style={inputStyle} placeholder=" days" />
                </div>
              </>
            )}
          </div>

          <div style={{ marginTop: 14, padding: 10, background: T.surfaceAlt, borderRadius: 6, fontSize: 12, color: T.text }}>
            <span style={{ color: T.textMuted, marginRight: 6 }}>Preview:</span>
            {previewValue == null
              ? <span style={{ color: T.textMuted, fontStyle: 'italic' }}>{validation.ok ? 'Run a preview to see the value' : 'Fix formula errors first'}</span>
              : <strong>{formatValue(previewValue, format)}</strong>}
            {sampleRow && previewValue != null && <span style={{ color: T.textMuted, marginLeft: 8, fontSize: 10 }}>(from row 1)</span>}
          </div>

          {error && <div style={{ marginTop: 10, color: T.error, fontSize: 12 }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: `1px solid ${T.border}`, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div>
            {onDelete && field?.id && (
              <Button onClick={() => { if (window.confirm('Remove this calculated column?')) onDelete() }}
                style={{ padding: '6px 14px', fontSize: 12, color: T.error }}>Remove</Button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onCancel} style={{ padding: '6px 14px', fontSize: 12 }}>Cancel</Button>
            <Button primary onClick={save} disabled={!validation.ok || !label.trim()}
              style={{ padding: '6px 14px', fontSize: 12 }}>Save column</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
