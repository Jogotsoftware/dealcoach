import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'

const NAV_ITEMS = [
  { to: '/', icon: '\u25A6', label: 'Pipeline' },
  { to: '/coach', icon: '\u2605', label: 'Coach Admin' },
  { to: '/settings', icon: '\u2699', label: 'Settings' },
]

export default function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = profile?.initials || profile?.full_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div style={{ display: 'flex', fontFamily: T.font, background: T.bg, minHeight: '100vh', color: T.text, fontSize: 14 }}>
      {/* Sidebar */}
      <div style={{
        width: 220, background: T.surface, borderRight: `1px solid ${T.border}`,
        display: 'flex', flexDirection: 'column', flexShrink: 0,
        height: '100vh', position: 'sticky', top: 0,
      }}>
        {/* Logo */}
        <div
          onClick={() => navigate('/')}
          style={{
            padding: '16px 20px', borderBottom: `1px solid ${T.border}`,
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: T.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 13, color: '#fff',
          }}>
            D
          </div>
          <span style={{ fontSize: 15, fontWeight: 700, color: T.text }}>DealCoach</span>
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '12px 10px' }}>
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 6, textDecoration: 'none',
                fontSize: 13, fontWeight: isActive ? 600 : 500, marginBottom: 2,
                background: isActive ? T.primaryLight : 'transparent',
                color: isActive ? T.primary : T.textSecondary,
                transition: 'all 0.15s',
              })}
            >
              <span style={{ fontSize: 15, width: 20, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* User footer */}
        <div style={{
          padding: '12px 16px', borderTop: `1px solid ${T.border}`,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            background: T.primaryLight, border: `1px solid ${T.primaryBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: T.primary,
          }}>
            {initials}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{profile?.full_name || 'Loading...'}</div>
            <div style={{ fontSize: 10, color: T.textMuted }}>Account Executive</div>
          </div>
          <button
            onClick={handleSignOut}
            title="Sign out"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              fontSize: 14, color: T.textMuted, padding: 4, lineHeight: 1,
            }}
          >
            &#x2715;
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto' }}>
        <Outlet />
      </div>
    </div>
  )
}
