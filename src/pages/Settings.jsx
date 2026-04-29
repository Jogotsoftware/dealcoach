import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, getFiscalPeriods } from '../lib/theme'
import { useOrg } from '../contexts/OrgContext'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

// Collapsible card wrapper — persists open/closed state per-section to localStorage.
// Usage: <SectionCard id="my_coach" title="My Coach">...</SectionCard>
function SectionCard({ id, title, action, children, defaultOpen = true }) {
  const storageKey = `ri_settings_collapsed_${id}`
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem(storageKey); return v === null ? defaultOpen : v === 'true' }
    catch { return defaultOpen }
  })
  useEffect(() => { try { localStorage.setItem(storageKey, String(open)) } catch {} }, [open, storageKey])
  return (
    <div style={{ background: '#fff', border: '1px solid ' + (typeof window !== 'undefined' ? '#e3e7ed' : '#e3e7ed'), borderRadius: 8, marginBottom: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ padding: '8px 14px', borderBottom: open ? '1px solid #e3e7ed' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f7fa', cursor: 'pointer', userSelect: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 12, color: '#8899aa', fontWeight: 700, transition: 'transform 0.15s', transform: open ? 'rotate(90deg)' : 'rotate(0)' }}>▸</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#1a1a2e', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title}</span>
        </div>
        {action && <div onClick={e => e.stopPropagation()}>{action}</div>}
      </div>
      {open && <div style={{ padding: 10 }}>{children}</div>}
    </div>
  )
}
import Papa from 'papaparse'

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December']

const MEMBER_TYPES = [
  { key: 'internal_sc', label: 'Internal SC' },
  { key: 'external_sc', label: 'External SC' },
  { key: 'technical_sc', label: 'Technical SC' },
  { key: 'sales_engineer', label: 'Sales Engineer' },
  { key: 'partner', label: 'Partner' },
  { key: 'var', label: 'VAR / Reseller' },
  { key: 'implementation', label: 'Implementation Consultant' },
  { key: 'manager', label: 'Sales Manager' },
  { key: 'director', label: 'Sales Director' },
  { key: 'executive_sponsor', label: 'Executive Sponsor' },
  { key: 'channel_manager', label: 'Channel Manager' },
  { key: 'csm', label: 'Customer Success' },
  { key: 'other', label: 'Other' },
]

export default function Settings() {
  const { profile } = useAuth()
  const { fyEndMonth: orgFyEndMonth } = useOrg()
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [fyEndMonth, setFyEndMonth] = useState(orgFyEndMonth || 12)
  const fp = getFiscalPeriods(new Date(), fyEndMonth)

  // Coach selection
  const [coaches, setCoaches] = useState([])
  const [activeCoachId, setActiveCoachId] = useState(null)
  const [orgCoach, setOrgCoach] = useState(null)
  const [builtCoaches, setBuiltCoaches] = useState([])
  const [sharedCoaches, setSharedCoaches] = useState([])
  const [tokenInput, setTokenInput] = useState('')
  const [tokenStatus, setTokenStatus] = useState(null)

  // Quota upload
  const [quotaUpload, setQuotaUpload] = useState({ previewing: false, rows: [], error: null })

  // Profile editing
  const [profileData, setProfileData] = useState({ full_name: '', title: '', phone: '', team: '' })
  const [profileSaved, setProfileSaved] = useState(false)

  // Month-by-month quota data
  const [months, setMonths] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      month_number: i + 1, quota_amount: 0, closed_amount: 0, notes: '',
    }))
  )

  // Organization data
  const [orgData, setOrgData] = useState(null)
  const [orgCredits, setOrgCredits] = useState(null)
  const [orgPlan, setOrgPlan] = useState(null)
  const [orgTeam, setOrgTeam] = useState([])
  const [showOrgInvite, setShowOrgInvite] = useState(false)
  const [orgInvite, setOrgInvite] = useState({ email: '', role: 'rep' })

  // Team members
  const [teamMembers, setTeamMembers] = useState([])
  const [showAddMember, setShowAddMember] = useState(false)
  const [newMember, setNewMember] = useState({ name: '', title: '', company: '', email: '', phone: '', member_type: 'internal_sc' })

  // Auto-redeem coach token from ?coach_token= URL param (e.g. when clicked via email share)
  useEffect(() => {
    if (!profile) return
    const params = new URLSearchParams(window.location.search)
    const urlToken = params.get('coach_token')
    if (!urlToken) return
    ;(async () => {
      const { data, error } = await supabase.rpc('redeem_coach_token', { p_token: urlToken.trim() })
      if (!error && data?.success) setTokenStatus({ success: `Added "${data.coach_name}" from share link` })
      else setTokenStatus({ error: error?.message || data?.error || 'Link invalid or expired' })
      // Strip param from URL
      window.history.replaceState({}, '', window.location.pathname)
      loadCoachSections()
    })()
  }, [profile?.id])

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
    const queries = [
      supabase.from('rep_quota_months').select('*').eq('rep_id', profile.id).eq('fiscal_year', fp.fy),
      supabase.from('coaches').select('id, name, description').eq('active', true).order('name'),
      supabase.from('user_team_members').select('*').eq('user_id', profile.id).order('name'),
    ]
    if (profile.org_id) {
      queries.push(
        supabase.from('organizations').select('*').eq('id', profile.org_id).single(),
        supabase.from('org_credits').select('*').eq('org_id', profile.org_id).single(),
        supabase.from('profiles').select('*').eq('org_id', profile.org_id),
      )
    }
    const [quotaRes, coachesRes, teamRes, orgRes, orgCredRes, orgTeamRes] = await Promise.all(queries)

    if (profile.org_id) {
      setOrgData(orgRes?.data || null)
      setOrgCredits(orgCredRes?.data || null)
      setOrgTeam(orgTeamRes?.data || [])
      if (orgRes?.data?.plan_id) {
        const { data: plan } = await supabase.from('plans').select('name').eq('id', orgRes.data.plan_id).single()
        setOrgPlan(plan)
      }
    }

    if (quotaRes.data?.length > 0) {
      setMonths(prev => prev.map(m => {
        const found = quotaRes.data.find(d => d.month_number === m.month_number)
        return found ? { ...m, quota_amount: found.quota_amount || 0, closed_amount: found.closed_amount || 0, notes: found.notes || '' } : m
      }))
    }
    setCoaches(coachesRes.data || [])
    setTeamMembers(teamRes.data || [])

    // Load 3-section coach layout
    await loadCoachSections()
  }

  async function loadCoachSections() {
    if (!profile) return
    // 1. Org's coach (org_id matches, is_template false, most recent)
    let orgC = null
    if (profile.org_id) {
      const { data } = await supabase.from('coaches').select('id, name, description')
        .eq('org_id', profile.org_id).eq('is_template', false).eq('active', true)
        .order('created_at', { ascending: true }).limit(1).maybeSingle()
      orgC = data || null
    }
    setOrgCoach(orgC)

    // 2. Coaches I've built (created_by = me, active)
    const { data: mine } = await supabase.from('coaches').select('id, name, description')
      .eq('created_by', profile.id).eq('active', true).order('name')
    setBuiltCoaches(mine || [])

    // 3. Shared coaches (redeemed via token)
    const { data: redemptions } = await supabase.from('coach_user_tokens').select('coach_id').eq('user_id', profile.id)
    const redeemedIds = (redemptions || []).map(r => r.coach_id)
    let shared = []
    if (redeemedIds.length) {
      const { data } = await supabase.from('coaches').select('id, name, description').in('id', redeemedIds).eq('active', true)
      shared = data || []
    }
    setSharedCoaches(shared)
  }

  function downloadQuotaTemplate() {
    const header = 'Month,Quota,Closed\n'
    const rows = MONTH_NAMES.map(m => `${m},0,0`).join('\n')
    const csv = header + rows
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `quota-template-fy${fp.fy}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleQuotaFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        try {
          const parsed = result.data.map(row => {
            const monthName = String(row.Month || row.month || '').trim()
            let monthNumber = MONTH_NAMES.findIndex(m => m.toLowerCase() === monthName.toLowerCase()) + 1
            if (!monthNumber) monthNumber = Number(monthName) || null
            if (!monthNumber || monthNumber < 1 || monthNumber > 12) return null
            const quota = Number(String(row.Quota || row.quota || '0').replace(/[^0-9.\-]/g, '')) || 0
            const closed = Number(String(row.Closed || row.closed || '0').replace(/[^0-9.\-]/g, '')) || 0
            return { month_number: monthNumber, quota_amount: quota, closed_amount: closed }
          }).filter(Boolean)
          if (parsed.length === 0) {
            setQuotaUpload({ previewing: false, rows: [], error: 'No valid rows found. Template: Month, Quota, Closed' })
            return
          }
          setQuotaUpload({ previewing: true, rows: parsed, error: null })
        } catch (err) {
          setQuotaUpload({ previewing: false, rows: [], error: err.message })
        }
      },
      error: (err) => setQuotaUpload({ previewing: false, rows: [], error: err.message }),
    })
    e.target.value = ''
  }

  async function applyQuotaUpload() {
    if (!quotaUpload.rows.length) return
    setMonths(prev => prev.map(m => {
      const found = quotaUpload.rows.find(r => r.month_number === m.month_number)
      return found ? { ...m, quota_amount: found.quota_amount, closed_amount: found.closed_amount } : m
    }))
    setQuotaUpload({ previewing: false, rows: [], error: null })
  }

  async function redeemToken() {
    if (!tokenInput.trim()) return
    setTokenStatus(null)
    const { data, error } = await supabase.rpc('redeem_coach_token', { p_token: tokenInput.trim() })
    if (error) { setTokenStatus({ error: error.message }); return }
    if (data?.success) {
      setTokenStatus({ success: `Added "${data.coach_name}"` })
      setTokenInput('')
      loadCoachSections()
    } else {
      setTokenStatus({ error: data?.error || 'Unknown error' })
    }
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

  async function sendOrgInvite() {
    if (!orgInvite.email || !profile.org_id) return
    const token = crypto.randomUUID()
    const expires = new Date(Date.now() + 7 * 86400000).toISOString()
    await supabase.from('invitations').insert({
      email: orgInvite.email, org_id: profile.org_id, role: orgInvite.role,
      token, status: 'pending', expires_at: expires,
    })
    setShowOrgInvite(false)
    setOrgInvite({ email: '', role: 'rep' })
    alert(`Invitation created. Share this link:\n${window.location.origin}/invite/${token}`)
  }

  const selectedCoach = coaches.find(c => c.id === activeCoachId)

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Settings</h2>
      </div>

      <div style={{ padding: '16px 24px' }}>

        {/* Profile */}
        <SectionCard id="profile" title="Profile" action={profileSaved ? <span style={{ fontSize: 12, color: T.success, fontWeight: 600 }}>Saved</span> : null}>
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
        </SectionCard>

        {/* My Team */}
        <SectionCard id="my_team" title="My Team" action={<Button style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => setShowAddMember(true)}>+ Add Member</Button>}>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12, lineHeight: 1.4 }}>
            Your working team — Solutions Consultants, partners, managers, and collaborators. These people don't need a platform account. They can be assigned to deals and will be excluded from AI contact extraction.
          </div>
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
        </SectionCard>

        {/* Preferences */}
        <SectionCard id="preferences" title="Preferences" defaultOpen={false}>
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
        </SectionCard>

        {/* Quota — moved to after Preferences per layout request */}
        <SectionCard id="quota" title={`Quota -- FY${fp.fy} (Oct ${fp.fy - 1} - Sep ${fp.fy})`}>
          {/* CSV upload */}
          <div style={{ marginBottom: 16, padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}` }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Bulk upload</span>
              <Button onClick={downloadQuotaTemplate} style={{ padding: '4px 10px', fontSize: 11 }}>Download CSV template</Button>
              <label style={{ cursor: 'pointer' }}>
                <span style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${T.border}`, borderRadius: 6, background: T.surface, color: T.primary, fontFamily: T.font }}>Upload CSV</span>
                <input type="file" accept=".csv" style={{ display: 'none' }} onChange={handleQuotaFile} />
              </label>
              <span style={{ fontSize: 10, color: T.textMuted }}>Columns: Month, Quota, Closed</span>
            </div>
            {quotaUpload.error && <div style={{ marginTop: 8, fontSize: 12, color: T.error }}>{quotaUpload.error}</div>}
            {quotaUpload.previewing && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 4 }}>Preview ({quotaUpload.rows.length} rows):</div>
                <div style={{ maxHeight: 140, overflow: 'auto', border: `1px solid ${T.borderLight}`, borderRadius: 4, background: T.surface }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead><tr style={{ background: T.surfaceAlt }}>
                      <th style={{ textAlign: 'left', padding: '4px 8px' }}>Month</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Quota</th>
                      <th style={{ textAlign: 'right', padding: '4px 8px' }}>Closed</th>
                    </tr></thead>
                    <tbody>
                      {quotaUpload.rows.map((r, i) => (
                        <tr key={i}>
                          <td style={{ padding: '3px 8px' }}>{MONTH_NAMES[r.month_number - 1] || `Month ${r.month_number}`}</td>
                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(r.quota_amount)}</td>
                          <td style={{ padding: '3px 8px', textAlign: 'right', fontFeatureSettings: '"tnum"' }}>{formatCurrency(r.closed_amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <Button primary onClick={applyQuotaUpload} style={{ padding: '5px 12px', fontSize: 11 }}>Apply to quota</Button>
                  <Button onClick={() => setQuotaUpload({ previewing: false, rows: [], error: null })} style={{ padding: '5px 12px', fontSize: 11 }}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

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
        </SectionCard>
      </div>
    </div>
  )
}

function CoachSection({ title, coaches, activeId, onSelect, emptyText, ownerActions, userId, onDeleted }) {
  const [sharingCoachId, setSharingCoachId] = useState(null)
  const [shareToken, setShareToken] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  async function generateShare(coachId) {
    setBusy(true)
    const { data, error } = await supabase.from('coach_share_tokens').insert({
      coach_id: coachId, created_by: userId, label: 'Shared from Settings',
    }).select().single()
    setBusy(false)
    if (error) { alert('Share failed: ' + error.message); return }
    setSharingCoachId(coachId); setShareToken(data.token); setCopied(false)
  }

  async function copyShareToken() {
    if (!shareToken) return
    try { await navigator.clipboard.writeText(shareToken); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  function emailShareToken(coachName) {
    if (!shareToken) return
    const subject = encodeURIComponent(`I'm sharing a coach with you: ${coachName}`)
    const body = encodeURIComponent(
      `I'm sharing my coach "${coachName}" with you.\n\n` +
      `Paste this token into Settings → "Add a coach via share token":\n\n${shareToken}\n\n` +
      `Or follow this link: ${window.location.origin}/settings?coach_token=${shareToken}`
    )
    window.open(`mailto:?subject=${subject}&body=${body}`)
  }

  async function deleteCoach(coachId) {
    if (!window.confirm('Archive this coach? It will no longer appear here. Deals already using it keep their history.')) return
    setDeletingId(coachId)
    const { error } = await supabase.from('coaches').update({ active: false }).eq('id', coachId).eq('created_by', userId)
    setDeletingId(null)
    if (error) { alert('Delete failed: ' + error.message); return }
    if (onDeleted) onDeleted()
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>{title}</div>
      {coaches.length === 0 ? (
        <div style={{ fontSize: 12, color: T.textMuted, padding: '6px 10px', fontStyle: 'italic' }}>{emptyText}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {coaches.map(c => {
            const isActive = c.id === activeId
            const isSharing = sharingCoachId === c.id
            return (
              <div key={c.id}>
                <div
                  onClick={() => onSelect(isActive ? null : c.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                    borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${isActive ? T.primary : T.border}`,
                    background: isActive ? T.primaryLight || 'rgba(93,173,226,0.08)' : T.surfaceAlt,
                    fontFamily: T.font,
                  }}>
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: isActive ? T.primary : T.borderLight, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: T.text }}>{c.name}</div>
                    {c.description && <div style={{ fontSize: 11, color: T.textSecondary, marginTop: 2, lineHeight: 1.4 }}>{c.description.substring(0, 120)}{c.description.length > 120 ? '...' : ''}</div>}
                  </div>
                  {isActive && <span style={{ fontSize: 10, fontWeight: 700, color: T.primary }}>ACTIVE</span>}
                  {ownerActions && (
                    <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
                      <button onClick={() => generateShare(c.id)} disabled={busy && isSharing}
                        style={{ fontSize: 10, padding: '3px 8px', border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>
                        Share
                      </button>
                      <button onClick={() => deleteCoach(c.id)} disabled={deletingId === c.id}
                        style={{ fontSize: 10, padding: '3px 8px', border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.error, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>
                        {deletingId === c.id ? '...' : 'Delete'}
                      </button>
                    </div>
                  )}
                </div>
                {isSharing && shareToken && (
                  <div style={{ marginTop: 4, padding: '8px 12px', background: T.primaryLight || 'rgba(93,173,226,0.08)', border: `1px solid ${T.primary}40`, borderRadius: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: T.textSecondary }}>Share token:</span>
                    <code style={{ fontFamily: T.mono, fontSize: 11, padding: '3px 8px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 4, color: T.text, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{shareToken}</code>
                    <button onClick={copyShareToken} style={{ fontSize: 10, padding: '3px 10px', border: `1px solid ${T.primary}`, borderRadius: 4, background: T.primary, color: '#fff', cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button onClick={() => emailShareToken(c.name)} style={{ fontSize: 10, padding: '3px 10px', border: `1px solid ${T.border}`, borderRadius: 4, background: T.surface, color: T.primary, cursor: 'pointer', fontFamily: T.font, fontWeight: 600 }}>Email</button>
                    <button onClick={() => { setSharingCoachId(null); setShareToken(null) }} style={{ fontSize: 10, padding: '3px 8px', border: 'none', background: 'transparent', color: T.textMuted, cursor: 'pointer', fontFamily: T.font }}>Close</button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
