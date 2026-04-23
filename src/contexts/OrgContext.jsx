import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const OrgContext = createContext({})

export function OrgProvider({ children }) {
  const { user, profile } = useAuth()
  const [org, setOrg] = useState(null)
  const [plan, setPlan] = useState(null)
  const [credits, setCredits] = useState(null)
  const [enabledModuleKeys, setEnabledModuleKeys] = useState(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!profile) { setLoading(false); return }
    if (!profile.org_id) { setLoading(false); return }
    loadOrg()
  }, [profile?.id, profile?.org_id])

  async function loadOrg() {
    setLoading(true)
    try {
      const [orgRes, creditsRes] = await Promise.all([
        supabase.from('organizations').select('*, plans(*)').eq('id', profile.org_id).single(),
        supabase.from('org_credits').select('*').eq('org_id', profile.org_id).single(),
      ])
      if (orgRes.data) {
        setOrg(orgRes.data)
        setPlan(orgRes.data.plans || null)
      }
      setCredits(creditsRes.data || null)

      // Load resolved module access via RPC (respects plan + overrides)
      if (profile.org_id) {
        const { data: moduleRows } = await supabase.rpc('resolve_org_modules', { p_org_id: profile.org_id })
        if (moduleRows) {
          setEnabledModuleKeys(new Set(moduleRows.filter(m => m.enabled).map(m => m.module_key)))
        } else {
          // Fallback to plan modules if RPC not available
          setEnabledModuleKeys(new Set(orgRes.data?.plans?.modules || []))
        }
      }
    } catch (err) {
      console.error('Error loading org:', err)
    } finally {
      setLoading(false)
    }
  }

  const isAdmin = profile?.role === 'admin' || profile?.role === 'system_admin'
  const isSystemAdmin = profile?.role === 'system_admin'
  const hasModule = (key) => enabledModuleKeys.has(key)
  const isTrialing = org?.trial_ends_at && new Date(org.trial_ends_at) > new Date()
  const fyEndMonth = org?.fiscal_year_end_month ?? 12
  const fyEndDay = org?.fiscal_year_end_day ?? 31

  return (
    <OrgContext.Provider value={{
      user: profile, org, plan, credits,
      isAdmin, isSystemAdmin, hasModule, isTrialing,
      fyEndMonth, fyEndDay,
      refreshOrg: loadOrg, loading,
    }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
