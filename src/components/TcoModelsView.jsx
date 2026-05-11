import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatCurrency } from '../lib/theme'
import { Card, Badge, Button, EmptyState, Spinner } from './Shared'
import AddScenarioModal from './AddScenarioModal'

const SCENARIO_TYPE_LABEL = {
  sage_offer: 'Sage Offer',
  client_ask: 'Client Ask',
  competitor: 'Competitor',
  alternate: 'Alternate',
}
const SCENARIO_TYPE_COLOR = {
  sage_offer: '#5DADE2',  // Carolina Blue
  client_ask: '#f59e0b',  // amber
  competitor: '#a855f7',  // purple
  alternate: '#64748b',   // slate
}

// All scenario numbers come from the parent quote columns. Free Months Value
// is shown ONLY in the Total column per the spec — never in any individual
// year. Per-year totals match the per-year subscription escalation plus
// Y1-only adjustments (impl − signing bonus); the grand total then deducts
// free months value once.
export function computeScenarioMatrix(quote, contractTerm) {
  const sageY1 = Number(quote.sage_subscription_total) || 0
  const sageImpl = Number(quote.sage_implementation_total) || 0
  const sageMonthly = sageY1 / 12
  const signingBonus = Number(quote.signing_bonus_amount) > 0
    ? Number(quote.signing_bonus_amount)
    : sageMonthly * (Number(quote.signing_bonus_months) || 0)
  const freeMonths = Number(quote.free_months) || 0
  const freeMonthsValue = sageMonthly * freeMonths

  const sageYears = contractTerm?.term_years || 3
  const yoyCaps = Array.isArray(contractTerm?.yoy_caps) ? contractTerm.yoy_caps : [0]

  const subsByYear = []
  let running = sageY1
  for (let y = 1; y <= sageYears; y++) {
    if (y === 1) {
      subsByYear.push(running)
    } else {
      const cap = Number(yoyCaps[y - 1]) || 0
      running = running * (1 + cap / 100)
      subsByYear.push(running)
    }
  }
  const subsTotal = subsByYear.reduce((s, v) => s + v, 0)

  // Per-year total mirrors the Excel breakdown: subs[y] in every year, plus
  // impl − signing bonus only in Y1. Free months is NOT folded into any year.
  const totalsByYear = subsByYear.map((subs, idx) => {
    if (idx === 0) return subs + sageImpl - signingBonus
    return subs
  })
  const perYearSum = totalsByYear.reduce((s, v) => s + v, 0)
  const grandTotal = perYearSum - freeMonthsValue

  return {
    horizon: sageYears,
    subsByYear, subsTotal,
    sageImpl, signingBonus,
    freeMonths, freeMonthsValue,
    totalsByYear, grandTotal,
    yoyCaps,
  }
}

function dollars(n, { paren } = {}) {
  const v = Number(n) || 0
  if (paren && v > 0) return `(${formatCurrency(v)})`
  return formatCurrency(v)
}

function deltaColor(v) {
  if (v > 0) return T.success
  if (v < 0) return T.error
  return T.textMuted
}
function formatDelta(v) {
  const sign = v > 0 ? '+' : v < 0 ? '-' : ''
  return `${sign}${formatCurrency(Math.abs(v))}`
}

