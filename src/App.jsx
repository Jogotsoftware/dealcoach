import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { OrgProvider, useOrg } from './contexts/OrgContext'
import Layout from './components/Layout'
import RequireOrg from './components/guards/RequireOrg'
import RequireAdmin from './components/guards/RequireAdmin'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Pipeline from './pages/Pipeline'
import NewDeal from './pages/NewDeal'
import DealDetail from './pages/DealDetail'
import MSPPage from './pages/MSPPage'
import MSPClientPortal from './pages/MSPClientPortal'
import QuotesList from './pages/QuotesList'
import QuoteBuilder from './pages/QuoteBuilder'
import ProposalRenderer from './pages/ProposalRenderer'
import DealRoomConfig from './pages/DealRoomConfig'
import DealRoomViewer from './pages/DealRoomViewer'
import DealRoomPreview from './pages/DealRoomPreview'
import NotificationsPage from './pages/Notifications'
import CallDetail from './pages/CallDetail'
import CoachAdmin from './pages/CoachAdmin'
import Settings from './pages/Settings'
import AdminConsole from './pages/AdminConsole'
import AcceptInvite from './pages/AcceptInvite'
import OrgSettings from './pages/settings/OrgSettings'
import WidgetBuilder from './pages/WidgetBuilder'
import Dashboards from './pages/Dashboards'
import ErrorBoundary from './components/ErrorBoundary'
import BetaFeedbackAdmin from './pages/admin/BetaFeedback'
import InvitationsAdmin from './pages/admin/Invitations'
import PlatformAdminDashboard from './pages/admin/PlatformAdminDashboard'
import OrgDetail from './pages/admin/OrgDetail'
import ExtractionDefinitions from './pages/admin/ExtractionDefinitions'
import CoachBuilder from './pages/CoachBuilder'
import Reports from './pages/Reports'
import DealRetrospective from './pages/DealRetrospective'
import ManagerDashboard from './pages/ManagerDashboard'
import MyGoals from './pages/MyGoals'
import BdrSubmit from './pages/bdr/Submit'
import BdrLeadStatus from './pages/bdr/LeadStatus'
import BdrMyLeads from './pages/bdr/MyLeads'
import DenialCriteriaAdmin from './pages/admin/DenialCriteriaAdmin'
import QdcCriteriaAdmin from './pages/admin/QdcCriteriaAdmin'
import RoutingAdmin from './pages/admin/RoutingAdmin'
import RequireAEManagerOrAdmin from './components/guards/RequireAEManagerOrAdmin'
import PlatformAdminGuard from './components/guards/PlatformAdminGuard'
import PathToClosePage from './pages/path/PathToClosePage'
import ConfidencePage from './pages/path/ConfidencePage'
import BarriersListPage from './pages/path/BarriersListPage'
import BarrierDetailPage from './pages/path/BarrierDetailPage'
import GateCriteriaPage from './pages/path/GateCriteriaPage'
import GateDimensionPage from './pages/path/GateDimensionPage'
import LibraryAdmin from './pages/LibraryAdmin'
import DiscoveryPage from './pages/DiscoveryPage'
import { theme as T } from './lib/theme'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  // No loading screen — auth hydration is sub-second and the splash flash
  // looked worse than nothing. Render blank during the brief loading window;
  // on resolve, either the route renders or we redirect.
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return children
}

// Keep the user on their current public page (e.g. Login) while auth AND org
// are hydrating — this eliminates the branded/spinner flashes between sign-in
// and the destination. Only redirect once everything is ready.
function PublicRoute({ children }) {
  const { user, loading: authLoading } = useAuth()
  const { loading: orgLoading } = useOrg()
  if (authLoading || orgLoading) return children
  if (user) return <Navigate to="/" replace />
  return children
}

