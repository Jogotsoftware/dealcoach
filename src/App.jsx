import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { OrgProvider } from './contexts/OrgContext'
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
import QuoteEditor from './pages/QuoteEditor'
import ProposalBuilder from './pages/ProposalBuilder'
import CallDetail from './pages/CallDetail'
import CoachAdmin from './pages/CoachAdmin'
import Settings from './pages/Settings'
import AdminConsole from './pages/AdminConsole'
import AcceptInvite from './pages/AcceptInvite'
import TeamManagement from './pages/settings/TeamManagement'
import OrgSettings from './pages/settings/OrgSettings'
import { Spinner } from './components/Shared'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  return children
}

function PublicRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
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
            <Route path="/invite/:token" element={<AcceptInvite />} />

            {/* Onboarding — authenticated but no org */}
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

            {/* Protected routes requiring org — inside Layout (sidebar) */}
            <Route element={<ProtectedRoute><RequireOrg /></ProtectedRoute>}>
              <Route element={<Layout />}>
                <Route path="/" element={<Pipeline />} />
                <Route path="/deal/new" element={<NewDeal />} />
                <Route path="/deal/:id" element={<DealDetail />} />
                <Route path="/deal/:dealId/call/:conversationId" element={<CallDetail />} />
                <Route path="/deal/:dealId/msp" element={<MSPPage />} />
                <Route path="/deal/:dealId/quote/new" element={<QuoteEditor />} />
                <Route path="/deal/:dealId/quote/:quoteId" element={<QuoteEditor />} />
                <Route path="/deal/:dealId/proposal" element={<ProposalBuilder />} />
                <Route path="/coach" element={<CoachAdmin />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/admin" element={<AdminConsole />} />

                {/* Admin-only settings */}
                <Route element={<RequireAdmin />}>
                  <Route path="/settings/team" element={<TeamManagement />} />
                  <Route path="/settings/organization" element={<OrgSettings />} />
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
