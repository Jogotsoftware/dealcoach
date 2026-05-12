import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatDateLong, CALL_TYPES } from '../lib/theme'
import { Card, Badge, ScoreBar, Button, Spinner, inputStyle, labelStyle } from './Shared'
import { callGenerateEmail } from '../lib/webhooks'
import { useAuth } from '../hooks/useAuth'
import DealChat from './DealChat'
import AttendeesEditor from './coaching/AttendeesEditor'

function callTypeLabel(key) {
  const t = CALL_TYPES.find(c => c.key === key)
  return t ? t.label : (key || 'Unset')
}

// Renders one call's AI analysis (summary, coaching, scores, questions, transcript).
// Used standalone by CallDetail and embedded in DealDetail's Analysis sub-tabs.
// Pass `onBack` to show a back button; omit it when embedded.
// `onCallUpdate(id, patch)` lets a parent (DealDetail) sync local state when
// fields like call_date are edited inline.
export default function CallAnalysisBody({ dealId, conversationId, onBack, onCallUpdate }) {
  const { profile } = useAuth()
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [conversation, setConversation] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [companyName, setCompanyName] = useState('')
  const excerptParam = searchParams.get('excerpt')
  const [showTranscript, setShowTranscript] = useState(!!excerptParam)
  const [showEmailGen, setShowEmailGen] = useState(false)
  const [emailTemplates, setEmailTemplates] = useState([])
  const [selTpl, setSelTpl] = useState('')
  const [genLoading, setGenLoading] = useState(false)
  const [genResult, setGenResult] = useState(null)
  const [showChat, setShowChat] = useState(false)
  const [editingDate, setEditingDate] = useState(false)
  const [editingCallType, setEditingCallType] = useState(false)
  const [reprocessing, setReprocessing] = useState(false)

  async function saveCallDate(nextDate) {
    // Accepts YYYY-MM-DD; empty string clears. Optimistic local update + parent sync.
    const value = nextDate || null
    setConversation(prev => prev ? { ...prev, call_date: value } : prev)
    setEditingDate(false)
    const { error } = await supabase.from('conversations').update({ call_date: value }).eq('id', conversationId)
    if (error) { alert('Failed to update date: ' + error.message); loadData(); return }
    onCallUpdate?.(conversationId, { call_date: value })
  }

  async function saveCallType(nextType) {
    // Empty string clears. Optimistic local update + parent sync. Call type
    // feeds the AI prompt assembly, so after saving offer to reprocess.
    const value = nextType || null
    const previous = conversation.call_type
    setConversation(prev => prev ? { ...prev, call_type: value } : prev)
    setEditingCallType(false)
    const { error } = await supabase.from('conversations').update({ call_type: value }).eq('id', conversationId)
    if (error) { alert('Failed to update call type: ' + error.message); loadData(); return }
    onCallUpdate?.(conversationId, { call_type: value })
    if (value && value !== previous && confirm('Re-run AI analysis with the new call type? This may take ~30s and uses credits.')) {
      runReprocess()
    }
  }

  async function runReprocess() {
    if (reprocessing) return
    setReprocessing(true)
    try {
      const { callProcessTranscript } = await import('../lib/webhooks')
      const res = await callProcessTranscript(conversationId)
      if (res.error) { alert('Processing failed: ' + res.error); return }
      await loadData()
    } finally {
      setReprocessing(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [conversationId])

  async function loadData() {
    setLoading(true)
    const [convRes, analysisRes, dealRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id, deal_id, title, call_type, call_date, transcript, ai_summary, ai_coaching_notes, processed, task_count')
        .eq('id', conversationId)
        .single(),
      supabase
        .from('call_analyses')
        .select('overall_score, score_breakdown, call_summary, strengths, improvements, methodology_gaps, questions_asked, questions_should_have_asked, questions_for_next_call, discovery_depth_score, curiosity_score, challenger_score, value_articulation_score, objection_handling_score, next_steps_quality_score, scored_by')
        .eq('conversation_id', conversationId)
        .single(),
      supabase
        .from('deals')
        .select('company_name')
        .eq('id', dealId)
        .single(),
    ])

    if (convRes.data) setConversation(convRes.data)
    if (analysisRes.data) setAnalysis(analysisRes.data)
    if (dealRes.data) setCompanyName(dealRes.data.company_name || '')
    if (profile?.active_coach_id) {
      const { data: eTpls } = await supabase.from('email_templates').select('*').eq('coach_id', profile.active_coach_id).eq('active', true).order('sort_order')
      setEmailTemplates(eTpls || [])
    }
    setLoading(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh' }}>
      <Spinner />
    </div>
  )

  if (!conversation) return (
    <div style={{ padding: 24, textAlign: 'center', color: T.textMuted, fontSize: 14 }}>
      Call not found
    </div>
  )

  const scoreColor = (s) => s >= 80 ? T.success : s >= 60 ? T.primary : s >= 40 ? T.warning : T.error

  const qualityColor = (q) => {
    if (q === 'good') return T.successLight
    if (q === 'adequate') return T.warningLight
    if (q === 'missed_opportunity') return T.errorLight
    return T.surfaceAlt
  }

  const qualityBadgeColor = (q) => {
    if (q === 'good') return T.success
    if (q === 'adequate') return T.warning
    if (q === 'missed_opportunity') return T.error
    return T.textMuted
  }

  const priorityColor = (p) => {
    if (p === 'high') return T.error
    if (p === 'medium') return T.warning
    return T.textMuted
  }

  const summaryText = analysis?.call_summary || conversation.ai_summary

  const individualScores = [
    { key: 'discovery_depth_score', label: 'Discovery' },
    { key: 'curiosity_score', label: 'Curiosity' },
    { key: 'challenger_score', label: 'Challenger' },
    { key: 'value_articulation_score', label: 'Value' },
    { key: 'objection_handling_score', label: 'Objections' },
    { key: 'next_steps_quality_score', label: 'Next Steps' },
    { key: 'independently_wealthy_score', label: 'Indep. Wealthy', tooltip: 'Measures whether the rep controlled the call from a position of strength — asking hard questions, qualifying ruthlessly, willing to walk away from a bad deal. High = sold like they don\'t need the deal.' },
  ]

  const sectionStyle = {
    fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 12, marginTop: 8,
  }

  return (
    <div style={{ fontFamily: T.font }}>
      {/* Header bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: onBack ? '16px 24px' : '12px 0',
        paddingRight: onBack ? 72 : 0,
        background: onBack ? T.surface : 'transparent',
        borderBottom: onBack ? `1px solid ${T.border}` : 'none',
        boxShadow: onBack ? T.shadow : 'none',
        flexWrap: 'wrap',
        marginBottom: onBack ? 0 : 16,
      }}>
        {onBack && (
          <Button onClick={onBack} style={{ padding: '6px 12px', fontSize: 12 }}>
            Back to {companyName || 'Deal'}
          </Button>
        )}
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{conversation.title || 'Untitled Call'}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            {editingDate ? (
              <input
                type="date"
                autoFocus
                defaultValue={conversation.call_date ? String(conversation.call_date).slice(0, 10) : ''}
                onBlur={(e) => saveCallDate(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCallDate(e.target.value)
                  if (e.key === 'Escape') setEditingDate(false)
                }}
                style={{ ...inputStyle, width: 150, padding: '4px 8px', fontSize: 12 }}
              />
            ) : (
              <span
                onClick={() => setEditingDate(true)}
                title="Click to edit call date"
                style={{ fontSize: 12, color: T.textSecondary, cursor: 'pointer', borderBottom: `1px dashed ${T.border}`, paddingBottom: 1 }}>
                {conversation.call_date ? formatDateLong(conversation.call_date) : 'No date'}
              </span>
            )}
            {editingCallType ? (
              <select
                autoFocus
                defaultValue={conversation.call_type || ''}
                onBlur={(e) => saveCallType(e.target.value)}
                onChange={(e) => saveCallType(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingCallType(false) }}
                style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, cursor: 'pointer', width: 'auto' }}
              >
                <option value="">— Set call type —</option>
                {CALL_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            ) : (
              <span
                onClick={() => setEditingCallType(true)}
                title="Click to edit call type"
                style={{ cursor: 'pointer' }}>
                <Badge color={conversation.call_type ? T.primary : T.textMuted}>
                  {callTypeLabel(conversation.call_type)}
                </Badge>
              </span>
            )}
            {conversation.processed && <Badge color={T.success}>Processed</Badge>}
            <Button
              primary={!conversation.processed}
              disabled={reprocessing}
              onClick={runReprocess}
              style={{ padding: '3px 10px', fontSize: 11 }}
              title="Re-run AI analysis with the current call type + date"
            >
              {reprocessing ? 'Reprocessing…' : (conversation.processed ? 'Reprocess' : 'Process')}
            </Button>
            <Button onClick={() => setShowChat(true)} style={{ padding: '4px 10px', fontSize: 11 }}>Ask Coach</Button>
            <Button onClick={() => setShowEmailGen(true)} style={{ padding: '4px 10px', fontSize: 11 }}>Generate Email</Button>
          </div>
        </div>
        {/* Large overall score on the right */}
        {analysis && analysis.overall_score != null && (
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{
              fontSize: 48, fontWeight: 700, color: scoreColor(analysis.overall_score),
              lineHeight: 1, fontFeatureSettings: '"tnum"',
            }}>
              {analysis.overall_score}
            </div>
            <div style={{ fontSize: 10, color: T.textMuted, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
              Overall{analysis.scored_by ? ` / ${analysis.scored_by}` : ''}
            </div>
          </div>
        )}
      </div>

      {/* Content area */}
      <div style={{ padding: onBack ? '16px 24px' : 0 }}>

        {/* Attendees editor (Sage canon) */}
        {profile?.org_id && (
          <div style={{ marginBottom: 16 }}>
            <AttendeesEditor conversationId={conversationId} orgId={profile.org_id} />
          </div>
        )}

        {/* SECTION 1: AI Summary */}
        <div style={sectionStyle}>AI Summary</div>
        <Card>
          {summaryText ? (
            <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}>{summaryText}</div>
          ) : (
            <div style={{ color: T.textMuted, fontSize: 13 }}>No summary available</div>
          )}
        </Card>

        {/* SECTION 2: Coaching - three cards side by side */}
        <div style={sectionStyle}>Coaching</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
          {/* Strengths */}
          <Card style={{ borderLeft: `4px solid ${T.success}`, marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Strengths</div>
            {analysis?.strengths ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.strengths}</div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          {/* Areas to Improve */}
          <Card style={{ borderLeft: `4px solid ${T.error}`, marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.error, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Areas to Improve</div>
            {analysis?.improvements ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.improvements}</div>
            ) : conversation?.ai_coaching_notes ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{conversation.ai_coaching_notes}</div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          {/* Methodology Gaps */}
          <Card style={{ borderLeft: `4px solid ${T.warning}`, marginBottom: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.warning, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Methodology Gaps</div>
            {analysis?.methodology_gaps ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.methodology_gaps}</div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          {/* Deal Killers */}
          {analysis?.top_deal_killers?.length > 0 && (
            <Card style={{ borderLeft: `4px solid ${T.error}`, marginBottom: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.error, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Deal Killers</div>
              {analysis.top_deal_killers.map((item, i) => (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.6, color: T.text, padding: '4px 0', borderBottom: i < analysis.top_deal_killers.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                  {item}
                </div>
              ))}
            </Card>
          )}

          {/* Ways to Win */}
          {analysis?.top_ways_to_win?.length > 0 && (
            <Card style={{ borderLeft: `4px solid ${T.success}`, marginBottom: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Ways to Win</div>
              {analysis.top_ways_to_win.map((item, i) => (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.6, color: T.text, padding: '4px 0', borderBottom: i < analysis.top_ways_to_win.length - 1 ? `1px solid ${T.borderLight}` : 'none' }}>
                  {item}
                </div>
              ))}
            </Card>
          )}
        </div>

        {/* SECTION 3: Scores */}
        {analysis && (analysis.overall_score != null || analysis.score_breakdown || individualScores.some(s => analysis[s.key] != null)) && (
          <>
            <div style={sectionStyle}>Scores</div>
            <Card>
              {individualScores
                .filter(s => analysis[s.key] != null)
                .map(s => (
                  <div key={s.key} title={s.tooltip || ''}>
                    <ScoreBar label={s.label} score={analysis[s.key]} max={10} />
                  </div>
                ))
              }

              {analysis.score_breakdown && (
                <div style={{ marginTop: individualScores.some(s => analysis[s.key] != null) ? 16 : 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Score Breakdown</div>
                  {Array.isArray(analysis.score_breakdown) ? (
                    analysis.score_breakdown.map((item, i) => (
                      <div key={i}>
                        <ScoreBar label={item.criteria} score={item.score} max={item.max || 10} />
                        {item.notes && (
                          <div style={{ fontSize: 11, color: T.textSecondary, marginLeft: 63, marginTop: -2, marginBottom: 8 }}>{item.notes}</div>
                        )}
                      </div>
                    ))
                  ) : typeof analysis.score_breakdown === 'object' ? (
                    Object.entries(analysis.score_breakdown).map(([key, value]) => (
                      <ScoreBar key={key} label={key} score={value} />
                    ))
                  ) : null}
                </div>
              )}
            </Card>

            {analysis?.independently_wealthy_reason && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                borderLeft: `3px solid ${T.primary}`,
                background: T.surfaceAlt, borderRadius: '0 6px 6px 0',
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  Independently Wealthy — Why This Score
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: T.text, fontStyle: 'italic' }}>
                  {analysis.independently_wealthy_reason}
                </div>
              </div>
            )}
          </>
        )}

        {/* SECTION 4: Questions */}
        <div style={sectionStyle}>Questions</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 16 }}>
          <Card style={{ marginBottom: 0 }} title="Questions Asked">
            {analysis?.questions_asked && Array.isArray(analysis.questions_asked) && analysis.questions_asked.length > 0 ? (
              analysis.questions_asked.map((item, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 10, background: qualityColor(item.quality), borderRadius: 6 }}>
                  <div style={{ fontSize: 13, color: T.text }}>{item.question}</div>
                  {item.quality && (
                    <div style={{ marginTop: 6 }}><Badge color={qualityBadgeColor(item.quality)}>{item.quality.replace('_', ' ')}</Badge></div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          <Card style={{ marginBottom: 0 }} title="Should Have Asked">
            {analysis?.questions_should_have_asked && Array.isArray(analysis.questions_should_have_asked) && analysis.questions_should_have_asked.length > 0 ? (
              analysis.questions_should_have_asked.map((item, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.question}</div>
                  {item.reason && (<div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{item.reason}</div>)}
                  {item.methodology && (<div style={{ marginTop: 6 }}><Badge color={T.primary}>{item.methodology}</Badge></div>)}
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          <Card style={{ marginBottom: 0 }} title="For Next Call">
            {analysis?.questions_for_next_call && Array.isArray(analysis.questions_for_next_call) && analysis.questions_for_next_call.length > 0 ? (
              analysis.questions_for_next_call.map((item, i) => (
                <div key={i} style={{ marginBottom: 10, padding: 10, background: T.surfaceAlt, borderRadius: 6 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.question}</div>
                  {item.context && (<div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{item.context}</div>)}
                  {item.priority && (<div style={{ marginTop: 6 }}><Badge color={priorityColor(item.priority)}>{item.priority}</Badge></div>)}
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>
        </div>

        {/* SECTION 5: Transcript */}
        <div style={sectionStyle}>Transcript</div>
        <div style={{ marginBottom: 16 }}>
          <Button onClick={() => setShowTranscript(!showTranscript)} style={{ marginBottom: showTranscript ? 12 : 0 }}>
            {showTranscript ? 'Hide Transcript' : 'Show Transcript'}
          </Button>
          {showTranscript && (
            <Card style={{ marginTop: 12 }}>
              {conversation.transcript ? (
                <div ref={el => {
                  if (!el || !excerptParam) return
                  setTimeout(() => {
                    const mark = el.querySelector('mark[data-excerpt]')
                    if (mark) { mark.scrollIntoView({ behavior: 'smooth', block: 'center' }); setTimeout(() => mark.style.background = 'transparent', 3000) }
                  }, 300)
                }} style={{
                  maxHeight: 600, overflowY: 'auto', background: T.surfaceAlt,
                  border: `1px solid ${T.border}`, padding: 16, fontSize: 12,
                  lineHeight: 1.7, whiteSpace: 'pre-wrap', fontFamily: T.mono,
                  borderRadius: 6,
                }}>
                  {(() => {
                    if (!excerptParam) return conversation.transcript
                    const idx = conversation.transcript.toLowerCase().indexOf(excerptParam.toLowerCase().substring(0, 40))
                    if (idx === -1) return conversation.transcript
                    const before = conversation.transcript.substring(0, idx)
                    const matched = conversation.transcript.substring(idx, idx + excerptParam.length + 20)
                    const after = conversation.transcript.substring(idx + excerptParam.length + 20)
                    return <>{before}<mark data-excerpt style={{ background: 'rgba(93,173,226,0.3)', padding: '2px 4px', borderRadius: 3, transition: 'background 1s' }}>{matched}</mark>{after}</>
                  })()}
                </div>
              ) : (
                <div style={{ color: T.textMuted, fontSize: 13 }}>No transcript available</div>
              )}
            </Card>
          )}
        </div>

      </div>

      {/* Generate Email Modal */}
      {showEmailGen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
          onClick={() => { if (!genLoading) { setShowEmailGen(false); setGenResult(null) } }}>
          <div onClick={e => e.stopPropagation()} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, width: 600, maxHeight: '85vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>Generate Email from This Call</div>
            </div>
            <div style={{ padding: '14px 20px' }}>
              {!genResult ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <label style={labelStyle}>Template *</label>
                    <select style={{ ...inputStyle, cursor: 'pointer' }} value={selTpl} onChange={e => setSelTpl(e.target.value)}>
                      <option value="">Select...</option>
                      {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button onClick={() => { setShowEmailGen(false); setGenResult(null) }}>Cancel</Button>
                    <Button primary disabled={!selTpl || genLoading} onClick={async () => {
                      setGenLoading(true)
                      const res = await callGenerateEmail(dealId, selTpl, conversationId)
                      setGenLoading(false)
                      if (res.error) { setGenResult({ error: res.error }) }
                      else { setGenResult({ subject: res.subject || res.email?.subject || '', body: res.body || res.email?.body || '' }) }
                    }}>{genLoading ? 'Generating...' : 'Generate'}</Button>
                  </div>
                </>
              ) : genResult.error ? (
                <div>
                  <div style={{ padding: 12, background: T.errorLight, borderRadius: 6, color: T.error, fontSize: 13, marginBottom: 12 }}>{genResult.error}</div>
                  <Button onClick={() => setGenResult(null)}>Try Again</Button>
                </div>
              ) : (
                <div>
                  <div style={{ marginBottom: 10 }}><label style={labelStyle}>Subject</label><input style={{ ...inputStyle, fontWeight: 600 }} value={genResult.subject} onChange={e => setGenResult(p => ({ ...p, subject: e.target.value }))} /></div>
                  <div style={{ marginBottom: 10 }}><label style={labelStyle}>Body</label><textarea style={{ ...inputStyle, minHeight: 250, resize: 'vertical', lineHeight: 1.7 }} value={genResult.body} onChange={e => setGenResult(p => ({ ...p, body: e.target.value }))} /></div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button onClick={() => navigator.clipboard.writeText(`Subject: ${genResult.subject}\n\n${genResult.body}`)}>Copy</Button>
                    <Button onClick={() => window.open(`mailto:?subject=${encodeURIComponent(genResult.subject)}&body=${encodeURIComponent(genResult.body)}`, '_blank')}>Open in Mail</Button>
                    <Button onClick={() => setGenResult(null)}>Regenerate</Button>
                    <Button primary onClick={() => { setShowEmailGen(false); setGenResult(null) }}>Done</Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Deal Chat Drawer */}
      <DealChat dealId={dealId} userId={profile?.id} orgId={profile?.org_id} isOpen={showChat} onClose={() => setShowChat(false)} onAction={() => loadData()} />
    </div>
  )
}
