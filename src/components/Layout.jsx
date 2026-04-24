import { useState, useEffect } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { useOrg } from '../contexts/OrgContext'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import GlobalChatbot from './GlobalChatbot'

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { hasModule } = useModules()
  const { org, credits, isTrialing } = useOrg()
  const navigate = useNavigate()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

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

  const sections = [
    { label: 'Workspace', items: [
      { to: '/', icon: '\u25A6', label: 'Home', show: hasModule('pipeline') },
      { to: '/coach', icon: '\u25CE', label: 'Coach', show: hasModule('coach_customization') },
      { to: '/reports', icon: '\u2261', label: 'Reports', show: hasModule('reports') },
      { to: '/settings/team', icon: '\u2630', label: 'Team', show: true },
      { to: '/settings', icon: '\u2699', label: 'Settings', show: true },
    ]},
    { label: 'Admin', show: isAdmin, items: [
      { to: '/settings/organization', icon: '\u2302', label: 'Organization', show: true },
      { to: '/admin/widgets', icon: '\u2637', label: 'Widgets', show: hasModule('coach_customization') },
    ]},
    { label: 'Super Admin', show: isPlatformAdmin, items: [
      { to: '/admin', icon: '\u2691', label: 'Organizations', show: true },
      { to: '/admin/invitations', icon: '\u2709', label: 'Invitations', show: true },
      { to: '/admin/feedback', icon: '\u2690', label: 'Feedback', show: true },
      { to: '/admin/extraction-definitions', icon: '\u2261', label: 'AI Rules', show: true },
    ]},
  ]

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

        {/* Nav sections */}
        <div style={{ flex: 1, padding: '12px 8px' }}>
          {sections.filter(s => s.show !== false).map(section => {
            const items = section.items.filter(i => i.show !== false)
            if (!items.length) return null
            return (
              <div key={section.label} style={{ marginBottom: 8 }}>
                {sidebarExpanded && section.label !== 'Workspace' && (
                  <div style={{ fontSize: 9, fontWeight: 700, color: '#556677', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '8px 16px 4px', userSelect: 'none' }}>{section.label}</div>
                )}
                {items.map(item => (
                  <NavLink key={item.to} to={item.to} end title={!sidebarExpanded ? item.label : undefined}
                    style={({ isActive }) => ({
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', borderRadius: 8, textDecoration: 'none', margin: '2px 0',
                      fontSize: 13, fontWeight: isActive ? 700 : 500,
                      background: isActive ? 'rgba(93,173,226,0.1)' : 'transparent',
                      color: isActive ? '#5DADE2' : '#8899aa',
                      whiteSpace: 'nowrap', overflow: 'hidden', transition: 'all 0.15s',
                    })}>
                    <span style={{ fontSize: 18, width: 24, textAlign: 'center', flexShrink: 0 }}>{item.icon}</span>
                    {sidebarExpanded && <span>{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </div>

        {/* User footer */}
        <div style={{ position: 'relative' }}>
          {showUserMenu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 998 }} onClick={() => setShowUserMenu(false)} />
              <div style={{
                position: 'absolute', bottom: '100%', left: 8, right: 8, marginBottom: 4, zIndex: 999,
                background: '#1a1f2e', border: '1px solid #2a3040', borderRadius: 8,
                boxShadow: '0 -4px 16px rgba(0,0,0,0.4)', padding: 4,
              }}>
                <button onClick={() => { navigate('/settings'); setShowUserMenu(false) }} style={{
                  display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, color: '#ccc', fontFamily: T.font,
                }} onMouseEnter={e => e.currentTarget.style.background = '#252a3a'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Settings</button>
                <button onClick={handleSignOut} style={{
                  display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, color: '#e74c3c', fontFamily: T.font,
                }} onMouseEnter={e => e.currentTarget.style.background = '#252a3a'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Sign out</button>
              </div>
            </>
          )}
          <div
            onClick={() => setShowUserMenu(!showUserMenu)}
            style={{
              padding: sidebarExpanded ? '12px 16px' : '12px 12px',
              borderTop: '1px solid #1a1f2e',
              display: 'flex', alignItems: 'center', gap: 10,
              overflow: 'hidden', whiteSpace: 'nowrap',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = '#151820'}
            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
          >
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(93,173,226,0.15)', border: '1px solid rgba(93,173,226,0.25)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: T.primary,
            }}>
              {initials}
            </div>
            {sidebarExpanded && (
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#e0e0e0', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.full_name || 'Loading...'}</div>
                <div style={{ fontSize: 10, color: '#667788', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile?.email || ''}</div>
                {credits && <div style={{ fontSize: 10, color: '#667788', marginTop: 2 }}>{credits.balance ?? 0} credits</div>}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', width: '100%' }}>
        {isTrialing && org?.trial_ends_at && (
          <div style={{
            padding: '8px 24px', background: T.warningLight, borderBottom: `1px solid ${T.warning}25`,
            fontSize: 12, color: T.warning, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <span>Trial ends {new Date(org.trial_ends_at).toLocaleDateString()} — {Math.max(0, Math.ceil((new Date(org.trial_ends_at) - new Date()) / 86400000))} days remaining</span>
            <button onClick={() => navigate('/settings/organization')} style={{ padding: '3px 10px', fontSize: 10, background: T.warning, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontFamily: T.font }}>Upgrade</button>
          </div>
        )}
        <Outlet />
      </div>
      <GlobalChatbot />
    </div>
  )
}
