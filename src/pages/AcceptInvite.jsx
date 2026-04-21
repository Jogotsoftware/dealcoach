import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [state, setState] = useState('loading') // loading, not_found, expired, revoked, already_accepted, show_invite, confirm_accept, signup_form
  const [user, setUser] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ full_name: '', initials: '', password: '' })

  useEffect(() => { loadInvitation() }, [token])

  async function loadInvitation() {
    setLoading(true)
    // Use RPC if available, fallback to direct query
    const { data, error: rpcErr } = await supabase.rpc('get_invitation_by_token', { p_token: token })

    let inv = null
    if (!rpcErr && data) {
      inv = data
    } else {
      // Fallback: direct query
      const { data: directData } = await supabase.from('invitations')
        .select('id, email, token, status, role, invitation_type, org_id, expires_at, personal_message, invited_name, organizations(name), profiles!invitations_invited_by_fkey(full_name)')
        .eq('token', token).single()
      inv = directData
    }

    if (!inv) { setState('not_found'); setLoading(false); return }

    setInvitation(inv)

    if (inv.status === 'revoked') { setState('revoked'); setLoading(false); return }
    if (inv.status === 'accepted') { setState('already_accepted'); setLoading(false); return }
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) { setState('expired'); setLoading(false); return }

    // Check if user is signed in
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) {
      setUser(session.user)
      if (session.user.email?.toLowerCase() !== inv.email?.toLowerCase()) {
        setState('wrong_email')
      } else {
        setState('confirm_accept')
      }
    } else {
      setState('show_invite')
    }
    setLoading(false)
  }

  async function acceptInvitation() {
    setSubmitting(true)
    setError(null)
    try {
      const { data, error: rpcErr } = await supabase.rpc('accept_invitation', { p_token: token, p_user_id: user.id })
      if (rpcErr) throw new Error(rpcErr.message)
      if (invitation.invitation_type === 'new_instance') {
        navigate('/onboarding')
      } else {
        window.location.href = '/'
      }
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  async function handleSignup(e) {
    e.preventDefault()
    if (!form.full_name || !form.password) return
    setSubmitting(true)
    setError(null)
    try {
      const { data: authData, error: signUpErr } = await supabase.auth.signUp({
        email: invitation.email,
        password: form.password,
      })
      if (signUpErr) throw signUpErr
      const userId = authData.user?.id
      if (!userId) throw new Error('Sign up failed')

      const initials = form.initials || form.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      await supabase.from('profiles').insert({
        id: userId, email: invitation.email, full_name: form.full_name, initials,
        org_id: invitation.invitation_type === 'teammate' ? invitation.org_id : null,
        role: invitation.role || 'rep',
      })

      // Accept the invitation
      await supabase.rpc('accept_invitation', { p_token: token, p_user_id: userId })

      if (invitation.invitation_type === 'new_instance') {
        window.location.href = '/onboarding'
      } else {
        window.location.href = '/'
      }
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const cardStyle = { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 12, padding: 32, maxWidth: 480, width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }
  const center = { minHeight: '100vh', background: T.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: T.font, padding: 24 }
  const inviterName = invitation?.profiles?.full_name || invitation?.inviter_name || 'Someone'
  const orgName = invitation?.organizations?.name || invitation?.org_name || ''

  if (loading) return <div style={center}><Spinner /></div>

  // Error states
  if (state === 'not_found') return (
    <div style={center}><div style={cardStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>Invitation not found</h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 20 }}>This invitation link is invalid or has been removed.</p>
      <Button primary onClick={() => navigate('/login')} style={{ width: '100%', justifyContent: 'center' }}>Go to Sign In</Button>
    </div></div>
  )

  if (state === 'expired') return (
    <div style={center}><div style={cardStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>Invitation expired</h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 20 }}>This invitation has expired. Please contact the person who invited you to request a new one.</p>
      <Button primary onClick={() => navigate('/login')} style={{ width: '100%', justifyContent: 'center' }}>Go to Sign In</Button>
    </div></div>
  )

  if (state === 'revoked') return (
    <div style={center}><div style={cardStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>Invitation revoked</h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 20 }}>This invitation is no longer valid.</p>
      <Button primary onClick={() => navigate('/login')} style={{ width: '100%', justifyContent: 'center' }}>Go to Sign In</Button>
    </div></div>
  )

  if (state === 'already_accepted') return (
    <div style={center}><div style={cardStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>Already accepted</h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 20 }}>This invitation has already been used. If that was you, sign in to continue.</p>
      <Button primary onClick={() => navigate('/login')} style={{ width: '100%', justifyContent: 'center' }}>Sign In</Button>
    </div></div>
  )

  if (state === 'wrong_email') return (
    <div style={center}><div style={cardStyle}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>Wrong account</h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 12 }}>This invitation is for <strong>{invitation.email}</strong>.</p>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 20 }}>You are currently signed in as <strong>{user.email}</strong>. Please sign out and sign in with the correct email.</p>
      <Button primary onClick={async () => { await supabase.auth.signOut(); window.location.reload() }} style={{ width: '100%', justifyContent: 'center' }}>Sign Out</Button>
    </div></div>
  )

  // Signed in, email matches — confirm acceptance
  if (state === 'confirm_accept') return (
    <div style={center}><div style={cardStyle}>
      <div style={{ fontSize: 20, fontWeight: 600, color: T.primary, marginBottom: 24 }}>Revenue Instruments</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>
        {invitation.invitation_type === 'new_instance' ? `${inviterName} invited you to Revenue Instruments` : `Join ${orgName}`}
      </h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 8 }}>
        {invitation.invitation_type === 'new_instance'
          ? 'Accept to create your own workspace and set up your sales coaching environment.'
          : `Accept to join the ${orgName} team as a ${invitation.role}.`}
      </p>
      {invitation.personal_message && (
        <div style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.primary}`, padding: '12px 16px', borderRadius: '0 6px 6px 0', margin: '16px 0', fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.primary, marginBottom: 4 }}>Message from {inviterName}</div>
          {invitation.personal_message}
        </div>
      )}
      {error && <div style={{ color: T.error, fontSize: 13, padding: 8, background: T.errorLight, borderRadius: 6, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        <Button onClick={() => navigate('/login')}>Cancel</Button>
        <Button primary onClick={acceptInvitation} disabled={submitting} style={{ flex: 1, justifyContent: 'center' }}>{submitting ? 'Accepting...' : 'Accept Invitation'}</Button>
      </div>
    </div></div>
  )

  // Not signed in — show invite + signup form
  if (state === 'show_invite') return (
    <div style={center}><div style={cardStyle}>
      <div style={{ fontSize: 20, fontWeight: 600, color: T.primary, marginBottom: 24 }}>Revenue Instruments</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: T.text, marginBottom: 8 }}>
        {invitation.invitation_type === 'new_instance' ? `${inviterName} invited you to Revenue Instruments` : `Join ${orgName} on Revenue Instruments`}
      </h2>
      <p style={{ fontSize: 14, color: T.textSecondary, marginBottom: 4 }}>
        {invitation.invitation_type === 'new_instance'
          ? 'Create your own workspace with AI-powered sales coaching.'
          : `Join the ${orgName} team as a ${invitation.role}.`}
      </p>
      <p style={{ fontSize: 13, color: T.textMuted, marginBottom: 16 }}>Invitation for: {invitation.email}</p>
      {invitation.personal_message && (
        <div style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.primary}`, padding: '12px 16px', borderRadius: '0 6px 6px 0', margin: '0 0 20px', fontSize: 14, lineHeight: 1.6 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: T.primary, marginBottom: 4 }}>Message from {inviterName}</div>
          {invitation.personal_message}
        </div>
      )}

      <form onSubmit={handleSignup}>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Email</label>
          <input style={{ ...inputStyle, background: T.surfaceAlt, color: T.textMuted }} value={invitation.email} disabled />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Full Name *</label>
          <input style={inputStyle} value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Jane Smith" autoFocus />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={labelStyle}>Initials</label>
          <input style={inputStyle} value={form.initials} onChange={e => setForm(p => ({ ...p, initials: e.target.value }))} placeholder={form.full_name ? form.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) : 'JS'} maxLength={3} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>Password *</label>
          <input type="password" style={inputStyle} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" />
        </div>
        {error && <div style={{ color: T.error, fontSize: 13, padding: 8, background: T.errorLight, borderRadius: 6, marginBottom: 12 }}>{error}</div>}
        <Button primary disabled={!form.full_name || !form.password || form.password.length < 6 || submitting} style={{ width: '100%', justifyContent: 'center', padding: '12px 20px' }}>
          {submitting ? 'Creating account...' : 'Create Account & Accept'}
        </Button>
      </form>
      <div style={{ textAlign: 'center', marginTop: 16 }}>
        <a href={`/login?invite_token=${token}&email=${encodeURIComponent(invitation.email)}`} style={{ fontSize: 13, color: T.primary, textDecoration: 'none' }}>Already have an account? Sign in</a>
      </div>
    </div></div>
  )

  return <div style={center}><Spinner /></div>
}
