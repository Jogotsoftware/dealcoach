import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, getFiscalPeriods } from '../lib/theme'
import { Card, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function Settings() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [annualQuota, setAnnualQuota] = useState('')
  const [saved, setSaved] = useState(false)
  const fp = getFiscalPeriods()

  useEffect(() => {
    if (profile) loadQuota()
  }, [profile])

  async function loadQuota() {
    const { data } = await supabase
      .from('rep_quotas')
      .select('*')
      .eq('rep_id', profile.id)
      .eq('fiscal_year', fp.fy)
      .limit(1)

    if (data?.[0]) {
      setAnnualQuota(String(data[0].annual_quota || ''))
    } else if (profile.annual_quota) {
      setAnnualQuota(String(profile.annual_quota))
    }
  }

  async function saveQuota() {
    setLoading(true)
    setSaved(false)
    const value = Number(annualQuota) || 0
    try {
      // Upsert into rep_quotas
      await supabase.from('rep_quotas').upsert({
        rep_id: profile.id,
        fiscal_year: fp.fy,
        annual_quota: value,
      }, { onConflict: 'rep_id,fiscal_year' })

      // Also update profiles for quick access
      await supabase.from('profiles').update({ annual_quota: value }).eq('id', profile.id)

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving quota:', err)
    } finally {
      setLoading(false)
    }
  }

  const quotaNum = Number(annualQuota) || 0

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Settings</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 800 }}>
        {/* Profile */}
        <Card title="Profile">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Full Name</label>
              <input style={inputStyle} value={profile?.full_name || ''} readOnly />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={inputStyle} value={profile?.email || ''} readOnly />
            </div>
            <div>
              <label style={labelStyle}>Initials</label>
              <input style={inputStyle} value={profile?.initials || ''} readOnly />
            </div>
            <div>
              <label style={labelStyle}>Fiscal Year Start</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} defaultValue="10">
                <option value="1">January</option>
                <option value="2">February</option>
                <option value="3">March</option>
                <option value="4">April</option>
                <option value="7">July</option>
                <option value="10">October</option>
              </select>
            </div>
          </div>
        </Card>

        {/* Quota */}
        <Card title={`Quota — FY${fp.fy} (Oct ${fp.fy - 1} - Sep ${fp.fy})`}>
          <div>
            <label style={labelStyle}>Annual Quota (Deal Value)</label>
            <input
              type="number"
              style={{ ...inputStyle, fontSize: 16, fontWeight: 600, fontFeatureSettings: '"tnum"' }}
              value={annualQuota}
              onChange={e => setAnnualQuota(e.target.value)}
              placeholder="e.g. 3000000"
              onFocus={e => { e.target.style.borderColor = T.primary }}
              onBlur={e => { e.target.style.borderColor = T.border }}
            />
          </div>

          {quotaNum > 0 && (
            <div style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: 16, marginTop: 14,
            }}>
              <div style={{ display: 'flex', gap: 24 }}>
                {[['Monthly', quotaNum / 12], ['Quarterly', quotaNum / 4], ['Annual', quotaNum]].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                      {formatCurrency(value)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button primary onClick={saveQuota} disabled={loading}>
              {loading ? 'Saving...' : 'Save Quota'}
            </Button>
            {saved && (
              <span style={{ fontSize: 13, color: T.success, fontWeight: 600 }}>
                &#10003; Saved
              </span>
            )}
          </div>
        </Card>

        {/* Preferences */}
        <Card title="Preferences">
          {[
            ['Email Notifications', 'Get notified about deal updates'],
            ['Weekly Digest', 'Pipeline summary every Friday'],
            ['Auto-extract Tasks', 'Create tasks from transcript processing'],
          ].map(([label, desc]) => (
            <div key={label} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 0', borderBottom: `1px solid ${T.borderLight}`,
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{label}</div>
                <div style={{ fontSize: 12, color: T.textSecondary }}>{desc}</div>
              </div>
              <div style={{
                width: 40, height: 22, borderRadius: 11, background: T.success,
                cursor: 'pointer', position: 'relative',
              }}>
                <div style={{
                  width: 18, height: 18, borderRadius: '50%', background: '#fff',
                  position: 'absolute', right: 2, top: 2, boxShadow: T.shadow,
                }} />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
