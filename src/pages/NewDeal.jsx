import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { callResearchFunction } from '../lib/webhooks'
import { track } from '../lib/analytics'
import { theme as T, STAGES, FORECAST_CATEGORIES } from '../lib/theme'
import { Button, Card, inputStyle, labelStyle } from '../components/Shared'

export default function NewDeal() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [createdMsg, setCreatedMsg] = useState(null)
  // Default close date 3 months out
  const [defaultCloseDate] = useState(() => {
    const d = new Date()
    d.setMonth(d.getMonth() + 3)
    return d.toISOString().split('T')[0]
  })

  const [form, setForm] = useState({
    company_name: '', website: '', stage: 'qualify', forecast_category: 'pipeline',
    cmrr: '', deal_value: '', target_close_date: defaultCloseDate, notes: '',
    contact_name: '', contact_title: '', contact_email: '',
  })

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.company_name.trim()) return
    setSaving(true)
    setError(null)

    try {
      const { data, error: insertErr } = await supabase
        .from('deals')
        .insert({
          rep_id: profile.id,
          company_name: form.company_name.trim(),
          website: form.website.trim() || null,
          stage: form.stage,
          forecast_category: form.forecast_category,
          cmrr: Number(form.cmrr) || null,
          deal_value: Number(form.deal_value) || null,
          target_close_date: form.target_close_date || null,
          notes: form.notes.trim() || null,
        })
        .select()
        .single()

      if (insertErr) throw insertErr

      // Create contact if name provided
      if (form.contact_name.trim()) {
        await supabase.from('contacts').insert({
          deal_id: data.id,
          name: form.contact_name.trim(),
          title: form.contact_title.trim() || null,
          email: form.contact_email.trim() || null,
          role_in_deal: 'Primary Contact',
          influence_level: 'Unknown',
        })
      }

      track('deal_created', { stage: form.stage, forecast_category: form.forecast_category, deal_value: Number(form.deal_value) || null, cmrr: Number(form.cmrr) || null })

      // The DB trigger auto-creates company_profile and deal_analysis
      // Show toast and kick off research
      setCreatedMsg(`Deal created. AI is researching ${form.company_name.trim()}...`)
      callResearchFunction(data.id).catch(err =>
        console.warn('Research failed:', err)
      )

      // Navigate after brief delay so user sees the message
      setTimeout(() => navigate(`/deal/${data.id}`), 800)
    } catch (err) {
      console.error('Error creating deal:', err)
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div style={{
        padding: '14px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', gap: 12, background: T.surface,
      }}>
        <button
          onClick={() => navigate('/')}
          style={{
            background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
            padding: '6px 12px', cursor: 'pointer', fontSize: 12, color: T.primary,
            fontWeight: 600, fontFamily: T.font,
          }}
        >
          &larr; Pipeline
        </button>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>New Deal</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 700 }}>
        <form onSubmit={handleSubmit}>
          <Card title="Deal Information">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Company Name *</label>
                <input
                  style={inputStyle} value={form.company_name}
                  onChange={e => set('company_name', e.target.value)}
                  placeholder="Enter company name" required autoFocus
                  onFocus={e => { e.target.style.borderColor = T.primary }}
                  onBlur={e => { e.target.style.borderColor = T.border }}
                />
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Website</label>
                  <input
                    style={inputStyle} value={form.website}
                    onChange={e => set('website', e.target.value)}
                    placeholder="company.com"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Target Close Date</label>
                  <input
                    type="date" style={inputStyle} value={form.target_close_date}
                    onChange={e => set('target_close_date', e.target.value)}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>CMRR (Monthly)</label>
                  <input
                    type="number" style={inputStyle} value={form.cmrr}
                    onChange={e => set('cmrr', e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Deal Value (Annual)</label>
                  <input
                    type="number" style={inputStyle} value={form.deal_value}
                    onChange={e => set('deal_value', e.target.value)}
                    placeholder="0"
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Stage</label>
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }} value={form.stage}
                    onChange={e => set('stage', e.target.value)}
                  >
                    {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Forecast Category</label>
                  <select
                    style={{ ...inputStyle, cursor: 'pointer' }} value={form.forecast_category}
                    onChange={e => set('forecast_category', e.target.value)}
                  >
                    {FORECAST_CATEGORIES.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label style={labelStyle}>Notes</label>
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                  value={form.notes}
                  onChange={e => set('notes', e.target.value)}
                  placeholder="Initial deal notes, context from SDR, etc."
                />
              </div>
            </div>
          </Card>

          <Card title="Primary Contact (Optional)">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Contact Name</label>
                  <input style={inputStyle} value={form.contact_name}
                    onChange={e => set('contact_name', e.target.value)}
                    placeholder="e.g. Jane Smith" />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Title</label>
                  <input style={inputStyle} value={form.contact_title}
                    onChange={e => set('contact_title', e.target.value)}
                    placeholder="e.g. CFO" />
                </div>
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" style={inputStyle} value={form.contact_email}
                  onChange={e => set('contact_email', e.target.value)}
                  placeholder="jane@company.com" />
              </div>
            </div>
          </Card>

          {createdMsg && (
            <div style={{
              padding: '12px 16px', borderRadius: 6, fontSize: 13, marginBottom: 16,
              background: T.primaryLight, color: T.primary, border: `1px solid ${T.primaryBorder}`,
              display: 'flex', alignItems: 'center', gap: 10, fontWeight: 600,
            }}>
              <span style={{ display: 'inline-block', width: 14, height: 14, border: `2px solid ${T.primary}`, borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
              {createdMsg}
              <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 6, fontSize: 13, marginBottom: 16,
              background: T.errorLight, color: T.error, border: `1px solid ${T.error}25`,
            }}>
              {error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <Button primary type="submit" disabled={saving || !form.company_name.trim()}>
              {saving ? 'Creating...' : 'Create Deal'}
            </Button>
            <Button onClick={() => navigate('/')}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  )
}
