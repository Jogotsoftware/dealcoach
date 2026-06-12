import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Button, inputStyle } from '../Shared'
import DealChat from '../DealChat'

// SC chat launcher — opens the deal-scoped chat (reused) to ask questions
// about this deal's transcripts, plus a saved-prompts library (sc_saved_prompts)
// the SC can run with one click or add to.
export default function ScChatPanel({ deal }) {
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [seed, setSeed] = useState('')
  const [prompts, setPrompts] = useState([])
  const [showPrompts, setShowPrompts] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', prompt_text: '' })

  useEffect(() => { loadPrompts() }, [deal?.org_id])
  async function loadPrompts() {
    try { const { data } = await supabase.from('sc_saved_prompts').select('*').order('created_at'); setPrompts(data || []) }
    catch (e) { console.error('[ScChatPanel] prompts', e) }
  }

  function runPrompt(text) { setSeed(text); setOpen(true); setShowPrompts(false) }
  async function savePrompt() {
    if (!form.title.trim() || !form.prompt_text.trim()) return
    try {
      await supabase.from('sc_saved_prompts').insert({ org_id: deal.org_id, created_by: profile?.id, title: form.title.trim(), prompt_text: form.prompt_text.trim() })
      setForm({ title: '', prompt_text: '' }); setAdding(false); await loadPrompts()
    } catch (e) { console.error('[ScChatPanel] save', e) }
  }
  async function deletePrompt(id) {
    try { await supabase.from('sc_saved_prompts').delete().eq('id', id); await loadPrompts() }
    catch (e) { console.error('[ScChatPanel] delete', e) }
  }

  return (
    <span style={{ position: 'relative', display: 'inline-flex', gap: 6 }}>
      <Button onClick={() => { setSeed(''); setOpen(true) }} style={{ padding: '6px 12px', fontSize: 12 }}>Ask Lumen</Button>
      <button onClick={() => setShowPrompts(s => !s)} title="Saved prompts"
        style={{ padding: '6px 10px', fontSize: 12, borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
        Prompts ▾
      </button>
      {showPrompts && (
        <>
          <span onClick={() => setShowPrompts(false)} style={{ position: 'fixed', inset: 0, zIndex: 700 }} />
          <div style={{ position: 'absolute', top: '120%', right: 0, zIndex: 701, width: 340, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, boxShadow: '0 12px 36px rgba(0,0,0,0.16)', padding: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.text, flex: 1 }}>Saved prompts</span>
              <button onClick={() => setAdding(a => !a)} style={{ background: 'none', border: 'none', color: T.primary, fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>{adding ? 'Cancel' : '+ New'}</button>
            </div>
            {adding && (
              <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: `1px solid ${T.borderLight}` }}>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Title" style={{ ...inputStyle, fontSize: 12, padding: '5px 8px', marginBottom: 6 }} />
                <textarea value={form.prompt_text} onChange={e => setForm(p => ({ ...p, prompt_text: e.target.value }))} placeholder="Prompt text" rows={3} style={{ ...inputStyle, fontSize: 12, padding: '5px 8px', resize: 'vertical', fontFamily: T.font }} />
                <Button primary onClick={savePrompt} style={{ padding: '4px 10px', fontSize: 11, marginTop: 6 }}>Save</Button>
              </div>
            )}
            {prompts.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, padding: 4 }}>No saved prompts yet.</div>
            ) : prompts.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px', borderBottom: `1px solid ${T.borderLight}` }}>
                <button onClick={() => runPrompt(p.prompt_text)} title={p.prompt_text}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font, fontSize: 12, color: T.text }}>{p.title}</button>
                <button onClick={() => deletePrompt(p.id)} title="Delete" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            ))}
          </div>
        </>
      )}
      <DealChat dealId={deal.id} userId={profile?.id} orgId={deal.org_id} scope="deal" isOpen={open} seedMessage={seed} onClose={() => setOpen(false)} />
    </span>
  )
}
