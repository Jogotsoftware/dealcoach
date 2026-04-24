import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'

const SHADOW_LG = '0 10px 40px rgba(0,0,0,0.08)'

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState(null)
  const [sessionUser, setSessionUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [state, setState] = useState('loading') // loading | invite_pending | auth_no_org | auth_has_org | invalid
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ full_name: '', password: '', confirm_password: '' })
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10)
    loadInvitation()
    return () => clearTimeout(t)
  }, [token])

  // Auto-redirect from State 3 after 1500ms
  useEffect(() => {
    if (state === 'auth_has_org') {
      const t = setTimeout(() => navigate('/', { replace: true }), 1500)
      return () => clearTimeout(t)
    }
  }, [state, navigate])

  async function loadInvitation() {
    // Fetch invitation
    let inv = null
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_invitation_by_token', { p_token: token })
    if (!rpcErr && rpcData) inv = Array.isArray(rpcData) ? rpcData[0] : rpcData
    if (!inv) {
      const { data } = await supabase.from('invitations')
        .select('id, email, token, status, role, invitation_type, org_id, expires_at, personal_message, invited_name, organizations(name), profiles!invitations_invited_by_fkey(full_name)')
        .eq('token', token).maybeSingle()
      inv = data
    }

    if (!inv) { setState('invalid'); return }
    setInvitation(inv)

    const invalid = inv.status === 'revoked' || inv.status === 'accepted' ||
      (inv.expires_at && new Date(inv.expires_at) < new Date())
    if (invalid) { setState('invalid'); return }

    // Pre-fill the signup form
    if (inv.invited_name) setForm(p => ({ ...p, full_name: inv.invited_name }))

    // Check session
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { setState('invite_pending'); return }

    setSessionUser(session.user)
    // Check profile
    const { data: prof } = await supabase.from('profiles').select('id, org_id').eq('id', session.user.id).maybeSingle()
    setProfile(prof || null)
    if (prof?.org_id) setState('auth_has_org')
    else setState('auth_no_org')
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    if (!form.full_name || !form.password) return
    if (form.password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (form.password !== form.confirm_password) { setError('Passwords do not match.'); return }
    setSubmitting(true)
    setError(null)
    try {
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-invited-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({
          token,
          password: form.password,
          full_name: form.full_name,
          initials: form.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2),
        }),
      })
      const result = await resp.json()
      if (!resp.ok || result.error) throw new Error(result.error || 'Signup failed')
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email: result.email, password: form.password })
      if (signInErr) throw signInErr
      // Every successful accept routes to onboarding — RequireOrg will redirect onward if the user already has an org
      navigate('/onboarding')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  async function acceptAndGoToOnboarding() {
    if (!sessionUser) return
    setSubmitting(true)
    setError(null)
    try {
      const { error: rpcErr } = await supabase.rpc('accept_invitation', { p_token: token, p_user_id: sessionUser.id })
      if (rpcErr) throw new Error(rpcErr.message)
      try { await supabase.rpc('apply_invitation_module_access', { p_invitation_id: invitation.id, p_user_id: sessionUser.id }) } catch (_) {}
      navigate('/onboarding')
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  const cardAnim = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 320ms ease, transform 320ms ease',
  }

  const shell = (inner) => (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      background: '#fff', fontFamily: T.font,
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 16, letterSpacing: '-0.01em' }}>
        Revenue Instruments
      </div>
      <div style={{
        width: '100%', maxWidth: 440, background: '#fff',
        borderTop: `3px solid ${T.primary}`, borderRadius: 10,
        boxShadow: SHADOW_LG, padding: 40,
        ...cardAnim,
      }}>
        {inner}
      </div>
    </div>
  )

  if (state === 'loading') {
    return shell(
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 200, height: 3, background: T.border, borderRadius: 2, overflow: 'hidden', margin: '12px auto 16px' }}>
          <div style={{ width: '40%', height: '100%', background: T.primary, borderRadius: 2, animation: 'shimmer 1.4s ease-in-out infinite', transformOrigin: 'left' }} />
        </div>
        <div style={{ fontSize: 14, color: T.textMuted }}>Checking your invitation...</div>
      </div>
    )
  }

  if (state === 'invalid') {
    return shell(
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0, marginBottom: 10 }}>This link isn't valid.</h1>
        <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 8 }}>
          It may have expired or already been used.
        </p>
        <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 24 }}>
          Ask the person who invited you to send a new link.
        </p>
        <button onClick={() => navigate('/login')} style={primaryBtn}>Go to sign in</button>
      </div>
    )
  }

  if (state === 'auth_has_org') {
    return shell(
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0, marginBottom: 10 }}>You're already in.</h1>
        <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 20 }}>
          Redirecting to your workspace...
        </p>
        <div style={{ width: 200, height: 3, background: T.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ width: '40%', height: '100%', background: T.primary, borderRadius: 2, animation: 'shimmer 1.4s ease-in-out infinite', transformOrigin: 'left' }} />
        </div>
      </div>
    )
  }

  if (state === 'auth_no_org') {
    return shell(
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, margin: 0, marginBottom: 10 }}>Your account is ready.</h1>
        <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 24 }}>
          You just need to set up your workspace. Takes about 3 minutes.
        </p>
        {error && <div style={errorBox}>{error}</div>}
        <button onClick={acceptAndGoToOnboarding} disabled={submitting} style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1 }}>
          {submitting ? 'Setting up...' : 'Set up my workspace →'}
        </button>
      </div>
    )
  }

  // invite_pending — signup flow
  const inviterName = invitation?.profiles?.full_name || invitation?.inviter_name || ''
  const inviterFirst = inviterName ? inviterName.split(' ')[0] : ''

  return shell(
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: T.text, margin: 0, marginBottom: 8, letterSpacing: '-0.01em' }}>
        You're invited.
      </h1>
      <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6, marginBottom: 14 }}>
        {invitation?.invitation_type === 'new_instance'
          ? 'Set up a new workspace for your team.'
          : `${inviterFirst || 'Someone'} invited you to join their workspace.`}
      </p>
      <div style={{
        display: 'inline-block', fontSize: 12, padding: '3px 10px', borderRadius: 999,
        background: T.primaryLight, color: T.primary, marginBottom: 20, fontWeight: 500,
      }}>
        {invitation?.email}
      </div>
      {invitation?.personal_message && (
        <div style={{ background: T.surfaceAlt, borderLeft: `3px solid ${T.primary}`, padding: '10px 14px', borderRadius: '0 6px 6px 0', marginBottom: 20, fontSize: 13, lineHeight: 1.55, color: T.text }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: T.primary, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Message{inviterName ? ` from ${inviterName}` : ''}</div>
          {invitation.personal_message}
        </div>
      )}

      <form onSubmit={handleCreateAccount} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div>
          <label style={labelStyle}>Full name</label>
          <input style={inputStyle} value={form.full_name}
            onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))}
            placeholder="Jane Smith" autoFocus required
            onFocus={e => { e.target.style.borderColor = T.primary }}
            onBlur={e => { e.target.style.borderColor = T.border }} />
        </div>
        <div>
          <label style={labelStyle}>Password <span style={{ textTransform: 'none', color: T.textMuted, fontWeight: 400 }}>(min 8 characters)</span></label>
          <input style={inputStyle} type="password" value={form.password}
            onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required minLength={8}
            onFocus={e => { e.target.style.borderColor = T.primary }}
            onBlur={e => { e.target.style.borderColor = T.border }} />
        </div>
        <div>
          <label style={labelStyle}>Confirm password</label>
          <input style={inputStyle} type="password" value={form.confirm_password}
            onChange={e => setForm(p => ({ ...p, confirm_password: e.target.value }))} required minLength={8}
            onFocus={e => { e.target.style.borderColor = T.primary }}
            onBlur={e => { e.target.style.borderColor = T.border }} />
          {form.confirm_password && form.password !== form.confirm_password && (
            <div style={{ fontSize: 11, color: T.error, marginTop: 4 }}>Passwords do not match</div>
          )}
        </div>
        {error && <div style={errorBox}>{error}</div>}
        <button type="submit" disabled={submitting || !form.full_name || form.password.length < 8 || form.password !== form.confirm_password}
          style={{ ...primaryBtn, opacity: submitting ? 0.7 : 1, marginTop: 6 }}>
          {submitting ? 'Creating account...' : 'Create account & continue →'}
        </button>
      </form>
    </div>
  )
}

const primaryBtn = {
  width: '100%', padding: 14, borderRadius: 6, border: 'none',
  background: '#5DADE2', color: '#fff', fontSize: 14, fontWeight: 600,
  cursor: 'pointer', fontFamily: "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif",
}

const inputStyle = {
  width: '100%', background: '#fff', border: `1px solid ${T.border}`,
  borderRadius: 6, padding: '11px 13px', color: T.text, fontSize: 14,
  outline: 'none', fontFamily: T.font,
}

const labelStyle = {
  fontSize: 11, color: T.textSecondary, textTransform: 'uppercase',
  letterSpacing: '0.06em', marginBottom: 6, display: 'block', fontWeight: 600,
}

const errorBox = {
  padding: '10px 12px', borderRadius: 6, fontSize: 13,
  background: T.errorLight, color: T.error, border: `1px solid ${T.error}25`,
}
