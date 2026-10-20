import { createHash } from 'node:crypto'
import { getRequestHeader, setResponseHeaders, setResponseStatus } from 'h3'
import { canonicalJson } from '../../../shared/contracts'
import { configurationHandler, tenantOf } from '../../internal/http'
import { readConfigurationForViewer } from '../../utils/configuration-server'

/**
 * GET /api/configuration/public — the `public` platform and tenant values
 * in force for the request's host name. Never a group's values. Cacheable.
 */
export default configurationHandler(async (event) => {
  const tenantId = await tenantOf(event)
  const answer = await readConfigurationForViewer({ subject: null, tenantId })
    ?? await readConfigurationForViewer({ subject: null, tenantId: null })
  const etag = `"${createHash('sha256').update(canonicalJson(answer)).digest('base64url').slice(0, 27)}"`
  setResponseHeaders(event, { 'cache-control': 'public, max-age=60', 'etag': etag, 'vary': 'Host' })
  if (getRequestHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304)
    return null
  }
  return answer
})
