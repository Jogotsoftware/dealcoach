import { useState, useEffect } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../Shared'

// /sc/** is for SCs (profiles.role='sc') and super-admins (platform_admins)
// only. AEs and everyone else bounce home. Server-side RLS is the canonical
// boundary; this is the route-layer gate.
export default function RequireSC() {
  const { profile, loading } = useAuth()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)

  useEffect(() => {
    if (!profile?.id) { setIsPlatformAdmin(false); return }
    if (profile.role === 'sc') { setIsPlatformAdmin(false); return } // no lookup needed
    supabase.from('platform_admins').select('user_id').eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setIsPlatformAdmin(!!data))
  }, [profile?.id, profile?.role])

  if (loading || isPlatformAdmin === null) return <Spinner />
  if (profile?.role === 'sc' || isPlatformAdmin) return <Outlet />
  return <Navigate to="/" replace />
}
