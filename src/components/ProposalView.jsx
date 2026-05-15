// Customer-facing proposal renderer (Prompt F rebuild).
// 3 tabs: Investment Summary · Schedules · TCO.
// Reads from `data.snapshot` (deal_rooms.proposal_snapshot, captured by the
// snapshot_proposal RPC). Live msp_stages are fetched lazily for the
// implementation schedule sub-tab — those don't live in the snapshot yet.

import { useEffect, useMemo, useState } from 'react'
import { theme as T } from '../lib/theme'
import { Spinner } from './Shared'
import { supabase } from '../lib/supabase'
import TcoModelsView from './TcoModelsView'

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
  // Partner palette — distinct from Sage blue so the customer can scan partner
  // vs Sage costs at a glance in both the Schedules tab and the Investment
  // Summary partner cards.
  partnerDark: '#5A3FBC',
  partnerBg: '#EEEAFB',
  partnerSoftBg: '#F7F5FD',
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

// ─── Subscription summary-row visibility — sibling namespace to columns ──────
// Customer-side reader for the 3 aggregate rows at the bottom of the
// subscription detail table: list_subtotal, discount_amount, net_total.
// All default visible; the AE toggles off via eye icons in QuoteBuilder.
function readSummaryRowVis(columnVisibility) {
  const inner = columnVisibility?.summary_rows || {}
  return {
    list_subtotal:   inner.list_subtotal   !== false,
    discount_amount: inner.discount_amount !== false,
    net_total:       inner.net_total       !== false,
  }
}

