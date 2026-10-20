import type { ConfigurationSubject } from './changes'
import type { ConfigurationRisk } from './settings'

/**
 * Ports the host supplies (docs/contracts.md §11), in Configuration's own
 * vocabulary. The host adapts Identity's and Authorisation's server
 * functions to them. Every port rejects on failure; Configuration then fails
 * closed as `unavailable`, never on a null, partial or stale answer.
 */

export interface PostgresPoolLike {
  query(text: string, values?: readonly unknown[]): Promise<unknown>
  connect(): Promise<unknown>
}

/** Persistence (ADR-0002, ADR-0006). `pool` connects as the runtime role. */
export interface ConfigurationDatabase {
  dialect: 'postgres'
  pool: PostgresPoolLike
  /** Schema owned by this capability. Defaults to `configuration`. */
  schema?: string
  migrationPool?: PostgresPoolLike
  /** The runtime role to grant, when migrations run as another role. */
  runtimeRole?: string
}

export type Consistency = 'strong' | 'bounded'

/** A group as Identity's directory describes it. */
export interface ConfigurationGroupFacts {
  groupId: string
  tenantId: string
  kind: 'personal' | 'standard'
  state: 'active' | 'archived' | 'orphaned' | 'deleted'
  /** Root first, ending with the group itself. */
  lineage: readonly string[]
}

export interface ConfigurationActorFacts {
  identityId: string
  kind: 'person' | 'service'
  /** The person's personal group while the identity is active; `null` otherwise, and for service identities. */
  personalGroupId: string | null
  /** Memberships in effect now. */
  memberships: readonly { groupId: string, tenantId: string }[]
}

/** Identity's directory, through the host. Unknown answers `null`. */
export interface ConfigurationDirectory {
  describeGroup(groupId: string, options: { consistency: Consistency }): Promise<ConfigurationGroupFacts | null>
  describeActor(identityId: string, options: { consistency: Consistency }): Promise<ConfigurationActorFacts | null>
}

/** Identity's tenants, through the host. Unknown answers `null`. */
export interface ConfigurationTenants {
  describeTenant(tenantId: string): Promise<{ tenantId: string, state: 'active' | 'closing' | 'closed' } | null>
}

export interface ConfigurationSafetyPeriods {
  publishedDelayHighHours: number
  publishedDelayCriticalHours: number
  approvalExpiryDays: number
}

/** A governing group's facts, from Identity's access-governance port (`describeGroup`). */
export interface ConfigurationGovernedGroup {
  groupId: string
  tenantId: string
  kind: 'personal' | 'standard'
  state: 'active' | 'archived' | 'orphaned' | 'deleted'
  parentId: string | null
  rootId: string
  approvalsRequired: Readonly<Record<ConfigurationRisk, number>>
  referenceRequired: boolean
  safetyPeriods: ConfigurationSafetyPeriods
  /** The end of the requester's recovery hold, if one is running now. */
  recoveryHoldEndsAt: string | null
  /** Identities the requester controls, who never approve for them. */
  controlledIdentityIds: readonly string[]
}

/** Identity's access governance, through the host. Every read `strong`. */
export interface ConfigurationGovernance {
  describeGroup(input: { groupId: string, identityId: string, correlationId: string }): Promise<ConfigurationGovernedGroup | null>
  isOwner(input: { identityId: string, groupId: string }): Promise<boolean>
  countOwners(input: { groupId: string, excluding: readonly string[] }): Promise<number>
}

/** Authorisation, through the host: decisions on Configuration's permissions. */
export interface ConfigurationAccessDecision {
  /** Whether the identity holds the permission on the group now. */
  allows(input: { identityId: string, permission: string, groupId: string, consistency: Consistency }): Promise<boolean>
  /** How many people other than those listed hold the permission on the group now (service identities never count). */
  countQualifying(input: { permission: string, groupId: string, excluding: readonly string[] }): Promise<number>
  /** The permission's risk in the host's catalogue. */
  riskOf(permission: string): Promise<ConfigurationRisk>
}

/**
 * Who is signed in, for an HTTP request (an h3 event, typed loosely so the
 * contract needs no server package). `null` when nobody is.
 */
export interface ConfigurationSubjectResolver {
  resolve(event: unknown): Promise<ConfigurationSubject | null>
}

export interface ConfigurationClock {
  now(): Date
}
