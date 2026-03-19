import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './hooks/useAuth'
import Layout from './components/Layout'
import Login from './pages/Login'
import Pipeline from './pages/Pipeline'
import NewDeal from './pages/NewDeal'
import DealDetail from './pages/DealDetail'
import MSPPage from './pages/MSPPage'
import MSPClientPortal from './pages/MSPClientPortal'
import QuoteEditor from './pages/QuoteEditor'
import ProposalBuilder from './pages/ProposalBuilder'
import CoachAdmin from './pages/CoachAdmin'
import Settings from './pages/Settings'
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
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
          <Route path="/msp/shared/:token" element={<MSPClientPortal />} />

          {/* Protected routes inside Layout (sidebar) */}
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Pipeline />} />
            <Route path="/deal/new" element={<NewDeal />} />
            <Route path="/deal/:id" element={<DealDetail />} />
            <Route path="/deal/:dealId/msp" element={<MSPPage />} />
            <Route path="/deal/:dealId/quote/new" element={<QuoteEditor />} />
            <Route path="/deal/:dealId/quote/:quoteId" element={<QuoteEditor />} />
            <Route path="/deal/:dealId/proposal" element={<ProposalBuilder />} />
            <Route path="/coach" element={<CoachAdmin />} />
            <Route path="/settings" element={<Settings />} />
          </Route>

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
