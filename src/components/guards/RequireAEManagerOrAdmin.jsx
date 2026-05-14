import { useEffect, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { supabase } from '../../lib/supabase'
import { theme as T } from '../../lib/theme'

// Gate for /admin/denial-criteria and /admin/routing. Allows:
//   - role='admin' or 'system_admin' or 'manager' (the AE manager bucket)
//   - OR membership in platform_admins
// Mirrors is_ae_manager(uuid) OR is_platform_admin() — frontend layer, RLS enforces
// server-side regardless.
export default function RequireAEManagerOrAdmin({ children }) {
  const { profile, loading } = useAuth()
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(null)

  useEffect(() => {
    if (!profile?.id) { setIsPlatformAdmin(false); return }
    supabase.from('platform_admins').select('id').eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setIsPlatformAdmin(!!data))
      .catch(() => setIsPlatformAdmin(false))
  }, [profile?.id])

  if (loading || isPlatformAdmin === null) {
    return <div style={{ padding: 40, color: T.textMuted, fontFamily: T.font }}>Loading…</div>
  }

  const roleAllowed = ['admin', 'system_admin', 'manager'].includes(profile?.role)
  if (!roleAllowed && !isPlatformAdmin) {
    return (
      <div style={{ padding: 40, fontFamily: T.font }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: T.text, marginBottom: 8 }}>Access denied</div>
        <div style={{ fontSize: 13, color: T.textMuted }}>
          This page is restricted to AE managers, organization admins, and platform admins.
        </div>
      </div>
    )
  }

  return children
}
