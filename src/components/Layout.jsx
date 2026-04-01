import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { hasModule } = useModules()
  const navigate = useNavigate()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

  useEffect(() => {
    if (profile?.id) {
      supabase.from('platform_admins').select('id').eq('user_id', profile.id).single()
        .then(({ data }) => setIsPlatformAdmin(!!data))
    }
  }, [profile])

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const initials = profile?.initials || profile?.full_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'

  const isAdmin = ['admin', 'system_admin'].includes(profile?.role)
  const navItems = [
    { to: '/', icon: '\u25A6', label: 'Pipeline', show: true },
    { to: '/coach', icon: '\u25CE', label: 'Coach Admin', show: hasModule('coach_customization') && isAdmin },
    { to: '/settings', icon: '\u2699', label: 'Settings', show: true },
    { to: '/settings/team', icon: '\u2630', label: 'Team', show: isAdmin },
    { to: '/settings/organization', icon: '\u2302', label: 'Organization', show: isAdmin },
    { to: '/admin/widgets', icon: '\u2637', label: 'Widgets', show: isAdmin },
    { to: '/admin', icon: '\u2691', label: 'Platform Admin', show: isPlatformAdmin },
  ].filter(item => item.show)

  return (
    <div style={{ display: 'flex', fontFamily: T.font, background: T.bg, minHeight: '100vh', color: T.text, fontSize: 14 }}>
      {/* Sidebar */}
      <aside
        onMouseEnter={() => setSidebarExpanded(true)}
        onMouseLeave={() => setSidebarExpanded(false)}
        style={{
          width: sidebarExpanded ? 240 : 56,
          transition: 'width 0.2s ease',
          background: '#0b0e13',
          borderRight: '1px solid #1a1f2e',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden', flexShrink: 0,
          height: '100vh', position: 'sticky', top: 0,
          zIndex: 100,
        }}
      >
        {/* Logo */}
        <div
          onClick={() => navigate('/')}
          style={{
            padding: sidebarExpanded ? '16px 16px' : '16px 14px',
            borderBottom: '1px solid #1a1f2e',
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 6, background: T.primary,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontSize: 13, color: '#fff', flexShrink: 0,
          }}>
            D
          </div>
          {sidebarExpanded && <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>DealCoach</span>}
        </div>

        {/* Nav items */}
        <div style={{ flex: 1, padding: '12px 8px' }}>
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              title={!sidebarExpanded ? item.label : undefined}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 12,
                padding: sidebarExpanded ? '10px 16px' : '10px 16px',
                borderRadius: 8, textDecoration: 'none', margin: '2px 0',
                fontSize: 13, fontWeight: isActive ? 700 : 500,
                background: isActive ? 'rgba(93,173,226,0.1)' : 'transparent',
                color: isActive ? '#5DADE2' : '#8899aa',
                whiteSpace: 'nowrap', overflow: 'hidden',
                transition: 'all 0.15s',
              })}
            >
              <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
              {sidebarExpanded && <span>{item.label}</span>}
            </NavLink>
          ))}
        </div>

        {/* User footer */}
        <div style={{
          padding: sidebarExpanded ? '12px 16px' : '12px 12px',
          borderTop: '1px solid #1a1f2e',
          display: 'flex', alignItems: 'center', gap: 10,
          overflow: 'hidden', whiteSpace: 'nowrap',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
            background: 'rgba(93,173,226,0.15)', border: '1px solid rgba(93,173,226,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 700, color: T.primary,
          }}>
            {initials}
          </div>
          {sidebarExpanded && (
            <>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.full_name || 'Loading...'}</div>
                <div style={{ fontSize: 10, color: '#667788', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.email || ''}</div>
              </div>
              <button
                onClick={handleSignOut}
                title="Sign out"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 14, color: '#667788', padding: 4, lineHeight: 1,
                  flexShrink: 0,
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#e74c3c'}
                onMouseLeave={e => e.currentTarget.style.color = '#667788'}
              >
                &#x2715;
              </button>
            </>
          )}
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', width: '100%' }}>
        <Outlet />
      </div>
    </div>
  )
}
