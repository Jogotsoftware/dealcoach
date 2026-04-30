// Customer-facing proposal renderer (Prompt F rebuild).
// 3 tabs: Investment Summary · Schedules · TCO.
// Reads from `data.snapshot` (deal_rooms.proposal_snapshot, captured by the
// snapshot_proposal RPC). Live msp_stages are fetched lazily for the
// implementation schedule sub-tab — those don't live in the snapshot yet.

import { useEffect, useMemo, useState } from 'react'
import { theme as T } from '../lib/theme'
import { Spinner } from './Shared'
import { supabase } from '../lib/supabase'

// ─── Money + date helpers ────────────────────────────────────────────────────
const num = (n) => Number(n) || 0
const fmt0 = (n) => Math.round(num(n)).toLocaleString('en-US')
const money = (n) => '$' + fmt0(n)
const moneyNeg = (n) => '-$' + fmt0(Math.abs(num(n)))
function addMonths(date, n) {
  if (!date) return null
  const d = new Date(date + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + n)
  return d
}
function fmtDateShort(d) {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}
function fmtDateLong(d) {
  if (!d) return ''
  const dt = typeof d === 'string' ? new Date(d + 'T00:00:00') : d
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ─── Color tokens (spec-locked, not in theme.js) ─────────────────────────────
// These are explicitly called out in the prompt; using theme.js fallbacks would
// drift the design.
const C = {
  greenDark: '#0F6E56',
  greenBg: '#E1F5EE',
  greenSoftBg: '#F5FBF8',
  redDark: '#A32D2D',
  redBg: '#FCEBEB',
  amberDark: '#854F0B',
  amberBg: '#FAEEDA',
  blueDark: '#185FA5',
  blueBg: '#E6F1FB',
  textTertiary: '#94a3b8',
}

// ─── Column visibility — read from new shape, fallback to legacy ─────────────
const ALL_COLS_VISIBLE = { list: true, qty: true, total_list: true, disc_pct: true, disc_amt: true, net: true }
function readColVis(columnVisibility) {
  if (!columnVisibility) return { ...ALL_COLS_VISIBLE }
  const inner = columnVisibility.columns || columnVisibility
  return {
    list:       inner.list       !== false,
    qty:        inner.qty        !== false,
    total_list: inner.total_list !== false,
    disc_pct:   inner.disc_pct   !== false,
    disc_amt:   inner.disc_amt   !== false,
    net:        inner.net        !== false,
  }
}

// ─── Tab visibility — read from snapshot.display_config.tabs ─────────────────
function readTabVis(displayConfig) {
  const tabs = displayConfig?.tabs || {}
  return {
    investment_summary: tabs.investment_summary !== false,
    schedules:          tabs.schedules          !== false,
    tco:                tabs.tco                !== false,
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Top-level ProposalView
// ═════════════════════════════════════════════════════════════════════════════
export default function ProposalView({
  data,
  columnVisibility,
  themeColor,
  themeColorSecondary,
  themeColorTertiary,
  // AE preview mode shows the per-tab visibility toggles row + the column
  // visibility pill row above the subscription table.
  aePreview = false,
  // Persists tab-visibility changes back to the AE's QuoteBuilder config.
  // Receives partial `{ investment_summary?, schedules?, tco? }`.
  onTabVisibilityChange = null,
  // Persists column-visibility changes to deal_rooms.proposal_column_visibility.
  // Receives partial `{ list?, qty?, total_list?, disc_pct?, disc_amt?, net? }`.
  onColumnVisibilityChange = null,
}) {
  if (!data) return <Spinner />
  const { snapshot, message } = data

  if (!snapshot) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: T.textMuted, fontSize: 14, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>
        {message || 'Your proposal is being prepared. Check back soon.'}
      </div>
    )
  }

  const tabVis = readTabVis(snapshot.display_config)
  const visibleTabs = [
    tabVis.investment_summary && { key: 'summary',   label: 'Investment Summary' },
    tabVis.schedules          && { key: 'schedules', label: 'Schedules' },
    tabVis.tco                && { key: 'tco',       label: 'TCO' },
  ].filter(Boolean)

  // Fall back to first visible tab if the chosen one is hidden.
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.key || 'summary')
  useEffect(() => {
    if (!visibleTabs.find(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'summary')
    }
  }, [visibleTabs, activeTab])

  const accent = themeColor || T.primary

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* AE-only visibility toggle row */}
      {aePreview && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AE visibility</span>
          {[
            { key: 'investment_summary', label: 'Investment Summary' },
            { key: 'schedules',          label: 'Schedules' },
            { key: 'tco',                label: 'TCO' },
          ].map(t => {
            const on = tabVis[t.key]
            return (
              <button key={t.key}
                onClick={() => onTabVisibilityChange && onTabVisibilityChange({ [t.key]: !on })}
                style={{
                  padding: '4px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${on ? accent : T.border}`,
                  background: on ? accent + '18' : T.surface,
                  color: on ? accent : T.textMuted,
                  cursor: 'pointer', fontFamily: T.font,
                }}>
                {on ? '✓ ' : ''}{t.label}
              </button>
            )
          })}
          <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4 }}>Toggle to hide a tab from the customer.</span>
        </div>
      )}

      {/* Page header — stays at top regardless of tab */}
      <ProposalHeader snapshot={snapshot} />

      {/* Tabs */}
      {visibleTabs.length > 1 && (
        <div style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 18, gap: 0 }}>
          {visibleTabs.map(t => {
            const on = activeTab === t.key
            return (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '10px 18px', border: 'none', background: 'transparent',
                  cursor: 'pointer', fontFamily: T.font, fontSize: 13, fontWeight: 600,
                  color: on ? accent : T.textMuted,
                  borderBottom: on ? `3px solid ${accent}` : '3px solid transparent',
                  marginBottom: -1,
                }}>
                {t.label}
              </button>
            )
          })}
        </div>
      )}

      {activeTab === 'summary'   && <InvestmentSummaryTab snapshot={snapshot} columnVisibility={columnVisibility} aePreview={aePreview} onColumnVisibilityChange={onColumnVisibilityChange} accent={accent} />}
      {activeTab === 'schedules' && <SchedulesTab snapshot={snapshot} accent={accent} />}
      {activeTab === 'tco'       && <TcoTab snapshot={snapshot} />}
    </div>
  )
}

