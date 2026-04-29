// Widget Schema — maps all DealCoach tables, fields, types, and join paths

export const TABLES = {
  deals: {
    label: 'Deals', join: null, multi: false,
    fields: {
      company_name: { type: 'text', label: 'Company Name' },
      website: { type: 'text', label: 'Website' },
      stage: { type: 'badge', label: 'Stage', options: ['qualify','discovery','solution_validation','confirming_value','selection','closed_won','closed_lost','disqualified'] },
      forecast_category: { type: 'badge', label: 'Forecast', options: ['pipeline','upside','forecast','commit'] },
      cmrr: { type: 'currency', label: 'CMRR' },
      deal_value: { type: 'currency', label: 'Deal Value' },
      target_close_date: { type: 'date', label: 'Target Close' },
      next_steps: { type: 'text', label: 'Next Steps' },
      fit_score: { type: 'score', label: 'Fit Score' },
      deal_health_score: { type: 'score', label: 'Health Score' },
      icp_fit_score: { type: 'number', label: 'ICP Fit' },
      notes: { type: 'text', label: 'Notes' },
      rep_id: { type: 'text', label: 'Rep ID' },
      org_id: { type: 'text', label: 'Org ID' },
    },
  },
  deal_analysis: {
    label: 'Deal Analysis', join: 'deal_id', multi: false,
    fields: {
      budget: { type: 'text', label: 'Budget' },
      champion: { type: 'text', label: 'Champion' },
      economic_buyer: { type: 'text', label: 'Economic Buyer' },
      quantified_pain: { type: 'text', label: 'Quantified Pain' },
      decision_date: { type: 'date', label: 'Decision Date' },
      signature_date: { type: 'date', label: 'Signature Date' },
      kickoff_date: { type: 'date', label: 'Kickoff Date' },
      go_live_date: { type: 'date', label: 'Go-Live Date' },
      decision_criteria: { type: 'text', label: 'Decision Criteria' },
      decision_process: { type: 'text', label: 'Decision Process' },
      red_flags: { type: 'text', label: 'Red Flags' },
      green_flags: { type: 'text', label: 'Green Flags' },
      pain_points: { type: 'text', label: 'Pain Points (text)' },
      business_impact: { type: 'text', label: 'Business Impact' },
      driving_factors: { type: 'text', label: 'Driving Factors' },
      exec_alignment: { type: 'text', label: 'Exec Alignment' },
      integrations_needed: { type: 'text', label: 'Integrations Needed' },
      current_spend: { type: 'text', label: 'Current Spend' },
      running_problem_cost_dollars: { type: 'currency', label: 'Problem Cost $' },
      running_problem_cost_hours: { type: 'number', label: 'Problem Cost Hours' },
      busy_season: { type: 'text', label: 'Busy Season' },
      timeline_drivers: { type: 'text', label: 'Timeline Drivers' },
      has_rfp: { type: 'boolean', label: 'Has RFP' },
      has_consultant: { type: 'boolean', label: 'Has Consultant' },
      consultant_name: { type: 'text', label: 'Consultant Name' },
    },
  },
  company_profile: {
    label: 'Company Profile', join: 'deal_id', multi: false,
    fields: {
      overview: { type: 'text', label: 'Overview' },
      revenue: { type: 'text', label: 'Revenue' },
      employee_count: { type: 'text', label: 'Employees' },
      industry: { type: 'text', label: 'Industry' },
      headquarters: { type: 'text', label: 'Headquarters' },
      founded: { type: 'text', label: 'Founded' },
      tech_stack: { type: 'text', label: 'Tech Stack' },
      business_goals: { type: 'text', label: 'Business Goals' },
      business_priorities: { type: 'text', label: 'Business Priorities' },
      growth_plans: { type: 'text', label: 'Growth Plans' },
      recent_news: { type: 'text', label: 'Recent News' },
      logo_url: { type: 'text', label: 'Logo URL' },
    },
  },
  deal_sizing: {
    label: 'Deal Sizing', join: 'deal_id', multi: false,
    fields: {
      full_users: { type: 'number', label: 'Full Users' },
      view_only_users: { type: 'number', label: 'View-Only Users' },
      entity_count: { type: 'number', label: 'Entities' },
      ap_invoices_monthly: { type: 'number', label: 'AP Invoices/mo' },
      ar_invoices_monthly: { type: 'number', label: 'AR Invoices/mo' },
      fixed_assets: { type: 'number', label: 'Fixed Assets' },
      employee_count_payroll: { type: 'number', label: 'Payroll Employees' },
    },
  },
  contacts: {
    label: 'Contacts', join: 'deal_id', multi: true,
    fields: {
      name: { type: 'text', label: 'Name' },
      title: { type: 'text', label: 'Title' },
      email: { type: 'text', label: 'Email' },
      linkedin: { type: 'text', label: 'LinkedIn' },
      role_in_deal: { type: 'text', label: 'Role in Deal' },
      influence_level: { type: 'badge', label: 'Influence', options: ['high','medium','low'] },
      is_champion: { type: 'boolean', label: 'Champion' },
      is_signer: { type: 'boolean', label: 'Signer' },
      is_economic_buyer: { type: 'boolean', label: 'Economic Buyer' },
      department: { type: 'text', label: 'Department' },
      background: { type: 'text', label: 'Background' },
    },
  },
  tasks: {
    label: 'Tasks', join: 'deal_id', multi: true,
    fields: {
      title: { type: 'text', label: 'Title' },
      priority: { type: 'badge', label: 'Priority', options: ['high','medium','low'] },
      due_date: { type: 'date', label: 'Due Date' },
      completed: { type: 'boolean', label: 'Completed' },
      owner: { type: 'text', label: 'Owner' },
      is_blocking: { type: 'boolean', label: 'Blocking' },
      auto_generated: { type: 'boolean', label: 'AI Generated' },
    },
  },
  compelling_events: {
    label: 'Compelling Events', join: 'deal_id', multi: true,
    fields: {
      event_description: { type: 'text', label: 'Description' },
      event_date: { type: 'date', label: 'Date' },
      impact: { type: 'text', label: 'Impact' },
      strength: { type: 'badge', label: 'Strength', options: ['strong','medium','weak'] },
      verified: { type: 'boolean', label: 'Verified' },
    },
  },
  business_catalysts: {
    label: 'Business Catalysts', join: 'deal_id', multi: true,
    fields: {
      catalyst: { type: 'text', label: 'Catalyst' },
      category: { type: 'text', label: 'Category' },
      impact: { type: 'text', label: 'Impact' },
      urgency: { type: 'badge', label: 'Urgency', options: ['high','medium','low'] },
    },
  },
  deal_competitors: {
    label: 'Competitors', join: 'deal_id', multi: true,
    fields: {
      competitor_name: { type: 'text', label: 'Name' },
      strengths: { type: 'text', label: 'Strengths' },
      weaknesses: { type: 'text', label: 'Weaknesses' },
      where_in_process: { type: 'text', label: 'Status' },
      received_pricing: { type: 'boolean', label: 'Has Pricing' },
      strategy: { type: 'text', label: 'Strategy' },
    },
  },
  deal_flags: {
    label: 'Deal Flags', join: 'deal_id', multi: true,
    fields: {
      flag_type: { type: 'badge', label: 'Type', options: ['red','green'] },
      description: { type: 'text', label: 'Description' },
      category: { type: 'text', label: 'Category' },
      severity: { type: 'badge', label: 'Severity', options: ['critical','high','medium','low'] },
      source: { type: 'text', label: 'Source' },
      resolved: { type: 'boolean', label: 'Resolved' },
    },
  },
  deal_risks: {
    label: 'Deal Risks', join: 'deal_id', multi: true,
    fields: {
      risk_description: { type: 'text', label: 'Description' },
      category: { type: 'text', label: 'Category' },
      severity: { type: 'badge', label: 'Severity', options: ['critical','high','medium','low'] },
      status: { type: 'badge', label: 'Status', options: ['open','mitigating','mitigated','accepted','closed'] },
      mitigation_plan: { type: 'text', label: 'Mitigation' },
    },
  },
  deal_pain_points: {
    label: 'Pain Points', join: 'deal_id', multi: true,
    fields: {
      pain_description: { type: 'text', label: 'Description' },
      category: { type: 'text', label: 'Category' },
      annual_cost: { type: 'currency', label: 'Annual Cost' },
      annual_hours: { type: 'number', label: 'Annual Hours' },
      affected_team: { type: 'text', label: 'Affected Team' },
      verified: { type: 'boolean', label: 'Verified' },
    },
  },
  conversations: {
    label: 'Conversations', join: 'deal_id', multi: true,
    fields: {
      title: { type: 'text', label: 'Title' },
      call_type: { type: 'badge', label: 'Call Type', options: ['qdc','functional_discovery','demo','scoping','proposal','negotiation','sync','custom'] },
      call_date: { type: 'date', label: 'Call Date' },
      ai_summary: { type: 'text', label: 'AI Summary' },
      processed: { type: 'boolean', label: 'Processed' },
      task_count: { type: 'number', label: 'Task Count' },
    },
  },
  company_systems: {
    label: 'Company Systems', join: 'deal_id', multi: true,
    fields: {
      system_category: { type: 'text', label: 'Category' },
      system_name: { type: 'text', label: 'System Name' },
      confirmed: { type: 'boolean', label: 'Confirmed' },
      is_current: { type: 'boolean', label: 'Current' },
    },
  },
}

