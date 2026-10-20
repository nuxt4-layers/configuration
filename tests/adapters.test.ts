import { describe, expect, it } from 'vitest'
import {
  configurationAccessDecisionFromAuthorisation,
  configurationDirectoryFromIdentity,
  configurationGovernanceFromIdentity,
  configurationGroupResource,
  configurationSubjectResolverFromAuthentication,
} from '../server/utils/configuration-adapters'
import type { IdentityAccessGovernanceLike, IdentityDirectoryLike } from '../server/utils/configuration-adapters'

const tenant = '01928c4e-0000-7000-8000-000000000001'
const root = '01928c4e-0000-7000-8000-000000000002'
const team = '01928c4e-0000-7000-8000-000000000003'
const person = '01928c4e-0000-7000-8000-000000000004'
const personal = '01928c4e-0000-7000-8000-000000000005'
const closed = '01928c4e-0000-7000-8000-000000000006'

const directory: IdentityDirectoryLike = {
  async describeGroup(groupId) {
    return groupId === team ? { groupId, tenantId: tenant, lineage: [root, team], kind: 'standard', state: 'archived' } : null
  },
  async resolveActor(identityId) {
    if (identityId === 'down') throw new Error('identity is down')
    return {
      identityId,
      kind: identityId === person || identityId === closed ? 'person' : 'break-glass',
      identityState: identityId === closed ? 'closed' : 'active',
      personalGroup: identityId === person || identityId === closed ? { groupId: personal } : null,
      memberships: [
        { group: { groupId: team, tenantId: tenant }, effectiveStatus: 'active' },
        { group: { groupId: root, tenantId: tenant }, effectiveStatus: 'paused' },
      ],
    }
  },
}

describe('Identity\'s directory as ConfigurationDirectory', () => {
  const adapted = configurationDirectoryFromIdentity(directory)

  it('passes a group\'s tenant, kind, state and lineage through, and unknown groups as null', async () => {
    expect(await adapted.describeGroup(team, { consistency: 'strong' })).toEqual({ groupId: team, tenantId: tenant, kind: 'standard', state: 'archived', lineage: [root, team] })
    expect(await adapted.describeGroup(root, { consistency: 'strong' })).toBeNull()
  })

  it('counts only active memberships, and never treats a break-glass identity as a person', async () => {
    expect(await adapted.describeActor(person, { consistency: 'bounded' })).toEqual({ identityId: person, kind: 'person', personalGroupId: personal, memberships: [{ groupId: team, tenantId: tenant }] })
    expect((await adapted.describeActor(root, { consistency: 'bounded' }))!.kind).toBe('service')
  })

  it('names a personal group only while the identity is active', async () => {
    expect((await adapted.describeActor(closed, { consistency: 'strong' }))!.personalGroupId).toBeNull()
    expect((await adapted.describeActor(root, { consistency: 'strong' }))!.personalGroupId).toBeNull()
  })

  it('passes a failure on, so the layer fails closed', async () => {
    await expect(adapted.describeActor('down', { consistency: 'strong' })).rejects.toThrow('identity is down')
  })
})

describe('Identity\'s access governance as ConfigurationGovernance', () => {
  const governance: IdentityAccessGovernanceLike = {
    async describeGroup({ groupId }) {
      return {
        groupId,
        tenantId: tenant,
        kind: 'standard',
        state: 'active',
        parentGroupId: root,
        rootGroupId: root,
        approvals: { required: { low: 0, medium: 1, high: 2, critical: 2 }, referenceRequired: true },
        safetyPeriods: { publishedDelayHighHours: 96, publishedDelayCriticalHours: 200, approvalExpiryDays: 5 },
        requester: { recoveryHoldUntil: '2026-10-22T12:00:00.000Z', controls: [person] },
      }
    },
    isOwner: async ({ identityId }) => identityId === person,
    countOwners: async ({ excluding }) => (excluding.includes(person) ? 0 : 1),
  }
  const adapted = configurationGovernanceFromIdentity(governance)

  it('maps Identity\'s answer to the layer\'s vocabulary', async () => {
    expect(await adapted.describeGroup({ groupId: team, identityId: person, correlationId: person })).toEqual({
      groupId: team,
      tenantId: tenant,
      kind: 'standard',
      state: 'active',
      parentId: root,
      rootId: root,
      approvalsRequired: { low: 0, medium: 1, high: 2, critical: 2 },
      referenceRequired: true,
      safetyPeriods: { publishedDelayHighHours: 96, publishedDelayCriticalHours: 200, approvalExpiryDays: 5 },
      recoveryHoldEndsAt: '2026-10-22T12:00:00.000Z',
      controlledIdentityIds: [person],
    })
    expect(await adapted.isOwner({ identityId: person, groupId: root })).toBe(true)
    expect(await adapted.countOwners({ groupId: root, excluding: [person] })).toBe(0)
  })
})

describe('Authorisation as ConfigurationAccessDecision', () => {
  const calls: unknown[] = []
  const adapted = configurationAccessDecisionFromAuthorisation({
    async qualifies(input) {
      calls.push(input)
      return input.principalId === person
    },
    async countQualifying(input) {
      calls.push(input)
      return 3
    },
  })

  it('asks about the group itself, of the permission\'s resource type', async () => {
    expect(configurationGroupResource('configuration.group-settings:manage', team)).toEqual({ type: 'configuration.group-settings', id: team, owningGroupId: team })
    expect(await adapted.allows({ identityId: person, permission: 'configuration.group-settings:manage', groupId: team, consistency: 'strong' })).toBe(true)
    expect(await adapted.countQualifying({ permission: 'configuration.settings:view', groupId: team, excluding: [person] })).toBe(3)
    expect(calls).toEqual([
      { principalId: person, permission: 'configuration.group-settings:manage', resource: { type: 'configuration.group-settings', id: team, owningGroupId: team } },
      { permission: 'configuration.settings:view', resource: { type: 'configuration.settings', id: team, owningGroupId: team }, excludingPrincipalIds: [person], limit: 10 },
    ])
  })

  it('answers the layer\'s declared risks, or the host\'s', async () => {
    expect(await adapted.riskOf('configuration.platform-settings:manage')).toBe('critical')
    await expect(adapted.riskOf('configuration.unknown:manage')).rejects.toThrow()
    const raised = configurationAccessDecisionFromAuthorisation({ qualifies: async () => false, countQualifying: async () => 0, riskOf: () => 'high' })
    expect(await raised.riskOf('configuration.group-settings:manage')).toBe('high')
  })
})

describe('Authentication\'s principal as the subject', () => {
  it('carries the identifier, kind and assurance, and nobody when signed out', async () => {
    const resolver = configurationSubjectResolverFromAuthentication({
      getAuthenticatedPrincipal: async (event: { signedIn: boolean }) => event.signedIn
        ? { principalId: person, kind: 'service', authenticatedAt: '2026-10-20T12:00:00.000Z', assurance: { level: 'aal2', phishingResistant: false } }
        : null,
    })
    expect(await resolver.resolve({ signedIn: true })).toEqual({ identityId: person, kind: 'service', assurance: { level: 'aal2', phishingResistant: false, authenticatedAt: '2026-10-20T12:00:00.000Z' } })
    expect(await resolver.resolve({ signedIn: false })).toBeNull()
  })
})
