import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatDateLong } from '../lib/theme'
import { Card, Badge, Button, Spinner } from '../components/Shared'

export default function DealRetrospective() {
  const { id: dealId } = useParams()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [retro, setRetro] = useState(null)
  const [deal, setDeal] = useState(null)
  const [loading, setLoading] = useState(true)
  const [agreement, setAgreement] = useState(null)
  const [repNotes, setRepNotes] = useState('')

  useEffect(() => { loadRetro() }, [dealId])

  async function loadRetro() {
    setLoading(true)
    const [retroRes, dealRes] = await Promise.all([
      supabase.from('deal_retrospectives').select('*').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(1).single(),
      supabase.from('deals').select('company_name, stage, deal_value').eq('id', dealId).single(),
    ])
    setRetro(retroRes.data || null)
    setDeal(dealRes.data || null)
    if (retroRes.data) {
      setAgreement(retroRes.data.rep_agreement || null)
      setRepNotes(retroRes.data.rep_notes || '')
    }
    setLoading(false)
  }

  async function saveAgreement(value) {
    setAgreement(value)
    await supabase.from('deal_retrospectives').update({ rep_agreement: value, rep_notes: repNotes }).eq('id', retro.id)
  }

  async function publishToOrg() {
    if (!confirm('Publish this retrospective to your organization? Team members will be able to see it.')) return
    await supabase.from('deal_retrospectives').update({ visibility: 'org', published_to_org_at: new Date().toISOString() }).eq('id', retro.id)
    setRetro(prev => ({ ...prev, visibility: 'org', published_to_org_at: new Date().toISOString() }))
  }

  async function generateRetro() {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-deal-retrospective`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      body: JSON.stringify({ deal_id: dealId }),
    })
    loadRetro()
  }

  if (loading) return <Spinner />

  const outcomeColors = { closed_won: T.success, closed_lost: T.error, disqualified: T.textMuted }

  return (
    <div>
      <div style={{ padding: '14px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(`/deal/${dealId}`)} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Deal</button>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Deal Retrospective</h2>
          {deal && <span style={{ fontSize: 14, color: T.textMuted }}>{deal.company_name}</span>}
          {deal && <Badge color={outcomeColors[deal.stage] || T.textMuted}>{deal.stage?.replace(/_/g, ' ')}</Badge>}
        </div>
      </div>

      <div style={{ padding: '16px 24px', maxWidth: 800 }}>
        {!retro ? (
          <Card>
            <div style={{ textAlign: 'center', padding: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.text, marginBottom: 8 }}>No retrospective yet</div>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 16 }}>Generate an AI retrospective analyzing this deal's outcome, prediction accuracy, and lessons learned.</div>
              <Button primary onClick={generateRetro}>Generate Retrospective</Button>
            </div>
          </Card>
        ) : (
          <>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12 }}>
              Generated {formatDateLong(retro.created_at)} using {retro.ai_model_used}
              {retro.visibility === 'org' && <Badge color={T.success} style={{ marginLeft: 8 }}>Published to org</Badge>}
            </div>

            {retro.prediction_accuracy && (
              <Card title="Prediction Accuracy" style={{ borderLeft: `3px solid ${T.primary}` }}>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}>{retro.prediction_accuracy}</div>
              </Card>
            )}

            {retro.execution_quality && (
              <Card title="Execution Quality" style={{ borderLeft: `3px solid ${T.warning}` }}>
                <div style={{ fontSize: 13, lineHeight: 1.7, color: T.text }}>{retro.execution_quality}</div>
              </Card>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {retro.what_worked?.length > 0 && (
                <Card title="What Worked" style={{ borderLeft: `3px solid ${T.success}` }}>
                  {retro.what_worked.map((item, i) => <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: i < retro.what_worked.length - 1 ? `1px solid ${T.borderLight}` : 'none', lineHeight: 1.6 }}>{item}</div>)}
                </Card>
              )}
              {retro.what_didnt_work?.length > 0 && (
                <Card title="What Didn't Work" style={{ borderLeft: `3px solid ${T.error}` }}>
                  {retro.what_didnt_work.map((item, i) => <div key={i} style={{ fontSize: 12, padding: '4px 0', borderBottom: i < retro.what_didnt_work.length - 1 ? `1px solid ${T.borderLight}` : 'none', lineHeight: 1.6 }}>{item}</div>)}
                </Card>
              )}
            </div>

            {retro.key_lessons?.length > 0 && (
              <Card title="Key Lessons" style={{ borderLeft: `3px solid #8b5cf6` }}>
                {retro.key_lessons.map((item, i) => <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < retro.key_lessons.length - 1 ? `1px solid ${T.borderLight}` : 'none', lineHeight: 1.6 }}>{item}</div>)}
              </Card>
            )}

            {retro.improvement_suggestions?.length > 0 && (
              <Card title="Improvement Suggestions">
                {retro.improvement_suggestions.map((item, i) => <div key={i} style={{ fontSize: 12, padding: '6px 0', borderBottom: i < retro.improvement_suggestions.length - 1 ? `1px solid ${T.borderLight}` : 'none', lineHeight: 1.6 }}>{item}</div>)}
              </Card>
            )}

            {/* Rep feedback */}
            <Card title="Your Assessment">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                {['agree', 'partial', 'disagree'].map(v => (
                  <button key={v} onClick={() => saveAgreement(v)} style={{
                    padding: '6px 16px', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font,
                    border: `1px solid ${agreement === v ? T.primary : T.border}`,
                    background: agreement === v ? T.primaryLight : 'transparent',
                    color: agreement === v ? T.primary : T.textMuted,
                  }}>{v.charAt(0).toUpperCase() + v.slice(1)}</button>
                ))}
              </div>
              <textarea value={repNotes} onChange={e => setRepNotes(e.target.value)} onBlur={() => { if (retro) supabase.from('deal_retrospectives').update({ rep_notes: repNotes }).eq('id', retro.id) }}
                placeholder="Optional notes on this retrospective..."
                style={{ width: '100%', padding: '8px 12px', fontSize: 12, border: `1px solid ${T.border}`, borderRadius: 6, minHeight: 60, resize: 'vertical', fontFamily: T.font, color: T.text }} />
            </Card>

            {retro.visibility === 'rep_only' && (
              <div style={{ marginTop: 12 }}>
                <Button primary onClick={publishToOrg}>Publish to Organization</Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