export const FORMAT_TYPES = ['text', 'number', 'currency', 'percentage', 'date', 'badge', 'boolean', 'score']
export const SECTION_TYPES = ['metric', 'table', 'card', 'grid', 'list']
export const OPERATORS = ['equals', 'not_equals', 'less_than', 'greater_than', 'contains', 'is_empty', 'is_not_empty', 'is_unknown', 'in_list']
export const CLICK_ACTIONS = ['none', 'navigate_deal', 'open_url', 'copy']
export const AGGREGATES = ['none', 'count', 'sum', 'avg', 'min', 'max']

// ─────────────────────────────────────────────────────────────────────────────
// Derived / virtual fields — computed at query time from base + joined data.
// Registered per base table. Each field declares:
//   key, label, type, group  — display
//   requiresColumns           — base-table columns the compute depends on
//   requiresJoins             — joined tables the compute depends on
//   compute(row, opts)        — JS function returning the derived value
//   format                    — default format for the formatter
//   options?                  — for badge-like enums, possible values
//   bucketDefaults?           — for score buckets, the default thresholds
//
// Buckets and recency thresholds are configurable per-report via cfg.field_options[key].
// ─────────────────────────────────────────────────────────────────────────────

const dayMs = 86_400_000
function toDate(v) { return v ? new Date(v) : null }
function diffDays(a, b) {
  const da = toDate(a), db = toDate(b)
  if (!da || !db) return null
  return Math.floor((db.getTime() - da.getTime()) / dayMs)
}
function startOfDay(d = new Date()) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }

