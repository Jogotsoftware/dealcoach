import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { callSendInvitation } from '../../lib/webhooks'
import { Card, Badge, Button, Spinner, TabBar, inputStyle, labelStyle } from '../../components/Shared'

const WORKING_TEAM_TYPES = [
  { key: 'internal_sc', label: 'Internal SC' },
  { key: 'external_sc', label: 'External SC' },
  { key: 'technical_sc', label: 'Technical SC' },
  { key: 'partner', label: 'Partner' },
  { key: 'manager', label: 'Manager' },
  { key: 'other', label: 'Other' },
]

export default function TeamManagement() {
  const { user, org, plan, isAdmin, isSystemAdmin } = useOrg()
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [workingTeam, setWorkingTeam] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('rep')
  const [copiedLink, setCopiedLink] = useState(null)
  const [toast, setToast] = useState(null)
  const [sendingEmail, setSendingEmail] = useState(null)
  const [tab, setTab] = useState(isAdmin ? 'users' : 'team')
  const [newMember, setNewMember] = useState({ name: '', email: '', member_type: 'internal_sc', title: '' })
  const [showAddMember, setShowAddMember] = useState(false)

  useEffect(() => { loadTeam() }, [])

  async function loadTeam() {
    setLoading(true)
    const [membersRes, invitesRes, workingTeamRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('org_id', org.id).order('created_at'),
      supabase.from('invitations').select('*').eq('org_id', org.id).order('created_at', { ascending: false }),
      supabase.from('user_team_members').select('*').eq('user_id', user.id).order('name'),
    ])
    setMembers(membersRes.data || [])
    setInvitations(invitesRes.data || [])
    setWorkingTeam(workingTeamRes.data || [])
    setLoading(false)
  }

  async function addWorkingMember() {
    if (!newMember.name.trim()) return
    const { data, error } = await supabase.from('user_team_members').insert({
      user_id: user.id, org_id: org.id,
      name: newMember.name.trim(), email: newMember.email.trim() || null,
      member_type: newMember.member_type, title: newMember.title.trim() || null,
    }).select().single()
    if (error) { setToast({ msg: error.message, isError: true }); setTimeout(() => setToast(null), 3000); return }
    setWorkingTeam(prev => [...prev, data].sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    setShowAddMember(false)
    setNewMember({ name: '', email: '', member_type: 'internal_sc', title: '' })
  }

  async function updateWorkingMember(id, field, value) {
    await supabase.from('user_team_members').update({ [field]: value }).eq('id', id)
    setWorkingTeam(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m))
  }

  async function deleteWorkingMember(id) {
    if (!window.confirm('Remove this teammate from your working team?')) return
    await supabase.from('user_team_members').delete().eq('id', id)
    setWorkingTeam(prev => prev.filter(m => m.id !== id))
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) return
    if (plan?.max_users && members.length >= plan.max_users) {
      alert(`Your ${plan.name} plan allows ${plan.max_users} users. Upgrade to add more.`)
      return
    }
    const { data, error } = await supabase.from('invitations').insert({
      org_id: org.id, email: inviteEmail, role: inviteRole, invited_by: user.id, invitation_type: 'teammate',
    }).select().single()
    if (!error && data) {
      setInvitations(prev => [data, ...prev])
      setShowInvite(false)
      setInviteEmail('')
      // Send email via edge function
      const res = await callSendInvitation(data.id)
      if (res.error) {
        setToast({ msg: `Invitation created but email failed: ${res.error}`, isError: true })
      } else {
        setToast({ msg: `Invitation email sent to ${data.email}` })
      }
      setTimeout(() => setToast(null), 4000)
      loadTeam()
    }
  }

  async function changeRole(memberId, newRole) {
    await supabase.from('profiles').update({ role: newRole }).eq('id', memberId)
    setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
  }

  async function removeMember(memberId) {
    if (!window.confirm('Remove this member from the organization? They will lose access.')) return
    await supabase.from('profiles').update({ org_id: null, role: 'rep' }).eq('id', memberId)
    setMembers(prev => prev.filter(m => m.id !== memberId))
  }

  async function revokeInvite(invId) {
    await supabase.from('invitations').update({ status: 'revoked' }).eq('id', invId)
    setInvitations(prev => prev.map(i => i.id === invId ? { ...i, status: 'revoked' } : i))
  }

  function copyInviteLink(token, invId) {
    navigator.clipboard.writeText(`${window.location.origin}/invite/${token}`)
    setCopiedLink(invId)
    setTimeout(() => setCopiedLink(null), 3000)
  }

  if (loading) return <Spinner />

  const pendingInvites = invitations.filter(i => i.status === 'pending')
  const roleColors = { system_admin: T.error, admin: T.warning, rep: T.primary }

  const tabs = isAdmin
    ? [{ key: 'users', label: `Users (${members.length})` }, { key: 'team', label: 'My Team' }]
    : [{ key: 'team', label: 'My Team' }]

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: isAdmin ? 10 : 0 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{isAdmin ? 'Team Management' : 'My Team'}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: T.textMuted }}>{members.length}{plan?.max_users ? ` / ${plan.max_users}` : ''} members</span>
            {isAdmin && tab === 'users' && <Button primary onClick={() => setShowInvite(true)}>Invite Member</Button>}
          </div>
        </div>
        {isAdmin && <TabBar tabs={tabs} active={tab} onChange={setTab} />}
      </div>
      {toast && (
        <div style={{ padding: '10px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 13, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}
      <div style={{ padding: '16px 24px' }}>
        {tab === 'team' && (
          <>
            <Card title={`My Working Team (${workingTeam.length})`} action={<Button primary onClick={() => setShowAddMember(true)} style={{ padding: '4px 12px', fontSize: 11 }}>+ Add Teammate</Button>}>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 10 }}>Solutions Consultants, partners, managers, collaborators you work with. They don't need a platform account. They can be assigned to deals and are excluded from AI contact extraction.</div>
              {showAddMember && (
                <div style={{ padding: 12, background: T.surfaceAlt, borderRadius: 6, border: `1px solid ${T.borderLight}`, marginBottom: 10, display: 'grid', gridTemplateColumns: '2fr 2fr 1.5fr 1.5fr auto auto', gap: 8, alignItems: 'end' }}>
                  <div><label style={labelStyle}>Name *</label><input style={inputStyle} value={newMember.name} onChange={e => setNewMember(p => ({ ...p, name: e.target.value }))} autoFocus onKeyDown={e => e.key === 'Enter' && addWorkingMember()} /></div>
                  <div><label style={labelStyle}>Email</label><input style={inputStyle} value={newMember.email} onChange={e => setNewMember(p => ({ ...p, email: e.target.value }))} placeholder="optional" /></div>
                  <div><label style={labelStyle}>Role</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={newMember.member_type} onChange={e => setNewMember(p => ({ ...p, member_type: e.target.value }))}>{WORKING_TEAM_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
                  <div><label style={labelStyle}>Title</label><input style={inputStyle} value={newMember.title} onChange={e => setNewMember(p => ({ ...p, title: e.target.value }))} placeholder="optional" /></div>
                  <Button primary onClick={addWorkingMember} style={{ padding: '6px 14px' }}>Add</Button>
                  <Button onClick={() => { setShowAddMember(false); setNewMember({ name: '', email: '', member_type: 'internal_sc', title: '' }) }}>Cancel</Button>
                </div>
              )}
              {workingTeam.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: T.textMuted, fontSize: 13, fontStyle: 'italic' }}>No teammates yet. Add Solutions Consultants, partners, or managers you work with.</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                      {['Name', 'Email', 'Role', 'Title', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase' }}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {workingTeam.map(m => (
                      <tr key={m.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                        <td style={{ padding: '6px 8px' }}><input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} defaultValue={m.name || ''} onBlur={e => updateWorkingMember(m.id, 'name', e.target.value)} /></td>
                        <td style={{ padding: '6px 8px' }}><input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} defaultValue={m.email || ''} onBlur={e => updateWorkingMember(m.id, 'email', e.target.value)} placeholder="email" /></td>
                        <td style={{ padding: '6px 8px' }}><select style={{ ...inputStyle, padding: '4px 8px', fontSize: 12, cursor: 'pointer' }} value={m.member_type || 'internal_sc'} onChange={e => updateWorkingMember(m.id, 'member_type', e.target.value)}>{WORKING_TEAM_TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}</select></td>
                        <td style={{ padding: '6px 8px' }}><input style={{ ...inputStyle, padding: '4px 8px', fontSize: 12 }} defaultValue={m.title || ''} onBlur={e => updateWorkingMember(m.id, 'title', e.target.value)} placeholder="title" /></td>
                        <td style={{ padding: '6px 8px', textAlign: 'right' }}><button onClick={() => deleteWorkingMember(m.id)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font }} onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>Remove</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
            <Card title={`Org Roster (${members.length})`}>
              <div style={{ fontSize: 12, color: T.textMuted, marginBottom: 8 }}>Other users in your organization.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10 }}>
                {members.map(m => (
                  <div key={m.id} style={{ padding: 12, background: T.surfaceAlt, borderRadius: 8, border: `1px solid ${T.borderLight}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: T.primary + '20', color: T.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, flexShrink: 0 }}>
                      {(m.full_name || m.email || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name || m.email}{m.id === user.id && <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4 }}>(you)</span>}</div>
                      <div style={{ fontSize: 11, color: T.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                      <Badge color={roleColors[m.role] || T.primary}>{m.role || 'rep'}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
        {tab === 'users' && isAdmin && showInvite && (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}><label style={labelStyle}>Email</label><input style={inputStyle} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@company.com" onKeyDown={e => e.key === 'Enter' && sendInvite()} /></div>
              <div><label style={labelStyle}>Role</label><select style={{ ...inputStyle, cursor: 'pointer' }} value={inviteRole} onChange={e => setInviteRole(e.target.value)}>
                <option value="rep">Rep</option><option value="admin">Admin</option>
              </select></div>
              <Button primary onClick={sendInvite}>Send</Button>
              <Button onClick={() => setShowInvite(false)}>Cancel</Button>
            </div>
          </Card>
        )}

        {tab === 'users' && isAdmin && (
          <Card title={`Members (${members.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + T.border }}>
                  {['Name', 'Email', 'Role', 'Joined', ''].map(h => <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, color: '#8899aa', textTransform: 'uppercase' }}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {members.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid ' + T.borderLight }}>
                    <td style={{ padding: '10px 8px', fontWeight: 600 }}>{m.full_name}</td>
                    <td style={{ padding: '10px 8px', color: T.textMuted }}>{m.email}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {(() => {
                        const isSelf = m.id === user.id
                        const targetIsSysAdmin = m.role === 'system_admin'
                        // system_admin: can edit everyone but themselves
                        // admin: can edit reps/admins but not system_admins, not themselves
                        const canEdit = !isSelf && (isSystemAdmin || (isAdmin && !targetIsSysAdmin))
                        if (canEdit) {
                          return (
                            <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, width: 'auto', cursor: 'pointer' }} value={m.role || 'rep'} onChange={e => changeRole(m.id, e.target.value)}>
                              <option value="rep">Rep</option>
                              <option value="admin">Admin</option>
                              {isSystemAdmin && <option value="system_admin">System Admin</option>}
                            </select>
                          )
                        }
                        return (
                          <span title={isSelf ? "You can't change your own role" : targetIsSysAdmin && !isSystemAdmin ? 'Only a system admin can edit another system admin' : 'You don’t have permission to change roles'}>
                            <Badge color={roleColors[m.role] || T.primary}>{m.role || 'rep'}</Badge>
                          </span>
                        )
                      })()}
                    </td>
                    <td style={{ padding: '10px 8px', fontSize: 11, color: T.textMuted }}>{m.created_at?.split('T')[0]}</td>
                    <td style={{ padding: '10px 8px' }}>
                      {m.id === user.id ? <span style={{ fontSize: 10, color: T.textMuted }}>You</span> : (
                        isAdmin && <button onClick={() => removeMember(m.id)} style={{ background: 'none', border: 'none', color: T.textMuted, fontSize: 11, cursor: 'pointer', fontFamily: T.font }} onMouseEnter={e => e.currentTarget.style.color = T.error} onMouseLeave={e => e.currentTarget.style.color = T.textMuted}>Remove</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tab === 'users' && isAdmin && pendingInvites.length > 0 && (
          <Card title={`Pending Invitations (${pendingInvites.length})`}>
            {pendingInvites.map(inv => (
              <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid ' + T.borderLight }}>
                <span style={{ flex: 1, fontSize: 13 }}>{inv.email}</span>
                <Badge color={T.primary}>{inv.role}</Badge>
                <Badge color={inv.email_status === 'sent' ? T.success : inv.email_status === 'failed' ? T.error : T.textMuted}>{inv.email_status || 'unsent'}</Badge>
                <span style={{ fontSize: 10, color: T.textMuted }}>Expires {inv.expires_at?.split('T')[0]}</span>
                <Button onClick={async () => { setSendingEmail(inv.id); const r = await callSendInvitation(inv.id); setSendingEmail(null); if (r.error) setToast({ msg: r.error, isError: true }); else setToast({ msg: 'Email resent' }); setTimeout(() => setToast(null), 3000); loadTeam() }} style={{ padding: '3px 10px', fontSize: 10 }} disabled={sendingEmail === inv.id}>
                  {sendingEmail === inv.id ? '...' : 'Resend'}
                </Button>
                <Button onClick={() => copyInviteLink(inv.token, inv.id)} style={{ padding: '3px 10px', fontSize: 10 }}>
                  {copiedLink === inv.id ? 'Copied!' : 'Copy Link'}
                </Button>
                <Button onClick={() => revokeInvite(inv.id)} style={{ padding: '3px 10px', fontSize: 10, color: T.error }}>Revoke</Button>
                <Button onClick={async () => { if (!window.confirm('Permanently delete this invitation?')) return; const { error } = await supabase.rpc('delete_invitation', { p_invitation_id: inv.id }); if (error) { setToast({ msg: error.message, isError: true }); return }; setToast({ msg: 'Deleted' }); setTimeout(() => setToast(null), 3000); loadTeam() }} style={{ padding: '3px 10px', fontSize: 10 }}>Delete</Button>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  )
}
