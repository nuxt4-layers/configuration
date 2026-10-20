import type {
  ConfigurationAccessDecision,
  ConfigurationDirectory,
  ConfigurationGovernance,
  ConfigurationRisk,
  ConfigurationSubject,
  ConfigurationSubjectResolver,
} from '../../shared/contracts'
import { CONFIGURATION_PERMISSIONS } from '../../shared/contracts'

/**
 * Reference adapters from the IAM members' server functions to this layer's
 * ports, for the host's Nitro plugin:
 *
 *   provideConfigurationDirectory(configurationDirectoryFromIdentity(getIdentityDirectory()))
 *   provideConfigurationGovernance(configurationGovernanceFromIdentity(getIdentityAccessGovernance()))
 *   provideConfigurationAccessDecision(configurationAccessDecisionFromAuthorisation({ qualifies: authorisationQualifies, countQualifying: countAuthorisationQualifying }))
 *   provideConfigurationSubjectResolver(configurationSubjectResolverFromAuthentication({ getAuthenticatedPrincipal }))
 *
 * They import no member: the host passes the functions in, and the
 * structural types below name what each adapter needs (Identity contract 1,
 * Authorisation contract 2, Authentication contract 1). The host's type
 * check proves the real functions fit. The adapters translate vocabulary
 * only; they decide nothing and pass every failure on, so the layer fails
 * closed.
 */

// ---------------------------------------------------------------------------
// Members' shapes
// ---------------------------------------------------------------------------

type GroupState = 'active' | 'orphaned' | 'archived'

/** A group as Identity's directory describes it. Deleted and unknown groups are null. */
export interface IdentityGroupDescriptionLike {
  groupId: string
  tenantId: string
  lineage: readonly string[]
  kind: 'personal' | 'standard'
  state: GroupState
}

/** Identity's `getIdentityDirectory()`. */
export interface IdentityDirectoryLike {
  resolveActor(identityId: string, options: { consistency: 'strong' | 'bounded' }): Promise<{
    identityId: string
    kind: 'person' | 'service' | 'break-glass'
    identityState: 'active' | 'paused' | 'suspended' | 'closure-pending' | 'closed'
    personalGroup: { groupId: string } | null
    memberships: readonly { group: { groupId: string, tenantId: string }, effectiveStatus: 'active' | 'paused' | 'suspended' }[]
  } | null>
  describeGroup(groupId: string, options: { consistency: 'strong' | 'bounded' }): Promise<IdentityGroupDescriptionLike | null>
}

/** Identity's `getIdentityAccessGovernance()`. */
export interface IdentityAccessGovernanceLike {
  describeGroup(input: { groupId: string, identityId: string, correlationId: string }): Promise<{
    groupId: string
    tenantId: string
    kind: 'personal' | 'standard'
    state: GroupState
    parentGroupId: string | null
    rootGroupId: string
    approvals: { required: Readonly<Record<ConfigurationRisk, number>>, referenceRequired: boolean }
    safetyPeriods: { publishedDelayHighHours: number, publishedDelayCriticalHours: number, approvalExpiryDays: number }
    requester: { recoveryHoldUntil: string | null, controls: readonly string[] }
  } | null>
  isOwner(input: { identityId: string, groupId: string }): Promise<boolean>
  countOwners(input: { groupId: string, excluding: readonly string[] }): Promise<number>
}

export interface AuthorisationResourceLike {
  type: string
  id: string
  owningGroupId: string
}

/** Authentication's `AuthenticatedPrincipal`, the fields this layer needs. */
export interface AuthenticatedPrincipalLike {
  principalId: string
  kind?: 'person' | 'service'
  authenticatedAt: string
  assurance: { level: 'aal1' | 'aal2', phishingResistant: boolean }
}

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/**
 * Identity's directory as `ConfigurationDirectory`. A break-glass identity is
 * never a person here, so it never requests or decides a change; only
 * memberships in effect and active count for reading.
 */
export function configurationDirectoryFromIdentity(directory: IdentityDirectoryLike): ConfigurationDirectory {
  return {
    async describeGroup(groupId, options) {
      const group = await directory.describeGroup(groupId, options)
      return group ? { groupId: group.groupId, tenantId: group.tenantId, kind: group.kind, state: group.state, lineage: [...group.lineage] } : null
    },
    async describeActor(identityId, options) {
      const actor = await directory.resolveActor(identityId, options)
      if (!actor) return null
      return {
        identityId: actor.identityId,
        kind: actor.kind === 'person' ? 'person' : 'service',
        // An account is reachable only while its identity is active.
        personalGroupId: actor.kind === 'person' && actor.identityState === 'active' ? actor.personalGroup?.groupId ?? null : null,
        memberships: actor.memberships.filter(membership => membership.effectiveStatus === 'active').map(membership => ({ groupId: membership.group.groupId, tenantId: membership.group.tenantId })),
      }
    },
  }
}