function bucketize(score, thresholds) {
  if (score == null || !Number.isFinite(Number(score))) return null
  const n = Number(score)
  const strong = thresholds?.strong ?? 80
  const good = thresholds?.good ?? 60
  if (n >= strong) return 'Strong'
  if (n >= good) return 'Good'
  return 'Weak'
}

function arr(row, table) {
  const v = row?.[table]
  if (Array.isArray(v)) return v
  if (v && typeof v === 'object') return [v]
  return []
}

function parseRevenueBand(rev) {
  if (rev == null || rev === '' || rev === 'Unknown') return null
  const s = String(rev).toLowerCase().replace(/[$,\s]/g, '')
  // Try to extract a numeric value with a suffix
  const m = s.match(/^([\d.]+)([kmb]?)/)
  if (!m) return null
  const n = parseFloat(m[1]) * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1)
  if (!Number.isFinite(n)) return null
  if (n < 10e6) return '<$10M'
  if (n < 50e6) return '$10M-$50M'
  if (n < 250e6) return '$50M-$250M'
  if (n < 1e9) return '$250M-$1B'
  return '$1B+'
}

function parseEmployeeBand(emp) {
  if (emp == null || emp === '' || emp === 'Unknown') return null
  // Already a range like "51-200" or a number "150"
  const num = parseInt(String(emp).replace(/[,\s]/g, ''), 10)
  if (Number.isFinite(num)) {
    if (num <= 50) return '1-50'
    if (num <= 250) return '51-250'
    if (num <= 1000) return '251-1000'
    if (num <= 5000) return '1001-5000'
    return '5000+'
  }
  // Try matching banded ranges
  const m = String(emp).match(/(\d+)\s*[-–]\s*(\d+)/)
  if (m) {
    const lo = parseInt(m[1], 10)
    if (lo <= 50) return '1-50'
    if (lo <= 250) return '51-250'
    if (lo <= 1000) return '251-1000'
    if (lo <= 5000) return '1001-5000'
    return '5000+'
  }
  return null
}

