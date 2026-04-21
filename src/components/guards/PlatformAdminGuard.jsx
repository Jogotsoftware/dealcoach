import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Spinner } from '../Shared'

export default function PlatformAdminGuard({ children }) {
  const { profile } = useAuth()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)

  useEffect(() => {
    if (!profile?.id) return
    supabase.from('platform_admins').select('id').eq('user_id', profile.id).single()
      .then(({ data }) => setIsPlatformAdmin(!!data))
  }, [profile?.id])

  if (isPlatformAdmin === null) return <Spinner />
  if (!isPlatformAdmin) return <Navigate to="/" replace />
  return children
}
