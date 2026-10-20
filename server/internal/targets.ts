import { z } from 'zod'
import type { ConfigurationChangeTarget } from '../../shared/contracts'
import { ConfigurationFailure, identifierSchema } from '../../shared/contracts'

/**
 * PRIVATE. A scope named in a query: `?scope=platform`,
 * `?scope=tenant&governingGroupId=…` (the tenant is the request's, from its
 * host name) or `?scope=group&groupId=…`.
 */
export const scopeQuerySchema = z.strictObject({
  scope: z.enum(['platform', 'tenant', 'group'], { error: 'unknown-scope' }),
  groupId: identifierSchema.optional(),
  governingGroupId: identifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export function targetFromQuery(query: z.infer<typeof scopeQuerySchema>, tenantId: string | null): ConfigurationChangeTarget {
  if (query.scope === 'platform') return { scope: 'platform' }
  if (query.scope === 'group') {
    if (!query.groupId) throw new ConfigurationFailure('validation-failed', 'group-missing')
    return { scope: 'group', groupId: query.groupId }
  }
  if (!query.governingGroupId) throw new ConfigurationFailure('validation-failed', 'governing-group-missing')
  if (!tenantId) throw new ConfigurationFailure('forbidden')
  return { scope: 'tenant', tenantId, governingGroupId: query.governingGroupId }
}
