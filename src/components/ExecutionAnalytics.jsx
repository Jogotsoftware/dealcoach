import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Card, Badge } from './Shared'

// Call execution analytics (extraction overhaul Phase 6 surface).
// Self-loading: renders the question inventory, coaching moments, and
// call-level metrics produced by the execution-pass engine. Every row
// carries its transcript evidence. Renders nothing until the engine has
// run for this conversation.
const TYPE_COLORS = {
  open: T.success, quantifying: '#0d9488', impact: '#2563eb', layering: '#7c3aed',
  confirming: T.primary, closed: T.textMuted, leading: T.warning, stacked: T.error,
}
const MOMENT_META = {
  nugget_missed: { label: 'Missed nugget', color: T.error },
  thinking_pause: { label: 'Thinking pause', color: '#7c3aed' },
  objection: { label: 'Objection', color: T.warning },
  confirmation_loop: { label: 'Confirmation loop', color: T.success },
}

export default function ExecutionAnalytics({ conversationId, compact = false }) {
  const [questions, setQuestions] = useState(null)
  const [moments, setMoments] = useState(null)
  const [metrics, setMetrics] = useState(null)
  const [momentFilter, setMomentFilter] = useState('all')

  useEffect(() => {
    if (!conversationId) return
    let live = true
    Promise.all([
      supabase.from('call_questions').select('*').eq('conversation_id', conversationId).order('turn_index'),
      supabase.from('call_moments').select('*').eq('conversation_id', conversationId).order('severity_rank', { nullsFirst: false }),
      supabase.from('call_analyses')
        .select('talk_ratio, talk_ratio_basis, longest_monologue_words, open_closed_ratio, agenda_upfront, bant_coverage, next_step_grade, tieback_ratio, depth_summary')
        .eq('conversation_id', conversationId).maybeSingle(),
    ]).then(([q, m, a]) => {
      if (!live) return
      setQuestions(q.data || [])
      setMoments(m.data || [])
      setMetrics(a.data || null)
    }).catch(e => { console.error('[ExecutionAnalytics] load:', e); if (live) { setQuestions([]); setMoments([]) } })
    return () => { live = false }
  }, [conversationId])

  if (!questions || (!questions.length && !moments?.length && !metrics?.talk_ratio)) return null

  const typeCounts = {}
  for (const q of questions) for (const t of (q.types || [])) typeCounts[t] = (typeCounts[t] || 0) + 1
  const openish = (typeCounts.open || 0) + (typeCounts.quantifying || 0) + (typeCounts.impact || 0) + (typeCounts.layering || 0)
  const bant = metrics?.bant_coverage || null
  const gradeColor = (g) => !g ? T.textMuted : g.startsWith('A') ? T.success : g.startsWith('B') ? '#84cc16' : g.startsWith('C') ? T.warning : T.error
  const filteredMoments = (moments || []).filter(m => momentFilter === 'all' || m.moment_type === momentFilter)

  const stat = (label, value, hint) => (
    <div title={hint || ''} style={{ padding: '8px 14px', background: T.surfaceAlt, borderRadius: 8, minWidth: 96 }}>
      <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 800, color: T.text, fontFeatureSettings: '"tnum"' }}>{value}</div>
    </div>
  )

  return (
    <Card title="Execution analytics" style={{ marginTop: compact ? 0 : 16 }}>
      {/* Call-level metrics */}
      {metrics && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {typeof metrics.talk_ratio === 'number' && stat('Talk ratio', `${Math.round(metrics.talk_ratio * 100)}%`, `Rep share of words (${metrics.talk_ratio_basis || 'word count'} basis)`)}
          {typeof metrics.open_closed_ratio === 'number' && stat('Open : closed', metrics.open_closed_ratio.toFixed(1), 'Open-ended vs closed questions')}
          {Number.isInteger(metrics.longest_monologue_words) && stat('Longest monologue', `${metrics.longest_monologue_words}w`, 'Longest uninterrupted run, in words')}
          {metrics.next_step_grade && (
            <div style={{ padding: '8px 14px', background: T.surfaceAlt, borderRadius: 8, minWidth: 96 }} title="A = specific, dated, mutual. F = none.">
              <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next step</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: gradeColor(metrics.next_step_grade) }}>{metrics.next_step_grade}</div>
            </div>
          )}
          {typeof metrics.tieback_ratio === 'number' && stat('Tie-back', `${Math.round(metrics.tieback_ratio * 100)}%`, 'Demoed features tied back to a stated pain')}
          {metrics.agenda_upfront !== null && metrics.agenda_upfront !== undefined && stat('Agenda upfront', metrics.agenda_upfront ? 'Yes' : 'No')}
          {bant && (
            <div style={{ padding: '8px 14px', background: T.surfaceAlt, borderRadius: 8 }} title="Touched on this call (not deal-level status)">
              <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>BANT touched</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                {['budget', 'authority', 'need', 'timeline'].map(k => (
                  <span key={k} style={{ fontSize: 11, fontWeight: 800, color: bant[k] ? T.success : T.textMuted, textTransform: 'uppercase' }}>{k[0]}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Question inventory */}
      {questions.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Questions asked ({questions.length})</span>
            <span style={{ fontSize: 11, color: T.textSecondary }}>{openish} discovery-grade</span>
            {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <span key={t} style={{ fontSize: 10, fontWeight: 700, padding: '1px 8px', borderRadius: 9, background: (TYPE_COLORS[t] || T.textMuted) + '15', color: TYPE_COLORS[t] || T.textMuted, border: `1px solid ${(TYPE_COLORS[t] || T.textMuted)}30` }}>
                {t} {n}
              </span>
            ))}
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${T.borderLight}`, borderRadius: 6 }}>
            {questions.map(q => (
              <div key={q.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '6px 10px', borderBottom: `1px solid ${T.borderLight}` }}>
                <span style={{ fontSize: 12, color: T.text, flex: 1 }}>{q.question_text}</span>
                {q.topic && <span style={{ fontSize: 10, color: T.textMuted, whiteSpace: 'nowrap' }}>{q.topic}</span>}
                {(q.types || []).map(t => (
                  <span key={t} style={{ fontSize: 9, fontWeight: 700, color: TYPE_COLORS[t] || T.textMuted, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{t}</span>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coaching moments */}
      {moments?.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: T.text }}>Moments ({moments.length})</span>
            <button onClick={() => setMomentFilter('all')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font, fontSize: 10, fontWeight: 700, color: momentFilter === 'all' ? T.primary : T.textMuted }}>ALL</button>
            {Object.entries(MOMENT_META).map(([k, meta]) => {
              const n = moments.filter(m => m.moment_type === k).length
              if (!n) return null
              return (
                <button key={k} onClick={() => setMomentFilter(k)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: T.font, fontSize: 10, fontWeight: 700, color: momentFilter === k ? meta.color : T.textMuted }}>
                  {meta.label.toUpperCase()} {n}
                </button>
              )
            })}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredMoments.map(m => {
              const meta = MOMENT_META[m.moment_type] || { label: m.moment_type, color: T.textMuted }
              return (
                <div key={m.id} style={{ padding: '8px 10px', background: T.surfaceAlt, borderRadius: 6, borderLeft: `3px solid ${meta.color}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 3, flexWrap: 'wrap' }}>
                    <Badge color={meta.color}>{meta.label}</Badge>
                    {m.severity_rank && m.moment_type === 'nugget_missed' && <span style={{ fontSize: 10, color: T.textMuted }}>#{m.severity_rank}</span>}
                    {m.payload?.handling && <span style={{ fontSize: 10, fontWeight: 700, color: m.payload.handling === 'addressed' ? T.success : m.payload.handling === 'ignored' ? T.error : T.warning, textTransform: 'uppercase' }}>{m.payload.handling}</span>}
                    {m.payload?.outcome && <span style={{ fontSize: 10, fontWeight: 700, color: m.payload.outcome === 'confirmed' ? T.success : T.warning, textTransform: 'uppercase' }}>{m.payload.outcome}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: T.text, fontStyle: 'italic' }}>
                    {'“'}{m.quote}{'”'}{m.speaker ? <span style={{ fontStyle: 'normal', color: T.textSecondary }}> — {m.speaker}</span> : null}
                  </div>
                  {m.payload?.should_have_asked && (
                    <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 3 }}>
                      Should have asked: <strong style={{ color: T.text }}>{m.payload.should_have_asked}</strong>
                    </div>
                  )}
                  {m.payload?.corrected_to && (
                    <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 3 }}>Corrected to: {m.payload.corrected_to}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
