import { setResponseHeader } from 'h3'
import { configurationHandler, readQuery, requireSubject, tenantOf } from '../../internal/http'
import { scopeQuerySchema, targetFromQuery } from '../../internal/targets'
import { listConfigurationHistory } from '../../utils/configuration-server'

/** GET /api/configuration/history?scope=… — what applied changes did at a scope, newest first. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const query = readQuery(event, scopeQuerySchema)
  const tenantId = await tenantOf(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return listConfigurationHistory({ subject, target: targetFromQuery(query, tenantId), tenantId, limit: query.limit })
})
