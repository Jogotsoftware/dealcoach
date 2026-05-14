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
    if (!profile?.org_id) { setLoading(false); return }
    setLoading(true)
    try {
      const [orgRes, creditsRes, modulesRes] = await Promise.all([
        supabase.from('organizations').select('*, plans(*)').eq('id', profile.org_id).single(),
        supabase.from('org_credits').select('*').eq('org_id', profile.org_id).single(),
        supabase.rpc('resolve_org_modules', { p_org_id: profile.org_id }),
      ])
      if (orgRes.data) {
        setOrg(orgRes.data)
        setPlan(orgRes.data.plans || null)
      }
      setCredits(creditsRes.data || null)
      // resolve_org_modules can return either an array of {module_key, enabled}
      // rows OR (when the RPC errors) null. Fall back to the plan's modules
      // array OR the org's modules_override (jsonb — may be array OR
      // {slug: bool} object). Normalize all shapes to a Set of slug strings.
      const moduleRows = modulesRes?.data
      if (Array.isArray(moduleRows)) {
        setEnabledModuleKeys(new Set(moduleRows.filter(m => m.enabled).map(m => m.module_key)))
      } else {
        const override = orgRes.data?.modules_override
        let slugs = []
        if (Array.isArray(override)) {
          slugs = override
        } else if (override && typeof override === 'object') {
          slugs = Object.entries(override).filter(([, v]) => v === true || v === 'true').map(([k]) => k)
        } else if (Array.isArray(orgRes.data?.plans?.modules)) {
          slugs = orgRes.data.plans.modules
        }
        setEnabledModuleKeys(new Set(slugs))
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
  // v21 Lux web search: org kill switch (default true if column missing/null).
  const allowChatWebSearch = org ? org.allow_chat_web_search !== false : true
  // v22 Lux reports: org kill switch (default FALSE — opt-in only while quality
  // issues are unresolved).
  const enableChatReports = org ? org.enable_chat_reports === true : false

  return (
    <OrgContext.Provider value={{
      user: profile, org, plan, credits,
      isAdmin, isSystemAdmin, hasModule, isTrialing,
      fyEndMonth, fyEndDay,
      allowChatWebSearch,
      enableChatReports,
      refreshOrg: loadOrg, loading,
    }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
