// Reports v2 — formatter, auto-suggest, and tokenized formula evaluator.
//
// Calculated column tokens shape:
//   { type: 'field',   table: 'deals',         column: 'deal_value' }
//   { type: 'op',      value: '+' | '-' | '*' | '/' }
//   { type: 'paren',   value: '(' | ')' }
//   { type: 'literal', value: 12.5 }

// ── Format types ────────────────────────────────────────────────────────────
export const FORMAT_TYPES = ['number', 'decimal', 'currency', 'percentage', 'integer', 'abbreviated', 'custom', 'text']
export const NEGATIVE_STYLES = ['minus', 'parens', 'red']

const CURRENCY_LOCALES = {
  USD: 'en-US', EUR: 'de-DE', GBP: 'en-GB', AUD: 'en-AU', CAD: 'en-CA', JPY: 'ja-JP',
}

function applyNegativeStyle(formatted, value, style) {
  if (style === 'parens' && value < 0) {
    return `(${formatted.replace(/^-/, '')})`
  }
  return formatted
}

// Format a value per a format config. Always returns a string.
// `format` shape: { type, precision?, currency_code?, negative_style?, prefix?, suffix?, percentage_already_pct? }
export function formatValue(value, format) {
  if (value == null || value === '') return ''
  const type = format?.type || 'text'
  if (type === 'text') return String(value)

  const num = Number(value)
  if (!Number.isFinite(num)) return String(value)

  const negStyle = format?.negative_style || 'minus'
  const precision = Number.isFinite(format?.precision) ? format.precision : 2
  let formatted

  switch (type) {
    case 'integer':
      formatted = Math.round(num).toLocaleString('en-US')
      break
    case 'number':
      formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
      break
    case 'decimal':
      formatted = num.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })
      break
    case 'currency': {
      const code = format?.currency_code || 'USD'
      const locale = CURRENCY_LOCALES[code] || 'en-US'
      formatted = num.toLocaleString(locale, { style: 'currency', currency: code, minimumFractionDigits: precision, maximumFractionDigits: precision })
      break
    }
    case 'percentage': {
      const v = format?.percentage_already_pct ? num : num * 100
      formatted = `${v.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision })}%`
      break
    }
    case 'abbreviated': {
      const abs = Math.abs(num)
      const sign = num < 0 ? '-' : ''
      let body
      if (abs >= 1e9) body = `${(abs / 1e9).toFixed(precision)}B`
      else if (abs >= 1e6) body = `${(abs / 1e6).toFixed(precision)}M`
      else if (abs >= 1e3) body = `${(abs / 1e3).toFixed(precision)}K`
      else body = abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision })
      const cur = format?.currency_code
      const curSym = cur === 'USD' ? '$' : cur === 'EUR' ? '€' : cur === 'GBP' ? '£' : cur === 'JPY' ? '¥' : ''
      formatted = `${sign}${curSym}${body}`
      break
    }
    case 'custom':
      formatted = num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: precision || 2 })
      break
    default:
      formatted = String(value)
  }

  formatted = applyNegativeStyle(formatted, num, negStyle)
  return `${format?.prefix || ''}${formatted}${format?.suffix || ''}`
}

// CSS color override for negative numbers when negative_style === 'red'.
export function negativeColor(value, format) {
  return format?.negative_style === 'red' && Number(value) < 0 ? '#dc2626' : null
}

// ── Auto-suggest format from field key + meta ────────────────────────────────
// Returns a default format config based on the field name pattern.
export function inferFormat(fieldKey, meta) {
  const key = String(fieldKey || '').toLowerCase()
  const t = meta?.type

  // Date columns — let existing date renderer handle them
  if (t === 'date') return null

  if (t === 'currency' || /(_amount|_value|cmrr|sage_total|annual_cost|deal_value)$/.test(key) || /^(deal_value|cmrr|annual_cost)$/.test(key)) {
    return { type: 'currency', precision: 2, currency_code: 'USD', negative_style: 'minus' }
  }
  if (t === 'percentage' || /(_pct|_percentage)$/.test(key) || /discount_pct$/.test(key)) {
    return { type: 'percentage', precision: 2, percentage_already_pct: true }
  }
  if (/(_count|count$|^count_|quantity)/.test(key)) {
    return { type: 'integer' }
  }
  if (/_days$|days$|deal_age_days/.test(key)) {
    return { type: 'custom', precision: 0, suffix: ' days' }
  }
  if (/score$|_score$/.test(key) || t === 'score') {
    return { type: 'integer' }
  }
  if (t === 'number') return { type: 'number' }
  return null
}

// ── Tokenized formula validation + evaluation ────────────────────────────────
// Token sequence is valid if it's a valid expression in this grammar:
//   expr   := term ((+|-) term)*
//   term   := factor ((*|/) factor)*
//   factor := number | field | '(' expr ')'

