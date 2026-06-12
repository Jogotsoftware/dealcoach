import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { inputStyle } from './Shared'
import ProvenanceChip from './ProvenanceChip'

// One discovery field: label, an always-visible input you can just type into
// (multi-line for text so bullet answers work), a provenance chip, and an N/A
// toggle. Editing writes a manual value and locks it (the permanent tier),
// logging to custom_field_value_history, routed to the field's canonical home
// via storage_target. No instructional help text — the question is the label.
const SIZING_COL = {
  entity_count: 'entity_count', total_users: 'full_users',
  reporting_readonly_users: 'view_only_users', bills_per_period: 'ap_invoices_monthly',
  fixed_asset_count: 'fixed_assets', warehouse_count: 'warehouse_count',
}

export default function FieldRow({ field, definition, dealId, orgId, onSaved, hasSuggestion, onSuggestionClick, editable = true }) {
  const { profile } = useAuth()
  const fieldKey = field?.field_key || definition?.field_key
  const label = field?.label || definition?.field_label || fieldKey
  const ftype = definition?.field_type || 'text'
  const value = field?.value_text
  const has = value !== null && value !== undefined && String(value).trim() !== ''
  const na = !!field?.not_applicable
  const verified = !!field?.verified
  const prov = field?.source && !na ? {
    source: field.source, quote: field.extraction_quote, speaker: field.extraction_speaker,
    conversation_id: field.source_conversation_id, observed_at: field.observed_at,
  } : null

  const [draft, setDraft] = useState(has ? String(value) : '')
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setDraft(has ? String(value) : '') }, [value, has])

  async function persist(patch) {
    const target = definition?.storage_target
    const now = new Date().toISOString()
    if (target && target.startsWith('deal_sizing.')) {
      const col = target.split('.')[1] || SIZING_COL[fieldKey] || fieldKey
      let { data: row } = await supabase.from('deal_sizing').select('id, sources').eq('deal_id', dealId).maybeSingle()
      if (!row) { const ins = await supabase.from('deal_sizing').insert({ deal_id: dealId }).select('id, sources').single(); row = ins.data }
      const sources = { ...(row.sources || {}), [col]: { source: 'manual', observed_at: now, changed_by: profile?.id } }
      const upd = patch.not_applicable ? {} : { [col]: ftype === 'number' ? Number(patch.value) : patch.value }
      const { error } = await supabase.from('deal_sizing').update({ ...upd, sources }).eq('id', row.id)
      if (error) throw error
      return
    }
    if (target && target.startsWith('deal_analysis.')) {
      const col = target.split('.')[1]
      const { data: da } = await supabase.from('deal_analysis').select('id').eq('deal_id', dealId).maybeSingle()
      if (da) { const { error } = await supabase.from('deal_analysis').update({ [col]: patch.not_applicable ? null : String(patch.value) }).eq('id', da.id); if (error) throw error }
      return
    }
    const { data: existing } = await supabase.from('custom_field_values')
      .select('id, value_text, value_number, value_boolean, value_json, source')
      .eq('entity_type', 'deal').eq('entity_id', dealId).eq('field_key', fieldKey).maybeSingle()
    const cols = patch.not_applicable
      ? { value_text: null, value_number: null, value_boolean: null, value_json: null, not_applicable: true }
      : ftype === 'number' ? { value_number: Number(patch.value), value_text: null, not_applicable: false }
        : ftype === 'boolean' ? { value_boolean: patch.value === 'true' || patch.value === 'Yes' || patch.value === 'yes', value_text: null, not_applicable: false }
          : ftype === 'multiselect' ? { value_json: String(patch.value).split('\n').map(s => s.replace(/^[-•]\s*/, '').trim()).filter(Boolean), value_text: null, not_applicable: false }
            : { value_text: patch.value, not_applicable: false }
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
          new_value_json: patch.not_applicable ? { value: 'N/A', source: 'manual' } : { value: patch.value, source: 'manual' },
          changed_by: profile?.id, change_source: 'manual', change_reason: patch.not_applicable ? 'Marked N/A' : 'Manual edit',
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

  async function save() {
    const raw = draft.trim()
    if (na) return
    if (raw === String(value ?? '').trim()) return
    setSaving(true); setErr(null)
    try { await persist({ value: raw }); setFlash(true); setTimeout(() => setFlash(false), 1200); onSaved?.() }
    catch (e) { console.error('[FieldRow] save', e); setErr(e?.message || 'Save failed') }
    finally { setSaving(false) }
  }

  async function toggleNA() {
    setSaving(true); setErr(null)
    try { await persist({ not_applicable: !na }); onSaved?.() }
    catch (e) { console.error('[FieldRow] toggleNA', e); setErr(e?.message || 'Save failed') }
    finally { setSaving(false) }
  }

  const highlight = has && !verified && !na
  return (
    <div style={{
      padding: '10px 14px', borderBottom: `1px solid ${T.borderLight}`,
      borderLeft: highlight ? `3px solid ${T.warning}` : '3px solid transparent',
      background: na ? T.surfaceAlt : highlight ? T.warning + '0a' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: na ? T.textMuted : T.text, flex: 1 }}>{label}</span>
        {prov && <ProvenanceChip dealId={dealId} provenance={prov} historyKey={{ entityId: dealId, fieldKey }} />}
        {has && !verified && !na && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning, textTransform: 'uppercase' }}>unconfirmed</span>}
        {flash && <span style={{ fontSize: 10, color: T.success, fontWeight: 700 }}>Saved</span>}
        {hasSuggestion && <button onClick={onSuggestionClick} title="Suggested update" style={{ width: 8, height: 8, padding: 0, borderRadius: 4, border: 'none', background: T.warning, cursor: 'pointer' }} />}
        {editable && (
          <button onClick={toggleNA} disabled={saving} title="Mark not applicable"
            style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', fontFamily: T.font,
              border: `1px solid ${na ? T.primary : T.border}`, background: na ? T.primaryLight : T.surface, color: na ? T.primary : T.textMuted }}>
            N/A
          </button>
        )}
      </div>
      {na ? (
        <div style={{ fontSize: 12, color: T.textMuted, fontStyle: 'italic' }}>Not applicable for this deal</div>
      ) : !editable ? (
        <div style={{ fontSize: 13, color: has ? T.text : T.textMuted, fontStyle: has ? 'normal' : 'italic', whiteSpace: 'pre-wrap' }}>{has ? String(value) : 'Unknown'}</div>
      ) : ftype === 'boolean' ? (
        <select value={draft} onChange={e => { setDraft(e.target.value); }} onBlur={save}
          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 160, background: T.surface }}>
          <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      ) : ftype === 'number' ? (
        <input type="number" value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder="—" style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 200, background: T.surface }} />
      ) : (
        <textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={save}
          rows={Math.min(6, Math.max(1, draft.split('\n').length))}
          placeholder="Type an answer — one bullet per line"
          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: '100%', minHeight: 32, resize: 'vertical', lineHeight: 1.5, background: T.surface, fontFamily: T.font }} />
      )}
      {err && <div style={{ fontSize: 10, color: T.error, marginTop: 2 }}>{err}</div>}
    </div>
  )
}
