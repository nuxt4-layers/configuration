import { setResponseHeader } from 'h3'
import { configurationHandler, identifierParam, requireSubject, tenantOf } from '../../../internal/http'
import { getConfigurationChanges } from '../../../utils/configuration-server'

/** GET /api/configuration/changes/:changeId — one change, for its requester, those who may decide it and viewers of its scope. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return getConfigurationChanges().get({ subject, changeId: identifierParam(event, 'changeId'), tenantId: await tenantOf(event) })
})
