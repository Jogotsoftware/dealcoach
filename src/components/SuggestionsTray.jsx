import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Badge, Button } from './Shared'
import ProvenanceChip from './ProvenanceChip'

// Per-deal "Suggested updates" tray: open value_update rows from the unified
// suggestions queue (manual-lock conflicts + drivers-summary refreshes).
// Accept = manual edit with the suggested value (locks the field again);
// Dismiss = logged; the same fact re-suggests only on new provenance.
export default function SuggestionsTray({ dealId, onChanged }) {
  const [suggestions, setSuggestions] = useState(null)
  const [busy, setBusy] = useState(null)
  const { profile } = useAuth()

  async function load() {
    try {
      const { data } = await supabase.from('field_suggestions')
        .select('*')
        .eq('deal_id', dealId).eq('suggestion_kind', 'value_update').eq('status', 'open')
        .order('created_at', { ascending: false })
      setSuggestions(data || [])
    } catch (e) { console.error('[SuggestionsTray] load:', e); setSuggestions([]) }
  }
  useEffect(() => { if (dealId) load() }, [dealId])

  async function accept(s) {
    setBusy(s.id)
    try {
      const value = s.suggested_value
      if (s.entity_table === 'deal_sizing' || (s.entity_table || '').startsWith('deal_sizing')) {
        const col = s.field_key === 'total_users' ? 'full_users'
          : s.field_key === 'reporting_readonly_users' ? 'view_only_users'
          : s.field_key === 'bills_per_period' ? 'ap_invoices_monthly'
          : s.field_key === 'fixed_asset_count' ? 'fixed_assets'
          : s.field_key
        const { data: sizing } = await supabase.from('deal_sizing').select('id, sources').eq('deal_id', dealId).maybeSingle()
        if (sizing) {
          const sources = { ...(sizing.sources || {}), [col]: { source: 'manual', observed_at: new Date().toISOString(), accepted_from_suggestion: s.id } }
          await supabase.from('deal_sizing').update({ [col]: Number(value), sources }).eq('id', sizing.id)
        }
      } else if (s.entity_table === 'deal_analysis') {
        const { data: da } = await supabase.from('deal_analysis').select('id').eq('deal_id', dealId).maybeSingle()
        if (da) await supabase.from('deal_analysis').update({ [s.field_key]: String(value) }).eq('id', da.id)
      } else {
        // custom_field_values: accept converts to a manual, locked value.
        const { data: existing } = await supabase.from('custom_field_values')
          .select('id, value_text, value_number, value_boolean, value_json, source')
          .eq('entity_type', 'deal').eq('entity_id', dealId).eq('field_key', s.field_key).maybeSingle()
        const cols = typeof value === 'number'
          ? { value_number: value, value_text: null }
          : typeof value === 'boolean'
            ? { value_boolean: value, value_text: null }
            : Array.isArray(value) ? { value_json: value, value_text: null } : { value_text: String(value) }
        if (existing) {
          await supabase.from('custom_field_values').update({
            ...cols, source: 'manual', is_manual_locked: true, changed_by: profile?.id,
            observed_at: new Date().toISOString(),
          }).eq('id', existing.id)
          try {
            await supabase.from('custom_field_value_history').insert({
              field_value_id: existing.id, org_id: s.org_id, entity_type: 'deal', entity_id: dealId,
              field_key: s.field_key,
              old_value_json: { value: existing.value_number ?? existing.value_boolean ?? existing.value_json ?? existing.value_text, source: existing.source },
              new_value_json: { value, source: 'manual' },
              changed_by: profile?.id, change_source: 'manual', change_reason: 'Accepted AI suggestion',
            })
          } catch (e) { console.error('history insert:', e) }
        }
      }
      await supabase.from('field_suggestions').update({ status: 'accepted', resolved_at: new Date().toISOString(), resolved_by: profile?.id }).eq('id', s.id)
      await load()
      if (onChanged) onChanged()
    } catch (e) {
      console.error('[SuggestionsTray] accept:', e)
      alert(`Accept failed: ${e?.message || e}`)
    } finally { setBusy(null) }
  }

  async function dismiss(s) {
    setBusy(s.id)
    try {
      await supabase.from('field_suggestions').update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: profile?.id }).eq('id', s.id)
      await load()
    } catch (e) { console.error('[SuggestionsTray] dismiss:', e) } finally { setBusy(null) }
  }

  if (!suggestions || suggestions.length === 0) return null
  const fmt = (v) => v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.warning}50`, borderLeft: `4px solid ${T.warning}`, borderRadius: 8, padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Suggested updates</span>
        <Badge color={T.warning}>{suggestions.length}</Badge>
        <span style={{ fontSize: 11, color: T.textSecondary }}>Newer information conflicts with manually entered values. Accepting locks the new value.</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {suggestions.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{s.field_key}</div>
              <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>
                <span style={{ textDecoration: 'line-through', opacity: 0.7 }}>{fmt(s.current_value)}</span>
                {' '}{'->'}{' '}
                <strong style={{ color: T.text }}>{fmt(s.suggested_value)}</strong>
              </div>
              {s.conflict_context && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{s.conflict_context}</div>}
            </div>
            <ProvenanceChip dealId={dealId} provenance={{ source: s.suggestion_source, ...(s.provenance || {}) }} />
            <Button primary disabled={busy === s.id} onClick={() => accept(s)} style={{ padding: '4px 12px', fontSize: 11 }}>Accept</Button>
            <Button disabled={busy === s.id} onClick={() => dismiss(s)} style={{ padding: '4px 12px', fontSize: 11 }}>Dismiss</Button>
          </div>
        ))}
      </div>
    </div>
  )
}
