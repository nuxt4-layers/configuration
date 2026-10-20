import { z } from 'zod'
import type { ConfigurationChangeTarget } from '../../shared/contracts'
import { ConfigurationFailure, identifierSchema } from '../../shared/contracts'

/**
 * PRIVATE. A scope named in a query: `?scope=platform`,
 * `?scope=tenant&governingGroupId=…` (the tenant is the request's, from its
 * host name; on the platform's own host name, `&tenantId=…` names it) or
 * `?scope=group&groupId=…`, or `?scope=account` (always the subject's own).
 */
export const scopeQuerySchema = z.strictObject({
  scope: z.enum(['platform', 'tenant', 'group', 'account'], { error: 'unknown-scope' }),
  groupId: identifierSchema.optional(),
  governingGroupId: identifierSchema.optional(),
  tenantId: identifierSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export function targetFromQuery(query: z.infer<typeof scopeQuerySchema>, tenantId: string | null): ConfigurationChangeTarget {
  if (query.scope === 'platform') return { scope: 'platform' }
  if (query.scope === 'account') return { scope: 'account' }
  if (query.scope === 'group') {
    if (!query.groupId) throw new ConfigurationFailure('validation-failed', 'group-missing')
    return { scope: 'group', groupId: query.groupId }
  }
  if (!query.governingGroupId) throw new ConfigurationFailure('validation-failed', 'governing-group-missing')
  // A tenant's host names its tenant; only the platform's own host takes one from the query.
  const named = tenantId ?? query.tenantId
  if (!named || (tenantId !== null && query.tenantId !== undefined && query.tenantId !== tenantId)) throw new ConfigurationFailure('forbidden')
  return { scope: 'tenant', tenantId: named, governingGroupId: query.governingGroupId }
}
