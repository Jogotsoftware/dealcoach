import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { callSendInvitation } from '../../lib/webhooks'
import { theme as T, formatDate } from '../../lib/theme'
import { Card, Badge, Button, Spinner, inputStyle, labelStyle } from '../../components/Shared'

const emailStatusColors = { pending: T.textMuted, sent: T.primary, delivered: T.success, bounced: T.error, failed: T.error, opened: '#27ae60', accepted: '#155724' }

function timeAgo(dateStr) {
  if (!dateStr) return '--'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Invitations() {
  const { profile } = useAuth()
  const [invitations, setInvitations] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all')

  // New invite form
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [role, setRole] = useState('admin')

  useEffect(() => { loadInvitations() }, [])

  async function loadInvitations() {
    setLoading(true)
    const { data } = await supabase.from('invitations')
      .select('*, organizations(name), profiles!invitations_invited_by_fkey(full_name)')
      .order('created_at', { ascending: false })
      .limit(200)
    setInvitations(data || [])
    setLoading(false)
  }

  function showToast(msg, isError) {
    setToast({ msg, isError })
    setTimeout(() => setToast(null), 4000)
  }

  async function sendNewInvite() {
    if (!email.trim()) return
    setSending(true)
    try {
      const { data: inv, error: insertErr } = await supabase.from('invitations').insert({
        invitation_type: 'new_instance',
        org_id: null,
        role,
        email: email.trim().toLowerCase(),
        invited_name: name.trim() || null,
        personal_message: message.trim() || null,
        invited_by: profile.id,
      }).select().single()
      if (insertErr) throw new Error(insertErr.message)

      const res = await callSendInvitation(inv.id)
      if (res.error) {
        showToast(`Invitation created but email failed: ${res.error}`, true)
      } else {
        showToast(`Invitation sent to ${email}`)
      }
      setEmail(''); setName(''); setMessage('')
      loadInvitations()
    } catch (err) {
      showToast(err.message, true)
    } finally {
      setSending(false)
    }
  }

  async function resendInvite(invId) {
    const res = await callSendInvitation(invId)
    if (res.error) showToast(`Resend failed: ${res.error}`, true)
    else showToast('Email resent')
    loadInvitations()
  }

  function copyLink(token) {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url)
    showToast('Link copied')
  }

  async function revokeInvite(invId) {
    if (!window.confirm('Revoke this invitation?')) return
    await supabase.from('invitations').update({ status: 'revoked' }).eq('id', invId)
    loadInvitations()
    showToast('Invitation revoked')
  }

  const filtered = invitations.filter(inv => {
    if (filter === 'pending') return inv.status === 'pending'
    if (filter === 'accepted') return inv.status === 'accepted'
    if (filter === 'failed') return inv.email_status === 'failed' || inv.email_status === 'bounced'
    return true
  })

  const accepted = invitations.filter(i => i.status === 'accepted' && new Date(i.accepted_at) > new Date(Date.now() - 30 * 86400000))

  if (loading) return <Spinner />

  return (
    <div>
      <div style={{ padding: '14px 24px', borderBottom: `1px solid ${T.border}`, background: T.surface }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text, margin: 0 }}>Invitation Management</h2>
      </div>

      {toast && (
        <div style={{ padding: '10px 24px', background: toast.isError ? T.errorLight : T.successLight, borderBottom: `1px solid ${toast.isError ? T.error : T.success}25`, fontSize: 13, fontWeight: 600, color: toast.isError ? T.error : T.success }}>
          {toast.msg}
        </div>
      )}

      <div style={{ padding: '16px 24px' }}>
        {/* Send new invite */}
        <Card title="Invite new beta user">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
            <div><label style={labelStyle}>Email *</label><input type="email" style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" /></div>
            <div><label style={labelStyle}>Name</label><input style={inputStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" /></div>
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={labelStyle}>Personal message (optional, max 500)</label>
            <textarea style={{ ...inputStyle, minHeight: 60, resize: 'vertical' }} value={message} onChange={e => setMessage(e.target.value.slice(0, 500))} placeholder="Hey! I thought you'd be a great fit for the beta..." />
            {message.length > 0 && <div style={{ fontSize: 10, color: T.textMuted, marginTop: 2 }}>{message.length}/500</div>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end' }}>
            <div>
              <label style={labelStyle}>Role</label>
              <select style={{ ...inputStyle, cursor: 'pointer' }} value={role} onChange={e => setRole(e.target.value)}>
                <option value="admin">Admin</option>
                <option value="rep">Rep</option>
              </select>
            </div>
            <Button primary onClick={sendNewInvite} disabled={!email.trim() || sending}>{sending ? 'Sending...' : 'Send Invitation'}</Button>
          </div>
        </Card>

        {/* Pending invitations */}
        <Card title={`Invitations (${filtered.length})`} action={
          <div style={{ display: 'flex', gap: 4 }}>
            {['all', 'pending', 'accepted', 'failed'].map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: '3px 10px', fontSize: 10, fontWeight: 600, border: 'none', borderRadius: 4, cursor: 'pointer', fontFamily: T.font,
                background: filter === f ? T.primary : T.surfaceAlt, color: filter === f ? '#fff' : T.textMuted,
              }}>{f}</button>
            ))}
          </div>
        }>
          {filtered.length === 0 ? (
            <div style={{ color: T.textMuted, fontSize: 13, padding: 12, textAlign: 'center' }}>No invitations</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Email', 'Name', 'Type', 'Role', 'Email Status', 'Invited', 'Expires', 'Status', 'Actions'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{inv.email}</td>
                    <td style={{ padding: '8px', color: T.textMuted }}>{inv.invited_name || '--'}</td>
                    <td style={{ padding: '8px' }}><Badge color={inv.invitation_type === 'new_instance' ? T.primary : T.success}>{inv.invitation_type === 'new_instance' ? 'New Org' : 'Teammate'}</Badge></td>
                    <td style={{ padding: '8px' }}>{inv.role}</td>
                    <td style={{ padding: '8px' }}><Badge color={emailStatusColors[inv.email_status] || T.textMuted}>{inv.email_status || 'unsent'}</Badge></td>
                    <td style={{ padding: '8px', color: T.textMuted, whiteSpace: 'nowrap' }}>{timeAgo(inv.created_at)}</td>
                    <td style={{ padding: '8px', color: T.textMuted, fontSize: 11 }}>{inv.expires_at ? formatDate(inv.expires_at) : '--'}</td>
                    <td style={{ padding: '8px' }}><Badge color={inv.status === 'accepted' ? T.success : inv.status === 'revoked' ? T.error : T.textMuted}>{inv.status}</Badge></td>
                    <td style={{ padding: '8px' }}>
                      {inv.status === 'pending' && (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => resendInvite(inv.id)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: T.primary, fontFamily: T.font }}>Resend</button>
                          <button onClick={() => copyLink(inv.token)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>Copy</button>
                          <button onClick={() => revokeInvite(inv.id)} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: T.error, fontFamily: T.font }}>Revoke</button>
                          <button onClick={async () => { if (!window.confirm('Permanently delete this invitation?')) return; const { error } = await supabase.rpc('delete_invitation', { p_invitation_id: inv.id }); if (error) { showToast(error.message, true); return }; showToast('Invitation deleted'); loadInvitations() }} style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 4, padding: '2px 8px', fontSize: 10, cursor: 'pointer', color: T.textMuted, fontFamily: T.font }}>Delete</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* Recent accepted */}
        {accepted.length > 0 && (
          <Card title={`Recently Accepted (${accepted.length})`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {['Email', 'Name', 'Type', 'Accepted', 'Org'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 600, color: T.textMuted, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {accepted.map(inv => (
                  <tr key={inv.id} style={{ borderBottom: `1px solid ${T.borderLight}` }}>
                    <td style={{ padding: '8px', fontWeight: 600 }}>{inv.email}</td>
                    <td style={{ padding: '8px', color: T.textMuted }}>{inv.invited_name || '--'}</td>
                    <td style={{ padding: '8px' }}><Badge color={inv.invitation_type === 'new_instance' ? T.primary : T.success}>{inv.invitation_type === 'new_instance' ? 'New Org' : 'Teammate'}</Badge></td>
                    <td style={{ padding: '8px', color: T.textMuted }}>{timeAgo(inv.accepted_at)}</td>
                    <td style={{ padding: '8px' }}>{inv.organizations?.name || '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  )
}
