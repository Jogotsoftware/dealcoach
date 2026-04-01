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

  // Apply filters
  for (const filter of (ds.filters || [])) {
    const field = filter.field?.includes('.') ? filter.field.split('.').pop() : filter.field
    switch (filter.operator) {
      case 'equals': query = query.eq(field, filter.value); break
      case 'not_equals': query = query.neq(field, filter.value); break
      case 'less_than': query = query.lt(field, filter.value); break
      case 'greater_than': query = query.gt(field, filter.value); break
      case 'contains': query = query.ilike(field, `%${filter.value}%`); break
      case 'is_empty': query = query.is(field, null); break
      case 'is_not_empty': query = query.not(field, 'is', null); break
      case 'is_unknown': query = query.eq(field, 'Unknown'); break
      case 'in_list': query = query.in(field, Array.isArray(filter.value) ? filter.value : [filter.value]); break
      case 'not_in': query = query.not(field, 'in', `(${(Array.isArray(filter.value) ? filter.value : [filter.value]).join(',')})`); break
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
 * Resolve a field value from a row, handling joined tables
 */
export function resolveField(row, fieldConfig) {
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
