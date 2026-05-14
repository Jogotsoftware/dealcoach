import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Button, inputStyle, labelStyle } from './Shared'

const MIN_FEEDBACK_CHARS = 30

// DisqualifyDealModal — intercepts a stage change to 'disqualified' on the deal-detail page.
// BDR-sourced deals: requires "what should the BDR have caught?" (min 30 chars) + offers
// a suppress-BDR-notification toggle. AE-self-submitted deals (no bdr_lead_id): the BDR-side
// section is hidden; an optional internal-notes textarea takes its place.
//
// Submit calls the shared `disqualify_deal_with_feedback` RPC (single source of truth),
// then fires send-bdr-notification when the RPC returns a notification payload.
//
// Props:
//   deal:     { id, org_id, bdr_lead_id, ... }
//   onClose:  () => void
//   onDone:   (result) => void   — caller updates local deal state to reflect stage=disqualified
export default function DisqualifyDealModal({ deal, onClose, onDone }) {
  const { profile } = useAuth()
  const isBdrSourced = !!deal?.bdr_lead_id
  const [reasons, setReasons] = useState([])
  const [loadingReasons, setLoadingReasons] = useState(true)
  const [reasonId, setReasonId] = useState('')
  const [feedback, setFeedback] = useState('')
  const [suppress, setSuppress] = useState(false)
  const [internalNotes, setInternalNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data, error: e } = await supabase
          .from('im_rejection_reasons')
          .select('id, code, label, applies_to')
          .eq('org_id', deal.org_id)
          .in('applies_to', ['post_qdc', 'both'])
          .eq('active', true)
          .order('sort_order', { ascending: true })
        if (cancelled) return
        if (e) throw e
        setReasons(data || [])
      } catch (err) {
        if (!cancelled) setError(`Could not load rejection reasons: ${err.message}`)
      } finally {
        if (!cancelled) setLoadingReasons(false)
      }
    }
    if (deal?.org_id) load()
    return () => { cancelled = true }
  }, [deal?.org_id])

  const feedbackOk = useMemo(() => {
    if (!isBdrSourced) return true             // not required when no BDR linked
    if (suppress) return true                   // suppressed → no BDR notification, feedback optional
    return feedback.trim().length >= MIN_FEEDBACK_CHARS
  }, [isBdrSourced, suppress, feedback])

  const canSubmit = !!reasonId && feedbackOk && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      // For AE-self submissions: feedback parameter holds the internal notes.
      // For BDR submissions (suppress=true): feedback can be empty.
      // For BDR submissions (suppress=false): feedback is the BDR-facing text.
      const feedbackPayload = isBdrSourced
        ? (suppress ? (internalNotes || null) : feedback.trim())
        : (internalNotes || null)

      const { data: rpcResult, error: rpcErr } = await supabase.rpc('disqualify_deal_with_feedback', {
        p_deal_id: deal.id,
        p_rejection_reason_id: reasonId,
        p_feedback: feedbackPayload,
        p_actor_user_id: profile.id,
        p_suppress_bdr_notification: !!suppress,
      })
      if (rpcErr) throw new Error(rpcErr.message)

      // Fire BDR notification if RPC returned a payload
      const payload = rpcResult?.notification_payload
      if (payload) {
        // Don't block the modal-close on email; we only need the in-app row written,
        // which send-bdr-notification does first before the email.
        supabase.functions.invoke('send-bdr-notification', { body: payload })
          .catch((e) => console.warn('send-bdr-notification failed (non-fatal):', e?.message))
      }

      onDone?.(rpcResult)
      onClose?.()
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: T.surface, borderRadius: 10, padding: 24,
          maxWidth: 580, width: '92%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: '0 16px 48px rgba(0,0,0,0.25)', fontFamily: T.font,
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 700, color: T.text, marginBottom: 6 }}>
          Disqualify deal
        </div>
        <div style={{ fontSize: 12, color: T.textSecondary, marginBottom: 16, lineHeight: 1.5 }}>
          The deal will move to <strong>Disqualified</strong>. An AI retrospective fires automatically.
          {isBdrSourced && !suppress && (
            <> Your feedback below goes back to the BDR who submitted this lead so they can improve.</>
          )}
          {!isBdrSourced && (
            <> This deal was submitted directly by an AE (no BDR linked). Internal notes are optional.</>
          )}
        </div>

        {/* Rejection reason */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Rejection reason *</label>
          <select
            style={inputStyle}
            value={reasonId}
            onChange={e => setReasonId(e.target.value)}
            disabled={loadingReasons}
          >
            <option value="">— Select reason —</option>
            {reasons.map(r => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
        </div>

        {isBdrSourced && (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>
                What should the BDR have caught? {!suppress && '*'}
              </label>
              <textarea
                style={{ ...inputStyle, minHeight: 110, lineHeight: 1.5, resize: 'vertical' }}
                rows={5}
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
                placeholder="Specific, actionable: what was missed during qualification? E.g. ‘BANT notes claimed budget approved but on the call the prospect said funding wasn't locked. Confirm budget explicitly before submitting.’"
                disabled={suppress}
              />
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
                {suppress
                  ? '(disabled — suppress checkbox is on)'
                  : `${feedback.trim().length} / ${MIN_FEEDBACK_CHARS} characters minimum`}
              </div>
            </div>

            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={suppress} onChange={e => setSuppress(e.target.checked)} />
              <span style={{ fontSize: 12, color: T.textSecondary }}>
                Don't surface this to the BDR (deal still moves; no notification, no handoff feedback)
              </span>
            </label>
          </>
        )}

        {!isBdrSourced && (
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Internal notes (optional)</label>
            <textarea
              style={{ ...inputStyle, minHeight: 90, lineHeight: 1.5, resize: 'vertical' }}
              rows={4}
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              placeholder="Why this AE-self-submitted deal was disqualified. Stays on the deal record only."
            />
          </div>
        )}

        {error && (
          <div style={{
            background: T.errorLight, border: `1px solid ${T.error}33`,
            borderRadius: 6, padding: '8px 12px', marginBottom: 12,
            fontSize: 12, color: T.error,
          }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button danger onClick={handleSubmit} disabled={!canSubmit}>
            {submitting ? 'Disqualifying…' : 'Disqualify deal'}
          </Button>
        </div>
      </div>
    </div>
  )
}
