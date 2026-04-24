import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import { track, identify } from '../lib/analytics'

const BENEFITS = [
  'Transcripts turned into deal intelligence, automatically',
  'AI coaching that compounds with every call',
  'Pipeline context that never goes stale',
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [showReset, setShowReset] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [isNarrow, setIsNarrow] = useState(typeof window !== 'undefined' ? window.innerWidth <= 768 : false)
  const { signIn } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 10)
    const onResize = () => setIsNarrow(window.innerWidth <= 768)
    window.addEventListener('resize', onResize)
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize) }
  }, [])

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

  const cardAnimStyle = {
    opacity: mounted ? 1 : 0,
    transform: mounted ? 'translateY(0)' : 'translateY(8px)',
    transition: 'opacity 320ms ease, transform 320ms ease',
  }

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: isNarrow ? 'column' : 'row',
      fontFamily: T.font, background: '#fff',
    }}>
      {/* LEFT — brand panel */}
      <div style={{
        flex: isNarrow ? 'unset' : '0 0 45%',
        width: isNarrow ? '100%' : '45%',
        background: '#f0f7fd',
        borderRight: isNarrow ? 'none' : `1px solid ${T.border}`,
        borderBottom: isNarrow ? `1px solid ${T.border}` : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isNarrow ? '40px 24px' : '48px',
      }}>
        <div style={{ maxWidth: 340, width: '100%' }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: T.text, letterSpacing: '-0.01em' }}>
            Revenue Instruments
          </div>
          <div style={{ width: 40, height: 1, background: T.border, margin: '14px 0' }} />
          <div style={{ fontSize: 14, color: T.textSecondary, maxWidth: 260, lineHeight: 1.55 }}>
            AI-powered sales intelligence for enterprise B2B teams
          </div>
          <div style={{ height: 28 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {BENEFITS.map((b, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.primary, marginTop: 8, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: T.text, lineHeight: 1.6 }}>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* RIGHT — auth form */}
      <div style={{
        flex: 1, width: isNarrow ? '100%' : '55%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isNarrow ? '32px 20px' : '48px',
        background: '#fff',
      }}>
        <div style={{ width: '100%', maxWidth: 380, ...cardAnimStyle }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: T.text, marginBottom: 4, letterSpacing: '-0.01em' }}>
            {showReset ? 'Reset password' : 'Sign in'}
          </div>
          <div style={{ fontSize: 13, color: T.textMuted, marginBottom: 24 }}>
            {showReset ? 'Enter your email and we’ll send you a reset link.' : 'Welcome back.'}
          </div>

          {showReset ? (
            <form onSubmit={handleResetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {resetSent ? (
                <div style={{ padding: 16, borderRadius: 6, fontSize: 13, background: T.successLight, color: T.success, textAlign: 'center', lineHeight: 1.6 }}>
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
                    <div style={{ padding: '10px 14px', borderRadius: 6, fontSize: 13, background: T.errorLight, color: T.error, border: `1px solid ${T.error}25` }}>{error}</div>
                  )}
                  <button type="submit" disabled={loading} style={{
                    width: '100%', padding: 14, borderRadius: 6, border: 'none',
                    background: T.primary, color: '#fff', fontSize: 14, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer', fontFamily: T.font,
                    opacity: loading ? 0.7 : 1, marginTop: 4,
                  }}>
                    {loading ? 'Sending...' : 'Send reset link'}
                  </button>
                </>
              )}
              <div style={{ textAlign: 'center', fontSize: 13 }}>
                <button type="button" onClick={() => { setShowReset(false); setResetSent(false); setError(null) }}
                  style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontWeight: 600, fontFamily: T.font, fontSize: 13 }}>
                  Back to sign in
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
                  <button type="button" onClick={() => { setShowReset(true); setError(null) }}
                    style={{ background: 'none', border: 'none', color: T.primary, cursor: 'pointer', fontFamily: T.font, fontSize: 11, fontWeight: 600, textTransform: 'none', letterSpacing: 'normal', padding: 0 }}>
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
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: T.textMuted, fontFamily: T.font, padding: '4px 6px' }}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
              {error && (
                <div style={{
                  padding: '10px 14px', borderRadius: 6, fontSize: 13,
                  background: T.errorLight, color: T.error, border: `1px solid ${T.error}25`,
                }}>{error}</div>
              )}
              <button type="submit" disabled={loading} style={{
                width: '100%', padding: 14, borderRadius: 6, border: 'none',
                background: T.primary, color: '#fff', fontSize: 14, fontWeight: 600,
                cursor: loading ? 'not-allowed' : 'pointer', fontFamily: T.font,
                opacity: loading ? 0.7 : 1, marginTop: 4,
              }}>
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <div style={{ textAlign: 'center', fontSize: 12, color: T.textMuted, marginTop: 4 }}>
                Access is by invitation only.
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
