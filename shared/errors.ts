/**
 * Failure categories at Configuration's boundary (docs/contracts.md §13.1).
 *
 * `forbidden` is deliberately coarse: it never says whether a tenant, group
 * or change exists, or which rule refused.
 */
export const CONFIGURATION_ERROR_CODES = [
  'unauthenticated',
  'forbidden',
  'insufficient-assurance',
  'validation-failed',
  'conflict',
  'unavailable',
] as const

export type ConfigurationErrorCode = typeof CONFIGURATION_ERROR_CODES[number]

export const CONFIGURATION_ERROR_STATUS: Readonly<Record<ConfigurationErrorCode, number>> = {
  'unauthenticated': 401,
  'forbidden': 403,
  'insufficient-assurance': 403,
  'validation-failed': 400,
  'conflict': 409,
  'unavailable': 503,
}

/** Why a request conflicted, or why an applying change was rejected. Codes only. */
export const CONFIGURATION_CONFLICT_REASONS = [
  'values-changed',
  'scope-closing',
  'scope-read-only',
  'own-request',
  'controlled-identity',
  'already-decided',
  'not-open',
  'change-differs',
  'requirement-raised',
  'risk-raised',
  'not-governing',
  'permission-lost',
  'setting-changed',
  'host-taken',
] as const

export type ConfigurationConflictReason = typeof CONFIGURATION_CONFLICT_REASONS[number]

/** Raised when the host has not supplied a required port. Configuration fails closed. */
export class ConfigurationCompositionError extends Error {
  readonly port: string

  constructor(port: string) {
    super(`Configuration port '${port}' has not been supplied by the host application.`)
    this.name = 'ConfigurationCompositionError'
    this.port = port
  }
}

/**
 * A server function's failure, carrying a contract code and, for
 * `validation-failed` and `conflict`, a reason code. The detail never names
 * a value.
 */
export class ConfigurationFailure extends Error {
  readonly code: ConfigurationErrorCode
  readonly reason?: string

  constructor(code: ConfigurationErrorCode, reason?: string) {
    super(reason ? `${code}: ${reason}` : code)
    this.name = 'ConfigurationFailure'
    this.code = code
    this.reason = reason
  }
}
