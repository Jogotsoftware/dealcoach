import { useOrg } from '../contexts/OrgContext'

export function useModuleGate(moduleKey) {
  const { plan, hasModule, loading } = useOrg()
  return {
    hasAccess: hasModule(moduleKey),
    moduleName: moduleKey,
    planName: plan?.name,
    isLoading: loading,
  }
}
