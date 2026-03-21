import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, getFiscalPeriods } from '../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const MEMBER_TYPES = [
  { key: 'internal_sc', label: 'Internal SC' },
  { key: 'external_sc', label: 'External SC' },
  { key: 'technical_sc', label: 'Technical SC' },
  { key: 'partner', label: 'Partner' },
  { key: 'other', label: 'Other' },
]

export default function Settings() {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fyEndMonth, setFyEndMonth] = useState(9)
  const fp = getFiscalPeriods()

  // Coach selection
  const [coaches, setCoaches] = useState([])
  const [activeCoachId, setActiveCoachId] = useState(null)

  // Profile editing
  const [profileData, setProfileData] = useState({ full_name: '', title: '', phone: '', team: '' })
  const [profileSaved, setProfileSaved] = useState(false)

  // Month-by-month quota data
  const [months, setMonths] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      month_number: i + 1, quota_amount: 0, closed_amount: 0, notes: '',
    }))
  )

  // Team members
  const [teamMembers, setTeamMembers] = useState([])
  const [showAddMember, setShowAddMember] = useState(false)
  const [newMember, setNewMember] = useState({ name: '', title: '', company: '', email: '', phone: '', member_type: 'internal_sc' })

  useEffect(() => {
    if (profile) {
      setFyEndMonth(profile.fiscal_year_end_month || 9)
      setActiveCoachId(profile.active_coach_id || null)
      setProfileData({
        full_name: profile.full_name || '',
        title: profile.title || '',
        phone: profile.phone || '',
        team: profile.team || '',
      })
      loadData()
    }
  }, [profile])

  async function loadData() {
    const [quotaRes, coachesRes, teamRes] = await Promise.all([
      supabase.from('rep_quota_months').select('*').eq('rep_id', profile.id).eq('fiscal_year', fp.fy),
      supabase.from('coaches').select('id, name, description').eq('active', true).order('name'),
      supabase.from('user_team_members').select('*').eq('user_id', profile.id).order('name'),
    ])

    if (quotaRes.data?.length > 0) {
      setMonths(prev => prev.map(m => {
        const found = quotaRes.data.find(d => d.month_number === m.month_number)
        return found ? { ...m, quota_amount: found.quota_amount || 0, closed_amount: found.closed_amount || 0, notes: found.notes || '' } : m
      }))
    }
    setCoaches(coachesRes.data || [])
    setTeamMembers(teamRes.data || [])
  }

  function getMonthLabel(fiscalMonthNum) {
    const calMonth = ((fyEndMonth) % 12) + fiscalMonthNum
    const adjusted = calMonth > 12 ? calMonth - 12 : calMonth
    const monthIdx = adjusted - 1
    const fyStartCalMonth = (fyEndMonth % 12) + 1
    const calMonthActual = ((fyEndMonth + fiscalMonthNum - 1) % 12) + 1
    const isBeforeCalendarYearEnd = calMonthActual >= fyStartCalMonth
    const year = isBeforeCalendarYearEnd ? fp.fy - 1 : fp.fy
    return `${MONTH_NAMES[monthIdx]} ${year}`
  }

  function updateMonth(monthNum, field, value) {
    setMonths(prev => prev.map(m => m.month_number === monthNum ? { ...m, [field]: value } : m))
  }

  async function saveClosedAmount(monthNum, value) {
    const amount = Number(value) || 0
    await supabase.from('rep_quota_months').upsert({
      rep_id: profile.id, fiscal_year: fp.fy, month_number: monthNum, closed_amount: amount,
    }, { onConflict: 'rep_id,fiscal_year,month_number' })
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
          rep_id: profile.id, fiscal_year: fp.fy, month_number: m.month_number,
          quota_amount: Number(m.quota_amount) || 0, closed_amount: Number(m.closed_amount) || 0,
          notes: m.notes || null,
        })),
        { onConflict: 'rep_id,fiscal_year,month_number' }
      )
      await supabase.from('rep_quotas').upsert({
        rep_id: profile.id, fiscal_year: fp.fy, annual_quota: totalQuota,
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

  async function selectCoach(coachId) {
    setActiveCoachId(coachId)
    await supabase.from('profiles').update({ active_coach_id: coachId || null }).eq('id', profile.id)
  }

  async function saveProfileField(field, value) {
    await supabase.from('profiles').update({ [field]: value }).eq('id', profile.id)
    setProfileSaved(true)
    setTimeout(() => setProfileSaved(false), 2000)
  }

  async function addTeamMember() {
    if (!newMember.name.trim()) return
    const { data, error } = await supabase.from('user_team_members').insert({
      user_id: profile.id, ...newMember,
    }).select().single()
    if (!error && data) {
      setTeamMembers(prev => [...prev, data])
      setShowAddMember(false)
      setNewMember({ name: '', title: '', company: '', email: '', phone: '', member_type: 'internal_sc' })
    }
  }

  async function updateTeamMember(id, field, value) {
    await supabase.from('user_team_members').update({ [field]: value }).eq('id', id)
    setTeamMembers(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  async function deleteTeamMember(id) {
    if (!window.confirm('Remove this team member?')) return
    await supabase.from('user_team_members').delete().eq('id', id)
    setTeamMembers(prev => prev.filter(m => m.id !== id))
  }

  function attainmentColor(pct) {
    if (pct >= 100) return T.success
    if (pct >= 70) return T.primary
    if (pct >= 40) return T.warning
    return T.error
  }

  const selectedCoach = coaches.find(c => c.id === activeCoachId)

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Settings</h2>
      </div>

      <div style={{ padding: 24, maxWidth: 900 }}>

        {/* My Coach */}
        <Card title="My Coach">
          <div style={{ marginBottom: 8 }}>
            <label style={labelStyle}>Active Coach</label>
            <select style={{ ...inputStyle, cursor: 'pointer' }} value={activeCoachId || ''}
              onChange={e => selectCoach(e.target.value || null)}>
              <option value="">-- Select a Coach --</option>
              {coaches.map(c => (
                <option key={c.id} value={c.id}>{c.name}{c.description ? ` - ${c.description.substring(0, 60)}` : ''}</option>
              ))}
            </select>
          </div>
          {selectedCoach && (
            <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text, marginBottom: 2 }}>{selectedCoach.name}</div>
              {selectedCoach.description && (
                <div style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>{selectedCoach.description}</div>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: T.textMuted, fontStyle: 'italic' }}>
            Coach customization is a premium feature
          </div>
        </Card>

        {/* Profile */}
        <Card title="Profile" action={profileSaved ? <span style={{ fontSize: 12, color: T.success, fontWeight: 600 }}>Saved</span> : null}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div>
              <label style={labelStyle}>Full Name</label>
              <input style={inputStyle} value={profileData.full_name}
                onChange={e => setProfileData(p => ({ ...p, full_name: e.target.value }))}
                onBlur={e => saveProfileField('full_name', e.target.value)} />
            </div>
            <div>
              <label style={labelStyle}>Email</label>
              <input style={{ ...inputStyle, background: T.surfaceAlt }} value={profile?.email || ''} readOnly />
            </div>
            <div>
              <label style={labelStyle}>Title</label>
              <input style={inputStyle} value={profileData.title}
                onChange={e => setProfileData(p => ({ ...p, title: e.target.value }))}
                onBlur={e => saveProfileField('title', e.target.value)}
                placeholder="e.g. Account Executive" />
            </div>
            <div>
              <label style={labelStyle}>Phone</label>
              <input style={inputStyle} value={profileData.phone}
                onChange={e => setProfileData(p => ({ ...p, phone: e.target.value }))}
                onBlur={e => saveProfileField('phone', e.target.value)}
                placeholder="(555) 123-4567" />
            </div>
            <div>
              <label style={labelStyle}>Team</label>
              <input style={inputStyle} value={profileData.team}
                onChange={e => setProfileData(p => ({ ...p, team: e.target.value }))}
                onBlur={e => saveProfileField('team', e.target.value)}
                placeholder="e.g. Enterprise East" />
            </div>
            <div>
              <label style={labelStyle}>Fiscal Year End Month</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={fyEndMonth}
                onChange={e => saveFyEndMonth(Number(e.target.value))}>
                {MONTH_NAMES.map((name, i) => (
                  <option key={i + 1} value={i + 1}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </Card>

        {/* Quota */}
        <Card title={`Quota -- FY${fp.fy} (Oct ${fp.fy - 1} - Sep ${fp.fy})`}>
          {totalQuota > 0 && (
            <div style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', gap: 24 }}>
                {[['Monthly', totalQuota / 12], ['Quarterly', totalQuota / 4], ['Annual', totalQuota]].map(([label, value]) => (
                  <div key={label}>
                    <div style={{ fontSize: 11, color: T.textMuted }}>{label}</div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                      <td style={{ padding: '10px', fontWeight: 600, color: T.text, whiteSpace: 'nowrap' }}>{getMonthLabel(m.month_number)}</td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <input type="number" style={{ ...inputStyle, width: 110, padding: '5px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}
                          value={m.quota_amount || ''} onChange={e => updateMonth(m.month_number, 'quota_amount', e.target.value)} placeholder="0" />
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right' }}>
                        <input type="number" style={{ ...inputStyle, width: 110, padding: '5px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}
                          value={m.closed_amount || ''} onChange={e => updateMonth(m.month_number, 'closed_amount', e.target.value)}
                          onBlur={e => saveClosedAmount(m.month_number, e.target.value)} placeholder="0" />
                      </td>
                      <td style={{ padding: '10px', minWidth: 140 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${Math.min(attPct, 100)}%`, background: color, borderRadius: 3, transition: 'width 0.3s' }} />
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 36, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{attPct}%</span>
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <input style={{ ...inputStyle, padding: '5px 8px', fontSize: 12 }} value={m.notes || ''}
                          onChange={e => updateMonth(m.month_number, 'notes', e.target.value)} placeholder="Notes" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: `2px solid ${T.border}` }}>
                  <td style={{ padding: '12px 10px', fontWeight: 700, color: T.text }}>Total</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(totalQuota)}</td>
                  <td style={{ padding: '12px 10px', textAlign: 'right', fontWeight: 700, color: T.text, fontFeatureSettings: '"tnum"' }}>{formatCurrency(totalClosed)}</td>
                  <td style={{ padding: '12px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: T.borderLight, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${Math.min(totalAttainment, 100)}%`, background: attainmentColor(totalAttainment), borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: attainmentColor(totalAttainment), minWidth: 36, textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{totalAttainment}%</span>
                    </div>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
            <Button primary onClick={saveQuota} disabled={loading}>{loading ? 'Saving...' : 'Save Quota'}</Button>
            {saved && <span style={{ fontSize: 13, color: T.success, fontWeight: 600 }}>&#10003; Saved</span>}
          </div>
        </Card>

        {/* My Team */}
        <Card title="My Team" action={<Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => setShowAddMember(true)}>+ Add Member</Button>}>
          {showAddMember && (
            <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, marginBottom: 12, border: `1px solid ${T.borderLight}` }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
                <div><label style={labelStyle}>Title</label><input style={inputStyle} value={newMember.title} onChange={e => setNewMember(p => ({ ...p, title: e.target.value }))} /></div>
                <div><label style={labelStyle}>Company</label><input style={inputStyle} value={newMember.company} onChange={e => setNewMember(p => ({ ...p, company: e.target.value }))} /></div>
                <div><label style={labelStyle}>Email</label><input style={inputStyle} value={newMember.email} onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))} /></div>
                <div><label style={labelStyle}>Phone</label><input style={inputStyle} value={newMember.phone} onChange={e => setNewMember(p => ({ ...p, phone: e.target.value }))} /></div>
                <div><label style={labelStyle}>Type</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newMember.member_type} onChange={e => setNewMember(p => ({ ...p, member_type: e.target.value }))}>
                  {MEMBER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button primary onClick={addTeamMember}>Add</Button>
                <Button onClick={() => setShowAddMember(false)}>Cancel</Button>
              </div>
            </div>
          )}

          {teamMembers.length === 0 ? (
            <div style={{ color: T.textMuted, fontSize: 13, padding: '8px 0' }}>No team members yet. Add your SCs, partners, and other collaborators.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Name', 'Title', 'Company', 'Email', 'Phone', 'Type', 'Default', 'Active', 'Uses', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {teamMembers.map(m => (
                  <tr key={m.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '8px' }}>
                      <input style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }} defaultValue={m.name}
                        onBlur={e => updateTeamMember(m.id, 'name', e.target.value)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }} defaultValue={m.title || ''}
                        onBlur={e => updateTeamMember(m.id, 'title', e.target.value)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }} defaultValue={m.company || ''}
                        onBlur={e => updateTeamMember(m.id, 'company', e.target.value)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }} defaultValue={m.email || ''}
                        onBlur={e => updateTeamMember(m.id, 'email', e.target.value)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <input style={{ ...inputStyle, padding: '4px 6px', fontSize: 12 }} defaultValue={m.phone || ''}
                        onBlur={e => updateTeamMember(m.id, 'phone', e.target.value)} />
                    </td>
                    <td style={{ padding: '8px' }}>
                      <select style={{ ...inputStyle, padding: '4px 6px', fontSize: 11, cursor: 'pointer' }}
                        defaultValue={m.member_type || 'other'} onChange={e => updateTeamMember(m.id, 'member_type', e.target.value)}>
                        {MEMBER_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <div onClick={() => updateTeamMember(m.id, 'is_default_team', !m.is_default_team)}
                        style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', background: m.is_default_team ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s' }}>
                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: m.is_default_team ? 16 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                      </div>
                    </td>
                    <td style={{ padding: '8px', textAlign: 'center' }}>
                      <div onClick={() => updateTeamMember(m.id, 'is_active', !m.is_active)}
                        style={{ width: 32, height: 18, borderRadius: 9, cursor: 'pointer', background: m.is_active !== false ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s' }}>
                        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: m.is_active !== false ? 16 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                      </div>
                    </td>
                    <td style={{ padding: '8px', fontSize: 11, color: T.textMuted, textAlign: 'center' }}>{m.usage_count || 0}</td>
                    <td style={{ padding: '8px' }}>
                      <button onClick={() => deleteTeamMember(m.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textMuted, fontSize: 14 }}
                        onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>&#10005;</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
              <div style={{ width: 40, height: 22, borderRadius: 11, background: T.success, cursor: 'pointer', position: 'relative' }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#fff', position: 'absolute', right: 2, top: 2, boxShadow: T.shadow }} />
              </div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  )
}
