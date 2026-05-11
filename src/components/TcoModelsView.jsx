import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Card, Badge, Button, EmptyState, inputStyle } from './Shared'

const SCENARIO_TYPE_LABEL = {
  sage_offer: 'Sage Offer',
  client_ask: 'Client Ask',
  competitor: 'Competitor',
  alternate: 'Alternate',
}
const SCENARIO_TYPE_COLOR = {
  sage_offer: '#5DADE2',
  client_ask: '#f59e0b',
  competitor: '#a855f7',
  alternate: '#64748b',
}

function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// Ceil to nearest cent, then format. Negatives render in parens, never as a
// raw "-$" prefix. Whole-dollar values hide the cents to stay clean in the
// year columns; values with fractional cents show 2 decimals.
function fmt(v) {
  const n = Number(v)
  if (!isFinite(n) || n === 0) return '$0'
  const sign = n < 0
  const abs = Math.abs(n)
  const ceiled = Math.ceil(abs * 100) / 100
  const hasCents = Math.round(ceiled * 100) % 100 !== 0
  const formatted = ceiled.toLocaleString('en-US', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  })
  return sign ? `($${formatted})` : `$${formatted}`
}

// Build the matrix data for one scenario. Free-months value lives in the
// Total column only — never in any Y1..Yn cell — per spec.
function buildMatrix({ subscriptionY1, implementation, signingBonus, freeMonthsValue, termYears, yoyPctList, customLines }) {
  const horizon = Math.max(1, Number(termYears) || 1)
  const subsByYear = []
  let running = Number(subscriptionY1) || 0
  for (let y = 1; y <= horizon; y++) {
    if (y === 1) subsByYear.push(running)
    else {
      const cap = Number(yoyPctList?.[y - 1]) || 0
      running = running * (1 + cap / 100)
      subsByYear.push(running)
    }
  }
  const subsTotal = subsByYear.reduce((s, v) => s + v, 0)

  const sb = Number(signingBonus) || 0
  const fmv = Number(freeMonthsValue) || 0
  const impl = Number(implementation) || 0

  // Custom lines: applied to Y1 only, can be positive (cost) or negative
  // (deduction). Each line's "amount" is the raw value the user entered;
  // we render it as-is so the user controls the sign.
  const customY1Sum = (customLines || []).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  const customTotal = customY1Sum

  // Per-year totals: subs in every year, plus Y1-only adjustments
  // (impl − signing bonus + custom lines). Free months is NOT folded
  // into any year — it's deducted once at the grand total.
  const totalsByYear = subsByYear.map((subs, idx) => {
    if (idx === 0) return subs + impl - sb + customY1Sum
    return subs
  })
  const grandTotal = totalsByYear.reduce((s, v) => s + v, 0) - fmv

  return {
    horizon, subsByYear, subsTotal,
    impl, signingBonus: sb, freeMonthsValue: fmv,
    customLines: customLines || [], customTotal,
    totalsByYear, grandTotal,
  }
}

// Derives the Sage Offer baseline from the parent quote + its contract term.
function deriveSageMatrix(parentQuote, contractTerm) {
  const sageY1 = Number(parentQuote.sage_subscription_total) || 0
  const impl = Number(parentQuote.sage_implementation_total) || 0
  const sageMonthly = sageY1 / 12
  const signingBonus = Number(parentQuote.signing_bonus_amount) > 0
    ? Number(parentQuote.signing_bonus_amount)
    : sageMonthly * (Number(parentQuote.signing_bonus_months) || 0)
  const freeMonths = Number(parentQuote.free_months) || 0
  const freeMonthsValue = sageMonthly * freeMonths
  const termYears = contractTerm?.term_years || 3
  const yoyCaps = Array.isArray(contractTerm?.yoy_caps) ? contractTerm.yoy_caps : []
  return buildMatrix({
    subscriptionY1: sageY1,
    implementation: impl,
    signingBonus,
    freeMonthsValue,
    termYears,
    yoyPctList: yoyCaps,
    customLines: [],
  })
}

