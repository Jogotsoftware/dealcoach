import { Outlet, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { theme as T } from '../lib/theme'
import NotificationBell from './NotificationBell'

// Dedicated SC portal shell — its own login world, not the AE module sidebar.
// Minimal: brand, Home, Demo schedule, the bell, and the SC's identity.
const NAV = [
  { to: '/sc', label: 'Home', exact: true },
  { to: '/sc/schedule', label: 'Demo schedule' },
]

export default function SCLayout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const isActive = (item) => item.exact ? pathname === item.to : pathname.startsWith(item.to)

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: T.font, display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '0 24px', height: 56, background: T.surface, borderBottom: `1px solid ${T.border}`, position: 'sticky', top: 0, zIndex: 50 }}>
        <Link to="/sc" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: T.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 14 }}>L</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: T.text }}>Lumen</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: T.primary, background: T.primaryLight, padding: '2px 8px', borderRadius: 10, letterSpacing: '0.04em' }}>SC</span>
        </Link>
        <nav style={{ display: 'flex', gap: 4 }}>
          {NAV.map(item => (
            <Link key={item.to} to={item.to}
              style={{
                padding: '7px 12px', borderRadius: 8, fontSize: 13, fontWeight: 600, textDecoration: 'none',
                color: isActive(item) ? T.primary : T.textSecondary,
                background: isActive(item) ? T.primaryLight : 'transparent',
              }}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div style={{ flex: 1 }} />
        <NotificationBell />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 30, height: 30, borderRadius: '50%', background: T.primaryLight, color: T.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
            {profile?.initials || (profile?.full_name || '?').charAt(0)}
          </span>
          <span style={{ fontSize: 12, color: T.text, fontWeight: 600 }}>{profile?.full_name}</span>
          <button onClick={async () => { await signOut(); navigate('/login') }}
            style={{ background: 'none', border: `1px solid ${T.border}`, borderRadius: 7, padding: '5px 10px', fontSize: 11, color: T.textSecondary, cursor: 'pointer', fontFamily: T.font }}>
            Sign out
          </button>
        </div>
      </header>
      <main style={{ flex: 1, width: '100%', maxWidth: 1180, margin: '0 auto', padding: 24 }}>
        <Outlet />
      </main>
    </div>
  )
}
