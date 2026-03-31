import { useState, useEffect } from 'react'
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
        <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, color: T.text }}>Platform Admin Console</h1>
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
  const [newOrg, setNewOrg] = useState({ name: '', slug: '', domain: '', plan_id: '', max_users: 10 })

  useEffect(() => { loadOrgs() }, [])

  async function loadOrgs() {
    setLoading(true)
    const [orgsRes, plansRes, creditsRes, profilesRes] = await Promise.all([
      supabase.from('organizations').select('*'),
      supabase.from('plans').select('*'),
      supabase.from('org_credits').select('*'),
      supabase.from('profiles').select('id, org_id'),
    ])
    setOrgs(orgsRes.data || [])
    setPlans(plansRes.data || [])
    setCredits(creditsRes.data || [])
    setProfiles(profilesRes.data || [])
    setLoading(false)
  }

  function startEdit(org) {
    setEditingId(org.id)
    setEditData({ name: org.name, status: org.status, plan_id: org.plan_id, max_users: org.max_users, max_deals: org.max_deals, trial_ends_at: org.trial_ends_at || '' })
  }

  async function saveEdit() {
    await supabase.from('organizations').update(editData).eq('id', editingId)
    setEditingId(null)
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
      max_users: newOrg.max_users, status: 'active',
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Name</label><input style={smallInput} value={newOrg.name} onChange={e => setNewOrg({ ...newOrg, name: e.target.value, slug: e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-') })} /></div>
            <div><label style={labelStyle}>Slug</label><input style={smallInput} value={newOrg.slug || newOrg.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')} onChange={e => setNewOrg({ ...newOrg, slug: e.target.value })} /></div>
            <div><label style={labelStyle}>Domain</label><input style={smallInput} value={newOrg.domain} onChange={e => setNewOrg({ ...newOrg, domain: e.target.value })} /></div>
            <div>
              <label style={labelStyle}>Plan</label>
              <select style={smallInput} value={newOrg.plan_id} onChange={e => setNewOrg({ ...newOrg, plan_id: e.target.value })}>
                <option value="">-- Select --</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label style={labelStyle}>Max Users</label><input type="number" style={smallInput} value={newOrg.max_users} onChange={e => setNewOrg({ ...newOrg, max_users: Number(e.target.value) })} /></div>
          </div>
          <Button primary onClick={createOrg} disabled={!newOrg.name}>Save</Button>
          <Button style={{ marginLeft: 8 }} onClick={() => setShowCreate(false)}>Cancel</Button>
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius }}>
        <thead>
          <tr>
            {['Name', 'Slug', 'Plan', 'Status', 'Users', 'Credit Balance', 'Created', ''].map(h => (
              <th key={h} style={thStyle}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {orgs.map(org => {
            const plan = plans.find(p => p.id === org.plan_id)
            const cred = credits.find(c => c.org_id === org.id)
            const userCount = profiles.filter(p => p.org_id === org.id).length
            const isEditing = editingId === org.id

            return isEditing ? (
              <tr key={org.id} style={{ background: T.primaryLight }}>
                <td style={cellStyle}><input style={smallInput} value={editData.name} onChange={e => setEditData({ ...editData, name: e.target.value })} /></td>
                <td style={cellStyle}>{org.slug}</td>
                <td style={cellStyle}>
                  <select style={smallInput} value={editData.plan_id || ''} onChange={e => setEditData({ ...editData, plan_id: e.target.value })}>
                    <option value="">--</option>
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </td>
                <td style={cellStyle}>
                  <select style={smallInput} value={editData.status} onChange={e => setEditData({ ...editData, status: e.target.value })}>
                    {['active', 'trial', 'suspended', 'cancelled'].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
                <td style={cellStyle}><input type="number" style={{ ...smallInput, width: 60 }} value={editData.max_users} onChange={e => setEditData({ ...editData, max_users: Number(e.target.value) })} /></td>
                <td style={cellStyle}>{cred?.balance ?? 0}</td>
                <td style={cellStyle}>
                  <input type="date" style={smallInput} value={editData.trial_ends_at?.split('T')[0] || ''} onChange={e => setEditData({ ...editData, trial_ends_at: e.target.value })} placeholder="Trial ends" />
                </td>
                <td style={cellStyle}>
                  <Button primary onClick={saveEdit} style={{ padding: '4px 10px', fontSize: 11 }}>Save</Button>
                  <Button onClick={() => setEditingId(null)} style={{ padding: '4px 10px', fontSize: 11, marginLeft: 4 }}>Cancel</Button>
                </td>
              </tr>
            ) : (
              <tr key={org.id} onClick={() => startEdit(org)} style={{ cursor: 'pointer' }}>
                <td style={cellStyle}><span style={{ fontWeight: 600 }}>{org.name}</span></td>
                <td style={{ ...cellStyle, color: T.textMuted, fontFamily: T.mono, fontSize: 11 }}>{org.slug}</td>
                <td style={cellStyle}>{plan?.name || '--'}</td>
                <td style={cellStyle}><StatusBadge status={org.status} /></td>
                <td style={cellStyle}>{userCount}</td>
                <td style={cellStyle}>{cred?.balance ?? 0}</td>
                <td style={{ ...cellStyle, color: T.textMuted, fontSize: 11 }}>{formatDate(org.created_at?.split('T')[0])}</td>
                <td style={cellStyle}>
                  <button onClick={e => { e.stopPropagation(); deleteOrg(org.id) }} style={{ background: 'none', border: 'none', color: T.error, cursor: 'pointer', fontSize: 12 }}>Delete</button>
                </td>
              </tr>
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
  const [invite, setInvite] = useState({ email: '', org_id: '', role: 'rep' })

  useEffect(() => { loadUsers() }, [])

  async function loadUsers() {
    setLoading(true)
    const [usersRes, orgsRes] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('organizations').select('id, name'),
    ])
    setUsers(usersRes.data || [])
    setOrgs(orgsRes.data || [])
    setLoading(false)
  }

  async function saveEdit() {
    await supabase.from('profiles').update({ role: editData.role, org_id: editData.org_id || null }).eq('id', editingId)
    setEditingId(null)
    loadUsers()
  }

  async function sendInvite() {
    const token = crypto.randomUUID()
    const expires = new Date(Date.now() + 7 * 86400000).toISOString()
    await supabase.from('invitations').insert({
      email: invite.email, org_id: invite.org_id, role: invite.role,
      token, status: 'pending', expires_at: expires,
    })
    setShowInvite(false)
    setInvite({ email: '', org_id: '', role: 'rep' })
    alert(`Invitation created. Share this link:\n${window.location.origin}/invite/${token}`)
  }

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <Button primary onClick={() => setShowInvite(!showInvite)}>Invite User</Button>
      </div>

      {showInvite && (
        <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 16, marginBottom: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div><label style={labelStyle}>Email</label><input style={smallInput} value={invite.email} onChange={e => setInvite({ ...invite, email: e.target.value })} /></div>
            <div>
              <label style={labelStyle}>Organization</label>
              <select style={smallInput} value={invite.org_id} onChange={e => setInvite({ ...invite, org_id: e.target.value })}>
                <option value="">-- Select --</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Role</label>
              <select style={smallInput} value={invite.role} onChange={e => setInvite({ ...invite, role: e.target.value })}>
                {['rep', 'manager', 'admin', 'system_admin'].map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <Button primary onClick={sendInvite} disabled={!invite.email || !invite.org_id}>Send Invite</Button>
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