// Builds a matrix for a user-defined scenario from its JSON fields.
function deriveScenarioMatrix(scenario) {
  const yoyPct = Number(scenario.yoy_pct) || 0
  const termYears = Number(scenario.term_years) || 3
  // Same YoY applied each year past Y1.
  const yoyPctList = []
  for (let y = 1; y <= termYears; y++) yoyPctList.push(yoyPct)
  return buildMatrix({
    subscriptionY1: scenario.subscription_y1,
    implementation: scenario.implementation,
    signingBonus: 0,
    freeMonthsValue: 0,
    termYears,
    yoyPctList,
    customLines: scenario.lines || [],
  })
}

function defaultScenario(parentQuote) {
  // Seed values from the parent quote so the rep has a starting point — they
  // can edit immediately. Single YoY % matches the most-recent year in the
  // contract term if present.
  return {
    id: newId(),
    label: '',
    type: 'client_ask',
    subscription_y1: Number(parentQuote?.sage_subscription_total) || 0,
    implementation: Number(parentQuote?.sage_implementation_total) || 0,
    term_years: 3,
    yoy_pct: 5,
    lines: [],
  }
}

// Public component. Props:
//   parentQuote     — full quote row (we write back to its tco_scenarios)
//   contractTerms   — list of contract_terms rows (looked up by id for Sage)
//   readOnly        — true on the customer-facing Evaluation Room surface;
//                     hides all editing controls.
//   onScenariosChange — optional callback fired after each persist (lets the
//                     parent refresh its in-memory copy of the quote).
export default function TcoModelsView({ parentQuote, contractTerms, readOnly = false, onScenariosChange }) {
  // Local mirror of the JSONB array — lets us render keystrokes immediately
  // and debounce DB writes. Server is the source of truth on reload.
  const [scenarios, setScenarios] = useState(() => Array.isArray(parentQuote?.tco_scenarios) ? parentQuote.tco_scenarios : [])
  // Reset when parent quote id changes (different deal / quote).
  useEffect(() => {
    setScenarios(Array.isArray(parentQuote?.tco_scenarios) ? parentQuote.tco_scenarios : [])
  }, [parentQuote?.id])

  const sageMatrix = useMemo(() => {
    const term = contractTerms?.find(ct => ct.id === parentQuote?.contract_term_id)
    return deriveSageMatrix(parentQuote || {}, term)
  }, [parentQuote, contractTerms])

  async function persist(next) {
    setScenarios(next)
    if (readOnly || !parentQuote?.id) return
    try {
      const { error } = await supabase.from('quotes').update({ tco_scenarios: next }).eq('id', parentQuote.id)
      if (error) console.error('[TcoModelsView] persist failed:', error.message)
      else onScenariosChange?.(next)
    } catch (e) {
      console.error('[TcoModelsView] persist threw:', e.message)
    }
  }

  function addScenario() {
    persist([...scenarios, defaultScenario(parentQuote)])
  }
  function updateScenario(id, patch) {
    persist(scenarios.map(s => s.id === id ? { ...s, ...patch } : s))
  }
  function deleteScenario(id) {
    persist(scenarios.filter(s => s.id !== id))
  }
  function addLine(scenarioId) {
    persist(scenarios.map(s => s.id === scenarioId
      ? { ...s, lines: [...(s.lines || []), { id: newId(), label: '', amount: 0 }] }
      : s
    ))
  }
  function updateLine(scenarioId, lineId, patch) {
    persist(scenarios.map(s => s.id === scenarioId
      ? { ...s, lines: (s.lines || []).map(l => l.id === lineId ? { ...l, ...patch } : l) }
      : s
    ))
  }
  function deleteLine(scenarioId, lineId) {
    persist(scenarios.map(s => s.id === scenarioId
      ? { ...s, lines: (s.lines || []).filter(l => l.id !== lineId) }
      : s
    ))
  }

  if (!parentQuote || (!parentQuote.sage_subscription_total && scenarios.length === 0)) {
    return (
      <EmptyState
        title="Nothing to model yet"
        message="Add a subscription total and implementation cost to the quote, then come back to model scenarios."
      />
    )
  }

  // Horizon spans the widest term across all scenarios so columns align.
  const horizon = Math.max(
    sageMatrix.horizon,
    ...scenarios.map(s => Number(s.term_years) || 3),
  )

  const baselineLabel = parentQuote.scenario_label || parentQuote.name || 'Sage Offer'
  const companyLabel = baselineLabel  // reused as the row-label header

  return (
    <div>
      {!readOnly && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>TCO Models</div>
          <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>
            Sage's Offer mirrors this quote. Add lightweight scenarios below to model the client's ask, a competitor bid, or an alternate offer side-by-side.
          </div>
        </div>
      )}

      {/* Sage Offer — read-only matrix derived from the parent quote */}
      <ScenarioCard
        kind="sage_offer"
        label={companyLabel}
        matrix={sageMatrix}
        horizon={horizon}
        rows={buildSageRows(sageMatrix)}
        readOnly={true}
      />

      {/* User-defined scenarios — fully editable */}
      {scenarios.map(s => {
        const matrix = deriveScenarioMatrix(s)
        return (
          <EditableScenarioCard
            key={s.id}
            scenario={s}
            matrix={matrix}
            horizon={horizon}
            baseline={sageMatrix}
            baselineLabel={baselineLabel}
            readOnly={readOnly}
            onChange={patch => updateScenario(s.id, patch)}
            onDelete={() => deleteScenario(s.id)}
            onAddLine={() => addLine(s.id)}
            onUpdateLine={(lineId, patch) => updateLine(s.id, lineId, patch)}
            onDeleteLine={lineId => deleteLine(s.id, lineId)}
          />
        )
      })}

      {!readOnly && (
        <div style={{ marginTop: 14 }}>
          <Button primary onClick={addScenario}>+ Add Scenario</Button>
        </div>
      )}
    </div>
  )
}

