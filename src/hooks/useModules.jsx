import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useModules() {
  const { user } = useAuth()
  const [modules, setModules] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) { setModules([]); setLoading(false); return }
    let cancelled = false
    supabase.rpc('resolve_user_modules', { p_user_id: user.id }).then(({ data, error }) => {
      if (cancelled) return
      if (error || !Array.isArray(data)) {
        // Fallback: load from plan modules via org
        supabase.from('profiles').select('org_id').eq('id', user.id).single().then(async ({ data: prof }) => {
          if (cancelled || !prof?.org_id) { setModules([]); setLoading(false); return }
          const { data: org } = await supabase.from('organizations').select('plan_id, modules_override, plans(modules)').eq('id', prof.org_id).single()
          if (cancelled) return
          setModules(org?.modules_override || org?.plans?.modules || [])
          setLoading(false)
        })
      } else {
        setModules(data)
        setLoading(false)
      }
    })
    return () => { cancelled = true }
  }, [user?.id])

  function hasModule(key) {
    if (modules === null) return false
    return modules.includes(key)
  }

  return { modules, hasModule, loading }
}
