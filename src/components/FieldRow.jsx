import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { inputStyle } from './Shared'
import ProvenanceChip from './ProvenanceChip'

// One discovery field: label + value + provenance chip + unverified highlight
// + inline manual edit + suggestion dot. Editing writes a manual value and
// sets is_manual_locked (the permanent tier), logging to
// custom_field_value_history. Routes the write to the field's canonical home
// via definition.storage_target — same routing as the extraction engine.
//
// props: field (deal_field_values_flat row), definition (custom_field_definitions
// row), dealId, orgId, onSaved, hasSuggestion, onSuggestionClick, editable
const SIZING_COL = {
  entity_count: 'entity_count', total_users: 'full_users',
  reporting_readonly_users: 'view_only_users', bills_per_period: 'ap_invoices_monthly',
  fixed_asset_count: 'fixed_assets', warehouse_count: 'warehouse_count',
}

export default function FieldRow({ field, definition, dealId, orgId, onSaved, hasSuggestion, onSuggestionClick, editable = true }) {
  const { profile } = useAuth()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const fieldKey = field?.field_key || definition?.field_key
  const label = field?.label || definition?.field_label || fieldKey
  const ftype = definition?.field_type || 'text'
  const value = field?.value_text
  const has = value !== null && value !== undefined && String(value).trim() !== ''
  const verified = !!field?.verified
  const help = definition?.ai_context || (definition?.extraction_instructions || '').split('\n')[0] || ''
  const prov = field?.source ? {
    source: field.source, quote: field.extraction_quote, speaker: field.extraction_speaker,
    conversation_id: field.source_conversation_id, observed_at: field.observed_at,
  } : null

  async function save() {
    const raw = draft.trim()
    if (raw === '' || raw === String(value ?? '')) { setEditing(false); return }
    setSaving(true); setErr(null)
    try {
      const target = definition?.storage_target
      const now = new Date().toISOString()
      if (target && target.startsWith('deal_sizing.')) {
        const col = target.split('.')[1] || SIZING_COL[fieldKey] || fieldKey
        const num = Number(raw)
        if (!isFinite(num)) throw new Error('Enter a number')
        let { data: row } = await supabase.from('deal_sizing').select('id, sources').eq('deal_id', dealId).maybeSingle()
        if (!row) { const ins = await supabase.from('deal_sizing').insert({ deal_id: dealId }).select('id, sources').single(); row = ins.data }
        const sources = { ...(row.sources || {}), [col]: { source: 'manual', observed_at: now, changed_by: profile?.id } }
        const { error } = await supabase.from('deal_sizing').update({ [col]: num, sources }).eq('id', row.id)
        if (error) throw error
      } else if (target && target.startsWith('deal_analysis.')) {
        const col = target.split('.')[1]
        const { data: da } = await supabase.from('deal_analysis').select('id').eq('deal_id', dealId).maybeSingle()
        if (da) { const { error } = await supabase.from('deal_analysis').update({ [col]: raw }).eq('id', da.id); if (error) throw error }
      } else {
        const { data: existing } = await supabase.from('custom_field_values')
          .select('id, value_text, value_number, value_boolean, value_json, source')
          .eq('entity_type', 'deal').eq('entity_id', dealId).eq('field_key', fieldKey).maybeSingle()
        const cols = ftype === 'number' ? { value_number: Number(raw), value_text: null }
          : ftype === 'boolean' ? { value_boolean: raw === 'true' || raw === 'Yes' || raw === 'yes', value_text: null }
          : ftype === 'multiselect' ? { value_json: raw.split(',').map(s => s.trim()).filter(Boolean), value_text: null }
          : { value_text: raw }
        if (existing) {
          const { error } = await supabase.from('custom_field_values').update({
            ...cols, source: 'manual', is_manual_locked: true, changed_by: profile?.id, observed_at: now,
            previous_value_json: { value: existing.value_number ?? existing.value_boolean ?? existing.value_json ?? existing.value_text, source: existing.source },
          }).eq('id', existing.id)
          if (error) throw error
          try {
            await supabase.from('custom_field_value_history').insert({
              field_value_id: existing.id, org_id: orgId, entity_type: 'deal', entity_id: dealId, field_key: fieldKey,
              old_value_json: { value: existing.value_number ?? existing.value_boolean ?? existing.value_json ?? existing.value_text, source: existing.source },
              new_value_json: { value: raw, source: 'manual' }, changed_by: profile?.id, change_source: 'manual', change_reason: 'Manual edit',
            })
          } catch (e) { console.error('history', e) }
        } else {
          const { error } = await supabase.from('custom_field_values').insert({
            org_id: orgId, field_definition_id: definition?.id || null, entity_type: 'deal', entity_id: dealId,
            field_key: fieldKey, ...cols, source: 'manual', is_manual_locked: true, changed_by: profile?.id, observed_at: now,
          })
          if (error) throw error
        }
      }
      setEditing(false)
      onSaved?.()
    } catch (e) {
      console.error('[FieldRow] save', e); setErr(e?.message || 'Save failed')
    } finally { setSaving(false) }
  }

  const highlight = has && !verified
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 10, padding: '9px 12px',
      borderBottom: `1px solid ${T.borderLight}`,
      borderLeft: highlight ? `3px solid ${T.warning}` : '3px solid transparent',
      background: highlight ? T.warning + '0c' : 'transparent',
    }}>
      <div style={{ flex: '0 0 42%', minWidth: 220 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>
          {label}
          {hasSuggestion && (
            <button onClick={onSuggestionClick} title="An AI update is suggested for this field"
              aria-label="Suggested update available"
              style={{ marginLeft: 6, width: 8, height: 8, padding: 0, borderRadius: 4, border: 'none', background: T.warning, cursor: onSuggestionClick ? 'pointer' : 'default', verticalAlign: 'middle' }} />
          )}
        </div>
        {help && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 1, lineHeight: 1.4 }}>{help}</div>}
      </div>
      <div style={{ flex: 1, minWidth: 200 }}>
        {editing ? (
          <div>
            {ftype === 'boolean' ? (
              <select autoFocus value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
                style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, width: 130 }}>
                <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
              </select>
            ) : (
              <input autoFocus type={ftype === 'number' ? 'number' : 'text'} value={draft}
                onChange={e => setDraft(e.target.value)} onBlur={save}
                onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
                placeholder="Type a value to set it manually"
                style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} />
            )}
            {err && <div style={{ fontSize: 10, color: T.error, marginTop: 2 }}>{err}</div>}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span
              onClick={editable ? () => { setDraft(has ? String(value) : ''); setEditing(true) } : undefined}
              style={{ fontSize: 13, color: has ? T.text : T.textMuted, fontStyle: has ? 'normal' : 'italic', cursor: editable ? 'text' : 'default' }}
              title={editable ? 'Click to edit' : undefined}>
              {has ? String(value) : 'Unknown'}
            </span>
            {prov && <ProvenanceChip dealId={dealId} provenance={prov} historyKey={{ entityId: dealId, fieldKey }} />}
            {has && !verified && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning, textTransform: 'uppercase', letterSpacing: '0.03em' }}>unconfirmed</span>}
            {saving && <span style={{ fontSize: 10, color: T.textMuted }}>saving…</span>}
          </div>
        )}
      </div>
    </div>
  )
}