// Validate a token array. Returns { ok: true } or { ok: false, error: string }.
export function validateTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return { ok: false, error: 'Empty formula.' }
  // Balance check
  let depth = 0
  for (const t of tokens) {
    if (t.type === 'paren' && t.value === '(') depth++
    else if (t.type === 'paren' && t.value === ')') depth--
    if (depth < 0) return { ok: false, error: 'Unbalanced parentheses.' }
  }
  if (depth !== 0) return { ok: false, error: 'Unbalanced parentheses.' }

  try {
    const parser = new Parser(tokens)
    parser.parseExpr()
    if (parser.pos !== tokens.length) return { ok: false, error: 'Unexpected trailing tokens.' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message || 'Invalid formula.' }
  }
}

// Evaluate tokens against a row. Returns a number or null.
// `getFieldValue(table, column, row)` resolves a field token. Defaults to direct row lookup.
export function evalTokens(tokens, row, getFieldValue = defaultFieldResolver) {
  if (!Array.isArray(tokens) || !tokens.length) return null
  try {
    const parser = new Parser(tokens, row, getFieldValue)
    const v = parser.parseExpr()
    if (parser.pos !== tokens.length) return null
    return Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function defaultFieldResolver(table, column, row) {
  if (!row) return null
  // Direct top-level column
  if (table == null || row[column] !== undefined) return row[column]
  const joined = row[table]
  if (Array.isArray(joined)) return joined[0]?.[column]
  if (joined && typeof joined === 'object') return joined[column]
  return row[column]
}

// Recursive-descent parser. No eval(), no Function() — pure structured walk.
class Parser {
  constructor(tokens, row = null, resolver = defaultFieldResolver) {
    this.tokens = tokens
    this.pos = 0
    this.row = row
    this.resolver = resolver
    this.evaluating = row !== null
  }
  peek() { return this.tokens[this.pos] }
  eat() { return this.tokens[this.pos++] }
  isOp(t, ops) { return t && t.type === 'op' && ops.includes(t.value) }

  parseExpr() {
    let left = this.parseTerm()
    while (this.isOp(this.peek(), ['+', '-'])) {
      const op = this.eat().value
      const right = this.parseTerm()
      if (this.evaluating) {
        const a = Number(left), b = Number(right)
        left = op === '+' ? a + b : a - b
      }
    }
    return left
  }

  parseTerm() {
    let left = this.parseFactor()
    while (this.isOp(this.peek(), ['*', '/'])) {
      const op = this.eat().value
      const right = this.parseFactor()
      if (this.evaluating) {
        const a = Number(left), b = Number(right)
        if (op === '/') {
          if (!Number.isFinite(b) || b === 0) return null  // division by zero → null
          left = a / b
        } else {
          left = a * b
        }
      }
    }
    return left
  }

  parseFactor() {
    const t = this.peek()
    if (!t) throw new Error('Unexpected end of formula.')
    if (t.type === 'paren' && t.value === '(') {
      this.eat()
      const v = this.parseExpr()
      const close = this.eat()
      if (!close || close.type !== 'paren' || close.value !== ')') throw new Error('Missing ).')
      return v
    }
    if (t.type === 'literal') {
      this.eat()
      return Number(t.value)
    }
    if (t.type === 'field') {
      this.eat()
      if (!this.evaluating) return 0
      const v = this.resolver(t.table, t.column, this.row)
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    throw new Error(`Unexpected token: ${t.type === 'op' ? t.value : t.type}`)
  }
}

// ── Token chip color (matches field-tree color coding) ───────────────────────
const TABLE_CHIP_COLOR = {
  deals: '#5DADE2',
  contacts: '#27ae60',
  tasks: '#e67e22',
  conversations: '#8b5cf6',
  company_profile: '#0ea5e9',
  deal_analysis: '#10b981',
  deal_pain_points: '#dc2626',
  deal_competitors: '#f97316',
  deal_sizing: '#0891b2',
  msp_stages: '#7c3aed',
  compelling_events: '#f59e0b',
  business_catalysts: '#06b6d4',
  deal_flags: '#ef4444',
  deal_risks: '#dc2626',
  company_systems: '#64748b',
}
export function tokenChipColor(token) {
  if (token?.type === 'field') return TABLE_CHIP_COLOR[token.table] || '#6c757d'
  if (token?.type === 'literal') return '#94a3b8'
  if (token?.type === 'op') return '#475569'
  if (token?.type === 'paren') return '#475569'
  return '#6c757d'
}

export function tokenChipLabel(token) {
  if (token?.type === 'field') return token.column
  if (token?.type === 'literal') return String(token.value)
  if (token?.type === 'op') {
    return token.value === '*' ? '×' : token.value === '/' ? '÷' : token.value
  }
  if (token?.type === 'paren') return token.value
  return '?'
}
