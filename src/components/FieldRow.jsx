import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { inputStyle } from './Shared'
import ProvenanceChip from './ProvenanceChip'

// One discovery field: label, an answer input, a provenance chip, and an N/A
// toggle. Text answers are a pill input — type, press Enter, it becomes a
// removable pill (one bullet per pill). Numbers/booleans use a plain input.
// Editing writes a manual, locked value (the permanent tier), logged to
// history and routed to the field's canonical home via storage_target. No
// instructional help text.
const SIZING_COL = {
  entity_count: 'entity_count', total_users: 'full_users',
  reporting_readonly_users: 'view_only_users', bills_per_period: 'ap_invoices_monthly',
  fixed_asset_count: 'fixed_assets', warehouse_count: 'warehouse_count',
}

function parsePills(raw) {
  if (raw === null || raw === undefined) return []
  if (Array.isArray(raw)) return raw.map(String)
  const s = String(raw).trim()
  if (!s) return []
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String) } catch (_) { /* fall through */ } }
  return s.split(/\n|;/).map(x => x.replace(/^[-•]\s*/, '').trim()).filter(Boolean)
}

export default function FieldRow({ field, definition, dealId, orgId, onSaved, suggestion, editable = true }) {
  const { profile } = useAuth()
  const fieldKey = field?.field_key || definition?.field_key
  const label = field?.label || definition?.field_label || fieldKey
  const ftype = definition?.field_type || 'text'
  const value = field?.value_text
  const has = value !== null && value !== undefined && String(value).trim() !== ''
  const na = !!field?.not_applicable
  const verified = !!field?.verified
  const isPills = ftype !== 'number' && ftype !== 'boolean'
  const prov = field?.source && !na ? {
    source: field.source, quote: field.extraction_quote, speaker: field.extraction_speaker,
    conversation_id: field.source_conversation_id, observed_at: field.observed_at,
  } : null

  const [pills, setPills] = useState(() => parsePills(value))
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState(has ? String(value) : '')   // number/boolean
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState(false)
  const [err, setErr] = useState(null)
  useEffect(() => { setPills(parsePills(value)); setDraft(has ? String(value) : '') }, [value, has])

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
          : ftype === 'multiselect' ? { value_json: patch.pills || [], value_text: null, not_applicable: false }
            : { value_text: (patch.pills || []).join('\n'), value_json: null, not_applicable: false }
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
          new_value_json: patch.not_applicable ? { value: 'N/A' } : { value: patch.pills || patch.value },
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

  async function savePatch(patch) {
    setSaving(true); setErr(null)
    try { await persist(patch); setFlash(true); setTimeout(() => setFlash(false), 1000); onSaved?.() }
    catch (e) { console.error('[FieldRow] save', e); setErr(e?.message || 'Save failed') }
    finally { setSaving(false) }
  }

  function commitPills(next) { setPills(next); savePatch({ pills: next }) }
  function addPill() {
    const v = input.trim()
    if (!v) return
    const next = [...pills, v]
    setInput('')
    commitPills(next)
  }
  function removePill(i) { commitPills(pills.filter((_, idx) => idx !== i)) }

  async function saveScalar() {
    const raw = draft.trim()
    if (raw === String(value ?? '').trim()) return
    savePatch({ value: raw })
  }
  async function toggleNA() { savePatch({ not_applicable: !na }) }

  async function acceptSuggestion() {
    if (!suggestion) return
    const sv = suggestion.suggested_value
    const asPills = parsePills(sv)
    setSaving(true); setErr(null)
    try {
      if (isPills) await persist({ pills: asPills })
      else await persist({ value: Array.isArray(sv) ? asPills.join(', ') : String(sv) })
      await supabase.from('field_suggestions').update({ status: 'accepted', resolved_at: new Date().toISOString() }).eq('id', suggestion.id)
      onSaved?.()
    } catch (e) { console.error('[FieldRow] acceptSuggestion', e); setErr(e?.message || 'Failed') }
    finally { setSaving(false) }
  }
  async function dismissSuggestion() {
    if (!suggestion) return
    try { await supabase.from('field_suggestions').update({ status: 'dismissed', resolved_at: new Date().toISOString() }).eq('id', suggestion.id); onSaved?.() }
    catch (e) { console.error('[FieldRow] dismissSuggestion', e) }
  }
  const suggDisplay = suggestion ? (Array.isArray(suggestion.suggested_value) ? suggestion.suggested_value.join(', ') : String(suggestion.suggested_value ?? '')) : ''

  const highlight = pills.length > 0 && !verified && !na
  return (
    <div style={{
      padding: '10px 14px', borderBottom: `1px solid ${T.borderLight}`,
      borderLeft: highlight ? `3px solid ${T.warning}` : '3px solid transparent',
      background: na ? T.surfaceAlt : highlight ? T.warning + '0a' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: na ? T.textMuted : T.text, flex: 1 }}>{label}</span>
        {prov && <ProvenanceChip dealId={dealId} provenance={prov} historyKey={{ entityId: dealId, fieldKey }} />}
        {pills.length > 0 && !verified && !na && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning, textTransform: 'uppercase' }}>unconfirmed</span>}
        {flash && <span style={{ fontSize: 10, color: T.success, fontWeight: 700 }}>Saved</span>}
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
        pills.length ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {pills.map((p, i) => <span key={i} style={readPill}>{p}</span>)}
          </div>
        ) : <div style={{ fontSize: 13, color: T.textMuted, fontStyle: 'italic' }}>Unknown</div>
      ) : ftype === 'boolean' ? (
        <select value={draft} onChange={e => setDraft(e.target.value)} onBlur={saveScalar}
          style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 160, background: T.surface }}>
          <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
        </select>
      ) : ftype === 'number' ? (
        <input type="number" value={draft} onChange={e => setDraft(e.target.value)} onBlur={saveScalar}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          placeholder="—" style={{ ...inputStyle, padding: '6px 8px', fontSize: 13, width: 200, background: T.surface }} />
      ) : (
        // Pill input — Enter turns the text into a pill.
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, padding: '6px 8px', minHeight: 36, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface }}
          onClick={e => e.currentTarget.querySelector('input')?.focus()}>
          {pills.map((p, i) => (
            <span key={i} style={editPill}>
              {p}
              <button onClick={() => removePill(i)} title="Remove" style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: 0, marginLeft: 2 }}>×</button>
            </span>
          ))}
          <input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); addPill() }
              else if (e.key === 'Backspace' && !input && pills.length) removePill(pills.length - 1)
            }}
            onBlur={addPill}
            placeholder={pills.length ? 'Add another…' : 'Type an answer and press Enter'}
            style={{ flex: 1, minWidth: 140, border: 'none', outline: 'none', fontSize: 13, fontFamily: T.font, background: 'transparent', color: T.text }} />
        </div>
      )}
      {suggestion && !na && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, padding: '6px 10px', borderRadius: 6, background: T.warning + '12', border: `1px solid ${T.warning}40` }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: T.warning, textTransform: 'uppercase', letterSpacing: '0.03em', flexShrink: 0 }}>Suggested</span>
          <span style={{ flex: 1, fontSize: 12, color: T.text }}>{suggDisplay}</span>
          <button onClick={acceptSuggestion} disabled={saving} style={{ fontSize: 11, fontWeight: 700, padding: '2px 10px', borderRadius: 5, border: 'none', background: T.primary, color: '#fff', cursor: 'pointer', fontFamily: T.font }}>Accept</button>
          <button onClick={dismissSuggestion} disabled={saving} style={{ fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>Dismiss</button>
        </div>
      )}
      {err && <div style={{ fontSize: 10, color: T.error, marginTop: 2 }}>{err}</div>}
    </div>
  )
}

const editPill = {
  display: 'inline-flex', alignItems: 'center', gap: 2, padding: '2px 4px 2px 9px', borderRadius: 14,
  background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, color: T.text, fontSize: 12,
}
const readPill = {
  display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 14,
  background: T.surfaceAlt, border: `1px solid ${T.borderLight}`, color: T.text, fontSize: 12,
}
