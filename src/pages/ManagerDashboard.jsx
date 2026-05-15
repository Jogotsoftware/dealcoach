import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency } from '../lib/theme'
import { Spinner } from '../components/Shared'
import DealChat from '../components/DealChat'

// ============================================================================
// Mockup-matching design tokens (exact hex values from the spec mockup so the
// dashboard reads identically to the design without retrofitting theme.js).
// ============================================================================
const D = {
  bg: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceAlt: '#F5F7FA',
  border: '#E1E8ED',
  borderLight: '#EDF2F7',
  text: '#2C3E50',
  textSec: '#5B6B7B',
  textMuted: '#8A99AB',
  textFaint: '#C5CED6',
  primary: '#5DADE2',
  primaryDark: '#2980B9',
  primaryTint: 'rgba(93, 173, 226, 0.08)',
  primaryEdge: 'rgba(93, 173, 226, 0.3)',
  success: '#27AE60',
  successBg: '#E8F8EE',
  successText: '#1E8449',
  warn: '#F39C12',
  warnText: '#B7791F',
  warnBg: '#FFF4E0',
  bad: '#E74C3C',
  badText: '#C0392B',
  badBg: '#FDECEA',
  flat: '#95A5A6',
  font: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
}

// ============================================================================
// Small helpers
// ============================================================================
function fyMonthsElapsed(today = new Date()) {
  const m = today.getUTCMonth() + 1
  return m >= 10 ? (m - 9) : (m + 3)
}

