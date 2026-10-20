import { setResponseHeader } from 'h3'
import { z } from 'zod'
import { identifierSchema } from '../../../shared/contracts'
import { configurationHandler, readQuery, requireSubject, tenantOf } from '../../internal/http'
import { readConfigurationForViewer } from '../../utils/configuration-server'

const querySchema = z.strictObject({ groupId: identifierSchema.optional() })

/**
 * GET /api/configuration[?groupId=] — what the signed-in viewer may read for
 * the request's tenant, or for one of its groups (docs/contracts.md §5).
 */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const { groupId } = readQuery(event, querySchema)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return readConfigurationForViewer({ subject, tenantId: await tenantOf(event), groupId })
})
