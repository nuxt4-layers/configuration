import { setResponseHeader } from 'h3'
import { configurationHandler, readQuery, requireSubject, tenantOf } from '../../internal/http'
import { scopeQuerySchema, targetFromQuery } from '../../internal/targets'
import { getConfigurationChanges } from '../../utils/configuration-server'

/** GET /api/configuration/admin?scope=… — a scope's values, their digests, the values in force and open changes, for editing. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const target = targetFromQuery(readQuery(event, scopeQuerySchema), await tenantOf(event))
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return getConfigurationChanges().readScope({ subject, target, tenantId: await tenantOf(event) })
})
