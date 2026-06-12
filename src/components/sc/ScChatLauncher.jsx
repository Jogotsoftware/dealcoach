import { useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { Button, inputStyle } from '../Shared'
import DealChat from '../DealChat'
import BetaFeedbackModal from '../BetaFeedbackModal'

// Floating bottom-corner chat for the SC portal — mirrors the AE's GlobalChatbot
// pattern (lightbulb FAB + beta-feedback affordance) but trimmed for the SC.
// Route-aware: on /sc/deals/:id it scopes the chat to that deal so deal-chat
// pulls the QDC + FDC transcripts + research; elsewhere it answers from
// pipeline + the Intacct/methodology knowledge layer. Suggested questions are
// a fixed set plus the org's editable sc_saved_prompts library, with a
// Create-prompt-template button.

const SUGGESTIONS_DEAL = [
  'Summarize the QDC and FDC for this deal',
  'What are the biggest open risks and unknowns?',
  'Which Sage Intacct modules fit what they need?',
  'What should I prepare for the next call?',
]

const SUGGESTIONS_GENERAL = [
  'How does Sage Intacct handle multi-entity consolidation?',
  'What discovery questions should I ask in an FDC?',
  'Which Intacct modules fit a project-based business?',
]

function LightbulbIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 21h6v-1.5a1 1 0 0 0-.5-.87 6 6 0 1 1 -5 0a1 1 0 0 0 -.5.87V21z"
        fill="#FFC000" stroke="#E0A800" strokeWidth="0.5" strokeLinejoin="round" />
      <path d="M10.5 14 L12 11 L13.5 14" fill="none" stroke="#E0A800" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="9.5" y1="20.2" x2="14.5" y2="20.2" stroke="#B8860B" strokeWidth="0.9" strokeLinecap="round" />
      <line x1="10" y1="22" x2="14" y2="22" stroke="#B8860B" strokeWidth="0.9" strokeLinecap="round" />
      <g stroke="#FFC000" strokeWidth="1.2" strokeLinecap="round" opacity="0.85">
        <line x1="12" y1="2.5" x2="12" y2="4" />
        <line x1="5.5" y1="5.5" x2="6.7" y2="6.7" />
        <line x1="18.5" y1="5.5" x2="17.3" y2="6.7" />
        <line x1="3" y1="11" x2="4.5" y2="11" />
        <line x1="21" y1="11" x2="19.5" y2="11" />
      </g>
    </svg>
  )
}

