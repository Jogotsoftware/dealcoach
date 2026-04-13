// DealCoach Design Tokens
// cpqmsp2.0 Carolina Blue theme

export const theme = {
  // Primary
  primary: '#5DADE2',
  primaryHover: '#4A90C0',
  primaryLight: 'rgba(93, 173, 226, 0.08)',
  primaryBorder: 'rgba(93, 173, 226, 0.25)',

  // Surfaces
  bg: '#f5f5f5',
  surface: '#ffffff',
  surfaceAlt: '#fafbfc',
  surfaceHover: '#f3f4f6',

  // Borders
  border: '#e1e4e8',
  borderLight: '#e5e5e5',

  // Text
  text: '#2c3e50',
  textSecondary: '#666666',
  textMuted: '#999999',

  // Semantic
  success: '#28a745',
  successLight: 'rgba(40, 167, 69, 0.08)',
  warning: '#f59e0b',
  warningLight: 'rgba(245, 158, 11, 0.08)',
  error: '#dc3545',
  errorLight: 'rgba(220, 53, 69, 0.08)',

  // Sage
  sageGreen: '#6bb644',

  // Shadows
  shadow: '0 1px 3px rgba(0, 0, 0, 0.08)',
  shadowMd: '0 2px 8px rgba(0, 0, 0, 0.08)',

  // Shape
  radius: 8,

  // Typography
  font: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
  mono: "SFMono-Regular, Menlo, Consolas, monospace",
}

// Deal stages with colors
export const STAGES = [
  { key: 'qualify', label: 'Qualify', color: '#f59e0b' },
  { key: 'discovery', label: 'Discovery', color: '#f97316' },
  { key: 'solution_validation', label: 'Solution Validation', color: '#8b5cf6' },
  { key: 'confirming_value', label: 'Confirming Value', color: '#0ea5e9' },
  { key: 'selection', label: 'Selection', color: '#10b981' },
]

export const TERMINAL_STAGES = ['closed_won', 'closed_lost', 'disqualified']

export const FORECAST_CATEGORIES = [
  { key: 'pipeline', label: 'Pipeline', color: '#9ca3af' },
  { key: 'upside', label: 'Upside', color: '#f59e0b' },
  { key: 'forecast', label: 'Forecast', color: '#0ea5e9' },
  { key: 'commit', label: 'Commit', color: '#10b981' },
]

export const CALL_TYPES = [
  { key: 'qdc', label: 'QDC' },
  { key: 'functional_discovery', label: 'Functional Discovery' },
  { key: 'demo', label: 'Demo' },
  { key: 'scoping', label: 'Scoping' },
  { key: 'proposal', label: 'Proposal' },
  { key: 'negotiation', label: 'Negotiation' },
  { key: 'sync', label: 'Sync' },
  { key: 'custom', label: 'Custom' },
]

export const TASK_CATEGORIES = [
  'Follow Up', 'Internal', 'Send Materials', 'Deal Action', 'CRM Update', 'Research',
]

export const FY_START_MONTH = 10 // October

// Formatting helpers
export function formatCurrency(n) {
  if (n == null) return '--'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n}`
}

export function formatDate(d) {
  if (!d) return '\u2014'
  const dt = new Date(d + (d.length <= 10 ? 'T00:00:00' : ''))
  if (isNaN(dt.getTime())) return '\u2014'
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function formatDateLong(d) {
  if (!d) return '\u2014'
  const dt = new Date(d + (d.length <= 10 ? 'T00:00:00' : ''))
  if (isNaN(dt.getTime())) return '\u2014'
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

export function daysUntil(d) {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  return Math.ceil((dt - new Date()) / 86_400_000)
}

export function pctOf(value, total) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}

// Fiscal year helpers
export function getFiscalPeriods(today = new Date()) {
  const m = today.getMonth() + 1
  const y = today.getFullYear()
  const fy = m >= FY_START_MONTH ? y + 1 : y
  const monthsIntoFY = m >= FY_START_MONTH ? m - FY_START_MONTH : m + (12 - FY_START_MONTH)
  const fq = Math.floor(monthsIntoFY / 3) + 1

  const qStartMonthRaw = FY_START_MONTH + (fq - 1) * 3
  const qStartYear = qStartMonthRaw > 12 ? fy : fy - 1
  const qStartMonth = qStartMonthRaw > 12 ? qStartMonthRaw - 12 : qStartMonthRaw
  const qEndMonthRaw = qStartMonth + 2
  const qEndYear = qEndMonthRaw > 12 ? qStartYear + 1 : qStartYear
  const qEndMonth = qEndMonthRaw > 12 ? qEndMonthRaw - 12 : qEndMonthRaw

  return {
    fy,
    fq,
    monthStart: new Date(y, m - 1, 1).toISOString().split('T')[0],
    monthEnd: new Date(y, m, 0).toISOString().split('T')[0],
    quarterStart: new Date(qStartYear, qStartMonth - 1, 1).toISOString().split('T')[0],
    quarterEnd: new Date(qEndYear, qEndMonth, 0).toISOString().split('T')[0],
  }
}

export function getNext3Months(today = new Date()) {
  const months = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() + i, 1)
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0)
    months.push({
      label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      start: d.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
      isCurrent: i === 0,
    })
  }
  return months
}
