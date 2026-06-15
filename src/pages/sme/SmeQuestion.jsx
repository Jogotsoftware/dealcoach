import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Card, Spinner, Button } from '../../components/Shared'
import {
  generateClarifyingQuestions,
  submitSmeAnswer,
  markSmeAnswerHelpful,
  flagSmeAnswerIncorrect,
} from '../../lib/sme'

const FLAG_REASONS = [
  { key: 'incorrect_fact', label: 'Incorrect fact' },
  { key: 'outdated', label: 'Outdated information' },
  { key: 'misleading', label: 'Misleading wording' },
  { key: 'not_org_policy', label: 'Not actual org policy' },
  { key: 'other', label: 'Other (explain in notes)' },
]

export default function SmeQuestion() {
  const { id } = useParams()
  const nav = useNavigate()
  const { profile } = useAuth()

  const [q, setQ] = useState(null)
  const [thread, setThread] = useState([])
  const [flags, setFlags] = useState([])
  const [askerName, setAskerName] = useState('')
  const [smeName, setSmeName] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)

  const [answerDraft, setAnswerDraft] = useState('')
  const [addressed, setAddressed] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)

  const [helpfulSubmitting, setHelpfulSubmitting] = useState(false)
  const [deactivateCorrection, setDeactivateCorrection] = useState(false)
  const [applyToRoi, setApplyToRoi] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  const [flagModalOpen, setFlagModalOpen] = useState(false)
  const [flagReason, setFlagReason] = useState('')
  const [flagNotes, setFlagNotes] = useState('')
  const [flagSubmitting, setFlagSubmitting] = useState(false)

  const isCorrection = !!q?.ai_correction_memory_id
  const isMyQuestion = q?.asked_by_user_id === profile?.id
  const isRoutedToMe = q?.routed_to_sme_id === profile?.id
  const isAnsweredOrLater = q && ['answered', 'flagged_incorrect'].includes(q.status)
  const canCompose = isRoutedToMe && ['routed', 'clarifying'].includes(q?.status)
  const hasPartnerTag = useMemo(() => (q?.topic_tags || []).some(t => t.startsWith('isv-named-') || t.startsWith('implementation-partner-named-')), [q?.topic_tags])

  useEffect(() => { if (id && profile?.id) load() }, [id, profile?.id])

  async function load() {
    setLoading(true)
    try {
      const { data: question } = await supabase.from('sme_questions').select('*').eq('id', id).single()
      if (!question) { setLoading(false); return }
      setQ(question)
      // Bump view count (best effort).
      supabase.from('sme_questions').update({ view_count: (question.view_count || 0) + 1 }).eq('id', id).then(() => {})

      const [threadRes, flagsRes, askerRes, smeRes] = await Promise.all([
        supabase.from('sme_answer_thread').select('*').eq('sme_question_id', id).order('created_at'),
        supabase.from('sme_answer_flags').select('*').eq('sme_question_id', id).order('created_at', { ascending: false }),
        supabase.from('profiles').select('full_name, initials').eq('id', question.asked_by_user_id).single(),
        question.routed_to_sme_id ? supabase.from('profiles').select('full_name, initials').eq('id', question.routed_to_sme_id).single() : Promise.resolve({ data: null }),
      ])
      setThread(threadRes.data || [])
      setFlags(flagsRes.data || [])
      if (askerRes.data) setAskerName(askerRes.data.full_name || 'Asker')
      if (smeRes.data) setSmeName(smeRes.data.full_name || 'SME')

      // If SME is viewing a routed question without clarifying questions yet, trigger generation.
      if (question.routed_to_sme_id === profile.id && question.status === 'routed') {
        setGenerating(true)
        const r = await generateClarifyingQuestions(id)
        setGenerating(false)
        if (r?.success) {
          // Reload thread + status
          const { data: t2 } = await supabase.from('sme_answer_thread').select('*').eq('sme_question_id', id).order('created_at')
          setThread(t2 || [])
          const { data: q2 } = await supabase.from('sme_questions').select('*').eq('id', id).single()
          if (q2) setQ(q2)
        }
      }
    } catch (e) { console.error('SmeQuestion load:', e) } finally { setLoading(false) }
  }

  const clarifyingQs = thread.filter(m => m.message_type === 'clarifying_question_for_sme')
  const conversation = thread.filter(m => m.message_type !== 'clarifying_question_for_sme')

  async function onSubmit() {
    if (!answerDraft.trim() || submitting) return
    setSubmitting(true)
    const addressedList = Array.from(addressed)
    const r = await submitSmeAnswer({ sme_question_id: id, sme_user_id: profile.id, answer_text: answerDraft.trim(), addressed_clarifications: addressedList })
    setSubmitting(false)
    if (r?.error) { alert('Submit failed: ' + r.error); return }
    setAnswerDraft('')
    setAddressed(new Set())
    load()
  }

  async function onMarkHelpful(helpful) {
    if (helpfulSubmitting) return
    setHelpfulSubmitting(true)
    const r = await markSmeAnswerHelpful({
      sme_question_id: id, asker_user_id: profile.id, helpful,
      feedback_text: feedbackText || null,
      deactivate_correction: isCorrection && helpful ? deactivateCorrection : undefined,
      apply_to_roi_builder: helpful && hasPartnerTag ? applyToRoi : undefined,
    })
    setHelpfulSubmitting(false)
    if (r?.error) { alert('Mark failed: ' + r.error); return }
    load()
  }

  async function onSubmitFlag() {
    if (!flagReason || flagSubmitting) return
    setFlagSubmitting(true)
    const r = await flagSmeAnswerIncorrect({ sme_question_id: id, flagged_by_user_id: profile.id, flag_reason: flagReason, flag_notes: flagNotes || null })
    setFlagSubmitting(false)
    if (r?.error) { alert('Flag failed: ' + r.error); return }
    setFlagModalOpen(false); setFlagReason(''); setFlagNotes('')
    load()
  }

  if (loading) return <div style={{ padding: 32, textAlign: 'center' }}><Spinner /></div>
  if (!q) return <div style={{ padding: 32, textAlign: 'center', color: T.textMuted }}>Question not found.</div>

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto', fontFamily: T.font }}>
      <Link to="/sme/inbox" style={{ fontSize: 11, color: T.primary, textDecoration: 'none', fontWeight: 600 }}>← back to inbox</Link>

      {/* 1. Header card */}
      <Card style={{ padding: 18, marginTop: 8 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          {isCorrection && <span style={{ padding: '2px 8px', borderRadius: 4, background: '#fef3c7', color: '#92400e', fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Correction validation</span>}
          <span style={{ padding: '2px 8px', borderRadius: 4, background: q.status === 'answered' ? '#dcfce7' : q.status === 'flagged_incorrect' ? '#fee2e2' : T.primaryLight || 'rgba(93,173,226,0.12)', color: q.status === 'answered' ? '#166534' : q.status === 'flagged_incorrect' ? '#991b1b' : T.primary, fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{q.status}</span>
          {(q.topic_tags || []).map(t => (
            <span key={t} style={{ padding: '1px 8px', borderRadius: 10, background: T.surfaceAlt, color: T.textMuted, fontSize: 9, fontWeight: 600 }}>{t}</span>
          ))}
          <div style={{ marginLeft: 'auto', fontSize: 10, color: T.textMuted }}>
            {q.view_count || 0} views{q.ai_citation_count > 0 && ` · Lux cited ${q.ai_citation_count}×`}
          </div>
        </div>
        <div style={{ fontSize: 15, color: T.text, lineHeight: 1.5, fontWeight: 600, marginBottom: 8 }}>{q.question_text}</div>
        <div style={{ fontSize: 11, color: T.textMuted }}>Asked by {askerName} · {new Date(q.created_at).toLocaleDateString()}{q.routed_to_sme_id && ` · routed to ${smeName}`}</div>

        {isCorrection && (
          <div style={{ marginTop: 12, padding: 10, background: '#fffbeb', borderRadius: 6, border: '1px solid #fcd34d', fontSize: 11, color: '#92400e', lineHeight: 1.5 }}>
            <strong>This question came from a chat correction.</strong> The asker disagreed with what Lux said. Your validation will either promote the correction to org knowledge (if helpful) or deactivate it (if the original Lux answer was right).
          </div>
        )}

        {q.ai_question_context && (
          <div style={{ marginTop: 12, padding: 10, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, fontSize: 11, color: T.textSecondary, fontStyle: 'italic' }}>
            <span style={{ fontStyle: 'normal', fontWeight: 700, color: T.text }}>Lux's read:</span> {q.ai_question_context}
          </div>
        )}
      </Card>

      {/* 2. Clarifying questions (visible to SME when composing) */}
      {canCompose && (clarifyingQs.length > 0 || generating) && (
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>Clarifying questions from Lux</div>
          <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 10 }}>Address these in your answer so it's specific enough to be reused for similar future questions.</div>
          {generating && clarifyingQs.length === 0 && <div style={{ fontSize: 11, color: T.textMuted }}>Generating…</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {clarifyingQs.map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: 8, background: T.surfaceAlt, borderRadius: 6 }}>
                <input type="checkbox" checked={addressed.has(c.content)} onChange={e => {
                  const next = new Set(addressed); if (e.target.checked) next.add(c.content); else next.delete(c.content); setAddressed(next)
                }} style={{ marginTop: 2 }} />
                <div style={{ flex: 1, fontSize: 12, color: T.text, lineHeight: 1.4 }}>{c.content}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 3. Answer composer */}
      {canCompose && (
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 6 }}>Your answer</div>
          <textarea value={answerDraft} onChange={e => setAnswerDraft(e.target.value)} placeholder="Write a reusable, scope-specific answer. Cite source-of-truth if relevant. Note recency."
            style={{ width: '100%', minHeight: 160, padding: 10, fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, resize: 'vertical', lineHeight: 1.5 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
            <Button onClick={onSubmit} primary disabled={!answerDraft.trim() || submitting} style={{ padding: '6px 18px', fontSize: 12 }}>{submitting ? 'Submitting…' : 'Submit answer'}</Button>
          </div>
        </Card>
      )}

      {/* 4. Thread */}
      {conversation.length > 0 && (
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>Thread</div>
          {conversation.map(m => (
            <div key={m.id} style={{ padding: '10px 0', borderBottom: `1px solid ${T.borderLight}` }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ padding: '1px 6px', borderRadius: 4, background: m.author_type === 'sme' ? T.primaryLight || 'rgba(93,173,226,0.12)' : (m.author_type === 'ai' ? '#fef3c7' : T.surfaceAlt), color: m.author_type === 'sme' ? T.primary : (m.author_type === 'ai' ? '#92400e' : T.textMuted), fontSize: 9, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{m.author_type}</span>
                <span style={{ fontSize: 10, color: T.textMuted }}>{new Date(m.created_at).toLocaleString()}</span>
                <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 'auto' }}>{m.message_type}</span>
              </div>
              <div style={{ fontSize: 12, color: T.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.content}</div>
            </div>
          ))}
        </Card>
      )}

      {/* 5. Feedback row (asker only, answered+) */}
      {isMyQuestion && isAnsweredOrLater && q.asker_helpful === null && (
        <Card style={{ padding: 14, marginTop: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8 }}>Was this helpful?</div>
          <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)} placeholder="Optional feedback…"
            style={{ width: '100%', minHeight: 60, padding: 8, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, marginBottom: 8 }} />
          {isCorrection && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 11, color: T.textSecondary, lineHeight: 1.4 }}>
              <input type="checkbox" checked={deactivateCorrection} onChange={e => setDeactivateCorrection(e.target.checked)} style={{ marginTop: 2 }} />
              <span>This means the original Lux answer was actually correct — deactivate my earlier correction</span>
            </label>
          )}
          {hasPartnerTag && (
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 11, color: T.textSecondary, lineHeight: 1.4 }}>
              <input type="checkbox" checked={applyToRoi} onChange={e => setApplyToRoi(e.target.checked)} style={{ marginTop: 2 }} />
              <span>Apply to ROIBuilder partner library? <span style={{ color: T.textMuted }}>(this answer references a partner; the value can become a default driver)</span></span>
            </label>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={() => onMarkHelpful(false)} disabled={helpfulSubmitting} style={{ padding: '6px 14px', fontSize: 11 }}>Not helpful</Button>
            <Button onClick={() => onMarkHelpful(true)} primary disabled={helpfulSubmitting} style={{ padding: '6px 14px', fontSize: 11 }}>{helpfulSubmitting ? '…' : 'Helpful'}</Button>
          </div>
        </Card>
      )}

      {isMyQuestion && isAnsweredOrLater && q.asker_helpful !== null && (
        <Card style={{ padding: 12, marginTop: 12, background: q.asker_helpful ? '#dcfce7' : T.surfaceAlt }}>
          <div style={{ fontSize: 11, color: q.asker_helpful ? '#166534' : T.textMuted, fontWeight: 600 }}>
            You marked this {q.asker_helpful ? 'helpful' : 'not helpful'} on {new Date(q.closed_at || q.updated_at).toLocaleDateString()}.{q.asker_feedback_text ? ` — "${q.asker_feedback_text}"` : ''}
          </div>
        </Card>
      )}

      {/* 6. Flag row (everyone, answered+) */}
      {isAnsweredOrLater && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={() => setFlagModalOpen(true)} style={{ background: 'none', border: 'none', color: T.error, fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: T.font }}>Flag as incorrect</button>
        </div>
      )}

      {/* 7. Citations footer */}
      {q.ai_citation_count > 0 && (
        <Card style={{ padding: 10, marginTop: 12, background: T.primaryLight || 'rgba(93,173,226,0.08)' }}>
          <div style={{ fontSize: 11, color: T.primary, fontWeight: 600 }}>Lux has used this answer {q.ai_citation_count} time{q.ai_citation_count === 1 ? '' : 's'} in deal coaching.</div>
        </Card>
      )}

      {/* Open flags summary (visible to all) */}
      {flags.filter(f => f.status === 'open').length > 0 && (
        <Card style={{ padding: 10, marginTop: 12, background: '#fef2f2', border: '1px solid #fecaca' }}>
          <div style={{ fontSize: 11, color: '#991b1b', fontWeight: 600 }}>{flags.filter(f => f.status === 'open').length} open flag(s) on this answer.</div>
        </Card>
      )}

      {/* Flag modal */}
      {flagModalOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !flagSubmitting && setFlagModalOpen(false)}>
          <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 18, fontFamily: T.font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginBottom: 8 }}>Flag this answer as incorrect</div>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10 }}>Admins will review. ≥ 2 open flags marks the question as flagged_incorrect in the inbox.</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: T.text, marginBottom: 6 }}>Reason (required)</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {FLAG_REASONS.map(r => (
                <button key={r.key} onClick={() => setFlagReason(r.key)} style={{ padding: '4px 10px', fontSize: 10, borderRadius: 8, border: `1px solid ${flagReason === r.key ? T.error : T.border}`, background: flagReason === r.key ? T.error : 'transparent', color: flagReason === r.key ? '#fff' : T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>{r.label}</button>
              ))}
            </div>
            <textarea value={flagNotes} onChange={e => setFlagNotes(e.target.value)} placeholder="Optional notes…" style={{ width: '100%', minHeight: 80, padding: 8, fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setFlagModalOpen(false)} disabled={flagSubmitting} style={{ padding: '6px 14px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.textMuted, cursor: flagSubmitting ? 'default' : 'pointer', fontFamily: T.font }}>Cancel</button>
              <button onClick={onSubmitFlag} disabled={!flagReason || flagSubmitting} style={{ padding: '6px 14px', fontSize: 11, fontWeight: 700, border: 'none', borderRadius: 6, background: !flagReason || flagSubmitting ? T.borderLight : T.error, color: '#fff', cursor: !flagReason || flagSubmitting ? 'default' : 'pointer', fontFamily: T.font }}>{flagSubmitting ? 'Submitting…' : 'Flag answer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
