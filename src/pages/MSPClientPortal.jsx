import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T, formatDate, formatDateLong, daysUntil } from '../lib/theme'
import { Spinner } from '../components/Shared'

const STATUS_COLORS = { pending: '#d1d5db', in_progress: '#5DADE2', completed: '#28a745', blocked: '#dc3545' }

export default function MSPClientPortal() {
  const { token } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deal, setDeal] = useState(null)
  const [steps, setSteps] = useState([])
  const [resources, setResources] = useState([])
  const [portal, setPortal] = useState(null)

  useEffect(() => { loadPortal() }, [token])

  async function loadPortal() {
    setLoading(true)
    try {
      const { data: link, error: linkErr } = await supabase
        .from('msp_shared_links').select('*').eq('share_token', token).eq('is_active', true).single()

      if (linkErr || !link) { setError('This link is invalid or has expired.'); return }
      if (link.expires_at && new Date(link.expires_at) < new Date()) { setError('This link has expired.'); return }

      await supabase.from('msp_shared_links')
        .update({ access_count: (link.access_count || 0) + 1, last_accessed: new Date().toISOString() })
        .eq('id', link.id)

      const dealId = link.deal_id
      const [dealRes, stepsRes, resRes, portalRes] = await Promise.all([
        supabase.from('deals').select('company_name, website, target_close_date').eq('id', dealId).single(),
        supabase.from('msp_stages').select('*').eq('deal_id', dealId).order('stage_order'),
        supabase.from('msp_resources').select('*').eq('deal_id', dealId).order('created_at'),
        supabase.from('msp_customer_portals').select('*').eq('deal_id', dealId).eq('is_active', true).limit(1),
      ])

      setDeal(dealRes.data)
      setSteps(stepsRes.data || [])
      setResources(resRes.data || [])
      setPortal(portalRes.data?.[0] || null)
    } catch (err) {
      console.error('Portal error:', err)
      setError('Something went wrong loading this page.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font }}>
      <Spinner />
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font }}>
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>&#128274;</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>{error}</div>
        <div style={{ fontSize: 13, color: T.textSecondary }}>Contact your account representative for a new link.</div>
      </div>
    </div>
  )

  const primaryColor = portal?.primary_color || '#5DADE2'
  const accentColor = portal?.accent_color || '#00C2FF'
  const completedSteps = steps.filter(s => s.is_completed).length
  const progressPct = steps.length > 0 ? Math.round((completedSteps / steps.length) * 100) : 0

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', fontFamily: T.font }}>
      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '24px 32px', textAlign: 'center' }}>
        {portal?.company_logo_url && <img src={portal.company_logo_url} alt="" style={{ height: 40, marginBottom: 12 }} />}
        <div style={{ fontSize: 12, fontWeight: 600, color: primaryColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
          {portal?.portal_title || 'Mutual Success Plan'}
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color: T.text }}>{deal?.company_name || 'Implementation Plan'}</div>
        {portal?.portal_subtitle && <div style={{ fontSize: 14, color: T.textSecondary, marginTop: 4 }}>{portal.portal_subtitle}</div>}

        <div style={{ maxWidth: 500, margin: '20px auto 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: T.textSecondary }}>Progress</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: primaryColor }}>{progressPct}%</span>
          </div>
          <div style={{ height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progressPct}%`, borderRadius: 4, background: `linear-gradient(90deg, ${primaryColor}, ${accentColor})`, transition: 'width 0.8s ease' }} />
          </div>
          <div style={{ fontSize: 11, color: T.textMuted, marginTop: 4 }}>
            {completedSteps} of {steps.length} steps completed
            {deal?.target_close_date && ` | Target: ${formatDateLong(deal.target_close_date)}`}
          </div>
        </div>
      </div>

      {/* Timeline — flat steps */}
      <div style={{ maxWidth: 800, margin: '0 auto', padding: '32px 24px' }}>
        {steps.map((step, si) => {
          const days = daysUntil(step.due_date)
          const statusColor = STATUS_COLORS[step.status] || '#d1d5db'
          return (
            <div key={step.id} style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
              {/* Status circle */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: statusColor, color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 700,
              }}>
                {step.is_completed ? '\u2713' : step.status === 'blocked' ? '!' : si + 1}
              </div>

              <div style={{
                flex: 1, padding: '14px 18px', background: '#fff', borderRadius: 8,
                border: `1px solid ${step.is_completed ? '#28a74530' : '#e5e7eb'}`,
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{
                    fontSize: 14, fontWeight: 600, color: T.text,
                    textDecoration: step.is_completed ? 'line-through' : 'none',
                    opacity: step.is_completed ? 0.6 : 1,
                  }}>
                    {step.stage_name}
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: statusColor,
                      padding: '2px 6px', borderRadius: 3, background: statusColor + '15',
                    }}>{step.status}</span>
                    {step.due_date && <span style={{ fontSize: 12, color: T.textSecondary }}>{formatDate(step.due_date)}</span>}
                  </div>
                </div>
                {step.notes && (
                  <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 6, lineHeight: 1.5 }}>{step.notes}</div>
                )}
              </div>
            </div>
          )
        })}

        {/* Resources */}
        {resources.length > 0 && (portal?.show_documents !== false) && (
          <div style={{ marginTop: 40 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 12 }}>Resources</div>
            {resources.map(r => (
              <div key={r.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 18px', background: '#fff', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 8,
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text }}>{r.resource_name}</div>
                  {r.description && <div style={{ fontSize: 12, color: T.textSecondary }}>{r.description}</div>}
                </div>
                {r.resource_url && (
                  <a href={r.resource_url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: primaryColor, fontWeight: 600, textDecoration: 'none' }}>View &rarr;</a>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: 48, paddingTop: 24, borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 12, color: T.textMuted }}>Powered by DealCoach</div>
        </div>
      </div>
    </div>
  )
}
