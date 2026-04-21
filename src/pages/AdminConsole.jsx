import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T, formatCurrency, formatDate } from '../lib/theme'
import { Button, Badge, Spinner, TabBar, inputStyle, labelStyle } from '../components/Shared'

const MODULE_SLUGS = [
  'pipeline', 'deal_management', 'transcript_analysis', 'coaching',
  'company_research', 'msp', 'cpq', 'proposal', 'coach_customization', 'reports',
]

const ADMIN_TABS = [
  { key: 'orgs', label: 'Organizations' },
  { key: 'users', label: 'Users' },
  { key: 'plans', label: 'Plans' },
  { key: 'credits', label: 'Credits' },
  { key: 'costs', label: 'Credit Costs' },
  { key: 'modules', label: 'Modules' },
  { key: 'usage', label: 'Usage' },
]

const cellStyle = { padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${T.border}`, verticalAlign: 'top' }
const thStyle = { ...cellStyle, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10, background: T.surfaceAlt }
const smallInput = { ...inputStyle, padding: '6px 8px', fontSize: 12 }

function StatusBadge({ status }) {
  const colors = { active: T.success, trial: T.warning, suspended: T.error, cancelled: T.textMuted }
  return <Badge color={colors[status] || T.textMuted}>{status || 'unknown'}</Badge>
}

export default function AdminConsole() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('orgs')
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)

  useEffect(() => {
    if (profile?.id) {
      supabase.from('platform_admins').select('id').eq('user_id', profile.id).single()
        .then(({ data }) => setIsPlatformAdmin(!!data))
    }
  }, [profile])

  if (isPlatformAdmin === null) return <Spinner />
  if (!isPlatformAdmin) return (
    <div style={{ padding: 40, textAlign: 'center', color: T.textMuted }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Access Denied</div>
      <div style={{ fontSize: 13 }}>You must be a platform admin to access this page.</div>
    </div>
  )

  return (
    <div style={{ fontFamily: T.font, color: T.text, fontSize: 13, minHeight: '100vh', background: T.bg }}>
      <div style={{ padding: '16px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: T.text }}>Platform Admin Console</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => nav('/admin/invitations')} style={{ background: T.surface, color: T.primary, border: `1px solid ${T.primary}`, borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Invitations</button>
            <button onClick={() => nav('/admin/feedback')} style={{ background: T.primary, color: '#fff', border: 'none', borderRadius: 6, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: T.font }}>Beta Feedback</button>
          </div>
        </div>
      </div>
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <TabBar tabs={ADMIN_TABS} active={tab} onChange={setTab} />
      </div>
      <div style={{ padding: 24 }}>
        {tab === 'orgs' && <OrganizationsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'plans' && <PlansTab />}
        {tab === 'credits' && <CreditsTab />}
        {tab === 'costs' && <CreditCostsTab />}
        {tab === 'modules' && <ModulesTab />}
        {tab === 'usage' && <UsageTab />}
      </div>
    </div>
  )
}

// ==================== TAB 1: ORGANIZATIONS ====================
function OrganizationsTab() {
  const [orgs, setOrgs] = useState([])
  const [plans, setPlans] = useState([])
  const [credits, setCredits] = useState([])
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({})
  const [showCreate, setShowCreate] = useState(false)
  const [newOrg, setNewOrg] = useState({ name: '', slug: '', domain: '', plan_id: '', max_users: 10, max_deals: '', fy_month: 12, fy_day: 31 })
  const [allModules, setAllModules] = useState([])
  const [moduleToggles, setModuleToggles] = useState({})
  const [deals, setDeals] = useState([])

  useEffect(() => { loadOrgs() }, [])

  async function loadOrgs() {
    setLoading(true)
    const [orgsRes, plansRes, creditsRes, profilesRes, modulesRes, dealsRes] = await Promise.all([
      supabase.from('organizations').select('*, plans(id,name,slug,modules)'),
      supabase.from('plans').select('*').order('sort_order'),
      supabase.from('org_credits').select('*'),
      supabase.from('profiles').select('id, org_id'),
      supabase.from('modules').select('*').eq('active', true).order('sort_order'),
      supabase.from('deals').select('id, org_id'),
    ])
    setOrgs(orgsRes.data || [])
    setPlans(plansRes.data || [])
    setCredits(creditsRes.data || [])
    setProfiles(profilesRes.data || [])
    setAllModules(modulesRes.data || [])
    setDeals(dealsRes.data || [])
    setLoading(false)
  }

  function startEdit(org) {
    if (editingId === org.id) { setEditingId(null); return }
    setEditingId(org.id)
    setEditData({
      name: org.name, domain: org.domain || '', status: org.status, plan_id: org.plan_id,
      max_users: org.max_users || '', max_deals: org.max_deals || '',
      trial_ends_at: org.trial_ends_at || '', primary_color: org.primary_color || '#5DADE2',
      fiscal_year_end_month: org.fiscal_year_end_month || 12, fiscal_year_end_day: org.fiscal_year_end_day || 31,
    })
    // Init module toggles from modules_override or plan.modules
    const effectiveModules = org.modules_override || org.plans?.modules || []
    const toggles = {}
    allModules.forEach(m => { toggles[m.module_key] = effectiveModules.includes(m.module_key) })
    setModuleToggles(toggles)
  }

  async function saveEdit() {
    const org = orgs.find(o => o.id === editingId)
    const planModules = org?.plans?.modules || []
    const checkedKeys = allModules.filter(m => moduleToggles[m.module_key]).map(m => m.module_key)
    // Determine if override needed: compare sorted arrays
    const isCustom = JSON.stringify([...checkedKeys].sort()) !== JSON.stringify([...planModules].sort())
    const updates = { ...editData, modules_override: isCustom ? checkedKeys : null }
    await supabase.from('organizations').update(updates).eq('id', editingId)
    setEditingId(null)
    loadOrgs()
  }

  async function resetModulesToPlan() {
    await supabase.from('organizations').update({ modules_override: null }).eq('id', editingId)
    const org = orgs.find(o => o.id === editingId)
    const planModules = org?.plans?.modules || []
    const toggles = {}
    allModules.forEach(m => { toggles[m.module_key] = planModules.includes(m.module_key) })
    setModuleToggles(toggles)
    loadOrgs()
  }

  async function deleteOrg(id) {
    if (!confirm('Delete this organization? This cannot be undone.')) return
    await supabase.from('organizations').delete().eq('id', id)
    loadOrgs()
  }

  async function createOrg() {
    const slug = newOrg.slug || newOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')
    const { data, error } = await supabase.from('organizations').insert({
      name: newOrg.name, slug, domain: newOrg.domain, plan_id: newOrg.plan_id || null,
      max_users: newOrg.max_users || null, max_deals: newOrg.max_deals || null, status: 'active',
      fiscal_year_end_month: newOrg.fy_month || 12, fiscal_year_end_day: newOrg.fy_day || 31,
    }).select().single()
    if (!error && data) {
      const plan = plans.find(p => p.id === newOrg.plan_id)
      await supabase.from('org_credits').insert({
        org_id: data.id, balance: plan?.credits_monthly || 0,
        total_granted: plan?.credits_monthly || 0, total_used: 0,
      })
      setShowCreate(false)
      setNewOrg({ name: '', slug: '', domain: '', plan_id: '', max_users: 10 })
      loadOrgs()
    }
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
        <Button primary onClick={() => setShowCreate(!showCreate)}>Create Organization</Button>
      </div>

      {showCreate && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Name</label><input style={smallInput} value={newOrg.name} onChange={e => setNewOrg({ ...newOrg, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></div>
            <div><label style={labelStyle}>Slug</label><input style={smallInput} value={newOrg.slug || newOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} onChange={e => setNewOrg({ ...newOrg, slug: e.target.value })} /></div>
            <div><label style={labelStyle}>Domain</label><input style={smallInput} value={newOrg.domain} onChange={e => setNewOrg({ ...newOrg, domain: e.target.value })} /></div>
            <div><label style={labelStyle}>Plan</label><select style={{ ...smallInput, cursor: 'pointer' }} value={newOrg.plan_id} onChange={e => setNewOrg({ ...newOrg, plan_id: e.target.value })}><option value="">-- Free --</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
            <div><label style={labelStyle}>Max Users</label><input type="number" style={smallInput} value={newOrg.max_users} onChange={e => setNewOrg({ ...newOrg, max_users: Number(e.target.value) })} /></div>
            <div><label style={labelStyle}>Max Deals</label><input type="number" style={smallInput} value={newOrg.max_deals} onChange={e => setNewOrg({ ...newOrg, max_deals: e.target.value })} placeholder="Unlimited" /></div>
            <div><label style={labelStyle}>FY End Month</label><select style={{ ...smallInput, cursor: 'pointer' }} value={newOrg.fy_month} onChange={e => setNewOrg({ ...newOrg, fy_month: Number(e.target.value) })}>{['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((n,i) => <option key={i} value={i+1}>{n}</option>)}</select></div>
            <div><label style={labelStyle}>FY End Day</label><select style={{ ...smallInput, cursor: 'pointer' }} value={newOrg.fy_day} onChange={e => setNewOrg({ ...newOrg, fy_day: Number(e.target.value) })}>{Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></div>
          </div>
          <Button primary onClick={createOrg} disabled={!newOrg.name}>Save</Button>
          <Button style={{ marginLeft: 8 }} onClick={() => setShowCreate(false)}>Cancel</Button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
        <thead>
          <tr>
            {['Name', 'Slug', 'Plan', 'Status', 'Users', 'Deals', 'Credits', 'FY End', 'Created'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgs.map(org => {
            const plan = plans.find(p => p.id === org.plan_id)
            const cred = credits.find(c => c.org_id === org.id)
            const userCount = profiles.filter(p => p.org_id === org.id).length
            const dealCount = deals.filter(d => d.org_id === org.id).length
            const isEditing = editingId === org.id
            const hasOverride = org.modules_override != null
            const fyMonth = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(org.fiscal_year_end_month || 12) - 1]

            return (
              <React.Fragment key={org.id}>
                <tr onClick={() => startEdit(org)} style={{ cursor: 'pointer', background: isEditing ? T.primaryLight : 'transparent' }}>
                  <td style={cellStyle}><span style={{ fontWeight: 600 }}>{org.name}</span></td>
                  <td style={{ ...cellStyle, color: T.textMuted, fontFamily: T.mono, fontSize: 11 }}>{org.slug}</td>
                  <td style={cellStyle}>
                    {plan?.name || '--'}
                    {hasOverride && <Badge color={T.primary} style={{ marginLeft: 4 }}>Custom</Badge>}
                  </td>
                  <td style={cellStyle}><StatusBadge status={org.status} /></td>
                  <td style={cellStyle}>{userCount}</td>
                  <td style={cellStyle}>{dealCount}</td>
                  <td style={cellStyle}>{cred?.balance ?? 0}</td>
                  <td style={{ ...cellStyle, fontSize: 11, color: T.textMuted }}>{fyMonth} {org.fiscal_year_end_day || 31}</td>
                  <td style={{ ...cellStyle, color: T.textMuted, fontSize: 11 }}>{formatDate(org.created_at?.split('T')[0])}</td>
                </tr>
                {isEditing && (
                  <tr><td colSpan={9} style={{ padding: 0, border: 'none' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, padding: 16, background: T.surfaceAlt, borderBottom: `1px solid ${T.border}` }}>
                      {/* LEFT: Settings */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Settings</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                          <div><label style={labelStyle}>Name</label><input style={smallInput} value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} /></div>
                          <div><label style={labelStyle}>Slug (read-only)</label><input style={{ ...smallInput, background: T.surfaceAlt }} value={org.slug} disabled /></div>
                          <div><label style={labelStyle}>Domain</label><input style={smallInput} value={editData.domain} onChange={e => setEditData({ ...editData, domain: e.target.value })} /></div>
                          <div><label style={labelStyle}>Status</label><select style={{ ...smallInput, cursor: 'pointer' }} value={editData.status} onChange={e => setEditData({ ...editData, status: e.target.value })}>{['active','trial','suspended','cancelled'].map(s => <option key={s} value={s}>{s}</option>)}</select></div>
                          <div><label style={labelStyle}>Plan</label><select style={{ ...smallInput, cursor: 'pointer' }} value={editData.plan_id || ''} onChange={e => setEditData({ ...editData, plan_id: e.target.value })}><option value="">--</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
                          <div><label style={labelStyle}>Max Users</label><input type="number" style={smallInput} value={editData.max_users} onChange={e => setEditData({ ...editData, max_users: e.target.value })} placeholder="Unlimited" /></div>
                          <div><label style={labelStyle}>Max Deals</label><input type="number" style={smallInput} value={editData.max_deals} onChange={e => setEditData({ ...editData, max_deals: e.target.value })} placeholder="Unlimited" /></div>
                          {editData.status === 'trial' && <div><label style={labelStyle}>Trial Ends</label><input type="date" style={smallInput} value={editData.trial_ends_at?.split('T')[0] || ''} onChange={e => setEditData({ ...editData, trial_ends_at: e.target.value })} /></div>}
                          <div><label style={labelStyle}>FY End Month</label><select style={{ ...smallInput, cursor: 'pointer' }} value={editData.fiscal_year_end_month} onChange={e => setEditData({ ...editData, fiscal_year_end_month: Number(e.target.value) })}>{['January','February','March','April','May','June','July','August','September','October','November','December'].map((n,i) => <option key={i} value={i+1}>{n}</option>)}</select></div>
                          <div><label style={labelStyle}>FY End Day</label><select style={{ ...smallInput, cursor: 'pointer' }} value={editData.fiscal_year_end_day} onChange={e => setEditData({ ...editData, fiscal_year_end_day: Number(e.target.value) })}>{Array.from({length:31},(_,i)=><option key={i+1} value={i+1}>{i+1}</option>)}</select></div>
                          <div><label style={labelStyle}>Primary Color</label><div style={{ display: 'flex', gap: 4, alignItems: 'center' }}><input type="color" value={editData.primary_color || '#5DADE2'} onChange={e => setEditData({ ...editData, primary_color: e.target.value })} style={{ width: 32, height: 24, border: 'none', cursor: 'pointer' }} /><span style={{ fontSize: 10, color: T.textMuted, fontFamily: T.mono }}>{editData.primary_color}</span></div></div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                          <Button primary onClick={saveEdit} style={{ padding: '5px 14px', fontSize: 11 }}>Save</Button>
                          <Button onClick={() => setEditingId(null)} style={{ padding: '5px 14px', fontSize: 11 }}>Cancel</Button>
                          <button onClick={e => { e.stopPropagation(); deleteOrg(org.id) }} style={{ background: 'none', border: 'none', color: T.error, cursor: 'pointer', fontSize: 11, fontFamily: T.font, marginLeft: 'auto' }}>Delete org...</button>
                        </div>
                      </div>
                      {/* RIGHT: Modules */}
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: T.text, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Modules</div>
                        <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Toggle to override plan defaults. Any toggle marks this org as Custom.</div>
                        {allModules.map(m => {
                          const enabled = !!moduleToggles[m.module_key]
                          const planHas = (org.plans?.modules || []).includes(m.module_key)
                          const isOverridden = org.modules_override != null
                          let sourceText = 'from plan'
                          let sourceColor = T.textMuted
                          if (isOverridden) {
                            sourceText = enabled ? 'custom: enabled' : 'custom: disabled'
                            sourceColor = enabled ? T.success : T.error
                          }
                          return (
                            <div key={m.module_key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: `1px solid ${T.borderLight}` }}>
                              <div onClick={() => setModuleToggles(prev => ({ ...prev, [m.module_key]: !prev[m.module_key] }))} style={{ width: 36, height: 20, borderRadius: 10, cursor: 'pointer', background: enabled ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
                                <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: enabled ? 18 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                              </div>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{m.module_name}{m.is_premium && <span style={{ fontSize: 9, fontWeight: 700, color: T.warning, marginLeft: 4 }}>PREMIUM</span>}</div>
                                <div style={{ fontSize: 10, color: T.textMuted }}>{m.module_key}</div>
                              </div>
                              <span style={{ fontSize: 9, color: sourceColor, fontWeight: 600 }}>{sourceText}</span>
                            </div>
                          )
                        })}
                        {org.modules_override != null && (
                          <button onClick={resetModulesToPlan} style={{ marginTop: 8, background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '4px 10px', fontSize: 10, cursor: 'pointer', color: T.primary, fontFamily: T.font }}>Reset to plan defaults</button>
                        )}
                      </div>
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ==================== TAB 2: USERS ====================
function UsersTab() {
  const [users, setUsers] = useState([])
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({})
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({ email: '', name: '', org_id: '', role: 'rep', message: '' })
  const [invitations, setInvitations] = useState([])

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const [usersRes, orgsRes, invRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('organizations').select('id, name'),
      supabase.from('invitations').select('*, organizations(name)').eq('status', 'pending').order('created_at', { ascending: false }),
    ])
    setUsers(usersRes.data || [])
    setOrgs(orgsRes.data || [])
    setInvitations(invRes.data || [])
    setLoading(false)
  }

  async function saveEdit() {
    await supabase.from('profiles').update({ role: editData.role, org_id: editData.org_id || null }).eq('id', editingId)
    setEditingId(null)
    loadUsers()
  }

  async function sendInvite() {
    if (!invite.email.trim()) return
    const isNewInstance = !invite.org_id
    const { data: inv, error } = await supabase.from('invitations').insert({
      email: invite.email.trim().toLowerCase(),
      invited_name: invite.name || null,
      org_id: isNewInstance ? null : invite.org_id,
      role: invite.role,
      invitation_type: isNewInstance ? 'new_instance' : 'teammate',
      personal_message: invite.message || null,
      invited_by: null, // platform admin context; invited_by can be set if profile available
    }).select().single()
    if (error) { alert(error.message); return }
    // Try to send email via edge function
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invitation`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
          body: JSON.stringify({ invitation_id: inv.id }),
        })
      }
    } catch (e) { /* edge function may not be deployed yet */ }
    setShowInvite(false)
    setInvite({ email: '', name: '', org_id: '', role: 'rep', message: '' })
    loadUsers()
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button primary onClick={() => setShowInvite(!showInvite)}>Invite User</Button>
      </div>

      {showInvite && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 8 }}>
            <div><label style={labelStyle}>Email *</label><input style={smallInput} value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} placeholder="user@company.com" /></div>
            <div><label style={labelStyle}>Name</label><input style={smallInput} value={invite.name} onChange={e => setInvite({ ...invite, name: e.target.value })} placeholder="Optional" /></div>
            <div>
              <label style={labelStyle}>Organization</label>
              <select style={{ ...smallInput, cursor: 'pointer' }} value={invite.org_id} onChange={e => setInvite({ ...invite, org_id: e.target.value })}>
                <option value="">New instance (create org)</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select style={{ ...smallInput, cursor: 'pointer' }} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>
                {['admin', 'rep', 'manager', 'system_admin'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 10 }}><label style={labelStyle}>Personal message</label><textarea style={{ ...smallInput, minHeight: 40, resize: 'vertical' }} value={invite.message} onChange={e => setInvite({ ...invite, message: e.target.value.slice(0, 500) })} placeholder="Optional message in the email..." /></div>
          <Button primary onClick={sendInvite} disabled={!invite.email.trim()}>Send Invite</Button>
          <Button style={{ marginLeft: 8 }} onClick={() => setShowInvite(false)}>Cancel</Button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
        <thead>
          <tr>
            {['Name', 'Email', 'Organization', 'Role', 'Created', ''].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const org = orgs.find(o => o.id === u.org_id)
            const isEditing = editingId === u.id

            return isEditing ? (
              <tr key={u.id} style={{ background: T.primaryLight }}>
                <td style={cellStyle}>{u.full_name}</td>
                <td style={cellStyle}>{u.email}</td>
                <td style={cellStyle}>
                  <select style={smallInput} value={editData.org_id || ''} onChange={e => setEditData({ ...editData, org_id: e.target.value })}>
                    <option value="">-- None --</option>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                </td>
                <td style={cellStyle}>
                  <select style={smallInput} value={editData.role} onChange={e => setEditData({ ...editData, role: e.target.value })}>
                    {['rep', 'manager', 'admin', 'system_admin'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td style={cellStyle}></td>
                <td style={cellStyle}>
                  <Button primary onClick={saveEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Save</Button>
                  <Button onClick={() => setEditingId(null)} style={{ padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Cancel</Button>
                </td>
              </tr>
            ) : (
              <tr key={u.id} onClick={() => { setEditingId(u.id); setEditData({ role: u.role || 'rep', org_id: u.org_id || '' }) }} style={{ cursor: 'pointer' }}>
                <td style={cellStyle}><span style={{ fontWeight: 600 }}>{u.full_name}</span></td>
                <td style={{ ...cellStyle, color: T.textMuted }}>{u.email}</td>
                <td style={cellStyle}>{org?.name || <span style={{ color: T.textMuted }}>--</span>}</td>
                <td style={cellStyle}><Badge color={u.role === 'system_admin' ? T.error : u.role === 'admin' ? T.warning : T.primary}>{u.role || 'rep'}</Badge></td>
                <td style={{ ...cellStyle, color: T.textMuted, fontSize: 11 }}>{formatDate(u.created_at?.split('T')[0])}</td>
                <td style={cellStyle}></td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text, marginTop: 20, marginBottom: 8 }}>Pending Invitations ({invitations.length})</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
            <thead><tr>
              {['Email', 'Name', 'Org', 'Role', 'Type', 'Email Status', 'Expires', 'Actions'].map(h => <th key={h} style={thStyle}>{h}</th>)}
            </tr></thead>
            <tbody>
              {invitations.map(inv => (
                <tr key={inv.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                  <td style={cellStyle}>{inv.email}</td>
                  <td style={{ ...cellStyle, color: T.textMuted }}>{inv.invited_name || '--'}</td>
                  <td style={cellStyle}>{inv.organizations?.name || <span style={{ color: T.textMuted }}>New instance</span>}</td>
                  <td style={cellStyle}><Badge color={T.primary}>{inv.role}</Badge></td>
                  <td style={cellStyle}><Badge color={inv.invitation_type === 'new_instance' ? T.warning : T.success}>{inv.invitation_type}</Badge></td>
                  <td style={cellStyle}><Badge color={inv.email_status === 'sent' ? T.success : inv.email_status === 'failed' ? T.error : T.textMuted}>{inv.email_status || 'unsent'}</Badge></td>
                  <td style={{ ...cellStyle, fontSize: 11, color: T.textMuted }}>{inv.expires_at ? formatDate(inv.expires_at) : '--'}</td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={async () => {
                        try { const { data: { session } } = await supabase.auth.getSession(); if (session) await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-invitation`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY }, body: JSON.stringify({ invitation_id: inv.id }) }) } catch(e) {}; loadUsers()
                      }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer', color: T.primary, fontFamily: T.font }}>Resend</button>
                      <button onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/invite/${inv.token}`) }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>Copy</button>
                      <button onClick={async () => { await supabase.from('invitations').update({ status: 'revoked' }).eq('id', inv.id); loadUsers() }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 6px', fontSize: 10, cursor: 'pointer', color: T.error, fontFamily: T.font }}>Revoke</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ==================== TAB 3: PLANS ====================
function PlansTab() {
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [editData, setEditData] = useState({})
  const [showCreate, setShowCreate] = useState(false)
  const [newPlan, setNewPlan] = useState({
    name: '', monthly_price: 0, credits_monthly: 0, max_users: 10,
    modules: [], active: true, sort_order: 0,
  })

  useEffect(() => { loadPlans() }, [])

  async function loadPlans() {
    setLoading(true)
    const { data } = await supabase.from('plans').select('*').order('sort_order')
    setPlans(data || [])
    setLoading(false)
  }

  function startEdit(plan) {
    setEditingId(plan.id)
    setEditData({ ...plan, modules: plan.modules || [] })
  }

  async function saveEdit() {
    const { id, created_at, updated_at, ...fields } = editData
    await supabase.from('plans').update(fields).eq('id', editingId)
    setEditingId(null)
    loadPlans()
  }

  async function createPlan() {
    await supabase.from('plans').insert(newPlan)
    setShowCreate(false)
    setNewPlan({ name: '', monthly_price: 0, credits_monthly: 0, max_users: 10, modules: [], active: true, sort_order: 0 })
    loadPlans()
  }

  function toggleModule(modules, slug) {
    return modules.includes(slug) ? modules.filter(m => m !== slug) : [...modules, slug]
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button primary onClick={() => setShowCreate(!showCreate)}>Create Plan</Button>
      </div>

      {showCreate && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Name</label><input style={smallInput} value={newPlan.name} onChange={e => setNewPlan({ ...newPlan, name: e.target.value })} /></div>
            <div><label style={labelStyle}>Monthly Price</label><input type="number" style={smallInput} value={newPlan.monthly_price} onChange={e => setNewPlan({ ...newPlan, monthly_price: Number(e.target.value) })} /></div>
            <div><label style={labelStyle}>Credits/Month</label><input type="number" style={smallInput} value={newPlan.credits_monthly} onChange={e => setNewPlan({ ...newPlan, credits_monthly: Number(e.target.value) })} /></div>
            <div><label style={labelStyle}>Max Users</label><input type="number" style={smallInput} value={newPlan.max_users} onChange={e => setNewPlan({ ...newPlan, max_users: Number(e.target.value) })} /></div>
            <div><label style={labelStyle}>Sort Order</label><input type="number" style={smallInput} value={newPlan.sort_order} onChange={e => setNewPlan({ ...newPlan, sort_order: Number(e.target.value) })} /></div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Modules</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MODULE_SLUGS.map(slug => (
                <label key={slug} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={newPlan.modules.includes(slug)} onChange={() => setNewPlan({ ...newPlan, modules: toggleModule(newPlan.modules, slug) })} />
                  {slug}
                </label>
              ))}
            </div>
          </div>
          <Button primary onClick={createPlan} disabled={!newPlan.name}>Save</Button>
          <Button style={{ marginLeft: 8 }} onClick={() => setShowCreate(false)}>Cancel</Button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
        <thead>
          <tr>
            {['Name', 'Monthly Price', 'Credits', 'Max Users', 'Modules', 'Active', ''].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {plans.map(plan => {
            const isEditing = editingId === plan.id
            if (isEditing) {
              return (
                <tr key={plan.id} style={{ background: T.primaryLight }}>
                  <td style={cellStyle}><input style={smallInput} value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} /></td>
                  <td style={cellStyle}><input type="number" style={{ ...smallInput, width: 80 }} value={editData.monthly_price} onChange={e => setEditData({ ...editData, monthly_price: Number(e.target.value) })} /></td>
                  <td style={cellStyle}><input type="number" style={{ ...smallInput, width: 80 }} value={editData.credits_monthly} onChange={e => setEditData({ ...editData, credits_monthly: Number(e.target.value) })} /></td>
                  <td style={cellStyle}><input type="number" style={{ ...smallInput, width: 60 }} value={editData.max_users} onChange={e => setEditData({ ...editData, max_users: Number(e.target.value) })} /></td>
                  <td style={cellStyle}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {MODULE_SLUGS.map(slug => (
                        <label key={slug} style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 10, cursor: 'pointer' }}>
                          <input type="checkbox" checked={(editData.modules || []).includes(slug)} onChange={() => setEditData({ ...editData, modules: toggleModule(editData.modules || [], slug) })} />
                          {slug}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td style={cellStyle}>
                    <input type="checkbox" checked={editData.active} onChange={e => setEditData({ ...editData, active: e.target.checked })} />
                  </td>
                  <td style={cellStyle}>
                    <Button primary onClick={saveEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Save</Button>
                    <Button onClick={() => setEditingId(null)} style={{ padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Cancel</Button>
                  </td>
                </tr>
              )
            }
            return (
              <tr key={plan.id} onClick={() => startEdit(plan)} style={{ cursor: 'pointer' }}>
                <td style={cellStyle}><span style={{ fontWeight: 600 }}>{plan.name}</span></td>
                <td style={cellStyle}>{formatCurrency(plan.monthly_price)}</td>
                <td style={cellStyle}>{plan.credits_monthly}</td>
                <td style={cellStyle}>{plan.max_users}</td>
                <td style={cellStyle}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {(plan.modules || []).map(m => <Badge key={m} color={T.primary}>{m}</Badge>)}
                  </div>
                </td>
                <td style={cellStyle}>{plan.active ? <Badge color={T.success}>Active</Badge> : <Badge color={T.textMuted}>Inactive</Badge>}</td>
                <td style={cellStyle}></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ==================== TAB 4: CREDITS ====================
function CreditsTab() {
  const [credits, setCredits] = useState([])
  const [orgs, setOrgs] = useState([])
  const [ledger, setLedger] = useState([])
  const [loading, setLoading] = useState(true)
  const [grantOrg, setGrantOrg] = useState('')
  const [grantAmount, setGrantAmount] = useState(0)
  const [grantReason, setGrantReason] = useState('')

  useEffect(() => { loadCredits() }, [])

  async function loadCredits() {
    setLoading(true)
    const [creditsRes, orgsRes, ledgerRes] = await Promise.all([
      supabase.from('org_credits').select('*'),
      supabase.from('organizations').select('id, name'),
      supabase.from('credit_ledger').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    setCredits(creditsRes.data || [])
    setOrgs(orgsRes.data || [])
    setLedger(ledgerRes.data || [])
    setLoading(false)
  }

  async function grantCredits() {
    if (!grantOrg || !grantAmount) return
    await supabase.rpc('grant_credits', { p_org_id: grantOrg, p_amount: grantAmount, p_description: grantReason })
    setGrantOrg('')
    setGrantAmount(0)
    setGrantReason('')
    loadCredits()
  }

  if (loading) return <Spinner />

  const totalBalance = credits.reduce((s, c) => s + (c.balance || 0), 0)
  const totalUsed = credits.reduce((s, c) => s + (c.total_used || 0), 0)
  const totalGranted = credits.reduce((s, c) => s + (c.total_granted || 0), 0)

  return (
    <div>
      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Balance', value: totalBalance, color: T.primary },
          { label: 'Total Used', value: totalUsed, color: T.error },
          { label: 'Total Granted', value: totalGranted, color: T.success },
        ].map(c => (
          <div key={c.label} style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 8 }}>{c.label}</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: c.color }}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Grant credits */}
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Grant Credits</div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Organization</label>
            <select style={smallInput} value={grantOrg} onChange={e => setGrantOrg(e.target.value)}>
              <option value="">-- Select --</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Amount</label>
            <input type="number" style={{ ...smallInput, width: 100 }} value={grantAmount} onChange={e => setGrantAmount(Number(e.target.value))} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Reason</label>
            <input style={smallInput} value={grantReason} onChange={e => setGrantReason(e.target.value)} />
          </div>
          <Button primary onClick={grantCredits} disabled={!grantOrg || !grantAmount}>Grant</Button>
        </div>
      </div>

      {/* Per-org table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}`, marginBottom: 24 }}>
        <thead>
          <tr>
            {['Organization', 'Balance', 'Used', 'Granted', 'Last Grant'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {credits.map(c => {
            const org = orgs.find(o => o.id === c.org_id)
            return (
              <tr key={c.id}>
                <td style={cellStyle}><span style={{ fontWeight: 600 }}>{org?.name || c.org_id}</span></td>
                <td style={{ ...cellStyle, fontWeight: 700, color: T.primary }}>{c.balance}</td>
                <td style={{ ...cellStyle, color: T.error }}>{c.total_used}</td>
                <td style={{ ...cellStyle, color: T.success }}>{c.total_granted}</td>
                <td style={{ ...cellStyle, color: T.textMuted, fontSize: 11 }}>{formatDate(c.last_grant_at?.split('T')[0])}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* Recent ledger */}
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Recent Transactions</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
        <thead>
          <tr>
            {['Date', 'Organization', 'Type', 'Amount', 'Description'].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ledger.map(l => {
            const org = orgs.find(o => o.id === l.org_id)
            return (
              <tr key={l.id}>
                <td style={{ ...cellStyle, fontSize: 11, color: T.textMuted }}>{formatDate(l.created_at?.split('T')[0])}</td>
                <td style={cellStyle}>{org?.name || l.org_id}</td>
                <td style={cellStyle}><Badge color={l.transaction_type === 'grant' ? T.success : l.transaction_type === 'usage' ? T.error : T.primary}>{l.transaction_type}</Badge></td>
                <td style={{ ...cellStyle, fontWeight: 600, color: l.amount > 0 ? T.success : T.error }}>{l.amount > 0 ? '+' : ''}{l.amount}</td>
                <td style={{ ...cellStyle, color: T.textSecondary }}>{l.description}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ==================== TAB 5: CREDIT COSTS ====================
function CreditCostsTab() {
  const [costs, setCosts] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadCosts() }, [])

  async function loadCosts() {
    setLoading(true)
    const { data } = await supabase.from('credit_costs').select('*')
    setCosts(data || [])
    setLoading(false)
  }

  async function saveCost(id, field, value) {
    const val = field === 'credits_cost' ? Number(value) : value
    await supabase.from('credit_costs').update({ [field]: val }).eq('id', id)
  }

  if (loading) return <Spinner />

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
      <thead>
        <tr>
          {['Action Type', 'Credits Cost', 'Description'].map(h => (
            <th key={h} style={thStyle}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {costs.map(c => (
          <tr key={c.id}>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{c.action_type}</td>
            <td style={cellStyle}>
              <input type="number" style={{ ...smallInput, width: 80 }} defaultValue={c.credits_cost}
                onBlur={e => saveCost(c.id, 'credits_cost', e.target.value)} />
            </td>
            <td style={cellStyle}>
              <input style={{ ...smallInput, width: '100%' }} defaultValue={c.description || ''}
                onBlur={e => saveCost(c.id, 'description', e.target.value)} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ==================== TAB 6: MODULES ====================
function ModulesTab() {
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadModules() }, [])

  async function loadModules() {
    setLoading(true)
    const { data } = await supabase.from('modules').select('*')
    setModules(data || [])
    setLoading(false)
  }

  async function saveModule(id, field, value) {
    await supabase.from('modules').update({ [field]: value }).eq('id', id)
  }

  if (loading) return <Spinner />

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}` }}>
      <thead>
        <tr>
          {['Name', 'Slug', 'Description', 'Active'].map(h => (
            <th key={h} style={thStyle}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {modules.map(m => (
          <tr key={m.id}>
            <td style={{ ...cellStyle, fontWeight: 600 }}>{m.name}</td>
            <td style={{ ...cellStyle, fontFamily: T.mono, fontSize: 11, color: T.textMuted }}>{m.slug}</td>
            <td style={cellStyle}>
              <input style={{ ...smallInput, width: '100%' }} defaultValue={m.description || ''}
                onBlur={e => saveModule(m.id, 'description', e.target.value)} />
            </td>
            <td style={cellStyle}>
              <input type="checkbox" checked={m.active} onChange={e => {
                saveModule(m.id, 'active', e.target.checked)
                setModules(modules.map(mod => mod.id === m.id ? { ...mod, active: e.target.checked } : mod))
              }} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ==================== TAB 7: USAGE ====================
function UsageTab() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadUsage() }, [])

  async function loadUsage() {
    setLoading(true)
    const { data } = await supabase.from('ai_response_log')
      .select('response_type, status, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    setLogs(data || [])
    setLoading(false)
  }

  if (loading) return <Spinner />

  const byType = {}
  const byStatus = { success: 0, failed: 0, pending: 0 }
  logs.forEach(l => {
    byType[l.response_type] = (byType[l.response_type] || 0) + 1
    if (l.status === 'success' || l.status === 'completed') byStatus.success++
    else if (l.status === 'failed' || l.status === 'error') byStatus.failed++
    else byStatus.pending++
  })

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* By type */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>By Response Type</div>
          {Object.entries(byType).map(([type, count]) => (
            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12 }}>{type}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: T.primary }}>{count}</span>
            </div>
          ))}
        </div>

        {/* By status */}
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>By Status</div>
          {[
            { label: 'Success', count: byStatus.success, color: T.success },
            { label: 'Failed', count: byStatus.failed, color: T.error },
            { label: 'Pending', count: byStatus.pending, color: T.warning },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: `1px solid ${T.border}` }}>
              <span style={{ fontSize: 12 }}>{s.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.count}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontWeight: 700 }}>
            <span style={{ fontSize: 12 }}>Total</span>
            <span style={{ fontSize: 12 }}>{logs.length}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
