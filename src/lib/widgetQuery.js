import { supabase } from './supabase'
import { TABLES } from './widgetSchema'

/**
 * Build and execute a Supabase query from a widget section config.
 * Returns { data, error }
 */
export async function executeWidgetQuery(section, context = {}) {
  const ds = section.data_source
  if (!ds?.base_table) return { data: [], error: 'No base table' }

  const baseTable = ds.base_table
  const fields = ds.fields || []

  // Determine which tables we need to join
  const tables = new Set()
  fields.forEach(f => tables.add(f.table || baseTable))

  // Build select string with joins
  const selectParts = []
  const joinTables = new Set()

  fields.forEach(f => {
    const tbl = f.table || baseTable
    if (tbl === baseTable) {
      selectParts.push(f.field)
    } else {
      joinTables.add(tbl)
    }
  })

  // Build select with foreign table expansions
  let selectStr = '*'
  if (joinTables.size > 0) {
    const joins = [...joinTables].map(t => `${t}(*)`).join(', ')
    selectStr = `*, ${joins}`
  }

  let query = supabase.from(baseTable).select(selectStr)

  // Apply context filter (e.g. deal_id for deal widgets)
  if (context.deal_id && ds.context_filter !== false) {
    const tableInfo = TABLES[baseTable]
    if (tableInfo?.join === 'deal_id') {
      query = query.eq('deal_id', context.deal_id)
    } else if (baseTable === 'deals') {
      query = query.eq('id', context.deal_id)
    }
  }

  // Apply user/org context
  if (context.user_id && baseTable === 'deals' && !context.deal_id) {
    query = query.eq('rep_id', context.user_id)
  }

  // Apply filters. Supports two shapes:
  //   ds.filters: [{ field, operator, value }]              — flat AND
  //   ds.filter_logic: 'and' | 'or'                          — with ds.filters, toggles combinator
  //   ds.filter_groups: [{ logic, conditions: [...] }, ...]  — groups combined by outer AND
  // Groups are rendered as Postgres `or()` expressions when logic=or.
  function filterToPgrest(f) {
    const field = f.field?.includes('.') ? f.field.split('.').pop() : f.field
    if (!field) return null
    const val = f.value
    switch (f.operator) {
      case 'equals': return `${field}.eq.${val}`
      case 'not_equals': return `${field}.neq.${val}`
      case 'less_than': return `${field}.lt.${val}`
      case 'greater_than': return `${field}.gt.${val}`
      case 'contains': return `${field}.ilike.*${val}*`
      case 'is_empty': return `${field}.is.null`
      case 'is_not_empty': return `${field}.not.is.null`
      case 'is_unknown': return `${field}.eq.Unknown`
      case 'in_list': return `${field}.in.(${(Array.isArray(val) ? val : [val]).join(',')})`
      default: return null
    }
  }
  function applyAndFilter(q, f) {
    const field = f.field?.includes('.') ? f.field.split('.').pop() : f.field
    if (!field) return q
    switch (f.operator) {
      case 'equals': return q.eq(field, f.value)
      case 'not_equals': return q.neq(field, f.value)
      case 'less_than': return q.lt(field, f.value)
      case 'greater_than': return q.gt(field, f.value)
      case 'contains': return q.ilike(field, `%${f.value}%`)
      case 'is_empty': return q.is(field, null)
      case 'is_not_empty': return q.not(field, 'is', null)
      case 'is_unknown': return q.eq(field, 'Unknown')
      case 'in_list': return q.in(field, Array.isArray(f.value) ? f.value : [f.value])
      case 'not_in': return q.not(field, 'in', `(${(Array.isArray(f.value) ? f.value : [f.value]).join(',')})`)
      default: return q
    }
  }

  // Simple flat filters (back-compat). If filter_logic=or, build one OR expression.
  if ((ds.filters || []).length) {
    if (ds.filter_logic === 'or') {
      const parts = ds.filters.map(filterToPgrest).filter(Boolean)
      if (parts.length) query = query.or(parts.join(','))
    } else {
      for (const f of ds.filters) query = applyAndFilter(query, f)
    }
  }

  // Filter groups — each group combined by inner logic (AND/OR), groups AND-joined together.
  for (const grp of (ds.filter_groups || [])) {
    const conds = grp.conditions || []
    if (!conds.length) continue
    if ((grp.logic || 'and') === 'or') {
      const parts = conds.map(filterToPgrest).filter(Boolean)
      if (parts.length) query = query.or(parts.join(','))
    } else {
      for (const f of conds) query = applyAndFilter(query, f)
    }
  }

  // Apply ordering
  for (const ord of (ds.ordering || [])) {
    const field = ord.field?.includes('.') ? ord.field.split('.').pop() : ord.field
    query = query.order(field, { ascending: ord.direction === 'asc' })
  }

  // Limit
  if (ds.limit) query = query.limit(ds.limit)

  const { data, error } = await query
  return { data: data || [], error: error?.message }
}

/**
 * Apply aggregate function to data array
 */
export function aggregate(data, field, agg) {
  if (!data?.length || !field) return 0
  const values = data.map(d => Number(d[field]) || 0)
  switch (agg) {
    case 'count': return data.length
    case 'sum': return values.reduce((a, b) => a + b, 0)
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
    case 'min': return Math.min(...values)
    case 'max': return Math.max(...values)
    default: return data.length
  }
}

/**
 * Resolve a field value from a row, handling joined tables and formulas.
 * Formula field: { is_formula: true, formula: "field_a + field_b * 0.1", field: 'calc_key' }
 * Supports +, -, *, /, parentheses, numeric literals, and bare field names (resolved in row).
 */
export function resolveField(row, fieldConfig) {
  if (fieldConfig?.is_formula && fieldConfig.formula) return evalFormula(fieldConfig.formula, row)
  const tbl = fieldConfig.table
  const field = fieldConfig.field
  // Direct field
  if (!tbl || row[field] !== undefined) return row[field]
  // Joined table (single row)
  if (row[tbl] && typeof row[tbl] === 'object' && !Array.isArray(row[tbl])) return row[tbl][field]
  // Joined table (array — take first)
  if (Array.isArray(row[tbl]) && row[tbl][0]) return row[tbl][0][field]
  return null
}

/**
 * Evaluate a safe arithmetic formula against a row.
 * Replaces bare identifiers with row values; rejects anything that's not an arithmetic char.
 */
export function evalFormula(expr, row) {
  if (!expr) return null
  // Substitute identifiers (word chars, no digits leading) with row values
  const substituted = expr.replace(/[a-zA-Z_][a-zA-Z0-9_\.]*/g, (ident) => {
    const parts = ident.split('.')
    let val
    if (parts.length === 1) val = row[parts[0]]
    else {
      // joined-table style
      const [tbl, fld] = parts
      const joined = row[tbl]
      if (Array.isArray(joined)) val = joined[0]?.[fld]
      else if (joined && typeof joined === 'object') val = joined[fld]
    }
    const n = Number(val)
    return Number.isFinite(n) ? String(n) : '0'
  })
  // Only allow numbers, operators, parens, whitespace, decimal points
  if (!/^[0-9+\-*/().\s]*$/.test(substituted)) return null
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict";return (${substituted || 0})`)()
  } catch { return null }
}
