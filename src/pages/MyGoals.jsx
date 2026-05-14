import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T, formatCurrency } from '../lib/theme'
import { Spinner } from '../components/Shared'

// Benchmarks page — head of sales sets the targets the dashboard measures
// against. Reads current org averages + last quarter + last year alongside
// each input so she's setting numbers in context, not in a vacuum. All
// values persist to organizations.benchmarks (jsonb) and dashboard tiles
// read from there via useOrg().benchmarks.

// ── Metric catalog ──────────────────────────────────────────────────────────
// Each entry tells the page how to render the row + how to compute the
// "current org avg" from the deals/profiles dataset. type drives formatting:
// pct = decimal stored, displayed as %; days = integer; money = $; ratio = 1dp;
// score = /10. compute() takes the loaded dataset and returns the current
// org-wide actual value (or null if not computable from local data).
const SECTIONS = [
  {
    label: 'Pipeline Health',
    desc: 'How fat the funnel needs to be',
    metrics: [
      { key: 'pipeline_coverage',         label: 'Pipeline Coverage',         type: 'ratio',   suffix: 'x', desc: 'Active pipeline ÷ remaining quota' },
      { key: 'self_sourced_active_pct',   label: 'Self-Sourced Active %',     type: 'pct',                  desc: 'AE-prospected deals as % of active pipeline' },
      { key: 'self_sourced_won_pct',      label: 'Self-Sourced Won %',        type: 'pct',                  desc: 'AE-prospected deals as % of YTD bookings' },
      { key: 'avg_deal_size_pipeline',    label: 'Avg Deal Size (Pipeline)',  type: 'money',                desc: 'Mean active deal value' },
    ],
  },
  {
    label: 'Sales Cycle & Execution',
    desc: 'How disciplined the team needs to be',
    metrics: [
      { key: 'win_rate',                  label: 'Win Rate',                  type: 'pct',                  desc: 'Closed-won ÷ closed-total' },
      { key: 'cycle_days',                label: 'Avg Days to Close',         type: 'days',                 desc: 'Created → closed-won, in days' },
      { key: 'multi_thread_ratio',        label: 'Multi-Thread Ratio',        type: 'ratio',                desc: 'Avg critical roles identified per deal (target ≥ 2.25 of 3)' },
      { key: 'next_meeting_pct',          label: 'Next Meeting Scheduled',    type: 'pct',                  desc: '% of active deals with a meeting in next 14 days' },
      { key: 'next_step_cadence_pct',     label: 'Next-Step Cadence',         type: 'pct',                  desc: '% of active deals with a task due within 14 days' },
      { key: 'msp_adoption_pct',          label: 'MSP / DealRoom Adoption',   type: 'pct',                  desc: '% of active deals with a Project Plan' },
      { key: 'avg_conversations_per_deal', label: 'Avg Conversations / Deal', type: 'ratio',                desc: 'Calls + meetings + emails per active deal' },
    ],
  },
  {
    label: 'Stage Velocity (days)',
    desc: 'How long a deal should sit in each stage',
    metrics: [
      { key: 'sv_qualify_to_discovery',   label: 'Qualify → Discovery',       type: 'days' },
      { key: 'sv_discovery_to_solval',    label: 'Discovery → Sol Val',       type: 'days' },
      { key: 'sv_solval_to_confval',      label: 'Sol Val → Conf Value',      type: 'days' },
      { key: 'sv_confval_to_selection',   label: 'Conf Value → Selection',    type: 'days' },
      { key: 'sv_selection_to_close',     label: 'Selection → Close',         type: 'days' },
    ],
  },
  {
    label: 'Coaching',
    desc: 'Per-call execution standards',
    metrics: [
      { key: 'coaching_score_target',     label: 'Coaching Score Target',     type: 'score',                desc: '6-dimension call execution score (1–10)' },
      { key: 'talk_ratio_target',         label: 'Talk Ratio (rep)',          type: 'pct',                  desc: 'Lower is better — listening more than talking' },
      { key: 'transcripts_per_won',       label: 'Transcripts per Won Deal',  type: 'ratio',                desc: 'Reps who process more calls win more' },
    ],
  },
  {
    label: 'Pipeline Risk Tolerance',
    desc: 'How much risk to flag before alerting',
    metrics: [
      { key: 'slip_risk_acceptable_count', label: 'Slip-Risk Acceptable',     type: 'count',                desc: '# of commit/forecast deals w/ low confidence we tolerate' },
      { key: 'stale_acceptable_count',     label: 'Stale Deals Acceptable',   type: 'count',                desc: '# of active deals with no activity > 14d' },
      { key: 'single_thread_pct_max',      label: 'Single-Thread Max %',      type: 'pct',                  desc: 'Max % of active deals without an Economic Buyer' },
    ],
  },
  {
    label: 'QDC Funnel',
    desc: 'Top of funnel quality bars',
    metrics: [
      { key: 'qdc_approval_rate',         label: 'QDC Approval Rate',         type: 'pct',                  desc: '% of QDCs that advance past Qualify' },
      { key: 'revenue_per_qdc',           label: 'Revenue per QDC',           type: 'money',                desc: 'Avg bookings attributable to each approved QDC' },
    ],
  },
  {
    label: 'Year-over-Year Growth',
    desc: 'What "good" looks like vs last year',
    metrics: [
      { key: 'yoy_arr_growth',            label: 'YoY ARR Growth',            type: 'pct',                  desc: 'New ARR vs prior fiscal year' },
      { key: 'yoy_pipeline_growth',       label: 'YoY Pipeline Growth',       type: 'pct',                  desc: 'Active pipeline vs prior fiscal year' },
    ],
  },
  {
    label: 'Stretch Revenue (above quota)',
    desc: 'Personal stretch — what you\'re aiming for beyond Budget',
    metrics: [
      { key: 'stretch_revenue_monthly',   label: 'Monthly Stretch',           type: 'money' },
      { key: 'stretch_revenue_quarterly', label: 'Quarterly Stretch',         type: 'money' },
      { key: 'stretch_revenue_annual',    label: 'Annual Stretch',            type: 'money' },
    ],
  },
]

