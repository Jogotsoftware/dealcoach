import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import { Button, Spinner, inputStyle, labelStyle } from '../components/Shared'

export default function AcceptInvite() {
  const { token } = useParams()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState(null)
  const [orgName, setOrgName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [form, setForm] = useState({ full_name: '', initials: '', password: '' })

  useEffect(() => {
    loadInvitation()
  }, [token])

  async function loadInvitation() {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('invitations')
      .select('*, organizations(name)')
      .eq('token', token)
      .eq('status', 'pending')
      .single()

    if (err || !data) {
      setError('Invitation not found or already used.')
      setLoading(false)
      return
    }

    if (data.expires_at && new Date(data.expires_at) < new Date()) {
      setError('This invitation has expired.')
      setLoading(false)
      return
    }

    setInvitation(data)
    setOrgName(data.organizations?.name || '')
    setLoading(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.full_name || !form.password) return
    setSubmitting(true)
    setError(null)

    try {
      // 1. Sign up
      const { data: authData, error: signUpErr } = await supabase.auth.signUp({
        email: invitation.email,
        password: form.password,
      })
      if (signUpErr) throw signUpErr

      const userId = authData.user?.id
      if (!userId) throw new Error('Sign up failed — no user ID returned')

      // 2. Create profile
      const initials = form.initials || form.full_name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
      await supabase.from('profiles').insert({
        id: userId,
        email: invitation.email,
        full_name: form.full_name,
        initials,
        org_id: invitation.org_id,
        role: invitation.role || 'rep',
      })

      // 3. Mark invitation accepted
      await supabase.from('invitations').update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
      }).eq('id', invitation.id)

      // 4. Navigate to app
      navigate('/')
    } catch (err) {
      setError(err.message || 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: T.bg }}>
      <Spinner />
    </div>
  )

  if (error && !invitation) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: T.bg, fontFamily: T.font }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 40, maxWidth: 400, textAlign: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: T.error, marginBottom: 8 }}>Invalid Invitation</div>
        <div style={{ fontSize: 13, color: T.textSecondary }}>{error}</div>
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', background: T.bg, fontFamily: T.font }}>
      <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: T.radius, padding: 40, width: 400 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 6, background: T.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 15, color: '#fff',
          }}>D</div>
          <span style={{ fontSize: 17, fontWeight: 700, color: T.text }}>DealCoach</span>
        </div>

        <div style={{ fontSize: 15, fontWeight: 700, color: T.text, marginBottom: 4 }}>Accept Invitation</div>
        <div style={{ fontSize: 13, color: T.textSecondary, marginBottom: 20 }}>
          You've been invited to join <strong>{orgName}</strong>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Email</label>
            <input style={{ ...inputStyle, background: T.surfaceAlt }} value={invitation.email} disabled />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Full Name</label>
            <input style={inputStyle} value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} required />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Initials</label>
            <input style={inputStyle} value={form.initials} placeholder="Auto-generated if blank"
              onChange={e => setForm({ ...form, initials: e.target.value })} maxLength={3} />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>Password</label>
            <input type="password" style={inputStyle} value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })} required minLength={6} />
          </div>

          {error && <div style={{ color: T.error, fontSize: 12, marginBottom: 12 }}>{error}</div>}

          <Button primary disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
            {submitting ? 'Creating account...' : 'Create Account & Join'}
          </Button>
        </form>
      </div>
    </div>
  )
}
