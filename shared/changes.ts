import { z } from 'zod'
import { correlationIdSchema, digestSchema, identifierSchema, instantSchema, reasonCodeSchema } from './identifiers'
import type { ConfigurationRisk } from './settings'
import { settingKeySchema } from './settings'
import { safeTextSchema } from './values'

/**
 * Pending changes and their approvals (docs/contracts.md §6, §7), following
 * iam-integration's approvals process as Authorisation does for roles.
 */

export const CHANGE_STATUSES = ['awaiting', 'delayed', 'applied', 'rejected', 'expired', 'cancelled'] as const
export type ConfigurationChangeStatus = typeof CHANGE_STATUSES[number]

export const CHANGE_ROUTES = ['none', 'approvers', 'parent-owner', 'tenant-owner', 'published-delay'] as const
export type ConfigurationChangeRoute = typeof CHANGE_ROUTES[number]

/** Approvers needed beyond the requester, whatever a group asks (approvals process). */
export const APPROVAL_FLOOR: Readonly<Record<ConfigurationRisk, number>> = { low: 0, medium: 0, high: 1, critical: 1 }

export function requiredApprovals(risk: ConfigurationRisk, groupRequirement: number): number {
  return Math.max(APPROVAL_FLOOR[risk], groupRequirement)
}

/** Where a change is requested: the tenant scope names the root group that governs it (§7.1). */
export const changeTargetSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('platform') }),
  z.strictObject({ scope: z.literal('tenant'), tenantId: identifierSchema, governingGroupId: identifierSchema }),
  z.strictObject({ scope: z.literal('group'), groupId: identifierSchema }),
  // Always the requester's own account: nobody names another's.
  z.strictObject({ scope: z.literal('account') }),
])
export type ConfigurationChangeTarget = z.infer<typeof changeTargetSchema>

export const justificationSchema = z.strictObject({
  reasonCode: reasonCodeSchema,
  reference: safeTextSchema({ max: 200 }).optional(),
})

/**
 * A request. `set` gives each key's new value, or `null` to clear it;
 * `expected` the digest of each key's value at that scope as the requester
 * saw it (`null` when it had none). Values are checked against the catalogue
 * on the server.
 */
export const configurationChangeRequestSchema = z.strictObject({
  target: changeTargetSchema,
  set: z.record(settingKeySchema, z.unknown()).refine(value => Object.keys(value).length >= 1 && Object.keys(value).length <= 50, 'empty-change'),
  expected: z.record(settingKeySchema, digestSchema.nullable()),
  justification: justificationSchema,
}).refine(request => Object.keys(request.set).every(key => Object.hasOwn(request.expected, key)), 'expected-missing')
export type ConfigurationChangeRequest = z.infer<typeof configurationChangeRequestSchema>

export const decisionSchema = z.enum(['approve', 'reject'])

/** A subject's assurance, from Authentication through the host. */
export interface ConfigurationAssurance {
  level: 'aal1' | 'aal2' | 'aal3'
  phishingResistant: boolean
  /** When the subject last authenticated (ISO 8601). */
  authenticatedAt: string
}

export interface ConfigurationSubject {
  identityId: string
  kind: 'person' | 'service'
  assurance: ConfigurationAssurance
}

export const subjectSchema = z.strictObject({
  identityId: identifierSchema,
  kind: z.enum(['person', 'service']),
  assurance: z.strictObject({ level: z.enum(['aal1', 'aal2', 'aal3']), phishingResistant: z.boolean(), authenticatedAt: instantSchema }),
})

/** How recently a `critical` change's requester or approver must have authenticated. */
export const CRITICAL_FRESHNESS_MINUTES = 15

/** Whether a subject meets the step-up a risk requires: `high` aal2; `critical` aal2, phishing resistant, within 15 minutes. */
export function meetsStepUp(risk: ConfigurationRisk, assurance: ConfigurationAssurance, now: Date): boolean {
  if (risk === 'low' || risk === 'medium') return true
  if (assurance.level === 'aal1') return false
  if (risk === 'high') return true
  const age = now.getTime() - Date.parse(assurance.authenticatedAt)
  return assurance.phishingResistant && age >= 0 && age <= CRITICAL_FRESHNESS_MINUTES * 60_000
}

/** Canonical JSON: object keys sorted, no whitespace. The input of every digest. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
}

/** A pending change as answered to those who may see it. Values only for those who may decide or read the scope. */
export interface ConfigurationChange {
  changeId: string
  target: ConfigurationChangeTarget
  governingGroupId: string
  tenantId: string | null
  requesterId: string
  risk: ConfigurationRisk
  route: ConfigurationChangeRoute
  requiredApprovals: number
  ownerGroupId: string | null
  keys: string[]
  set: Record<string, unknown>
  justification: z.infer<typeof justificationSchema>
  digest: string
  status: ConfigurationChangeStatus
  reasonCode: string | null
  requestedAt: string
  expiresAt: string | null
  appliesAt: string | null
  heldUntil: string | null
  decidedAt: string | null
  approvals: { approverId: string, decision: 'approve' | 'reject', decidedAt: string }[]
  correlationId: string
}

export const changeIdSchema = identifierSchema
export { correlationIdSchema }