export const DERIVED_FIELDS = {
  deals: [
    // ── Time ─────────────────────────────────────────────────────────────────
    { key: 'close_month', label: 'Close month', type: 'text', group: 'Time',
      requiresColumns: ['target_close_date'],
      compute: (r) => r?.target_close_date ? String(r.target_close_date).slice(0, 7) : null,
      format: { type: 'text' },
    },
    { key: 'close_quarter', label: 'Close quarter', type: 'text', group: 'Time',
      requiresColumns: ['target_close_date'],
      compute: (r) => {
        const d = toDate(r?.target_close_date); if (!d) return null
        return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`
      },
      format: { type: 'text' },
    },
    { key: 'close_year', label: 'Close year', type: 'number', group: 'Time',
      requiresColumns: ['target_close_date'],
      compute: (r) => { const d = toDate(r?.target_close_date); return d ? d.getFullYear() : null },
      format: { type: 'integer' },
    },
    { key: 'days_to_close', label: 'Days to close', type: 'number', group: 'Time',
      requiresColumns: ['target_close_date'],
      compute: (r) => diffDays(startOfDay(), toDate(r?.target_close_date)),
      format: { type: 'custom', precision: 0, suffix: ' days' },
    },
    { key: 'deal_age_days', label: 'Deal age (days)', type: 'number', group: 'Time',
      requiresColumns: ['created_at', 'closed_at'],
      compute: (r) => {
        const start = toDate(r?.created_at); if (!start) return null
        const end = r?.closed_at ? toDate(r.closed_at) : new Date()
        return Math.max(0, Math.floor((end.getTime() - start.getTime()) / dayMs))
      },
      format: { type: 'custom', precision: 0, suffix: ' days' },
    },
    { key: 'days_in_current_stage', label: 'Days in current stage', type: 'number', group: 'Time',
      requiresColumns: ['stage_changed_at'],
      compute: (r) => {
        const t = toDate(r?.stage_changed_at); if (!t) return null
        return Math.max(0, Math.floor((Date.now() - t.getTime()) / dayMs))
      },
      format: { type: 'custom', precision: 0, suffix: ' days' },
    },
    { key: 'days_since_last_call', label: 'Days since last call', type: 'number', group: 'Time',
      requiresJoins: ['conversations'],
      compute: (r) => {
        const calls = arr(r, 'conversations')
        const dates = calls.map(c => toDate(c.call_date)).filter(Boolean)
        if (!dates.length) return null
        const max = Math.max(...dates.map(d => d.getTime()))
        return Math.max(0, Math.floor((Date.now() - max) / dayMs))
      },
      format: { type: 'custom', precision: 0, suffix: ' days' },
    },
    { key: 'days_since_next_steps_update', label: 'Days since next steps update', type: 'number', group: 'Time',
      requiresColumns: ['updated_at'],
      compute: (r) => {
        const t = toDate(r?.updated_at); if (!t) return null
        return Math.max(0, Math.floor((Date.now() - t.getTime()) / dayMs))
      },
      format: { type: 'custom', precision: 0, suffix: ' days' },
    },

    // ── Score buckets ────────────────────────────────────────────────────────
    { key: 'fit_score_bucket', label: 'Fit score (bucket)', type: 'bucket', group: 'Scores',
      requiresColumns: ['fit_score'],
      bucketDefaults: { strong: 80, good: 60 },
      compute: (r, opts) => bucketize(r?.fit_score, opts?.bucket),
      format: { type: 'text' },
    },
    { key: 'health_score_bucket', label: 'Health score (bucket)', type: 'bucket', group: 'Scores',
      requiresColumns: ['deal_health_score'],
      bucketDefaults: { strong: 80, good: 60 },
      compute: (r, opts) => bucketize(r?.deal_health_score, opts?.bucket),
      format: { type: 'text' },
    },
    { key: 'icp_fit_bucket', label: 'ICP fit (bucket)', type: 'bucket', group: 'Scores',
      requiresColumns: ['icp_fit_score'],
      bucketDefaults: { strong: 80, good: 60 },
      compute: (r, opts) => bucketize(r?.icp_fit_score, opts?.bucket),
      format: { type: 'text' },
    },

    // ── Boolean flags ────────────────────────────────────────────────────────
    { key: 'has_compelling_event', label: 'Has compelling event', type: 'boolean', group: 'Flags',
      requiresJoins: ['compelling_events'],
      compute: (r) => arr(r, 'compelling_events').length > 0,
      format: { type: 'text' },
    },
    { key: 'has_champion', label: 'Has identified champion', type: 'boolean', group: 'Flags',
      requiresJoins: ['contacts'],
      compute: (r) => arr(r, 'contacts').some(c => c?.is_champion === true),
      format: { type: 'text' },
    },
    { key: 'has_economic_buyer', label: 'Has identified economic buyer', type: 'boolean', group: 'Flags',
      requiresJoins: ['contacts'],
      compute: (r) => arr(r, 'contacts').some(c => c?.is_economic_buyer === true),
      format: { type: 'text' },
    },
    { key: 'has_competitor', label: 'Has competitor identified', type: 'boolean', group: 'Flags',
      requiresJoins: ['deal_competitors'],
      compute: (r) => arr(r, 'deal_competitors').length > 0,
      format: { type: 'text' },
    },
    { key: 'has_msp', label: 'Has Project Plan', type: 'boolean', group: 'Flags',
      requiresJoins: ['msp_stages'],
      compute: (r) => arr(r, 'msp_stages').length > 0,
      format: { type: 'text' },
    },
    { key: 'icp_fit', label: 'ICP fit', type: 'boolean', group: 'Flags',
      requiresColumns: ['icp_fit_score'],
      compute: (r) => Number(r?.icp_fit_score) >= 60,
      format: { type: 'text' },
    },

    // ── Counts ───────────────────────────────────────────────────────────────
    { key: 'pain_points_count', label: 'Pain points count', type: 'number', group: 'Counts',
      requiresJoins: ['deal_pain_points'],
      compute: (r) => arr(r, 'deal_pain_points').length,
      format: { type: 'integer' },
    },
    { key: 'risks_count', label: 'Risks count', type: 'number', group: 'Counts',
      requiresJoins: ['deal_risks'],
      compute: (r) => arr(r, 'deal_risks').length,
      format: { type: 'integer' },
    },
    { key: 'competitors_count', label: 'Competitors count', type: 'number', group: 'Counts',
      requiresJoins: ['deal_competitors'],
      compute: (r) => arr(r, 'deal_competitors').length,
      format: { type: 'integer' },
    },
    { key: 'contacts_count', label: 'Contacts count', type: 'number', group: 'Counts',
      requiresJoins: ['contacts'],
      compute: (r) => arr(r, 'contacts').length,
      format: { type: 'integer' },
    },
    { key: 'calls_count', label: 'Calls count', type: 'number', group: 'Counts',
      requiresJoins: ['conversations'],
      compute: (r) => arr(r, 'conversations').length,
      format: { type: 'integer' },
    },
    { key: 'open_tasks_count', label: 'Open tasks count', type: 'number', group: 'Counts',
      requiresJoins: ['tasks'],
      compute: (r) => arr(r, 'tasks').filter(t => !t?.completed).length,
      format: { type: 'integer' },
    },
    { key: 'msp_stages_count', label: 'Project Plan stages count', type: 'number', group: 'Counts',
      requiresJoins: ['msp_stages'],
      compute: (r) => arr(r, 'msp_stages').length,
      format: { type: 'integer' },
    },

    // ── Status flags ────────────────────────────────────────────────────────
    { key: 'next_steps_color_chip', label: 'Next steps color', type: 'color_chip', group: 'Status',
      requiresColumns: ['next_steps_color'],
      compute: (r) => r?.next_steps_color || null,
      options: ['red', 'green'],
      format: { type: 'text' },
    },
    { key: 'forecast_stage_alignment', label: 'Forecast vs stage alignment', type: 'badge', group: 'Status',
      requiresColumns: ['forecast_category', 'stage'],
      compute: (r) => {
        const fc = String(r?.forecast_category || '').toLowerCase()
        const stg = String(r?.stage || '').toLowerCase()
        if (fc === 'commit' && (stg === 'qualify' || stg === 'discovery')) return 'Misaligned'
        return 'Aligned'
      },
      options: ['Aligned', 'Misaligned'],
      format: { type: 'text' },
    },
    { key: 'msp_completion_pct', label: 'Project Plan completion %', type: 'percentage', group: 'Status',
      requiresJoins: ['msp_stages'],
      compute: (r) => {
        const stages = arr(r, 'msp_stages')
        if (!stages.length) return null
        const done = stages.filter(s => s?.status === 'completed').length
        return done / stages.length
      },
      format: { type: 'percentage', precision: 0 },
    },

    // ── Activity recency ─────────────────────────────────────────────────────
    { key: 'is_stale', label: 'Stale', type: 'boolean', group: 'Activity',
      requiresColumns: ['updated_at'],
      compute: (r, opts) => {
        const t = toDate(r?.updated_at); if (!t) return null
        const days = Math.floor((Date.now() - t.getTime()) / dayMs)
        return days >= (opts?.staleDays ?? 14)
      },
      format: { type: 'text' },
    },
    { key: 'is_hot', label: 'Hot', type: 'boolean', group: 'Activity',
      requiresColumns: ['updated_at'],
      compute: (r, opts) => {
        const t = toDate(r?.updated_at); if (!t) return null
        const days = Math.floor((Date.now() - t.getTime()) / dayMs)
        return days <= (opts?.hotDays ?? 3)
      },
      format: { type: 'text' },
    },

    // ── Company context (banded from company_profile) ────────────────────────
    { key: 'industry', label: 'Industry', type: 'text', group: 'Company',
      requiresJoins: ['company_profile'],
      compute: (r) => arr(r, 'company_profile')[0]?.industry || null,
      format: { type: 'text' },
    },
    { key: 'revenue', label: 'Revenue (raw)', type: 'text', group: 'Company',
      requiresJoins: ['company_profile'],
      compute: (r) => arr(r, 'company_profile')[0]?.revenue || null,
      format: { type: 'text' },
    },
    { key: 'employee_count', label: 'Employees (raw)', type: 'text', group: 'Company',
      requiresJoins: ['company_profile'],
      compute: (r) => arr(r, 'company_profile')[0]?.employee_count || null,
      format: { type: 'text' },
    },
    { key: 'revenue_band', label: 'Revenue band', type: 'badge', group: 'Company',
      requiresJoins: ['company_profile'],
      compute: (r) => parseRevenueBand(arr(r, 'company_profile')[0]?.revenue),
      options: ['<$10M', '$10M-$50M', '$50M-$250M', '$250M-$1B', '$1B+'],
      format: { type: 'text' },
    },
    { key: 'employee_band', label: 'Employee band', type: 'badge', group: 'Company',
      requiresJoins: ['company_profile'],
      compute: (r) => parseEmployeeBand(arr(r, 'company_profile')[0]?.employee_count),
      options: ['1-50', '51-250', '251-1000', '1001-5000', '5000+'],
      format: { type: 'text' },
    },
  ],
}

// Lookup helper — derived field by base + key.
export function getDerivedField(base, key) {
  return (DERIVED_FIELDS[base] || []).find(f => f.key === key) || null
}

// Returns derived fields grouped by their `group`, preserving the registry order.
export function getDerivedGroups(base) {
  const groups = new Map()
  for (const f of DERIVED_FIELDS[base] || []) {
    if (!groups.has(f.group)) groups.set(f.group, [])
    groups.get(f.group).push(f)
  }
  return [...groups.entries()].map(([name, fields]) => ({ name, fields }))
}
