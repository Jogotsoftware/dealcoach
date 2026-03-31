import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

export function useModules() {
  const { profile } = useAuth()
  const [modules, setModules] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile?.org_id) {
      setLoading(false)
      return
    }
    supabase.from('organizations').select('plan_id').eq('id', profile.org_id).single()
      .then(async ({ data: org }) => {
        if (org?.plan_id) {
          const { data: plan } = await supabase.from('plans').select('modules').eq('id', org.plan_id).single()
          setModules(plan?.modules || [])
        }
        setLoading(false)
      })
  }, [profile?.org_id])

  const hasModule = (slug) => modules.includes(slug)
  return { modules, hasModule, loading }
}
