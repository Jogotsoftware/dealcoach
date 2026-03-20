import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatDateLong } from '../lib/theme'
import { Card, Badge, ScoreBar, Button, Spinner } from '../components/Shared'

export default function CallDetail() {
  const { dealId, conversationId } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [conversation, setConversation] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [companyName, setCompanyName] = useState('')

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
    setLoading(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
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
    if (q === 'good') return 'rgba(40, 167, 69, 0.08)'
    if (q === 'adequate') return 'rgba(245, 158, 11, 0.08)'
    if (q === 'missed_opportunity') return 'rgba(220, 53, 69, 0.08)'
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
  ]

  return (
    <div style={{ fontFamily: T.font }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 24px',
        background: T.surface, borderBottom: `1px solid ${T.border}`,
        boxShadow: T.shadow, flexWrap: 'wrap',
      }}>
        <Button onClick={() => navigate(`/deal/${dealId}`)} style={{ padding: '6px 12px', fontSize: 12 }}>
          Back to {companyName || 'Deal'}
        </Button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{conversation.title || 'Untitled Call'}</div>
          <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>
            {conversation.call_date ? formatDateLong(conversation.call_date) : 'No date'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {conversation.call_type && <Badge color={T.primary}>{conversation.call_type}</Badge>}
          {conversation.processed && <Badge color={T.success}>Processed</Badge>}
        </div>
      </div>

      {/* Two-column layout */}
      <div style={{ display: 'flex', gap: 24, padding: 24, alignItems: 'flex-start' }}>
        {/* LEFT column */}
        <div style={{ flex: 6, minWidth: 0 }}>
          <Card title="Transcript">
            {conversation.transcript ? (
              <div style={{
                maxHeight: 600, overflowY: 'auto', background: T.surfaceAlt,
                border: `1px solid ${T.border}`, padding: 16, fontSize: 12,
                lineHeight: 1.6, whiteSpace: 'pre-wrap', fontFamily: T.mono,
                borderRadius: 6,
              }}>
                {conversation.transcript}
              </div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No transcript available</div>
            )}
          </Card>
        </div>

        {/* RIGHT column */}
        <div style={{ flex: 4, minWidth: 0 }}>
          {/* AI Summary */}
          <Card title="AI Summary">
            {summaryText ? (
              <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{summaryText}</div>
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No summary available</div>
            )}
          </Card>

          {/* Coaching Notes */}
          <Card title="Coaching Notes">
            {analysis ? (
              <>
                {analysis.strengths && (
                  <div style={{ borderLeft: `3px solid ${T.success}`, paddingLeft: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.success, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Strengths</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.strengths}</div>
                  </div>
                )}
                {analysis.improvements && (
                  <div style={{ borderLeft: `3px solid ${T.error}`, paddingLeft: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.error, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Areas to Improve</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.improvements}</div>
                  </div>
                )}
                {analysis.methodology_gaps && (
                  <div style={{ borderLeft: `3px solid ${T.warning}`, paddingLeft: 12, marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.warning, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>Methodology Gaps</div>
                    <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{analysis.methodology_gaps}</div>
                  </div>
                )}
                {!analysis.strengths && !analysis.improvements && !analysis.methodology_gaps && (
                  <div style={{ color: T.textMuted, fontSize: 13 }}>No coaching data available</div>
                )}
              </>
            ) : (
              conversation.ai_coaching_notes ? (
                <div style={{ fontSize: 13, lineHeight: 1.6, color: T.text }}>{conversation.ai_coaching_notes}</div>
              ) : (
                <div style={{ color: T.textMuted, fontSize: 13 }}>No coaching notes available</div>
              )
            )}
          </Card>

          {/* Call Score */}
          {analysis && analysis.overall_score != null && (
            <Card title="Call Score">
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <div style={{
                  fontSize: 48, fontWeight: 700, color: scoreColor(analysis.overall_score),
                  lineHeight: 1,
                }}>
                  {analysis.overall_score}
                </div>
                {analysis.scored_by && (
                  <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>Scored by {analysis.scored_by}</div>
                )}
              </div>

              {/* score_breakdown JSONB */}
              {analysis.score_breakdown && typeof analysis.score_breakdown === 'object' && (
                <div style={{ marginBottom: 12 }}>
                  {Object.entries(analysis.score_breakdown).map(([key, value]) => (
                    <ScoreBar key={key} label={key} score={value} />
                  ))}
                </div>
              )}

              {/* Individual scores */}
              {individualScores
                .filter(s => analysis[s.key] != null)
                .map(s => (
                  <ScoreBar key={s.key} label={s.label} score={analysis[s.key]} max={10} />
                ))
              }
            </Card>
          )}

          {/* Questions That Should Have Been Asked */}
          <Card title="Questions That Should Have Been Asked">
            {analysis?.questions_should_have_asked && Array.isArray(analysis.questions_should_have_asked) && analysis.questions_should_have_asked.length > 0 ? (
              analysis.questions_should_have_asked.map((item, i) => (
                <div key={i} style={{
                  marginBottom: 12, padding: 10, background: T.surfaceAlt, borderRadius: 6,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.question}</div>
                  {item.reason && (
                    <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{item.reason}</div>
                  )}
                  {item.methodology && (
                    <div style={{ marginTop: 6 }}><Badge color={T.primary}>{item.methodology}</Badge></div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          {/* Questions for Next Call */}
          <Card title="Questions for Next Call">
            {analysis?.questions_for_next_call && Array.isArray(analysis.questions_for_next_call) && analysis.questions_for_next_call.length > 0 ? (
              analysis.questions_for_next_call.map((item, i) => (
                <div key={i} style={{
                  marginBottom: 12, padding: 10, background: T.surfaceAlt, borderRadius: 6,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{item.question}</div>
                  {item.context && (
                    <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{item.context}</div>
                  )}
                  {item.priority && (
                    <div style={{ marginTop: 6 }}><Badge color={priorityColor(item.priority)}>{item.priority}</Badge></div>
                  )}
                </div>
              ))
            ) : (
              <div style={{ color: T.textMuted, fontSize: 13 }}>No data</div>
            )}
          </Card>

          {/* Questions Asked */}
          <Card title="Questions Asked">
            {analysis?.questions_asked && Array.isArray(analysis.questions_asked) && analysis.questions_asked.length > 0 ? (
              analysis.questions_asked.map((item, i) => (
                <div key={i} style={{
                  marginBottom: 12, padding: 10, background: qualityColor(item.quality), borderRadius: 6,
                }}>
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
        </div>
      </div>
    </div>
  )
}
