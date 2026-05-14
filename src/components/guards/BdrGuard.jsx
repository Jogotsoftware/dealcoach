import { Navigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'

// BdrGuard — wraps non-BDR routes to redirect role='bdr' users to /bdr/my-leads.
// Belt-and-suspenders for RLS: RLS would already make page content empty for BDRs,
// but a route-layer 403/redirect keeps the "what stops a BDR from seeing X" answer
// clean during demos and aligns with Sage IT security posture.
//
// Usage: wrap any route element that BDR users should never reach.
//   <BdrGuard><AdminConsole /></BdrGuard>
//
// While profile is still loading, render nothing (caller may show a spinner higher up).
export default function BdrGuard({ children }) {
  const { profile, loading } = useAuth()
  if (loading) return null
  if (profile?.role === 'bdr') return <Navigate to="/bdr/my-leads" replace />
  return children
}