// Static rows for Sage Offer — auto-derived from parent quote columns. Hidden
// rows: Signing Bonus when zero, Free Months when no free months on the quote.
function buildSageRows(m) {
  const rows = [
    { key: 'subs', label: 'Net Subscription', perYear: y => m.subsByYear[y - 1], total: m.subsTotal },
    { key: 'impl', label: 'Implementation', perYear: y => y === 1 ? m.impl : null, total: m.impl },
  ]
  if (m.signingBonus > 0) {
    rows.push({ key: 'sb', label: 'Signing Bonus', perYear: y => y === 1 ? -m.signingBonus : null, total: -m.signingBonus })
  }
  if (m.freeMonthsValue > 0) {
    rows.push({ key: 'fm', label: 'Free Months', perYear: () => null, total: -m.freeMonthsValue })
  }
  rows.push({ key: 'total', label: 'Total', perYear: y => m.totalsByYear[y - 1], total: m.grandTotal, strong: true, headline: true })
  return rows
}

// ─── Card variants ─────────────────────────────────────────────────────────

function ScenarioCard({ kind, label, matrix, horizon, rows, readOnly, baseline, baselineLabel, headerRight }) {
  const years = []
  for (let y = 1; y <= horizon; y++) years.push(y)

  const labelCellStyle = { padding: '6px 12px', fontSize: 12, fontWeight: 600, color: T.text, background: T.surfaceAlt, borderRight: `1px solid ${T.borderLight}`, textAlign: 'left' }
  const numCellStyle = { padding: '6px 12px', fontSize: 13, color: T.text, textAlign: 'right', fontFeatureSettings: '"tnum"', borderRight: `1px solid ${T.borderLight}` }
  const headerCellStyle = { padding: '6px 12px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', background: T.surface, borderRight: `1px solid ${T.borderLight}` }

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 10px', flexWrap: 'wrap' }}>
        <Badge color={SCENARIO_TYPE_COLOR[kind] || T.textMuted}>{SCENARIO_TYPE_LABEL[kind] || kind}</Badge>
        <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{label}</span>
        <div style={{ flex: 1 }} />
        {headerRight}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              <th style={{ ...labelCellStyle, textAlign: 'left', background: T.surface, color: T.textMuted, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</th>
              {years.map(y => <th key={y} style={headerCellStyle}>Y{y}</th>)}
              <th style={{ ...headerCellStyle, color: T.text }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.key} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...labelCellStyle, fontWeight: r.strong ? 700 : 600 }}>
                  {r.labelNode ? r.labelNode : r.label}
                </td>
                {years.map(y => {
                  const v = r.perYear(y)
                  return (
                    <td
                      key={y}
                      style={{
                        ...numCellStyle,
                        background: r.headline ? T.primaryLight : 'transparent',
                        color: r.headline ? T.primary : T.text,
                        fontWeight: r.strong ? 700 : 500,
                      }}
                    >
                      {v == null || v === 0
                        ? <span style={{ color: T.textMuted }}>-</span>
                        : fmt(v)}
                    </td>
                  )
                })}
                <td
                  style={{
                    ...numCellStyle,
                    background: r.headline ? T.primaryLight : T.surfaceAlt,
                    color: r.headline ? T.primary : T.text,
                    fontWeight: 700,
                    fontSize: r.headline ? 14 : 13,
                  }}
                >
                  {r.total == null || r.total === 0
                    ? <span style={{ color: T.textMuted }}>-</span>
                    : fmt(r.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {baseline && (
        <DeltaStrip matrix={matrix} baseline={baseline} baselineLabel={baselineLabel} />
      )}
    </Card>
  )
}

function EditableScenarioCard({ scenario, matrix, horizon, baseline, baselineLabel, readOnly, onChange, onDelete, onAddLine, onUpdateLine, onDeleteLine }) {
  const years = []
  for (let y = 1; y <= horizon; y++) years.push(y)

  const labelCellStyle = { padding: '6px 12px', fontSize: 12, fontWeight: 600, color: T.text, background: T.surfaceAlt, borderRight: `1px solid ${T.borderLight}`, textAlign: 'left' }
  const numCellStyle = { padding: '6px 12px', fontSize: 13, color: T.text, textAlign: 'right', fontFeatureSettings: '"tnum"', borderRight: `1px solid ${T.borderLight}` }
  const headerCellStyle = { padding: '6px 12px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', background: T.surface, borderRight: `1px solid ${T.borderLight}` }
  const tinyInput = { ...inputStyle, fontSize: 12, padding: '4px 6px', height: 26 }

  return (
    <Card style={{ marginBottom: 14 }}>
      {/* Header row — editable label + type + term + yoy + delete */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 10px', flexWrap: 'wrap' }}>
        <Badge color={SCENARIO_TYPE_COLOR[scenario.type] || T.textMuted}>{SCENARIO_TYPE_LABEL[scenario.type] || scenario.type}</Badge>
        {readOnly ? (
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{scenario.label || 'Untitled'}</span>
        ) : (
          <>
            <input
              type="text"
              value={scenario.label}
              onChange={e => onChange({ label: e.target.value })}
              placeholder="Scenario label"
              style={{ ...inputStyle, fontWeight: 700, fontSize: 14, padding: '4px 8px', maxWidth: 240 }}
            />
            <select
              value={scenario.type}
              onChange={e => onChange({ type: e.target.value })}
              style={{ ...tinyInput, cursor: 'pointer', width: 140 }}
              title="Scenario type"
            >
              <option value="client_ask">Client Ask</option>
              <option value="competitor">Competitor</option>
              <option value="alternate">Alternate</option>
            </select>
          </>
        )}
        <div style={{ flex: 1 }} />
        {!readOnly && (
          <button
            onClick={() => { if (confirm('Delete this scenario?')) onDelete() }}
            title="Delete scenario"
            style={{ background: 'transparent', border: `1px solid ${T.border}`, color: T.textMuted, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontFamily: T.font, fontSize: 11 }}
            onMouseEnter={e => { e.currentTarget.style.color = T.error; e.currentTarget.style.borderColor = T.error }}
            onMouseLeave={e => { e.currentTarget.style.color = T.textMuted; e.currentTarget.style.borderColor = T.border }}
          >
            Delete
          </button>
        )}
      </div>

      {/* Input strip — subs Y1, implementation, term years, yoy % */}
      {!readOnly && (
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', padding: '0 4px 10px' }}>
          <Field label="Subscription (Y1)">
            <CurrencyInput
              value={scenario.subscription_y1}
              onChange={v => onChange({ subscription_y1: v })}
            />
          </Field>
          <Field label="Implementation">
            <CurrencyInput
              value={scenario.implementation}
              onChange={v => onChange({ implementation: v })}
            />
          </Field>
          <Field label="Contract">
            <select
              value={scenario.term_years}
              onChange={e => onChange({ term_years: Number(e.target.value) })}
              style={{ ...tinyInput, cursor: 'pointer', width: 90 }}
            >
              <option value={1}>1 yr</option>
              <option value={3}>3 yr</option>
              <option value={5}>5 yr</option>
            </select>
          </Field>
          <Field label="YoY %">
            <input
              type="number"
              step="0.1"
              value={scenario.yoy_pct}
              onChange={e => onChange({ yoy_pct: Number(e.target.value) })}
              style={{ ...tinyInput, width: 70 }}
            />
          </Field>
        </div>
      )}

      {/* Matrix */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              <th style={{ ...labelCellStyle, textAlign: 'left', background: T.surface, color: T.textMuted, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{scenario.label || 'Scenario'}</th>
              {years.map(y => <th key={y} style={headerCellStyle}>Y{y}</th>)}
              <th style={{ ...headerCellStyle, color: T.text }}>Total</th>
            </tr>
          </thead>
          <tbody>
            <MatrixRow label="Net Subscription" perYear={y => matrix.subsByYear[y - 1]} total={matrix.subsTotal} years={years} cell={numCellStyle} lbl={labelCellStyle} />
            <MatrixRow label="Implementation" perYear={y => y === 1 ? matrix.impl : null} total={matrix.impl} years={years} cell={numCellStyle} lbl={labelCellStyle} />

            {/* Custom lines — fully user-controlled, render between Implementation and Total */}
            {(scenario.lines || []).map(line => (
              <tr key={line.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...labelCellStyle, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {readOnly ? (
                    <span>{line.label || 'Custom line'}</span>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={line.label}
                        onChange={e => onUpdateLine(line.id, { label: e.target.value })}
                        placeholder="Line label (e.g. Migration credit)"
                        style={{ ...inputStyle, fontSize: 12, padding: '4px 6px', flex: 1 }}
                      />
                      <button
                        onClick={() => onDeleteLine(line.id)}
                        title="Delete line"
                        style={{ background: 'transparent', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}
                        onMouseEnter={e => { e.currentTarget.style.color = T.error }}
                        onMouseLeave={e => { e.currentTarget.style.color = T.textMuted }}
                      >
                        ×
                      </button>
                    </>
                  )}
                </td>
                {years.map(y => (
                  <td key={y} style={numCellStyle}>
                    {y === 1
                      ? readOnly
                        ? (line.amount == null || Number(line.amount) === 0 ? <span style={{ color: T.textMuted }}>-</span> : fmt(line.amount))
                        : <CurrencyInput value={line.amount} onChange={v => onUpdateLine(line.id, { amount: v })} small />
                      : <span style={{ color: T.textMuted }}>-</span>
                    }
                  </td>
                ))}
                <td style={{ ...numCellStyle, background: T.surfaceAlt, fontWeight: 700 }}>
                  {line.amount == null || Number(line.amount) === 0
                    ? <span style={{ color: T.textMuted }}>-</span>
                    : fmt(line.amount)}
                </td>
              </tr>
            ))}

            {!readOnly && (
              <tr>
                <td colSpan={horizon + 2} style={{ padding: '6px 12px', background: T.surface }}>
                  <button
                    onClick={onAddLine}
                    style={{ background: 'transparent', border: 'none', color: T.primary, cursor: 'pointer', fontFamily: T.font, fontSize: 11, fontWeight: 600, padding: 0 }}
                  >
                    + Add line
                  </button>
                </td>
              </tr>
            )}

            {/* Total row */}
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              <td style={{ ...labelCellStyle, fontWeight: 700 }}>Total</td>
              {years.map(y => (
                <td key={y} style={{ ...numCellStyle, background: T.primaryLight, color: T.primary, fontWeight: 700 }}>
                  {fmt(matrix.totalsByYear[y - 1])}
                </td>
              ))}
              <td style={{ ...numCellStyle, background: T.primaryLight, color: T.primary, fontWeight: 700, fontSize: 14 }}>
                {fmt(matrix.grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <DeltaStrip matrix={matrix} baseline={baseline} baselineLabel={baselineLabel} />
    </Card>
  )
}

function MatrixRow({ label, perYear, total, years, cell, lbl }) {
  return (
    <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
      <td style={{ ...lbl, fontWeight: 600 }}>{label}</td>
      {years.map(y => {
        const v = perYear(y)
        return (
          <td key={y} style={cell}>
            {v == null || v === 0 ? <span style={{ color: T.textMuted }}>-</span> : fmt(v)}
          </td>
        )
      })}
      <td style={{ ...cell, background: T.surfaceAlt, fontWeight: 700 }}>
        {total == null || total === 0 ? <span style={{ color: T.textMuted }}>-</span> : fmt(total)}
      </td>
    </tr>
  )
}

function DeltaStrip({ matrix, baseline, baselineLabel }) {
  if (!baseline) return null
  const subsDiff = matrix.subsTotal - baseline.subsTotal
  const concessionsDiff = (matrix.signingBonus + matrix.freeMonthsValue - matrix.customTotal)
    - (baseline.signingBonus + baseline.freeMonthsValue - (baseline.customTotal || 0))
  const totalDiff = matrix.grandTotal - baseline.grandTotal
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.borderLight}`, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        vs {baselineLabel || 'Sage Offer'}
      </div>
      <DeltaCell label="Subscription Diff" value={subsDiff} />
      <DeltaCell label="Concessions Diff" value={concessionsDiff} />
      <DeltaCell label="Total Diff" value={totalDiff} headline />
    </div>
  )
}

function DeltaCell({ label, value, headline }) {
  const color = value > 0 ? T.success : value < 0 ? T.error : T.textMuted
  const sign = value > 0 ? '+' : ''
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, paddingLeft: headline ? 10 : 0, borderLeft: headline ? `3px solid ${color}` : 'none' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: headline ? 18 : 13, fontWeight: headline ? 800 : 700, color, fontFeatureSettings: '"tnum"' }}>
        {sign}{value < 0 ? fmt(value) : fmt(Math.abs(value))}
      </div>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      {children}
    </label>
  )
}

// Plain number input that emits a number (or 0) — keeps the editor lightweight
// without dragging in a currency-mask lib. The user types the raw amount; we
// format it for display in the matrix cells.
function CurrencyInput({ value, onChange, small }) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  useEffect(() => { setDraft(value == null ? '' : String(value)) }, [value])
  return (
    <input
      type="number"
      step="0.01"
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onBlur={() => {
        const n = draft === '' ? 0 : Number(draft)
        if (n !== Number(value)) onChange(isFinite(n) ? n : 0)
      }}
      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
      style={{
        ...inputStyle,
        fontSize: small ? 12 : 13,
        padding: small ? '3px 6px' : '4px 8px',
        height: small ? 26 : 30,
        width: small ? 110 : 130,
        textAlign: 'right',
        fontFeatureSettings: '"tnum"',
      }}
    />
  )
}
