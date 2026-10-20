import { setResponseHeader } from 'h3'
import { z } from 'zod'
import { identifierSchema } from '../../../shared/contracts'
import { configurationHandler, readQuery, requireSubject, tenantOf } from '../../internal/http'
import { readConfigurationForViewer } from '../../utils/configuration-server'

const querySchema = z.strictObject({ groupId: identifierSchema.optional(), scope: z.literal('account', { error: 'unknown-scope' }).optional() })

/**
 * GET /api/configuration[?groupId=|?scope=account] — what the signed-in
 * viewer may read for the request's tenant, one of its groups, or their own
 * account (docs/contracts.md §5).
 */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const { groupId, scope } = readQuery(event, querySchema)
  setResponseHeader(event, 'cache-control', 'private, no-store')
  return readConfigurationForViewer({ subject, tenantId: await tenantOf(event), groupId, account: scope === 'account' })
})
