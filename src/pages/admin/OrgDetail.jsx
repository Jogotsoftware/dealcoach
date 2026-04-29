import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { theme as T, formatDate, formatCurrency } from '../../lib/theme'
import { Card, Badge, Button, Spinner, TabBar, inputStyle, labelStyle } from '../../components/Shared'
import { getOrgModules, setOrgModuleAccess, grantOrgCredits, setOrgPlan, setUserRole } from '../../lib/platformAdmin'
import { callSendInvitation } from '../../lib/webhooks'

const statusColors = { active: T.success, trial: T.warning, paused: T.textMuted, suspended: T.error }
const sourceLabels = { plan: 'From plan', override: 'Override', none: 'Unavailable' }
const sourceColors = { plan: T.textMuted, override: T.primary, none: T.textMuted }
const txTypeColors = { grant: T.success, usage: T.error, adjustment: T.warning, monthly_grant: T.primary }

function timeAgo(d) { if (!d) return '--'; const diff = Date.now() - new Date(d).getTime(); const m = Math.floor(diff / 60000); if (m < 60) return `${m}m ago`; const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago` }

export default function OrgDetail() {
  const { orgId } = useParams()
  const { profile } = useAuth()
  const nav = useNavigate()
  const [tab, setTab] = useState('overview')
  const [org, setOrg] = useState(null)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState(null)

  // Tab data
  const [modules, setModules] = useState([])
  const [users, setUsers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [credits, setCredits] = useState(null)
  const [ledger, setLedger] = useState([])
  const [plans, setPlans] = useState([])
  const [orgCounts, setOrgCounts] = useState({ deals: 0, conversations: 0, tasks: 0 })

  // Forms
  const [editOrg, setEditOrg] = useState({})
  const [grantAmount, setGrantAmount] = useState('')
  const [grantDesc, setGrantDesc] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteForm, setInviteForm] = useState({ email: '', role: 'rep', message: '' })
  const [changePlanId, setChangePlanId] = useState('')

  useEffect(() => { loadOrg() }, [orgId])

  function showToastMsg(msg, isError) { setToast({ msg, isError }); setTimeout(() => setToast(null), 3000) }

  async function loadOrg() {
    setLoading(true)
    const [orgRes, plansRes] = await Promise.all([
      supabase.from('organizations').select('*, plans(*)').eq('id', orgId).single(),
      supabase.from('plans').select('*').eq('active', true).order('sort_order'),
    ])
    if (!orgRes.data) { nav('/admin'); return }
    setOrg(orgRes.data)
    setEditOrg({ name: orgRes.data.name, domain: orgRes.data.domain || '', primary_color: orgRes.data.primary_color || '#5DADE2', max_users: orgRes.data.max_users || '', max_deals: orgRes.data.max_deals || '', status: orgRes.data.status, trial_ends_at: orgRes.data.trial_ends_at?.split('T')[0] || '' })
    setPlans(plansRes.data || [])
    setChangePlanId(orgRes.data.plan_id || '')
    loadTabData()
    setLoading(false)
  }

  async function loadTabData() {
    const [modulesData, usersRes, invRes, credRes, ledgerRes, countsRes] = await Promise.all([
      getOrgModules(orgId).catch(() => []),
      supabase.from('profiles').select('*').eq('org_id', orgId).order('created_at'),
      supabase.from('invitations').select('*, profiles!invitations_invited_by_fkey(full_name)').eq('org_id', orgId).order('created_at', { ascending: false }),
      supabase.from('org_credits').select('*').eq('org_id', orgId).single(),
      supabase.from('credit_ledger').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100),
      Promise.all([
        supabase.from('deals').select('id', { count: 'exact', head: true }).eq('org_id', orgId),
        supabase.from('conversations').select('id', { count: 'exact', head: true }).eq('deal_id', null), // placeholder
        supabase.from('tasks').select('id', { count: 'exact', head: true }),
      ]),
    ])
    setModules(modulesData || [])
    setUsers(usersRes.data || [])
    setInvitations(invRes.data || [])
    setCredits(credRes.data || null)
    setLedger(ledgerRes.data || [])
    setOrgCounts({ deals: countsRes[0].count || 0, conversations: 0, tasks: 0 })
  }

  async function saveOrg() {
    const updates = { name: editOrg.name, domain: editOrg.domain || null, primary_color: editOrg.primary_color, max_users: editOrg.max_users ? Number(editOrg.max_users) : null, max_deals: editOrg.max_deals ? Number(editOrg.max_deals) : null, status: editOrg.status }
    if (editOrg.status === 'trial' && editOrg.trial_ends_at) updates.trial_ends_at = editOrg.trial_ends_at
    await supabase.from('organizations').update(updates).eq('id', orgId)
    showToastMsg('Saved')
    loadOrg()
  }

  async function toggleModule(mod) {
    const newEnabled = !mod.enabled
    await setOrgModuleAccess(orgId, mod.module_id || mod.id, newEnabled, newEnabled ? 'Enabled by platform admin' : 'Disabled by platform admin')
    const updated = await getOrgModules(orgId)
    setModules(updated || [])
  }

  async function resetModuleOverrides() {
    if (!window.confirm('Reset all module overrides to plan defaults?')) return
    await supabase.from('org_module_access').delete().eq('org_id', orgId)
    const updated = await getOrgModules(orgId)
    setModules(updated || [])
    showToastMsg('Reset to plan defaults')
  }

  async function handleGrant() {
    const amt = parseInt(grantAmount)
    if (!amt) return
    await grantOrgCredits(orgId, amt, grantDesc || (amt > 0 ? 'Manual grant by platform admin' : 'Manual deduction by platform admin'))
    setGrantAmount(''); setGrantDesc('')
    showToastMsg(`${amt > 0 ? 'Granted' : 'Deducted'} ${Math.abs(amt)} credits`)
    loadTabData()
  }

  async function handleChangePlan() {
    if (!changePlanId || changePlanId === org.plan_id) return
    if (!window.confirm('Change this org\'s plan? Module access will update based on the new plan.')) return
    await setOrgPlan(orgId, changePlanId)
    showToastMsg('Plan changed')
    loadOrg()
  }

  async function handleChangeRole(userId, newRole) {
    await setUserRole(userId, newRole)
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    showToastMsg('Role updated')
  }

  async function removeFromOrg(userId) {
    if (!window.confirm('Remove this user from the org?')) return
    await supabase.from('profiles').update({ org_id: null, role: 'rep' }).eq('id', userId)
    setUsers(prev => prev.filter(u => u.id !== userId))
    showToastMsg('User removed')
  }

  async function sendOrgInvite() {
    if (!inviteForm.email.trim()) return
    const { data: inv, error } = await supabase.from('invitations').insert({
      org_id: orgId, email: inviteForm.email.trim().toLowerCase(), role: inviteForm.role,
      invited_by: profile.id, invitation_type: 'teammate', personal_message: inviteForm.message || null,
    }).select().single()
    if (error) { showToastMsg(error.message, true); return }
    const res = await callSendInvitation(inv.id)
    if (res.error) showToastMsg(`Created but email failed: ${res.error}`, true)
    else showToastMsg(`Invitation sent to ${inviteForm.email}`)
    setShowInviteModal(false); setInviteForm({ email: '', role: 'rep', message: '' })
    loadTabData()
  }

  async function pauseOrg() {
    const newStatus = org.status === 'paused' ? 'active' : 'paused'
    if (!window.confirm(`${newStatus === 'paused' ? 'Pause' : 'Unpause'} this organization?`)) return
    await supabase.from('organizations').update({ status: newStatus }).eq('id', orgId)
    showToastMsg(`Org ${newStatus}`)
    loadOrg()
  }

  async function transferOwnership(newOwnerId) {
    if (!window.confirm('Transfer ownership to this user?')) return
    await supabase.from('organizations').update({ owner_id: newOwnerId }).eq('id', orgId)
    showToastMsg('Ownership transferred')
    loadOrg()
  }

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'modules', label: `Modules (${modules.filter(m => m.enabled).length}/${modules.length})` },
    { key: 'users', label: `Users (${users.length})` },
    { key: 'credits', label: 'Billing (beta)' },
    { key: 'plan', label: 'Plan & Billing' },
    { key: 'danger', label: 'Danger Zone' },
  ]

  if (loading) return <Spinner />
  if (!org) return null

  const owner = users.find(u => u.id === org.owner_id)

  return (
    <div>
      {/* Header */}
      <div style={{ padding: '16px 24px', paddingRight: 72, borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <button onClick={() => nav('/admin')} style={{ background: T.surfaceAlt, border: `1px solid ${T.border}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', fontSize: 12, color: T.primary, fontWeight: 600, fontFamily: T.font }}>&larr; Back</button>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: org.primary_color || T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 18, color: '#fff' }}>
            {(org.name || 'O')[0].toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text }}>{org.name}</div>
            <div style={{ fontSize: 12, color: T.textMuted }}>{org.slug}{org.domain ? ` / ${org.domain}` : ''}</div>
          </div>
          <Badge color={T.primary}>{org.plans?.name || 'No plan'}</Badge>
          <Badge color={statusColors[org.status] || T.textMuted}>{org.status}</Badge>
          <button onClick={() => { navigator.clipboard.writeText(org.id); showToastMsg('Org ID copied') }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '3px 8px', fontSize: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>Copy ID</button>
        </div>
      </div>

      {toast && <div style={{ padding: '8px 24px', background: toast.isError ? T.errorLight : T.successLight, fontSize: 12, fontWeight: 600, color: toast.isError ? T.error : T.success }}>{toast.msg}</div>}

      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}` }}>
        <TabBar tabs={tabs} active={tab} onChange={setTab} />
      </div>

      <div style={{ padding: '16px 24px' }}>
        {/* ===== OVERVIEW ===== */}
        {tab === 'overview' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
              {[
                { label: 'Users', value: users.length },
                { label: 'Deals', value: orgCounts.deals },
                { label: 'Credits', value: credits?.balance ?? 0 },
                { label: 'FY End', value: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(org.fiscal_year_end_month || 12) - 1]} ${org.fiscal_year_end_day || 31}` },
              ].map(s => (
                <div key={s.label} style={{ padding: 14, background: T.surfaceAlt, borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: T.text }}>{s.value}</div>
                </div>
              ))}
            </div>
            {owner && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Owner: <strong>{owner.full_name}</strong> ({owner.email})</div>}
            <Card title="Edit Organization">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                <div><label style={labelStyle}>Name</label><input style={inputStyle} value={editOrg.name || ''} onChange={e => setEditOrg(p => ({ ...p, name: e.target.value }))} /></div>
                <div><label style={labelStyle}>Domain</label><input style={inputStyle} value={editOrg.domain || ''} onChange={e => setEditOrg(p => ({ ...p, domain: e.target.value }))} /></div>
                <div><label style={labelStyle}>Primary Color</label><div style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="color" value={editOrg.primary_color || '#5DADE2'} onChange={e => setEditOrg(p => ({ ...p, primary_color: e.target.value }))} style={{ width: 36, height: 28, border: 'none', cursor: 'pointer' }} /><span style={{ fontSize: 11, color: T.textMuted, fontFamily: T.mono }}>{editOrg.primary_color}</span></div></div>
                <div><label style={labelStyle}>Status</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={editOrg.status} onChange={e => setEditOrg(p => ({ ...p, status: e.target.value }))}><option value="active">Active</option><option value="trial">Trial</option><option value="paused">Paused</option></select></div>
                <div><label style={labelStyle}>Max Users</label><input type="number" style={inputStyle} value={editOrg.max_users || ''} onChange={e => setEditOrg(p => ({ ...p, max_users: e.target.value }))} placeholder="Unlimited" /></div>
                <div><label style={labelStyle}>Max Deals</label><input type="number" style={inputStyle} value={editOrg.max_deals || ''} onChange={e => setEditOrg(p => ({ ...p, max_deals: e.target.value }))} placeholder="Unlimited" /></div>
                {editOrg.status === 'trial' && <div><label style={labelStyle}>Trial Ends</label><input type="date" style={inputStyle} value={editOrg.trial_ends_at || ''} onChange={e => setEditOrg(p => ({ ...p, trial_ends_at: e.target.value }))} /></div>}
              </div>
              <Button primary onClick={saveOrg}>Save Changes</Button>
            </Card>
          </>
        )}

        {/* ===== MODULES ===== */}
        {tab === 'modules' && (
          <>
            {modules.map(m => (
              <div key={m.module_key || m.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 16px', background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>{m.module_name}</div>
                  <div style={{ fontSize: 11, color: T.textMuted }}>{m.module_key}{m.is_premium && <Badge color={T.warning} style={{ marginLeft: 6 }}>Premium</Badge>}</div>
                  {m.description && <div style={{ fontSize: 12, color: T.textSecondary, marginTop: 2 }}>{m.description}</div>}
                  {m.note && <div style={{ fontSize: 11, color: T.primary, marginTop: 2 }}>{m.note}</div>}
                  {m.expires_at && <div style={{ fontSize: 10, color: T.warning, marginTop: 2 }}>Expires: {formatDate(m.expires_at)}</div>}
                </div>
                <Badge color={sourceColors[m.source] || T.textMuted}>{sourceLabels[m.source] || m.source}</Badge>
                <div onClick={() => toggleModule(m)} style={{ width: 44, height: 24, borderRadius: 12, cursor: 'pointer', background: m.enabled ? T.success : T.borderLight, position: 'relative', transition: 'background 0.2s' }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: m.enabled ? 22 : 2, boxShadow: T.shadow, transition: 'left 0.2s' }} />
                </div>
              </div>
            ))}
            <Button onClick={resetModuleOverrides} style={{ marginTop: 8, color: T.error, fontSize: 12 }}>Reset to Plan Defaults</Button>
          </>
        )}

        {/* ===== USERS ===== */}
        {tab === 'users' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button primary onClick={() => setShowInviteModal(true)}>Invite User</Button>
            </div>
            <Card title={`Members (${users.length})`}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Name', 'Email', 'Role', 'Joined', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: '8px', fontWeight: 600 }}>{u.full_name}</td>
                      <td style={{ padding: '8px', color: T.textMuted }}>{u.email}</td>
                      <td style={{ padding: '8px' }}>
                        <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, width: 'auto', cursor: 'pointer' }} value={u.role || 'rep'} onChange={e => handleChangeRole(u.id, e.target.value)}>
                          <option value="rep">Rep</option><option value="admin">Admin</option><option value="system_admin">System Admin</option>
                        </select>
                      </td>
                      <td style={{ padding: '8px', color: T.textMuted }}>{u.created_at?.split('T')[0]}</td>
                      <td style={{ padding: '8px' }}>
                        <button onClick={() => removeFromOrg(u.id)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font }} onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {invitations.filter(i => i.status === 'pending').length > 0 && (
              <Card title="Pending Invitations">
                {invitations.filter(i => i.status === 'pending').map(inv => (
                  <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: `1px solid ${T.borderLight}`, fontSize: 12 }}>
                    <span style={{ flex: 1, fontWeight: 600 }}>{inv.email}</span>
                    <Badge color={T.primary}>{inv.role}</Badge>
                    <Badge color={inv.email_status === 'sent' ? T.success : inv.email_status === 'failed' ? T.error : T.textMuted}>{inv.email_status || 'unsent'}</Badge>
                    <span style={{ color: T.textMuted, fontSize: 10 }}>{inv.profiles?.full_name ? `by ${inv.profiles.full_name}` : ''}</span>
                    <button onClick={async () => { await callSendInvitation(inv.id); showToastMsg('Resent'); loadTabData() }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: T.primary, fontFamily: T.font }}>Resend</button>
                  </div>
                ))}
              </Card>
            )}
            {showInviteModal && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 9100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)' }} onClick={() => setShowInviteModal(false)} />
                <div style={{ position: 'relative', zIndex: 1, background: T.surface, borderRadius: 12, padding: 24, width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
                  <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700 }}>Invite to {org.name}</h3>
                  <div style={{ marginBottom: 10 }}><label style={labelStyle}>Email *</label><input style={inputStyle} value={inviteForm.email} onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} placeholder="user@company.com" /></div>
                  <div style={{ marginBottom: 10 }}><label style={labelStyle}>Role</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={inviteForm.role} onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}><option value="rep">Rep</option><option value="admin">Admin</option></select></div>
                  <div style={{ marginBottom: 16 }}><label style={labelStyle}>Message (optional)</label><textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={inviteForm.message} onChange={e => setInviteForm(p => ({ ...p, message: e.target.value }))} /></div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <Button onClick={() => setShowInviteModal(false)}>Cancel</Button>
                    <Button primary onClick={sendOrgInvite} disabled={!inviteForm.email.trim()}>Send Invite</Button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ===== CREDITS ===== */}
        {tab === 'credits' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div style={{ padding: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Balance</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: T.primary }}>{credits?.balance ?? 0}</div>
              </div>
              <div style={{ padding: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Total Granted</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: T.success }}>{credits?.total_granted ?? 0}</div>
              </div>
              <div style={{ padding: 20, background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8, textAlign: 'center' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Total Used</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: T.error }}>{credits?.total_used ?? 0}</div>
              </div>
            </div>
            {credits?.last_grant_at && <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 12 }}>Last grant: {timeAgo(credits.last_grant_at)}</div>}
            {org.plans?.credits_monthly && <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 12 }}>Plan allots {org.plans.credits_monthly} credits/month</div>}

            <Card title="Grant / Deduct Credits">
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                {[100, 500, 1000, 5000].map(n => <button key={n} onClick={() => setGrantAmount(String(n))} style={{ padding: '4px 10px', fontSize: 11, border: `1px solid ${T.border}`, borderRadius: 4, cursor: 'pointer', background: grantAmount === String(n) ? T.primaryLight : T.surfaceAlt, color: grantAmount === String(n) ? T.primary : T.textMuted, fontFamily: T.font }}>+{n}</button>)}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}><label style={labelStyle}>Amount (negative to deduct)</label><input type="number" style={inputStyle} value={grantAmount} onChange={e => setGrantAmount(e.target.value)} placeholder="500" /></div>
                <div style={{ flex: 2 }}><label style={labelStyle}>Description</label><input style={inputStyle} value={grantDesc} onChange={e => setGrantDesc(e.target.value)} placeholder="Reason for grant..." /></div>
                <Button primary onClick={handleGrant} disabled={!grantAmount}>{Number(grantAmount) >= 0 ? 'Grant' : 'Deduct'}</Button>
              </div>
            </Card>

            <Card title="Credit Ledger">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Date', 'Type', 'Amount', 'Balance After', 'Description'].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {ledger.map(l => (
                    <tr key={l.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                      <td style={{ padding: '6px 8px', color: T.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(l.created_at)}</td>
                      <td style={{ padding: '6px 8px' }}><Badge color={txTypeColors[l.transaction_type] || T.textMuted}>{l.transaction_type}</Badge></td>
                      <td style={{ padding: '6px 8px', fontWeight: 700, color: l.amount >= 0 ? T.success : T.error }}>{l.amount >= 0 ? '+' : ''}{l.amount}</td>
                      <td style={{ padding: '6px 8px' }}>{l.balance_after}</td>
                      <td style={{ padding: '6px 8px', color: T.textMuted }}>{l.description || '--'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {ledger.length === 0 && <div style={{ padding: 16, textAlign: 'center', color: T.textMuted }}>No ledger entries</div>}
            </Card>
          </>
        )}

        {/* ===== PLAN & BILLING ===== */}
        {tab === 'plan' && (
          <>
            <Card title="Current Plan">
              <div style={{ fontSize: 22, fontWeight: 800, color: T.primary, marginBottom: 8 }}>{org.plans?.name || 'No plan'}</div>
              {org.plans && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12, fontSize: 12 }}>
                  <div><span style={{ color: T.textMuted }}>Price:</span> {org.plans.monthly_price ? `$${org.plans.monthly_price}/mo` : 'Free'}</div>
                  <div><span style={{ color: T.textMuted }}>Credits/mo:</span> {org.plans.credits_monthly || 0}</div>
                  <div><span style={{ color: T.textMuted }}>Max users:</span> {org.plans.max_users || 'Unlimited'}</div>
                </div>
              )}
              {org.plans?.modules?.length > 0 && (
                <div><span style={{ fontSize: 10, fontWeight: 700, color: T.textMuted, textTransform: 'uppercase' }}>Included modules:</span><div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>{org.plans.modules.map(m => <Badge key={m} color={T.primary}>{m.replace(/_/g, ' ')}</Badge>)}</div></div>
              )}
            </Card>
            <Card title="Change Plan">
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <div style={{ flex: 1 }}>
                  <label style={labelStyle}>Select Plan</label>
                  <select style={{ ...inputStyle, cursor: 'pointer' }} value={changePlanId} onChange={e => setChangePlanId(e.target.value)}>
                    <option value="">-- Select --</option>
                    {plans.map(p => <option key={p.id} value={p.id}>{p.name} ({p.credits_monthly} credits/mo, {p.modules?.length || 0} modules)</option>)}
                  </select>
                </div>
                <Button primary onClick={handleChangePlan} disabled={!changePlanId || changePlanId === org.plan_id}>Change Plan</Button>
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 8 }}>Module overrides persist after plan change. Use the Modules tab to reset.</div>
            </Card>
            <Card title="Billing">
              <div style={{ color: T.textMuted, fontSize: 13, padding: 12 }}>Stripe integration coming in Phase 2. Manage billing manually for now.</div>
            </Card>
          </>
        )}

        {/* ===== DANGER ZONE ===== */}
        {tab === 'danger' && (
          <>
            <Card style={{ border: `1px solid ${T.error}30` }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: T.error, marginBottom: 12 }}>Danger Zone</div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200, padding: 16, background: T.surfaceAlt, borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>{org.status === 'paused' ? 'Unpause' : 'Pause'} Organization</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Members can still sign in but won't be able to use most features.</div>
                  <Button onClick={pauseOrg} style={{ color: org.status === 'paused' ? T.success : T.error, fontSize: 12 }}>{org.status === 'paused' ? 'Unpause Org' : 'Pause Org'}</Button>
                </div>
                <div style={{ flex: 1, minWidth: 200, padding: 16, background: T.surfaceAlt, borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Transfer Ownership</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Change the primary owner of this organization.</div>
                  <select style={{ ...inputStyle, fontSize: 11, marginBottom: 6, cursor: 'pointer' }} onChange={e => { if (e.target.value) transferOwnership(e.target.value) }}>
                    <option value="">Select new owner...</option>
                    {users.filter(u => u.id !== org.owner_id).map(u => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
                  </select>
                </div>
                <div style={{ flex: 1, minWidth: 200, padding: 16, background: T.surfaceAlt, borderRadius: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>Delete Organization</div>
                  <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>Permanently remove this org and all its data. This cannot be undone.</div>
                  <Button style={{ color: T.error, fontSize: 12 }} onClick={() => alert('Contact support for org deletion during beta.')}>Delete (Contact Support)</Button>
                </div>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