// Format / parse helpers — type-aware so the input box always matches the unit.
function formatVal(type, v) {
  if (v == null || v === '') return '—'
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  switch (type) {
    case 'pct':   return `${(n * 100).toFixed(0)}%`
    case 'money': return formatCurrency(n)
    case 'days':  return `${Math.round(n)}d`
    case 'count': return String(Math.round(n))
    case 'score': return n.toFixed(1)
    case 'ratio': return n.toFixed(2)
    default: return String(n)
  }
}
function parseInput(type, s) {
  if (s == null || s === '') return null
  const cleaned = String(s).replace(/[$,%\s]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  // Pct stored as decimal — accept either "30" or "0.30"; if > 1, divide.
  if (type === 'pct') return n > 1 ? n / 100 : n
  return n
}

export default function MyGoals() {
  const { profile } = useAuth()
  const { org, refreshOrg, benchmarks: orgBenchmarks } = useOrg()
  const [draft, setDraft] = useState({}) // edited values, keyed by metric key
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState(null)
  const [actuals, setActuals] = useState(null)
  const [loadingActuals, setLoadingActuals] = useState(true)

  // Hydrate the form from saved benchmarks once they're available.
  useEffect(() => {
    if (orgBenchmarks && Object.keys(orgBenchmarks).length > 0) {
      // Prefill text inputs with formatted values so user sees what's saved.
      const next = {}
      for (const section of SECTIONS) {
        for (const m of section.metrics) {
          const v = orgBenchmarks[m.key]
          if (v == null) continue
          next[m.key] = m.type === 'pct' ? String((Number(v) * 100).toFixed(1).replace(/\.0$/, ''))
                       : m.type === 'money' ? String(Math.round(Number(v)))
                       : String(v)
        }
      }
      setDraft(next)
    }
  }, [orgBenchmarks])

  // Compute current org-wide actuals + last quarter + last year for context.
  // Uses the same Sage FY (Oct-Sept) math the manager dashboard uses.
  useEffect(() => {
    if (!profile?.org_id) return
    let cancelled = false
    async function loadActuals() {
      setLoadingActuals(true)
      try {
        const PAGE = 1000
        const orgId = profile.org_id
        async function fetchAllPaged(builderFn) {
          const out = []
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await builderFn().range(from, from + PAGE - 1)
            if (error || !data || data.length === 0) break
            out.push(...data)
            if (data.length < PAGE) break
            if (from > 100000) break
          }
          return out
        }
        const [profs, deals] = await Promise.all([
          fetchAllPaged(() => supabase.from('profiles').select('id, role_level, annual_quota, segment').eq('org_id', orgId)),
          fetchAllPaged(() => supabase.from('deals').select('id, rep_id, stage, forecast_category, deal_value, closed_at, created_at, source').eq('org_id', orgId)),
        ])
        if (cancelled) return

        // Pull rep_coaching_summary for talk ratio + coaching avg
        const aeIds = profs.filter(p => p.role_level === 'ae').map(p => p.id)
        let coaching = []
        if (aeIds.length) {
          // Chunk in case of many reps
          for (let i = 0; i < aeIds.length; i += 1000) {
            const chunk = aeIds.slice(i, i + 1000)
            const { data } = await supabase.from('rep_coaching_summary').select('user_id, score_averages').in('user_id', chunk)
            if (data) coaching.push(...data)
          }
        }

        const now = new Date()
        const m = now.getUTCMonth()
        const y = now.getUTCFullYear()
        const fyStartYear = m >= 9 ? y : y - 1
        const fyStart = new Date(Date.UTC(fyStartYear, 9, 1))
        const priorFyStart = new Date(Date.UTC(fyStartYear - 1, 9, 1))
        const priorFyEnd = fyStart
        // Last quarter (whichever quarter we just finished — current minus 1)
        const currentQ = m >= 9 ? 0 : m <= 2 ? 1 : m <= 5 ? 2 : 3
        const lastQ = currentQ === 0 ? 3 : currentQ - 1
        const lastQYear = lastQ === 3 ? fyStartYear - 1 : (currentQ === 0 ? fyStartYear : fyStartYear + 1)
        const qStartMonth = [9, 0, 3, 6][lastQ]
        const lastQStart = new Date(Date.UTC(lastQYear, qStartMonth, 1))
        const lastQEnd   = new Date(Date.UTC(lastQYear, qStartMonth + 3, 1))

        // ── Active pipeline ────────────────────────────────────────────────
        const aeIdSet = new Set(aeIds)
        const repDeals = deals.filter(d => aeIdSet.has(d.rep_id))
        const active = repDeals.filter(d => ['qualify','discovery','solution_validation','confirming_value','selection'].includes(d.stage))
        const activeValue = active.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
        const wonInWindow = (from, to) => repDeals.filter(d =>
          d.stage === 'closed_won' && d.closed_at &&
          new Date(d.closed_at) >= from && new Date(d.closed_at) < to
        )
        const wonYTD = wonInWindow(fyStart, new Date(Date.UTC(y, m, now.getUTCDate(), 23, 59, 59)))
        const wonLastQ = wonInWindow(lastQStart, lastQEnd)
        const wonPriorFY = wonInWindow(priorFyStart, priorFyEnd)
        // YTD pace for coverage: remaining quota = annual - bookings
        const annualQuota = profs.filter(p => p.role_level === 'ae').reduce((s, p) => s + (Number(p.annual_quota) || 0), 0)
        const bookings = wonYTD.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
        const remainingQuota = Math.max(1, annualQuota - bookings)
        const coverage = activeValue / remainingQuota

        // ── Win rate / cycle / sourcing ────────────────────────────────────
        const closedAll = repDeals.filter(d => ['closed_won','closed_lost','disqualified'].includes(d.stage))
        const winRate = closedAll.length ? closedAll.filter(d => d.stage === 'closed_won').length / closedAll.length : null
        const avgCycle = wonYTD.length ? wonYTD.reduce((s, d) => {
          const days = (new Date(d.closed_at) - new Date(d.created_at)) / 86400000
          return s + (Number.isFinite(days) ? days : 0)
        }, 0) / wonYTD.length : null
        const selfActivePct = active.length ? active.filter(d => d.source === 'self_sourced').length / active.length : null
        const selfWonPct = wonYTD.length ? wonYTD.filter(d => d.source === 'self_sourced').length / wonYTD.length : null
        const avgPipelineDealSize = active.length ? activeValue / active.length : null

        // ── Coaching ───────────────────────────────────────────────────────
        const COACH_KEYS = ['discovery_depth_score','curiosity_score','challenger_score','value_articulation_score','objection_handling_score','independently_wealthy_score']
        let dimSum = 0, dimN = 0
        let trSum = 0, trN = 0
        for (const c of coaching) {
          const sa = c.score_averages || {}
          for (const k of COACH_KEYS) {
            const v = Number(sa[k])
            if (Number.isFinite(v)) { dimSum += v; dimN++ }
          }
          const tr = Number(sa.talk_ratio)
          if (Number.isFinite(tr)) { trSum += tr; trN++ }
        }
        const coachingAvg = dimN ? dimSum / dimN : null
        const talkRatioAvg = trN ? trSum / trN : null

        // ── YoY growth ─────────────────────────────────────────────────────
        const arrYTD = bookings
        const arrPriorFY = wonPriorFY.reduce((s, d) => s + (Number(d.deal_value) || 0), 0)
        const yoyArr = arrPriorFY > 0 ? (arrYTD - arrPriorFY * (Math.max(1, Math.round((Date.now() - fyStart) / 86400000)) / 365)) / Math.max(1, arrPriorFY * (Math.max(1, Math.round((Date.now() - fyStart) / 86400000)) / 365)) : null

        if (cancelled) return
        // Map of { key: { current, lastQ, lastY } }
        setActuals({
          pipeline_coverage:      { current: coverage, lastQ: null, lastY: null },
          self_sourced_active_pct: { current: selfActivePct, lastQ: null, lastY: null },
          self_sourced_won_pct:   { current: selfWonPct, lastQ: null, lastY: null },
          avg_deal_size_pipeline: { current: avgPipelineDealSize, lastQ: null, lastY: null },
          win_rate:               { current: winRate, lastQ: null, lastY: null },
          cycle_days:             { current: avgCycle, lastQ: null, lastY: null },
          coaching_score_target:  { current: coachingAvg, lastQ: null, lastY: null },
          talk_ratio_target:      { current: talkRatioAvg, lastQ: null, lastY: null },
          yoy_arr_growth:         { current: yoyArr, lastQ: null, lastY: null },
          // Bookings comparisons for stretch revenue rows
          stretch_revenue_annual: { current: arrYTD, lastQ: wonLastQ.reduce((s, d) => s + (Number(d.deal_value) || 0), 0), lastY: arrPriorFY },
        })
      } catch (e) {
        console.error('benchmarks actuals load error:', e)
      } finally {
        if (!cancelled) setLoadingActuals(false)
      }
    }
    loadActuals()
    return () => { cancelled = true }
  }, [profile?.org_id])

  async function save() {
    if (saving || !org?.id) return
    setSaving(true)
    // Build the full benchmarks payload from the draft (parse strings to nums).
    const payload = { ...orgBenchmarks }
    for (const section of SECTIONS) {
      for (const m of section.metrics) {
        if (m.key in draft) {
          const v = parseInput(m.type, draft[m.key])
          if (v != null) payload[m.key] = v
          else delete payload[m.key]
        }
      }
    }
    const { error } = await supabase.from('organizations').update({ benchmarks: payload }).eq('id', org.id)
    setSaving(false)
    if (error) {
      alert('Save failed: ' + error.message)
      return
    }
    if (refreshOrg) refreshOrg()
    setSavedAt(new Date())
  }

  const isManagerRole = ['head_of_sales','avp','rvp','admin','system_admin'].includes(profile?.role_level || profile?.role)

  if (!isManagerRole) {
    return (
      <div style={{ padding: 40, fontFamily: T.font, maxWidth: 640, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>Benchmarks are set by sales leadership</div>
        <div style={{ fontSize: 13, color: T.textMuted }}>Your VP / AVP / RVP defines the targets the dashboard measures everyone against.</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1100, margin: '0 auto', fontFamily: T.font, color: T.text }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>Benchmarks & Goals</h1>
        <div style={{ fontSize: 13, color: T.textMuted }}>{org?.name || ''}</div>
      </div>
      <div style={{ fontSize: 13, color: T.textMuted, lineHeight: 1.55, marginBottom: 24, maxWidth: 720 }}>
        These are the bars every dashboard tile compares against. Numbers shown next to each input
        are <strong style={{ color: T.text }}>your team's current actuals</strong> — set targets in
        context, not in a vacuum. Changes apply org-wide as soon as you save.
      </div>

      {SECTIONS.map(section => (
        <section key={section.label} style={{ marginBottom: 28 }}>
          <div style={{ marginBottom: 10 }}>
            <h2 style={{ fontSize: 12, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>{section.label}</h2>
            {section.desc && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 2 }}>{section.desc}</div>}
          </div>
          <div style={{ background: T.surface, border: `0.5px solid ${T.border}`, borderRadius: 12, overflow: 'hidden' }}>
            {section.metrics.map((m, i) => {
              const a = actuals?.[m.key]
              const last = i === section.metrics.length - 1
              return (
                <div key={m.key} style={{
                  display: 'grid', gridTemplateColumns: '2fr 1fr 1.5fr', gap: 18, alignItems: 'center',
                  padding: '14px 18px', borderBottom: last ? 'none' : `0.5px solid ${T.borderLight}`,
                }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{m.label}</div>
                    {m.desc && <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>{m.desc}</div>}
                  </div>
                  <div style={{ position: 'relative' }}>
                    {m.type === 'money' && <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 13 }}>$</span>}
                    <input
                      type="text"
                      inputMode="decimal"
                      value={draft[m.key] ?? ''}
                      onChange={e => setDraft(d => ({ ...d, [m.key]: e.target.value }))}
                      placeholder="—"
                      style={{
                        width: '100%', padding: m.type === 'money' ? '9px 12px 9px 22px' : '9px 12px',
                        fontSize: 14, fontWeight: 600,
                        border: `1px solid ${T.border}`, borderRadius: 6,
                        background: T.surface, color: T.text, fontFamily: T.font, textAlign: 'right',
                      }}
                    />
                    {m.type === 'pct' && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>%</span>}
                    {m.type === 'days' && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>d</span>}
                    {m.type === 'ratio' && m.suffix && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>{m.suffix}</span>}
                    {m.type === 'score' && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: T.textMuted, fontSize: 12 }}>/10</span>}
                  </div>
                  <div style={{ fontSize: 11, color: T.textMuted, lineHeight: 1.55 }}>
                    {loadingActuals ? (
                      <span style={{ color: T.textMuted }}>loading…</span>
                    ) : a ? (
                      <>
                        <div><span style={{ color: T.textMuted }}>Today:</span> <strong style={{ color: T.text, fontWeight: 600 }}>{formatVal(m.type, a.current)}</strong></div>
                        {a.lastQ != null && <div><span style={{ color: T.textMuted }}>Last Q:</span> <strong style={{ color: T.text, fontWeight: 600 }}>{formatVal(m.type, a.lastQ)}</strong></div>}
                        {a.lastY != null && <div><span style={{ color: T.textMuted }}>Last yr:</span> <strong style={{ color: T.text, fontWeight: 600 }}>{formatVal(m.type, a.lastY)}</strong></div>}
                      </>
                    ) : (
                      <span style={{ color: T.textMuted }}>no historical data</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      {/* Sticky save bar */}
      <div style={{
        position: 'sticky', bottom: 0, marginTop: 12,
        background: T.surface, border: `0.5px solid ${T.border}`, borderRadius: 12,
        padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12,
        boxShadow: '0 -4px 12px rgba(0,0,0,0.04)',
      }}>
        <button onClick={save} disabled={saving} style={{
          padding: '10px 22px', background: T.primary, color: '#fff', border: 'none', borderRadius: 8,
          fontSize: 13, fontWeight: 700, cursor: saving ? 'wait' : 'pointer', fontFamily: T.font,
          opacity: saving ? 0.6 : 1,
        }}>
          {saving ? 'Saving…' : 'Save benchmarks'}
        </button>
        {savedAt && <span style={{ fontSize: 12, color: T.success, fontWeight: 600 }}>Saved · {savedAt.toLocaleTimeString()}</span>}
        <div style={{ marginLeft: 'auto', fontSize: 11, color: T.textMuted, lineHeight: 1.4, maxWidth: 380, textAlign: 'right' }}>
          Saved benchmarks apply org-wide. Dashboards re-render with the new bars on next reload.
        </div>
      </div>
    </div>
  )
}
