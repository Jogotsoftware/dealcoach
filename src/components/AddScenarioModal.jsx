import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Button, inputStyle, labelStyle } from './Shared'

const SCENARIO_TYPES = [
  { key: 'sage_offer', label: 'Sage Offer' },
  { key: 'client_ask', label: 'Client Ask' },
  { key: 'competitor', label: 'Competitor' },
  { key: 'alternate', label: 'Alternate' },
]

// Deep-clones a quote into a new sibling under the same comparison_group_id.
// Mirrors the proven duplicate flow from QuotesList — keep them in sync if
// quotes ever grows new copyable columns.
export async function cloneQuoteAsScenario({
  sourceQuote, dealId, scenarioType, scenarioLabel, profileId, companyName,
}) {
  // 1. Resolve / create the comparison group, and stamp the source quote as
  //    the sage_offer baseline if it isn't part of a group yet.
  let groupId = sourceQuote.comparison_group_id
  if (!groupId) {
    groupId = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const sourcePatch = { comparison_group_id: groupId }
    if (!sourceQuote.scenario_type || sourceQuote.scenario_type === 'sage_offer') {
      sourcePatch.scenario_type = 'sage_offer'
    }
    if (!sourceQuote.scenario_label) {
      sourcePatch.scenario_label = companyName || sourceQuote.name || 'Sage Offer'
    }
    const { error: srcErr } = await supabase.from('quotes').update(sourcePatch).eq('id', sourceQuote.id)
    if (srcErr) throw srcErr
  }

  // 2. Insert the new sibling quote — copy every header column except the
  //    ones that should reset on a clone.
  const { data: newQuote, error: qErr } = await supabase.from('quotes').insert({
    org_id: sourceQuote.org_id,
    deal_id: dealId,
    name: `${sourceQuote.name} — ${scenarioLabel}`,
    version: (sourceQuote.version || 1) + 1,
    is_primary: false,
    status: 'draft',
    notes: sourceQuote.notes,
    contract_term_id: sourceQuote.contract_term_id,
    contract_start_date: sourceQuote.contract_start_date,
    free_months: sourceQuote.free_months,
    free_months_placement: sourceQuote.free_months_placement,
    billing_cadence: sourceQuote.billing_cadence,
    global_discount_pct: sourceQuote.global_discount_pct,
    signing_bonus_amount: sourceQuote.signing_bonus_amount,
    signing_bonus_months: sourceQuote.signing_bonus_months,
    scenario_type: scenarioType,
    scenario_label: scenarioLabel,
    comparison_group_id: groupId,
    created_by: profileId,
  }).select('*').single()
  if (qErr) throw qErr

  // 3. Clone subscription lines — two-pass so parent_line_id can be remapped.
  const { data: srcLines } = await supabase.from('quote_lines').select('*').eq('quote_id', sourceQuote.id).order('line_order')
  if (srcLines?.length) {
    const idMap = new Map()
    for (const ln of srcLines) {
      const { data: insLine } = await supabase.from('quote_lines').insert({
        quote_id: newQuote.id,
        product_id: ln.product_id,
        parent_line_id: null,
        line_order: ln.line_order,
        quantity: ln.quantity,
        unit_price: ln.unit_price,
        discount_pct: ln.discount_pct,
        extended: ln.extended,
        notes: ln.notes,
        custom_fields: ln.custom_fields || {},
        apply_global_discount: ln.apply_global_discount,
      }).select('id').single()
      if (insLine?.id) idMap.set(ln.id, insLine.id)
    }
    for (const ln of srcLines) {
      if (!ln.parent_line_id) continue
      const newId = idMap.get(ln.id)
      const newParentId = idMap.get(ln.parent_line_id)
      if (newId && newParentId) {
        await supabase.from('quote_lines').update({ parent_line_id: newParentId }).eq('id', newId)
      }
    }
  }

  // 4. Clone implementation items.
  const { data: srcImpl } = await supabase.from('quote_implementation_items').select('*').eq('quote_id', sourceQuote.id)
  if (srcImpl?.length) {
    await supabase.from('quote_implementation_items').insert(srcImpl.map(i => ({
      quote_id: newQuote.id,
      source: i.source,
      implementor_name: i.implementor_name,
      name: i.name,
      description: i.description,
      total_amount: i.total_amount,
      billing_type: i.billing_type,
      tm_weeks: i.tm_weeks,
      estimated_start_date: i.estimated_start_date,
      estimated_completion_date: i.estimated_completion_date,
      sort_order: i.sort_order,
      notes: i.notes,
    })))
  }

  // 5. Clone partner blocks + their lines.
  const { data: srcBlocks } = await supabase.from('quote_partner_blocks').select('*').eq('quote_id', sourceQuote.id)
  if (srcBlocks?.length) {
    for (const b of srcBlocks) {
      const { data: newBlock } = await supabase.from('quote_partner_blocks').insert({
        quote_id: newQuote.id,
        partner_name: b.partner_name,
        term_years: b.term_years,
        billing_cadence: b.billing_cadence,
        partner_global_discount_pct: b.partner_global_discount_pct,
        notes: b.notes,
        sort_order: b.sort_order,
      }).select('id').single()
      if (!newBlock?.id) continue
      const { data: srcPartnerLines } = await supabase.from('quote_partner_lines').select('*').eq('block_id', b.id)
      if (srcPartnerLines?.length) {
        await supabase.from('quote_partner_lines').insert(srcPartnerLines.map(l => ({
          quote_id: newQuote.id,
          block_id: newBlock.id,
          sku: l.sku,
          name: l.name,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          discount_pct: l.discount_pct,
          extended: l.extended,
          sort_order: l.sort_order,
          notes: l.notes,
        })))
      }
    }
  }

  // 6. Recompute totals on the new sibling. Non-fatal — the quote is usable
  //    even if a recompute hiccups, the user can re-save to retry.
  try { await supabase.rpc('compute_quote', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_quote on clone failed:', e) }
  try { await supabase.rpc('compute_partner_lines', { p_quote_id: newQuote.id }) } catch (e) { console.warn('compute_partner_lines on clone failed:', e) }
  try { await supabase.rpc('recompute_quote_totals', { p_quote_id: newQuote.id }) } catch (e) { console.warn('recompute_quote_totals on clone failed:', e) }

  return { newQuoteId: newQuote.id, comparisonGroupId: groupId }
}

export default function AddScenarioModal({ sourceQuote, dealId, companyName, profileId, onClose, onCreated }) {
  const [scenarioType, setScenarioType] = useState('client_ask')
  const [scenarioLabel, setScenarioLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleCreate() {
    const trimmed = scenarioLabel.trim()
    if (!trimmed) { setError('Scenario label is required'); return }
    setBusy(true)
    setError('')
    try {
      const result = await cloneQuoteAsScenario({
        sourceQuote, dealId, scenarioType, scenarioLabel: trimmed, profileId, companyName,
      })
      onCreated?.(result)
    } catch (e) {
      console.error('[AddScenarioModal] create failed:', e)
      setError(e?.message || 'Failed to create scenario')
      setBusy(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
      onClick={() => { if (!busy) onClose?.() }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, width: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}
      >
        <div style={{ padding: '18px 22px', borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Add Comparison Scenario</div>
          <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>Clones this quote into a new sibling so you can edit the numbers side-by-side.</div>
        </div>
        <div style={{ padding: '16px 22px' }}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Scenario type *</label>
            <select
              style={{ ...inputStyle, cursor: 'pointer' }}
              value={scenarioType}
              onChange={e => setScenarioType(e.target.value)}
              disabled={busy}
            >
              {SCENARIO_TYPES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Scenario label *</label>
            <input
              autoFocus
              style={inputStyle}
              value={scenarioLabel}
              placeholder="e.g. Keith's Ask, NetSuite Bid"
              onChange={e => setScenarioLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !busy) handleCreate() }}
              disabled={busy}
            />
          </div>
          {error && (
            <div style={{ padding: '8px 12px', background: T.errorLight, color: T.error, fontSize: 12, borderRadius: 4, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button onClick={() => { if (!busy) onClose?.() }} disabled={busy}>Cancel</Button>
            <Button primary onClick={handleCreate} disabled={busy || !scenarioLabel.trim()}>
              {busy ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
