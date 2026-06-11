import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { Button, inputStyle, labelStyle } from './Shared'
import { track } from '../lib/analytics'

// Close-out modal for Won / Lost — the single close transaction for the app.
// Owns the full write: deals.stage + stage_changed_at + closed_at (previously
// no path persisted closed_at, so closed deals vanished from quota/goals
// math), the deal_outcome_factors learning-loop row, the analytics event, and
// the retrospective kick. Skip still closes properly; Cancel changes nothing.
//
// props:
//   deal     — { id, org_id, company_name, deal_value, cmrr }
//   outcome  — 'closed_won' | 'closed_lost'
//   onClose  — () => void                 (cancel; no writes happened)
//   onDone   — (outcome) => void          (deal is closed; update local state)
const WON_REASONS = [
  ['product_fit', 'Product fit'],
  ['champion_strength', 'Strong champion'],
  ['compelling_event', 'Compelling event / urgency'],
  ['competitive_win', 'Won against competitor'],
  ['price_value', 'Price / value'],
  ['relationship', 'Relationship / trust'],
  ['other_won', 'Other'],
]
const LOST_REASONS = [
  ['lost_to_competitor', 'Lost to competitor'],
  ['no_decision', 'No decision / status quo'],
  ['budget', 'Budget constraints'],
  ['timing', 'Timing / not ready'],
  ['product_gap', 'Product gap'],
  ['champion_left', 'Champion left / changed'],
  ['other_lost', 'Other'],
]

export default function CloseDealModal({ deal, outcome, onClose, onDone }) {
  const { profile } = useAuth()
  const [form, setForm] = useState({ primary_reason: '', what_helped: '', key_lesson: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const won = outcome === 'closed_won'

  async function closeDeal({ skipped }) {
    setSubmitting(true)
    setError(null)
    try {
      const now = new Date().toISOString()
      const { error: dealErr } = await supabase.from('deals')
        .update({ stage: outcome, stage_changed_at: now, closed_at: now })
        .eq('id', deal.id)
      if (dealErr) throw new Error(dealErr.message)

      const { error: ofErr } = await supabase.from('deal_outcome_factors').insert({
        deal_id: deal.id,
        org_id: deal.org_id || profile?.org_id || null,
        rep_id: profile?.id || null,
        outcome,
        primary_reason: skipped ? 'dismissed' : form.primary_reason,
        what_helped_or_hurt: skipped ? null : form.what_helped,
        key_lesson: skipped ? null : form.key_lesson,
        filled_by: profile?.id || null,
        ...(skipped ? { structured_factors: { dismissed: true } } : {}),
      })
      if (ofErr) console.error('deal_outcome_factors insert failed:', ofErr)

      track('deal_closed', {
        outcome, skipped: !!skipped,
        primary_reason: skipped ? 'dismissed' : form.primary_reason,
        deal_value: deal?.deal_value || null, cmrr: deal?.cmrr || null,
      })

      // Immediate retrospective kick (the DB trigger also queues one).
      if (!skipped) {
        try {
          fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-deal-retrospective`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, 'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
            body: JSON.stringify({ deal_id: deal.id }),
          }).catch(() => {})
        } catch (e) { /* fire-and-forget */ }
      }

      if (onDone) onDone(outcome)
      onClose()
    } catch (e) {
      console.error('[CloseDealModal]', e)
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }

  const canSubmit = form.primary_reason && form.what_helped && form.key_lesson && !submitting

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)' }} />
      <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, padding: 28, width: 480, maxWidth: '92vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', border: `1px solid ${T.border}`, borderTop: `4px solid ${won ? T.success : T.error}` }}>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 700, color: T.text }}>
          {won ? 'Close as Won' : 'Close as Lost'} — {deal.company_name}
        </h3>
        <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>
          Quick close-out to capture learnings. Takes under 60 seconds; the AI retrospective runs automatically.
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>Primary Reason *</label>
          <select style={{ ...inputStyle, cursor: 'pointer' }} value={form.primary_reason} onChange={e => setForm(p => ({ ...p, primary_reason: e.target.value }))}>
            <option value="">Select...</option>
            {(won ? WON_REASONS : LOST_REASONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label style={labelStyle}>What helped or hurt most? *</label>
          <input style={inputStyle} value={form.what_helped} onChange={e => setForm(p => ({ ...p, what_helped: e.target.value }))} placeholder="One sentence..." />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Key lesson *</label>
          <input style={inputStyle} value={form.key_lesson} onChange={e => setForm(p => ({ ...p, key_lesson: e.target.value }))} placeholder="What would you do differently?" />
        </div>
        {error && <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 6, background: T.errorLight, color: T.error, fontSize: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
          <Button disabled={submitting} onClick={() => closeDeal({ skipped: true })} style={{ fontSize: 11, color: T.textMuted }}>Skip & close</Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button disabled={submitting} onClick={onClose}>Cancel</Button>
            <Button primary disabled={!canSubmit} onClick={() => closeDeal({ skipped: false })}>
              {submitting ? 'Closing…' : won ? 'Close Won' : 'Close Lost'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
