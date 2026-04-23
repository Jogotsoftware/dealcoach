import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { track, identify } from '../lib/analytics'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { error } = await signIn(email, password)
      if (error) throw error
      const { data: { user } } = await supabase.auth.getUser()
      if (user) { identify(user.id, { email: user.email }); track('user_signed_in', { email: user.email }) }
      navigate('/')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e) => {
    e.preventDefault()
    if (!email) { setError('Enter your email address'); return }
    setError(null)
    setLoading(true)
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      })
      if (error) throw error
      setResetSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', background: T.surface, border: `1px solid ${T.border}`,
    borderRadius: 6, padding: '12px 14px', color: T.text, fontSize: 14,
    outline: 'none', fontFamily: T.font,
  }

  const labelStyle = {
    fontSize: 11, color: T.textSecondary, textTransform: 'uppercase',
    letterSpacing: '0.06em', marginBottom: 6, display: 'block', fontWeight: 600,
  }

  return (
    <div style={{
      minHeight: '100vh', background: T.bg,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: T.font,
    }}>
      <div style={{
        width: 420, background: T.surface, borderRadius: 12,
        border: `1px solid ${T.border}`, boxShadow: T.shadowMd,
      }}>
        {/* Header */}
        <div style={{ padding: '36px 40px 0', textAlign: 'center' }}>
          <div style={{
            width: 52, height: 52, borderRadius: 12, background: T.primary,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 24, color: '#fff', marginBottom: 16,
          }}>
            R
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            Revenue Instruments
          </div>
          <div style={{ fontSize: 14, color: T.textSecondary, marginBottom: 28 }}>
            {showReset ? 'Reset your password' : 'Sign in to your account'}
          </div>
        </div>

        {showReset ? (
          /* Reset password form */
          <form onSubmit={handleResetPassword} style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {resetSent ? (
              <div style={{ padding: '16px', borderRadius: 6, fontSize: 13, background: T.successLight, color: T.success, textAlign: 'center', lineHeight: 1.6 }}>
                Password reset email sent. Check your inbox.
              </div>
            ) : (
              <>
                <div>
                  <label style={labelStyle}>Email</label>
                  <input
                    style={inputStyle}
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    required
                    autoFocus
                    onFocus={e => { e.target.style.borderColor = T.primary }}
                    onBlur={e => { e.target.style.borderColor = T.border }}
                  />
                </div>

                {error && (
                  <div style={{ padding: '10px 14px', borderRadius: 6, fontSize: 13, background: T.errorLight, color: T.error, border: `1px solid ${T.error}25` }}>
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  style={{
                    width: '100%', padding: 14, borderRadius: 6, border: 'none',
                    background: T.primary, color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer', fontFamily: T.font,
                    opacity: loading ? 0.7 : 1, marginTop: 4,
                  }}
                >
                  {loading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </>
            )}

            <div style={{ textAlign: 'center', fontSize: 13, color: T.textSecondary }}>
              <button
                type="button"
                onClick={() => { setShowReset(false); setResetSent(false); setError(null) }}
                style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontWeight: 600, fontFamily: T.font, fontSize: 13 }}
              >
                Back to Sign In
              </button>
            </div>
          </form>
        ) : (
          /* Sign in form */
          <form onSubmit={handleSubmit} style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={labelStyle}>Email</label>
              <input
                style={inputStyle}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                onFocus={e => { e.target.style.borderColor = T.primary }}
                onBlur={e => { e.target.style.borderColor = T.border }}
              />
            </div>

            <div>
              <label style={{ ...labelStyle, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Password</span>
                <button
                  type="button"
                  onClick={() => { setShowReset(true); setError(null) }}
                  style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontFamily: T.font, fontSize: 11, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal', padding: 0 }}
                >
                  Forgot password?
                </button>
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  style={{ ...inputStyle, paddingRight: 52 }}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  minLength={6}
                  onFocus={e => { e.target.style.borderColor = T.primary }}
                  onBlur={e => { e.target.style.borderColor = T.border }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(p => !p)}
                  style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.textMuted, fontFamily: T.font, padding: '4px 6px' }}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            {error && (
              <div style={{
                padding: '10px 14px', borderRadius: 6, fontSize: 13,
                background: T.errorLight, color: T.error, border: `1px solid ${T.error}25`,
              }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: 14, borderRadius: 6, border: 'none',
                background: T.primary, color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: T.font,
                opacity: loading ? 0.7 : 1, marginTop: 4,
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            <div style={{ textAlign: 'center', fontSize: 13, color: T.textSecondary }}>
              {"Don't have an account? "}
              <a
                href="mailto:joe@revenueinstruments.com?subject=Request%20an%20Invitation&body=Hi%2C%20I'd%20like%20to%20request%20an%20invitation%20to%20Revenue%20Instruments."
                style={{ color: T.primary, fontWeight: 600, textDecoration: 'none' }}
              >
                Request an invitation
              </a>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