/** Identity's access governance as `ConfigurationGovernance`. */
export function configurationGovernanceFromIdentity(governance: IdentityAccessGovernanceLike): ConfigurationGovernance {
  return {
    async describeGroup(input) {
      const group = await governance.describeGroup(input)
      if (!group) return null
      return {
        groupId: group.groupId,
        tenantId: group.tenantId,
        kind: group.kind,
        state: group.state,
        parentId: group.parentGroupId,
        rootId: group.rootGroupId,
        approvalsRequired: { ...group.approvals.required },
        referenceRequired: group.approvals.referenceRequired,
        safetyPeriods: {
          publishedDelayHighHours: group.safetyPeriods.publishedDelayHighHours,
          publishedDelayCriticalHours: group.safetyPeriods.publishedDelayCriticalHours,
          approvalExpiryDays: group.safetyPeriods.approvalExpiryDays,
        },
        recoveryHoldEndsAt: group.requester.recoveryHoldUntil,
        controlledIdentityIds: [...group.requester.controls],
      }
    },
    isOwner: input => governance.isOwner(input),
    countOwners: input => governance.countOwners(input),
  }
}

/**
 * A Configuration permission acts on a group: the resource is the group
 * itself, of the permission's resource type (`configuration.group-settings`),
 * owned by that group. The host registers these types with Authorisation.
 */
export function configurationGroupResource(permission: string, groupId: string): AuthorisationResourceLike {
  return { type: permission.slice(0, permission.indexOf(':')), id: groupId, owningGroupId: groupId }
}

/** The risk this layer declares for its permissions (`CONFIGURATION_PERMISSIONS`). */
export function configurationPermissionRisk(permission: string): ConfigurationRisk {
  const declared = CONFIGURATION_PERMISSIONS.find(entry => entry.permission === permission)
  if (!declared) throw new Error(`Unknown Configuration permission '${permission}'.`)
  return declared.risk
}

/**
 * Authorisation as `ConfigurationAccessDecision`: `authorisationQualifies`
 * (whether the identity holds the permission now; this layer steps up the
 * session itself) and `countAuthorisationQualifying`. `riskOf` defaults to
 * the layer's declared risks; a host whose catalogue raises one passes its own.
 */
export function configurationAccessDecisionFromAuthorisation(input: {
  qualifies: (input: { principalId: string, permission: string, resource: AuthorisationResourceLike }) => Promise<boolean>
  countQualifying: (input: { permission: string, resource: AuthorisationResourceLike, excludingPrincipalIds: readonly string[], limit: number }) => Promise<number>
  riskOf?: (permission: string) => ConfigurationRisk | Promise<ConfigurationRisk>
}): ConfigurationAccessDecision {
  return {
    allows: ({ identityId, permission, groupId }) => input.qualifies({ principalId: identityId, permission, resource: configurationGroupResource(permission, groupId) }),
    countQualifying: ({ permission, groupId, excluding }) => input.countQualifying({ permission, resource: configurationGroupResource(permission, groupId), excludingPrincipalIds: excluding, limit: 10 }),
    riskOf: async permission => input.riskOf ? await input.riskOf(permission) : configurationPermissionRisk(permission),
  }
}

/** Authentication's `getAuthenticatedPrincipal(event)` as `ConfigurationSubjectResolver`. */
export function configurationSubjectResolverFromAuthentication(input: {
  getAuthenticatedPrincipal: (event: never) => Promise<AuthenticatedPrincipalLike | null>
}): ConfigurationSubjectResolver {
  return {
    async resolve(event): Promise<ConfigurationSubject | null> {
      const principal = await input.getAuthenticatedPrincipal(event as never)
      if (!principal) return null
      return {
        identityId: principal.principalId,
        kind: principal.kind === 'service' ? 'service' : 'person',
        assurance: { level: principal.assurance.level, phishingResistant: principal.assurance.phishingResistant, authenticatedAt: principal.authenticatedAt },
      }
    },
  }
}
