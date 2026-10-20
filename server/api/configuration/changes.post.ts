import { setResponseStatus } from 'h3'
import { configurationChangeRequestSchema } from '../../../shared/contracts'
import { configurationHandler, correlationOf, readJson, requireSubject, requireTargetInTenant, tenantOf } from '../../internal/http'
import { getConfigurationChanges } from '../../utils/configuration-server'

/** POST /api/configuration/changes — requests a change; it applies at once when no approver is needed. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const request = await readJson(event, configurationChangeRequestSchema)
  const tenantId = await tenantOf(event)
  requireTargetInTenant(request.target, tenantId)
  const change = await getConfigurationChanges().request({ subject, request, correlationId: correlationOf(event), tenantId })
  setResponseStatus(event, change.status === 'applied' ? 200 : 202)
  return change
})
