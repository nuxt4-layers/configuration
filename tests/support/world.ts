import type {
  ConfigurationAccessDecision,
  ConfigurationDirectory,
  ConfigurationGovernance,
  ConfigurationRisk,
  ConfigurationSubject,
  ConfigurationTenants,
} from '../../shared/contracts'

/**
 * Stand-ins for Identity's and Authorisation's ports, held in memory, so the
 * tests decide who exists, who owns what and who holds which permission.
 */

let counter = 0x100

/** A fresh UUIDv7 for tests. */
export function id(): string {
  counter++
  return `01928c4e-0000-7000-8000-${counter.toString(16).padStart(12, '0')}`
}

export function correlation(): string {
  return id()
}

interface Group {
  groupId: string
  tenantId: string
  parentId: string | null
  kind: 'personal' | 'standard'
  state: 'active' | 'archived' | 'orphaned' | 'deleted'
  approvalsRequired: Record<ConfigurationRisk, number>
  referenceRequired: boolean
}

export class World {
  readonly tenants = new Map<string, 'active' | 'closing' | 'closed'>()
  readonly groups = new Map<string, Group>()
  readonly owners = new Map<string, Set<string>>()
  /** permission → groupId → holders */
  readonly holders = new Map<string, Map<string, Set<string>>>()
  readonly services = new Set<string>()
  /** identityId → memberships in effect */
  readonly memberships = new Map<string, { groupId: string, tenantId: string }[]>()
  readonly recoveryHolds = new Map<string, string>()
  readonly controlled = new Map<string, string[]>()
  readonly risks = new Map<string, ConfigurationRisk>()
  safetyPeriods = { publishedDelayHighHours: 72, publishedDelayCriticalHours: 168, approvalExpiryDays: 7 }
  failing = false

  tenant(state: 'active' | 'closing' | 'closed' = 'active'): string {
    const tenantId = id()
    this.tenants.set(tenantId, state)
    return tenantId
  }

  group(tenantId: string, parentId: string | null = null): string {
    const groupId = id()
    this.groups.set(groupId, { groupId, tenantId, parentId, kind: 'standard', state: 'active', approvalsRequired: { low: 0, medium: 0, high: 1, critical: 1 }, referenceRequired: false })
    return groupId
  }

  lineage(groupId: string): string[] {
    const chain: string[] = []
    for (let at: string | null = groupId; at; at = this.groups.get(at)!.parentId) chain.unshift(at)
    return chain
  }

  grant(identityId: string, permission: string, groupId: string): void {
    const byGroup = this.holders.get(permission) ?? new Map<string, Set<string>>()
    this.holders.set(permission, byGroup)
    const set = byGroup.get(groupId) ?? new Set<string>()
    byGroup.set(groupId, set)
    set.add(identityId)
  }

  revoke(identityId: string, permission: string, groupId: string): void {
    this.holders.get(permission)?.get(groupId)?.delete(identityId)
  }

  join(identityId: string, groupId: string): void {
    const list = this.memberships.get(identityId) ?? []
    list.push({ groupId, tenantId: this.groups.get(groupId)!.tenantId })
    this.memberships.set(identityId, list)
  }

  own(identityId: string, groupId: string): void {
    const set = this.owners.get(groupId) ?? new Set<string>()
    this.owners.set(groupId, set)
    set.add(identityId)
  }

  private check(): void {
    if (this.failing) throw new Error('port down')
  }

  readonly directory: ConfigurationDirectory = {
    describeGroup: async (groupId) => {
      this.check()
      const group = this.groups.get(groupId)
      return group ? { groupId, tenantId: group.tenantId, kind: group.kind, state: group.state, lineage: this.lineage(groupId) } : null
    },
    describeActor: async (identityId) => {
      this.check()
      return { identityId, kind: this.services.has(identityId) ? 'service' : 'person', memberships: this.memberships.get(identityId) ?? [] }
    },
  }

  readonly tenantPort: ConfigurationTenants = {
    describeTenant: async (tenantId) => {
      this.check()
      const state = this.tenants.get(tenantId)
      return state ? { tenantId, state } : null
    },
  }

  readonly governance: ConfigurationGovernance = {
    describeGroup: async ({ groupId, identityId }) => {
      this.check()
      const group = this.groups.get(groupId)
      if (!group) return null
      return {
        groupId,
        tenantId: group.tenantId,
        kind: group.kind,
        state: group.state,
        parentId: group.parentId,
        rootId: this.lineage(groupId)[0]!,
        approvalsRequired: { ...group.approvalsRequired },
        referenceRequired: group.referenceRequired,
        safetyPeriods: { ...this.safetyPeriods },
        recoveryHoldEndsAt: this.recoveryHolds.get(identityId) ?? null,
        controlledIdentityIds: this.controlled.get(identityId) ?? [],
      }
    },
    isOwner: async ({ identityId, groupId }) => {
      this.check()
      return this.owners.get(groupId)?.has(identityId) ?? false
    },
    countOwners: async ({ groupId, excluding }) => {
      this.check()
      return [...this.owners.get(groupId) ?? []].filter(owner => !excluding.includes(owner)).length
    },
  }

  readonly access: ConfigurationAccessDecision = {
    allows: async ({ identityId, permission, groupId }) => {
      this.check()
      return this.holders.get(permission)?.get(groupId)?.has(identityId) ?? false
    },
    countQualifying: async ({ permission, groupId, excluding }) => {
      this.check()
      return [...this.holders.get(permission)?.get(groupId) ?? []].filter(holder => !excluding.includes(holder) && !this.services.has(holder)).length
    },
    riskOf: async (permission) => {
      this.check()
      return this.risks.get(permission) ?? 'low'
    },
  }
}

/** A signed-in person; `strong` adds aal2, phishing resistant, just now. */
export function person(identityId: string, at: Date, strength: 'weak' | 'strong' = 'strong'): ConfigurationSubject {
  return {
    identityId,
    kind: 'person',
    assurance: strength === 'strong'
      ? { level: 'aal2', phishingResistant: true, authenticatedAt: at.toISOString() }
      : { level: 'aal1', phishingResistant: false, authenticatedAt: at.toISOString() },
  }
}
