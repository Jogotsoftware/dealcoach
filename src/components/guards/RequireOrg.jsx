import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useOrg } from '../../contexts/OrgContext'
import { Spinner } from '../Shared'
import { theme as T } from '../../lib/theme'

export default function RequireOrg() {
  const { profile, loading: authLoading } = useAuth()
  const { org, loading: orgLoading } = useOrg()

  if (authLoading || orgLoading) return <Spinner />

  if (!profile?.org_id) return <Navigate to="/onboarding" replace />

  if (org?.status === 'suspended' || org?.status === 'cancelled') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: T.font, background: T.bg }}>
        <div style={{ textAlign: 'center', padding: 40, maxWidth: 480 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>!</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text, marginBottom: 8 }}>Account {org.status === 'suspended' ? 'Suspended' : 'Cancelled'}</h1>
          <p style={{ fontSize: 14, color: T.textSecondary, lineHeight: 1.6 }}>
            Your organization's account has been {org.status}. Please contact your administrator or support for assistance.
          </p>
        </div>
      </div>
    )
  }

  return <Outlet />
}
