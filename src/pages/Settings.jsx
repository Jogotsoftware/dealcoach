import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, getFiscalPeriods } from '../lib/theme'
import { Card, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

export default function Settings() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fyEndMonth, setFyEndMonth] = useState(9)
  const fp = getFiscalPeriods()

  // Month-by-month quota data
  const [months, setMonths] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      month_number: i + 1, quota_amount: 0, closed_amount: 0, notes: '',
    }))
  )

  useEffect(() => {
    if (profile) {
      setFyEndMonth(profile.fiscal_year_end_month || 9)
      loadQuota()
    }
  }, [profile])

  async function loadQuota() {
    const { data } = await supabase
      .from('rep_quota_months')
      .select('*')
      .eq('rep_id', profile.id)
      .eq('fiscal_year', fp.fy)

    if (data && data.length > 0) {
      setMonths(prev => prev.map(m => {
        const found = data.find(d => d.month_number === m.month_number)
        return found ? { ...m, quota_amount: found.quota_amount || 0, closed_amount: found.closed_amount || 0, notes: found.notes || '' } : m
      }))
    }
  }

  function getMonthLabel(fiscalMonthNum) {
    // fiscal_month 1 = first month of FY = fyEndMonth + 1
    const calMonth = ((fyEndMonth) % 12) + fiscalMonthNum
    const adjusted = calMonth > 12 ? calMonth - 12 : calMonth
    const monthIdx = adjusted - 1

    // Calculate year
    const fyStartCalMonth = (fyEndMonth % 12) + 1
    const calMonthActual = ((fyEndMonth + fiscalMonthNum - 1) % 12) + 1
    const isBeforeCalendarYearEnd = calMonthActual >= fyStartCalMonth
    const year = isBeforeCalendarYearEnd ? fp.fy - 1 : fp.fy

    return `${MONTH_NAMES[monthIdx]} ${year}`
  }

  function updateMonth(monthNum, field, value) {
    setMonths(prev => prev.map(m =>
      m.month_number === monthNum ? { ...m, [field]: value } : m
    ))
  }

  const totalQuota = months.reduce((s, m) => s + (Number(m.quota_amount) || 0), 0)
  const totalClosed = months.reduce((s, m) => s + (Number(m.closed_amount) || 0), 0)
  const totalAttainment = totalQuota > 0 ? Math.round((totalClosed / totalQuota) * 100) : 0

  async function saveQuota() {
    setLoading(true)
    setSaved(false)
    try {
      await supabase.from('rep_quota_months').upsert(
        months.map(m => ({
          rep_id: profile.id,
          fiscal_year: fp.fy,
          month_number: m.month_number,
          quota_amount: Number(m.quota_amount) || 0,
          notes: m.notes || null,
        })),
        { onConflict: 'rep_id,fiscal_year,month_number' }
      )

      await supabase.from('rep_quotas').upsert({
        rep_id: profile.id,
        fiscal_year: fp.fy,
        annual_quota: totalQuota,
      }, { onConflict: 'rep_id,fiscal_year' })

      await supabase.from('profiles').update({ annual_quota: totalQuota }).eq('id', profile.id)

      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      console.error('Error saving quota:', err)
    } finally {
      setLoading(false)
    }
  }

  async function saveFyEndMonth(val) {
    setFyEndMonth(val)
    await supabase.from('profiles').update({ fiscal_year_end_month: val }).eq('id', profile.id)
  }

  function attainmentColor(pct) {
    if (pct >= 100) return T.success
    if (pct >= 70) return T.primary
    if (pct >= 40) return T.warning
    return T.error
  }

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Settings</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 900 }}>
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
              <label style={labelStyle}>Fiscal Year End Month</label>
              <select
                style={{ ...inputStyle, cursor: 'pointer' }}
                value={fyEndMonth}
                onChange={e => saveFyEndMonth(Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Quota */}
        <Card title={`Quota -- FY${fp.fy} (Oct ${fp.fy - 1} - Sep ${fp.fy})`}>
          {/* Summary */}
          {totalQuota > 0 && (
            <div style={{
              background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6,
              padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', gap: 24 }}>
                {[['Monthly', totalQuota / 12], ['Quarterly', totalQuota / 4], ['Annual', totalQuota]].map(([label, value]) => (
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

          {/* Month-by-month table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `2px solid ${T.border}` }}>
                  {['Month', 'Quota', 'Closed', 'Attainment', 'Notes'].map(h => (
                    <th key={h} style={{
                      textAlign: h === 'Quota' || h === 'Closed' ? 'right' : 'left',
                      padding: '8px 10px', fontSize: 10, fontWeight: 600, color: T.textMuted,
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map(m => {
                  const quota = Number(m.quota_amount) || 0
                  const closed = Number(m.closed_amount) || 0
                  const attPct = quota > 0 ? Math.round((closed / quota) * 100) : 0
                  const color = attainmentColor(attPct)

                  return (
                    <tr key={m.month_number} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: '10px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>
                        {getMonthLabel(m.month_number)}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <input type="number" style={{ ...inputStyle, width: 110, padding: '5px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}
                          value={m.quota_amount || ''}
                          onChange={e => updateMonth(m.month_number, 'quota_amount', e.target.value)}
                          placeholder="0" />
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 600, color: T.text, fontFeatureSettings: '"tnum"' }}>
                        {formatCurrency(closed)}
                      </td>
                      <td style={{ padding: '10px', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', width: `${Math.min(attPct, 100)}%`,
                              background: color, borderRadius: 3, transition: 'width 0.3s',
                            }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 36, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                            {attPct}%
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }}
                          value={m.notes || ''}
                          onChange={e => updateMonth(m.month_number, 'notes', e.target.value)}
                          placeholder="Notes" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.border}` }}>
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: T.text }}>Total</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                    {formatCurrency(totalQuota)}
                  </td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>
                    {formatCurrency(totalClosed)}
                  </td>
                  <td style={{ padding: '12px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', width: `${Math.min(totalAttainment, 100)}%`,
                          background: attainmentColor(totalAttainment), borderRadius: 3,
                        }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: attainmentColor(totalAttainment), minWidth: 36, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>
                        {totalAttainment}%
                      </span>
                    </div>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button primary onClick={saveQuota} disabled={loading}>
              {loading ? 'Saving...' : 'Save Quota'}
            </Button>
            {saved && (
              <span style={{ fontSize: 13, color: T.success, fontWeight: 600 }}>&#10003; Saved</span>
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
