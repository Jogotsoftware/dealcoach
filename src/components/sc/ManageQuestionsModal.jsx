import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Button, Spinner, inputStyle, labelStyle } from '../Shared'

// SC-curated discovery questions. Custom questions are org-scoped
// custom_field_definitions (layer='custom') that become the org's standard
// discovery on every deal — the library that grows over time. Platform
// questions (the locked 93) can't be edited but can be hidden per-org via
// org_hidden_fields.
const TYPES = [['text', 'Text'], ['number', 'Number'], ['boolean', 'Yes/No'], ['multiselect', 'List']]
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)

export default function ManageQuestionsModal({ deal, sections, onClose, onChanged }) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [custom, setCustom] = useState([])      // org custom definitions
  const [platform, setPlatform] = useState([])  // template definitions (read-only)
  const [hidden, setHidden] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ field_label: '', display_section: sections?.[0] || 'Custom', field_type: 'text', newSection: '' })
  const [editId, setEditId] = useState(null)

  useEffect(() => { load() }, [deal?.id])
  async function load() {
    setLoading(true)
    try {
      const [defs, hid] = await Promise.all([
        supabase.from('custom_field_definitions').select('id, org_id, field_key, field_label, field_type, display_section, layer, is_locked, is_active')
          .eq('entity_type', 'deal').or(`org_id.eq.${deal.org_id},org_id.is.null`).order('display_section').order('sort_order'),
        supabase.from('org_hidden_fields').select('field_key').eq('org_id', deal.org_id),
      ])
      const all = defs.data || []
      setCustom(all.filter(d => d.org_id === deal.org_id))
      setPlatform(all.filter(d => d.org_id === null && d.is_active))
      setHidden(new Set((hid.data || []).map(h => h.field_key)))
    } catch (e) { console.error('[ManageQuestions] load', e) } finally { setLoading(false) }
  }

  async function saveQuestion() {
    const label = form.field_label.trim()
    if (!label) return
    const section = (form.newSection.trim() || form.display_section || 'Custom')
    setBusy(true)
    try {
      if (editId) {
        await supabase.from('custom_field_definitions').update({ field_label: label, display_section: section, field_type: form.field_type, admin_description: label }).eq('id', editId)
      } else {
        const key = `custom_${slug(label)}_${Math.random().toString(36).slice(2, 6)}`
        await supabase.from('custom_field_definitions').insert({
          org_id: deal.org_id, entity_type: 'deal', field_key: key, field_label: label, admin_description: label,
          field_type: form.field_type, display_section: section, layer: 'custom', is_active: true, sort_order: 9000, created_by: profile?.id,
        })
      }
      setForm({ field_label: '', display_section: sections?.[0] || 'Custom', field_type: 'text', newSection: '' }); setEditId(null)
      await load(); onChanged?.()
    } catch (e) { console.error('[ManageQuestions] save', e); alert(`Could not save: ${e?.message || e}`) }
    finally { setBusy(false) }
  }

  async function deleteCustom(id) {
    setBusy(true)
    try { await supabase.from('custom_field_definitions').delete().eq('id', id); await load(); onChanged?.() }
    catch (e) { console.error('[ManageQuestions] delete', e); alert(`Could not delete: ${e?.message || e}`) }
    finally { setBusy(false) }
  }

  async function toggleHidden(fieldKey, hide) {
    setHidden(s => { const n = new Set(s); hide ? n.add(fieldKey) : n.delete(fieldKey); return n })
    try {
      if (hide) await supabase.from('org_hidden_fields').upsert({ org_id: deal.org_id, field_key: fieldKey, hidden_by: profile?.id }, { onConflict: 'org_id,field_key' })
      else await supabase.from('org_hidden_fields').delete().eq('org_id', deal.org_id).eq('field_key', fieldKey)
      onChanged?.()
    } catch (e) { console.error('[ManageQuestions] toggleHidden', e) }
  }

  const platBySection = platform.reduce((m, d) => { (m[d.display_section || 'Other'] ||= []).push(d); return m }, {})

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, width: 680, maxWidth: '94vw', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: `1px solid ${T.border}` }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${T.borderLight}` }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text, flex: 1 }}>Manage discovery questions</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, color: T.textMuted, cursor: 'pointer' }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>
          {loading ? <Spinner /> : (
            <>
              {/* Add / edit */}
              <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>{editId ? 'Edit question' : 'Add a question'}</div>
                <textarea value={form.field_label} onChange={e => setForm(p => ({ ...p, field_label: e.target.value }))} rows={2} placeholder="The question, e.g. “How do they handle intercompany eliminations today?”"
                  style={{ ...inputStyle, fontSize: 13, resize: 'vertical', fontFamily: T.font, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <label style={labelStyle}>Section</label>
                    <select value={form.display_section} onChange={e => setForm(p => ({ ...p, display_section: e.target.value }))} style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', cursor: 'pointer' }}>
                      {(sections || []).map(s => <option key={s} value={s}>{s}</option>)}
                      <option value="Custom">Custom</option>
                    </select>
                  </div>
                  <div style={{ flex: 1, minWidth: 120 }}>
                    <label style={labelStyle}>Or new section</label>
                    <input value={form.newSection} onChange={e => setForm(p => ({ ...p, newSection: e.target.value }))} placeholder="optional" style={{ ...inputStyle, fontSize: 12, padding: '6px 8px' }} />
                  </div>
                  <div style={{ minWidth: 110 }}>
                    <label style={labelStyle}>Answer type</label>
                    <select value={form.field_type} onChange={e => setForm(p => ({ ...p, field_type: e.target.value }))} style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', cursor: 'pointer' }}>
                      {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                  <Button primary disabled={!form.field_label.trim() || busy} onClick={saveQuestion}>{editId ? 'Save' : 'Add'}</Button>
                  {editId && <Button onClick={() => { setEditId(null); setForm({ field_label: '', display_section: sections?.[0] || 'Custom', field_type: 'text', newSection: '' }) }}>Cancel</Button>}
                </div>
              </div>

              {/* Custom questions (the library) */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Your questions ({custom.length})</div>
              {custom.length === 0 ? <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>None yet. Anything you add becomes standard on every deal.</div> : (
                <div style={{ marginBottom: 18 }}>
                  {custom.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 4px', borderBottom: `1px solid ${T.borderLight}` }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, color: T.text }}>{d.field_label}</div>
                        <div style={{ fontSize: 10, color: T.textMuted }}>{d.display_section} · {d.field_type}</div>
                      </div>
                      <button onClick={() => { setEditId(d.id); setForm({ field_label: d.field_label, display_section: d.display_section || 'Custom', field_type: d.field_type, newSection: '' }) }}
                        style={{ background: 'none', border: 'none', color: T.primary, fontSize: 12, cursor: 'pointer', fontFamily: T.font }}>Edit</button>
                      <button onClick={() => deleteCustom(d.id)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 15, cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Platform questions — hide/show */}
              <div style={{ fontSize: 12, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Standard questions</div>
              {Object.entries(platBySection).map(([sec, list]) => (
                <div key={sec} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.text, marginBottom: 4 }}>{sec}</div>
                  {list.map(d => {
                    const isHidden = hidden.has(d.field_key)
                    return (
                      <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', opacity: isHidden ? 0.5 : 1 }}>
                        <span style={{ flex: 1, fontSize: 12, color: T.text, textDecoration: isHidden ? 'line-through' : 'none' }}>{d.field_label}</span>
                        <button onClick={() => toggleHidden(d.field_key, !isHidden)} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, color: isHidden ? T.primary : T.textMuted, cursor: 'pointer', fontFamily: T.font }}>
                          {isHidden ? 'Show' : 'Hide'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
