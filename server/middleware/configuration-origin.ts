import { defineEventHandler } from 'h3'
import { configurationHttpError, originRejected } from '../internal/http'

/** CSRF defence for `/api/configuration/*`: state-changing requests must come from the host they were sent to. */
export default defineEventHandler((event) => {
  if (originRejected(event)) throw configurationHttpError('forbidden')
})
