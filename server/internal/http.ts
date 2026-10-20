import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { createError, defineEventHandler, getQuery, getRequestHeader, getRequestHost, getRequestURL, getRouterParam, isError, readBody } from 'h3'
import type { z } from 'zod'
import type { ConfigurationChangeTarget, ConfigurationErrorCode, ConfigurationSubject } from '../../shared/contracts'
import { CONFIGURATION_ERROR_STATUS, ConfigurationCompositionError, ConfigurationFailure, subjectSchema, UUID_PATTERN, UUID_V7_PATTERN } from '../../shared/contracts'
import { useConfigurationSubjectResolver } from '../utils/configuration-composition'
import { getConfigurationTenantForHost } from '../utils/configuration-server'

/**
 * PRIVATE. The HTTP boundary of `/api/configuration/*` (docs/contracts.md §13).
 *
 * - Errors cross as `{ code, messageKey, reason? }`: a reason code for
 *   `validation-failed` and `conflict` only, never a value.
 * - Bodies and queries are parsed with strict schemas.
 * - The subject comes only from the host's resolver; the tenant only from
 *   the request's host name.
 */

export const CONFIGURATION_API_PREFIX = '/api/configuration'
export const CORRELATION_HEADER = 'x-correlation-id'

const CODE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

export function configurationHttpError(code: ConfigurationErrorCode, reason?: string) {
  const data: { code: ConfigurationErrorCode, messageKey: string, reason?: string } = { code, messageKey: `configuration.error.${code}` }
  if (reason && (code === 'conflict' || code === 'validation-failed') && CODE.test(reason) && reason.length <= 64) data.reason = reason
  return createError({ statusCode: CONFIGURATION_ERROR_STATUS[code], statusMessage: code, data })
}

/** Translates anything thrown inside a handler into a contract error. */
export function toHttpError(error: unknown) {
  if (isError(error)) return error
  if (error instanceof ConfigurationFailure) {
    if (error.code === 'unavailable') console.error('[configuration] request failed:', error.message)
    return configurationHttpError(error.code, error.reason)
  }
  if (error instanceof ConfigurationCompositionError) {
    console.error(`[configuration] ${error.message}`)
    return configurationHttpError('unavailable')
  }
  console.error('[configuration] unexpected failure:', error instanceof Error ? error.name : 'unknown')
  return configurationHttpError('unavailable')
}

/** Wraps a handler so that every failure leaves as a contract error. */
export function configurationHandler<T>(run: (event: H3Event) => Promise<T>) {
  return defineEventHandler(async (event) => {
    try {
      return await run(event)
    }
    catch (error) {
      throw toHttpError(error)
    }
  })
}

export function correlationOf(event: H3Event): string {
  const sent = getRequestHeader(event, CORRELATION_HEADER)?.toLowerCase()
  return sent && UUID_PATTERN.test(sent) ? sent : randomUUID()
}

/** The signed-in subject, or `null`. `unavailable` if the resolver fails or answers something malformed. */
export async function optionalSubject(event: H3Event): Promise<ConfigurationSubject | null> {
  let subject: unknown
  try {
    subject = await useConfigurationSubjectResolver().resolve(event)
  }
  catch (error) {
    if (error instanceof ConfigurationCompositionError) throw error
    throw new ConfigurationFailure('unavailable', 'subject-resolver-failed')
  }
  if (subject == null) return null
  const parsed = subjectSchema.safeParse(subject)
  if (!parsed.success) throw new ConfigurationFailure('unavailable', 'subject-malformed')
  return parsed.data as ConfigurationSubject
}

export async function requireSubject(event: H3Event): Promise<ConfigurationSubject> {
  const subject = await optionalSubject(event)
  if (!subject) throw new ConfigurationFailure('unauthenticated')
  return subject
}

/** Whether `X-Forwarded-Host` is trusted, set by the host behind its own proxy (`NUXT_CONFIGURATION_TRUST_FORWARDED_HOST`). */
let trustForwardedHost = false
export function setTrustForwardedHost(trust: boolean): void {
  trustForwardedHost = trust
}

/** The request's host name, without port. */
export function hostOf(event: H3Event): string {
  return getRequestHost(event, { xForwardedHost: trustForwardedHost }).toLowerCase().replace(/:\d+$/, '')
}

/** The tenant the request's host name resolves to, or `null`. */
export function tenantOf(event: H3Event): Promise<string | null> {
  return getConfigurationTenantForHost(hostOf(event))
}

/**
 * Refuses a target outside the request's tenant: tenant and group scopes
 * are administered only on their tenant's host names. Platform values may be
 * administered from any host; the platform group's permission decides.
 */
export function requireTargetInTenant(target: ConfigurationChangeTarget, tenantId: string | null): void {
  if (tenantId !== null && target.scope === 'tenant' && target.tenantId !== tenantId) throw new ConfigurationFailure('forbidden')
}

export function identifierParam(event: H3Event, name: string): string {
  const value = getRouterParam(event, name)
  if (!value || !UUID_V7_PATTERN.test(value)) throw new ConfigurationFailure('forbidden')
  return value
}

function issueCode(issues: readonly { message: string }[]): string | undefined {
  return issues.map(issue => issue.message).find(message => CODE.test(message))
}

export async function readJson<T>(event: H3Event, schema: z.ZodType<T>): Promise<T> {
  let body: unknown
  try {
    body = await readBody(event)
  }
  catch {
    throw new ConfigurationFailure('validation-failed')
  }
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) throw new ConfigurationFailure('validation-failed', issueCode(parsed.error.issues))
  return parsed.data
}

export function readQuery<T>(event: H3Event, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(getQuery(event))
  if (!parsed.success) throw new ConfigurationFailure('validation-failed', issueCode(parsed.error.issues))
  return parsed.data
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * CSRF defence for the state-changing endpoints: the request must carry an
 * Origin (or, failing that, a Referer) on the host it was sent to. Tenants
 * answer on their own host names, so the request's own host is the origin.
 */
export function originRejected(event: H3Event): boolean {
  if (!getRequestURL(event).pathname.startsWith(`${CONFIGURATION_API_PREFIX}/`)) return false
  if (SAFE_METHODS.has(event.method)) return false
  const origin = getRequestHeader(event, 'origin')
  const referer = getRequestHeader(event, 'referer')
  try {
    const sent = origin ? new URL(origin) : referer ? new URL(referer) : null
    if (!sent || (sent.protocol !== 'https:' && sent.protocol !== 'http:')) return true
    return sent.host.toLowerCase().replace(/:\d+$/, '') !== hostOf(event)
  }
  catch {
    return true
  }
}
