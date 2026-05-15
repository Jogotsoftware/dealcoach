import { useState, useEffect } from 'react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useModules } from '../hooks/useModules'
import { useOrg } from '../contexts/OrgContext'
import { supabase } from '../lib/supabase'
import { theme as T } from '../lib/theme'
import GlobalChatbot from './GlobalChatbot'
import BetaFeedbackButton from './BetaFeedbackButton'
import NotificationBell from './NotificationBell'

// Sidebar nav icons — Feather-style line SVGs at consistent 18×18 with stroke="currentColor".
// Keyed for the items[].icon field so the render loop can look them up uniformly.
function NavIcon({ k }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const paths = {
    // Revenue — bar chart trending up
    revenue: <><line x1="3" y1="20" x2="21" y2="20"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="11" y1="20" x2="11" y2="9"/><line x1="16" y1="20" x2="16" y2="11"/><polyline points="3 14 8 9 13 13 21 5"/></>,
    // Pipeline — funnel
    pipeline: <><path d="M3 4h18l-7 9v6l-4 2v-8L3 4z"/></>,
    // Execution — lightning bolt
    execution: <><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>,
    // Coaching — chat bubble with question
    coaching: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9.5" y1="10" x2="9.5" y2="10.01"/><line x1="14.5" y1="10" x2="14.5" y2="10.01"/></>,
    // Team — three people
    team: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
    // Coach admin — sliders
    coach_admin: <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
    // Reports — document with bars
    reports: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></>,
    // Settings — gear
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
    // Home — house
    home: <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></>,
    // BDR — paper plane / send
    bdr_submit: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    bdr_leads:  <><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
    coach: <><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>,
    // Benchmarks / Goals — trophy
    goals: <><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></>,
    // Analyze — staggered bars (waterfall feel)
    analyze: <><path d="M3 3v18h18"/><rect x="6" y="11" width="3" height="7" rx="0.5"/><rect x="11" y="7" width="3" height="11" rx="0.5"/><rect x="16" y="13" width="3" height="5" rx="0.5"/></>,
  }
  const child = paths[k]
  if (!child) return <span style={{ display: 'inline-block', width: 18, height: 18 }} />
  return <svg {...common}>{child}</svg>
}

// BDR-role users may visit only these path prefixes. Everything else redirects
// to /bdr/my-leads — belt-and-suspenders on top of RLS, gives a clean demo answer
// for "what stops a BDR from seeing the admin console".
const BDR_ALLOWED_PATTERNS = [
  /^\/bdr(\/|$)/,
  /^\/settings(\/?$)/,
  /^\/onboarding(\/|$)/,
]

// Pilot AEs with profile.access_mode='dealroom_only' may only reach: their pipeline,
// create-new-deal, and an individual deal (where DealDetail will further restrict tabs to
// just Deal Room). NO Settings, Onboarding, Notifications, Coach, Reports, Admin —
// pilot users get a single-purpose Deal Room surface. Pairs with the tab filter in
// DealDetail.jsx.
const DEALROOM_ONLY_ALLOWED_PATTERNS = [
  /^\/$/,
  /^\/deal\/new\/?$/,
  /^\/deal\/[^/]+\/?$/,
  /^\/deal\/[^/]+\/room(\/|$)/,
]

