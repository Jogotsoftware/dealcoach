// Thin saved-report executor used by dashboard widgets and the report preview.
// Does NOT re-implement every Reports.jsx feature (filter_expression, matrix pivots,
// cross_filters). Handles the common case: base_entity + fields + filters + sort +
// limit. For anything more exotic, reports should be run from /reports directly.

import { supabase } from './supabase'
import { TABLES } from './widgetSchema'

function applyFilter(q, f) {
  if (!f?.field || !f?.operator) return q
  const v = f.value
  switch (f.operator) {
    case 'eq': return q.eq(f.field, v)
    case 'neq': return q.neq(f.field, v)
    case 'gt': return q.gt(f.field, v)
    case 'gte': return q.gte(f.field, v)
    case 'lt': return q.lt(f.field, v)
    case 'lte': return q.lte(f.field, v)
    case 'like': return q.ilike(f.field, `%${v}%`)
    case 'not_like': return q.not(f.field, 'ilike', `%${v}%`)
    case 'is_null': return q.is(f.field, null)
    case 'not_null': return q.not(f.field, 'is', null)
    case 'in': {
      const list = String(v || '').split(',').map(s => s.trim()).filter(Boolean)
      return list.length ? q.in(f.field, list) : q.eq(f.field, '__no_match__')
    }
    case 'not_in': {
      const list = String(v || '').split(',').map(s => s.trim()).filter(Boolean)
      return list.length ? q.not(f.field, 'in', `(${list.join(',')})`) : q
    }
    default: return q
  }
}

export async function executeSavedReport(report, overrides = {}) {
  if (!report) throw new Error('No report provided')
  const cfg = report.query_config || {}
  const base = cfg.base_entity || report.base_entity || 'deals'
  const declared = Array.isArray(cfg.fields) ? cfg.fields.filter(f => typeof f === 'string') : []
  const defaults = Object.keys(TABLES[base]?.fields || {}).slice(0, 8)
  const fields = (overrides.fields && overrides.fields.length) ? overrides.fields
    : declared.length ? declared
    : defaults

  // Conditions — support both legacy `filters: [...]` and `filter_groups: [{conditions:[]}]`
  const conditions = []
  if (Array.isArray(cfg.filters)) conditions.push(...cfg.filters)
  if (Array.isArray(cfg.filter_groups)) {
    for (const g of cfg.filter_groups) for (const c of (g.conditions || [])) conditions.push(c)
  }

  const selectList = Array.from(new Set(['id', ...fields])).join(', ')
  let q = supabase.from(base).select(selectList)
  for (const f of conditions) q = applyFilter(q, f)
  const orderBy = overrides.order_by || cfg.order_by
  if (orderBy) q = q.order(orderBy, { ascending: (overrides.order_dir || cfg.order_dir) === 'asc' })
  const lim = Math.min(Math.max(Number(overrides.limit || cfg.limit || 500), 1), 5000)
  q = q.limit(lim)

  const { data, error } = await q
  if (error) throw error
  return { rows: data || [], base_entity: base, fields }
}

export async function fetchSavedReport(id) {
  if (!id) return null
  const { data, error } = await supabase.from('saved_reports').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data
}

// Group rows by a categorical field and apply an aggregate (count | sum | avg | min | max)
export function groupAndAggregate(rows, groupField, valueField, aggregate = 'count') {
  if (!groupField) return []
  const groups = new Map()
  for (const row of rows) {
    const key = row[groupField] ?? '(empty)'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  const out = []
  for (const [key, items] of groups.entries()) {
    let value
    if (aggregate === 'count' || !valueField) {
      value = items.length
    } else {
      const nums = items.map(r => Number(r[valueField])).filter(n => !isNaN(n))
      if (aggregate === 'sum') value = nums.reduce((s, n) => s + n, 0)
      else if (aggregate === 'avg') value = nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0
      else if (aggregate === 'min') value = nums.length ? Math.min(...nums) : 0
      else if (aggregate === 'max') value = nums.length ? Math.max(...nums) : 0
      else value = nums.length
    }
    out.push({ label: String(key), value })
  }
  out.sort((a, b) => b.value - a.value)
  return out
}

export function scalarAggregate(rows, valueField, aggregate = 'count') {
  if (!rows?.length) return 0
  if (aggregate === 'count' || !valueField) return rows.length
  const nums = rows.map(r => Number(r[valueField])).filter(n => !isNaN(n))
  if (!nums.length) return 0
  if (aggregate === 'sum') return nums.reduce((s, n) => s + n, 0)
  if (aggregate === 'avg') return nums.reduce((s, n) => s + n, 0) / nums.length
  if (aggregate === 'min') return Math.min(...nums)
  if (aggregate === 'max') return Math.max(...nums)
  return rows.length
}
