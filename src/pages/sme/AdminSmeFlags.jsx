import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Card, Spinner, Button } from '../../components/Shared'
import { resolveSmeFlag } from '../../lib/sme'

function ago(d) {
  if (!d) return ''
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function AdminSmeFlags() {
  const { profile } = useAuth()
  const [flags, setFlags] = useState([])
  const [questions, setQuestions] = useState({})
  const [flaggers, setFlaggers] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeFlag, setActiveFlag] = useState(null)
  const [resolution, setResolution] = useState('')
  const [resolutionNotes, setResolutionNotes] = useState('')
  const [resolving, setResolving] = useState(false)

  useEffect(() => { if (profile?.org_id) load() }, [profile?.org_id])

  async function load() {
    setLoading(true)
    try {
      const { data: openFlags } = await supabase.from('sme_answer_flags').select('*').eq('org_id', profile.org_id).eq('status', 'open').order('created_at', { ascending: false })
      const fl = openFlags || []
      setFlags(fl)
      if (fl.length > 0) {
        const qIds = Array.from(new Set(fl.map(f => f.sme_question_id)))
        const userIds = Array.from(new Set(fl.map(f => f.flagged_by_user_id)))
        const [qRes, uRes] = await Promise.all([
          supabase.from('sme_questions').select('id, question_text, topic_tags, status').in('id', qIds),
          supabase.from('profiles').select('id, full_name, email').in('id', userIds),
        ])
        setQuestions(Object.fromEntries((qRes.data || []).map(q => [q.id, q])))
        setFlaggers(Object.fromEntries((uRes.data || []).map(u => [u.id, u])))
      }
    } catch (e) { console.error('AdminSmeFlags load:', e) } finally { setLoading(false) }
  }

  async function onResolve() {
    if (!activeFlag || !resolution || resolving) return
    setResolving(true)
    const r = await resolveSmeFlag({ flag_id: activeFlag.id, resolver_user_id: profile.id, resolution, resolution_notes: resolutionNotes || null })
    setResolving(false)
    if (r?.error) { alert('Resolve failed: ' + r.error); return }
    setActiveFlag(null); setResolution(''); setResolutionNotes('')
    load()
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>

  return (
    <div style={{ padding: 20, maxWidth: 1100, margin: '0 auto', fontFamily: T.font }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, color: T.text, margin: '0 0 6px' }}>SME Flags Queue</h1>
      <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 14 }}>Open flags on SME answers. Resolve as valid (correct flag, -15 credits, memory deactivated), invalid (flag rejected, 0 credits, memory stays), or partial (-5 credits, clarification appended).</div>

      {flags.length === 0 ? (
        <Card><div style={{ padding: 32, textAlign: 'center', color: T.textMuted, fontSize: 13 }}>No open flags. All clear.</div></Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {flags.map(f => {
            const q = questions[f.sme_question_id]
            const fuser = flaggers[f.flagged_by_user_id]
            return (
              <Card key={f.id} style={{ padding: 14 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, color: T.text, marginBottom: 4, lineHeight: 1.4 }}>
                      <Link to={`/sme/question/${f.sme_question_id}`} style={{ color: T.text, fontWeight: 600, textDecoration: 'none' }}>
                        {(q?.question_text || '').slice(0, 200)}{(q?.question_text || '').length > 200 ? '…' : ''}
                      </Link>
                    </div>
                    <div style={{ display: 'flex', gap: 10, fontSize: 10, color: T.textMuted, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>Flagged by <strong>{fuser?.full_name || fuser?.email || 'Unknown'}</strong></span>
                      <span>{ago(f.created_at)}</span>
                      <span style={{ padding: '1px 6px', borderRadius: 4, background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>{f.flag_reason}</span>
                      {(q?.topic_tags || []).slice(0, 3).map(t => <span key={t}>{t}</span>)}
                    </div>
                    {f.flag_notes && (
                      <div style={{ marginTop: 6, padding: 8, fontSize: 11, color: T.textSecondary, fontStyle: 'italic', background: T.surfaceAlt, borderRadius: 4 }}>"{f.flag_notes}"</div>
                    )}
                  </div>
                  <Button onClick={() => setActiveFlag(f)} primary style={{ padding: '6px 14px', fontSize: 11 }}>Resolve</Button>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {activeFlag && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !resolving && setActiveFlag(null)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, fontFamily: T.font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 4 }}>Resolve flag</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12 }}>Flagger reason: <strong>{activeFlag.flag_reason}</strong></div>
            <div style={{ fontSize: 10, fontWeight: 700, color: T.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Resolution</div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[
                { key: 'valid', label: 'Valid (-15 credits, deactivate)', color: T.error },
                { key: 'partial', label: 'Partial (-5, clarify)', color: '#f59e0b' },
                { key: 'invalid', label: 'Invalid (reject flag)', color: T.success },
              ].map(r => (
                <button key={r.key} onClick={() => setResolution(r.key)} style={{ flex: 1, padding: '8px 10px', fontSize: 10, fontWeight: 700, borderRadius: 6, border: `1px solid ${resolution === r.key ? r.color : T.border}`, background: resolution === r.key ? r.color : 'transparent', color: resolution === r.key ? '#fff' : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>{r.label}</button>
              ))}
            </div>
            <textarea value={resolutionNotes} onChange={e => setResolutionNotes(e.target.value)} placeholder="Resolution notes (optional; for partial: explain the clarification)…"
              style={{ width: '100%', minHeight: 80, padding: 8, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, marginBottom: 12 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setActiveFlag(null)} disabled={resolving} style={{ padding: '6px 14px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: resolving ? 'default' : 'pointer', fontFamily: T.font }}>Cancel</button>
              <button onClick={onResolve} disabled={!resolution || resolving} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: !resolution || resolving ? T.borderLight : T.primary, color: '#fff', cursor: !resolution || resolving ? 'default' : 'pointer', fontFamily: T.font }}>{resolving ? 'Submitting…' : 'Submit resolution'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