export default function Layout() {
  const { profile, signOut } = useAuth()
  const { hasModule } = useModules()
  const { org, credits, isTrialing, isDemoOrg } = useOrg()
  const navigate = useNavigate()
  const location = useLocation()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  // Per-section collapsed state, persisted to localStorage so the user's preference
  // sticks across reloads. Key shape: { [sectionLabel]: true } means collapsed.
  // Workspace stays always-expanded (no header anyway). Other sections click-to-toggle.
  const [collapsedSections, setCollapsedSections] = useState(() => {
    try {
      const raw = localStorage.getItem('lumen.sidebar.collapsed')
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  })
  const toggleSection = (label) => {
    setCollapsedSections(prev => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem('lumen.sidebar.collapsed', JSON.stringify(next)) } catch {}
      return next
    })
  }

  // BdrGuard: BDR-role users can only reach allow-listed paths. Everything else
  // redirects to My Leads. Layered on top of RLS (the real defense).
  if (profile?.role === 'bdr' && !BDR_ALLOWED_PATTERNS.some(p => p.test(location.pathname))) {
    return <Navigate to="/bdr/my-leads" replace />
  }

  // Pilot AE guard: profile.access_mode='dealroom_only' users may only reach pipeline,
  // create-deal, an individual deal, and Settings. Pairs with DealDetail tab filter.
  if (profile?.access_mode === 'dealroom_only' && !DEALROOM_ONLY_ALLOWED_PATTERNS.some(p => p.test(location.pathname))) {
    return <Navigate to="/" replace />
  }

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
  const isAEOpsManager = ['admin', 'system_admin', 'manager'].includes(profile?.role) || isPlatformAdmin
  const isBdr = profile?.role === 'bdr'
  const isDealRoomOnly = profile?.access_mode === 'dealroom_only'

  // BDR-role users get a constrained sidebar with a labelled "XDR" section
  // (XDR = Extended Development Rep, the umbrella for BDRs/SDRs/etc; under the hood
  // schema stays bdr_*). Settings sits in an unlabeled "Workspace" section per
  // the existing convention (section.label === 'Workspace' suppresses the header).
  // Everything else is hidden at the nav layer; BdrGuard + RLS enforce server-side.
  const bdrSections = [
    { label: 'XDR', items: [
      { to: '/bdr/submit',   iconKey: 'bdr_submit', label: 'Submit a Lead', show: true },
      { to: '/bdr/my-leads', iconKey: 'bdr_leads',  label: 'My Leads',      show: true },
    ]},
    { label: 'Workspace', items: [
      { to: '/settings', iconKey: 'settings', label: 'Settings', show: true },
    ]},
  ]

  const isManager = !!profile && ['head_of_sales','avp','rvp'].includes(profile.role_level)
  const fullSections = [
    { label: 'Workspace', items: isManager ? [
      { to: '/revenue',   iconKey: 'revenue',     label: 'Revenue',   show: true },
      { to: '/pipeline',  iconKey: 'pipeline',    label: 'Pipeline',  show: true },
      { to: '/execution', iconKey: 'execution',   label: 'Execution', show: true },
      { to: '/coaching',  iconKey: 'coaching',    label: 'Coaching',  show: true },
      { to: '/forecast',  iconKey: 'analyze',     label: 'Forecast',  show: true },
      { to: '/team',      iconKey: 'team',        label: 'Team',      show: true },
      // Coach Admin / Reports / Settings hidden in demo orgs — Melanie's
      // walkthrough is dashboard-only; the back-office surfaces would derail
      // the narrative and aren't part of the demo script.
      { to: '/coach',     iconKey: 'coach_admin', label: 'Coach Admin', show: !isDemoOrg && hasModule('coach_customization') },
      { to: '/reports',   iconKey: 'reports',     label: 'Reports',   show: !isDemoOrg && hasModule('reports') },
      // "Benchmarks & Goals" — manager-only page where the head of sales
      // sets the targets every dashboard tile measures against.
      { to: '/my-goals',  iconKey: 'goals',       label: 'Benchmarks',  show: true },
      { to: '/settings',  iconKey: 'settings',    label: 'Settings',  show: !isDemoOrg },
    ] : [
      { to: '/',          iconKey: 'home',        label: 'Home',      show: hasModule('pipeline') },
      { to: '/coach',     iconKey: 'coach',       label: 'Coach',     show: hasModule('coach_customization') },
      { to: '/reports',   iconKey: 'reports',     label: 'Reports',   show: hasModule('reports') },
      // Benchmarks page is leadership-only; AEs don't see it. Their personal
      // stretch lives on Settings → My Goals (separate concept).
      { to: '/settings',  iconKey: 'settings',    label: 'Settings',  show: true },
    ]},
    { label: 'SME', show: !isManager, items: [
      { to: '/sme/inbox', icon: '\u2709', label: 'Inbox', show: true },
      { to: '/sme/my-questions', icon: '?', label: 'My questions', show: true },
      { to: '/sme/leaderboard', icon: '\u2605', label: 'Leaderboard', show: true },
    ]},
    { label: 'Admin', show: isAEOpsManager && !isManager, items: [
      { to: '/admin/qdc-criteria', icon: '\u2717', label: 'QDC Criteria', show: isAEOpsManager },
      { to: '/admin/routing',         icon: '\u21C4', label: 'Lead Routing',    show: isAEOpsManager },
      { to: '/settings/organization', icon: '\u2302', label: 'Organization', show: isAdmin },
      { to: '/admin/widgets', icon: '\u2637', label: 'Widgets', show: isAdmin && hasModule('coach_customization') },
      { to: '/admin/sme-routing', icon: '\u21BB', label: 'SME Routing', show: isAdmin },
      { to: '/admin/sme-flags', icon: '\u26A0', label: 'SME Flags', show: isAdmin },
    ]},
    // XDR surface in sidebar for AE managers/admins + platform admins. AE managers
    // need it to preview the BDR experience and walk through the routing flow;
    // platform admins for cross-org support/QA. BdrGuard only fires for role === 'bdr',
    // so these users could always reach the routes directly \u2014 making the entries
    // visible just removes the "where do I click" friction.
    { label: 'XDR', show: isAEOpsManager, items: [
      { to: '/bdr/submit',   iconKey: 'bdr_submit', label: 'Submit a Lead', show: true },
      { to: '/bdr/my-leads', iconKey: 'bdr_leads',  label: 'BDR Leads',     show: true },
    ]},
    { label: 'Super Admin', show: isPlatformAdmin, items: [
      { to: '/admin', icon: '\u2691', label: 'Organizations', show: true },
      { to: '/admin/invitations', icon: '\u2709', label: 'Invitations', show: true },
      { to: '/admin/feedback', icon: '\u2690', label: 'Feedback', show: true },
      { to: '/admin/extraction-definitions', icon: '\u2261', label: 'AI Rules', show: true },
    ]},
  ]

  // Pilot AE sidebar: just Deals (Pipeline). The Deal Room is reached by clicking
  // into a deal — DealDetail then hides every other tab. No Settings — pilot users
  // get a single-purpose Deal Room surface.
  const dealRoomOnlySections = [
    { label: 'Workspace', items: [
      { to: '/', icon: '▦', label: 'Deals', show: true },
    ]},
  ]

  const sections = isDealRoomOnly ? dealRoomOnlySections : (isBdr ? bdrSections : fullSections)

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
        {/* Logo — BDRs land on My Leads, everyone else on Pipeline */}
        <div
          onClick={() => navigate(isBdr ? '/bdr/my-leads' : '/')}
          style={{
            padding: sidebarExpanded ? '16px 16px' : '16px 14px',
            borderBottom: '1px solid #1a1f2e',
            display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
            whiteSpace: 'nowrap', overflow: 'hidden',
          }}
        >
          {org?.icon_url ? (
            <img src={org.icon_url} alt={org?.name || ''}
              style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'contain', flexShrink: 0, background: 'transparent' }} />
          ) : (
            <div style={{
              width: 28, height: 28, borderRadius: 6, background: T.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 800, fontSize: 13, color: '#fff', flexShrink: 0,
            }}>
              {(org?.name || 'L').charAt(0).toUpperCase()}
            </div>
          )}
          {sidebarExpanded && <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>{org?.name || 'Lumen'}</span>}
        </div>

        {/* Nav sections */}
        <div style={{ flex: 1, padding: '12px 8px' }}>
          {sections.filter(s => s.show !== false).map(section => {
            const items = section.items.filter(i => i.show !== false)
            if (!items.length) return null
            const hasHeader = sidebarExpanded && section.label !== 'Workspace'
            // Only labelled sections collapse. When the sidebar is in icon-only
            // mode (hover-collapsed) we ignore the collapsed flag — there's no
            // header to click anyway, so items always render.
            const isCollapsed = hasHeader && !!collapsedSections[section.label]
            return (
              <div key={section.label} style={{ marginBottom: 8 }}>
                {hasHeader && (
                  <button
                    type="button"
                    onClick={() => toggleSection(section.label)}
                    title={isCollapsed ? `Expand ${section.label}` : `Collapse ${section.label}`}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 16px 4px',
                      background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                      fontSize: 9, fontWeight: 700, color: '#556677',
                      textTransform: 'uppercase', letterSpacing: '0.08em', userSelect: 'none',
                    }}
                  >
                    <span>{section.label}</span>
                    <span style={{
                      display: 'inline-block', transition: 'transform 0.15s',
                      transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                      fontSize: 10, color: '#556677',
                    }} aria-hidden>▾</span>
                  </button>
                )}
                {!isCollapsed && items.map(item => (
                  <NavLink key={item.to} to={item.to} end title={!sidebarExpanded ? item.label : undefined}
                    style={({ isActive }) => ({
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 16px', borderRadius: 8, textDecoration: 'none', margin: '2px 0',
                      fontSize: 13, fontWeight: isActive ? 700 : 500,
                      background: isActive ? 'rgba(93,173,226,0.1)' : 'transparent',
                      color: isActive ? '#5DADE2' : '#8899aa',
                      whiteSpace: 'nowrap', overflow: 'hidden', transition: 'all 0.15s',
                    })}>
                    <span style={{ width: 24, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {item.iconKey ? <NavIcon k={item.iconKey} /> : item.icon}
                    </span>
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
                {!isDealRoomOnly && <button onClick={() => { navigate('/settings'); setShowUserMenu(false) }} style={{
                  display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left',
                  background: 'none', border: 'none', borderRadius: 4, cursor: 'pointer',
                  fontSize: 12, color: '#ccc', fontFamily: T.font,
                }} onMouseEnter={e => e.currentTarget.style.background = '#252a3a'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>Settings</button>}
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
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', width: '100%', position: 'relative' }}>
        {/* Floating notification bell — top-right of main content. Hidden for
            dealroom_only pilot AEs (no /notifications surface). */}
        {!isDealRoomOnly && (
          <div style={{ position: 'fixed', top: 14, right: 22, zIndex: 50 }}>
            <NotificationBell />
          </div>
        )}
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
      {/* Beta users get a feedback-only floating button (writes to beta_feedback table)
          in place of the full Lumen chat — chat in the beta is exclusively for
          collecting product feedback, not for AI coaching. */}
      {isDealRoomOnly ? <BetaFeedbackButton /> : <GlobalChatbot />}
    </div>
  )
}
