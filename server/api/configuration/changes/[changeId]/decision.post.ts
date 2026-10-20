import { z } from 'zod'
import { decisionSchema, digestSchema } from '../../../../../shared/contracts'
import { configurationHandler, correlationOf, identifierParam, readJson, requireSubject, tenantOf } from '../../../../internal/http'
import { getConfigurationChanges } from '../../../../utils/configuration-server'

const bodySchema = z.strictObject({ changeDigest: digestSchema, decision: decisionSchema })

/** POST /api/configuration/changes/:changeId/decision — approves or rejects the change the approver was shown. */
export default configurationHandler(async (event) => {
  const subject = await requireSubject(event)
  const { changeDigest, decision } = await readJson(event, bodySchema)
  return getConfigurationChanges().decide({ subject, changeId: identifierParam(event, 'changeId'), changeDigest, decision, correlationId: correlationOf(event), tenantId: await tenantOf(event) })
})
