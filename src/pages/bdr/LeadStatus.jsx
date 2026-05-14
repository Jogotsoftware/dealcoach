import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Button, Card, Badge } from '../../components/Shared'

// BDR Lead detail view. Reads bdr_my_lead_status for the joined projection
// (deal stage, AE name, dq reason, feedback) and bdr_notes for the BANT block.
// Also reads the lead's submitted fields directly for the "Submission" card.
// Auto-marks bdr_notifications for this lead as read on view.

const STATUS_BADGE = {
  submitted:             { color: T.textMuted, label: 'Submitted' },
  awaiting_transcript:   { color: T.warning,   label: 'Awaiting transcript' },
  ai_reviewing:          { color: T.warning,   label: 'AI reviewing' },
  denied:                { color: T.error,     label: 'Denied — see feedback' },
  routed:                { color: T.success,   label: 'Routed to AE' },
  disqualified_post_qdc: { color: T.error,     label: 'Disqualified post-QDC' },
}

function formatRevenue(n) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US')
}

function formatDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default function BdrLeadStatus() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [statusRow, setStatusRow] = useState(null)
  const [leadRow, setLeadRow] = useState(null)
  const [bantNote, setBantNote] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // bdr_my_lead_status: the constrained projection (deal_stage, AE name, dq reason, feedback)
        const { data: status, error: statusErr } = await supabase
          .from('bdr_my_lead_status')
          .select('*')
          .eq('lead_id', id)
          .maybeSingle()
        if (statusErr) throw statusErr
        if (!status) throw new Error('Lead not found, or you do not have permission to view it.')

        // bdr_leads: the raw submission for the "Submission" card.
        // RLS lets the BDR read their own row (bdr_id = auth.uid()).
        const { data: lead, error: leadErr } = await supabase
          .from('bdr_leads')
          .select('id, company_name, website, employee_count, tech_stack, annual_revenue, num_entities, accounting_team_size, industry, vertical, hq_state, transcript, created_at, ai_decision_at, routed_at')
          .eq('id', id)
          .maybeSingle()
        if (leadErr) throw leadErr

        // BANT note
        const { data: notes } = await supabase
          .from('bdr_notes')
          .select('content, created_at')
          .eq('lead_id', id)
          .eq('note_type', 'bant')
          .order('created_at', { ascending: true })
          .limit(1)

        if (cancelled) return
        setStatusRow(status)
        setLeadRow(lead)
        setBantNote((notes || [])[0] || null)

        // Auto-mark any unread bdr_notifications for this lead as read.
        if (profile?.id) {
          await supabase
            .from('bdr_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('recipient_user_id', profile.id)
            .eq('reference_id', id)
            .is('read_at', null)
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, profile?.id])

  const badge = STATUS_BADGE[statusRow?.lead_status] || { color: T.textMuted, label: statusRow?.lead_status || 'Unknown' }

  // Timeline events derived from row data
  const timeline = []
  if (leadRow?.created_at) timeline.push({ label: 'Lead submitted', at: leadRow.created_at })
  if (leadRow?.ai_decision_at) {
    timeline.push({
      label: statusRow?.ai_decision === 'approved' ? 'AI approved' : statusRow?.ai_decision === 'denied' ? 'AI denied' : 'AI reviewed',
      at: leadRow.ai_decision_at,
      color: statusRow?.ai_decision === 'approved' ? T.success : T.error,
    })
  }
  if (leadRow?.routed_at) {
    timeline.push({
      label: statusRow?.routed_to_ae_name ? `Routed to ${statusRow.routed_to_ae_name}` : 'Routed',
      at: leadRow.routed_at,
      color: T.success,
    })
  }
  if (statusRow?.deal_stage === 'disqualified' && statusRow?.ae_feedback_at) {
    timeline.push({
      label: 'AE disqualified post-QDC',
      at: statusRow.ae_feedback_at,
      color: T.error,
    })
  }

  return (
    <div>
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button
          type="button"
          onClick={() => navigate('/bdr/my-leads')}
          style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}
        >&larr; My Leads</button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>Lead Detail</h2>
        <Button onClick={() => navigate('/bdr/submit')}>+ Submit New Lead</Button>
      </div>

      <div style={{ padding: 24, maxWidth: 880 }}>
        {loading && <Card><div style={{ padding: 20, color: T.textMuted }}>Loading…</div></Card>}

        {error && (
          <Card>
            <div style={{ padding: 16, fontSize: 13, color: T.error }}>
              {error}
              <div style={{ marginTop: 10 }}>
                <Button onClick={() => navigate('/bdr/my-leads')}>Back to My Leads</Button>
              </div>
            </div>
          </Card>
        )}

        {statusRow && !loading && !error && (
          <>
            {/* Header card: company + status */}
            <Card>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
                <h3 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>
                  {statusRow.company_name}
                </h3>
                <Badge color={badge.color}>{badge.label}</Badge>
              </div>
              {statusRow.routed_to_ae_name && (
                <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 6 }}>
                  Routed to <strong style={{ color: T.text }}>{statusRow.routed_to_ae_name}</strong>{statusRow.routed_at ? ` on ${formatDateTime(statusRow.routed_at)}` : ''}
                </div>
              )}
              {statusRow.deal_stage && (
                <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2 }}>
                  Current deal stage: <strong>{statusRow.deal_stage}</strong>
                </div>
              )}
            </Card>

            {/* AI decision */}
            <Card title="AI First-Glance Decision">
              {statusRow.ai_decision === 'pending' && (
                <div style={{ fontSize: 13, color: T.textSecondary }}>
                  AI is still reviewing this submission. Refresh in a few seconds.
                </div>
              )}
              {statusRow.ai_decision === 'approved' && (
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.5 }}>
                  <strong style={{ color: T.success }}>Approved.</strong> {statusRow.ai_decision_reason}
                </div>
              )}
              {statusRow.ai_decision === 'denied' && (
                <div>
                  <div style={{ fontSize: 13, color: T.text, marginBottom: 10, lineHeight: 1.5 }}>
                    <strong style={{ color: T.error }}>Denied.</strong> {statusRow.ai_decision_reason}
                  </div>
                  {Array.isArray(statusRow.ai_decision_criteria_triggered) && statusRow.ai_decision_criteria_triggered.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: T.textSecondary, textTransform: 'uppercase', marginBottom: 6, letterSpacing: '0.05em' }}>
                        Criteria triggered
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: T.text, lineHeight: 1.6 }}>
                        {statusRow.ai_decision_criteria_triggered.map((c, i) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* AE handoff feedback (post-QDC disqualification) */}
            {statusRow.ae_feedback_notes && (
              <Card title="AE Handoff Feedback">
                <div style={{ fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                  {statusRow.ae_feedback_notes}
                </div>
                {statusRow.disqualification_reason && (
                  <div style={{ marginTop: 10, fontSize: 12, color: T.textSecondary }}>
                    Rejection reason: <strong style={{ color: T.text }}>{statusRow.disqualification_reason}</strong>
                  </div>
                )}
                {statusRow.ae_feedback_at && (
                  <div style={{ marginTop: 4, fontSize: 11, color: T.textMuted }}>
                    {formatDateTime(statusRow.ae_feedback_at)}
                  </div>
                )}
              </Card>
            )}

            {/* Submission details */}
            {leadRow && (
              <Card title="Submission">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' }}>
                  <DetailRow label="Company" value={leadRow.company_name} />
                  <DetailRow label="Website" value={leadRow.website} link />
                  <DetailRow label="Employees" value={leadRow.employee_count} />
                  <DetailRow label="Annual Revenue" value={formatRevenue(leadRow.annual_revenue)} />
                  <DetailRow label="Number of Entities" value={leadRow.num_entities} />
                  <DetailRow label="Accounting Team Size" value={leadRow.accounting_team_size} />
                  <DetailRow label="Industry" value={leadRow.industry} />
                  <DetailRow label="Vertical" value={leadRow.vertical} />
                  <DetailRow label="HQ State" value={leadRow.hq_state} />
                  <DetailRow label="Submitted" value={formatDateTime(leadRow.created_at)} />
                </div>
                <div style={{ marginTop: 12 }}>
                  <DetailRow label="Tech Stack / Integrations" value={(leadRow.tech_stack || []).join(', ') || '—'} />
                </div>
              </Card>
            )}

            {/* BANT */}
            {bantNote && (
              <Card title="BANT Notes">
                <div style={{
                  fontSize: 13, color: T.text, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  fontFamily: T.font,
                }}>
                  {bantNote.content}
                </div>
              </Card>
            )}

            {/* Transcript */}
            {leadRow?.transcript && (
              <Card title="Call Transcript">
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, marginBottom: 8 }}>
                    Show transcript ({leadRow.transcript.length.toLocaleString()} characters)
                  </summary>
                  <pre style={{
                    marginTop: 4, padding: 10, background: T.surfaceAlt,
                    border: `1px solid ${T.border}`, borderRadius: 6,
                    fontSize: 11, fontFamily: T.mono, color: T.text,
                    maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap',
                  }}>{leadRow.transcript}</pre>
                </details>
              </Card>
            )}

            {/* Timeline */}
            {timeline.length > 0 && (
              <Card title="Timeline">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {timeline.map((e, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: e.color || T.textMuted, marginTop: 5, flexShrink: 0,
                      }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{e.label}</div>
                        <div style={{ fontSize: 11, color: T.textMuted }}>{formatDateTime(e.at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value, link }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 13, color: T.text }}>
        {value == null || value === '' || value === '—'
          ? <span style={{ color: T.textMuted, fontStyle: 'italic' }}>Unknown</span>
          : link && typeof value === 'string' && /^https?:\/\//i.test(value)
            ? <a href={value} target="_blank" rel="noopener noreferrer" style={{ color: T.primary, textDecoration: 'none' }}>{value}</a>
            : value}
      </div>
    </div>
  )
}
