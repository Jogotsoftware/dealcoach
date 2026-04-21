import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { useOrg } from '../contexts/OrgContext'
import { theme as T } from '../lib/theme'
import { Button } from './Shared'
import { detectFeatureArea, humanizePagePath, extractContextIds, captureBrowserInfo } from '../lib/feedbackContext'

const FEEDBACK_TYPES = [
  { key: 'bug', label: 'Bug' },
  { key: 'feature_request', label: 'Feature Request' },
  { key: 'confusion', label: 'Confusion' },
  { key: 'love_it', label: 'Love It' },
  { key: 'hate_it', label: 'Hate It' },
  { key: 'ai_quality', label: 'AI Quality' },
  { key: 'performance', label: 'Performance' },
  { key: 'design', label: 'Design' },
  { key: 'general', label: 'General' },
]

const SEVERITIES = [
  { key: 'low', label: 'Low', color: T.textMuted },
  { key: 'medium', label: 'Medium', color: T.warning },
  { key: 'high', label: 'High', color: '#e67e22' },
  { key: 'critical', label: 'Critical', color: T.error },
]

export default function BetaFeedbackModal({ onClose, dealContext }) {
  const { profile } = useAuth()
  const { org } = useOrg()
  const location = useLocation()

  const [feedbackType, setFeedbackType] = useState('bug')
  const [severity, setSeverity] = useState('medium')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [expectedBehavior, setExpectedBehavior] = useState('')
  const [actualBehavior, setActualBehavior] = useState('')
  const [reproSteps, setReproSteps] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  const contextIds = extractContextIds(location.pathname)
  const featureArea = detectFeatureArea(location.pathname)
  const pageLabel = humanizePagePath(location.pathname)
  const canSubmit = title.trim().length > 0 && description.trim().length >= 20

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)

    const { error: insertErr } = await supabase.from('beta_feedback').insert({
      org_id: org?.id || null,
      user_id: profile?.id,
      user_name: profile?.full_name || '',
      user_email: profile?.email || '',
      page_url: window.location.href,
      page_route: location.pathname,
      page_title: document.title,
      feature_area: featureArea,
      deal_id: contextIds.deal_id || null,
      conversation_id: contextIds.conversation_id || null,
      feedback_type: feedbackType,
      severity,
      title: title.trim(),
      description: description.trim(),
      expected_behavior: expectedBehavior.trim() || null,
      actual_behavior: actualBehavior.trim() || null,
      reproduction_steps: reproSteps.trim() || null,
      browser_info: captureBrowserInfo(),
      status: 'new',
    })

    setSubmitting(false)
    if (insertErr) {
      setError(insertErr.message)
    } else {
      setSuccess(true)
      setTimeout(onClose, 1500)
    }
  }

  function pillStyle(active, color) {
    return {
      padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: 'pointer',
      border: `1px solid ${active ? (color || T.primary) : T.border}`,
      background: active ? (color || T.primary) + '18' : 'transparent',
      color: active ? (color || T.primary) : T.textMuted,
      transition: 'all 0.15s', fontFamily: T.font,
    }
  }

  if (success) {
    return (
      <div style={{ position: 'fixed', inset: 0, zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)' }} />
        <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, padding: 40, textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: T.success, marginBottom: 8 }}>Feedback submitted</div>
          <div style={{ fontSize: 13, color: T.textMuted }}>Thank you! This helps make DealCoach better.</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={onClose} />
      <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, width: 560, maxHeight: '85vh', overflow: 'auto', padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.15)', border: `1px solid ${T.border}` }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.text }}>Beta Feedback</h3>
          <span style={{ cursor: 'pointer', fontSize: 18, color: T.textMuted, lineHeight: 1 }} onClick={onClose}>&times;</span>
        </div>

        {/* Auto-captured context */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textSecondary }}>Page: {pageLabel}</span>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textSecondary }}>{profile?.full_name} ({profile?.email})</span>
          <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: T.surfaceAlt, border: `1px solid ${T.border}`, color: T.textSecondary }}>{new Date().toLocaleString()}</span>
          {dealContext?.company_name && (
            <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: T.primaryLight, border: `1px solid ${T.primaryBorder}`, color: T.primary }}>Deal: {dealContext.company_name}</span>
          )}
        </div>

        {/* Feedback type */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Type *</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {FEEDBACK_TYPES.map(t => (
              <button key={t.key} onClick={() => setFeedbackType(t.key)} style={pillStyle(feedbackType === t.key)}>{t.label}</button>
            ))}
          </div>
        </div>

        {/* Severity */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>Severity</label>
          <div style={{ display: 'flex', gap: 4 }}>
            {SEVERITIES.map(s => (
              <button key={s.key} onClick={() => setSeverity(s.key)} style={pillStyle(severity === s.key, s.color)}>{s.label}</button>
            ))}
          </div>
        </div>

        {/* Title */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Title *</label>
            <span style={{ fontSize: 10, color: title.length > 180 ? T.error : T.textMuted }}>{title.length}/200</span>
          </div>
          <input value={title} onChange={e => setTitle(e.target.value.slice(0, 200))} placeholder="Brief summary of your feedback"
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font }} />
        </div>

        {/* Description */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
            <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Description *</label>
            <span style={{ fontSize: 10, color: description.length < 20 && description.length > 0 ? T.error : T.textMuted }}>{description.length} chars {description.length < 20 && description.length > 0 ? '(min 20)' : ''}</span>
          </div>
          <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe what happened, what you expected, or what you'd like to see..."
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.text, fontFamily: T.font, minHeight: 80, resize: 'vertical' }} />
        </div>

        {/* Expandable detail section */}
        {!showMore ? (
          <button onClick={() => setShowMore(true)} style={{ background: 'none', border: 'none', color: T.primary, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 0', marginBottom: 10, fontFamily: T.font }}>+ Add more detail</button>
        ) : (
          <div style={{ marginBottom: 10, padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Expected Behavior</label>
              <textarea value={expectedBehavior} onChange={e => setExpectedBehavior(e.target.value)} placeholder="What should have happened?"
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, minHeight: 50, resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Actual Behavior</label>
              <textarea value={actualBehavior} onChange={e => setActualBehavior(e.target.value)} placeholder="What actually happened?"
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, minHeight: 50, resize: 'vertical' }} />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase', display: 'block', marginBottom: 3 }}>Steps to Reproduce</label>
              <textarea value={reproSteps} onChange={e => setReproSteps(e.target.value)} placeholder="1. Go to...\n2. Click...\n3. See error..."
                style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.text, fontFamily: T.font, minHeight: 50, resize: 'vertical' }} />
            </div>
          </div>
        )}

        {/* Error */}
        {error && <div style={{ color: T.error, fontSize: 12, marginBottom: 10, padding: 8, background: T.errorLight, borderRadius: 6 }}>{error}</div>}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button primary onClick={handleSubmit} disabled={!canSubmit || submitting}>{submitting ? 'Submitting...' : 'Submit Feedback'}</Button>
        </div>
      </div>
    </div>
  )
}