// ─── Page header — quote name, prepared-for, dates ───────────────────────────
function ProposalHeader({ snapshot }) {
  const { quote_name, signer_contact, deal, snapshotted_at } = snapshot
  return (
    <div style={{ marginBottom: 22, paddingBottom: 14, borderBottom: `1px solid ${T.border}` }}>
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: T.text }}>Proposal</h1>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: T.textSecondary }}>
          {signer_contact?.name
            ? <>Prepared for <strong style={{ color: T.text }}>{signer_contact.name}</strong>{signer_contact.title ? <span style={{ color: T.textMuted }}>{', ' + signer_contact.title}</span> : null}</>
            : <>Prepared for <strong style={{ color: T.text }}>{deal?.company_name || 'your team'}</strong></>}
        </div>
        {quote_name && (
          <span style={{ fontSize: 11, color: T.textMuted, fontWeight: 600 }}>{quote_name}</span>
        )}
        {snapshotted_at && (
          <span style={{ fontSize: 11, color: T.textMuted }}>{fmtDateLong(String(snapshotted_at).split('T')[0])}</span>
        )}
      </div>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 1 — Investment Summary
// ═════════════════════════════════════════════════════════════════════════════
function InvestmentSummaryTab({ snapshot, columnVisibility, aePreview, onColumnVisibilityChange, accent }) {
  const cv = readColVis(columnVisibility)

  const sageLines = snapshot.sage_lines || []
  const sageImpl = snapshot.sage_implementation || []
  const term = snapshot.term
  const startDate = snapshot.contract_start_date
  const freeMonths = num(snapshot.free_months)
  const freeMonthsPlacement = snapshot.free_months_placement || 'back'
  const billingCadence = snapshot.billing_cadence || 'annual'
  const signingBonusAmount = num(snapshot.signing_bonus_amount)
  const signingBonusMonths = num(snapshot.signing_bonus_months)

  const parents = sageLines.filter(l => !l.parent_line_id)
  const childrenOf = (parentId) => sageLines.filter(l => l.parent_line_id === parentId)

  const annualListTotal = parents.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
  const annualNetTotal = parents.reduce((s, l) => s + num(l.extended), 0)
  const annualDiscountAmount = annualListTotal - annualNetTotal
  const blendedDiscountPct = annualListTotal > 0 ? Math.round(annualDiscountAmount / annualListTotal * 100) : 0

  const monthlySub = annualNetTotal / 12
  const signingBonusValue = signingBonusAmount > 0 ? signingBonusAmount : signingBonusMonths * monthlySub

  const implTotal = sageImpl.reduce((s, i) => s + num(i.total_amount ?? i.extended ?? i.amount), 0)

  // Year 1 cash = annual subscription (net) + impl − signing bonus.
  // Free months extend the term, not the cash, so they are NOT subtracted here.
  const year1Total = annualNetTotal + implTotal - signingBonusValue

  // Subscription end: start + (term_years × 12 months) + (free_months months)
  const termYears = term?.term_years || 1
  const subscriptionEnd = (() => {
    const d = addMonths(startDate, termYears * 12 + freeMonths)
    if (!d) return null
    d.setDate(d.getDate() - 1)  // end-of-day adjusted to last calendar day before next term
    return d
  })()

  // YoY cap display: the spec says max non-zero, expressed as percent
  const yoyCaps = Array.isArray(term?.yoy_caps) ? term.yoy_caps : []
  const yoyCapDisplay = (() => {
    const nonZero = yoyCaps.filter(c => num(c) > 0).map(c => num(c))
    if (!nonZero.length) return '—'
    const max = Math.max(...nonZero)
    return `${(max * 100).toFixed(max < 0.1 ? 1 : 0)}%`
  })()

  return (
    <div>
      {/* 1. Contract Terms strip */}
      <Eyebrow>Contract terms</Eyebrow>
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
        padding: '14px 18px', background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8,
        marginBottom: 22,
      }}>
        <Field label="Term length" value={`${termYears * 12} months`} />
        <Field label="Subscription period" value={
          startDate
            ? `${fmtDateShort(startDate)} – ${subscriptionEnd ? subscriptionEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`
            : '—'
        } />
        <Field label="Billing cadence" value={billingCadence === 'annual' ? 'Annual' : billingCadence === 'quarterly' ? 'Quarterly' : billingCadence} />
        <Field label="Payment terms" value="Net 30" />
        <Field label="YoY cap" value={yoyCapDisplay} />
        {freeMonths > 0 && (
          <Field label="Free months" value={`${freeMonths} (${freeMonthsPlacement === 'back' ? 'Back' : 'Front'})`} />
        )}
      </div>

      {/* AE-only: customer-visible column toggles */}
      {aePreview && onColumnVisibilityChange && (
        <div style={{
          marginTop: 8, marginBottom: 6, padding: '8px 12px', background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Customer-visible columns</span>
          {[
            { key: 'list',       label: 'List' },
            { key: 'qty',        label: 'Qty' },
            { key: 'total_list', label: 'Total list' },
            { key: 'disc_pct',   label: 'Disc %' },
            { key: 'disc_amt',   label: 'Disc $' },
            { key: 'net',        label: 'Net price' },
          ].map(c => {
            const on = cv[c.key]
            return (
              <button key={c.key}
                onClick={() => onColumnVisibilityChange({ [c.key]: !on })}
                style={{
                  padding: '4px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${on ? accent : T.border}`,
                  background: on ? accent + '18' : T.surface,
                  color: on ? accent : T.textMuted,
                  cursor: 'pointer', fontFamily: T.font,
                }}>
                {on ? '✓ ' : ''}{c.label}
              </button>
            )
          })}
        </div>
      )}

      {/* 2. Subscription detail table */}
      {parents.length > 0 && (
        <SubscriptionDetailTable
          parents={parents}
          childrenOf={childrenOf}
          annualListTotal={annualListTotal}
          annualNetTotal={annualNetTotal}
          annualDiscountAmount={annualDiscountAmount}
          blendedDiscountPct={blendedDiscountPct}
          cv={cv}
        />
      )}

      {/* 3. One-time costs detail card */}
      {sageImpl.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <Eyebrow>One-time costs</Eyebrow>
          <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
            {sageImpl.map((i, idx) => {
              const v = num(i.total_amount ?? i.extended ?? i.amount)
              return (
                <div key={i.id || idx} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: idx < sageImpl.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{i.name || '—'}</div>
                    {i.sow_document_id && (
                      <button
                        onClick={() => window.open(`/api/sow/${i.sow_document_id}`, '_blank', 'noopener')}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.greenDark, padding: 0, fontSize: 12, fontWeight: 600, marginTop: 4, fontFamily: T.font }}
                      >View statement of work →</button>
                    )}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{money(v)}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. Bottom summary table */}
      <div style={{
        marginTop: 22, background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8, padding: '6px 0', overflow: 'hidden',
      }}>
        <SumRow label="Annual subscription" value={money(annualListTotal)} bold />
        {annualDiscountAmount > 0 && (
          <SumRow label="Subscription discount" value={moneyNeg(annualDiscountAmount)} valueColor={C.redDark} labelColor={C.redDark} />
        )}
        <SumRow label="One-time costs" value={money(implTotal)} bold />
        {signingBonusValue > 0 && (
          <SumRow label="Signing bonus" value={moneyNeg(signingBonusValue)} valueColor={C.amberDark} labelColor={C.amberDark} />
        )}
      </div>

      {/* 5. Year 1 Total card */}
      <div style={{
        marginTop: 16, background: C.greenBg, border: `2px solid ${C.greenDark}`, borderRadius: 10,
        padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: C.greenDark, letterSpacing: '0.01em' }}>Year 1 Total</div>
        <div style={{ fontSize: 30, fontWeight: 500, color: C.greenDark, fontFeatureSettings: '"tnum"' }}>{money(year1Total)}</div>
      </div>
    </div>
  )
}

// ─── Investment Summary helpers ──────────────────────────────────────────────
function Eyebrow({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>{children}</div>
}
function Field({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{value}</div>
    </div>
  )
}
function SumRow({ label, value, bold, labelColor, valueColor }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 18px', borderBottom: `1px solid ${T.borderLight}` }}>
      <div style={{ fontSize: 13, fontWeight: bold ? 700 : 500, color: labelColor || T.text }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: bold ? 700 : 500, color: valueColor || T.text, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )
}

function SubscriptionDetailTable({ parents, childrenOf, annualListTotal, annualNetTotal, annualDiscountAmount, blendedDiscountPct, cv }) {
  // Column visibility: when hidden, blank the cell content + header text but
  // preserve column width. Header *colors* stay so the page composition reads
  // the same regardless of which columns are on.
  const COLS = [
    { key: 'solution',   label: 'Solution',  width: undefined, headColor: T.textMuted, align: 'left',  always: true },
    { key: 'list',       label: 'List',      width: 90,  headColor: C.textTertiary, align: 'right', visible: cv.list },
    { key: 'qty',        label: 'Qty',       width: 56,  headColor: C.textTertiary, align: 'right', visible: cv.qty },
    { key: 'total_list', label: 'Total list', width: 100, headColor: C.textTertiary, align: 'right', visible: cv.total_list },
    { key: 'disc_pct',   label: 'Disc %',    width: 70,  headColor: C.redDark,    align: 'right', visible: cv.disc_pct },
    { key: 'disc_amt',   label: 'Disc $',    width: 90,  headColor: C.redDark,    align: 'right', visible: cv.disc_amt },
    { key: 'net',        label: 'Net price', width: 110, headColor: C.greenDark,  align: 'right', visible: cv.net, isNet: true },
  ]

  const cellHead = (color) => ({ padding: '10px 12px', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap', background: '#fff', borderBottom: `1px solid ${T.border}` })
  const cellData = (extra = {}) => ({ padding: '12px 12px', fontSize: 13, fontFeatureSettings: '"tnum"', textAlign: 'right', color: T.text, ...extra })

  // Hidden column: cells go transparent + white background (no tinted bg).
  // Header text + color stay visible per spec, so the customer's table
  // composition reads identical regardless of which columns are on.
  const hiddenCellStyle = { background: '#fff', color: 'transparent' }

  function renderCell(p, col) {
    const visible = col.always || col.visible
    if (col.key === 'solution') {
      const kids = childrenOf(p.id)
      const isBundle = !!p.is_bundle && kids.length > 0
      return (
        <td key={col.key} style={{ padding: '12px 12px', textAlign: 'left', verticalAlign: 'top' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{p.name || p.sku || '—'}</div>
          {isBundle && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: T.textSecondary, lineHeight: 1.5 }}>
              {kids.map(c => {
                const childQty = num(c.quantity)
                const showQty = childQty > 0 && childQty !== 1
                return <div key={c.id}>– {c.name || c.sku}{showQty ? ` (${childQty})` : ''}</div>
              })}
            </div>
          )}
        </td>
      )
    }
    if (!visible) {
      // Per spec: blank data text but keep column width by rendering a non-breaking placeholder
      return <td key={col.key} style={cellData(hiddenCellStyle)}>&nbsp;</td>
    }
    const lineList = num(p.quantity) * num(p.unit_price)
    const lineDisc = lineList - num(p.extended)
    switch (col.key) {
      case 'list':
        return <td key={col.key} style={cellData({ color: C.textTertiary })}>{money(p.unit_price)}</td>
      case 'qty':
        return <td key={col.key} style={cellData()}>{num(p.quantity).toLocaleString()}</td>
      case 'total_list':
        return <td key={col.key} style={cellData({ color: C.textTertiary })}>{money(lineList)}</td>
      case 'disc_pct':
        return <td key={col.key} style={cellData({ color: lineDisc > 0 ? C.redDark : T.textMuted })}>
          {num(p.discount_pct) > 0 ? `${Math.round(num(p.discount_pct) * 100)}%` : '—'}
        </td>
      case 'disc_amt':
        return <td key={col.key} style={cellData({ color: lineDisc > 0 ? C.redDark : T.textMuted, fontWeight: lineDisc > 0 ? 600 : 400 })}>
          {lineDisc > 0 ? `−${money(lineDisc)}` : '—'}
        </td>
      case 'net':
        return <td key={col.key} style={cellData({ background: C.greenSoftBg, color: C.greenDark, fontWeight: 500 })}>{money(p.extended)}</td>
      default:
        return <td key={col.key} style={cellData()}>—</td>
    }
  }

  // Footer rows live inside the same table. Label cell spans across all
  // columns except the rightmost value column.
  const lastVisibleIdx = COLS.length - 1
  const labelSpan = lastVisibleIdx

  return (
    <div style={{ marginTop: 22, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
        <colgroup>
          {COLS.map(c => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {COLS.map(c => (
              <th key={c.key} style={{ ...cellHead(c.headColor), textAlign: c.align || 'right' }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parents.map(p => (
            <tr key={p.id} style={{ borderBottom: `1px solid ${T.borderLight}`, verticalAlign: 'top' }}>
              {COLS.map(c => renderCell(p, c))}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.textTertiary, fontWeight: 600 }}>
              Annual subscription · total list price
            </td>
            <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.textTertiary, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{money(annualListTotal)}</td>
          </tr>
          {annualDiscountAmount > 0 && (
            <tr>
              <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.redDark, fontWeight: 600 }}>
                Discount amount ({blendedDiscountPct}%)
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.redDark, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{moneyNeg(annualDiscountAmount)}</td>
            </tr>
          )}
          <tr style={{ background: C.greenSoftBg }}>
            <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.greenDark, fontWeight: 700 }}>
              Net annual subscription total
            </td>
            <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 14, color: C.greenDark, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{money(annualNetTotal)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — Schedules
// ═════════════════════════════════════════════════════════════════════════════
function SchedulesTab({ snapshot, accent }) {
  const [sub, setSub] = useState('payment')
  const SUBS = [
    { key: 'payment', label: 'Payment schedule' },
    { key: 'impl',    label: 'Implementation schedule' },
  ]
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {SUBS.map(s => {
          const on = sub === s.key
          return (
            <button key={s.key} onClick={() => setSub(s.key)}
              style={{
                padding: '6px 14px', borderRadius: 16, fontSize: 12, fontWeight: 600,
                border: `1px solid ${on ? accent : T.border}`,
                background: on ? accent : T.surface,
                color: on ? '#fff' : T.textSecondary,
                cursor: 'pointer', fontFamily: T.font,
              }}>
              {s.label}
            </button>
          )
        })}
      </div>
      {sub === 'payment' && <PaymentScheduleSubTab snapshot={snapshot} />}
      {sub === 'impl'    && <ImplementationScheduleSubTab snapshot={snapshot} accent={accent} />}
    </div>
  )
}

// ─── 2a. Payment schedule ────────────────────────────────────────────────────
function PaymentScheduleSubTab({ snapshot }) {
  const rows = snapshot.payment_schedule || []
  if (!rows.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>No invoices scheduled yet.</div>
  }

  // Color scheme by payment_type
  const styleFor = (pt) => {
    if (pt === 'subscription_year' || pt === 'subscription_quarter') {
      return { rowBg: C.blueBg, accent: C.blueDark, amountColor: C.greenDark }
    }
    if (pt === 'partner_subscription_year') {
      return { rowBg: C.blueBg, accent: C.blueDark, amountColor: C.greenDark }
    }
    if (pt === 'implementation_arrears' || pt === 'implementation_milestone' || pt === 'one_time_service') {
      return { rowBg: C.greenBg, accent: C.greenDark, amountColor: C.greenDark }
    }
    if (pt === 'free_month') {
      return { rowBg: C.amberBg, accent: C.amberDark, amountColor: C.amberDark }
    }
    return { rowBg: T.surface, accent: T.textMuted, amountColor: T.text }
  }

  // Strip parentheticals like "(back-loaded extension)" or "(cap +5%)"
  // and the noisy " - TBD" suffix from descriptions.
  const cleanDesc = (d) => String(d || '').replace(/\s*\(.*?\)/g, '').replace(/\s*-\s*TBD/gi, '').trim()

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: `1px solid ${T.border}`, width: 130 }}>Date</th>
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: `1px solid ${T.border}` }}>Description</th>
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', borderBottom: `1px solid ${T.border}`, width: 140 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = styleFor(r.payment_type)
            const isFree = r.payment_type === 'free_month'
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${T.borderLight}` : 'none', background: s.rowBg }}>
                <td style={{ padding: '12px 14px', fontWeight: 600, color: T.text, position: 'relative', boxShadow: `inset 3px 0 0 0 ${s.accent}` }}>
                  {fmtDateShort(r.invoice_date)}
                </td>
                <td style={{ padding: '12px 14px', color: T.text }}>{cleanDesc(r.description)}</td>
                <td style={{ padding: '12px 14px', textAlign: 'right', fontFeatureSettings: '"tnum"', fontWeight: 700, color: s.amountColor }}>
                  {isFree ? 'FREE' : money(r.amount)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ─── 2b. Implementation schedule (live msp_stages + Phase Gantt) ─────────────
function ImplementationScheduleSubTab({ snapshot, accent }) {
  const dealId = snapshot.deal?.id
  const [stages, setStages] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!dealId) { setStages([]); return }
    ;(async () => {
      const { data } = await supabase
        .from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order')
      if (!cancelled) setStages(data || [])
    })()
    return () => { cancelled = true }
  }, [dealId])

  const sageImpl = (snapshot.sage_implementation || []).find(i => i.duration_to_live_weeks) || (snapshot.sage_implementation || [])[0]
  const liveWeeks = num(sageImpl?.duration_to_live_weeks) || null
  const sowDocId = sageImpl?.sow_document_id

  // Estimate completion weeks from msp_stages end_date if available.
  const completeWeeks = useMemo(() => {
    if (!stages?.length) return null
    const dates = stages.map(s => s.end_date || s.due_date).filter(Boolean).map(d => new Date(d + 'T00:00:00'))
    const starts = stages.map(s => s.start_date).filter(Boolean).map(d => new Date(d + 'T00:00:00'))
    if (!dates.length || !starts.length) return null
    const earliest = new Date(Math.min(...starts.map(d => d.getTime())))
    const latest = new Date(Math.max(...dates.map(d => d.getTime())))
    const days = (latest - earliest) / 86400000
    return Math.max(1, Math.round(days / 7))
  }, [stages])

  if (stages == null) return <Spinner />

  return (
    <div>
      {/* Header strip */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        padding: '12px 16px', background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 8,
        marginBottom: 14, flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: 13, color: T.text }}>
          {liveWeeks ? <strong>{liveWeeks} weeks to Go-Live</strong> : <strong>Implementation timeline</strong>}
          {completeWeeks ? <span style={{ color: T.textMuted }}> · {completeWeeks} weeks to project completion</span> : null}
        </div>
        <div style={{ fontSize: 11, color: T.textMuted, display: 'flex', alignItems: 'center', gap: 10 }}>
          {sageImpl?.implementor_name && <span>Source: {sageImpl.implementor_name} SOW</span>}
          {sowDocId && (
            <button onClick={() => window.open(`/api/sow/${sowDocId}`, '_blank', 'noopener')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.greenDark, padding: 0, fontSize: 11, fontWeight: 600, fontFamily: T.font }}>
              View statement of work →
            </button>
          )}
        </div>
      </div>

      {/* Phase rows */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 18 }}>
        {stages.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>Implementation phases will appear here once your AE publishes the project plan.</div>
        ) : stages.map((s, i) => {
          const isMilestone = isMilestoneStage(s)
          const when = s.date_label || (s.start_date && s.end_date
            ? `${fmtDateShort(s.start_date)} – ${fmtDateShort(s.end_date)}`
            : (s.due_date ? fmtDateShort(s.due_date) : ''))
          return (
            <div key={s.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 16, padding: '12px 16px', borderBottom: i < stages.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
              <div style={{ width: 130, flexShrink: 0, fontSize: 12, color: isMilestone ? C.greenDark : T.textSecondary, fontWeight: isMilestone ? 600 : 500 }}>
                {when}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: isMilestone ? 600 : 500, color: isMilestone ? C.greenDark : T.text }}>
                  {s.stage_name}
                </div>
                {s.notes && <div style={{ fontSize: 11.5, color: T.textMuted, marginTop: 3, lineHeight: 1.5 }}>{s.notes}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Phase Gantt */}
      {stages.length > 0 && <PhaseGantt stages={stages} accent={accent} />}
    </div>
  )
}

const MILESTONE_NAMES = new Set(['Project kickoff', 'Kickoff', 'Go-Live', 'Go Live', 'Project Complete', 'Project Completion', 'Project complete'])
function isMilestoneStage(s) {
  const name = String(s.stage_name || '').trim().toLowerCase()
  for (const m of MILESTONE_NAMES) if (m.toLowerCase() === name) return true
  return false
}

// ─── Phase Gantt SVG ─────────────────────────────────────────────────────────
function PhaseGantt({ stages, accent }) {
  // Group non-milestone stages into 4 phases of Sage's standard cadence.
  // Phase widths: Define 4w / Configure 12w / System Readiness 2w / Success Assurance 6w.
  const PHASES = [
    { name: 'Define',             weeks: 4,  color: '#A7F3D0' },
    { name: 'Configure',          weeks: 12, color: '#34D399' },
    { name: 'System Readiness',   weeks: 2,  color: '#0D9488' },
    { name: 'Success Assurance',  weeks: 6,  color: '#134E4A' },
  ]
  const totalWeeks = PHASES.reduce((s, p) => s + p.weeks, 0)
  const goLiveWeek = PHASES.slice(0, 3).reduce((s, p) => s + p.weeks, 0)  // 4 + 12 + 2 = 18

  // Layout
  const W = 680, H = 240
  const leftLane = 160
  const rightPad = 18
  const topBand = 22
  const milestoneBand = 24
  const chartTop = topBand + 8
  const chartBottom = H - milestoneBand - 6
  const chartHeight = chartBottom - chartTop
  const barH = (chartHeight - 8 * (PHASES.length - 1)) / PHASES.length
  const xPerWeek = (W - leftLane - rightPad) / totalWeeks
  const goLiveX = leftLane + goLiveWeek * xPerWeek

  // Milestones: Kickoff (week 0), Go-Live (week 18), Project Complete (week totalWeeks)
  // Use earliest stage start date as reference.
  const referenceStart = (() => {
    const starts = stages.map(s => s.start_date).filter(Boolean).map(d => new Date(d + 'T00:00:00'))
    if (!starts.length) return null
    return new Date(Math.min(...starts.map(d => d.getTime())))
  })()
  const dateAtWeek = (w) => referenceStart ? addMonths(null, 0) /* stub */ && new Date(referenceStart.getTime() + w * 7 * 86400000) : null
  const fmtMs = (d) => d ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  // Month axis labels
  const monthTicks = []
  if (referenceStart) {
    const lastWeek = totalWeeks
    const lastDate = new Date(referenceStart.getTime() + lastWeek * 7 * 86400000)
    let cur = new Date(referenceStart.getFullYear(), referenceStart.getMonth(), 1)
    while (cur <= lastDate) {
      const weeksFromStart = (cur.getTime() - referenceStart.getTime()) / (86400000 * 7)
      if (weeksFromStart >= 0 && weeksFromStart <= totalWeeks) {
        monthTicks.push({
          x: leftLane + weeksFromStart * xPerWeek,
          label: cur.toLocaleDateString('en-US', { month: 'short' }),
        })
      }
      cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1)
    }
  }

  const kickoffDate = referenceStart
  const goLiveDate = referenceStart ? new Date(referenceStart.getTime() + goLiveWeek * 7 * 86400000) : null
  const completeDate = referenceStart ? new Date(referenceStart.getTime() + totalWeeks * 7 * 86400000) : null

  let cumWeeks = 0

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, padding: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        Implementation phases
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        {/* Month axis */}
        {monthTicks.map((m, i) => (
          <text key={i} x={m.x} y={topBand - 8} textAnchor="middle" fontSize="9" fontWeight="600" fill={T.textMuted} fontFamily={T.font}>
            {m.label}
          </text>
        ))}
        {/* Top axis line */}
        <line x1={leftLane} y1={topBand} x2={W - rightPad} y2={topBand} stroke={T.borderLight} strokeWidth="1" />

        {/* Phase rows */}
        {PHASES.map((p, idx) => {
          const y = chartTop + idx * (barH + 8)
          const x = leftLane + cumWeeks * xPerWeek
          const w = p.weeks * xPerWeek
          const startW = cumWeeks
          const endW = cumWeeks + p.weeks
          cumWeeks += p.weeks
          return (
            <g key={p.name}>
              <text x={leftLane - 12} y={y + barH / 2 + 4} textAnchor="end" fontSize="11" fontWeight="600" fill={T.text} fontFamily={T.font}>
                {p.name}
              </text>
              <text x={leftLane - 12} y={y + barH / 2 + 16} textAnchor="end" fontSize="9" fill={T.textMuted} fontFamily={T.font}>
                Wk {startW + 1}–{endW}
              </text>
              <rect x={x} y={y} width={w} height={barH} rx="3" fill={p.color} />
            </g>
          )
        })}

        {/* Vertical dashed Go-Live line */}
        <line x1={goLiveX} y1={topBand} x2={goLiveX} y2={chartBottom + 4} stroke={C.greenDark} strokeWidth="2" strokeDasharray="4,3" opacity="0.7" />

        {/* Milestone markers along the bottom */}
        {[
          { week: 0, label: 'Kickoff', date: kickoffDate, bold: false },
          { week: goLiveWeek, label: 'Go-Live', date: goLiveDate, bold: true },
          { week: totalWeeks, label: 'Project Complete', date: completeDate, bold: false },
        ].map((m, i) => {
          const x = leftLane + m.week * xPerWeek
          return (
            <g key={i}>
              {/* Diamond */}
              <path d={`M ${x},${chartBottom + 6} L ${x + 5},${chartBottom + 11} L ${x},${chartBottom + 16} L ${x - 5},${chartBottom + 11} Z`} fill={C.greenDark} />
              <text x={x} y={H - 4} textAnchor="middle" fontSize="11" fontWeight={m.bold ? 600 : 500} fill={C.greenDark} fontFamily={T.font}>
                {m.label}{m.date ? ` · ${fmtMs(m.date)}` : ''}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 3 — TCO
// ═════════════════════════════════════════════════════════════════════════════
function TcoTab({ snapshot }) {
  const term = snapshot.term
  const termYears = term?.term_years || 1
  const yoyCaps = Array.isArray(term?.yoy_caps) ? term.yoy_caps : []

  const sageLines = snapshot.sage_lines || []
  const sageImpl = snapshot.sage_implementation || []
  const parents = sageLines.filter(l => !l.parent_line_id)

  const annualListTotal = parents.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
  const annualNetTotal = parents.reduce((s, l) => s + num(l.extended), 0)
  const discountTotal = annualListTotal - annualNetTotal
  const discountPct = annualListTotal > 0 ? discountTotal / annualListTotal : 0
  const discountPctDisplay = annualListTotal > 0 ? Math.round(discountPct * 100) : 0

  const implTotal = sageImpl.reduce((s, i) => s + num(i.total_amount ?? i.extended ?? i.amount), 0)
  const signingBonusAmount = num(snapshot.signing_bonus_amount)
  const signingBonusMonths = num(snapshot.signing_bonus_months)
  const monthlySub = annualNetTotal / 12
  const signingBonusValue = signingBonusAmount > 0 ? signingBonusAmount : signingBonusMonths * monthlySub

  const freeMonths = num(snapshot.free_months)
  const freeMonthsValue = freeMonths * monthlySub

  // Per-year math: net escalates by yoy_caps[idx]; list = net / (1 - discountPct)
  // so the discount % applied to list stays constant.
  const yearNet = []
  let runningNet = annualNetTotal
  for (let y = 1; y <= termYears; y++) {
    if (y === 1) yearNet.push(runningNet)
    else {
      const cap = num(yoyCaps[y - 1]) // 0-indexed array; cap for year y is at index y-1
      runningNet = runningNet * (1 + cap)
      yearNet.push(runningNet)
    }
  }
  const yearList = yearNet.map(n => discountPct < 1 ? n / (1 - discountPct) : n)
  const yearDisc = yearList.map(l => l * discountPct)

  // Final cost rows
  // Subscription net for year 1 has signing bonus subtracted (matches payment_schedule).
  const yearSubNet = yearNet.map((n, i) => i === 0 ? n - signingBonusValue : n)
  const yearImpl = yearNet.map((_, i) => i === 0 ? implTotal : 0)
  const yearAnnualCost = yearSubNet.map((n, i) => n + yearImpl[i])

  const tot = (arr) => arr.reduce((s, n) => s + n, 0)

  const totalConcessions = tot(yearDisc) + freeMonthsValue + signingBonusValue
  const totalCost = tot(yearAnnualCost)
  const yoyAvgSub = tot(yearSubNet) / termYears

  const cellHead = { padding: '10px 12px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right', whiteSpace: 'nowrap' }
  const cellLabel = { padding: '11px 14px', fontSize: 13, color: T.text, textAlign: 'left' }
  const cellNum = (extra = {}) => ({ padding: '11px 12px', fontSize: 13, fontFeatureSettings: '"tnum"', textAlign: 'right', color: T.text, ...extra })

  return (
    <div>
      {/* Detail table */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...cellHead, textAlign: 'left' }}></th>
              {yearNet.map((_, i) => (
                <th key={i} style={cellHead}>Year {i + 1}</th>
              ))}
              <th style={{ ...cellHead, color: T.text }}>{termYears}-year total</th>
            </tr>
          </thead>
          <tbody>
            {/* Subscription · list (gray) */}
            <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
              <td style={cellLabel}>Subscription · list</td>
              {yearList.map((v, i) => <td key={i} style={cellNum({ color: C.textTertiary })}>{money(v)}</td>)}
              <td style={cellNum({ color: C.textTertiary, fontWeight: 600 })}>{money(tot(yearList))}</td>
            </tr>

            {/* Subscription discount (red) */}
            {discountTotal > 0 && (
              <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...cellLabel, color: C.redDark }}>Subscription discount ({discountPctDisplay}%)</td>
                {yearDisc.map((v, i) => <td key={i} style={cellNum({ color: C.redDark })}>{moneyNeg(v)}</td>)}
                <td style={cellNum({ color: C.redDark, fontWeight: 600 })}>{moneyNeg(tot(yearDisc))}</td>
              </tr>
            )}

            {/* Signing bonus (amber) — Y1 only */}
            {signingBonusValue > 0 && (
              <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...cellLabel, color: C.amberDark }}>Signing bonus</td>
                {yearNet.map((_, i) => (
                  <td key={i} style={cellNum({ color: C.amberDark })}>
                    {i === 0 ? moneyNeg(signingBonusValue) : '—'}
                  </td>
                ))}
                <td style={cellNum({ color: C.amberDark, fontWeight: 600 })}>{moneyNeg(signingBonusValue)}</td>
              </tr>
            )}

            {/* Free months (amber) — only the total cell populated */}
            {freeMonths > 0 && (
              <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...cellLabel, color: C.amberDark }}>Free months (Y1 · {freeMonths} mo · extends term)</td>
                {yearNet.map((_, i) => <td key={i} style={cellNum({ color: C.amberDark })}>—</td>)}
                <td style={cellNum({ color: C.amberDark, fontWeight: 600 })}>{moneyNeg(freeMonthsValue)}</td>
              </tr>
            )}

            {/* Visual divider */}
            <tr style={{ background: T.surfaceAlt }}>
              <td colSpan={termYears + 2} style={{ height: 8, padding: 0 }}></td>
            </tr>

            {/* Subscription · net (green soft bg) */}
            <tr style={{ background: C.greenSoftBg, borderBottom: `1px solid ${T.borderLight}` }}>
              <td style={{ ...cellLabel, color: C.greenDark, fontWeight: 600 }}>Subscription · net</td>
              {yearSubNet.map((v, i) => <td key={i} style={cellNum({ color: C.greenDark, fontWeight: 600 })}>{money(v)}</td>)}
              <td style={cellNum({ color: C.greenDark, fontWeight: 700 })}>{money(tot(yearSubNet))}</td>
            </tr>

            {/* Implementation — Y1 only */}
            <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
              <td style={{ ...cellLabel, color: C.greenDark }}>Implementation (one-time)</td>
              {yearImpl.map((v, i) => <td key={i} style={cellNum({ color: C.greenDark })}>{i === 0 ? money(v) : '—'}</td>)}
              <td style={cellNum({ color: C.greenDark, fontWeight: 600 })}>{money(implTotal)}</td>
            </tr>

            {/* Annual cost — green totals row */}
            <tr style={{ background: C.greenBg }}>
              <td style={{ ...cellLabel, color: C.greenDark, fontWeight: 700, fontSize: 14 }}>Annual cost</td>
              {yearAnnualCost.map((v, i) => <td key={i} style={cellNum({ color: C.greenDark, fontWeight: 700, fontSize: 14 })}>{money(v)}</td>)}
              <td style={cellNum({ color: C.greenDark, fontWeight: 800, fontSize: 14 })}>{money(totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3 summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <SummaryCard
          bg={C.greenBg} border={C.greenDark} color={C.greenDark}
          label={`${termYears} YR Total`} value={money(totalCost)} />
        <SummaryCard
          bg={C.redBg} border={C.redDark} color={C.redDark}
          label="Total concessions" value={money(totalConcessions)} />
        <SummaryCard
          bg={C.blueBg} border={C.blueDark} color={C.blueDark}
          label="YoY avg subscription" value={money(yoyAvgSub)} />
      </div>
    </div>
  )
}

function SummaryCard({ bg, border, color, label, value }) {
  return (
    <div style={{
      background: bg, border: `1.5px solid ${border}`, borderRadius: 10,
      padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ fontSize: 10, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )
}
