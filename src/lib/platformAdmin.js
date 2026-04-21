import { supabase } from './supabase'

export async function checkIsPlatformAdmin(userId) {
  if (!userId) return false
  const { data } = await supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle()
  return !!data
}

export async function getOrgModules(orgId) {
  const { data, error } = await supabase.rpc('get_org_modules', { p_org_id: orgId })
  if (error) throw error
  return data
}

export async function setOrgModuleAccess(orgId, moduleId, enabled, note = null, expiresAt = null) {
  const { data, error } = await supabase.rpc('set_org_module_access', {
    p_org_id: orgId, p_module_id: moduleId, p_enabled: enabled, p_note: note, p_expires_at: expiresAt,
  })
  if (error) throw error
  return data
}

export async function grantOrgCredits(orgId, amount, description = null) {
  const { data, error } = await supabase.rpc('grant_org_credits', {
    p_org_id: orgId, p_amount: amount, p_description: description,
  })
  if (error) throw error
  return data
}

export async function setOrgPlan(orgId, planId) {
  const { data, error } = await supabase.rpc('set_org_plan', { p_org_id: orgId, p_plan_id: planId })
  if (error) throw error
  return data
}

export async function setUserRole(userId, role) {
  const { data, error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role })
  if (error) throw error
  return data
}