// ─── Tab visibility — read from snapshot.display_config.tabs ─────────────────
function readTabVis(displayConfig) {
  const tabs = displayConfig?.tabs || {}
  return {
    investment_summary: tabs.investment_summary !== false,
    schedules:          tabs.schedules          !== false,
    tco:                tabs.tco                !== false,
    // TCO Comparison is opt-OUT — visible by default; the visibleTabs
    // assembly below also gates on the snapshot actually having scenarios
    // so the tab doesn't show for quotes that haven't modeled any.
    tco_comparison:     tabs.tco_comparison     !== false,
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
  const hasTcoScenarios = Array.isArray(snapshot.tco_scenarios) && snapshot.tco_scenarios.length > 0
  const visibleTabs = [
    tabVis.investment_summary && { key: 'summary',        label: 'Investment Summary' },
    tabVis.schedules          && { key: 'schedules',      label: 'Schedules' },
    tabVis.tco                && { key: 'tco',            label: 'TCO' },
    tabVis.tco_comparison && hasTcoScenarios && { key: 'tco_comparison', label: 'TCO Comparison' },
  ].filter(Boolean)

  // Fall back to first visible tab if the chosen one is hidden.
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.key || 'summary')
  useEffect(() => {
    if (!visibleTabs.find(t => t.key === activeTab)) {
      setActiveTab(visibleTabs[0]?.key || 'summary')
    }
  }, [visibleTabs, activeTab])

  const accent = themeColor || T.primary

  // Print mode: when user hits Download PDF, choose which tabs to include,
  // then render those tabs sequentially (each with its own header band and a
  // page break before) and trigger window.print(). Reset after the dialog closes.
  const [printingTabs, setPrintingTabs] = useState(null) // null when not printing; array of tab keys when active
  useEffect(() => {
    if (!printingTabs) return
    // Wait one paint so the print-only DOM is mounted before the dialog opens.
    const t = setTimeout(() => { window.print() }, 50)
    const onAfter = () => setPrintingTabs(null)
    window.addEventListener('afterprint', onAfter)
    return () => { clearTimeout(t); window.removeEventListener('afterprint', onAfter) }
  }, [printingTabs])

  return (
    <div className="ri-proposal-print-root" style={{ maxWidth: 1100, margin: '0 auto' }}>
      {/* Print styles. Two modes:
            (1) Standalone: only the proposal content prints, page chrome hidden.
            (2) Print mode (printingTabs set): we render selected tabs back to
                back, each in a .ri-print-page block that forces a page break
                before. The page header (.ri-print-header) repeats at the top
                of every section so every PDF page reads as a coherent doc. */}
      <style>{`
        @media print {
          /* @page margin: 0 (set globally in index.css) suppresses the
             browser's header/footer band. We carry the 0.4in margin as
             padding on the print root instead so content still has air. */
          @page { margin: 0; size: letter; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .ri-proposal-print-root, .ri-proposal-print-root * { visibility: visible !important; }
          .ri-proposal-print-root { position: absolute !important; left: 0; top: 0; width: 100%; max-width: 100%; padding: 0.4in !important; margin: 0; font-family: ${T.font}; background: #fff !important; }
          .ri-no-print { display: none !important; }
          .ri-print-page { page-break-before: always; padding-top: 0; }
          .ri-print-page:first-of-type { page-break-before: auto; }

          /* Tables can break across pages so we don't strand a section header
             above an empty page when the table is taller than what's left. */
          .ri-print-page table { page-break-inside: auto; }
          .ri-print-page tr    { page-break-inside: avoid; page-break-after: auto; }
          /* But each card-level container tries to stay together in a sensible
             chunk so an Eyebrow + first row aren't stranded on different pages. */
          .ri-print-block      { page-break-inside: avoid; }

          /* Tighter typography in print so product names don't have to wrap to
             10+ lines. Overrides base font-size on every cell. */
          .ri-proposal-print-root, .ri-proposal-print-root * { font-size: 10.5pt; line-height: 1.35; }
          .ri-proposal-print-root h1 { font-size: 18pt; }
          .ri-proposal-print-root h2 { font-size: 13pt; }
          .ri-proposal-print-root td { padding: 5pt 7pt !important; font-size: 9.5pt !important; }
          .ri-proposal-print-root th { padding: 5pt 7pt !important; font-size: 8pt !important; }
          /* Eyebrow + small captions can stay tiny */
          .ri-proposal-print-root .ri-eyebrow { font-size: 8pt !important; }

          /* Subscription table: collapse the numeric columns so the Solution
             column gets the room product names + bundle children need to
             read on one line. Bundle child list also drops a step in size. */
          .ri-proposal-print-root .ri-sub-table { font-size: 9pt !important; }
          .ri-proposal-print-root .ri-sub-table th,
          .ri-proposal-print-root .ri-sub-table td { padding: 4pt 5pt !important; font-size: 9pt !important; }
          .ri-proposal-print-root .ri-sub-table td.ri-col-solution > div:first-child { font-size: 10pt !important; }
          .ri-proposal-print-root .ri-sub-table td.ri-col-solution > div:nth-child(2) { font-size: 8.5pt !important; line-height: 1.3 !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-list,
          .ri-proposal-print-root .ri-sub-table th.ri-col-list,
          .ri-proposal-print-root .ri-sub-table td.ri-col-list       { width: 60px !important; min-width: 60px !important; max-width: 60px !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-qty,
          .ri-proposal-print-root .ri-sub-table th.ri-col-qty,
          .ri-proposal-print-root .ri-sub-table td.ri-col-qty        { width: 36px !important; min-width: 36px !important; max-width: 36px !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-total_list,
          .ri-proposal-print-root .ri-sub-table th.ri-col-total_list,
          .ri-proposal-print-root .ri-sub-table td.ri-col-total_list { width: 70px !important; min-width: 70px !important; max-width: 70px !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-disc_pct,
          .ri-proposal-print-root .ri-sub-table th.ri-col-disc_pct,
          .ri-proposal-print-root .ri-sub-table td.ri-col-disc_pct   { width: 50px !important; min-width: 50px !important; max-width: 50px !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-disc_amt,
          .ri-proposal-print-root .ri-sub-table th.ri-col-disc_amt,
          .ri-proposal-print-root .ri-sub-table td.ri-col-disc_amt   { width: 70px !important; min-width: 70px !important; max-width: 70px !important; }
          .ri-proposal-print-root .ri-sub-table col.ri-col-net,
          .ri-proposal-print-root .ri-sub-table th.ri-col-net,
          .ri-proposal-print-root .ri-sub-table td.ri-col-net        { width: 80px !important; min-width: 80px !important; max-width: 80px !important; }

          /* Force white backgrounds on surfaces — the customer view tints
             cards with theme color halos that bleed gray in print preview
             when "Background graphics" is unchecked. */
          .ri-proposal-print-root .ri-print-card { background: #fff !important; }

          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        .ri-print-only { display: none; }
        @media print { .ri-print-only { display: block; } }

        /* Mobile-first overrides for the customer Proposal view. The desktop
           layout uses lots of inline padding + 3-col grids that crush down
           on narrow phones; these rules pull everything back into a single
           column and shrink type so it stays readable. */
        @media (max-width: 640px) {
          .ri-proposal-print-root { padding: 0 !important; }
          .ri-prop-header { flex-wrap: wrap !important; gap: 8px !important; padding-bottom: 8px !important; margin-bottom: 14px !important; }
          .ri-prop-header > div { width: auto !important; flex: 1 1 auto !important; }
          .ri-prop-header img { max-height: 22px !important; max-width: 56px !important; }
          .ri-prop-header-title { font-size: 14px !important; }
          .ri-prop-header-eyebrow { font-size: 8px !important; }
          .ri-prop-header-meta { font-size: 9px !important; }

          .ri-prop-tabs { overflow-x: auto !important; flex-wrap: nowrap !important; -webkit-overflow-scrolling: touch; }
          .ri-prop-tabs button { padding: 9px 12px !important; font-size: 12px !important; flex-shrink: 0 !important; white-space: nowrap !important; }

          .ri-prop-contract-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; padding: 10px 12px !important; }
          .ri-prop-contract-grid > div { font-size: 11px !important; }

          /* Tables: keep them readable but allow horizontal scroll for the
             column-heavy SubscriptionDetailTable so cells don't crush. */
          .ri-prop-table-wrap { overflow-x: auto !important; -webkit-overflow-scrolling: touch; margin: 0 -4px; }
          .ri-prop-table-wrap table { font-size: 12px !important; }
          .ri-prop-table-wrap th, .ri-prop-table-wrap td { padding: 8px 8px !important; font-size: 12px !important; }

          /* One-time + summary rows */
          .ri-prop-onetime-row { padding: 10px 12px !important; font-size: 12px !important; }
          .ri-prop-summary-row { padding: 8px 14px !important; font-size: 13px !important; }

          /* Year 1 Total banner — shrink so it doesn't shout on a phone. */
          .ri-prop-year1 { padding: 12px 14px !important; }
          .ri-prop-year1-label { font-size: 14px !important; }
          .ri-prop-year1-value { font-size: 18px !important; }
        }
      `}</style>

      {/* Download PDF — opens a small popover to pick which tabs to include */}
      <div className="ri-no-print" style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <PdfDownloadButton accent={accent} visibleTabs={visibleTabs} onPrint={(tabKeys) => setPrintingTabs(tabKeys)} />
      </div>

      {/* AE-only visibility toggle row */}
      {aePreview && (
        <div className="ri-no-print" style={{
          marginBottom: 12, padding: '8px 12px', background: T.surfaceAlt, border: `1px dashed ${T.border}`, borderRadius: 8,
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 10, fontWeight: 800, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>AE visibility</span>
          {[
            { key: 'investment_summary', label: 'Investment Summary' },
            { key: 'schedules',          label: 'Schedules' },
            { key: 'tco',                label: 'TCO' },
            { key: 'tco_comparison',     label: 'TCO Comparison' },
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

      {/* Screen header — stays at top regardless of tab. Hidden during print
          because each printed page renders its own PrintPageHeader. */}
      <div className="ri-no-print">
        <ProposalHeader snapshot={snapshot} />
      </div>

      {/* Screen tabs */}
      {visibleTabs.length > 1 && (
        <div className="ri-no-print ri-prop-tabs" style={{ display: 'flex', borderBottom: `1px solid ${T.border}`, marginBottom: 18, gap: 0 }}>
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

      {/* Screen view — renders the active tab only */}
      {!printingTabs && (
        <div className="ri-no-print">
          {activeTab === 'summary'        && <InvestmentSummaryTab snapshot={snapshot} columnVisibility={columnVisibility} aePreview={aePreview} onColumnVisibilityChange={onColumnVisibilityChange} accent={accent} />}
          {activeTab === 'schedules'      && <SchedulesTab snapshot={snapshot} accent={accent} />}
          {activeTab === 'tco'            && <TcoTab snapshot={snapshot} />}
          {activeTab === 'tco_comparison' && <TcoComparisonTab snapshot={snapshot} />}
        </div>
      )}

      {/* Print view — renders every selected tab in sequence with a page-break
          before each, so the PDF reads as a multi-page document. Each section
          gets its own header band (org logo · quote · customer logo). */}
      {printingTabs && printingTabs.map((key, idx) => {
        const label = (visibleTabs.find(t => t.key === key) || { label: key }).label
        return (
          <section key={key} className="ri-print-page" style={{ paddingBottom: 24 }}>
            <PrintPageHeader snapshot={snapshot} accent={accent} sectionTitle={label} pageIndex={idx + 1} pageTotal={printingTabs.length} />
            {key === 'summary'        && <InvestmentSummaryTab snapshot={snapshot} columnVisibility={columnVisibility} accent={accent} />}
            {key === 'schedules'      && <SchedulesTab snapshot={snapshot} accent={accent} printAll />}
            {key === 'tco'            && <TcoTab snapshot={snapshot} />}
            {key === 'tco_comparison' && <TcoComparisonTab snapshot={snapshot} />}
          </section>
        )
      })}
    </div>
  )
}

// ─── Print page header — repeats at the top of every PDF section ─────────────
// Org logo (left) · Proposal + quote name + date + section title (center) ·
// Customer logo (right). Designed to fit cleanly inside a 0.5in @page margin.
function PrintPageHeader({ snapshot, accent, sectionTitle, pageIndex, pageTotal }) {
  const orgLogo = snapshot.org?.logo_url
  const customerLogo = snapshot.deal?.customer_logo_url
  const customerName = snapshot.deal?.company_name
  const orgName = snapshot.org?.name
  const dateStr = snapshot.snapshotted_at ? fmtDateLong(String(snapshot.snapshotted_at).split('T')[0]) : ''
  return (
    <div className="ri-prop-header" style={{
      display: 'flex', alignItems: 'center', gap: 16,
      paddingBottom: 12, marginBottom: 18, borderBottom: `2px solid ${accent}`,
    }}>
      {/* Org logo (left) */}
      <div style={{ width: 120, display: 'flex', alignItems: 'center', justifyContent: 'flex-start' }}>
        {orgLogo
          ? <img src={orgLogo} alt={orgName || ''} style={{ maxHeight: 28, maxWidth: 96, objectFit: 'contain' }} />
          : (orgName && <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{orgName}</span>)}
      </div>

      {/* Center: title block */}
      <div style={{ flex: 1, textAlign: 'center', minWidth: 0 }}>
        <div className="ri-prop-header-eyebrow" style={{ fontSize: 9, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          Proposal · {sectionTitle}
        </div>
        <div className="ri-prop-header-title" style={{ fontSize: 16, fontWeight: 700, color: T.text, marginTop: 2 }}>
          {customerName || ''}
        </div>
        <div className="ri-prop-header-meta" style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>
          {[snapshot.quote_name, dateStr].filter(Boolean).join(' · ')}
          {pageTotal > 1 && <span style={{ marginLeft: 6 }}>· {pageIndex} of {pageTotal}</span>}
        </div>
      </div>

      {/* Customer logo (right) */}
      <div style={{ width: 120, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
        {customerLogo && (
          <img src={customerLogo} alt={customerName || ''} style={{ maxHeight: 28, maxWidth: 96, objectFit: 'contain' }} />
        )}
      </div>
    </div>
  )
}

// ─── PdfDownloadButton — popover with per-tab checkboxes ─────────────────────
function PdfDownloadButton({ accent, visibleTabs, onPrint }) {
  const [open, setOpen] = useState(false)
  // Default all visible tabs selected.
  const [selected, setSelected] = useState(() => {
    const map = {}; for (const t of visibleTabs) map[t.key] = true; return map
  })
  // Re-sync when visibleTabs changes (AE flips a tab visibility off, etc.)
  useEffect(() => {
    setSelected(prev => {
      const next = { ...prev }
      for (const t of visibleTabs) if (next[t.key] === undefined) next[t.key] = true
      // Drop keys for tabs that are no longer visible.
      for (const k of Object.keys(next)) if (!visibleTabs.find(t => t.key === k)) delete next[k]
      return next
    })
  }, [visibleTabs])

  function toggle(key) { setSelected(s => ({ ...s, [key]: !s[key] })) }
  function go() {
    const tabs = visibleTabs.map(t => t.key).filter(k => selected[k])
    if (!tabs.length) return
    setOpen(false)
    onPrint(tabs)
  }
  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <div style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        title="Download a PDF copy of this proposal"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          border: `1px solid ${accent}`, borderRadius: 6,
          background: open ? accent + '14' : T.surface, color: accent,
          cursor: 'pointer', fontFamily: T.font,
        }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download PDF
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
          <div style={{
            position: 'absolute', right: 0, top: '100%', marginTop: 6, zIndex: 1000,
            background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)', padding: 14, minWidth: 240, fontFamily: T.font,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Pages to include
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {visibleTabs.map(t => (
                <label key={t.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.text, cursor: 'pointer', userSelect: 'none' }}>
                  <input type="checkbox" checked={!!selected[t.key]} onChange={() => toggle(t.key)} />
                  {t.label}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, color: T.textMuted }}>{selectedCount} of {visibleTabs.length} selected</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => setOpen(false)}
                  style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, background: T.surface, color: T.textMuted, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', fontFamily: T.font }}>
                  Cancel
                </button>
                <button onClick={go} disabled={!selectedCount}
                  style={{ padding: '5px 14px', fontSize: 11, fontWeight: 700, background: selectedCount ? accent : T.borderLight, color: '#fff', border: 'none', borderRadius: 4, cursor: selectedCount ? 'pointer' : 'not-allowed', fontFamily: T.font }}>
                  Download PDF
                </button>
              </div>
            </div>
          </div>
        </>
      )}
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
  const partnerBlocks = snapshot.partner_blocks || []
  const term = snapshot.term
  const startDate = snapshot.contract_start_date
  const freeMonths = num(snapshot.free_months)
  const freeMonthsPlacement = snapshot.free_months_placement || 'back'
  const billingCadence = snapshot.billing_cadence || 'annual'
  const signingBonusAmount = num(snapshot.signing_bonus_amount)
  const signingBonusMonths = num(snapshot.signing_bonus_months)
  // Optional AE-set name for this concession. Falls back to "Signing Bonus".
  const signingBonusLabel = (snapshot.signing_bonus_label || '').trim() || 'Signing Bonus'

  const parents = sageLines.filter(l => !l.parent_line_id)
  const childrenOf = (parentId) => sageLines.filter(l => l.parent_line_id === parentId)

  const annualListTotal = parents.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
  const annualNetTotal = parents.reduce((s, l) => s + num(l.extended), 0)
  const annualDiscountAmount = annualListTotal - annualNetTotal
  const blendedDiscountPct = annualListTotal > 0 ? Math.round(annualDiscountAmount / annualListTotal * 100) : 0

  const monthlySub = annualNetTotal / 12
  const signingBonusValue = signingBonusAmount > 0 ? signingBonusAmount : signingBonusMonths * monthlySub

  const implTotal = sageImpl.reduce((s, i) => s + num(i.total_amount ?? i.extended ?? i.amount), 0)

  // Partner totals — flow into Year 1 Total alongside Sage costs so the
  // customer sees the all-in number, not just the Sage portion.
  const partnerSubTotal = partnerBlocks.reduce((s, pb) =>
    s + (pb.lines || []).reduce((ss, l) => ss + num(l.extended), 0), 0)
  const partnerImplTotal = partnerBlocks.reduce((s, pb) =>
    s + (pb.implementation || []).reduce((ss, i) => ss + num(i.total_amount ?? i.extended ?? i.amount), 0), 0)
  const hasPartnerData = partnerBlocks.some(pb => (pb.lines || []).length > 0 || (pb.implementation || []).length > 0)

  // Year 1 cash = annual subscription (net) + impl − signing bonus + partner (sub + impl).
  // Free months extend the term, not the cash, so they are NOT subtracted here.
  const year1Total = annualNetTotal + implTotal + partnerSubTotal + partnerImplTotal - signingBonusValue

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
      {/* 1. Contract Terms strip — section + per-field toggleable */}
      {readSection(snapshot, 'summary_contract_terms_strip') && (() => {
        const fields = [
          readSection(snapshot, 'terms_term_length') && { label: 'Term length', value: `${termYears * 12} months` },
          readSection(snapshot, 'terms_subscription_period') && {
            label: 'Subscription period',
            value: startDate
              ? `${fmtDateShort(startDate)} – ${subscriptionEnd ? subscriptionEnd.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`
              : '—',
          },
          readSection(snapshot, 'terms_billing_cadence') && { label: 'Billing cadence', value: billingCadence === 'annual' ? 'Annual' : billingCadence === 'quarterly' ? 'Quarterly' : billingCadence },
          readSection(snapshot, 'terms_payment_terms') && { label: 'Payment terms', value: 'Net 30' },
          readSection(snapshot, 'terms_yoy_cap') && { label: 'YoY cap', value: yoyCapDisplay },
          (freeMonths > 0 && readSection(snapshot, 'terms_free_months')) && { label: 'Free months', value: `${freeMonths} (${freeMonthsPlacement === 'back' ? 'Back' : 'Front'})` },
        ].filter(Boolean)
        if (!fields.length) return null
        return (
          <>
            <Eyebrow>Contract terms</Eyebrow>
            <div className="ri-prop-contract-grid" style={{
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
              padding: '14px 18px', background: T.surfaceAlt,
              border: `1px solid ${T.border}`, borderLeft: `4px solid ${accent}`,
              borderRadius: 8, marginBottom: 22,
            }}>
              {fields.map((f, i) => <Field key={i} label={f.label} value={f.value} />)}
            </div>
          </>
        )
      })()}

      {/* AE-only: customer-visible column toggles */}
      {aePreview && onColumnVisibilityChange && (
        <div className="ri-no-print" style={{
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

      {/* 2 + 3. Pricing detail — Recurring and One time read as two
          sub-sections inside one unified bordered container. Signing bonus
          lives inside One time as a deduction row alongside impl items. */}
      {((readSection(snapshot, 'summary_subscription_detail') && parents.length > 0)
        || (readSection(snapshot, 'summary_onetime_costs_card') && (sageImpl.length > 0 || signingBonusValue > 0))) && (
        <div style={{ marginTop: 22, background: T.surface, border: `1px solid ${T.border}`, borderLeft: `4px solid ${accent}`, borderRadius: 10, overflow: 'hidden' }}>
          {readSection(snapshot, 'summary_subscription_detail') && parents.length > 0 && (
            <div style={{ padding: '18px 18px 4px' }}>
              <Eyebrow>Recurring</Eyebrow>
              <SubscriptionDetailTable
                parents={parents}
                childrenOf={childrenOf}
                annualListTotal={annualListTotal}
                annualNetTotal={annualNetTotal}
                annualDiscountAmount={annualDiscountAmount}
                blendedDiscountPct={blendedDiscountPct}
                cv={cv}
                summaryRows={readSummaryRowVis(columnVisibility)}
              />
            </div>
          )}
          {readSection(snapshot, 'summary_subscription_detail') && parents.length > 0
            && readSection(snapshot, 'summary_onetime_costs_card') && (sageImpl.length > 0 || signingBonusValue > 0) && (
            <div style={{ height: 1, background: T.border }} />
          )}
          {readSection(snapshot, 'summary_onetime_costs_card') && (sageImpl.length > 0 || signingBonusValue > 0) && (
            <div style={{ padding: 18 }}>
              <Eyebrow>One time</Eyebrow>
              <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                {sageImpl.map((i, idx) => {
                  const v = num(i.total_amount ?? i.extended ?? i.amount)
                  const isLastImpl = idx === sageImpl.length - 1
                  const showBorderUnder = !isLastImpl || signingBonusValue > 0
                  return (
                    <div key={i.id || idx} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: showBorderUnder ? `1px solid ${T.borderLight}` : 'none' }}>
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
                {signingBonusValue > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', padding: '14px 18px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: C.amberDark }}>{signingBonusLabel}</div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: C.amberDark, fontFeatureSettings: '"tnum"' }}>{moneyNeg(signingBonusValue)}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3b. Partners — one card per partner block, with Recurring (subscription
          lines) and One time (implementation items) sub-sections mirroring the
          Sage layout above. */}
      {hasPartnerData && partnerBlocks.map((pb, idx) => {
        const block = pb.block || {}
        const lines = pb.lines || []
        const impl = pb.implementation || []
        if (lines.length === 0 && impl.length === 0) return null
        const pbSub = lines.reduce((s, l) => s + num(l.extended), 0)
        const pbImpl = impl.reduce((s, i) => s + num(i.total_amount ?? i.extended ?? i.amount), 0)
        return (
          <div key={block.id || idx} style={{
            marginTop: 22, background: T.surface, border: `1px solid ${T.border}`,
            borderLeft: `4px solid ${C.partnerDark}`, borderRadius: 10, overflow: 'hidden',
          }}>
            <div style={{ padding: '14px 18px 0' }}>
              <Eyebrow><span style={{ color: C.partnerDark }}>Partner: {block.partner_name || 'Partner'}</span></Eyebrow>
            </div>
            {lines.length > 0 && (
              <div style={{ padding: '6px 18px 4px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Recurring</div>
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  {lines.map((l, i) => (
                    <div key={l.id || i} style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: i < lines.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{l.name || l.description || '—'}</div>
                        {l.description && l.name && (
                          <div style={{ fontSize: 11.5, color: T.textSecondary, marginTop: 3, lineHeight: 1.5 }}>{l.description}</div>
                        )}
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{money(l.extended)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {lines.length > 0 && impl.length > 0 && <div style={{ height: 1, background: T.border, margin: '12px 0 0' }} />}
            {impl.length > 0 && (
              <div style={{ padding: 18 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>One time</div>
                <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  {impl.map((i, idx2) => {
                    const v = num(i.total_amount ?? i.extended ?? i.amount)
                    return (
                      <div key={i.id || idx2} style={{ display: 'flex', alignItems: 'center', padding: '14px 18px', borderBottom: idx2 < impl.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{i.description || i.name || 'Implementation'}</div>
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{money(v)}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* 4. Bottom summary — toggleable as a section, with each row + the
          Year 1 Total row independently hide-able from the AE side. */}
      {(() => {
        const showSummary = readSection(snapshot, 'summary_bottom_summary')
        const showYear1 = readSection(snapshot, 'summary_year1_total')
        const showAnnualSub  = showSummary && readSection(snapshot, 'summary_row_annual_subscription')
        // Discount is no longer surfaced in the bottom summary — net annual
        // subscription absorbs it. The detail table above still shows list +
        // discount per line so customers can see the math.
        const showOneTime    = showSummary && readSection(snapshot, 'summary_row_onetime_costs')
        const showSigningBonus = showSummary && signingBonusValue > 0 && readSection(snapshot, 'summary_row_signing_bonus')
        const showPartnerInSummary = showSummary && (partnerSubTotal > 0 || partnerImplTotal > 0)
        if (!showAnnualSub && !showOneTime && !showSigningBonus && !showYear1 && !showPartnerInSummary) return null
        return (
          <div style={{
            marginTop: 22, background: T.surfaceAlt,
            border: `1px solid ${T.border}`, borderLeft: `4px solid ${accent}`,
            borderRadius: 10, overflow: 'hidden',
          }}>
            {/* Block 1: Net annual subscription — tinted green so the customer's
                eye lands on the "what you actually pay" recurring number. */}
            {showAnnualSub && (
              <SumRow label="Net annual subscription" value={money(annualNetTotal)} bold labelColor={C.greenDark} valueColor={C.greenDark} />
            )}
            {showAnnualSub && (showOneTime || showSigningBonus) && (
              <div style={{ height: 1, background: T.border, margin: '0' }} />
            )}
            {/* Block 2: Implementation (one-time costs) — tinted blue so it reads
                as distinct from the recurring subscription block above. Signing
                bonus is no longer indented under here; it moves into its own
                "One time concessions" red row below when present. */}
            {showOneTime && (
              <SumRow label="Implementation" value={money(implTotal)} bold labelColor={C.blueDark} valueColor={C.blueDark} />
            )}
            {/* Block 2b: One time concessions — single red row that aggregates
                the signing bonus credit. Only renders when there's a concession
                to show. Free months extend the term (not cash), so they don't
                appear here. */}
            {showSigningBonus && (
              <SumRow label={signingBonusLabel} value={moneyNeg(signingBonusValue)} bold labelColor={C.redDark} valueColor={C.redDark} />
            )}
            {/* Block 3: Partner — sub + impl roll into Year 1 Total. Tinted
                with the partner palette so it visually splits from Sage rows. */}
            {showSummary && partnerSubTotal > 0 && (
              <>
                {(showAnnualSub || showOneTime || showSigningBonus) && <div style={{ height: 1, background: T.border }} />}
                <SumRow label="Partner subscription" value={money(partnerSubTotal)} bold labelColor={C.partnerDark} valueColor={C.partnerDark} noBorder={partnerImplTotal > 0} />
              </>
            )}
            {showSummary && partnerImplTotal > 0 && (
              <>
                {partnerSubTotal === 0 && (showAnnualSub || showOneTime || showSigningBonus) && <div style={{ height: 1, background: T.border }} />}
                <SumRow label="Partner implementation" value={money(partnerImplTotal)} bold labelColor={C.partnerDark} valueColor={C.partnerDark} />
              </>
            )}
            {/* Year 1 Total — terminal row */}
            {showYear1 && (
              <div className="ri-prop-year1" style={{
                background: C.greenBg, borderTop: `2px solid ${C.greenDark}`,
                padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
              }}>
                <div className="ri-prop-year1-label" style={{ fontSize: 15, fontWeight: 600, color: C.greenDark, letterSpacing: '0.01em' }}>Total One Time Costs</div>
                <div className="ri-prop-year1-value" style={{ fontSize: 30, fontWeight: 500, color: C.greenDark, fontFeatureSettings: '"tnum"' }}>{money(year1Total)}</div>
              </div>
            )}
          </div>
        )
      })()}
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
function SumRow({ label, value, bold, labelColor, valueColor, indent, noBorder }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: indent ? '6px 18px 10px 36px' : '10px 18px',
      borderBottom: noBorder ? 'none' : `1px solid ${T.borderLight}`,
    }}>
      <div style={{ fontSize: indent ? 12 : 13, fontWeight: bold ? 700 : 500, color: labelColor || T.text }}>{label}</div>
      <div style={{ fontSize: indent ? 13 : 14, fontWeight: bold ? 700 : 500, color: valueColor || T.text, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )
}

function SubscriptionDetailTable({ parents, childrenOf, annualListTotal, annualNetTotal, annualDiscountAmount, blendedDiscountPct, cv, summaryRows }) {
  // Column visibility: hidden columns are FILTERED OUT entirely (not blanked)
  // so the table actually collapses — what the AE toggles off, the customer
  // truly doesn't see.
  const ALL_COLS = [
    { key: 'solution',   label: 'Sage Intacct Subscription',  width: undefined, headColor: T.textMuted, align: 'left',  always: true },
    { key: 'list',       label: 'List',      width: 90,  headColor: C.textTertiary, align: 'right', visible: cv.list },
    { key: 'qty',        label: 'Qty',       width: 56,  headColor: C.textTertiary, align: 'right', visible: cv.qty },
    { key: 'total_list', label: 'Total list', width: 100, headColor: C.textTertiary, align: 'right', visible: cv.total_list },
    { key: 'disc_pct',   label: 'Disc %',    width: 70,  headColor: C.redDark,    align: 'right', visible: cv.disc_pct },
    { key: 'disc_amt',   label: 'Disc $',    width: 90,  headColor: C.redDark,    align: 'right', visible: cv.disc_amt },
    { key: 'net',        label: 'Net price', width: 110, headColor: C.greenDark,  align: 'right', visible: cv.net, isNet: true },
  ]
  const COLS = ALL_COLS.filter(c => c.always || c.visible)

  const cellHead = (color) => ({ padding: '10px 12px', fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.04em', textAlign: 'right', whiteSpace: 'nowrap', background: '#fff', borderBottom: `1px solid ${T.border}` })
  const cellData = (extra = {}) => ({ padding: '12px 12px', fontSize: 13, fontFeatureSettings: '"tnum"', textAlign: 'right', color: T.text, ...extra })

  function renderCell(p, col) {
    if (col.key === 'solution') {
      const kids = childrenOf(p.id)
      const isBundle = !!p.is_bundle && kids.length > 0
      return (
        <td key={col.key} className="ri-col-solution" style={{ padding: '12px 12px', textAlign: 'left', verticalAlign: 'top' }}>
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
    const lineList = num(p.quantity) * num(p.unit_price)
    const lineDisc = lineList - num(p.extended)
    const cls = `ri-col-${col.key}`
    switch (col.key) {
      case 'list':
        return <td key={col.key} className={cls} style={cellData({ color: C.textTertiary })}>{money(p.unit_price)}</td>
      case 'qty':
        return <td key={col.key} className={cls} style={cellData()}>{num(p.quantity).toLocaleString()}</td>
      case 'total_list':
        return <td key={col.key} className={cls} style={cellData({ color: C.textTertiary })}>{money(lineList)}</td>
      case 'disc_pct':
        return <td key={col.key} className={cls} style={cellData({ color: lineDisc > 0 ? C.redDark : T.textMuted })}>
          {num(p.discount_pct) > 0 ? `${Math.round(num(p.discount_pct) * 100)}%` : '—'}
        </td>
      case 'disc_amt':
        return <td key={col.key} className={cls} style={cellData({ color: lineDisc > 0 ? C.redDark : T.textMuted, fontWeight: lineDisc > 0 ? 600 : 400 })}>
          {lineDisc > 0 ? `−${money(lineDisc)}` : '—'}
        </td>
      case 'net':
        return <td key={col.key} className={cls} style={cellData({ background: C.greenSoftBg, color: C.greenDark, fontWeight: 500 })}>{money(p.extended)}</td>
      default:
        return <td key={col.key} className={cls} style={cellData()}>—</td>
    }
  }

  // Footer rows live inside the same table. Label cell spans across all
  // columns except the rightmost value column.
  const lastVisibleIdx = COLS.length - 1
  const labelSpan = lastVisibleIdx

  return (
    <div className="ri-prop-table-wrap" style={{ overflowX: 'auto' }}>
      <table className="ri-sub-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
        <colgroup>
          {COLS.map(c => <col key={c.key} className={`ri-col-${c.key}`} style={c.width ? { width: c.width } : undefined} />)}
        </colgroup>
        <thead>
          <tr>
            {COLS.map(c => (
              <th key={c.key} className={`ri-col-${c.key}`} style={{ ...cellHead(c.headColor), textAlign: c.align || 'right' }}>
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
          {summaryRows.list_subtotal && (
            <tr>
              <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.textTertiary, fontWeight: 600 }}>
                Annual subscription · total list price
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.textTertiary, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{money(annualListTotal)}</td>
            </tr>
          )}
          {summaryRows.discount_amount && annualDiscountAmount > 0 && (
            <tr>
              <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.redDark, fontWeight: 600 }}>
                Discount amount ({blendedDiscountPct}%)
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.redDark, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{moneyNeg(annualDiscountAmount)}</td>
            </tr>
          )}
          {summaryRows.net_total && (
            <tr style={{ background: C.greenSoftBg }}>
              <td colSpan={labelSpan} style={{ padding: '12px 12px', textAlign: 'right', fontSize: 13, color: C.greenDark, fontWeight: 700 }}>
                Net annual subscription total
              </td>
              <td style={{ padding: '12px 12px', textAlign: 'right', fontSize: 14, color: C.greenDark, fontWeight: 700, fontFeatureSettings: '"tnum"' }}>{money(annualNetTotal)}</td>
            </tr>
          )}
        </tfoot>
      </table>
    </div>
  )
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 2 — Schedules
// ═════════════════════════════════════════════════════════════════════════════
function SchedulesTab({ snapshot, accent, printAll = false }) {
  // Implementation schedule sub-tab only renders when a SOW is on file —
  // until then the AE has nothing to populate it from. Snapshot's `has_sow`
  // flag is set by snapshot_proposal RPC at push time.
  const hasSow = !!snapshot?.has_sow
  const SUBS = [
    { key: 'payment', label: 'Payment schedule' },
    ...(hasSow ? [{ key: 'impl', label: 'Implementation schedule' }] : []),
  ]
  const [sub, setSub] = useState('payment')
  // Defensively snap back to a visible sub-tab if the SOW gets removed
  // out from under us between renders.
  useEffect(() => {
    if (!SUBS.some(s => s.key === sub)) setSub(SUBS[0]?.key || 'payment')
  }, [hasSow])  // eslint-disable-line react-hooks/exhaustive-deps

  // Print mode: render every sub-section sequentially with its own header so
  // the PDF reader sees the full Schedules content, not just the active sub.
  if (printAll) {
    return (
      <div>
        <div style={{ marginBottom: 18 }}>
          <Eyebrow>Payment schedule</Eyebrow>
          <PaymentScheduleSubTab snapshot={snapshot} />
        </div>
        {hasSow && (
          <div>
            <Eyebrow>Implementation schedule</Eyebrow>
            <ImplementationScheduleSubTab snapshot={snapshot} accent={accent} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {SUBS.length > 1 && (
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
      )}
      {sub === 'payment' && <PaymentScheduleSubTab snapshot={snapshot} />}
      {sub === 'impl' && hasSow && <ImplementationScheduleSubTab snapshot={snapshot} accent={accent} />}
    </div>
  )
}

// ─── 2a. Payment schedule ────────────────────────────────────────────────────
function PaymentScheduleSubTab({ snapshot }) {
  const rawRows = snapshot.payment_schedule || []
  // Hidden rows (show_in_proposal === false) are filtered before sort. Older
  // snapshots without the field default to visible.
  const visibleRows = rawRows.filter(r => r.show_in_proposal !== false)
  if (!visibleRows.length) {
    return <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 13, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8 }}>No invoices scheduled yet.</div>
  }

  // Sort chronologically by invoice_date so implementation T&M rows that
  // start before the Y1 subscription invoice appear at the top of the table.
  // Tie-break on sequence_number to keep ordering stable for same-day rows.
  const rows = [...visibleRows].sort((a, b) => {
    const da = a.invoice_date ? new Date(a.invoice_date + 'T00:00:00').getTime() : 0
    const db = b.invoice_date ? new Date(b.invoice_date + 'T00:00:00').getTime() : 0
    if (da !== db) return da - db
    return (a.sequence_number || 0) - (b.sequence_number || 0)
  })

  // T&M implementation invoices ride the project schedule, so the dates are
  // an estimate, not a fixed invoice date. Surface that to the customer.
  const isEstimated = (pt) => pt === 'implementation_arrears' || pt === 'implementation_milestone'

  // Color scheme by payment_type
  const styleFor = (pt) => {
    if (pt === 'subscription_year' || pt === 'subscription_quarter') {
      return { rowBg: C.blueBg, accent: C.blueDark, amountColor: C.greenDark }
    }
    if (pt === 'partner_subscription_year' || pt === 'partner_implementation' || pt === 'partner_one_time') {
      return { rowBg: C.partnerBg, accent: C.partnerDark, amountColor: C.partnerDark }
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
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: `1px solid ${T.border}`, width: 160 }}>Date</th>
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left', borderBottom: `1px solid ${T.border}` }}>Description</th>
            <th style={{ padding: '10px 14px', fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', borderBottom: `1px solid ${T.border}`, width: 140 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = styleFor(r.payment_type)
            const isFree = r.payment_type === 'free_month'
            const estimated = isEstimated(r.payment_type)
            return (
              <tr key={i} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${T.borderLight}` : 'none', background: s.rowBg }}>
                <td style={{ padding: '12px 14px', color: T.text, boxShadow: `inset 3px 0 0 0 ${s.accent}` }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{fmtDateShort(r.invoice_date)}</span>
                    {estimated && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.greenDark, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85 }}>
                        Expected · estimated
                      </span>
                    )}
                  </div>
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

// ─── 2b. Implementation schedule (driven by uploaded SOW, NOT the deal MSP) ──
// The deal's MSP project plan covers pre-sale evaluation steps (Discovery,
// Demo, Scoping, Kick-off, Go-Live, etc.). Those don't belong here. The
// implementation schedule is the post-signature delivery plan and should
// come from a parsed Statement of Work — represented in our schema by
// msp_stages rows that carry a `sow_phase_key` (linked to the SOW doc).
//
// If no SOW phases exist yet, we show a clean empty state plus a preview
// of the standard 4-phase Sage cadence so the page still has visual weight.
function ImplementationScheduleSubTab({ snapshot, accent }) {
  const dealId = snapshot.deal?.id
  const [stages, setStages] = useState(null)

  useEffect(() => {
    let cancelled = false
    if (!dealId) { setStages([]); return }
    ;(async () => {
      // Only stages tied to a SOW phase are part of the implementation plan.
      const { data } = await supabase
        .from('msp_stages').select('*')
        .eq('deal_id', dealId)
        .not('sow_phase_key', 'is', null)
        .order('stage_order')
      if (!cancelled) setStages(data || [])
    })()
    return () => { cancelled = true }
  }, [dealId])

  const sageImpl = (snapshot.sage_implementation || []).find(i => i.duration_to_live_weeks) || (snapshot.sage_implementation || [])[0]
  const liveWeeks = num(sageImpl?.duration_to_live_weeks) || null
  const sowDocId = sageImpl?.sow_document_id

  if (stages == null) return <Spinner />

  const hasSowSchedule = stages.length > 0

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

      {hasSowSchedule ? (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 18 }}>
          {stages.map((s, i) => {
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
      ) : (
        // SOW is on file (parent gate ensures this) but parsing hasn't yet
        // produced sow_phase_key-tagged MSP stages. Show a terse message —
        // no placeholder cadence preview, no marketing copy.
        <div style={{
          padding: '14px 16px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
          color: T.textMuted, fontSize: 12, fontStyle: 'italic',
        }}>
          Phase-level schedule will appear here once the SOW is parsed.
        </div>
      )}
      {hasSowSchedule && <PhaseGantt stages={stages} accent={accent} placeholder={false} />}
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
function PhaseGantt({ stages, accent, placeholder }) {
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

  // Layout — wider canvas, tighter left lane so the chart eats more of the
  // card width. Extra bottom band so the milestone labels can stack
  // (name on one line, date on the next) without colliding with each other
  // when Go-Live and Project Complete are close together.
  const W = 1100, H = 280
  const leftLane = 120
  const rightPad = 24
  const topBand = 24
  const milestoneBand = 56
  const chartTop = topBand + 8
  const chartBottom = H - milestoneBand
  const chartHeight = chartBottom - chartTop
  const barH = (chartHeight - 10 * (PHASES.length - 1)) / PHASES.length
  const xPerWeek = (W - leftLane - rightPad) / totalWeeks
  const goLiveX = leftLane + goLiveWeek * xPerWeek

  // Robust date parsing: msp_stages.start_date is timestamptz so the value
  // arrives as a full ISO string ('2026-04-01T05:00:00+00:00'), not a bare
  // 'YYYY-MM-DD'. Naively appending 'T00:00:00' produced an Invalid Date.
  const parseDate = (v) => {
    if (!v) return null
    const s = String(v)
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00')
    return Number.isNaN(d.getTime()) ? null : d
  }

  const referenceStart = (() => {
    const starts = (stages || []).map(s => parseDate(s.start_date)).filter(Boolean)
    if (starts.length) return new Date(Math.min(...starts.map(d => d.getTime())))
    // Placeholder mode: anchor preview at today so the customer sees a
    // representative timeline even before the SOW is parsed.
    if (placeholder) {
      const t = new Date(); t.setHours(0, 0, 0, 0)
      return t
    }
    return null
  })()
  const fmtMs = (d) => d ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
  const fmtMsShort = (d) => d ? d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) : ''

  // Month axis labels
  const monthTicks = []
  if (referenceStart) {
    const lastDate = new Date(referenceStart.getTime() + totalWeeks * 7 * 86400000)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Implementation phases
        </div>
        {placeholder && (
          <div style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, fontStyle: 'italic' }}>
            Standard cadence preview · actual dates from the SOW
          </div>
        )}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet" style={{ display: 'block' }}>
        {/* Month axis */}
        {monthTicks.map((m, i) => (
          <text key={i} x={m.x} y={topBand - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill={T.textMuted} fontFamily={T.font}>
            {m.label}
          </text>
        ))}
        {/* Top axis line */}
        <line x1={leftLane} y1={topBand} x2={W - rightPad} y2={topBand} stroke={T.borderLight} strokeWidth="1" />

        {/* Phase rows */}
        {PHASES.map((p, idx) => {
          const y = chartTop + idx * (barH + 10)
          const x = leftLane + cumWeeks * xPerWeek
          const w = p.weeks * xPerWeek
          const startW = cumWeeks
          const endW = cumWeeks + p.weeks
          cumWeeks += p.weeks
          return (
            <g key={p.name}>
              <text x={leftLane - 12} y={y + barH / 2 + 2} textAnchor="end" fontSize="13" fontWeight="600" fill={T.text} fontFamily={T.font}>
                {p.name}
              </text>
              <text x={leftLane - 12} y={y + barH / 2 + 18} textAnchor="end" fontSize="10" fill={T.textMuted} fontFamily={T.font}>
                Wk {startW + 1}–{endW}
              </text>
              <rect x={x} y={y} width={w} height={barH} rx="4" fill={p.color} />
            </g>
          )
        })}

        {/* Vertical dashed Go-Live line */}
        <line x1={goLiveX} y1={topBand} x2={goLiveX} y2={chartBottom + 4} stroke={C.greenDark} strokeWidth="2" strokeDasharray="4,3" opacity="0.7" />

        {/* Milestone markers — diamond + name above the date, both anchored
            at center. Stacking avoids the collision when Go-Live and Project
            Complete sit close together. */}
        {[
          { week: 0, label: 'Kickoff', date: kickoffDate, bold: false, anchor: 'start' },
          { week: goLiveWeek, label: 'Go-Live', date: goLiveDate, bold: true, anchor: 'middle' },
          { week: totalWeeks, label: 'Project Complete', date: completeDate, bold: false, anchor: 'end' },
        ].map((m, i) => {
          const x = leftLane + m.week * xPerWeek
          return (
            <g key={i}>
              <path d={`M ${x},${chartBottom + 6} L ${x + 5},${chartBottom + 11} L ${x},${chartBottom + 16} L ${x - 5},${chartBottom + 11} Z`} fill={C.greenDark} />
              <text x={x} y={chartBottom + 32} textAnchor={m.anchor} fontSize="12" fontWeight={m.bold ? 700 : 600} fill={C.greenDark} fontFamily={T.font}>
                {m.label}
              </text>
              {m.date && (
                <text x={x} y={chartBottom + 46} textAnchor={m.anchor} fontSize="10" fill={T.textMuted} fontFamily={T.font}>
                  {fmtMsShort(m.date)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ─── Section visibility from snapshot.display_config.sections ───────────────
function readSection(snapshot, key) {
  const s = snapshot?.display_config?.sections || {}
  const v = s[key]
  return v === undefined || v === null ? true : !!v
}

// ═════════════════════════════════════════════════════════════════════════════
// TAB 4 — TCO Comparison
// Reuses the AE-side TcoModelsView in readOnly mode, fed by a synthetic
// `parentQuote` and `contractTerms` array assembled from the snapshot.
// ═════════════════════════════════════════════════════════════════════════════
function TcoComparisonTab({ snapshot }) {
  const totals = snapshot.totals || {}
  const term = snapshot.term
  // Synthetic quote shape — only the columns TcoModelsView reads. The
  // snapshot is the source of truth here, not the live quotes row.
  const parentQuote = {
    id: snapshot.quote_id,
    name: snapshot.quote_name,
    scenario_label: snapshot.deal?.company_name || snapshot.quote_name,
    sage_subscription_total: totals.sage_subscription,
    sage_implementation_total: totals.sage_implementation,
    signing_bonus_amount: snapshot.signing_bonus_amount,
    signing_bonus_months: snapshot.signing_bonus_months,
    signing_bonus_label: snapshot.signing_bonus_label,
    free_months: snapshot.free_months,
    contract_term_id: 'snapshot',  // synthetic id matched below
    tco_scenarios: Array.isArray(snapshot.tco_scenarios) ? snapshot.tco_scenarios : [],
  }
  const contractTerms = term ? [{
    id: 'snapshot',
    term_years: term.term_years,
    yoy_caps: term.yoy_caps,
  }] : []
  return (
    <div className="ri-print-block">
      <TcoModelsView
        parentQuote={parentQuote}
        contractTerms={contractTerms}
        readOnly={true}
      />
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
  const partnerBlocks = snapshot.partner_blocks || []
  const parents = sageLines.filter(l => !l.parent_line_id)

  const annualListTotal = parents.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0)
  const annualNetTotal = parents.reduce((s, l) => s + num(l.extended), 0)
  const discountTotal = annualListTotal - annualNetTotal
  const discountPct = annualListTotal > 0 ? discountTotal / annualListTotal : 0
  const discountPctDisplay = annualListTotal > 0 ? Math.round(discountPct * 100) : 0

  const implTotal = sageImpl.reduce((s, i) => s + num(i.total_amount ?? i.extended ?? i.amount), 0)
  // Partner subscription is flat across the term — no annual uplift (DataBlend
  // and similar partner SKUs aren't on a YoY cap schedule).
  const partnerSubAnnual = partnerBlocks.reduce((s, pb) =>
    s + (pb.lines || []).reduce((ss, l) => ss + num(l.extended), 0), 0)
  const signingBonusAmount = num(snapshot.signing_bonus_amount)
  const signingBonusMonths = num(snapshot.signing_bonus_months)
  const signingBonusLabel = (snapshot.signing_bonus_label || '').trim() || 'Signing Bonus'
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
  // Subscription total is gross net (post-discount) — signing bonus and free
  // months are shown as their own concession rows, not folded in. Partner
  // subscription is flat across the term (no annual uplift). Annual cost
  // reflects the actual cash:
  //   Y1   = subNet + impl + partnerSub − signingBonus
  //   Y2+  = subNet + partnerSub
  //   Total = sum of per-year annual cost − freeMonthsValue
  const yearSubNet = yearNet
  const yearImpl = yearNet.map((_, i) => i === 0 ? implTotal : 0)
  const yearPartnerSub = yearNet.map(() => partnerSubAnnual)
  const yearAnnualCost = yearSubNet.map((n, i) => n + yearImpl[i] + yearPartnerSub[i] - (i === 0 ? signingBonusValue : 0))

  const tot = (arr) => arr.reduce((s, n) => s + n, 0)

  const subNetTotal = tot(yearSubNet)
  const totalConcessions = tot(yearDisc) + freeMonthsValue + signingBonusValue
  const totalCost = tot(yearAnnualCost) - freeMonthsValue
  const yoyAvgSub = subNetTotal / termYears

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
            {discountTotal > 0 && readSection(snapshot, 'tco_subscription_discount') && (
              <tr style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                <td style={{ ...cellLabel, color: C.redDark }}>Subscription discount ({discountPctDisplay}%)</td>
                {yearDisc.map((v, i) => <td key={i} style={cellNum({ color: C.redDark })}>{moneyNeg(v)}</td>)}
                <td style={cellNum({ color: C.redDark, fontWeight: 600 })}>{moneyNeg(tot(yearDisc))}</td>
              </tr>
            )}

            {/* Block separator — heavier rule signals "what was negotiated"
                above ends here; the concrete cost block begins below. */}
            <tr>
              <td colSpan={termYears + 2} style={{ padding: 0, borderTop: `2px solid ${C.greenDark}`, height: 0 }}></td>
            </tr>

            {/* ── Concrete cost block ────────────────────────────────────
                All three rows share the soft-green ground so they read as
                one cohesive "this is what the customer actually pays" group.
                Annual cost is the terminal row, deeper green, bigger value,
                so the eye lands on the bottom-line number. */}

            {/* Subscription total */}
            <tr style={{ background: C.greenSoftBg }}>
              <td style={{ ...cellLabel, color: C.greenDark, fontWeight: 600 }}>Subscription total</td>
              {yearSubNet.map((v, i) => <td key={i} style={cellNum({ color: C.greenDark, fontWeight: 600 })}>{money(v)}</td>)}
              <td style={cellNum({ color: C.greenDark, fontWeight: 700 })}>{money(subNetTotal)}</td>
            </tr>

            {/* Partner subscription — flat across the term, no annual uplift.
                Tinted with the partner palette so partner spend reads as a
                distinct line from Sage subscription. */}
            {partnerSubAnnual > 0 && (
              <tr style={{ background: C.partnerSoftBg }}>
                <td style={{ ...cellLabel, color: C.partnerDark, fontWeight: 600 }}>Partner subscription</td>
                {yearPartnerSub.map((v, i) => <td key={i} style={cellNum({ color: C.partnerDark, fontWeight: 600 })}>{money(v)}</td>)}
                <td style={cellNum({ color: C.partnerDark, fontWeight: 700 })}>{money(partnerSubAnnual * termYears)}</td>
              </tr>
            )}

            {/* Implementation — Y1 only */}
            {readSection(snapshot, 'tco_implementation') && (
              <tr style={{ background: C.greenSoftBg }}>
                <td style={{ ...cellLabel, color: C.greenDark, fontWeight: 600 }}>Implementation (one-time)</td>
                {yearImpl.map((v, i) => <td key={i} style={cellNum({ color: C.greenDark, fontWeight: 600 })}>{i === 0 ? money(v) : '—'}</td>)}
                <td style={cellNum({ color: C.greenDark, fontWeight: 700 })}>{money(implTotal)}</td>
              </tr>
            )}

            {/* Signing bonus (red) — Y1 only credit, sits between Implementation
                and Annual cost so the column math reads cleanly. */}
            {signingBonusValue > 0 && readSection(snapshot, 'tco_signing_bonus') && (
              <tr style={{ background: C.greenSoftBg }}>
                <td style={{ ...cellLabel, color: C.redDark, fontWeight: 600 }}>{signingBonusLabel}</td>
                {yearNet.map((_, i) => (
                  <td key={i} style={cellNum({ color: C.redDark, fontWeight: 600 })}>
                    {i === 0 ? moneyNeg(signingBonusValue) : '—'}
                  </td>
                ))}
                <td style={cellNum({ color: C.redDark, fontWeight: 600 })}>{moneyNeg(signingBonusValue)}</td>
              </tr>
            )}

            {/* Free months (red) — credit on the 3-yr total only, not any single year */}
            {freeMonths > 0 && readSection(snapshot, 'tco_free_months') && (
              <tr style={{ background: C.greenSoftBg }}>
                <td style={{ ...cellLabel, color: C.redDark, fontWeight: 600 }}>Free Months ({freeMonths})</td>
                {yearNet.map((_, i) => <td key={i} style={cellNum({ color: C.redDark, fontWeight: 600 })}>—</td>)}
                <td style={cellNum({ color: C.redDark, fontWeight: 600 })}>{moneyNeg(freeMonthsValue)}</td>
              </tr>
            )}

            {/* Annual cost — bottom-line totals row */}
            <tr style={{ background: C.greenBg, borderTop: `2px solid ${C.greenDark}` }}>
              <td style={{ ...cellLabel, color: C.greenDark, fontWeight: 800, fontSize: 14, padding: '14px 14px' }}>Annual cost</td>
              {yearAnnualCost.map((v, i) => (
                <td key={i} style={cellNum({ color: C.greenDark, fontWeight: 800, fontSize: 16, padding: '14px 12px' })}>
                  {money(v)}
                </td>
              ))}
              <td style={cellNum({ color: C.greenDark, fontWeight: 900, fontSize: 18, padding: '14px 12px' })}>{money(totalCost)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3 summary cards — each individually hideable from AE side. Grid
          adapts (3 / 2 / 1 cols) so visible cards always span the row. If
          all three are hidden, the section disappears. */}
      {(() => {
        const cards = [
          readSection(snapshot, 'tco_card_total') && {
            bg: C.greenBg, border: C.greenDark, color: C.greenDark,
            label: `${termYears} YR Total`, value: money(totalCost),
          },
          readSection(snapshot, 'tco_card_concessions') && {
            bg: C.redBg, border: C.redDark, color: C.redDark,
            label: 'Total concessions', value: money(totalConcessions),
          },
          readSection(snapshot, 'tco_card_yoy_avg') && {
            bg: C.blueBg, border: C.blueDark, color: C.blueDark,
            label: 'YoY avg subscription', value: money(yoyAvgSub),
          },
        ].filter(Boolean)
        if (!cards.length) return null
        return (
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 10 }}>
            {cards.map((c, i) => <SummaryCard key={i} {...c} />)}
          </div>
        )
      })()}
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