// Date range presets — Sage fiscal year is Oct-Sept. Each preset returns
// { from, to, label, fyShare } where fyShare ∈ (0,1] is the fraction of the
// annual quota that should have been booked by the END of the range. This
// lets attainment math prorate correctly for partial periods.
function dateRangePresets(today = new Date()) {
  const y = today.getUTCFullYear()
  const m = today.getUTCMonth() // 0-indexed
  // Fiscal year start: the most recent October 1.
  const fyStartYear = m >= 9 ? y : y - 1
  const fyLabel = `FY${fyStartYear + 1}` // FY2026 = Oct 2025 - Sept 2026
  const fyStart = new Date(Date.UTC(fyStartYear, 9, 1))
  const fyEnd   = new Date(Date.UTC(fyStartYear + 1, 9, 1)) // exclusive
  const todayUTC = new Date(Date.UTC(y, m, today.getUTCDate(), 23, 59, 59))
  const ms_per_day = 86400000
  const daysIntoFY = Math.max(1, Math.round((todayUTC - fyStart) / ms_per_day))
  const totalFYDays = Math.round((fyEnd - fyStart) / ms_per_day)
  // Quarter boundaries (Q1=Oct-Dec, Q2=Jan-Mar, Q3=Apr-Jun, Q4=Jul-Sep)
  const qStart = (qIdx) => new Date(Date.UTC(qIdx < 1 ? fyStartYear : fyStartYear + 1, [9, 0, 3, 6][qIdx], 1))
  const qEnd   = (qIdx) => new Date(Date.UTC(qIdx < 1 ? fyStartYear : fyStartYear + 1, [9, 0, 3, 6][qIdx] + 3, 1))
  const qLabel = (qIdx) => `${fyLabel} Q${qIdx + 1} (${['Oct–Dec','Jan–Mar','Apr–Jun','Jul–Sep'][qIdx]})`
  // Which quarter is today in?
  const currentQ = m >= 9 ? 0 : m <= 2 ? 1 : m <= 5 ? 2 : 3

  return [
    { key: 'fy_ytd',  label: `${fyLabel} YTD`, from: fyStart, to: todayUTC, fyShare: daysIntoFY / totalFYDays },
    { key: 'fy_full', label: `${fyLabel} Full Year`, from: fyStart, to: fyEnd,   fyShare: 1 },
    { key: 'q_curr',  label: qLabel(currentQ), from: qStart(currentQ), to: todayUTC < qEnd(currentQ) ? todayUTC : qEnd(currentQ), fyShare: ((Math.round(((todayUTC < qEnd(currentQ) ? todayUTC : qEnd(currentQ)) - fyStart) / ms_per_day)) / totalFYDays) },
    ...[0, 1, 2, 3].filter(i => i !== currentQ).map(i => ({
      key: `q${i + 1}`, label: qLabel(i),
      from: qStart(i), to: qEnd(i),
      fyShare: Math.round((qEnd(i) - fyStart) / ms_per_day) / totalFYDays,
    })),
    { key: 'last_30', label: 'Last 30 days', from: new Date(todayUTC - 30 * ms_per_day), to: todayUTC, fyShare: daysIntoFY / totalFYDays },
    { key: 'last_90', label: 'Last 90 days', from: new Date(todayUTC - 90 * ms_per_day), to: todayUTC, fyShare: daysIntoFY / totalFYDays },
    { key: 'prev_fy', label: `FY${fyStartYear} (Prior Year)`, from: new Date(Date.UTC(fyStartYear - 1, 9, 1)), to: fyStart, fyShare: 1 },
  ]
}
function fmtMoneyShort(n) {
  if (n == null || isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return `$${Math.round(n)}`
}
function fmtPct(n, digits = 0) {
  if (n == null || isNaN(n)) return '—'
  return `${(n * 100).toFixed(digits)}%`
}
function attainmentColor(pct) {
  if (pct == null) return D.textMuted
  if (pct >= 0.95) return D.success
  if (pct >= 0.80) return D.warn
  return D.bad
}
function healthPill(pct) {
  if (pct == null) return { label: 'NO DATA', bg: D.borderLight, color: D.textMuted }
  if (pct >= 0.90) return { label: 'ON TRACK', bg: D.successBg, color: D.successText }
  if (pct >= 0.78) return { label: 'WATCH', bg: D.warnBg, color: D.warnText }
  return { label: 'AT RISK', bg: D.badBg, color: D.badText }
}

// ============================================================================
// Reusable tile components
// ============================================================================
// RevenueTile — bigger headline number than MetricTile, but otherwise the
// same status/trend/benchmark/YoY treatment so the executive summary row
// reads consistently with the rest of the dashboard.
function RevenueTile({ label, value, valueColor, deltas = [], spark, status = 'neutral', trend, vsBenchmark, vsPrior }) {
  const statusColor = status === 'good' ? D.success : status === 'warn' ? D.warn : status === 'bad' ? D.bad : D.flat
  const statusBg = status === 'good' ? D.successBg : status === 'warn' ? D.warnBg : status === 'bad' ? D.badBg : 'transparent'
  return (
    <div style={{
      background: D.surface,
      border: `0.5px solid ${D.border}`,
      borderLeft: `3px solid ${statusColor}`,
      borderRadius: 12,
      padding: '16px 20px 14px',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 8 }}>
        <div style={{ fontSize: 10, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 600 }}>{label}</div>
        {trend && (
          <span style={{ fontSize: 13, color: trend === 'up' ? D.success : trend === 'down' ? D.bad : D.flat, fontWeight: 700, lineHeight: 1 }}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontSize: 28, fontWeight: 700, color: valueColor || D.text, lineHeight: 1, letterSpacing: '-0.8px' }}>{value}</div>
        {(spark !== undefined ? spark : trend) && (spark || <Sparkline trend={trend} color={statusColor} />)}
      </div>
      {(vsBenchmark || vsPrior) && (
        <div style={{ marginTop: 10, padding: '6px 8px', background: statusBg, borderRadius: 6, fontSize: 11, lineHeight: 1.5 }}>
          {vsBenchmark && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ color: D.textMuted, fontWeight: 500 }}>{vsBenchmark.label}</span>
              <span style={{ color: vsBenchmark.color || statusColor, fontWeight: 700 }}>{vsBenchmark.value}</span>
            </div>
          )}
          {vsPrior && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: vsBenchmark ? 2 : 0 }}>
              <span style={{ color: D.textMuted, fontWeight: 500 }}>{vsPrior.label}</span>
              <span style={{ color: vsPrior.color || D.flat, fontWeight: 700 }}>{vsPrior.value}</span>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, color: D.textSec, flex: 1 }}>
        {deltas.map((d, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ color: D.textMuted }}>{d.label}</span>
            {d.value && <span style={{ color: d.color || D.text, fontWeight: 500 }}>{d.value}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Mini sparkline — 7-point inline trend. Color matches status. The series can be
// auto-synthesized from a `trend` keyword ('up' | 'down' | 'flat') so callers
// don't have to invent realistic numbers everywhere.
function Sparkline({ series, color, trend, height = 22 }) {
  let pts = series
  if (!pts && trend) {
    const base = 50
    if (trend === 'up')   pts = [base-8, base-4, base-6, base-2, base+2, base+5, base+10]
    else if (trend === 'down') pts = [base+8, base+5, base+6, base+2, base-2, base-6, base-12]
    else pts = [base, base+2, base-1, base+1, base-2, base+1, base]
  }
  if (!pts || pts.length < 2) return null
  const w = 64, h = height
  const min = Math.min(...pts), max = Math.max(...pts)
  const span = max - min || 1
  const stepX = w / (pts.length - 1)
  const points = pts.map((v, i) => `${i * stepX},${h - ((v - min) / span) * h}`).join(' ')
  const last = pts[pts.length - 1]
  const lastX = (pts.length - 1) * stepX, lastY = h - ((last - min) / span) * h
  return (
    <svg width={w} height={h} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  )
}

// MetricTile — status drives the left edge color, the sparkline color, and the
// benchmark delta color. Pass `status` as 'good' | 'warn' | 'bad' | 'neutral'.
// Optional: `vsBenchmark` (a deltas line that gets explicit emphasis) and `vsPrior`
// (YoY/QoQ) get rendered as dedicated rows so the eye reads them at a glance.
function MetricTile({ label, value, unit, deltas = [], spark, big, status = 'neutral', vsBenchmark, vsPrior, trend }) {
  const statusColor = status === 'good' ? D.success : status === 'warn' ? D.warn : status === 'bad' ? D.bad : D.flat
  const statusBg = status === 'good' ? D.successBg : status === 'warn' ? D.warnBg : status === 'bad' ? D.badBg : 'transparent'
  return (
    <div style={{
      background: D.surface,
      border: `0.5px solid ${D.border}`,
      borderLeft: `3px solid ${statusColor}`,
      borderRadius: 12,
      padding: '16px 18px 14px',
      minHeight: 156,
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
        <div style={{ fontSize: 11.5, color: D.textSec, fontWeight: 500, lineHeight: 1.3 }}>{label}</div>
        {trend && (
          <span style={{ fontSize: 13, color: trend === 'up' ? D.success : trend === 'down' ? D.bad : D.flat, fontWeight: 700, lineHeight: 1 }}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '—'}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div style={{ fontSize: big ? 28 : 24, fontWeight: 700, color: D.text, lineHeight: 1, letterSpacing: '-0.5px' }}>{value}</div>
          {unit && <div style={{ fontSize: 12, color: D.textMuted }}>{unit}</div>}
        </div>
        {(spark !== undefined ? spark : trend) && (spark || <Sparkline trend={trend} color={statusColor} />)}
      </div>
      {(vsBenchmark || vsPrior) && (
        <div style={{ marginTop: 10, padding: '6px 8px', background: statusBg, borderRadius: 6, fontSize: 11, lineHeight: 1.5 }}>
          {vsBenchmark && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ color: D.textMuted, fontWeight: 500 }}>{vsBenchmark.label}</span>
              <span style={{ color: vsBenchmark.color || statusColor, fontWeight: 700 }}>{vsBenchmark.value}</span>
            </div>
          )}
          {vsPrior && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: vsBenchmark ? 2 : 0 }}>
              <span style={{ color: D.textMuted, fontWeight: 500 }}>{vsPrior.label}</span>
              <span style={{ color: vsPrior.color || D.flat, fontWeight: 700 }}>{vsPrior.value}</span>
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 11.5, lineHeight: 1.6, flex: 1 }}>
        {deltas.map((d, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: D.textMuted }}>{d.label}</span>
            {d.value && <span style={{ color: d.color || D.flat, fontWeight: 500 }}>{d.value}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

function GapCard({ title, severity, desc, cta, onClick }) {
  const sevColor = severity === 'HIGH' ? D.bad : severity === 'MED' ? D.warn : D.primary
  const sevBg = severity === 'HIGH' ? D.badBg : severity === 'MED' ? D.warnBg : D.primaryTint
  const sevText = severity === 'HIGH' ? D.badText : severity === 'MED' ? D.warnText : D.primaryDark
  return (
    <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '18px 20px', borderLeft: `3px solid ${sevColor}`, cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: D.text }}>{title}</div>
        <div style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, fontWeight: 600, letterSpacing: '0.3px', background: sevBg, color: sevText }}>{severity}</div>
      </div>
      <div style={{ fontSize: 12.5, color: D.textSec, lineHeight: 1.55, marginBottom: 10 }}>{desc}</div>
      {cta && <div style={{ fontSize: 12, color: D.primary, fontWeight: 500 }}>{cta} &rarr;</div>}
    </div>
  )
}

// AVP / RVP / AE drill card on the Teams tab
function PersonCard({ person, metrics, onClick, level }) {
  const pill = healthPill(metrics.attainment_pct)
  const fillColor = metrics.attainment_pct == null ? D.flat : metrics.attainment_pct >= 0.90 ? D.primary : metrics.attainment_pct >= 0.78 ? D.warn : D.bad
  const teamLabel = level === 'avp' ? `${metrics.rvp_count || 0} RVPs · ${metrics.ae_count || 0} AEs`
                  : level === 'rvp' ? `${metrics.ae_count || 0} AEs`
                  : ''
  return (
    <div onClick={onClick} style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '20px 22px', cursor: 'pointer', transition: 'all 0.15s' }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = D.primary; e.currentTarget.style.boxShadow = '0 2px 8px rgba(93, 173, 226, 0.08)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = D.border; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: 600, color: D.text, marginBottom: 2 }}>{person.full_name}</div>
          <div style={{ fontSize: 11.5, color: D.textMuted }}>
            {person.segment || person.team || ''}{teamLabel ? ` · ${teamLabel}` : ''}
          </div>
        </div>
        <div style={{ padding: '4px 10px', borderRadius: 100, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.3px', background: pill.bg, color: pill.color }}>{pill.label}</div>
      </div>
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <div style={{ fontSize: 11, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 500 }}>YTD Attainment</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: D.text }}>{fmtPct(metrics.attainment_pct)}</div>
        </div>
        <div style={{ height: 6, background: D.borderLight, borderRadius: 100, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${Math.min(100, (metrics.attainment_pct || 0) * 100)}%`, background: fillColor, borderRadius: 100 }} />
        </div>
      </div>
      {/* Melanie's 5 non-negotiables */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14, paddingTop: 14, borderTop: `0.5px solid ${D.borderLight}` }}>
        <NonNegMini label="Coverage" value={metrics.coverage != null ? `${metrics.coverage.toFixed(1)}x` : '—'} />
        <NonNegMini label="Won %" value={fmtPct(metrics.win_rate)} bad={metrics.win_rate != null && metrics.win_rate < 0.25} />
        <NonNegMini label="Cycle" value={metrics.cycle_days != null ? `${Math.round(metrics.cycle_days)}d` : '—'} />
        <NonNegMini label="Multi-thr" value={metrics.multi_thread != null ? metrics.multi_thread.toFixed(2) : '—'} bad={metrics.multi_thread != null && metrics.multi_thread < 0.55} />
        <NonNegMini label="Next Mtg" value={fmtPct(metrics.next_mtg_pct)} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: D.primary, fontWeight: 500 }}>
        <span>{level === 'rvp' ? 'View team' : level === 'ae' ? 'View deals' : 'View team'} &rarr;</span>
        {teamLabel && <span style={{ color: D.textMuted, fontWeight: 400 }}>{teamLabel}</span>}
      </div>
    </div>
  )
}

function NonNegMini({ label, value, bad }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: bad ? D.bad : D.text, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// Forecast bucket stack — toggle between tiles / bar / donut
function ForecastDistribution({ buckets }) {
  const [view, setView] = useState('tiles')  // tiles | bar | donut
  const total = buckets.reduce((s, b) => s + b.value, 0) || 1
  return (
    <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '18px 22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: D.text }}>Q3 Forecast Distribution</div>
          <div style={{ fontSize: 11, color: D.textMuted }}>commit · forecast · upside · pipeline</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[
            { k: 'tiles', label: 'Tiles' },
            { k: 'bar', label: 'Bar' },
            { k: 'donut', label: 'Donut' },
          ].map(o => (
            <button key={o.k} onClick={() => setView(o.k)} style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 6,
              border: `0.5px solid ${view === o.k ? D.primary : D.border}`,
              background: view === o.k ? D.primaryTint : D.surface,
              color: view === o.k ? D.primaryDark : D.textSec,
              cursor: 'pointer', fontFamily: D.font,
            }}>{o.label}</button>
          ))}
        </div>
      </div>
      {view === 'tiles' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {buckets.map(b => (
            <div key={b.key} style={{ padding: 14, borderRadius: 8, border: `0.5px solid ${D.border}` }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: b.color, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{b.label}</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: D.text, marginTop: 4 }}>{fmtMoneyShort(b.value)}</div>
              <div style={{ fontSize: 11, color: D.textMuted, marginTop: 2 }}>{b.count} deals</div>
            </div>
          ))}
        </div>
      )}
      {view === 'bar' && (
        <>
          <div style={{ display: 'flex', height: 28, borderRadius: 6, overflow: 'hidden' }}>
            {buckets.map(b => (
              <div key={b.key} style={{ width: `${(b.value / total) * 100}%`, background: b.color }} title={`${b.label}: ${fmtMoneyShort(b.value)} (${b.count} deals)`} />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 11, color: D.textSec, flexWrap: 'wrap' }}>
            {buckets.map(b => (
              <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 10, height: 10, background: b.color, borderRadius: 2 }} />
                <span><b style={{ color: D.text }}>{b.label}:</b> {fmtMoneyShort(b.value)} · {b.count} deals</span>
              </div>
            ))}
          </div>
        </>
      )}
      {view === 'donut' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <DonutSvg buckets={buckets} total={total} />
          <div style={{ flex: 1, fontSize: 12, color: D.textSec }}>
            {buckets.map(b => (
              <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <span style={{ width: 12, height: 12, background: b.color, borderRadius: 3 }} />
                <span style={{ flex: 1, color: D.text, fontWeight: 500 }}>{b.label}</span>
                <span style={{ color: D.textSec }}>{fmtMoneyShort(b.value)}</span>
                <span style={{ color: D.textMuted, marginLeft: 6 }}>{((b.value / total) * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DonutSvg({ buckets, total }) {
  const r = 60, cx = 80, cy = 80, c = 2 * Math.PI * r
  let cum = 0
  return (
    <svg width={160} height={160} viewBox="0 0 160 160">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={D.borderLight} strokeWidth={20} />
      {buckets.map((b, i) => {
        const len = (b.value / total) * c
        const dash = `${len} ${c - len}`
        const offset = -cum
        cum += len
        return <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={b.color} strokeWidth={20} strokeDasharray={dash} strokeDashoffset={offset} transform={`rotate(-90 ${cx} ${cy})`} />
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize="14" fontWeight="700" fill={D.text}>{fmtMoneyShort(total)}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="10" fill={D.textMuted}>total</text>
    </svg>
  )
}

// ============================================================================
// Main component
// ============================================================================
export default function ManagerDashboard() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Tab is now driven by the URL path (sidebar nav routes here).
  // Default = revenue when path is /manager or unrecognized.
  const tabFromPath = (() => {
    const p = location.pathname.replace(/^\/+/, '').split('/')[0]
    if (['revenue','pipeline','execution','coaching','forecast','team'].includes(p)) return p === 'team' ? 'teams' : p
    return 'revenue'
  })()
  const [loading, setLoading] = useState(true)
  const [allProfiles, setAllProfiles] = useState([])
  const [allDeals, setAllDeals] = useState([])
  const [allPredictions, setAllPredictions] = useState([])
  const [allPerf, setAllPerf] = useState([])
  const [allContacts, setAllContacts] = useState([])
  const [allScores, setAllScores] = useState([])
  const [allCoaching, setAllCoaching] = useState([])
  const [drillStack, setDrillStack] = useState([])
  const [chatOpen, setChatOpen] = useState(false)
  // Date range filter — defaults to FY YTD which matches the prior hardcoded
  // behavior. Picking another range re-prorates quota + re-filters wonDeals.
  const datePresets = useMemo(() => dateRangePresets(new Date()), [])
  const [dateKey, setDateKey] = useState('fy_ytd')
  const [dateMenuOpen, setDateMenuOpen] = useState(false)
  // Segment filter — restricts AE population to a chosen segment (Strategic/
  // Enterprise/Mid-Market/SMB). null = all segments.
  const [segmentFilter, setSegmentFilter] = useState(null)
  const [segmentMenuOpen, setSegmentMenuOpen] = useState(false)

  // ----- Filters drawer (custom date + AVP/RVP/AE cascade + compare-against) -----
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [avpFilter, setAvpFilter] = useState(null) // user_id
  const [rvpFilter, setRvpFilter] = useState(null) // user_id
  const [aeFilter, setAeFilter]   = useState(null) // user_id
  const [customFrom, setCustomFrom] = useState('') // YYYY-MM-DD
  const [customTo,   setCustomTo]   = useState('') // YYYY-MM-DD
  // Compare-against — depends on date granularity. Options derived below.
  const [compareKey, setCompareKey] = useState('budget')

  // Resolve granularity from the selected date preset. Drives which compare options apply.
  const granularity = useMemo(() => {
    if (dateKey === 'custom') return 'custom'
    if (dateKey === 'last_30') return 'monthly'
    if (dateKey === 'last_90') return 'quarterly'
    if (dateKey.startsWith('q_curr') || /^q\d$/.test(dateKey)) return 'quarterly'
    if (dateKey === 'fy_ytd' || dateKey === 'fy_full' || dateKey === 'prev_fy') return 'annual'
    return 'annual'
  }, [dateKey])

  const compareOptions = useMemo(() => {
    const base = [{ key: 'budget', label: 'Budget (quota)' }, { key: 'goal', label: 'Goal (stretch)' }]
    if (granularity === 'monthly')   return [{ key: 'last_month',   label: 'Last month'                }, { key: 'prior_year_month',   label: 'Same month, prior year'   }, ...base]
    if (granularity === 'quarterly') return [{ key: 'last_quarter', label: 'Last quarter'              }, { key: 'prior_year_quarter', label: 'Same quarter, prior year' }, ...base]
    if (granularity === 'annual')    return [{ key: 'prior_year',   label: 'Prior year (same period)' }, ...base]
    return [{ key: 'prior_year_period', label: 'Same period, prior year' }, ...base]
  }, [granularity])

  // If the user changes the date range, snap compareKey to the first option for the new granularity
  // when the current key is invalid for that granularity.
  useEffect(() => {
    if (!compareOptions.some(o => o.key === compareKey)) setCompareKey(compareOptions[0].key)
  }, [compareOptions, compareKey])

  // Compute the prior-period range given the current range + compare key.
  // Returns null when comparing against Budget or Goal (no date-range needed).
  function priorRangeFor(currentRange, key) {
    if (!currentRange || key === 'budget' || key === 'goal') return null
    const ms_per_day = 86400000
    const from = new Date(currentRange.from)
    const to   = new Date(currentRange.to)
    const shiftMonths = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x }
    if (key === 'last_month')         return { from: shiftMonths(from, -1), to: shiftMonths(to, -1), label: 'Last month' }
    if (key === 'last_quarter')       return { from: shiftMonths(from, -3), to: shiftMonths(to, -3), label: 'Last quarter' }
    if (key === 'prior_year_month' || key === 'prior_year_quarter' || key === 'prior_year' || key === 'prior_year_period') {
      return { from: shiftMonths(from, -12), to: shiftMonths(to, -12), label: 'Prior year' }
    }
    return null
  }

  // Effective root for metricsFor when an AVP/RVP/AE filter is set.
  // AE wins, then RVP, then AVP — matches the cascade UX.
  function effectiveRootId(defaultRootId) {
    return aeFilter || rvpFilter || avpFilter || defaultRootId
  }

  // Resolved AVP/RVP/AE option lists for the cascade.
  const avpOptions = useMemo(() => allProfiles.filter(p => p.role_level === 'avp').sort((a, b) => (a.full_name || '').localeCompare(b.full_name || '')), [allProfiles])
  const rvpOptions = useMemo(() => {
    const all = allProfiles.filter(p => p.role_level === 'rvp')
    if (!avpFilter) return all.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    return all.filter(p => p.manager_id === avpFilter).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [allProfiles, avpFilter])
  const aeOptions = useMemo(() => {
    const all = allProfiles.filter(p => p.role_level === 'ae')
    if (rvpFilter) return all.filter(p => p.manager_id === rvpFilter).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    // No RVP picked → derive AEs under selected AVP if any.
    if (avpFilter) {
      const rvpsUnderAvp = new Set(allProfiles.filter(p => p.role_level === 'rvp' && p.manager_id === avpFilter).map(p => p.id))
      return all.filter(p => rvpsUnderAvp.has(p.manager_id)).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    }
    return all.sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  }, [allProfiles, avpFilter, rvpFilter])

  // Auto-clear narrower filters when a broader one changes to keep the cascade consistent.
  useEffect(() => { if (rvpFilter && !rvpOptions.some(r => r.id === rvpFilter)) setRvpFilter(null) }, [avpFilter, rvpOptions, rvpFilter])
  useEffect(() => { if (aeFilter && !aeOptions.some(a => a.id === aeFilter)) setAeFilter(null) }, [avpFilter, rvpFilter, aeOptions, aeFilter])

  // Resolved dateRange — preset OR custom (from inputs). Custom uses an
  // approximated fyShare = days-elapsed-in-FY / total-FY-days at the `to` date.
  const dateRange = useMemo(() => {
    if (dateKey === 'custom') {
      if (!customFrom || !customTo) return datePresets[0]
      const from = new Date(customFrom + 'T00:00:00Z')
      const to   = new Date(customTo   + 'T23:59:59Z')
      // Find FY containing `to` for prorating quota
      const m = to.getUTCMonth()
      const y = to.getUTCFullYear()
      const fyStartYear = m >= 9 ? y : y - 1
      const fyStart = new Date(Date.UTC(fyStartYear, 9, 1))
      const fyEnd   = new Date(Date.UTC(fyStartYear + 1, 9, 1))
      const ms_per_day = 86400000
      const daysIntoFY = Math.max(1, Math.round((to - fyStart) / ms_per_day))
      const totalFYDays = Math.round((fyEnd - fyStart) / ms_per_day)
      return { key: 'custom', label: `${customFrom} → ${customTo}`, from, to, fyShare: Math.min(1, daysIntoFY / totalFYDays) }
    }
    return datePresets.find(p => p.key === dateKey) || datePresets[0]
  }, [dateKey, customFrom, customTo, datePresets])

  const activeFilterCount = (segmentFilter ? 1 : 0) + (avpFilter ? 1 : 0) + (rvpFilter ? 1 : 0) + (aeFilter ? 1 : 0) + (dateKey !== 'fy_ytd' ? 1 : 0) + (compareKey !== 'budget' ? 1 : 0)
  function clearAllFilters() {
    setSegmentFilter(null); setAvpFilter(null); setRvpFilter(null); setAeFilter(null)
    setDateKey('fy_ytd'); setCompareKey('budget'); setCustomFrom(''); setCustomTo('')
  }
  const activeTab = tabFromPath
  const setActiveTab = (t) => navigate(t === 'teams' ? '/team' : `/${t}`)

  useEffect(() => {
    if (!profile?.org_id) return
    let cancelled = false
    async function loadAll() {
      setLoading(true)
      try {
        // Supabase enforces a server-side max-rows cap (default 1000). .range()
        // alone doesn't bypass it for tables larger than the cap, so we paginate
        // by chunked offset until the response is shorter than the chunk size.
        // The Sage demo org has 3.3k deals — fetching all of them is essential
        // because the bookings/attainment math is silently zero otherwise.
        const PAGE = 1000
        const orgId = profile.org_id
        async function fetchAllPaged(builderFn) {
          const out = []
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await builderFn().range(from, from + PAGE - 1)
            if (error) { console.error('paged fetch error:', error); break }
            if (!data || data.length === 0) break
            out.push(...data)
            if (data.length < PAGE) break
            if (from > 100000) break // hard guard
          }
          return out
        }
        const [profRows, dealRows, predRows, perfRows] = await Promise.all([
          fetchAllPaged(() => supabase.from('profiles').select('id, full_name, email, manager_id, role_level, role, segment, team, annual_quota, goal_monthly, goal_quarterly, goal_annual, metadata').eq('org_id', orgId)),
          fetchAllPaged(() => supabase.from('deals').select('id, rep_id, company_name, stage, forecast_category, deal_value, target_close_date, closed_at, created_at, stage_changed_at, fit_score, deal_health_score, source').eq('org_id', orgId)),
          fetchAllPaged(() => supabase.from('deal_forecast_predictions').select('deal_id, predicted_close_probability, predicted_forecast_category, key_factors').eq('org_id', orgId)),
          fetchAllPaged(() => supabase.from('rep_historical_performance').select('rep_id, fiscal_period, total_bookings, rep_forecast_variance, win_rate, avg_cycle_days_won, avg_discovery_depth_score, avg_compelling_event_coverage, avg_msp_completion_at_close, avg_transcripts_per_won_deal').eq('org_id', orgId)),
        ])
        if (cancelled) return
        setAllProfiles(profRows)
        setAllDeals(dealRows)
        setAllPredictions(predRows)
        setAllPerf(perfRows)
        // Contacts + deal_scores have no org_id column — restrict by the
        // deal_ids we just loaded so we don't pull every org's data. Each .in()
        // chunk also needs paging in case the matched rows exceed PAGE size.
        const dealIds = dealRows.map(d => d.id)
        if (dealIds.length) {
          const chunks = []
          for (let i = 0; i < dealIds.length; i += 500) chunks.push(dealIds.slice(i, i + 500))
          const contactRows = []
          const scoreRows = []
          for (const chunk of chunks) {
            const [cdata, sdata] = await Promise.all([
              fetchAllPaged(() => supabase.from('contacts').select('deal_id, role_in_deal').in('deal_id', chunk)),
              fetchAllPaged(() => supabase.from('deal_scores').select('deal_id, score_type, score').in('deal_id', chunk)),
            ])
            contactRows.push(...cdata)
            scoreRows.push(...sdata)
          }
          if (!cancelled) {
            setAllContacts(contactRows)
            setAllScores(scoreRows)
          }
        } else {
          setAllContacts([])
          setAllScores([])
        }
        // Fetch rep_coaching_summary scoped to this org's profiles. The pagination
        // refactor changed `prof` to `profRows` (array, not {data:[...]}), so the
        // old `prof.data` was undefined → empty profileIds → no coaching fetch →
        // heat map empty. Use profRows directly and chunk to dodge the URL cap.
        const profileIds = profRows.map(p => p.id)
        if (profileIds.length) {
          const coachingRows = []
          for (let i = 0; i < profileIds.length; i += 500) {
            const chunk = profileIds.slice(i, i + 500)
            const cdata = await fetchAllPaged(() =>
              supabase.from('rep_coaching_summary')
                .select('user_id, top_strengths, top_improvements, score_averages, calls_analyzed')
                .in('user_id', chunk)
            )
            coachingRows.push(...cdata)
          }
          if (!cancelled) setAllCoaching(coachingRows)
        }
      } catch (err) { console.error('ManagerDashboard load:', err) }
      finally { if (!cancelled) setLoading(false) }
    }
    loadAll()
    return () => { cancelled = true }
  }, [profile?.org_id])

  // ----- indexes -----
  const childrenByMgr = useMemo(() => {
    const m = {}
    for (const p of allProfiles) { if (p.manager_id) (m[p.manager_id] ||= []).push(p) }
    return m
  }, [allProfiles])
  const predByDeal = useMemo(() => {
    const m = {}
    for (const p of allPredictions) if (!m[p.deal_id]) m[p.deal_id] = p
    return m
  }, [allPredictions])
  const contactsByDeal = useMemo(() => {
    const m = {}
    for (const c of allContacts) (m[c.deal_id] ||= []).push(c)
    return m
  }, [allContacts])
  const scoresByDeal = useMemo(() => {
    const m = {}
    for (const s of allScores) (m[s.deal_id] ||= []).push(s)
    return m
  }, [allScores])

  function downstreamAEIds(rootId, segment = null) {
    const root = allProfiles.find(p => p.id === rootId)
    if (!root) return []
    if (root.role_level === 'ae') {
      if (segment && root.segment !== segment) return []
      return [root.id]
    }
    const queue = [root.id], aeIds = []
    while (queue.length) {
      const cur = queue.shift()
      for (const k of (childrenByMgr[cur] || [])) {
        if (k.role_level === 'ae') {
          if (!segment || k.segment === segment) aeIds.push(k.id)
        } else {
          queue.push(k.id)
        }
      }
    }
    return aeIds
  }

  // Compute aggregate metrics for any person (rolls up downstream AEs).
  // dateRange (optional) prorates quota and filters wonDeals by closed_at.
  // Segment filter is read from outer state via closure.
  function metricsFor(personId, dateRange = null, segmentOverride) {
    // segmentOverride === undefined → use the active segmentFilter (default).
    // segmentOverride === null      → bypass segment filtering entirely.
    // segmentOverride === 'SMB' etc → use that segment.
    const seg = segmentOverride === undefined ? segmentFilter : segmentOverride
    const aeIds = downstreamAEIds(personId, seg)
    const aeIdSet = new Set(aeIds)
    const peopleAEs = allProfiles.filter(p => aeIdSet.has(p.id))
    const dealsScope = allDeals.filter(d => aeIdSet.has(d.rep_id))
    const annualQuotaSum = peopleAEs.reduce((s, p) => s + (Number(p.annual_quota) || 0), 0)
    // Prorate quota by the date range's fyShare. If no range supplied, default
    // to FY YTD (which is what the dashboard previously assumed).
    const fyShare = dateRange?.fyShare != null ? dateRange.fyShare : (fyMonthsElapsed() / 12)
    const ytdQuota = annualQuotaSum * fyShare
    const fromDate = dateRange?.from || new Date(Date.UTC(new Date().getUTCMonth() >= 9 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1, 9, 1))
    const toDate = dateRange?.to || new Date(Date.UTC(new Date().getUTCFullYear() + 5, 0, 1))
    const wonDeals = dealsScope.filter(d => d.stage === 'closed_won' && d.closed_at && new Date(d.closed_at) >= fromDate && new Date(d.closed_at) <= toDate)
    const bookings = wonDeals.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
    const activeDeals = dealsScope.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
    const activeValue = activeDeals.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
    const commitForecast = activeDeals.filter(d => ['commit','forecast'].includes(d.forecast_category))
    const cfValue = commitForecast.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
    const closedAll = dealsScope.filter(d => ['closed_won','closed_lost','disqualified'].includes(d.stage))
    const winRate = closedAll.length ? closedAll.filter(d => d.stage === 'closed_won').length / closedAll.length : null
    const avgCycle = wonDeals.length ? wonDeals.reduce((s, d) => {
      const days = (new Date(d.closed_at) - new Date(d.created_at)) / (1000 * 60 * 60 * 24)
      return s + (isFinite(days) ? days : 0)
    }, 0) / wonDeals.length : null
    let slipRisk = 0
    for (const d of commitForecast) {
      const p = predByDeal[d.id]
      if (!p?.predicted_close_probability) continue
      const threshold = d.forecast_category === 'commit' ? 0.90 : 0.80
      if (Number(p.predicted_close_probability) < threshold) slipRisk++
    }
    let pullIn = 0
    for (const d of activeDeals.filter(x => ['upside','pipeline'].includes(x.forecast_category))) {
      const p = predByDeal[d.id]
      if (!p?.predicted_close_probability) continue
      const threshold = d.forecast_category === 'upside' ? 0.80 : 0.65
      if (Number(p.predicted_close_probability) > threshold) pullIn++
    }
    // Multi-thread: avg critical roles per active deal
    let critTotal = 0, dealCount = 0
    for (const d of activeDeals) {
      const cs = contactsByDeal[d.id] || []
      const crit = new Set(cs.map(c => c.role_in_deal).filter(r => ['Mobilizer','Economic Buyer','Blocker'].includes(r)))
      critTotal += crit.size
      dealCount++
    }
    const multiThread = dealCount ? critTotal / dealCount / 3 : null
    // RVP/AE counts under this person
    const allUnder = allProfiles.filter(p => downstreamAEIds(personId).includes(p.id) || (p.manager_id && downstreamAEIds(personId).some(aeId => p.id === aeId)))
    const rvpCount = (childrenByMgr[personId] || []).filter(p => p.role_level === 'rvp').length
    // Self-sourced sourcing — AE prospecting (vs BDR, marketing, partner). Top reps
    // generate ≥30% of their own pipeline. Tracked separately for active vs closed.
    const selfSourcedActive = activeDeals.filter(d => d.source === 'self_sourced')
    const selfSourcedActiveValue = selfSourcedActive.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
    const selfSourcedWon = wonDeals.filter(d => d.source === 'self_sourced')
    const selfSourcedWonValue = selfSourcedWon.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
    const selfSourcedActivePct = activeDeals.length ? selfSourcedActive.length / activeDeals.length : null
    const selfSourcedWonPct = wonDeals.length ? selfSourcedWon.length / wonDeals.length : null
    // ASP — Average Selling Price = mean closed-won deal value over the period.
    // Surfaced on the Coaching tab so reps + managers can see the size of the
    // deals they're winning, not just the count or total $.
    const asp = wonDeals.length ? bookings / wonDeals.length : null
    return {
      attainment_pct: ytdQuota > 0 ? bookings / ytdQuota : null,
      bookings_ytd: bookings,
      quota_ytd: ytdQuota,
      annual_quota: annualQuotaSum,
      asp,
      won_count: wonDeals.length,
      coverage: ytdQuota > 0 ? activeValue / (annualQuotaSum - bookings || 1) : null,
      active_value: activeValue,
      active_count: activeDeals.length,
      cf_value: cfValue,
      cf_count: commitForecast.length,
      win_rate: winRate,
      cycle_days: avgCycle,
      multi_thread: multiThread,
      next_mtg_pct: 0.73, // computed-on-fly stub — would need tasks table query
      slip_risk_count: slipRisk,
      pull_in_count: pullIn,
      ae_count: aeIds.length,
      rvp_count: rvpCount,
      self_sourced_active_value: selfSourcedActiveValue,
      self_sourced_active_count: selfSourcedActive.length,
      self_sourced_won_value: selfSourcedWonValue,
      self_sourced_won_count: selfSourcedWon.length,
      self_sourced_active_pct: selfSourcedActivePct,
      self_sourced_won_pct: selfSourcedWonPct,
    }
  }

  // currentParent default: drill stack OR the signed-in person. If AVP/RVP/AE
  // filter set, override to that person so the dashboard pivots into their slice.
  const filterTargetId = aeFilter || rvpFilter || avpFilter
  const filterTargetProfile = filterTargetId ? allProfiles.find(p => p.id === filterTargetId) : null
  const currentParent = filterTargetProfile || (drillStack.length > 0 ? drillStack[drillStack.length - 1] : profile)
  const currentMetrics = useMemo(
    () => (currentParent?.id ? metricsFor(currentParent.id, dateRange) : {}),
    [currentParent?.id, allProfiles, allDeals, allPredictions, allContacts, dateRange?.key, dateRange?.from, dateRange?.to, segmentFilter]
  )
  // Prior-period metrics when compareKey calls for a date comparison.
  const priorRange = useMemo(() => priorRangeFor(dateRange, compareKey), [dateRange, compareKey])
  const priorMetrics = useMemo(
    () => (currentParent?.id && priorRange ? metricsFor(currentParent.id, priorRange) : null),
    [currentParent?.id, allProfiles, allDeals, allPredictions, allContacts, priorRange?.from, priorRange?.to, segmentFilter]
  )

  // Sum the appropriate goal column across downstream AEs for the current scope.
  function goalSumFor(personId, periodKey /* 'monthly'|'quarterly'|'annual' */) {
    const aeIds = downstreamAEIds(personId, segmentFilter)
    const aeSet = new Set(aeIds)
    const col = periodKey === 'monthly' ? 'goal_monthly' : periodKey === 'quarterly' ? 'goal_quarterly' : 'goal_annual'
    let total = 0; let any = false
    for (const p of allProfiles) {
      if (!aeSet.has(p.id)) continue
      const v = Number(p[col])
      if (Number.isFinite(v) && v > 0) { total += v; any = true }
    }
    return any ? total : null
  }
  // Comparison target for the headline "vsBenchmark" prop.
  // Returns { label, value } or null when comparison isn't a budget/goal target.
  const compareTarget = useMemo(() => {
    if (!currentParent?.id) return null
    if (compareKey === 'budget') return { label: 'Budget', value: currentMetrics.quota_ytd || null }
    if (compareKey === 'goal') {
      // Use period that matches granularity; fall back to annual prorated by fyShare for partial periods.
      let g = null
      if (granularity === 'monthly')   g = goalSumFor(currentParent.id, 'monthly')
      if (granularity === 'quarterly') g = goalSumFor(currentParent.id, 'quarterly')
      if (granularity === 'annual')    g = goalSumFor(currentParent.id, 'annual')
      if (g == null && granularity !== 'monthly' && granularity !== 'quarterly') {
        // annual goal × fyShare for partial-FY ranges
        const annual = goalSumFor(currentParent.id, 'annual')
        if (annual != null) g = annual * (dateRange?.fyShare ?? 1)
      }
      return { label: 'Goal', value: g }
    }
    return null
  }, [compareKey, granularity, currentMetrics.quota_ytd, currentParent?.id, allProfiles, segmentFilter, dateRange?.fyShare])
  const directReports = currentParent?.id
    ? (childrenByMgr[currentParent.id] || []).sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    : []

  if (loading || !profile) return <div style={{ padding: 40, background: D.bg, minHeight: '100vh' }}><Spinner /></div>

  const crumbs = [
    { id: profile.id, full_name: 'Org', role_level: 'org' },
    ...drillStack,
  ]
  const showDealsLevel = currentParent.role_level === 'ae' && drillStack.length > 0

  return (
    <div style={{ background: D.bg, minHeight: '100vh', fontFamily: D.font, color: D.text }}>
      <div style={{ maxWidth: 1440, margin: '0 auto', padding: '32px 40px' }}>

        {/* HEADER — title matches active sidebar nav */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600, color: D.text, margin: 0, display: 'inline' }}>
              {profile.full_name?.split(' ')[0] || 'Sales'}'s {({ revenue: 'Revenue', pipeline: 'Pipeline', execution: 'Execution', coaching: 'Coaching', forecast: 'Forecast', teams: 'Team' }[activeTab] || 'Metrics')} Dashboard
            </h1>
            <span style={{ fontSize: 13, color: D.textMuted, marginLeft: 12 }}>
              {profile.role_level === 'head_of_sales' ? 'Vice President of Sales' : profile.role_level?.toUpperCase() || ''} · {dateRange.label}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: D.textSec }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: D.success }} />
            <span>Live · Updated just now</span>
          </div>
        </div>

        {/* FILTER BAR — date picker + segment filter chip. Date stays visible
            on Team (windowing per-person attainment is useful) but segment is
            hidden there since it would silently drop AVPs/RVPs from the list. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, marginBottom: 16, position: 'relative' }}>
          {/* Filters — single subtle icon. All filter controls live in the popover. */}
          <div style={{ position: 'relative' }}>
            <div onClick={() => setFiltersOpen(o => !o)} title="Filters"
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                background: filtersOpen ? D.primaryTint : 'transparent',
                border: `0.5px solid ${filtersOpen ? D.primary : D.border}`,
                borderRadius: 8, cursor: 'pointer', fontSize: 12, userSelect: 'none',
                color: filtersOpen || activeFilterCount > 0 ? D.primary : D.textMuted, fontWeight: 600,
              }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span style={{ padding: '0 6px', borderRadius: 10, background: D.primary, color: '#fff', fontSize: 10, fontWeight: 700 }}>{activeFilterCount}</span>
              )}
            </div>
            {filtersOpen && (
              <FiltersPanel
                onClose={() => setFiltersOpen(false)}
                datePresets={datePresets}
                dateKey={dateKey} setDateKey={setDateKey}
                customFrom={customFrom} setCustomFrom={setCustomFrom}
                customTo={customTo}     setCustomTo={setCustomTo}
                avpFilter={avpFilter}   setAvpFilter={setAvpFilter}   avpOptions={avpOptions}
                rvpFilter={rvpFilter}   setRvpFilter={setRvpFilter}   rvpOptions={rvpOptions}
                aeFilter={aeFilter}     setAeFilter={setAeFilter}     aeOptions={aeOptions}
                segmentFilter={segmentFilter} setSegmentFilter={setSegmentFilter}
                compareKey={compareKey} setCompareKey={setCompareKey} compareOptions={compareOptions}
                onClear={clearAllFilters}
                D={D}
              />
            )}
          </div>
          <div style={{ flex: 1, textAlign: 'right', fontSize: 12, color: D.textMuted }}>
            {dateRange.label}
            {' · '}
            Scope: {drillStack.length === 0 ? (filterTargetProfile ? filterTargetProfile.full_name : 'All AVPs · All RVPs · All Reps') : crumbs.slice(1).map(c => c.full_name).join(' › ')}
            {segmentFilter ? ` · ${segmentFilter}` : ''}
            {compareKey !== 'budget' && (
              <span style={{ marginLeft: 6, color: D.primary, fontWeight: 600 }}>
                · vs {(compareOptions.find(o => o.key === compareKey) || {}).label}
              </span>
            )}
          </div>
        </div>

        {/* SCOPE BREADCRUMB */}
        {drillStack.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: D.textMuted, marginBottom: 16 }}>
            {crumbs.map((c, i) => (
              <span key={c.id || i}>
                {i > 0 && <span style={{ margin: '0 6px' }}>›</span>}
                <a onClick={(e) => { e.preventDefault(); setDrillStack(drillStack.slice(0, i)) }}
                  style={{ color: i === crumbs.length - 1 ? D.text : D.primary, fontWeight: i === crumbs.length - 1 ? 700 : 500, cursor: 'pointer', textDecoration: 'none' }}>
                  {c.full_name}
                </a>
              </span>
            ))}
          </div>
        )}

        {/* Tab nav removed — now lives in left sidebar (Revenue/Pipeline/Execution/Coaching/Team) */}

        {/* TAB CONTENT — scope deals by current parent + segment filter; tabs that
            care about period (closed_in_window, etc.) use dateRange to slice.
            metricsForRanged closes over the active dateRange so child rows on
            the heat map / Team cards prorate the same as the headline tile. */}
        {(() => {
          const aeIdsInScope = downstreamAEIds(currentParent.id, segmentFilter)
          const aeIdSet = new Set(aeIdsInScope)
          const dealsInScope = allDeals.filter(d => aeIdSet.has(d.rep_id))
          const inDateWindow = (d) => {
            if (!d.closed_at) return ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage)
            const t = new Date(d.closed_at)
            return t >= dateRange.from && t <= dateRange.to
          }
          // Pipeline tab cares about "this period" — restrict closed/disqualified
          // to deals that closed inside the date window. Active deals always show.
          const dealsForPipeline = dealsInScope.filter(d =>
            ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage) || inDateWindow(d)
          )
          const downstreamAEs = allProfiles.filter(p => aeIdSet.has(p.id))
          const metricsForRanged = (id) => metricsFor(id, dateRange)
          return (
            <>
              {activeTab === 'revenue'   && <RevenueTab metrics={currentMetrics} allDeals={dealsInScope} predByDeal={predByDeal} />}
              {activeTab === 'pipeline'  && <PipelineTab metrics={currentMetrics} allDeals={dealsForPipeline} />}
              {activeTab === 'execution' && <ExecutionTab metrics={currentMetrics} allDeals={dealsInScope} />}
              {activeTab === 'coaching'  && <CoachingTab metrics={currentMetrics} allDeals={dealsInScope} scoresByDeal={scoresByDeal} downstreamAEs={downstreamAEs} coachingByUser={(() => { const m = {}; for (const c of allCoaching) m[c.user_id] = c; return m })()} metricsFor={metricsForRanged} />}
              {activeTab === 'forecast'  && <ForecastTab allDeals={dealsInScope} dateRange={dateRange} metrics={currentMetrics} predByDeal={predByDeal} />}
              {activeTab === 'teams'     && (
                <TeamsTab
                  currentParent={currentParent}
                  /* Team tab honors the active date range (per-person attainment
                     for the chosen window) but bypasses the segment filter so
                     RVPs/AVPs aren't silently dropped from the direct-reports
                     list. metricsFor's third arg `null` explicitly disables the
                     closure segmentFilter for these rollups. */
                  directReports={directReports}
                  metricsFor={(id) => metricsFor(id, dateRange, null)}
                  showDealsLevel={showDealsLevel}
                  allDeals={allDeals.filter(d => d.rep_id === currentParent.id)}
                  predByDeal={predByDeal}
                  onDrill={(p) => setDrillStack([...drillStack, p])}
                  onDealClick={(d) => navigate(`/deal/${d.id}`)}
                />
              )}
            </>
          )
        })()}

        {/* Gaps panel only on Revenue tab — was previously repeated on every tab,
            which felt redundant. Once on the executive landing page is enough. */}
        {activeTab === 'revenue' && (
          <section style={{ marginTop: 32 }}>
            <SectionHeader title="Gaps at this scope" meta="Auto-surfaced by Lumen · ranked by impact" />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              <GapCard title="Lack of verified Compelling Event" severity="HIGH"
                desc="Only 27% of active deals have a verified Compelling Event. Without a dated, material consequence of inaction, deals stall in Confirming Value and convert to no-decision at 2.4× the rate of CE-verified deals."
                cta="Drill into Brendan's org"
                onClick={() => { const b = allProfiles.find(p => p.full_name === 'Brendan Tougias'); if (b) { setActiveTab('teams'); setDrillStack([b]) } }} />
              <GapCard title="Single-threaded past Discovery" severity="HIGH"
                desc={`${currentMetrics.slip_risk_count || 42} deals advanced past Discovery without Economic Buyer identified. Reps are not getting to Power early enough — late-stage power access correlates with 2× slip rate.`}
                cta="View violations"
                onClick={() => setActiveTab('execution')} />
              <GapCard title="Pain not being quantified" severity="MED"
                desc="Only 13% of reps are actively quantifying pain in hard dollars, hours spent, and P&L impact from process/visibility problems. Without quantified pain, reps struggle to articulate value and justify pricing — discounting rises and Confirming Value cycles lengthen."
                cta="See coaching gaps"
                onClick={() => setActiveTab('coaching')} />
            </div>
          </section>
        )}

        {/* CHAT FAB */}
        <button onClick={() => setChatOpen(true)} title="Ask Lumen" style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1090, width: 56, height: 56, borderRadius: '50%',
          background: D.primary, color: '#fff', border: 'none', cursor: 'pointer',
          boxShadow: '0 6px 20px rgba(93,173,226,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: D.font, fontSize: 13, fontWeight: 700,
        }}>Ask</button>
        {profile?.id && (
          <DealChat scope="pipeline" dealId={null} userId={currentParent.id}
            orgId={profile.org_id} isOpen={chatOpen} onClose={() => setChatOpen(false)} />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Tab subcomponents
// ============================================================================

function SectionHeader({ title, meta }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
      <h2 style={{ fontSize: 11, fontWeight: 600, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.8px', margin: 0 }}>{title}</h2>
      <div style={{ fontSize: 11, color: D.textMuted }}>{meta}</div>
    </div>
  )
}

function FilterPill({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: D.surfaceAlt, border: `0.5px solid ${D.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
      <span style={{ color: D.textMuted, fontWeight: 500 }}>{label}</span>
      <span style={{ color: D.text, fontWeight: 500 }}>{value}</span>
      <span style={{ color: D.textMuted, fontSize: 10, marginLeft: 2 }}>▾</span>
    </div>
  )
}

function deltaUp(value)   { return { value, color: D.success } }
function deltaDown(value) { return { value, color: D.bad } }
function deltaFlat(value) { return { value, color: D.flat } }

// ----- REVENUE TAB -----
function RevenueTab({ metrics, allDeals, predByDeal }) {
  const m = metrics
  // Forecast distribution buckets
  const active = allDeals.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
  const sumBy = (cat) => active.filter(d => d.forecast_category === cat).reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
  const cntBy = (cat) => active.filter(d => d.forecast_category === cat).length
  const buckets = [
    { key: 'commit', label: 'Commit', value: sumBy('commit'), count: cntBy('commit'), color: D.success },
    { key: 'forecast', label: 'Forecast', value: sumBy('forecast'), count: cntBy('forecast'), color: D.primary },
    { key: 'upside', label: 'Upside', value: sumBy('upside'), count: cntBy('upside'), color: D.warn },
    { key: 'pipeline', label: 'Pipeline', value: sumBy('pipeline'), count: cntBy('pipeline'), color: D.flat },
  ]
  const cfValue = buckets[0].value + buckets[1].value
  const cfCount = buckets[0].count + buckets[1].count

  return (
    <>
      {/* Melanie's 5 Non-Negotiables — these lead the page because every manager
          (head_of_sales, AVP, RVP) is held to them universally. Same row appears
          on the Execution tab; this is the executive-summary version up top. */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="The 5 Non-Negotiables" meta="universal manager scorecard" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <MetricTile label="Pipeline Coverage" value={m.coverage ? `${m.coverage.toFixed(1)}x` : '—'}
            status={(m.coverage || 0) >= 3 ? 'good' : (m.coverage || 0) >= 2 ? 'warn' : 'bad'}
            trend={(m.coverage || 0) >= 3 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 3.0x target', value: m.coverage ? `${(m.coverage - 3).toFixed(1)}x` : '—',
              color: (m.coverage || 0) >= 3 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.2x', color: D.success }}
            deltas={[{ label: 'active ÷ remaining quota' }]} />
          <MetricTile label="Won Rate %" value={fmtPct(m.win_rate)}
            status={(m.win_rate || 0) >= 0.30 ? 'good' : (m.win_rate || 0) >= 0.22 ? 'warn' : 'bad'}
            trend={(m.win_rate || 0) >= 0.30 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 30% target', value: m.win_rate ? `${((m.win_rate - 0.30) * 100).toFixed(0)}pp` : '—',
              color: (m.win_rate || 0) >= 0.30 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+3pp', color: D.success }}
            deltas={[{ label: 'won ÷ (won + lost)' }]} />
          <MetricTile label="Avg Days to Close" value={m.cycle_days ? Math.round(m.cycle_days) : '—'} unit="days"
            status={(m.cycle_days || 999) <= 60 ? 'good' : (m.cycle_days || 999) <= 90 ? 'warn' : 'bad'}
            trend={(m.cycle_days || 999) <= 60 ? 'down' : 'up'}
            vsBenchmark={{ label: 'vs 60 day target', value: m.cycle_days ? `${(m.cycle_days - 60).toFixed(0)} days` : '—',
              color: (m.cycle_days || 0) <= 60 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '−4 days', color: D.success }}
            deltas={[{ label: 'QDC approved → close' }]} />
          <MetricTile label="Multi-Threaded Ratio" value={m.multi_thread != null ? m.multi_thread.toFixed(2) : '—'}
            status={(m.multi_thread || 0) >= 0.75 ? 'good' : (m.multi_thread || 0) >= 0.50 ? 'warn' : 'bad'}
            trend={(m.multi_thread || 0) >= 0.75 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs 0.75 target', value: m.multi_thread != null ? `${(m.multi_thread - 0.75).toFixed(2)}` : '—',
              color: (m.multi_thread || 0) >= 0.75 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.04', color: D.success }}
            deltas={[{ label: 'critical contacts / deal' }]} />
          <MetricTile label="Next Meeting Scheduled" value={fmtPct(m.next_mtg_pct)}
            status={(m.next_mtg_pct || 0) >= 0.85 ? 'good' : (m.next_mtg_pct || 0) >= 0.70 ? 'warn' : 'bad'}
            trend={(m.next_mtg_pct || 0) >= 0.85 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 85% target', value: m.next_mtg_pct ? `${((m.next_mtg_pct - 0.85) * 100).toFixed(0)}pp` : '—',
              color: (m.next_mtg_pct || 0) >= 0.85 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '−4pp', color: D.bad }}
            deltas={[{ label: '% active w/ meeting in 14d' }]} />
        </div>
      </section>

      {/* Row 1: revenue headlines */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Revenue Summary" meta={`FY2026 · ${m.ae_count || 0} reps`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <RevenueTile label="Total Pipeline" value={fmtMoneyShort(m.active_value)}
            status={(m.coverage || 0) >= 3 ? 'good' : (m.coverage || 0) >= 2 ? 'warn' : 'bad'}
            trend="up"
            vsBenchmark={{ label: `${m.coverage ? m.coverage.toFixed(1) + 'x' : '—'} coverage vs 3.0x`, value: m.coverage ? `${(m.coverage - 3).toFixed(1)}x` : '—',
              color: (m.coverage || 0) >= 3 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY pipeline', value: '+18%', color: D.success }}
            deltas={[{ label: `${m.active_count} deals` }]} />
          <RevenueTile label="Closed Won YTD" value={fmtMoneyShort(m.bookings_ytd)}
            status={m.bookings_ytd >= m.quota_ytd ? 'good' : m.bookings_ytd >= m.quota_ytd * 0.85 ? 'warn' : 'bad'}
            trend="up"
            vsBenchmark={{ label: 'vs YTD target', value: m.quota_ytd > m.bookings_ytd ? `−${fmtMoneyShort(m.quota_ytd - m.bookings_ytd)}` : `+${fmtMoneyShort(m.bookings_ytd - m.quota_ytd)}`,
              color: m.quota_ytd > m.bookings_ytd ? D.bad : D.success }}
            vsPrior={{ label: 'YoY bookings', value: '+15%', color: D.success }} />
          <RevenueTile label="Quota Attainment YTD" value={fmtPct(m.attainment_pct)} valueColor={attainmentColor(m.attainment_pct)}
            status={(m.attainment_pct || 0) >= 1 ? 'good' : (m.attainment_pct || 0) >= 0.85 ? 'warn' : 'bad'}
            trend={(m.attainment_pct || 0) >= 1 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs pace (100%)', value: m.attainment_pct ? `${((m.attainment_pct - 1) * 100).toFixed(0)}pp` : '—',
              color: (m.attainment_pct || 0) >= 1 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY at this point', value: '+6pp', color: D.success }} />
          <RevenueTile label="Q3 Forecast (Commit + Fcst)" value={fmtMoneyShort(cfValue)}
            status="warn" trend="flat"
            vsBenchmark={{ label: 'vs Q3 plan', value: '−6%', color: D.warn }}
            vsPrior={{ label: 'YoY Q3', value: '+9%', color: D.success }}
            deltas={[{ label: `${cfCount} deals · closes by Q-end` }]} />
          <RevenueTile label="Annual Quota" value={fmtMoneyShort(m.annual_quota)}
            status="neutral" trend="up"
            vsBenchmark={{ label: 'vs FY25 plan', value: '+12%', color: D.success }}
            vsPrior={{ label: 'YoY plan', value: '+12%', color: D.success }}
            deltas={[{ label: `Across ${m.ae_count || 0} AEs` }]} />
        </div>
      </section>

      {/* Row 2: Forecast distribution toggleable */}
      <section style={{ marginBottom: 32 }}>
        <ForecastDistribution buckets={buckets} />
      </section>

      {/* Row 3: Deal shape */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Deal Shape & Pricing" meta="active pipeline" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <RevenueTile label="Avg Deal Size (Pipeline)" value={fmtMoneyShort(m.active_count ? m.active_value / m.active_count : 0)}
            status="good" trend="up"
            vsBenchmark={{ label: 'vs $50K target', value: '+8%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+11%', color: D.success }}
            deltas={[{ label: `${m.active_count} active deals` }]} />
          <RevenueTile label="Active Deals in Pipeline" value={String(m.active_count || 0)}
            status="good" trend="up"
            vsBenchmark={{ label: 'vs ≥600 target', value: m.active_count ? `+${m.active_count - 600}` : '—',
              color: (m.active_count || 0) >= 600 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+9%', color: D.success }}
            deltas={[{ label: `${fmtMoneyShort(m.active_value)} total` }]} />
          <RevenueTile label="Avg Won Deal Size" value={fmtMoneyShort(m.bookings_ytd && m.attainment_pct ? m.bookings_ytd / Math.max(1, m.bookings_ytd / 50000) : 0)}
            status="good" trend="up"
            vsBenchmark={{ label: 'vs $45K target', value: '+11%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+13%', color: D.success }}
            deltas={[{ label: 'YTD won deals' }]} />
        </div>
      </section>
    </>
  )
}

// ----- PIPELINE TAB -----
function PipelineTab({ metrics, allDeals }) {
  const m = metrics
  const active = allDeals.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
  const closedWon = allDeals.filter(d => d.stage === 'closed_won')
  const closedLost = allDeals.filter(d => d.stage === 'closed_lost')
  const dq = allDeals.filter(d => d.stage === 'disqualified')
  const nurture = allDeals.filter(d => d.stage === 'needs_nurture')
  const stale = active.filter(d => {
    const last = d.stage_changed_at || d.created_at
    if (!last) return false
    return (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24) > 14
  })
  const sumValue = (arr) => arr.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)

  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="QDC Funnel" meta="qualified discovery calls" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="QDC Volume (booked)" value={String(Math.round((m.ae_count || 0) * 4))} status="good" trend="up"
            vsBenchmark={{ label: 'vs target', value: '+12%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+18%', color: D.success }} />
          <MetricTile label="QDC Approval Rate" value="67%" status="bad" trend="down"
            vsBenchmark={{ label: 'vs 75% target', value: '−8pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '−3pp', color: D.bad }} />
          <MetricTile label="Approved QDCs" value={String(Math.round((m.ae_count || 0) * 2.7))} status="warn" trend="flat"
            vsBenchmark={{ label: 'vs goal', value: '−5%', color: D.warn }}
            vsPrior={{ label: 'YoY', value: '+4%', color: D.success }} />
          <MetricTile label="Cost per Approved QDC" value="$1.8K" status="good" trend="down"
            vsBenchmark={{ label: 'vs $2.1K target', value: '−$300', color: D.success }}
            vsPrior={{ label: 'YoY', value: '−$220', color: D.success }} />
        </div>
      </section>

      {/* PIPELINE SOURCING — self-sourced is the leading indicator of rep
          ownership and quality. Top reps source ≥30% of their own pipeline. */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Pipeline Sourcing" meta="self-sourced vs assisted" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile
            label="Self-Sourced Pipeline"
            value={fmtMoneyShort(m.self_sourced_active_value)}
            status={(m.self_sourced_active_pct || 0) >= 0.30 ? 'good' : (m.self_sourced_active_pct || 0) >= 0.20 ? 'warn' : 'bad'}
            trend={(m.self_sourced_active_pct || 0) >= 0.30 ? 'up' : (m.self_sourced_active_pct || 0) >= 0.20 ? 'flat' : 'down'}
            vsBenchmark={{ label: 'vs ≥30% target', value: m.self_sourced_active_pct != null ? `${((m.self_sourced_active_pct - 0.30) * 100).toFixed(0)}pp` : '—', color: (m.self_sourced_active_pct || 0) >= 0.30 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+4pp', color: D.success }}
            deltas={[{ label: `${fmtPct(m.self_sourced_active_pct)} of active pipeline` }]}
          />
          <MetricTile
            label="Self-Sourced Active Deals"
            value={String(m.self_sourced_active_count || 0)}
            unit="deals"
            status={(m.self_sourced_active_pct || 0) >= 0.30 ? 'good' : (m.self_sourced_active_pct || 0) >= 0.20 ? 'warn' : 'bad'}
            trend={(m.self_sourced_active_pct || 0) >= 0.30 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs assisted', value: `${fmtPct(m.self_sourced_active_pct)}` }}
            deltas={[{ label: `${m.active_count - (m.self_sourced_active_count || 0)} from BDR/marketing/partner` }]}
          />
          <MetricTile
            label="Closed-Won Self-Sourced"
            value={fmtMoneyShort(m.self_sourced_won_value)}
            status={(m.self_sourced_won_pct || 0) >= 0.30 ? 'good' : (m.self_sourced_won_pct || 0) >= 0.20 ? 'warn' : 'bad'}
            trend="up"
            vsBenchmark={{ label: 'vs ≥30% target', value: m.self_sourced_won_pct != null ? `${((m.self_sourced_won_pct - 0.30) * 100).toFixed(0)}pp` : '—', color: (m.self_sourced_won_pct || 0) >= 0.30 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+12%', color: D.success }}
            deltas={[{ label: `${fmtPct(m.self_sourced_won_pct)} of YTD bookings` }]}
          />
          <MetricTile
            label="Closed-Won Self-Sourced Deals"
            value={String(m.self_sourced_won_count || 0)}
            unit="deals"
            status={(m.self_sourced_won_pct || 0) >= 0.30 ? 'good' : (m.self_sourced_won_pct || 0) >= 0.20 ? 'warn' : 'bad'}
            trend="up"
            vsBenchmark={{ label: 'win contribution', value: `${fmtPct(m.self_sourced_won_pct)}` }}
            deltas={[{ label: 'higher-quality, higher-margin deals' }]}
          />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Pipeline Volume" meta="$ and counts at this scope" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="Total Pipeline" value={fmtMoneyShort(m.active_value)} status="good" trend="up"
            vsBenchmark={{ label: 'vs goal', value: '+8%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+18%', color: D.success }}
            deltas={[{ label: `${m.active_count} deals` }]} />
          <MetricTile label="Pipeline Coverage" value={m.coverage ? `${m.coverage.toFixed(1)}x` : '—'}
            status={(m.coverage || 0) >= 3 ? 'good' : (m.coverage || 0) >= 2 ? 'warn' : 'bad'}
            trend={(m.coverage || 0) >= 3 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 3.0x target', value: m.coverage ? `${(m.coverage - 3).toFixed(1)}x` : '—', color: (m.coverage || 0) >= 3 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.2x', color: D.success }} />
          <MetricTile label="Commit + Forecast" value={fmtMoneyShort(m.cf_value)} status="warn" trend="flat"
            vsBenchmark={{ label: 'vs Q3 plan', value: '−6%', color: D.warn }}
            vsPrior={{ label: 'YoY Q3', value: '+9%', color: D.success }}
            deltas={[{ label: `${m.cf_count} deals` }]} />
          <MetricTile label="Avg Deal Size" value={fmtMoneyShort(m.active_count ? m.active_value / m.active_count : 0)} status="good" trend="up"
            vsBenchmark={{ label: 'vs $50K target', value: '+8%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+11%', color: D.success }}
            deltas={[{ label: 'pipeline avg' }]} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Pipeline Flow (this period)" meta="how deals are exiting active pipeline" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="Closed Won" value={fmtMoneyShort(sumValue(closedWon))} status="good" trend="up"
            vsPrior={{ label: 'YoY', value: '+15%', color: D.success }}
            deltas={[{ label: `${closedWon.length} deals` }]} />
          <MetricTile label="Closed Lost" value={fmtMoneyShort(sumValue(closedLost))} status="bad" trend="up"
            vsPrior={{ label: 'YoY', value: '+8%', color: D.bad }}
            deltas={[{ label: `${closedLost.length} deals` }]} />
          <MetricTile label="Disqualified" value={fmtMoneyShort(sumValue(dq))} status="good" trend="up"
            vsBenchmark={{ label: 'qualifying out earlier', value: '+18%', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+22%', color: D.success }}
            deltas={[{ label: `${dq.length} deals` }]} />
          <MetricTile label="Needs Nurture" value={fmtMoneyShort(sumValue(nurture))} status="warn" trend="up"
            vsBenchmark={{ label: 'vs ≤$3M target', value: `+${fmtMoneyShort(sumValue(nurture) - 3_000_000)}`, color: D.warn }}
            vsPrior={{ label: 'YoY', value: '+14%', color: D.warn }}
            deltas={[{ label: `${nurture.length} deals` }]} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Pipeline at Risk" meta="critical signals for review" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="At-Risk Pipeline (slip risk)" value={String(m.slip_risk_count || 0)} unit="deals" status="bad" trend="up"
            vsBenchmark={{ label: 'vs ≤15 acceptable', value: `+${Math.max(0, (m.slip_risk_count || 0) - 15)}`, color: D.bad }}
            deltas={[{ label: 'commit/forecast w/ low confidence', color: D.bad }]} />
          <MetricTile label="Pull-In Opportunities" value={String(m.pull_in_count || 0)} unit="deals" status="good" trend="up"
            vsPrior={{ label: 'last 30d', value: '+12', color: D.success }}
            deltas={[{ label: 'upside/pipeline w/ rising signal', color: D.success }]} />
          <MetricTile label="Stale Deals (no activity 14+d)" value={String(stale.length)} unit="deals"
            status={stale.length > 50 ? 'bad' : stale.length > 20 ? 'warn' : 'good'}
            trend={stale.length > 50 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs ≤20 target', value: `${stale.length - 20 >= 0 ? '+' : ''}${stale.length - 20}`,
              color: stale.length <= 20 ? D.success : D.bad }}
            vsPrior={{ label: 'last 30d', value: '+24', color: D.bad }}
            deltas={[{ label: fmtMoneyShort(sumValue(stale)) }]} />
          <MetricTile label="Single-Threaded Past Discovery" value={String(Math.round((m.active_count || 0) * 0.32))} unit="deals"
            status="bad" trend="up"
            vsBenchmark={{ label: 'vs ≤10% target', value: '+22pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '+8pp', color: D.bad }}
            deltas={[{ label: 'no Economic Buyer identified', color: D.bad }]} />
        </div>
      </section>
    </>
  )
}

// ----- EXECUTION TAB -----
function ExecutionTab({ metrics, allDeals }) {
  const m = metrics
  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Melanie's 5 Non-Negotiables" meta="universal quality measures" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <MetricTile label="Pipeline Coverage" value={m.coverage ? `${m.coverage.toFixed(1)}x` : '—'}
            status={(m.coverage || 0) >= 3 ? 'good' : (m.coverage || 0) >= 2 ? 'warn' : 'bad'}
            trend={(m.coverage || 0) >= 3 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 3.0x target', value: m.coverage ? `${(m.coverage - 3).toFixed(1)}x` : '—', color: (m.coverage || 0) >= 3 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.2x', color: D.success }} />
          <MetricTile label="Won Rate %" value={fmtPct(m.win_rate)}
            status={(m.win_rate || 0) >= 0.30 ? 'good' : (m.win_rate || 0) >= 0.22 ? 'warn' : 'bad'}
            trend={(m.win_rate || 0) >= 0.30 ? 'up' : 'down'}
            vsBenchmark={{ label: 'vs 30% target', value: m.win_rate ? `${((m.win_rate - 0.30) * 100).toFixed(0)}pp` : '—', color: (m.win_rate || 0) >= 0.30 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+3pp', color: D.success }} />
          <MetricTile label="Avg Days to Close" value={m.cycle_days ? Math.round(m.cycle_days) : '—'} unit="days"
            status={(m.cycle_days || 999) <= 60 ? 'good' : (m.cycle_days || 999) <= 90 ? 'warn' : 'bad'}
            trend={(m.cycle_days || 999) <= 60 ? 'down' : 'up'}
            vsBenchmark={{ label: 'vs 60 day target', value: m.cycle_days ? `${(m.cycle_days - 60).toFixed(0)} days` : '—', color: (m.cycle_days || 0) <= 60 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '−4 days', color: D.success }} />
          <MetricTile label="Multi-Threaded Ratio" value={m.multi_thread != null ? m.multi_thread.toFixed(2) : '—'}
            status={(m.multi_thread || 0) >= 0.75 ? 'good' : (m.multi_thread || 0) >= 0.50 ? 'warn' : 'bad'}
            trend={(m.multi_thread || 0) >= 0.75 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs 0.75 target', value: m.multi_thread != null ? `${(m.multi_thread - 0.75).toFixed(2)}` : '—', color: (m.multi_thread || 0) >= 0.75 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.04', color: D.success }} />
          <MetricTile label="Next Meeting Scheduled" value="73%" status="bad" trend="down"
            vsBenchmark={{ label: 'vs 85% target', value: '−12pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '−4pp', color: D.bad }} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Stage Velocity" meta="avg days per stage transition" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <MetricTile label="Qualify → Discovery" value="4" unit="days" status="good" trend="down"
            vsBenchmark={{ label: 'vs 5d target', value: '−1d', color: D.success }}
            vsPrior={{ label: 'YoY', value: '−1d', color: D.success }}
            deltas={[{ label: 'fastest transition' }]} />
          <MetricTile label="Discovery → Sol Val" value="9" unit="days" status="good" trend="flat"
            vsBenchmark={{ label: 'vs 10d target', value: '−1d', color: D.success }}
            vsPrior={{ label: 'YoY', value: '±0d', color: D.flat }} />
          <MetricTile label="Sol Val → Conf Value" value="18" unit="days" status="warn" trend="up"
            vsBenchmark={{ label: 'vs 14d target', value: '+4d', color: D.warn }}
            vsPrior={{ label: 'YoY', value: '+2d', color: D.bad }}
            deltas={[{ label: 'longest stage' }]} />
          <MetricTile label="Conf Value → Selection" value="12" unit="days" status="good" trend="flat"
            vsBenchmark={{ label: 'vs 12d target', value: '±0d', color: D.flat }}
            vsPrior={{ label: 'YoY', value: '−1d', color: D.success }} />
          <MetricTile label="Selection → Close" value="21" unit="days" status="warn" trend="up"
            vsBenchmark={{ label: 'vs 18d target', value: '+3d', color: D.warn }}
            vsPrior={{ label: 'YoY', value: '+4d', color: D.bad }}
            deltas={[{ label: 'contract + procurement' }]} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Manager Metrics" meta="VP / AVP / RVP roll-ups" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <MetricTile label="YoY ARR Growth" value="+12%" status="warn" trend="up"
            vsBenchmark={{ label: 'vs +15% target', value: '−3pp', color: D.bad }}
            vsPrior={{ label: 'last year', value: '+9%', color: D.success }} />
          <MetricTile label="YoY Pipeline Growth" value="+18%" status="good" trend="up"
            vsBenchmark={{ label: 'vs +15% target', value: '+3pp', color: D.success }}
            vsPrior={{ label: 'last year', value: '+11%', color: D.success }} />
          <MetricTile label="Revenue per QDC" value="$24K" status="warn" trend="flat"
            vsBenchmark={{ label: 'vs $25K target', value: '−$1K', color: D.warn }}
            vsPrior={{ label: 'YoY', value: '+$2K', color: D.success }} />
        </div>
      </section>

      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Methodology Compliance" meta="behavior we coach on" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="Avg Conversations / Deal" value="4.2" status="good" trend="up"
            vsBenchmark={{ label: 'vs 4.0 target', value: '+0.2', color: D.success }}
            vsPrior={{ label: 'YoY', value: '+0.6', color: D.success }}
            deltas={[{ label: 'calls + meetings + emails' }]} />
          <MetricTile label="MSP Adoption" value="38%" status="bad" trend="up"
            vsBenchmark={{ label: 'vs 60% target', value: '−22pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '+9pp', color: D.success }}
            deltas={[{ label: 'active deals w/ DealRoom' }]} />
          <MetricTile label="Multi-Thread Compliance" value={m.multi_thread != null ? m.multi_thread.toFixed(2) : '—'}
            status={(m.multi_thread || 0) >= 0.75 ? 'good' : 'bad'}
            trend={(m.multi_thread || 0) >= 0.75 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs 0.75 target', value: m.multi_thread != null ? `${(m.multi_thread - 0.75).toFixed(2)}` : '—', color: (m.multi_thread || 0) >= 0.75 ? D.success : D.bad }}
            vsPrior={{ label: 'QoQ', value: '+0.04', color: D.success }}
            deltas={[{ label: 'avg critical roles / deal' }]} />
          <MetricTile label="Next-Step Cadence" value="73%" status="bad" trend="down"
            vsBenchmark={{ label: 'vs 85% target', value: '−12pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '−2pp', color: D.bad }}
            deltas={[{ label: 'task within 14d' }]} />
        </div>
      </section>
    </>
  )
}

// ----- COACHING TAB -----
// 6 coaching score dimensions live in rep_coaching_summary.score_averages
// (the same scores call_analyses produces per processed transcript). Plus
// talk_ratio (lower = better — rep listening more) and independently_wealthy_score.
const COACH_DIMS = [
  { key: 'discovery_depth_score',       label: 'Discovery Depth',        desc: 'how deeply rep digs into pain' },
  { key: 'curiosity_score',             label: 'Curiosity',              desc: 'questions asked vs statements' },
  { key: 'challenger_score',            label: 'Challenger',             desc: 'how rep challenges status quo' },
  { key: 'value_articulation_score',    label: 'Value Articulation',     desc: 'how clearly rep communicates value' },
  { key: 'objection_handling_score',    label: 'Objection Handling',     desc: 'how rep addresses pushback' },
  { key: 'independently_wealthy_score', label: 'Independently Wealthy',  desc: 'tone of authority + posture, no neediness' },
]

// Sortable heat-map table. Default sort key is avg_call_score (the simple
// mean of the 6 COACH_DIMS for that rep) descending. Clicking a header swaps
// to that key — same key click reverses direction.
function CoachingHeatMap({ downstreamAEs, coachingByUser, metricsFor }) {
  const [sortKey, setSortKey] = useState('avg_call_score')
  const [sortDir, setSortDir] = useState('desc')

  const rows = downstreamAEs.map(ae => {
    const cs = coachingByUser[ae.id]
    const dimScores = {}
    let dimSum = 0, dimN = 0
    for (const d of COACH_DIMS) {
      const v = cs ? Number(cs.score_averages?.[d.key]) : null
      dimScores[d.key] = (v != null && !isNaN(v)) ? v : null
      if (dimScores[d.key] != null) { dimSum += dimScores[d.key]; dimN++ }
    }
    const avgCallScore = dimN ? dimSum / dimN : null
    const talkRatio = cs ? Number(cs.score_averages?.talk_ratio) : null
    const aeMetrics = metricsFor ? metricsFor(ae.id) : {}
    return {
      ae,
      ...dimScores,
      avg_call_score: avgCallScore,
      talk_ratio: (talkRatio != null && !isNaN(talkRatio)) ? talkRatio : null,
      win_rate: aeMetrics.win_rate ?? null,
      attainment_pct: aeMetrics.attainment_pct ?? null,
    }
  })

  const sorted = [...rows].sort((a, b) => {
    if (sortKey === 'name') {
      const cmp = (a.ae.full_name || '').localeCompare(b.ae.full_name || '')
      return sortDir === 'asc' ? cmp : -cmp
    }
    const av = a[sortKey], bv = b[sortKey]
    // Nulls sort last regardless of direction
    if (av == null && bv == null) return 0
    if (av == null) return 1
    if (bv == null) return -1
    return sortDir === 'asc' ? av - bv : bv - av
  }).slice(0, 40)

  const onHeaderClick = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      // Numeric scores default to desc (higher = better); name defaults to asc;
      // talk_ratio is "lower is better" so default desc still works since user
      // can flip it.
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
  }

  const SortHeader = ({ label, k, leftBorder = false }) => (
    <th onClick={() => onHeaderClick(k)} style={{
      padding: '8px 8px', color: sortKey === k ? D.primary : D.textMuted,
      fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
      fontSize: 10, textAlign: k === 'name' ? 'left' : 'center',
      cursor: 'pointer', userSelect: 'none',
      borderLeft: leftBorder ? `2px solid ${D.border}` : 'none',
      whiteSpace: 'nowrap',
    }}>
      {label}
      {sortKey === k && <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  const scoreCell = (v) => {
    const bg = v == null ? 'transparent' : v >= 7 ? D.successBg : v >= 5 ? D.warnBg : D.badBg
    const fg = v == null ? D.textMuted : v >= 7 ? D.successText : v >= 5 ? D.warnText : D.badText
    return (
      <span style={{ display: 'inline-block', minWidth: 36, padding: '4px 8px', background: bg, color: fg, borderRadius: 4, fontWeight: 600, fontSize: 11 }}>
        {v != null ? v.toFixed(1) : '—'}
      </span>
    )
  }

  return (
    <section style={{ marginBottom: 32 }}>
      <SectionHeader title="Coaching Score Heat Map" meta={`${downstreamAEs.length} reps × 6 dims + avg + outcomes · click any column to sort`} />
      <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: 18, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${D.border}` }}>
              <SortHeader label="Rep" k="name" />
              {COACH_DIMS.map(dim => (
                <SortHeader key={dim.key} k={dim.key}
                  label={dim.label.split(' ').map((w, i) => i === 0 ? w : w[0]).join(' ')} />
              ))}
              <SortHeader label="Avg" k="avg_call_score" leftBorder />
              <SortHeader label="Talk %" k="talk_ratio" />
              <SortHeader label="Win Rate" k="win_rate" leftBorder />
              <SortHeader label="Attainment" k="attainment_pct" />
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <tr key={row.ae.id} style={{ borderBottom: `0.5px solid ${D.borderLight}` }}>
                <td style={{ padding: '10px 12px', fontWeight: 500 }}>{row.ae.full_name}</td>
                {COACH_DIMS.map(dim => (
                  <td key={dim.key} style={{ padding: '6px 8px', textAlign: 'center' }}>
                    {scoreCell(row[dim.key])}
                  </td>
                ))}
                {/* Avg Score */}
                <td style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `2px solid ${D.border}` }}>
                  {(() => {
                    const v = row.avg_call_score
                    if (v == null) return <span style={{ color: D.textMuted }}>—</span>
                    const bg = v >= 7 ? D.successBg : v >= 5 ? D.warnBg : D.badBg
                    const fg = v >= 7 ? D.successText : v >= 5 ? D.warnText : D.badText
                    return <span style={{ display: 'inline-block', minWidth: 40, padding: '4px 8px', background: bg, color: fg, borderRadius: 4, fontWeight: 700, fontSize: 11 }}>{v.toFixed(1)}</span>
                  })()}
                </td>
                {/* Talk % */}
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  {(() => {
                    const tr = row.talk_ratio
                    if (tr == null) return <span style={{ color: D.textMuted }}>—</span>
                    const pct = (tr * 100).toFixed(0)
                    const color = tr <= 0.50 ? D.success : tr <= 0.60 ? D.warn : D.bad
                    return <span style={{ color, fontWeight: 600, fontSize: 11 }}>{pct}%</span>
                  })()}
                </td>
                {/* Win Rate */}
                <td style={{ padding: '6px 8px', textAlign: 'center', borderLeft: `2px solid ${D.border}` }}>
                  {(() => {
                    const wr = row.win_rate
                    if (wr == null) return <span style={{ color: D.textMuted }}>—</span>
                    const bg = wr >= 0.30 ? D.successBg : wr >= 0.22 ? D.warnBg : D.badBg
                    const fg = wr >= 0.30 ? D.successText : wr >= 0.22 ? D.warnText : D.badText
                    return <span style={{ display: 'inline-block', minWidth: 40, padding: '4px 8px', background: bg, color: fg, borderRadius: 4, fontWeight: 600, fontSize: 11 }}>{(wr * 100).toFixed(0)}%</span>
                  })()}
                </td>
                {/* Quota Attainment */}
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  {(() => {
                    const att = row.attainment_pct
                    if (att == null) return <span style={{ color: D.textMuted }}>—</span>
                    const bg = att >= 1 ? D.successBg : att >= 0.85 ? D.warnBg : D.badBg
                    const fg = att >= 1 ? D.successText : att >= 0.85 ? D.warnText : D.badText
                    return <span style={{ display: 'inline-block', minWidth: 44, padding: '4px 8px', background: bg, color: fg, borderRadius: 4, fontWeight: 600, fontSize: 11 }}>{(att * 100).toFixed(0)}%</span>
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function CoachingTab({ metrics, allDeals, scoresByDeal, downstreamAEs, coachingByUser, metricsFor }) {
  // Coaching scores from production call_analyses model — 1-10 scale.
  // Targets: 7+ strong, 5-6.9 needs work, <5 critical gap.
  const aeIds = downstreamAEs.map(p => p.id)
  const summaries = aeIds.map(id => coachingByUser[id]).filter(Boolean)
  const dimAvg = (key) => {
    const vals = summaries.map(s => Number(s.score_averages?.[key])).filter(v => !isNaN(v))
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }
  const colorFor = (v) => v == null ? D.flat : v >= 7 ? D.success : v >= 5 ? D.warn : D.bad
  const SCORE_TARGET = 7.0
  // Talk ratio: lower = better (more listening)
  const talkRatio = (() => {
    const vals = summaries.map(s => Number(s.score_averages?.talk_ratio)).filter(v => !isNaN(v))
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  })()
  const totalCalls = summaries.reduce((s, x) => s + (x.calls_analyzed || 0), 0)

  // Deal quality scores (separate concept from coaching scores)
  const scopeIds = new Set(allDeals.map(d => d.id))
  const dealScoreAvg = (type) => {
    const vals = []
    for (const id of scopeIds) {
      const ss = scoresByDeal[id] || []
      const s = ss.find(x => x.score_type === type)
      if (s?.score != null) vals.push(s.score)
    }
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  return (
    <>
      {/* Row 1: Call execution coaching scores (6 dimensions) + outcome correlates (Win Rate + Quota Attainment).
          The outcome tiles are intentionally adjacent to the call execution scores — the demo narrative
          is that the call execution scores PREDICT these outcomes, so seeing them side-by-side lets
          Melanie correlate "this rep's Challenger score is 2.2" with "their win rate is 22%". */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Call Execution Scores + Outcomes" meta={`coaching model · scale 1–5 · ${totalCalls} calls analyzed`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {COACH_DIMS.map(dim => {
            const v = dimAvg(dim.key)
            const delta = v != null ? v - SCORE_TARGET : null
            // Synthetic trend per dimension based on tier mix in scope
            const trendDir = v == null ? 'flat' : v >= 7.5 ? 'up' : v >= 5.5 ? 'flat' : 'down'
            const trendVal = trendDir === 'up' ? '+0.3' : trendDir === 'down' ? '-0.2' : '±0'
            return (
              <MetricTile
                key={dim.key}
                label={dim.label}
                value={<span style={{ color: colorFor(v) }}>{v != null ? v.toFixed(1) : '—'}</span>}
                unit="/ 10"
                deltas={[
                  { label: 'vs 7.0 target', value: delta != null ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}` : '—', color: colorFor(v) },
                  { label: 'trend (90d)', value: `${trendVal} ${trendDir === 'up' ? '↑' : trendDir === 'down' ? '↓' : '—'}`, color: trendDir === 'up' ? D.success : trendDir === 'down' ? D.bad : D.flat },
                ]}
              />
            )
          })}
          {/* Outcome correlates */}
          <MetricTile
            label="Win Rate"
            value={<span style={{ color: metrics.win_rate == null ? D.flat : metrics.win_rate >= 0.30 ? D.success : metrics.win_rate >= 0.22 ? D.warn : D.bad }}>{fmtPct(metrics.win_rate)}</span>}
            deltas={[
              { label: 'closed-won / closed-total' },
              { label: 'vs 30% target', value: metrics.win_rate != null ? `${((metrics.win_rate - 0.30) * 100).toFixed(0)}pp` : '—',
                color: (metrics.win_rate || 0) >= 0.30 ? D.success : D.bad },
            ]}
          />
          <MetricTile
            label="Quota Attainment YTD"
            value={<span style={{ color: attainmentColor(metrics.attainment_pct) }}>{fmtPct(metrics.attainment_pct)}</span>}
            deltas={[
              { label: `${fmtMoneyShort(metrics.bookings_ytd)} of ${fmtMoneyShort(metrics.quota_ytd)}` },
              { label: 'vs pace (100%)', value: metrics.attainment_pct != null ? `${((metrics.attainment_pct - 1) * 100).toFixed(0)}pp` : '—',
                color: (metrics.attainment_pct || 0) >= 1 ? D.success : (metrics.attainment_pct || 0) >= 0.85 ? D.warn : D.bad },
            ]}
          />
          <MetricTile
            label="ASP"
            value={metrics.asp != null ? fmtMoneyShort(metrics.asp) : '—'}
            status={metrics.asp == null ? 'neutral' : metrics.asp >= 75000 ? 'good' : metrics.asp >= 45000 ? 'warn' : 'bad'}
            trend={metrics.asp == null ? 'flat' : metrics.asp >= 75000 ? 'up' : 'flat'}
            vsBenchmark={{ label: 'vs $50K target', value: metrics.asp != null ? `${metrics.asp >= 50000 ? '+' : '−'}${fmtMoneyShort(Math.abs(metrics.asp - 50000))}` : '—',
              color: (metrics.asp || 0) >= 50000 ? D.success : D.bad }}
            vsPrior={{ label: 'YoY', value: '+8%', color: D.success }}
            deltas={[{ label: `${metrics.won_count || 0} won deals` }]}
          />
        </div>
      </section>

      {/* Row 2: Conversational dynamics — Independently Wealthy moved up into the
          main 6-dimension grid per spec; Talk % stays here as a behavioral signal. */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Conversational Dynamics" meta="how reps run calls" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <MetricTile
            label="Avg Talk Ratio (rep)"
            value={talkRatio != null ? `${(talkRatio * 100).toFixed(0)}%` : '—'}
            status={talkRatio != null && talkRatio <= 0.50 ? 'good' : talkRatio != null && talkRatio <= 0.60 ? 'warn' : 'bad'}
            trend="down"
            vsBenchmark={{ label: 'vs ≤50% target', value: talkRatio != null ? `${((talkRatio - 0.50) * 100).toFixed(0)}pp` : '—',
              color: talkRatio != null && talkRatio <= 0.50 ? D.success : D.bad }}
            deltas={[{ label: 'lower is better — listening more' }]}
          />
          <MetricTile
            label="Calls Analyzed (scope)"
            value={String(totalCalls)}
            status="neutral"
            trend="up"
            deltas={[
              { label: `${summaries.length} reps` },
              { label: `avg ${summaries.length ? Math.round(totalCalls / summaries.length) : 0} per rep` },
            ]}
          />
        </div>
      </section>

      {/* Row 4: Heat map — reps × 6 coaching dimensions + Avg + Talk % + outcome cols.
          Default sort = avg_call_score desc; click any column header to re-sort. */}
      {downstreamAEs.length > 1 && (
        <CoachingHeatMap
          downstreamAEs={downstreamAEs}
          coachingByUser={coachingByUser}
          metricsFor={metricsFor}
        />
      )}

      {/* Row 5: Deal Quality Scores (separate concept from call execution).
          Status thresholds for /5 scores: ≥3.5 good, ≥2.5 warn, else bad. */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Deal Quality Scores" meta="MEDDPICC-style deal-level scores · scale 1–5" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {[
            { type: 'fit',         label: 'Fit Score',     desc: 'ICP alignment',                yoy: '+0.3' },
            { type: 'champion',    label: 'Champion Score', desc: 'champion strength',           yoy: '−0.2' },
            { type: 'power',       label: 'Power Score',    desc: 'access to economic buyer',    yoy: '+0.1' },
            { type: 'deal_health', label: 'Deal Health',    desc: 'overall deal momentum',       yoy: '+0.4' },
          ].map(s => {
            const v = dealScoreAvg(s.type)
            const status = v == null ? 'neutral' : v >= 3.5 ? 'good' : v >= 2.5 ? 'warn' : 'bad'
            const trend = v == null ? 'flat' : v >= 3.5 ? 'up' : v >= 2.5 ? 'flat' : 'down'
            const yoyNum = parseFloat(s.yoy)
            return (
              <MetricTile
                key={s.type}
                label={s.label}
                value={v != null ? v.toFixed(1) : '—'}
                unit="/ 5"
                status={status}
                trend={trend}
                vsBenchmark={{ label: 'vs 3.5 target', value: v != null ? `${v - 3.5 >= 0 ? '+' : ''}${(v - 3.5).toFixed(1)}` : '—',
                  color: v != null && v >= 3.5 ? D.success : D.bad }}
                vsPrior={{ label: 'YoY', value: s.yoy, color: yoyNum >= 0 ? D.success : D.bad }}
                deltas={[{ label: s.desc }]}
              />
            )
          })}
        </div>
      </section>

      {/* Row 6: Coaching velocity — does the org improve over time? */}
      <section style={{ marginBottom: 32 }}>
        <SectionHeader title="Coaching Velocity" meta="how the org is improving" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <MetricTile
            label="Score Improvement Rate"
            value="+0.04"
            unit="/mo"
            status="good"
            trend="up"
            vsBenchmark={{ label: 'vs +0.03 target', value: '+0.01', color: D.success }}
            vsPrior={{ label: 'QoQ', value: '+0.02', color: D.success }}
            deltas={[{ label: 'avg gain across 6 dimensions' }]}
          />
          <MetricTile
            label="Reps with Improving Discovery"
            value="47%"
            status="warn"
            trend="up"
            vsBenchmark={{ label: 'vs 60% target', value: '−13pp', color: D.bad }}
            vsPrior={{ label: 'QoQ', value: '+5pp', color: D.success }}
            deltas={[{ label: 'rising over last 90d' }]}
          />
          <MetricTile
            label="Coaching Loop Closure"
            value="81%"
            status="good"
            trend="up"
            vsBenchmark={{ label: 'vs 75% target', value: '+6pp', color: D.success }}
            vsPrior={{ label: 'QoQ', value: '+8pp', color: D.success }}
            deltas={[{ label: '% AI suggestions acted on' }]}
          />
        </div>
      </section>
    </>
  )
}

// ============================================================================
// FORECAST TAB — wraps two sub-views in a pill-toggle: Summary + Analyze
// ============================================================================
// Summary = forecast distribution, commit/forecast/upside/pipeline tiles
// Analyze = pipeline movement waterfall + opportunity flow Sankey
// Both views share the same date range coming from the parent dashboard.
function ForecastTab({ allDeals, dateRange, metrics, predByDeal }) {
  const [view, setView] = useState('summary')
  return (
    <>
      {/* Sub-tab pill — sits above the content. Same look as ForecastDistribution
          toggle so the two surfaces feel related. */}
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3, marginBottom: 18,
        background: D.surfaceAlt, border: `0.5px solid ${D.border}`, borderRadius: 8,
      }}>
        {[
          { k: 'summary', label: 'Summary' },
          { k: 'analyze', label: 'Analyze' },
        ].map(t => (
          <button key={t.k} onClick={() => setView(t.k)} style={{
            padding: '6px 16px', fontSize: 12, fontWeight: 600,
            border: 'none', borderRadius: 6, cursor: 'pointer',
            background: view === t.k ? D.surface : 'transparent',
            color: view === t.k ? D.primary : D.textSec,
            boxShadow: view === t.k ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
            fontFamily: D.font,
          }}>{t.label}</button>
        ))}
      </div>

      {view === 'summary' && <ForecastSummary metrics={metrics} allDeals={allDeals} />}
      {view === 'analyze' && <AnalyzeTab allDeals={allDeals} dateRange={dateRange} />}
    </>
  )
}

// ForecastSummary — distribution + Q3 forecast tiles. The actual ForecastDistribution
// component already exists (used on Revenue tab); we re-render it here alongside
// commit/forecast headlines so the user can read both at once on Forecast.
function ForecastSummary({ metrics, allDeals }) {
  const m = metrics
  const active = allDeals.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
  const sumBy = (cat) => active.filter(d => d.forecast_category === cat).reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
  const cntBy = (cat) => active.filter(d => d.forecast_category === cat).length
  const buckets = [
    { key: 'commit',   label: 'Commit',   value: sumBy('commit'),   count: cntBy('commit'),   color: D.success },
    { key: 'forecast', label: 'Forecast', value: sumBy('forecast'), count: cntBy('forecast'), color: D.primary },
    { key: 'upside',   label: 'Upside',   value: sumBy('upside'),   count: cntBy('upside'),   color: D.warn },
    { key: 'pipeline', label: 'Pipeline', value: sumBy('pipeline'), count: cntBy('pipeline'), color: D.flat },
  ]
  const cfValue = buckets[0].value + buckets[1].value
  const cfCount = buckets[0].count + buckets[1].count
  const annualQuotaForPeriod = (m.annual_quota || 0) * 0.25 // rough Q-share
  const callIt = cfValue + buckets[2].value * 0.5 // commit + forecast + 50% upside
  return (
    <>
      {/* Headline tiles */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader title="Forecast Headlines" meta="commit + forecast vs the call" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <MetricTile label="Commit" value={fmtMoneyShort(buckets[0].value)} status="good" trend="up"
            vsBenchmark={{ label: `${buckets[0].count} deals`, value: '90%+ confidence' }}
            vsPrior={{ label: 'YoY', value: '+12%', color: D.success }} />
          <MetricTile label="Commit + Forecast" value={fmtMoneyShort(cfValue)} status="warn" trend="flat"
            vsBenchmark={{ label: `${cfCount} deals`, value: '70%+ confidence' }}
            vsPrior={{ label: 'YoY Q', value: '+9%', color: D.success }} />
          <MetricTile label="Best Case" value={fmtMoneyShort(callIt + buckets[3].value * 0.25)}
            status="neutral" trend="up"
            vsBenchmark={{ label: 'cmt + fcst + 50% upside + 25% pipe' }}
            vsPrior={{ label: 'YoY Q', value: '+14%', color: D.success }} />
          <MetricTile label="Quarterly Quota" value={fmtMoneyShort(annualQuotaForPeriod)}
            status={cfValue >= annualQuotaForPeriod ? 'good' : 'bad'}
            vsBenchmark={{ label: 'commit + fcst vs quota', value: annualQuotaForPeriod ? `${((cfValue / annualQuotaForPeriod) * 100).toFixed(0)}%` : '—',
              color: cfValue >= annualQuotaForPeriod ? D.success : D.bad }}
            vsPrior={{ label: 'YoY plan', value: '+12%', color: D.success }} />
        </div>
      </section>

      {/* Distribution */}
      <section style={{ marginBottom: 24 }}>
        <ForecastDistribution buckets={buckets} />
      </section>
    </>
  )
}

// ============================================================================
// ANALYZE TAB — pipeline movement over a period (waterfall + flow)
// ============================================================================
// Two visualizations:
//   1. Waterfall: Start ARR → New / Increases / Decreases / Slipped / Lost / Won → End ARR
//   2. Flow: where did the deals that were active at start end up at end of period
// All values in ARR. The waterfall reads "what changed pipeline value", the flow
// reads "what happened to the deals themselves" — different angles on the same
// motion.
function AnalyzeTab({ allDeals, dateRange }) {
  const periodEnd = dateRange?.to || new Date()
  const periodStart = dateRange?.from || new Date(periodEnd.getTime() - 90 * 86400000)
  const startMs = periodStart.getTime()
  const endMs = periodEnd.getTime()

  // ── Bucket deals by what happened during [startMs, endMs] ────────────────
  // Best effort from the columns we have — closed_at, created_at, stage,
  // stage_changed_at, deal_value. Real motion would need deal_history_snapshots
  // but for demo + executive summary the closed/created/stale-active math
  // produces a representative waterfall.
  const ACTIVE_STAGES = new Set(['qualify','discovery','solution_validation','confirming_value','selection'])
  const sumValue = arr => arr.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
  const inWindow = ts => ts && ts >= startMs && ts <= endMs

  // Currently-active deals
  const activeNow = allDeals.filter(d => ACTIVE_STAGES.has(d.stage))
  // Deals that closed in the window
  const closedInWindow = allDeals.filter(d => d.closed_at && inWindow(new Date(d.closed_at).getTime()))
  const wonInWindow = closedInWindow.filter(d => d.stage === 'closed_won')
  const lostInWindow = closedInWindow.filter(d => d.stage === 'closed_lost')
  const dqInWindow = closedInWindow.filter(d => d.stage === 'disqualified')
  const nurturedInWindow = closedInWindow.filter(d => d.stage === 'needs_nurture')
  // Deals created in the window — added to pipeline
  const newInWindow = allDeals.filter(d => d.created_at && inWindow(new Date(d.created_at).getTime()) && ACTIVE_STAGES.has(d.stage))
  // Slipped: active deals whose target close date moved out of the window
  const slippedInWindow = activeNow.filter(d => {
    if (!d.target_close_date) return false
    return new Date(d.target_close_date).getTime() > endMs && d.stage_changed_at && inWindow(new Date(d.stage_changed_at).getTime())
  })

  const wonValue = sumValue(wonInWindow)
  const lostValue = sumValue(lostInWindow)
  const dqValue = sumValue(dqInWindow)
  const nurturedValue = sumValue(nurturedInWindow)
  const newValue = sumValue(newInWindow)
  const slippedValue = sumValue(slippedInWindow)

  // Active value at the END of the window = current active value (snapshot).
  const endValue = sumValue(activeNow)
  // Reconstruct start value: end - (added in window) + (removed in window).
  // Removed = won + lost + dq + nurtured (all leave active pipeline).
  // Added = new in window.
  const removedInWindow = wonValue + lostValue + dqValue + nurturedValue
  const startValue = Math.max(0, endValue - newValue + removedInWindow)

  // Synthetic deltas the source columns can't surface — small relative to total.
  // Show as separate categories so the waterfall "tells the story" rather than
  // collapsing everything to net change.
  const amountIncreased = Math.round(endValue * 0.04)
  const amountDecreased = Math.round(endValue * 0.03)

  // ── Waterfall data: signed bars in display order ─────────────────────────
  const waterfallSteps = [
    { label: 'Start',           value: startValue,          kind: 'anchor' },
    { label: 'New',             value: newValue,            kind: 'positive' },
    { label: 'Amount Increased',value: amountIncreased,     kind: 'positive' },
    { label: 'Amount Decreased',value: -amountDecreased,    kind: 'negative' },
    { label: 'Slipped',         value: -slippedValue,       kind: 'negative' },
    { label: 'Lost',            value: -lostValue,          kind: 'negative' },
    { label: 'Won',             value: -wonValue,           kind: 'won' },
    { label: 'End',             value: endValue,            kind: 'anchor' },
  ]

  return (
    <>
      {/* Period summary tiles */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader title="ARR Pipeline Movement" meta={`${periodStart.toLocaleDateString()} → ${periodEnd.toLocaleDateString()}`} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <SummaryTile label="Start Pipeline" value={fmtMoneyShort(startValue)} status="neutral" />
          <SummaryTile label="New" value={fmtMoneyShort(newValue)} sub={`${newInWindow.length} deals`} status="good" />
          <SummaryTile label="Won" value={fmtMoneyShort(wonValue)} sub={`${wonInWindow.length} deals`} status="good" />
          <SummaryTile label="Lost / Slipped" value={fmtMoneyShort(lostValue + slippedValue)} sub={`${lostInWindow.length + slippedInWindow.length} deals`} status="bad" />
          <SummaryTile label="End Pipeline" value={fmtMoneyShort(endValue)}
            sub={endValue >= startValue
              ? `▲ +${fmtMoneyShort(endValue - startValue)}`
              : `▼ −${fmtMoneyShort(startValue - endValue)}`}
            status={endValue >= startValue ? 'good' : 'bad'} />
        </div>
      </section>

      {/* Waterfall chart */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader title="Pipeline Waterfall" meta="how ARR pipeline value changed" />
        <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '24px 28px' }}>
          <WaterfallChart steps={waterfallSteps} />
        </div>
      </section>

      {/* Flow / Sankey */}
      <section style={{ marginBottom: 24 }}>
        <SectionHeader title="Opportunity Flow" meta="where deals open at start ended up" />
        <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '24px 28px' }}>
          <FlowChart
            startValue={startValue}
            buckets={[
              { label: 'Won',     value: wonValue,     color: D.success, count: wonInWindow.length },
              { label: 'Still Open', value: endValue,  color: D.primary, count: activeNow.length },
              { label: 'Slipped', value: slippedValue, color: D.warn,    count: slippedInWindow.length },
              { label: 'Lost',    value: lostValue,    color: D.bad,     count: lostInWindow.length },
              { label: 'Disqualified', value: dqValue, color: D.flat,    count: dqInWindow.length },
            ]}
          />
        </div>
      </section>
    </>
  )
}

// SummaryTile — like MetricTile but more compact for the analyze top row.
function SummaryTile({ label, value, sub, status = 'neutral' }) {
  const c = status === 'good' ? D.success : status === 'bad' ? D.bad : status === 'warn' ? D.warn : D.flat
  return (
    <div style={{
      background: D.surface, border: `0.5px solid ${D.border}`,
      borderLeft: `3px solid ${c}`, borderRadius: 12, padding: '16px 18px',
    }}>
      <div style={{ fontSize: 10, color: D.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: D.text, lineHeight: 1, letterSpacing: '-0.4px' }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: c, fontWeight: 600 }}>{sub}</div>}
    </div>
  )
}

// WaterfallChart — vertical bars showing signed deltas. Anchors (Start/End)
// drawn as full-height absolute bars; deltas as floating bars positioned at
// the running total. Labels above each bar show the signed value.
function WaterfallChart({ steps }) {
  const W = 880, H = 360, padX = 50, padY = 50
  const innerW = W - padX * 2, innerH = H - padY * 2

  // Compute y-axis range from running totals
  let running = 0
  const computed = steps.map(s => {
    if (s.kind === 'anchor') {
      // Anchor sets the running total to its value
      const top = s.value
      const bottom = 0
      running = s.value
      return { ...s, top, bottom, displayValue: s.value }
    }
    const top = running + (s.value > 0 ? s.value : 0)
    const bottom = running + (s.value < 0 ? s.value : 0)
    running = running + s.value
    return { ...s, top, bottom, displayValue: s.value }
  })
  const maxY = Math.max(...computed.map(c => c.top))
  const minY = Math.min(0, ...computed.map(c => c.bottom))
  const yRange = maxY - minY || 1
  const yToPx = v => padY + innerH - ((v - minY) / yRange) * innerH
  const barW = (innerW / steps.length) * 0.6
  const stepX = i => padX + (innerW / steps.length) * i + (innerW / steps.length - barW) / 2

  const colorFor = kind =>
    kind === 'anchor' ? D.flat
    : kind === 'positive' ? D.success
    : kind === 'won' ? D.primary
    : D.bad

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* y=0 baseline */}
      <line x1={padX} y1={yToPx(0)} x2={W - padX} y2={yToPx(0)} stroke={D.borderLight} strokeWidth={1} />
      {computed.map((c, i) => {
        const x = stepX(i)
        const y = yToPx(c.top)
        const h = Math.max(2, yToPx(c.bottom) - yToPx(c.top))
        const fill = colorFor(c.kind)
        // Connector to next bar at the running total
        const nextX = i < computed.length - 1 ? stepX(i + 1) : null
        const runAfter = c.kind === 'anchor' ? c.value : (i === 0 ? 0 : computed.slice(0, i + 1).reduce((s, x) => s + (x.kind === 'anchor' ? 0 : x.value), computed[0].value))
        const connectorY = yToPx(c.kind === 'anchor' ? c.value : runAfter)
        return (
          <g key={c.label}>
            {/* Bar */}
            <rect x={x} y={y} width={barW} height={h} fill={fill} rx={2} />
            {/* Connector dashed line to next */}
            {nextX != null && (
              <line x1={x + barW} y1={connectorY} x2={nextX} y2={connectorY}
                stroke={D.border} strokeWidth={1} strokeDasharray="3 3" />
            )}
            {/* Value label above bar */}
            <text x={x + barW / 2} y={y - 8} textAnchor="middle" fontSize={11} fontWeight={700} fill={D.text}>
              {c.kind === 'anchor'
                ? fmtMoneyShort(c.value)
                : (c.value === 0 ? '—' : `${c.value > 0 ? '+' : '−'}${fmtMoneyShort(Math.abs(c.value))}`)}
            </text>
            {/* Stage label below x-axis */}
            <text x={x + barW / 2} y={H - 12} textAnchor="middle" fontSize={11} fill={D.textSec} fontWeight={500}>
              {c.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// FlowChart — horizontal Sankey-lite. Single source bar on the left (start
// pipeline); destination buckets on the right; smooth quadratic ribbons
// between them sized by value. Each ribbon labeled with $ + % share + count.
function FlowChart({ startValue, buckets }) {
  const W = 880, H = 360, padX = 30, padY = 20
  const colW = 70 // source/dest bar width
  const total = buckets.reduce((s, b) => s + b.value, 0) || startValue || 1
  // Source bar height covers full innerH
  const innerH = H - padY * 2
  const srcX = padX
  const dstX = W - padX - colW

  // Compute destination bar heights proportional to value
  let cum = 0
  const dst = buckets.map(b => {
    const h = (b.value / total) * innerH
    const y = padY + cum
    cum += h + 4 // small gap between dest bars
    return { ...b, y, h }
  })
  // Total cumulative may be slightly less than innerH due to gaps; that's fine.

  // Source ribbons stack on the left side proportionally
  let srcCum = 0
  const ribbons = dst.map(d => {
    const srcH = (d.value / total) * innerH
    const srcY = padY + srcCum
    srcCum += srcH
    return { ...d, srcY, srcH, dstY: d.y, dstH: d.h }
  })

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {/* Source bar */}
      <rect x={srcX} y={padY} width={colW} height={innerH} fill={D.primary} rx={3} />
      <text x={srcX + colW / 2} y={padY + innerH / 2 - 8} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">
        Start ARR
      </text>
      <text x={srcX + colW / 2} y={padY + innerH / 2 + 10} textAnchor="middle" fontSize={14} fontWeight={700} fill="#fff">
        {fmtMoneyShort(startValue)}
      </text>

      {/* Ribbons */}
      {ribbons.map((r, i) => {
        const x1 = srcX + colW
        const x2 = dstX
        const cx = (x1 + x2) / 2
        const path = `
          M ${x1} ${r.srcY}
          C ${cx} ${r.srcY}, ${cx} ${r.dstY}, ${x2} ${r.dstY}
          L ${x2} ${r.dstY + r.dstH}
          C ${cx} ${r.dstY + r.dstH}, ${cx} ${r.srcY + r.srcH}, ${x1} ${r.srcY + r.srcH}
          Z
        `
        return (
          <g key={r.label}>
            <path d={path} fill={r.color} fillOpacity={0.25} stroke={r.color} strokeWidth={0.5} strokeOpacity={0.6} />
            {/* In-ribbon label on the right end */}
            <text x={x2 - 8} y={r.dstY + r.dstH / 2 - 2} textAnchor="end" fontSize={11} fontWeight={600} fill={D.textSec}>
              {((r.value / total) * 100).toFixed(0)}% · {fmtMoneyShort(r.value)}
            </text>
            <text x={x2 - 8} y={r.dstY + r.dstH / 2 + 12} textAnchor="end" fontSize={10} fill={D.textMuted}>
              {r.count} deals
            </text>
          </g>
        )
      })}

      {/* Destination bars + labels */}
      {dst.map(d => (
        <g key={d.label}>
          <rect x={dstX} y={d.y} width={colW} height={d.h} fill={d.color} rx={3} />
          <text x={dstX + colW / 2} y={d.y + d.h / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#fff">
            {d.label}
          </text>
        </g>
      ))}
    </svg>
  )
}

// ----- TEAMS TAB -----
function TeamsTab({ currentParent, directReports, metricsFor, showDealsLevel, allDeals, predByDeal, onDrill, onDealClick }) {
  if (showDealsLevel) {
    return <DealList deals={allDeals} predByDeal={predByDeal} onDealClick={onDealClick} ae={currentParent} aeMetrics={metricsFor(currentParent.id)} />
  }
  // Sort cards by attainment desc per spec
  const sorted = [...directReports].map(p => ({ p, m: metricsFor(p.id) })).sort((a, b) => (b.m.attainment_pct || 0) - (a.m.attainment_pct || 0))
  return (
    <section>
      <SectionHeader
        title={`By ${directReports[0]?.role_level === 'avp' ? 'AVP' : directReports[0]?.role_level === 'rvp' ? 'RVP' : 'AE'} — click any card to drill in`}
        meta={`${directReports.length} ${directReports[0]?.role_level === 'avp' ? 'AVPs' : directReports[0]?.role_level === 'rvp' ? 'RVPs' : 'AEs'}`}
      />
      {sorted.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: D.textMuted }}>No direct reports.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {sorted.map(({ p, m }) => (
          <PersonCard key={p.id} person={p} metrics={m} level={p.role_level} onClick={() => onDrill(p)} />
        ))}
      </div>
    </section>
  )
}

function DealList({ deals, predByDeal, onDealClick, ae, aeMetrics }) {
  const active = deals.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
  const closed = deals.filter(d => ['closed_won','closed_lost','disqualified','needs_nurture'].includes(d.stage))
  closed.sort((a, b) => new Date(b.closed_at || 0) - new Date(a.closed_at || 0))

  return (
    <>
      {/* AE summary card with the 5 non-negotiables */}
      <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, padding: '20px 22px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: D.text }}>{ae.full_name}</div>
            <div style={{ fontSize: 12, color: D.textMuted, marginTop: 2 }}>AE · {ae.team || ae.segment || ''}</div>
          </div>
          <div style={{ padding: '4px 10px', borderRadius: 100, fontSize: 10.5, fontWeight: 600, letterSpacing: '0.3px', ...(() => { const p = healthPill(aeMetrics.attainment_pct); return { background: p.bg, color: p.color } })() }}>
            {healthPill(aeMetrics.attainment_pct).label}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <NonNegMini label="Coverage" value={aeMetrics.coverage != null ? `${aeMetrics.coverage.toFixed(1)}x` : '—'} />
          <NonNegMini label="Won %" value={fmtPct(aeMetrics.win_rate)} />
          <NonNegMini label="Cycle" value={aeMetrics.cycle_days != null ? `${Math.round(aeMetrics.cycle_days)}d` : '—'} />
          <NonNegMini label="Multi-thr" value={aeMetrics.multi_thread != null ? aeMetrics.multi_thread.toFixed(2) : '—'} />
          <NonNegMini label="Next Mtg" value={fmtPct(aeMetrics.next_mtg_pct)} />
        </div>
      </div>

      <ActiveDealsTable deals={active} predByDeal={predByDeal} onDealClick={onDealClick} />

      {closed.length > 0 && (
        <>
          <div style={{ marginTop: 24 }}><SectionHeader title={`Recent Closed (${closed.length})`} meta="trailing 12 months" /></div>
          {closed.slice(0, 25).map(d => <DealRow key={d.id} deal={d} prediction={predByDeal[d.id]} onClick={() => onDealClick(d)} />)}
        </>
      )}
    </>
  )
}

// ActiveDealsTable — sortable. Columns: Company / Stage / Forecast / Size /
// Close / Confidence. Click a header to sort by that key; click again to
// flip direction. Default sort = forecast (commit first) then size desc.
function ActiveDealsTable({ deals, predByDeal, onDealClick }) {
  const [sortKey, setSortKey] = useState('forecast')
  const [sortDir, setSortDir] = useState('asc') // forecast asc = commit first
  const stageOrder = { qualify: 1, discovery: 2, solution_validation: 3, confirming_value: 4, selection: 5 }
  const fcatRank = { commit: 0, forecast: 1, upside: 2, pipeline: 3 }

  const rows = deals.map(d => {
    const conf = predByDeal[d.id]?.predicted_close_probability ?? null
    return {
      ...d,
      _conf: conf != null ? Number(conf) : null,
      _stageRank: stageOrder[d.stage] ?? 99,
      _fcatRank: fcatRank[d.forecast_category] ?? 99,
      _close: d.target_close_date ? new Date(d.target_close_date).getTime() : null,
      _value: Number(d.deal_value) || 0,
    }
  })

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    let av, bv
    switch (sortKey) {
      case 'company':   return (a.company_name || '').localeCompare(b.company_name || '') * dir
      case 'stage':     av = a._stageRank;  bv = b._stageRank; break
      case 'forecast':  av = a._fcatRank;   bv = b._fcatRank;  break
      case 'size':      av = a._value;      bv = b._value;     break
      case 'close':
        // Nulls last regardless of direction
        if (a._close == null && b._close == null) return 0
        if (a._close == null) return 1
        if (b._close == null) return -1
        return (a._close - b._close) * dir
      case 'confidence':
        if (a._conf == null && b._conf == null) return 0
        if (a._conf == null) return 1
        if (b._conf == null) return -1
        return (a._conf - b._conf) * dir
      default: return 0
    }
    return (av - bv) * dir
  })

  const onHeader = (k) => {
    if (sortKey === k) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(k)
      // Sensible defaults: text/stage/forecast asc; numeric desc.
      setSortDir(['size','confidence','close'].includes(k) ? 'desc' : 'asc')
    }
  }

  const SortHead = ({ k, label, align = 'left', width }) => (
    <th onClick={() => onHeader(k)} style={{
      padding: '10px 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
      color: sortKey === k ? D.primary : D.textMuted, textAlign: align, cursor: 'pointer', userSelect: 'none',
      whiteSpace: 'nowrap', borderBottom: `1px solid ${D.border}`,
      width: width || 'auto',
    }}>
      {label}{sortKey === k && <span style={{ marginLeft: 4, fontSize: 9 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  )

  return (
    <>
      <SectionHeader title={`Active Deals (${deals.length})`} meta="click any column header to sort" />
      {deals.length === 0 ? (
        <div style={{ color: D.textMuted, padding: '12px 4px' }}>No active deals.</div>
      ) : (
        <div style={{ background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ background: D.surfaceAlt }}>
              <tr>
                <SortHead k="company"    label="Company" />
                <SortHead k="stage"      label="Stage" />
                <SortHead k="forecast"   label="Forecast" align="center" width="110px" />
                <SortHead k="size"       label="Size" align="right" width="110px" />
                <SortHead k="close"      label="Close" align="right" width="120px" />
                <SortHead k="confidence" label="Confidence" align="right" width="120px" />
                <th style={{ width: 28, borderBottom: `1px solid ${D.border}` }} />
              </tr>
            </thead>
            <tbody>
              {sorted.map(d => {
                const conf = d._conf
                const confColor = conf == null ? D.textMuted : conf >= 0.85 ? D.success : conf >= 0.65 ? D.warn : D.bad
                const fcatColor = { commit: D.success, forecast: D.primary, upside: D.warn, pipeline: D.flat }[d.forecast_category] || D.flat
                return (
                  <tr key={d.id} onClick={() => onDealClick(d)} style={{
                    borderBottom: `0.5px solid ${D.borderLight}`, cursor: 'pointer', transition: 'background 0.12s',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = D.surfaceAlt }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
                    <td style={{ padding: '12px', fontWeight: 600, color: D.text }}>{d.company_name}</td>
                    <td style={{ padding: '12px', color: D.textSec, fontSize: 12, textTransform: 'capitalize' }}>{d.stage?.replace(/_/g, ' ')}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 100, background: `${fcatColor}22`, color: fcatColor, textTransform: 'uppercase' }}>
                        {d.forecast_category}
                      </span>
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 700, color: D.text }}>{fmtMoneyShort(d.deal_value)}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: D.textMuted, fontSize: 12 }}>{d.target_close_date || '—'}</td>
                    <td style={{ padding: '12px', textAlign: 'right' }}>
                      {conf != null
                        ? <span style={{ fontSize: 12, fontWeight: 700, color: confColor }}>{(conf * 100).toFixed(0)}%</span>
                        : <span style={{ fontSize: 12, color: D.textMuted }}>—</span>}
                    </td>
                    <td style={{ padding: '12px', color: D.textMuted, fontSize: 16, textAlign: 'right' }}>›</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function DealRow({ deal, prediction, onClick }) {
  const conf = prediction?.predicted_close_probability
  const confColor = conf == null ? D.textMuted : conf >= 0.85 ? D.success : conf >= 0.65 ? D.warn : D.bad
  const fcatColor = { commit: D.success, forecast: D.primary, upside: D.warn, pipeline: D.flat }[deal.forecast_category] || D.flat
  return (
    <div onClick={onClick} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', background: D.surface, border: `0.5px solid ${D.border}`, borderRadius: 8, cursor: 'pointer', marginBottom: 6, gap: 14, fontSize: 13 }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = D.primary; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.06)' }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = D.border; e.currentTarget.style.boxShadow = 'none' }}>
      <div style={{ minWidth: 220, fontWeight: 700, color: D.text }}>{deal.company_name}</div>
      <div style={{ minWidth: 130, color: D.textSec, fontSize: 12 }}>{deal.stage?.replace(/_/g, ' ')}</div>
      <div style={{ minWidth: 90 }}>
        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 10, background: `${fcatColor}22`, color: fcatColor, textTransform: 'uppercase' }}>
          {deal.forecast_category}
        </span>
      </div>
      <div style={{ minWidth: 110, fontWeight: 700 }}>{fmtMoneyShort(deal.deal_value)}</div>
      <div style={{ minWidth: 110, color: D.textMuted, fontSize: 12 }}>Close: {deal.target_close_date || '—'}</div>
      <div style={{ flex: 1, textAlign: 'right' }}>
        {conf != null && <span style={{ fontSize: 11, fontWeight: 700, color: confColor }}>{(conf * 100).toFixed(0)}% confidence</span>}
      </div>
      <div style={{ color: D.textMuted, fontSize: 16 }}>›</div>
    </div>
  )
}

// FiltersPanel — single popover containing date range (presets + custom),
// AVP/RVP/AE cascade, segment, and view-aware Compare-against. Renders below
// the trigger icon. Click-outside dismiss via the fixed-inset backdrop.
function FiltersPanel({
  onClose, datePresets,
  dateKey, setDateKey,
  customFrom, setCustomFrom, customTo, setCustomTo,
  avpFilter, setAvpFilter, avpOptions,
  rvpFilter, setRvpFilter, rvpOptions,
  aeFilter,  setAeFilter,  aeOptions,
  segmentFilter, setSegmentFilter,
  compareKey, setCompareKey, compareOptions,
  onClear,
  D,
}) {
  const sectionLabel = { fontSize: 9, fontWeight: 700, color: D.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }
  const selectStyle = { width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${D.border}`, borderRadius: 6, background: D.surface, color: D.text, fontFamily: 'inherit' }
  const SEGMENTS = ['Strategic', 'Software PST', 'Mid-Market', 'Emerging', 'SMB']
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
      <div onClick={e => e.stopPropagation()} style={{
        position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 999,
        background: D.surface, border: `1px solid ${D.border}`, borderRadius: 10,
        boxShadow: '0 10px 30px rgba(0,0,0,0.12)', padding: 16, width: 360,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: 13, color: D.text }}>Filters</strong>
          <button onClick={onClear} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: D.textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Clear all</button>
        </div>

        {/* Date range */}
        <div style={sectionLabel}>Date range</div>
        <select value={dateKey} onChange={e => setDateKey(e.target.value)} style={{ ...selectStyle, marginBottom: 8 }}>
          {datePresets.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {dateKey === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={selectStyle} />
            <input type="date" value={customTo}   onChange={e => setCustomTo(e.target.value)}   style={selectStyle} />
          </div>
        )}

        {/* AVP / RVP / AE cascade */}
        <div style={{ ...sectionLabel, marginTop: 6 }}>Filter people</div>
        <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
          <select value={avpFilter || ''} onChange={e => setAvpFilter(e.target.value || null)} style={selectStyle}>
            <option value="">All AVPs</option>
            {avpOptions.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={rvpFilter || ''} onChange={e => setRvpFilter(e.target.value || null)} style={selectStyle}>
            <option value="">All RVPs{avpFilter ? ' under this AVP' : ''}</option>
            {rvpOptions.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <select value={aeFilter || ''} onChange={e => setAeFilter(e.target.value || null)} style={selectStyle}>
            <option value="">All AEs{rvpFilter ? ' under this RVP' : avpFilter ? ' under this AVP' : ''}</option>
            {aeOptions.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </div>

        {/* Segment */}
        <div style={sectionLabel}>Segment</div>
        <select value={segmentFilter || ''} onChange={e => setSegmentFilter(e.target.value || null)} style={{ ...selectStyle, marginBottom: 12 }}>
          <option value="">All segments</option>
          {SEGMENTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Compare against — options depend on date granularity */}
        <div style={sectionLabel}>Compare against</div>
        <div style={{ display: 'grid', gap: 4 }}>
          {compareOptions.map(opt => (
            <label key={opt.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', background: opt.key === compareKey ? D.primaryTint : 'transparent', fontSize: 12, color: opt.key === compareKey ? D.primary : D.text, fontWeight: opt.key === compareKey ? 600 : 500 }}
              onMouseEnter={e => { if (opt.key !== compareKey) e.currentTarget.style.background = D.surfaceAlt }}
              onMouseLeave={e => { if (opt.key !== compareKey) e.currentTarget.style.background = 'transparent' }}>
              <input type="radio" name="compareKey" checked={compareKey === opt.key} onChange={() => setCompareKey(opt.key)} style={{ margin: 0 }} />
              {opt.label}
            </label>
          ))}
        </div>
        <div style={{ marginTop: 12, fontSize: 10, color: D.textMuted, lineHeight: 1.5 }}>
          Budget = quota. Goal = your stretch (set in <a href="/my-goals" style={{ color: D.primary, textDecoration: 'none', fontWeight: 600 }}>My Goals</a>).
        </div>
      </div>
    </>
  )
}
