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
  // Demo-org gate — the v22/v23 Lux chat features (web search pill,
  // Correct-this affordance, auto-focus card UI) only render for users in
  // demo orgs. Other orgs see the baseline chat surface.
  //   0acebff8 = Intacct - Direct - NA
  //   c8a7ea52 = Sage Intacct — Demo
  const DEMO_ORG_IDS = new Set([
    '0acebff8-8827-4984-b478-cbcad404539d',
    'c8a7ea52-42b8-4b66-9d38-91c9b1dda883',
  ])
  const isDemoOrg = !!org?.id && DEMO_ORG_IDS.has(org.id)
  // Sage Intacct demo specifically (Melanie's environment). Used for sidebar
  // simplifications that should NOT apply to Intacct - Direct - NA. The
  // generic isDemoOrg flag stays inclusive of both for chat-feature gates.
  const SAGE_DEMO_ORG_ID = 'c8a7ea52-42b8-4b66-9d38-91c9b1dda883'
  const isSageDemo = org?.id === SAGE_DEMO_ORG_ID
  // Per-org performance benchmarks (head of sales sets these on /my-goals).
  // Always returns an object; empty {} if not yet configured. Dashboard tiles
  // call benchmarks.win_rate ?? FALLBACK_DEFAULT to avoid undefined math.
  const benchmarks = org?.benchmarks && typeof org.benchmarks === 'object' ? org.benchmarks : {}

  return (
    <OrgContext.Provider value={{
      user: profile, org, plan, credits,
      isAdmin, isSystemAdmin, hasModule, isTrialing,
      fyEndMonth, fyEndDay,
      allowChatWebSearch,
      enableChatReports,
      isDemoOrg,
      isSageDemo,
      benchmarks,
      refreshOrg: loadOrg, loading,
    }}>
      {children}
    </OrgContext.Provider>
  )
}

export function useOrg() {
  return useContext(OrgContext)
}