export default function ScChatLauncher() {
  const { profile } = useAuth()
  const { org } = useOrg() || {}
  const { pathname } = useLocation()

  const dealMatch = pathname.match(/^\/sc\/deals\/([0-9a-f-]{36})/i)
  const routeDealId = dealMatch ? dealMatch[1] : null

  const [deal, setDeal] = useState(null)        // { id, company_name, org_id }
  const [open, setOpen] = useState(false)        // launcher popover
  const [chatOpen, setChatOpen] = useState(false)
  const [fbOpen, setFbOpen] = useState(false)
  const [seed, setSeed] = useState('')
  const [prompts, setPrompts] = useState([])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ title: '', prompt_text: '' })

  const orgId = deal?.org_id || org?.id || profile?.org_id || null

  // Resolve the deal in context (for scope + company name + org).
  useEffect(() => {
    let cancelled = false
    if (!routeDealId) { setDeal(null); return }
    ;(async () => {
      const { data } = await supabase.from('deals').select('id, company_name, org_id').eq('id', routeDealId).maybeSingle()
      if (!cancelled) setDeal(data || null)
    })()
    return () => { cancelled = true }
  }, [routeDealId])

  useEffect(() => { if (orgId) loadPrompts() }, [orgId])
  async function loadPrompts() {
    try {
      const { data } = await supabase.from('sc_saved_prompts').select('*').eq('org_id', orgId).order('created_at')
      setPrompts(data || [])
    } catch (e) { console.error('[ScChatLauncher] prompts', e) }
  }

  async function savePrompt() {
    if (!form.title.trim() || !form.prompt_text.trim() || !orgId) return
    try {
      await supabase.from('sc_saved_prompts').insert({ org_id: orgId, created_by: profile?.id, title: form.title.trim(), prompt_text: form.prompt_text.trim() })
      setForm({ title: '', prompt_text: '' }); setAdding(false); await loadPrompts()
    } catch (e) { console.error('[ScChatLauncher] save', e) }
  }
  async function deletePrompt(id) {
    try { await supabase.from('sc_saved_prompts').delete().eq('id', id); await loadPrompts() }
    catch (e) { console.error('[ScChatLauncher] delete', e) }
  }

  function ask(text) { setSeed(text || ''); setOpen(false); setChatOpen(true) }

  const suggestions = routeDealId ? SUGGESTIONS_DEAL : SUGGESTIONS_GENERAL

  return (
    <>
      {/* Floating lightbulb FAB */}
      {!open && !chatOpen && (
        <button onClick={() => setOpen(true)} title="Ask Lumen" aria-label="Ask Lumen"
          style={{
            position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
            width: 56, height: 56, borderRadius: '50%', padding: 0,
            background: '#FFFFFF', border: '1.5px solid #5DADE2', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 16px rgba(44, 62, 80, 0.15)', transition: 'transform 0.15s ease, box-shadow 0.15s ease',
          }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px) scale(1.04)'; e.currentTarget.style.boxShadow = '0 10px 22px rgba(255, 192, 0, 0.35)' }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(44, 62, 80, 0.15)' }}>
          <LightbulbIcon />
        </button>
      )}

      {/* Launcher popover — suggested questions, saved-prompt library, create template */}
      {open && !chatOpen && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20, zIndex: 9000,
          width: 360, maxWidth: '92vw', maxHeight: '76vh',
          background: T.surface, borderRadius: 14, border: `1px solid ${T.border}`,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column',
          fontFamily: T.font, overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${T.border}`, background: T.surfaceAlt, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: T.success }} />
            <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: T.text }}>Ask Lumen</div>
            <button onClick={() => setFbOpen(true)} title="Send beta feedback"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14, padding: 2 }}>✎</button>
            <button onClick={() => setOpen(false)} title="Close"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 16, padding: 2, lineHeight: 1 }}>×</button>
          </div>

          {/* Context line */}
          <div style={{ padding: '6px 14px', borderBottom: `1px solid ${T.borderLight}`, fontSize: 11, color: T.textMuted }}>
            {routeDealId
              ? <>About <span style={{ color: T.primary, fontWeight: 600 }}>{deal?.company_name || 'this deal'}</span> — its QDC/FDC transcripts &amp; research</>
              : <>General — Sage Intacct &amp; discovery methodology. Open a deal to ask about its calls.</>}
          </div>

          <div style={{ overflowY: 'auto', padding: 12 }}>
            {/* Suggested questions */}
            <div style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>Suggested</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
              {suggestions.map(s => (
                <button key={s} onClick={() => ask(s)}
                  style={{ border: `1px solid ${T.border}`, borderRadius: 16, padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: T.surface, color: T.text, fontFamily: T.font, textAlign: 'left' }}
                  onMouseEnter={e => { e.currentTarget.style.background = T.primaryLight; e.currentTarget.style.borderColor = T.primary }}
                  onMouseLeave={e => { e.currentTarget.style.background = T.surface; e.currentTarget.style.borderColor = T.border }}>
                  {s}
                </button>
              ))}
            </div>

            {/* Saved prompt templates */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ flex: 1, fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Prompt templates</span>
              <button onClick={() => setAdding(a => !a)} style={{ background: 'none', border: 'none', color: T.primary, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: T.font }}>
                {adding ? 'Cancel' : '+ Create prompt template'}
              </button>
            </div>

            {adding && (
              <div style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 8 }}>
                <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Template name (e.g. Pain → quote)"
                  style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', marginBottom: 6 }} />
                <textarea value={form.prompt_text} onChange={e => setForm(p => ({ ...p, prompt_text: e.target.value }))} rows={3} placeholder="The question to ask Lumen…"
                  style={{ ...inputStyle, fontSize: 12, padding: '6px 8px', resize: 'vertical', fontFamily: T.font }} />
                <Button primary disabled={!form.title.trim() || !form.prompt_text.trim()} onClick={savePrompt} style={{ padding: '5px 12px', fontSize: 11, marginTop: 6 }}>Save template</Button>
              </div>
            )}

            {prompts.length === 0 ? (
              <div style={{ fontSize: 12, color: T.textMuted, padding: '2px 2px 4px' }}>No templates yet. Create one — it's shared with your team and reusable on every deal.</div>
            ) : prompts.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 4px', borderBottom: `1px solid ${T.borderLight}` }}>
                <button onClick={() => ask(p.prompt_text)} title={p.prompt_text}
                  style={{ flex: 1, textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font, fontSize: 12, color: T.text }}>{p.title}</button>
                <button onClick={() => deletePrompt(p.id)} title="Delete" style={{ background: 'none', border: 'none', color: T.textMuted, cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            ))}
          </div>

          {/* Footer: open a free-form chat */}
          <div style={{ padding: 10, borderTop: `1px solid ${T.border}`, background: T.surface }}>
            <Button primary onClick={() => ask('')} style={{ width: '100%', padding: '8px 12px', fontSize: 13 }}>Ask your own question</Button>
          </div>
        </div>
      )}

      {/* The conversation itself (reused deal-scoped chat) */}
      <DealChat
        dealId={routeDealId || undefined}
        userId={profile?.id}
        orgId={orgId}
        scope={routeDealId ? 'deal' : 'pipeline'}
        isOpen={chatOpen}
        seedMessage={seed}
        onClose={() => setChatOpen(false)}
      />

      {fbOpen && (
        <BetaFeedbackModal onClose={() => setFbOpen(false)} dealContext={deal ? { company_name: deal.company_name } : undefined} />
      )}
    </>
  )
}
