import { useState, useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../Shared'

// /sc/** is for SCs (profiles.role='sc'), ops roles who preview/QA it
// (admin, system_admin, manager), and super-admins (platform_admins). Plain
// AEs (role='rep') and BDRs bounce home. Server-side RLS is the canonical
// boundary; this is the route-layer gate.
const OPS_ROLES = ['sc', 'admin', 'system_admin', 'manager']
export default function RequireSC() {
  const { profile, loading } = useAuth()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)

  const allowedByRole = OPS_ROLES.includes(profile?.role)
  useEffect(() => {
    if (!profile?.id) { setIsPlatformAdmin(false); return }
    if (allowedByRole) { setIsPlatformAdmin(false); return } // no lookup needed
    supabase.from('platform_admins').select('user_id').eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setIsPlatformAdmin(!!data))
  }, [profile?.id, profile?.role, allowedByRole])

  if (loading || isPlatformAdmin === null) return <Spinner />
  if (allowedByRole || isPlatformAdmin) return <Outlet />
  return <Navigate to="/" replace />
}
