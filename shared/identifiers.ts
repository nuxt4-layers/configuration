import { z } from 'zod'

/**
 * Identifiers, codes and instants. Configuration keys tenants, groups and
 * people by Identity's opaque identifiers and never derives one from data.
 */

/** A lower-case UUIDv7, as Identity issues for identities, groups and tenants. */
export const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Any RFC 9562 UUID, lower case. Correlation identifiers are issued by the host. */
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** Identity's identifier of a person, service identity, group or tenant. */
export const identifierSchema = z.string().regex(UUID_V7_PATTERN, 'not-an-identifier')

/** The correlation identifier of the request that started a process. */
export const correlationIdSchema = z.string().regex(UUID_PATTERN, 'not-a-correlation-id')

/** ISO 8601 instant in UTC. */
export const instantSchema = z.iso.datetime()

/** A code, never free text: `legal-hold`, `values-changed`. */
export const REASON_CODE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
export const reasonCodeSchema = z.string().max(64).regex(REASON_CODE_PATTERN, 'not-a-code')

/** A lower-case hexadecimal SHA-256 digest. */
export const digestSchema = z.string().regex(/^[0-9a-f]{64}$/, 'not-a-digest')
