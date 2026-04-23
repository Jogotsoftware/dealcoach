import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useOrg } from '../../contexts/OrgContext'
import { theme as T } from '../../lib/theme'
import { callSendInvitation } from '../../lib/webhooks'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'

export default function TeamManagement() {
  const { user, org, plan, isAdmin, isSystemAdmin } = useOrg()
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('rep')
  const [copiedLink, setCopiedLink] = useState(null)
  const [toast, setToast] = useState(null)
  const [sendingEmail, setSendingEmail] = useState(null)

  useEffect(() => { loadTeam() }, [])

  async function loadTeam() {
    setLoading(true)
    const [membersRes, invitesRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('org_id', org.id).order('created_at'),
      supabase.from('invitations').select('*').eq('org_id', org.id).order('created_at', { ascending: false }),
    ])
    setMembers(membersRes.data || [])
    setInvitations(invitesRes.data || [])
    setLoading(false)
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

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: '1px solid ' + T.border, background: T.surface, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>{isAdmin ? 'Team Management' : 'Teammates'}</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: T.textMuted }}>{members.length}{plan?.max_users ? ` / ${plan.max_users}` : ''} members</span>
          {isAdmin && <Button primary onClick={() => setShowInvite(true)}>Invite Member</Button>}
        </div>
      </div>
      {toast && (
        <div style={{ padding: '10px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 13, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}
      <div style={{ padding: '16px 24px' }}>
        {isAdmin && showInvite && (
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
                    {isSystemAdmin && m.id !== user.id ? (
                      <select style={{ ...inputStyle, padding: '3px 8px', fontSize: 11, width: 'auto', cursor: 'pointer' }} value={m.role || 'rep'} onChange={e => changeRole(m.id, e.target.value)}>
                        <option value="rep">Rep</option><option value="admin">Admin</option><option value="system_admin">System Admin</option>
                      </select>
                    ) : (
                      <Badge color={roleColors[m.role] || T.primary}>{m.role || 'rep'}</Badge>
                    )}
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

        {isAdmin && pendingInvites.length > 0 && (
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
