import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { ConfigurationChange, ConfigurationChangeTarget, ConfigurationEvent, ConfigurationSubject } from '../shared/contracts'
import { z } from 'zod'
import { buildConfigurationCatalogue, CONFIGURATION_SETTINGS, ConfigurationFailure, configurationEventSchema, defineConfigurationSetting } from '../shared/contracts'
import { runConfigurationMigrations } from '../server/database/migrations'
import { createConfigurationService, valueDigest } from '../server/internal/service'
import { createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'
import { correlation, id, person, World } from './support/world'

requireDatabaseInCi()

const HOUR = 3_600_000
const GROUP = 'configuration.group-settings:manage'
const TENANT = 'configuration.tenant-settings:manage'
const PLATFORM = 'configuration.platform-settings:manage'
const VIEW = 'configuration.settings:view'

/** A host's own settings, set per account: an organisation may choose the default, each person their own. */
const HOST_SETTINGS = [
  defineConfigurationSetting({ key: 'notices.digest', schema: z.enum(['daily', 'weekly', 'never']), scopes: ['platform', 'tenant', 'account'], visibility: 'members', sensitivity: 'organisational', risk: 'low' }),
  defineConfigurationSetting({ key: 'notices.webhook', schema: z.string().startsWith('https://'), scopes: ['account'], visibility: 'server', sensitivity: 'organisational', risk: 'high' }),
]

describe.skipIf(!hasDatabase)('Pending changes and approvals (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>
  let pool: pg.Pool
  let world: World
  let time: Date
  let service: ReturnType<typeof createConfigurationService>
  let platformGroup: string
  let tenantId: string
  let root: string
  let child: string
  const alice = id()
  const bob = id()
  const carol = id()

  const at = (subject: string, strength: 'weak' | 'strong' = 'strong'): ConfigurationSubject => person(subject, time, strength)
  const fail = async (promise: Promise<unknown>) => {
    try {
      await promise
    }
    catch (error) {
      if (error instanceof ConfigurationFailure) return { code: error.code, reason: error.reason }
      throw error
    }
    throw new Error('expected a failure')
  }

  async function request(subject: string, target: ConfigurationChangeTarget, set: Record<string, unknown>, options: { expected?: Record<string, string | null>, strength?: 'weak' | 'strong', reference?: string } = {}): Promise<ConfigurationChange> {
    let expected = options.expected
    if (!expected) {
      expected = {}
      const scope = target.scope === 'platform' ? ['platform', ''] : target.scope === 'tenant' ? ['tenant', target.tenantId] : target.scope === 'account' ? ['account', subject] : ['group', target.groupId]
      const { rows } = await pool.query(`select "key", "value" from "configuration"."value" where "scope" = $1 and "scope_id" = $2`, scope)
      for (const key of Object.keys(set)) expected[key] = valueDigest(rows.find(row => row.key === key)?.value)
    }
    return service.changes.request({
      subject: at(subject, options.strength),
      request: { target, set, expected, justification: { reasonCode: 'rebrand', ...(options.reference ? { reference: options.reference } : {}) } },
      correlationId: correlation(),
    })
  }

  const approve = (subject: string, change: ConfigurationChange, digest = change.digest) =>
    service.changes.decide({ subject: at(subject), changeId: change.changeId, changeDigest: digest, decision: 'approve', correlationId: correlation() })

  async function events(): Promise<ConfigurationEvent[]> {
    const { rows } = await pool.query(`select "event" from "configuration"."outbox" order by "sequence"`)
    return rows.map(row => configurationEventSchema.parse(row.event))
  }

  const groupTarget = (groupId: string): ConfigurationChangeTarget => ({ scope: 'group', groupId })

  beforeAll(async () => {
    database = await createTestDatabase()
    pool = new pg.Pool({ connectionString: database.url, max: 4 })
    await runConfigurationMigrations(pool, 'configuration')
  })

  afterAll(async () => {
    await pool?.end()
    await database?.drop()
  })

  beforeEach(async () => {
    await pool.query('truncate "configuration"."value", "configuration"."change", "configuration"."approval", "configuration"."history", "configuration"."outbox"')
    world = new World()
    time = new Date('2026-10-20T12:00:00Z')
    tenantId = world.tenant()
    root = world.group(tenantId)
    child = world.group(tenantId, root)
    platformGroup = world.group(world.tenant())
    world.risks.set(TENANT, 'high')
    world.risks.set(PLATFORM, 'critical')
    world.risks.set(GROUP, 'medium')
    service = createConfigurationService({
      pool,
      schema: 'configuration',
      catalogue: () => buildConfigurationCatalogue(CONFIGURATION_SETTINGS, HOST_SETTINGS),
      deployment: () => ({}),
      directory: () => world.directory,
      tenants: () => world.tenantPort,
      governance: () => world.governance,
      access: () => world.access,
      platformGroupId: () => platformGroup,
      clock: () => ({ now: () => time }),
    })
  })

  it('applies a medium change at once, keeps its history and announces only keys', async () => {
    world.grant(alice, GROUP, child)
    const change = await request(alice, groupTarget(child), { 'site.tagline': 'Making widgets since 1999', 'contact.general': { email: 'hello@example.org' } })
    expect(change.route).toBe('none')
    expect(change.status).toBe('applied')
    const answer = await service.getConfiguration({ groupId: child, visibility: 'public' })
    expect(answer!.values['site.tagline']).toBe('Making widgets since 1999')
    expect(answer!.provenance['site.tagline']).toEqual({ source: 'group', groupId: child })
    const { rows } = await pool.query(`select "key", "possibly_personal" from "configuration"."history" order by "key"`)
    expect(rows).toEqual([{ key: 'contact.general', possibly_personal: true }, { key: 'site.tagline', possibly_personal: false }])
    const outbox = JSON.stringify(await events())
    expect(outbox).not.toContain('widgets')
    expect(outbox).not.toContain('hello@example.org')
    expect((await events()).map(event => event.type)).toEqual(['configuration.change-requested', 'configuration.change-decided', 'configuration.changed'])
  })

  it('needs a second person for a high change, bound to the digest they were shown', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme Widgets Ltd' })
    expect(change).toMatchObject({ risk: 'high', route: 'approvers', status: 'awaiting', requiredApprovals: 1 })
    expect((await service.getConfiguration({ groupId: child, visibility: 'public' }))!.values).not.toHaveProperty('organisation.legal-name')

    expect(await fail(approve(alice, change))).toEqual({ code: 'conflict', reason: 'own-request' })
    expect(await fail(approve(carol, change))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(approve(bob, change, '0'.repeat(64)))).toEqual({ code: 'conflict', reason: 'change-differs' })

    const applied = await approve(bob, change)
    expect(applied.status).toBe('applied')
    expect(applied.approvals).toEqual([expect.objectContaining({ approverId: bob, decision: 'approve' })])
    expect((await service.getConfiguration({ groupId: child, visibility: 'public' }))!.values['organisation.legal-name']).toBe('Acme Widgets Ltd')
  })

  it('needs a second person for a high change even where a group\'s requirement says none', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    world.groups.get(child)!.approvalsRequired.high = 0
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    expect(change).toMatchObject({ route: 'approvers', status: 'awaiting', requiredApprovals: 1 })
  })

  it('refuses a change whose stored digest no longer matches what was recorded', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme Widgets Ltd' })
    await pool.query(`update "configuration"."change" set "set" = '{"organisation.legal-name": "Evil Ltd"}' where "change_id" = $1`, [change.changeId])
    expect(await fail(approve(bob, change))).toEqual({ code: 'conflict', reason: 'change-differs' })
  })

  it('asks for step-up to the change\'s risk, from requester and approver', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    expect(await fail(request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' }, { strength: 'weak' }))).toEqual({ code: 'insufficient-assurance', reason: undefined })
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    expect(await fail(service.changes.decide({ subject: at(bob, 'weak'), changeId: change.changeId, changeDigest: change.digest, decision: 'approve', correlationId: correlation() }))).toEqual({ code: 'insufficient-assurance', reason: undefined })
  })

  it('falls back to an owner of the parent group when nobody else qualifies', async () => {
    world.grant(alice, GROUP, child)
    world.own(carol, root)
    const change = await request(alice, groupTarget(child), { 'legal.links': { privacy: '/privacy', terms: '/terms' } })
    expect(change).toMatchObject({ route: 'parent-owner', ownerGroupId: root, requiredApprovals: 1 })
    expect(await fail(approve(bob, change))).toEqual({ code: 'forbidden', reason: undefined })
    expect((await approve(carol, change)).status).toBe('applied')
  })

  it('waits out a published delay when nobody can approve, and the requester may cancel it', async () => {
    world.grant(alice, GROUP, root)
    const change = await request(alice, groupTarget(root), { 'organisation.registration': { jurisdiction: 'GB', number: '01234567' } })
    expect(change).toMatchObject({ route: 'published-delay', status: 'delayed', appliesAt: new Date(time.getTime() + 72 * HOUR).toISOString() })
    expect(await fail(approve(bob, change))).toEqual({ code: 'forbidden', reason: undefined })

    time = new Date(time.getTime() + 71 * HOUR)
    expect((await service.runMaintenance()).applied).toBe(0)
    time = new Date(time.getTime() + 2 * HOUR)
    expect((await service.runMaintenance()).applied).toBe(1)
    expect((await service.getConfiguration({ groupId: root, visibility: 'public' }))!.values['organisation.registration']).toEqual({ jurisdiction: 'GB', number: '01234567' })

    const second = await request(alice, groupTarget(root), { 'organisation.registration': null })
    expect(await fail(service.changes.cancel({ subject: at(bob), changeId: second.changeId, correlationId: correlation() }))).toEqual({ code: 'forbidden', reason: undefined })
    expect((await service.changes.cancel({ subject: at(alice), changeId: second.changeId, correlationId: correlation() })).status).toBe('cancelled')
  })

  it('expires a change nobody decided', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    time = new Date(time.getTime() + 7 * 24 * HOUR)
    expect((await service.runMaintenance()).expired).toBe(1)
  })

  it('refuses a request made against values that have since changed, and rejects one on applying', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const stale = { 'site.tagline': null }
    await request(alice, groupTarget(child), { 'site.tagline': 'First' })
    expect(await fail(request(alice, groupTarget(child), { 'site.tagline': 'Second' }, { expected: stale }))).toEqual({ code: 'conflict', reason: 'values-changed' })

    world.grant(carol, GROUP, child)
    const alices = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    const bobs = await request(bob, groupTarget(child), { 'organisation.legal-name': 'Other' })
    expect((await approve(carol, bobs)).status).toBe('applied')
    expect(await approve(bob, alices)).toMatchObject({ status: 'rejected', reasonCode: 'values-changed' })
  })

  it('checks every rule again when applying: a raised requirement or a lost permission rejects', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const raised = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    world.groups.get(child)!.approvalsRequired.high = 2
    expect(await approve(bob, raised)).toMatchObject({ status: 'rejected', reasonCode: 'requirement-raised' })

    world.groups.get(child)!.approvalsRequired.high = 1
    const lost = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    world.revoke(alice, GROUP, child)
    expect(await approve(bob, lost)).toMatchObject({ status: 'rejected', reasonCode: 'permission-lost' })
  })

  it('records nothing when a port fails while applying, and the change stays open', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    world.failing = true
    expect(await fail(approve(bob, change))).toEqual({ code: 'unavailable', reason: 'port-failed' })
    world.failing = false
    expect((await service.changes.get({ subject: at(alice), changeId: change.changeId })).status).toBe('awaiting')
    expect((await approve(bob, change)).status).toBe('applied')
  })

  it('never lets a service identity request or decide, nor an identity the requester controls approve', async () => {
    const robot = id()
    world.services.add(robot)
    world.grant(robot, GROUP, child)
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    expect(await fail(service.changes.request({ subject: { ...at(robot), kind: 'service' }, request: { target: groupTarget(child), set: { 'site.tagline': 'x' }, expected: { 'site.tagline': null }, justification: { reasonCode: 'rebrand' } }, correlationId: correlation() }))).toEqual({ code: 'forbidden', reason: undefined })
    // Directory says service even when the subject claims person.
    expect(await fail(request(robot, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'forbidden', reason: undefined })

    world.controlled.set(alice, [bob])
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    expect(change.route).toBe('published-delay')
    world.grant(carol, GROUP, child)
    const second = await request(alice, groupTarget(child), { 'organisation.trading-name': 'Acme', 'organisation.legal-name': 'Acme' }, { expected: { 'organisation.trading-name': null, 'organisation.legal-name': null } })
    expect(await fail(approve(bob, second))).toEqual({ code: 'conflict', reason: 'controlled-identity' })
  })

  it('holds a change requested during a recovery hold until the hold ends', async () => {
    world.grant(alice, GROUP, child)
    world.recoveryHolds.set(alice, new Date(time.getTime() + 24 * HOUR).toISOString())
    const change = await request(alice, groupTarget(child), { 'site.tagline': 'Held' })
    expect(change).toMatchObject({ status: 'delayed', heldUntil: new Date(time.getTime() + 24 * HOUR).toISOString() })
    expect((await events()).map(event => event.type)).toContain('configuration.change-held')
    time = new Date(time.getTime() + 25 * HOUR)
    expect((await service.runMaintenance()).applied).toBe(1)
  })

  it('governs a tenant from one of its root groups only, at high risk', async () => {
    world.grant(alice, TENANT, root)
    world.grant(alice, TENANT, child)
    world.grant(bob, TENANT, root)
    expect(await fail(request(alice, { scope: 'tenant', tenantId, governingGroupId: child }, { 'site.name': 'Acme' }))).toEqual({ code: 'forbidden', reason: undefined })
    const change = await request(alice, { scope: 'tenant', tenantId, governingGroupId: root }, { 'site.name': 'Acme' })
    expect(change).toMatchObject({ risk: 'high', route: 'approvers' })
    await approve(bob, change)
    const answer = await service.getConfiguration({ groupId: child, visibility: 'public' })
    expect(answer!.values['site.name']).toBe('Acme')
    expect(answer!.provenance['site.name']).toEqual({ source: 'tenant' })
  })

  it('makes every platform change at least high, decided in the platform group', async () => {
    world.risks.set(PLATFORM, 'low')
    world.grant(alice, PLATFORM, platformGroup)
    world.grant(bob, PLATFORM, platformGroup)
    const change = await request(alice, { scope: 'platform' }, { 'site.tagline': 'Everywhere' })
    expect(change).toMatchObject({ risk: 'high', route: 'approvers' })
    await approve(bob, change)
    expect((await service.getConfiguration({ visibility: 'public' }))!.values['site.tagline']).toBe('Everywhere')
  })

  it('takes no changes in an archived group or a closing tenant, and hides unknown scopes', async () => {
    world.grant(alice, GROUP, child)
    world.groups.get(child)!.state = 'archived'
    expect(await fail(request(alice, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'conflict', reason: 'scope-read-only' })
    world.groups.get(child)!.state = 'active'
    world.tenants.set(tenantId, 'closing')
    expect(await fail(request(alice, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'conflict', reason: 'scope-closing' })
    expect(await fail(request(alice, groupTarget(id()), { 'site.tagline': 'x' }))).toEqual({ code: 'forbidden', reason: undefined })
    world.grant(carol, GROUP, child)
    world.tenants.set(tenantId, 'active')
    expect(await fail(request(bob, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'forbidden', reason: undefined })
  })

  it('gives a parent group\'s managers no rights over a child: inheritance confers nothing', async () => {
    world.grant(alice, GROUP, root)
    expect(await fail(request(alice, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'forbidden', reason: undefined })
    expect((await request(alice, groupTarget(root), { 'site.tagline': 'Inherited' })).status).toBe('applied')
    expect((await service.getConfiguration({ groupId: child, visibility: 'public' }))!.provenance['site.tagline']).toEqual({ source: 'group', groupId: root })
  })

  it('refuses undeclared keys, keys a scope may not set, and invalid values, naming only the problem', async () => {
    world.grant(alice, GROUP, child)
    expect(await fail(request(alice, groupTarget(child), { 'shop.currency': 'GBP' }))).toEqual({ code: 'validation-failed', reason: 'unknown-setting' })
    expect(await fail(request(alice, groupTarget(child), { 'site.name': 'Acme' }))).toEqual({ code: 'validation-failed', reason: 'not-settable-here' })
    expect(await fail(request(alice, groupTarget(child), { 'legal.links': { privacy: 'javascript:alert(1)', terms: '/terms' } }))).toEqual({ code: 'validation-failed', reason: 'not-a-link' })
  })

  it('needs a reference where the governing group requires one', async () => {
    world.grant(alice, GROUP, child)
    world.groups.get(child)!.referenceRequired = true
    expect(await fail(request(alice, groupTarget(child), { 'site.tagline': 'x' }))).toEqual({ code: 'validation-failed', reason: 'reference-missing' })
    expect((await request(alice, groupTarget(child), { 'site.tagline': 'x' }, { reference: 'CHG-1234' })).status).toBe('applied')
  })

  it('shows a change to its requester, its deciders and viewers of the scope, and nobody else', async () => {
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    const change = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Acme' })
    expect((await service.changes.get({ subject: at(bob), changeId: change.changeId })).set).toEqual({ 'organisation.legal-name': 'Acme' })
    expect(await fail(service.changes.get({ subject: at(carol), changeId: change.changeId }))).toEqual({ code: 'forbidden', reason: undefined })
    world.grant(carol, VIEW, child)
    expect((await service.changes.get({ subject: at(carol), changeId: change.changeId })).changeId).toBe(change.changeId)
    const scope = await service.changes.readScope({ subject: at(carol), target: groupTarget(child) })
    expect(scope.openChanges.map(open => open.changeId)).toEqual([change.changeId])
  })

  it('disposes of a group\'s and a tenant\'s values, changes and history', async () => {
    world.grant(alice, GROUP, child)
    world.grant(alice, GROUP, root)
    await request(alice, groupTarget(child), { 'site.tagline': 'Child' })
    await request(alice, groupTarget(root), { 'site.tagline': 'Root' })
    await service.disposeGroup({ groupId: child, correlationId: correlation() })
    const count = async () => (await pool.query(`select count(*)::int as n from "configuration"."value"`)).rows[0].n
    expect(await count()).toBe(1)
    await service.disposeTenant({ tenantId, correlationId: correlation() })
    expect(await count()).toBe(0)
    expect((await pool.query(`select count(*)::int as n from "configuration"."history"`)).rows[0].n).toBe(0)
    expect((await events()).filter(event => event.type === 'configuration.reset')).toHaveLength(2)
  })

  it('shows a group\'s administrators only the group\'s own settings, never a server value set above it', async () => {
    world.grant(alice, TENANT, root)
    world.grant(bob, TENANT, root)
    world.grant(carol, VIEW, child)
    world.join(carol, child)
    const tenantTarget: ConfigurationChangeTarget = { scope: 'tenant', tenantId, governingGroupId: root }
    await approve(bob, await request(alice, tenantTarget, { 'site.host-names': ['acme.example'] }))
    await approve(bob, await request(alice, tenantTarget, { 'site.name': 'Acme', 'site.tagline': 'From the organisation' }))
    const scope = await service.changes.readScope({ subject: at(carol), target: groupTarget(child) })
    const keys = scope.declarations.map(declaration => declaration.key)
    expect(Object.keys(scope.inForce.values).every(key => keys.includes(key))).toBe(true)
    expect(scope.inForce.values).not.toHaveProperty('site.host-names')
    expect(scope.inForce.values).not.toHaveProperty('site.name')
    expect(scope.inForce.values['site.tagline']).toBe('From the organisation')
    expect(scope.inForce.provenance['site.tagline']).toEqual({ source: 'tenant' })
    // The tenant's own administrators still see and edit its server values.
    world.grant(alice, VIEW, root)
    const tenant = await service.changes.readScope({ subject: at(alice), target: tenantTarget })
    expect(tenant.values['site.host-names']).toEqual(['acme.example'])
    expect(tenant.inForce.values['site.host-names']).toEqual(['acme.example'])
  })

  it('lets only those who may change the platform\'s settings read them: viewing the platform group is not enough', async () => {
    // An administrator of the platform group holds every low and medium permission there, but not the critical one.
    world.grant(carol, VIEW, platformGroup)
    world.grant(carol, GROUP, platformGroup)
    world.grant(alice, PLATFORM, platformGroup)
    world.grant(bob, PLATFORM, platformGroup)
    const change = await request(alice, { scope: 'platform' }, { 'site.name': 'Platform' })
    expect(await fail(service.changes.readScope({ subject: at(carol), target: { scope: 'platform' } }))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(service.listHistory({ subject: at(carol), target: { scope: 'platform' } }))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(service.changes.get({ subject: at(carol), changeId: change.changeId }))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(request(carol, { scope: 'platform' }, { 'site.tagline': 'x' }))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(approve(carol, change))).toEqual({ code: 'forbidden', reason: undefined })
    expect((await service.changes.readScope({ subject: at(bob), target: { scope: 'platform' } })).openChanges.map(open => open.changeId)).toEqual([change.changeId])
  })

  it('lets a person change their own account at once, with no approver, over the organisation\'s default', async () => {
    world.account(alice, tenantId)
    world.grant(bob, TENANT, root)
    world.grant(carol, TENANT, root)
    await approve(carol, await request(bob, { scope: 'tenant', tenantId, governingGroupId: root }, { 'notices.digest': 'daily' }))
    expect((await service.getConfiguration({ accountId: alice, visibility: 'members' }))!.provenance['notices.digest']).toEqual({ source: 'tenant' })
    const change = await request(alice, { scope: 'account' }, { 'notices.digest': 'weekly' })
    expect(change).toMatchObject({ target: { scope: 'account' }, route: 'none', status: 'applied', requiredApprovals: 0 })
    const answer = await service.getConfiguration({ accountId: alice, visibility: 'members' })
    expect(answer!.values['notices.digest']).toBe('weekly')
    expect(answer!.provenance['notices.digest']).toEqual({ source: 'account' })
    expect((await service.readForViewer({ subject: at(alice), tenantId: null, account: true })).values['notices.digest']).toBe('weekly')
    // Changes to an account announce the identity and keys only.
    expect((await events()).filter(event => event.type === 'configuration.changed').at(-1)!.data).toMatchObject({ scope: 'account', scopeId: alice, keys: ['notices.digest'] })
  })

  it('never shows or changes an account for anyone but its person, whatever they hold', async () => {
    const personal = world.account(alice, tenantId)
    world.account(bob, tenantId)
    for (const permission of [VIEW, GROUP, TENANT, PLATFORM]) world.grant(bob, permission, personal)
    const change = await request(alice, { scope: 'account' }, { 'notices.digest': 'never' })
    expect(await fail(service.changes.get({ subject: at(bob), changeId: change.changeId }))).toEqual({ code: 'forbidden', reason: undefined })
    // Bob's account is always his own: nothing of Alice's reaches him.
    const own = await service.changes.readScope({ subject: at(bob), target: { scope: 'account' } })
    expect(own.values).toEqual({})
    expect(own.inForce.values['notices.digest']).toBeUndefined()
    expect((await service.readForViewer({ subject: at(bob), tenantId: null, account: true })).values).not.toHaveProperty('notices.digest')
    expect(await fail(service.changes.readScope({ subject: at(carol), target: { scope: 'account' } }))).toEqual({ code: 'forbidden', reason: undefined })
    expect(await fail(request(carol, { scope: 'account' }, { 'notices.digest': 'daily' }))).toEqual({ code: 'forbidden', reason: undefined })
    // Settings an account may not set are refused like any other scope's.
    expect(await fail(request(alice, { scope: 'account' }, { 'site.tagline': 'x' }))).toEqual({ code: 'validation-failed', reason: 'not-settable-here' })
  })

  it('makes a person step up for a high account setting, waits out a recovery hold, and refuses service identities', async () => {
    world.account(alice, tenantId)
    expect(await fail(request(alice, { scope: 'account' }, { 'notices.webhook': 'https://hooks.example/a' }, { strength: 'weak' }))).toEqual({ code: 'insufficient-assurance', reason: undefined })
    world.recoveryHolds.set(alice, new Date(time.getTime() + 24 * HOUR).toISOString())
    const held = await request(alice, { scope: 'account' }, { 'notices.webhook': 'https://hooks.example/a' })
    expect(held).toMatchObject({ route: 'none', status: 'delayed' })
    time = new Date(time.getTime() + 25 * HOUR)
    expect((await service.runMaintenance()).applied).toBe(1)
    // A server value set in the account is shown to its person, never to a page reading values in force.
    expect((await service.changes.readScope({ subject: at(alice), target: { scope: 'account' } })).values['notices.webhook']).toBe('https://hooks.example/a')
    expect((await service.readForViewer({ subject: at(alice), tenantId: null, account: true })).values).not.toHaveProperty('notices.webhook')
    const robot = id()
    world.services.add(robot)
    expect(await fail(request(robot, { scope: 'account' }, { 'notices.digest': 'daily' }))).toEqual({ code: 'forbidden', reason: undefined })
  })

  it('disposes of a closed identity\'s account and exports a person\'s own', async () => {
    world.account(alice, tenantId)
    world.account(bob, tenantId)
    await request(alice, { scope: 'account' }, { 'notices.digest': 'weekly' })
    await request(bob, { scope: 'account' }, { 'notices.digest': 'never' })
    expect((await service.exportAccountData({ identityId: alice })).values).toEqual([expect.objectContaining({ key: 'notices.digest', value: 'weekly' })])
    expect(await service.applyIdentityEvent({ eventId: id(), type: 'identity.closed', occurredAt: time.toISOString(), correlationId: correlation(), actorId: null, data: { identityId: alice, personalGroupId: null } })).toBe(true)
    expect((await service.exportAccountData({ identityId: alice })).values).toEqual([])
    expect((await service.exportAccountData({ identityId: bob })).values).toHaveLength(1)
    expect((await events()).at(-1)).toMatchObject({ type: 'configuration.reset', data: { scope: 'account', scopeId: alice, reasonCode: 'account-closed' } })
  })

  it('moves a scope\'s values to another as a document, through the same approvals', async () => {
    world.grant(alice, GROUP, child)
    world.grant(alice, GROUP, root)
    world.grant(bob, GROUP, root)
    await request(alice, groupTarget(child), { 'site.tagline': 'Exported', 'social.links': [{ network: 'github', url: 'https://github.com/acme' }] })
    const document = await service.exportScope({ scope: { scope: 'group', groupId: child } })
    expect(document).toMatchObject({ format: 'nuxt4-layers.configuration', version: 1, scope: 'group', values: { 'site.tagline': 'Exported' } })
    // A document carries no identifiers of where it came from.
    expect(JSON.stringify(document)).not.toContain(child)

    await request(alice, groupTarget(root), { 'site.tagline': 'Exported' })
    const imported = await service.importDocument({ subject: at(alice), document, target: groupTarget(root), justification: { reasonCode: 'update' }, correlationId: correlation() })
    // Only what differs is requested, and it applies at once at low risk.
    expect(imported).toMatchObject({ keys: ['social.links'], status: 'applied' })
    expect(await fail(service.importDocument({ subject: at(alice), document, target: groupTarget(root), justification: { reasonCode: 'update' }, correlationId: correlation() }))).toEqual({ code: 'validation-failed', reason: 'nothing-to-change' })

    // A high-risk key still needs a second person; nobody without the permission imports anything.
    const legal = { ...document, values: { 'organisation.legal-name': 'Imported Ltd' } }
    expect(await service.importDocument({ subject: at(alice), document: legal, target: groupTarget(root), justification: { reasonCode: 'update' }, correlationId: correlation() })).toMatchObject({ status: 'awaiting', route: 'approvers' })
    expect(await fail(service.importDocument({ subject: at(carol), document: legal, target: groupTarget(root), justification: { reasonCode: 'update' }, correlationId: correlation() }))).toEqual({ code: 'forbidden', reason: undefined })

    // Malformed documents, another kind of scope and undeclared keys are refused, naming only the problem.
    const attempt = (doc: unknown, target: ConfigurationChangeTarget = groupTarget(root)) => fail(service.importDocument({ subject: at(alice), document: doc, target, justification: { reasonCode: 'update' }, correlationId: correlation() }))
    expect(await attempt({ ...document, version: 2 })).toEqual({ code: 'validation-failed', reason: 'unsupported-version' })
    expect(await attempt(document, { scope: 'platform' })).toEqual({ code: 'validation-failed', reason: 'scope-mismatch' })
    expect(await attempt({ ...document, values: { 'shop.currency': 'GBP' } })).toEqual({ code: 'validation-failed', reason: 'unknown-setting' })
    expect(await fail(service.exportScope({ scope: { scope: 'group', groupId: id() } }))).toEqual({ code: 'validation-failed', reason: 'nothing-set' })
    expect(await fail(service.exportScope({ scope: { scope: 'account', identityId: alice } }))).toEqual({ code: 'validation-failed', reason: 'account-not-exportable' })
  })

  it('deletes possibly-personal history and decided changes past the retention period, and nothing else', async () => {
    const short = createConfigurationService({
      pool,
      schema: 'configuration',
      catalogue: () => buildConfigurationCatalogue(CONFIGURATION_SETTINGS, HOST_SETTINGS),
      deployment: () => ({}),
      directory: () => world.directory,
      tenants: () => world.tenantPort,
      governance: () => world.governance,
      access: () => world.access,
      platformGroupId: () => platformGroup,
      clock: () => ({ now: () => time }),
      retentionDays: 30,
    })
    world.grant(alice, GROUP, child)
    world.grant(bob, GROUP, child)
    await request(alice, groupTarget(child), { 'site.tagline': 'Kept', 'contact.general': { email: 'hello@example.org' } })
    const open = await request(alice, groupTarget(child), { 'organisation.legal-name': 'Still open' })
    time = new Date(time.getTime() + 29 * 24 * HOUR)
    expect((await short.runMaintenance()).retention).toEqual({ history: 0, changes: 0 })
    time = new Date(time.getTime() + 2 * 24 * HOUR)
    // The applied change goes; the one that expired was decided only on day 29, so it stays its 30 days.
    const run = await short.runMaintenance()
    expect(run.retention).toEqual({ history: 1, changes: 1 })
    const { rows } = await pool.query(`select "key" from "configuration"."history"`)
    expect(rows.map(row => row.key)).toEqual(['site.tagline'])
    expect((await short.getConfiguration({ groupId: child, visibility: 'public' }))!.values['contact.general']).toEqual({ email: 'hello@example.org' })
    expect((await events()).at(-1)).toMatchObject({ type: 'configuration.retention-applied', data: { history: 1, changes: 1 } })
    const { rows: kept } = await pool.query(`select "status" from "configuration"."change" where "change_id" = $1`, [open.changeId])
    expect(kept).toEqual([{ status: 'expired' }])
  })

  it('relays the outbox in order, at least once', async () => {
    world.grant(alice, GROUP, child)
    await request(alice, groupTarget(child), { 'site.tagline': 'x' })
    const published: string[] = []
    expect(await service.relayOutbox({ publish: async (event) => { published.push(event.type) } })).toBe(3)
    expect(published).toEqual(['configuration.change-requested', 'configuration.change-decided', 'configuration.changed'])
    expect(await service.relayOutbox({ publish: async () => {} })).toBe(0)
  })

  it('answers null for a deleted group or a closed tenant', async () => {
    world.groups.get(child)!.state = 'deleted'
    expect(await service.getConfiguration({ groupId: child, visibility: 'public' })).toBeNull()
    world.tenants.set(tenantId, 'closed')
    expect(await service.getConfiguration({ tenantId, visibility: 'public' })).toBeNull()
  })
})
