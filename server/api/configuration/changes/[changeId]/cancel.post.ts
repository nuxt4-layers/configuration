import { configurationHandler, correlationOf, identifierParam, requireSubject, tenantOf } from '../../../../internal/http'
import { getConfigurationChanges } from '../../../../utils/configuration-server'

/** POST /api/configuration/changes/:changeId/cancel — the requester cancels an open change. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  return getConfigurationChanges().cancel({ subject, changeId: identifierParam(event, 'changeId'), correlationId: correlationOf(event), tenantId: await tenantOf(event) })
})
