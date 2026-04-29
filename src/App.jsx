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
import NotificationsPage from './pages/Notifications'
import CallDetail from './pages/CallDetail'
import CoachAdmin from './pages/CoachAdmin'
import Settings from './pages/Settings'
import AdminConsole from './pages/AdminConsole'
import AcceptInvite from './pages/AcceptInvite'
import TeamManagement from './pages/settings/TeamManagement'
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
import PlatformAdminGuard from './components/guards/PlatformAdminGuard'
import { theme as T } from './lib/theme'

function AppLoadingSkeleton() {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', background: '#fff',
      fontFamily: T.font,
    }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: T.text,
        marginBottom: 24, letterSpacing: '-0.02em' }}>
        Revenue Instruments
      </div>
      <div style={{ width: 200, height: 3, background: T.border,
        borderRadius: 2, overflow: 'hidden' }}>
        <div style={{
          width: '40%', height: '100%', background: T.primary,
          borderRadius: 2,
          animation: 'shimmer 1.4s ease-in-out infinite',
          transformOrigin: 'left',
        }} />
      </div>
    </div>
  )
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <AppLoadingSkeleton />
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

export default function App() {
  return (
    <AuthProvider>
      <OrgProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/msp/shared/:token" element={<MSPClientPortal />} />
            <Route path="/room/:shareToken" element={<DealRoomViewer />} />
            <Route path="/invite/:token" element={<AcceptInvite />} />

            {/* Onboarding — authenticated but no org */}
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

            {/* Protected routes requiring org — inside Layout (sidebar) */}
            <Route element={<ProtectedRoute><RequireOrg /></ProtectedRoute>}>
              <Route element={<Layout />}>
                <Route path="/" element={<ErrorBoundary label="the pipeline"><Pipeline /></ErrorBoundary>} />
                <Route path="/deal/new" element={<ErrorBoundary label="new deal"><NewDeal /></ErrorBoundary>} />
                <Route path="/deal/:id" element={<ErrorBoundary label="this deal"><DealDetail /></ErrorBoundary>} />
                <Route path="/deal/:dealId/call/:conversationId" element={<ErrorBoundary label="this call"><CallDetail /></ErrorBoundary>} />
                <Route path="/deal/:dealId/msp" element={<ErrorBoundary label="the MSP"><MSPPage /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quotes" element={<ErrorBoundary label="quotes"><QuotesList /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quote/:quoteId" element={<ErrorBoundary label="quote builder"><QuoteBuilder /></ErrorBoundary>} />
                <Route path="/deal/:dealId/quote/:quoteId/proposal" element={<ErrorBoundary label="proposal preview"><ProposalRenderer /></ErrorBoundary>} />
                <Route path="/deal/:dealId/room" element={<ErrorBoundary label="deal room"><DealRoomConfig /></ErrorBoundary>} />
                <Route path="/notifications" element={<ErrorBoundary label="notifications"><NotificationsPage /></ErrorBoundary>} />
                <Route path="/coach" element={<ErrorBoundary label="coach admin"><CoachAdmin /></ErrorBoundary>} />
                <Route path="/coach/builder" element={<ErrorBoundary label="coach builder"><CoachBuilder /></ErrorBoundary>} />
                <Route path="/reports" element={<ErrorBoundary label="reports"><Reports /></ErrorBoundary>} />
                <Route path="/dashboards" element={<ErrorBoundary label="dashboards"><Dashboards /></ErrorBoundary>} />
                <Route path="/dashboards/:dashboardId" element={<ErrorBoundary label="this dashboard"><Dashboards /></ErrorBoundary>} />
                <Route path="/deal/:id/retrospective" element={<ErrorBoundary label="retrospective"><DealRetrospective /></ErrorBoundary>} />
                <Route path="/settings" element={<ErrorBoundary label="settings"><Settings /></ErrorBoundary>} />
                <Route path="/admin" element={<ErrorBoundary label="admin console"><AdminConsole /></ErrorBoundary>} />
                <Route path="/settings/team" element={<ErrorBoundary label="team"><TeamManagement /></ErrorBoundary>} />

                {/* Admin-only settings */}
                <Route element={<RequireAdmin />}>
                  <Route path="/settings/organization" element={<ErrorBoundary label="org settings"><OrgSettings /></ErrorBoundary>} />
                  <Route path="/admin/widgets" element={<ErrorBoundary label="widget builder"><WidgetBuilder /></ErrorBoundary>} />
                  <Route path="/admin/feedback" element={<ErrorBoundary label="feedback"><BetaFeedbackAdmin /></ErrorBoundary>} />
                  <Route path="/admin/invitations" element={<ErrorBoundary label="invitations"><InvitationsAdmin /></ErrorBoundary>} />
                  <Route path="/admin/orgs/:orgId" element={<ErrorBoundary label="this org"><OrgDetail /></ErrorBoundary>} />
                  <Route path="/admin/extraction-definitions" element={<ErrorBoundary label="AI rules"><ExtractionDefinitions /></ErrorBoundary>} />
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
