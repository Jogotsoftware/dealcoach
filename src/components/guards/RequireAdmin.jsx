import { Navigate, Outlet } from 'react-router-dom'
import { useOrg } from '../../contexts/OrgContext'
import { Spinner } from '../Shared'

export default function RequireAdmin() {
  const { isAdmin, loading } = useOrg()
  if (loading) return <Spinner />
  if (!isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}
