import type { ConfigurationAdminScope } from './useConfigurationAdministration'

const IDENTIFIER = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The scope the route's query names, or `null` when it names none (or not a valid one). */
export function useConfigurationAdminScope() {
  const route = useRoute()
  return computed<ConfigurationAdminScope | null>(() => {
    const value = (name: string) => typeof route.query[name] === 'string' ? route.query[name] as string : ''
    const scope = value('scope')
    if (scope === 'platform') return { scope: 'platform' }
    if (scope === 'group' && IDENTIFIER.test(value('groupId'))) return { scope: 'group', groupId: value('groupId') }
    if (scope === 'tenant' && IDENTIFIER.test(value('governingGroupId'))) {
      // On the platform's own host name the tenant is named; a tenant's host names its own.
      return { scope: 'tenant', governingGroupId: value('governingGroupId'), ...(IDENTIFIER.test(value('tenantId')) ? { tenantId: value('tenantId') } : {}) }
    }
    return null
  })
}
