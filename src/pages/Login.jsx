import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'

export default function Login() {
  const [mode, setMode] = useState('signin') // signin | signup
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const { signIn, signUp } = useAuth()
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      if (mode === 'signin') {
        const { error } = await signIn(email, password)
        if (error) throw error
      } else {
        const { error } = await signUp(email, password, fullName)
        if (error) throw error
      }
      navigate('/')
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
            D
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, color: T.text, marginBottom: 4 }}>
            DealCoach
          </div>
          <div style={{ fontSize: 14, color: T.textSecondary, marginBottom: 28 }}>
            {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ padding: '0 40px 36px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {mode === 'signup' && (
            <div>
              <label style={labelStyle}>Full Name</label>
              <input
                style={inputStyle}
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Joe Patterson"
                required
                onFocus={e => { e.target.style.borderColor = T.primary }}
                onBlur={e => { e.target.style.borderColor = T.border }}
              />
            </div>
          )}

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
            <label style={labelStyle}>Password</label>
            <input
              style={inputStyle}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter password"
              required
              minLength={6}
              onFocus={e => { e.target.style.borderColor = T.primary }}
              onBlur={e => { e.target.style.borderColor = T.border }}
            />
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
            {loading ? 'Loading...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>

          <div style={{ textAlign: 'center', fontSize: 13, color: T.textSecondary }}>
            {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
            <button
              type="button"
              onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
              style={{
                background: 'none', border: 'none', color: T.primary,
                cursor: 'pointer', fontWeight: 600, fontFamily: T.font, fontSize: 13,
              }}
            >
              {mode === 'signin' ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