// Props:
//   parentQuote      — the quote the user is currently editing (becomes the
//                      Sage's Offer scenario after auto-stamping on first add)
//   contractTerms    — full list (we look up by id per scenario)
//   dealId, companyName, profileId — needed by AddScenarioModal
//   readOnly         — when true, hides edit affordances (for customer view)
export default function TcoModelsView({ parentQuote, contractTerms, dealId, companyName, profileId, readOnly = false }) {
  const nav = useNavigate()
  const [siblings, setSiblings] = useState([])
  const [loadingSiblings, setLoadingSiblings] = useState(false)
  const [showAddScenario, setShowAddScenario] = useState(false)

  const groupId = parentQuote?.comparison_group_id || null

  async function loadSiblings() {
    if (!groupId) { setSiblings([]); return }
    setLoadingSiblings(true)
    try {
      const { data } = await supabase
        .from('quotes')
        .select('*')
        .eq('comparison_group_id', groupId)
        .neq('id', parentQuote.id)
        .order('created_at', { ascending: true })
      setSiblings(data || [])
    } catch (e) {
      console.error('[TcoModelsView] loadSiblings failed:', e)
    } finally {
      setLoadingSiblings(false)
    }
  }

  useEffect(() => { loadSiblings() }, [groupId, parentQuote?.id])

  const termsMap = {}
  for (const t of contractTerms || []) termsMap[t.id] = t

  // Parent quote is always rendered first as the Sage Offer baseline. Even if
  // it doesn't have scenario_type set yet, we treat it as the baseline.
  const baselineScenario = {
    ...parentQuote,
    scenario_type: parentQuote.scenario_type || 'sage_offer',
    scenario_label: parentQuote.scenario_label || companyName || parentQuote.name || 'Sage Offer',
  }
  const allScenarios = [baselineScenario, ...siblings]
  const allComputed = allScenarios.map(s => ({
    scenario: s,
    matrix: computeScenarioMatrix(s, termsMap[s.contract_term_id]),
    isBaseline: s.id === parentQuote.id,
  }))

  // Use the longest horizon across scenarios so column count matches.
  const horizon = allComputed.reduce((m, c) => Math.max(m, c.matrix.horizon), 1)

  const sageBaseline = allComputed[0]

  if (!parentQuote.sage_subscription_total && !siblings.length) {
    return (
      <EmptyState
        title="Nothing to model yet"
        message="Add subscription lines and an implementation total to the quote first — the TCO Models matrix derives entirely from those."
      />
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>TCO Models</div>
        <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>
          Side-by-side multi-year breakdown. Sage's Offer mirrors this quote. Other scenarios mirror their own cloned quotes — edit the underlying scenario to change its numbers.
        </div>
      </div>

      {allComputed.map(c => (
        <ScenarioCard
          key={c.scenario.id}
          scenario={c.scenario}
          matrix={c.matrix}
          horizon={horizon}
          isBaseline={c.isBaseline}
          baselineMatrix={!c.isBaseline ? sageBaseline.matrix : null}
          baselineLabel={!c.isBaseline ? sageBaseline.scenario.scenario_label : null}
          readOnly={readOnly}
          onOpenQuote={() => nav(`/deal/${c.scenario.deal_id}/quote/${c.scenario.id}`)}
        />
      ))}

      {!readOnly && (
        <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
          <Button onClick={() => setShowAddScenario(true)} primary>+ Add Scenario</Button>
          {loadingSiblings && <span style={{ fontSize: 11, color: T.textMuted, alignSelf: 'center' }}>Loading…</span>}
        </div>
      )}

      {showAddScenario && (
        <AddScenarioModal
          sourceQuote={parentQuote}
          dealId={dealId}
          companyName={companyName}
          profileId={profileId}
          onClose={() => setShowAddScenario(false)}
          onCreated={({ newQuoteId }) => {
            setShowAddScenario(false)
            // Jump to the new scenario so the rep can edit its numbers — once
            // they save and come back, this view will pick up the changes.
            nav(`/deal/${dealId}/quote/${newQuoteId}`)
          }}
        />
      )}
    </div>
  )
}

function ScenarioCard({ scenario, matrix, horizon, isBaseline, baselineMatrix, baselineLabel, readOnly, onOpenQuote }) {
  const cellPad = { padding: '6px 12px' }
  const labelCell = { ...cellPad, fontSize: 12, fontWeight: 600, color: T.text, background: T.surfaceAlt, borderRight: `1px solid ${T.borderLight}`, textAlign: 'left' }
  const numCell = { ...cellPad, fontSize: 13, color: T.text, textAlign: 'right', fontFeatureSettings: '"tnum"', borderRight: `1px solid ${T.borderLight}` }
  const headerCell = { ...cellPad, fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', background: T.surface, borderRight: `1px solid ${T.borderLight}` }

  // Build columns — Y1..Yn + Total. Padded with blanks if this scenario's
  // horizon is shorter than the overall matrix horizon, so columns align
  // across cards.
  const years = []
  for (let y = 1; y <= horizon; y++) years.push(y)

  function val(arr, idx) {
    return idx < arr.length ? arr[idx] : null
  }

  // Per-row renderers. Returning null in a cell means show a dash.
  const rows = [
    {
      key: 'subs',
      label: 'Net Subscription',
      perYear: (y) => val(matrix.subsByYear, y - 1),
      total: matrix.subsTotal,
    },
    {
      key: 'impl',
      label: 'Implementation',
      perYear: (y) => y === 1 ? matrix.sageImpl : null,
      total: matrix.sageImpl,
    },
    {
      key: 'signing',
      label: 'Signing Bonus',
      perYear: (y) => y === 1 && matrix.signingBonus > 0 ? -matrix.signingBonus : null,
      total: matrix.signingBonus > 0 ? -matrix.signingBonus : null,
      paren: true,
    },
    {
      key: 'free_months',
      label: `Free Months${matrix.freeMonths ? ` (${matrix.freeMonths})` : ''}`,
      // Per spec — free months value is in the Total column only.
      perYear: () => null,
      total: matrix.freeMonthsValue > 0 ? -matrix.freeMonthsValue : null,
      paren: true,
    },
    {
      key: 'total',
      label: 'Total',
      perYear: (y) => val(matrix.totalsByYear, y - 1),
      total: matrix.grandTotal,
      strong: true,
      headline: true,
    },
  ]

  // Hide free-months row when no free months on this scenario, to match the
  // user's example screenshots that omit the row when zero.
  const visibleRows = rows.filter(r => r.key !== 'free_months' || (matrix.freeMonths && matrix.freeMonthsValue > 0))

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 4px 10px', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 160, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge color={SCENARIO_TYPE_COLOR[scenario.scenario_type] || T.textMuted}>{SCENARIO_TYPE_LABEL[scenario.scenario_type] || 'Scenario'}</Badge>
          <span style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{scenario.scenario_label || SCENARIO_TYPE_LABEL[scenario.scenario_type]}</span>
        </div>
        <div style={{ flex: 1 }} />
        {!readOnly && !isBaseline && onOpenQuote && (
          <Button onClick={onOpenQuote} style={{ padding: '4px 10px', fontSize: 11 }}>Edit scenario</Button>
        )}
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${T.border}` }}>
              <th style={{ ...labelCell, textAlign: 'left', background: T.surface, color: T.textMuted, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{scenario.scenario_label || 'Scenario'}</th>
              {years.map(y => <th key={y} style={headerCell}>Y{y}</th>)}
              <th style={{ ...headerCell, color: T.text }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map(r => (
              <tr key={r.key} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...labelCell, fontWeight: r.strong ? 700 : 600 }}>{r.label}</td>
                {years.map(y => {
                  const v = r.perYear(y)
                  return (
                    <td
                      key={y}
                      style={{
                        ...numCell,
                        background: r.headline ? T.primaryLight : 'transparent',
                        color: r.headline ? T.primary : T.text,
                        fontWeight: r.strong ? 700 : 500,
                      }}
                    >
                      {v == null ? <span style={{ color: T.textMuted }}>-</span> : dollars(v, { paren: r.paren })}
                    </td>
                  )
                })}
                <td
                  style={{
                    ...numCell,
                    background: r.headline ? T.primaryLight : T.surfaceAlt,
                    color: r.headline ? T.primary : T.text,
                    fontWeight: 700,
                    fontSize: r.headline ? 14 : 13,
                  }}
                >
                  {r.total == null ? <span style={{ color: T.textMuted }}>-</span> : dollars(r.total, { paren: r.paren })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {baselineMatrix && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${T.borderLight}`, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            vs {baselineLabel || 'Sage Offer'}
          </div>
          <DeltaCell label="Subscription Diff" value={matrix.subsTotal - baselineMatrix.subsTotal} />
          <DeltaCell label="Concessions Diff" value={(matrix.signingBonus + matrix.freeMonthsValue) - (baselineMatrix.signingBonus + baselineMatrix.freeMonthsValue)} />
          <DeltaCell label="Total Diff" value={matrix.grandTotal - baselineMatrix.grandTotal} headline />
        </div>
      )}
    </Card>
  )
}

function DeltaCell({ label, value, headline }) {
  const color = deltaColor(value)
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, paddingLeft: headline ? 10 : 0, borderLeft: headline ? `3px solid ${color}` : 'none' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: headline ? 18 : 13, fontWeight: headline ? 800 : 700, color, fontFeatureSettings: '"tnum"' }}>{formatDelta(value)}</div>
    </div>
  )
}