// Role-aware home route. Priority:
//   1. BDR users → My Leads (Pipeline excludes them via RLS anyway; this avoids the empty-screen confusion).
//   2. Manager role levels → Revenue tab on the manager dashboard.
//   3. Everyone else → the standard Pipeline view.
function HomeRoute() {
  const { profile } = useAuth()
  if (profile?.role === 'bdr') return <Navigate to="/bdr/my-leads" replace />
  if (profile && ['head_of_sales','avp','rvp'].includes(profile.role_level)) {
    return <Navigate to="/revenue" replace />
  }
  return <Pipeline />
}

export default function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/projectplan/shared/:token" element={<MSPClientPortal />} />
            <Route path="/msp/shared/:token" element={<MSPClientPortal />} />
            <Route path="/room/:shareToken" element={<DealRoomViewer />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />

            {/* Onboarding — authenticated but no org */}
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

            {/* Protected routes requiring org — inside Layout (sidebar) */}
            <Route element={<ProtectedRoute><RequireOrg /></ProtectedRoute>}>
              <Route element={<Layout />}>
                <Route path="/" element={<ErrorBoundary label="the pipeline"><HomeRoute /></ErrorBoundary>} />
                {/* Manager dashboard tabs — sidebar nav drives the URL. All five
                    routes render <ManagerDashboard /> which reads location.pathname
                    to pick the active tab. /manager is a legacy alias. */}
                <Route path="/manager"   element={<ErrorBoundary label="manager dashboard"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/revenue"   element={<ErrorBoundary label="revenue"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/pipeline"  element={<ErrorBoundary label="pipeline"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/execution" element={<ErrorBoundary label="execution"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/coaching"  element={<ErrorBoundary label="coaching"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/forecast"  element={<ErrorBoundary label="forecast"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/team"      element={<ErrorBoundary label="team"><ManagerDashboard /></ErrorBoundary>} />
                <Route path="/my-goals"  element={<ErrorBoundary label="my goals"><MyGoals /></ErrorBoundary>} />
                <Route path="/deal/new" element={<ErrorBoundary label="new deal"><NewDeal /></ErrorBoundary>} />
                <Route path="/deal/:id" element={<ErrorBoundary label="this deal"><DealDetail /></ErrorBoundary>} />
                {/* BDR portal — Layout's BDR guard restricts these to BDR users; RLS
                    is the canonical defense server-side. Submit form + status views. */}
                <Route path="/bdr/submit"     element={<ErrorBoundary label="BDR submit"><BdrSubmit /></ErrorBoundary>} />
                <Route path="/bdr/my-leads"   element={<ErrorBoundary label="BDR my leads"><BdrMyLeads /></ErrorBoundary>} />
                <Route path="/bdr/leads/:id"  element={<ErrorBoundary label="BDR lead status"><BdrLeadStatus /></ErrorBoundary>} />
                {/* AE manager admin — denial criteria + routing rules + pools.
                    Guarded at the route layer (admin/manager/system_admin OR platform_admin)
                    and at the RLS layer server-side. */}
                <Route path="/admin/qdc-criteria"    element={<ErrorBoundary label="QDC criteria"><RequireAEManagerOrAdmin><QdcCriteriaAdmin /></RequireAEManagerOrAdmin></ErrorBoundary>} />
                <Route path="/admin/denial-criteria" element={<Navigate to="/admin/qdc-criteria" replace />} />
                <Route path="/admin/routing"         element={<ErrorBoundary label="lead routing"><RequireAEManagerOrAdmin><RoutingAdmin /></RequireAEManagerOrAdmin></ErrorBoundary>} />
                <Route path="/deal/:dealId/call/:conversationId" element={<ErrorBoundary label="this call"><CallDetail /></ErrorBoundary>} />
                <Route path="/deal/:dealId/msp" element={<ErrorBoundary label="the MSP"><MSPPage /></ErrorBoundary>} />
                <Route path="/deal/:dealId/discovery" element={<ErrorBoundary label="discovery"><DiscoveryPage /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quotes" element={<ErrorBoundary label="quotes"><QuotesList /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quote/:quoteId" element={<ErrorBoundary label="quote builder"><QuoteBuilder /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quote/:quoteId/proposal" element={<ErrorBoundary label="proposal preview"><ProposalRenderer /></ErrorBoundary>} />
                <Route path="/deal/:dealId/room" element={<ErrorBoundary label="deal room"><DealRoomConfig /></ErrorBoundary>} />
                <Route path="/deal/:dealId/room/preview" element={<ErrorBoundary label="deal room preview"><DealRoomPreview /></ErrorBoundary>} />
                <Route path="/notifications" element={<ErrorBoundary label="notifications"><NotificationsPage /></ErrorBoundary>} />
                <Route path="/coach" element={<ErrorBoundary label="coach admin"><CoachAdmin /></ErrorBoundary>} />
                <Route path="/coach/builder" element={<ErrorBoundary label="coach builder"><CoachBuilder /></ErrorBoundary>} />
                <Route path="/reports" element={<ErrorBoundary label="reports"><Reports /></ErrorBoundary>} />
                <Route path="/dashboards" element={<ErrorBoundary label="dashboards"><Dashboards /></ErrorBoundary>} />
                <Route path="/dashboards/:dashboardId" element={<ErrorBoundary label="this dashboard"><Dashboards /></ErrorBoundary>} />
                <Route path="/deal/:id/retrospective" element={<ErrorBoundary label="retrospective"><DealRetrospective /></ErrorBoundary>} />
                {/* Path to Close v4 linked-out stub routes (Sage canon) */}
                <Route path="/deal/:id/path" element={<ErrorBoundary label="path to close"><PathToClosePage /></ErrorBoundary>} />
                <Route path="/deal/:id/confidence" element={<ErrorBoundary label="confidence"><ConfidencePage /></ErrorBoundary>} />
                <Route path="/deal/:id/barriers" element={<ErrorBoundary label="barriers"><BarriersListPage /></ErrorBoundary>} />
                <Route path="/deal/:id/barriers/:barrierId" element={<ErrorBoundary label="this barrier"><BarrierDetailPage /></ErrorBoundary>} />
                <Route path="/deal/:id/gate" element={<ErrorBoundary label="gate criteria"><GateCriteriaPage /></ErrorBoundary>} />
                <Route path="/deal/:id/gate/:dimension" element={<ErrorBoundary label="this gate dimension"><GateDimensionPage /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary label="settings"><Settings /></ErrorBoundary>} />
                <Route path="/admin" element={<ErrorBoundary label="admin console"><AdminConsole /></ErrorBoundary>} />
                {/* /settings/team merged into the "My Team" section on /settings — redirect old links. */}
                <Route path="/settings/team" element={<Navigate to="/settings#my_team" replace />} />

                {/* Admin-only settings */}
                <Route element={<RequireAdmin />}>
                  <Route path="/settings/organization" element={<ErrorBoundary label="org settings"><OrgSettings /></ErrorBoundary>} />
                  <Route path="/admin/widgets" element={<ErrorBoundary label="widget builder"><WidgetBuilder /></ErrorBoundary>} />
                  <Route path="/admin/feedback" element={<ErrorBoundary label="feedback"><BetaFeedbackAdmin /></ErrorBoundary>} />
                  <Route path="/admin/invitations" element={<ErrorBoundary label="invitations"><InvitationsAdmin /></ErrorBoundary>} />
                  <Route path="/admin/orgs/:orgId" element={<ErrorBoundary label="this org"><OrgDetail /></ErrorBoundary>} />
                  <Route path="/admin/extraction-definitions" element={<ErrorBoundary label="AI rules"><ExtractionDefinitions /></ErrorBoundary>} />
                  <Route path="/library" element={<ErrorBoundary label="team library"><LibraryAdmin /></ErrorBoundary>} />
                </Route>
              </Route>
            </Route>

            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </OrgProvider>
    </AuthProvider>
  )
}
