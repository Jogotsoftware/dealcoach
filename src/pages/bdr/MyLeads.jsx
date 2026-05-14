import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T } from '../../lib/theme'
import { Button, Card, Badge } from '../../components/Shared'

// BDR My Leads — list view fed by bdr_my_lead_status (SECURITY DEFINER view,
// scoped to bdr_id = auth.uid()). Most recent first. Empty state CTAs to /bdr/submit.

const STATUS_BADGE = {
  submitted:             { color: T.textMuted, label: 'Submitted' },
  awaiting_transcript:   { color: T.warning,   label: 'Awaiting transcript' },
  ai_reviewing:          { color: T.warning,   label: 'AI reviewing' },
  denied:                { color: T.error,     label: 'Denied' },
  routed:                { color: T.success,   label: 'Routed to AE' },
  disqualified_post_qdc: { color: T.error,     label: 'Disqualified post-QDC' },
}

function formatRelative(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function BdrMyLeads() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [unreadIds, setUnreadIds] = useState(new Set())

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const { data, error: e } = await supabase
          .from('bdr_my_lead_status')
          .select('*')
          .order('deal_created_at', { ascending: false, nullsFirst: false })
        if (cancelled) return
        if (e) throw e
        // Secondary sort: most recent ai_decision_at, then by lead_id stability
        const sorted = (data || []).slice().sort((a, b) => {
          const at = a.deal_created_at || a.ai_decision_at || ''
          const bt = b.deal_created_at || b.ai_decision_at || ''
          return new Date(bt) - new Date(at)
        })
        setRows(sorted)

        // Pull unread bdr_notifications referencing these leads — used to render
        // an "unread" dot next to leads with fresh decisions/feedback the BDR
        // hasn't acknowledged yet.
        if (profile?.id) {
          const { data: notifs } = await supabase
            .from('bdr_notifications')
            .select('reference_id')
            .eq('recipient_user_id', profile.id)
            .is('read_at', null)
          if (!cancelled) {
            setUnreadIds(new Set((notifs || []).map(n => n.reference_id).filter(Boolean)))
          }
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [profile?.id])

  const counts = useMemo(() => {
    const c = { total: rows.length, routed: 0, denied: 0, disqualified: 0, in_flight: 0 }
    for (const r of rows) {
      if (r.lead_status === 'routed') c.routed++
      else if (r.lead_status === 'denied') c.denied++
      else if (r.lead_status === 'disqualified_post_qdc') c.disqualified++
      else c.in_flight++
    }
    return c
  }, [rows])

  return (
    <div>
      <div style={{
        padding: '14px 24px', borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0, flex: 1 }}>My Leads</h2>
        <Button primary onClick={() => navigate('/bdr/submit')}>+ Submit New Lead</Button>
      </div>

      <div style={{ padding: 24, maxWidth: 980 }}>
        {!loading && !error && rows.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <StatPill label="Total" value={counts.total} color={T.textSecondary} />
            <StatPill label="Routed" value={counts.routed} color={T.success} />
            <StatPill label="In-flight" value={counts.in_flight} color={T.warning} />
            <StatPill label="Denied" value={counts.denied} color={T.error} />
            <StatPill label="Post-QDC dq" value={counts.disqualified} color={T.error} />
          </div>
        )}

        {loading && (
          <Card><div style={{ padding: 20, color: T.textMuted }}>Loading your submissions…</div></Card>
        )}

        {error && (
          <Card>
            <div style={{ padding: 16, fontSize: 13, color: T.error }}>
              Could not load leads: {error}
            </div>
          </Card>
        )}

        {!loading && !error && rows.length === 0 && (
          <Card>
            <div style={{ padding: 40, textAlign: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>
                No leads submitted yet.
              </div>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16, maxWidth: 380, margin: '0 auto 16px' }}>
                Submit your first lead. AI reviews it against the active denial criteria before routing to an AE.
              </div>
              <Button primary onClick={() => navigate('/bdr/submit')}>Submit your first lead</Button>
            </div>
          </Card>
        )}

        {!loading && !error && rows.length > 0 && (
          <Card>
            <div style={{ overflow: 'hidden' }}>
              <table style={{
                width: '100%', borderCollapse: 'collapse', fontSize: 13, fontFamily: T.font,
              }}>
                <thead>
                  <tr style={{ background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                    <Th>Company</Th>
                    <Th>Status</Th>
                    <Th>Routed to</Th>
                    <Th>Last update</Th>
                    <Th width="40" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => {
                    const badge = STATUS_BADGE[r.lead_status] || { color: T.textMuted, label: r.lead_status || 'Unknown' }
                    const isUnread = unreadIds.has(r.lead_id)
                    const lastUpdate = r.ae_feedback_at || r.deal_created_at || r.routed_at || r.ai_decision_at
                    return (
                      <tr
                        key={r.lead_id}
                        onClick={() => navigate(`/bdr/leads/${r.lead_id}`)}
                        style={{
                          cursor: 'pointer',
                          borderBottom: `1px solid ${T.borderLight}`,
                          background: isUnread ? T.primaryLight : T.surface,
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = T.surfaceAlt}
                        onMouseLeave={e => e.currentTarget.style.background = isUnread ? T.primaryLight : T.surface}
                      >
                        <Td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {isUnread && <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.primary }} />}
                            <span style={{ fontWeight: 600, color: T.text }}>{r.company_name}</span>
                          </div>
                        </Td>
                        <Td><Badge color={badge.color}>{badge.label}</Badge></Td>
                        <Td>
                          {r.routed_to_ae_name
                            ? <span style={{ color: T.text }}>{r.routed_to_ae_name}</span>
                            : <span style={{ color: T.textMuted }}>—</span>}
                        </Td>
                        <Td>
                          <span style={{ color: T.textSecondary, fontSize: 12 }}>{formatRelative(lastUpdate)}</span>
                        </Td>
                        <Td>
                          <span style={{ color: T.textMuted }}>&rsaquo;</span>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </div>
  )
}

function StatPill({ label, value, color }) {
  return (
    <div style={{
      padding: '6px 12px', background: color + '10',
      border: `1px solid ${color}25`, borderRadius: 6,
      display: 'inline-flex', alignItems: 'center', gap: 6,
      fontSize: 11, fontFamily: T.font,
    }}>
      <span style={{ fontWeight: 700, color, fontSize: 14, fontFeatureSettings: '"tnum"' }}>{value}</span>
      <span style={{ color: T.textSecondary, textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>{label}</span>
    </div>
  )
}

function Th({ children, width }) {
  return (
    <th style={{
      padding: '10px 14px', textAlign: 'left',
      fontSize: 10, fontWeight: 700, color: '#8899aa',
      textTransform: 'uppercase', letterSpacing: '0.05em',
      width,
    }}>{children}</th>
  )
}

function Td({ children }) {
  return <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>{children}</td>
}
