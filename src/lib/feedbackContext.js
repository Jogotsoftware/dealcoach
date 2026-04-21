// Beta Feedback — auto-detection helpers

export function detectFeatureArea(pathname) {
  if (pathname === '/') return 'pipeline'
  if (pathname === '/login') return 'login'
  if (pathname === '/onboarding') return 'onboarding'
  if (pathname.startsWith('/invite/')) return 'invite_accept'
  if (pathname === '/deal/new') return 'deal_new'
  if (pathname.match(/^\/deal\/[^/]+$/)) return 'deal_overview'
  if (pathname.match(/^\/deal\/[^/]+\/msp/)) return 'msp_builder'
  if (pathname.match(/^\/deal\/[^/]+\/quote/)) return 'quote_editor'
  if (pathname.match(/^\/deal\/[^/]+\/proposal/)) return 'proposal_builder'
  if (pathname.match(/^\/deal\/[^/]+\/call/)) return 'call_detail'
  if (pathname === '/coach') return 'coach_admin'
  if (pathname === '/settings') return 'settings'
  if (pathname === '/settings/team') return 'team_management'
  if (pathname === '/settings/org') return 'org_settings'
  if (pathname === '/admin') return 'admin_console'
  if (pathname === '/admin/feedback') return 'admin_feedback'
  if (pathname.startsWith('/widgets')) return 'widget_builder'
  if (pathname.startsWith('/msp/shared/')) return 'msp_client_portal'
  if (pathname.startsWith('/partner')) return 'partner_hub'
  return 'other'
}

export function humanizePagePath(pathname) {
  const labels = {
    pipeline: 'Pipeline',
    deal_new: 'New Deal',
    deal_overview: 'Deal Detail',
    msp_builder: 'MSP Builder',
    quote_editor: 'Quote Editor',
    proposal_builder: 'Proposal Builder',
    call_detail: 'Call Detail',
    coach_admin: 'Coach Admin',
    settings: 'Settings',
    team_management: 'Team Management',
    org_settings: 'Org Settings',
    admin_console: 'Admin Console',
    admin_feedback: 'Admin Feedback',
    widget_builder: 'Widget Builder',
    onboarding: 'Onboarding',
    other: 'Other',
  }
  return labels[detectFeatureArea(pathname)] || 'Other'
}

export function extractContextIds(pathname) {
  const ids = {}
  const dealMatch = pathname.match(/^\/deal\/([0-9a-f-]{36})/)
  if (dealMatch) ids.deal_id = dealMatch[1]
  const callMatch = pathname.match(/\/call\/([0-9a-f-]{36})/)
  if (callMatch) ids.conversation_id = callMatch[1]
  return ids
}

export function captureBrowserInfo() {
  return {
    user_agent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    platform: navigator.platform,
  }
}
