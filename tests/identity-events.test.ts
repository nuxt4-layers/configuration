import pg from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildConfigurationCatalogue, CONFIGURATION_SETTINGS, ConfigurationFailure } from '../shared/contracts'
import { runConfigurationMigrations } from '../server/database/migrations'
import { createConfigurationService } from '../server/internal/service'
import { createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'
import { correlation, id, person, World } from './support/world'

requireDatabaseInCi()

describe.skipIf(!hasDatabase)('Identity\'s events: tenant states and disposal (PostgreSQL)', () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>
  let pool: pg.Pool
  let world: World
  let service: ReturnType<typeof createConfigurationService>
  let tenantId: string
  let root: string
  let team: string
  const alice = id()

  const event = (type: string, data: Record<string, unknown>, eventId = id()) => ({ eventId, type, occurredAt: new Date().toISOString(), correlationId: correlation(), actorId: null, data })
  const count = async (table: string) => (await pool.query(`select count(*)::int as n from "configuration"."${table}"`)).rows[0].n as number
  const tagline = (groupId: string) => service.changes.request({
    subject: person(alice, new Date()),
    request: { target: { scope: 'group', groupId }, set: { 'site.tagline': 'x' }, expected: { 'site.tagline': null }, justification: { reasonCode: 'update' } },
    correlationId: correlation(),
  })

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
    await pool.query('truncate "configuration"."value", "configuration"."change", "configuration"."approval", "configuration"."history", "configuration"."outbox", "configuration"."tenant", "configuration"."processed_event"')
    world = new World()
    tenantId = world.tenant()
    root = world.group(tenantId)
    team = world.group(tenantId, root)
    world.grant(alice, 'configuration.group-settings:manage', team)
    world.grant(alice, 'configuration.group-settings:manage', root)
    service = createConfigurationService({
      pool,
      schema: 'configuration',
      catalogue: () => buildConfigurationCatalogue(CONFIGURATION_SETTINGS),
      deployment: () => ({}),
      directory: () => world.directory,
      // No tenants port: the states come from Identity's events.
      tenants: () => null,
      governance: () => world.governance,
      access: () => world.access,
      platformGroupId: () => world.group(world.tenant()),
      clock: () => ({ now: () => new Date() }),
    })
  })

  it('knows a tenant only once Identity announces it, and follows it through closing', async () => {
    expect(await service.getConfiguration({ tenantId, visibility: 'public' })).toBeNull()
    expect(await service.applyIdentityEvent(event('tenant.created', { tenantId, jurisdiction: 'gb', dataRegion: 'uk' }))).toBe(true)
    expect(await service.getConfiguration({ tenantId, visibility: 'public' })).not.toBeNull()
    expect((await tagline(team)).status).toBe('applied')

    await service.applyIdentityEvent(event('tenant.closing', { tenantId, closesAt: new Date(Date.now() + 86_400_000).toISOString() }))
    await expect(tagline(team)).rejects.toMatchObject({ code: 'conflict', reason: 'scope-closing' })
    await service.applyIdentityEvent(event('tenant.closing-cancelled', { tenantId }))
    // Open again: the request now reaches the value check (the tagline was set above).
    await expect(tagline(team)).rejects.toMatchObject({ code: 'conflict', reason: 'values-changed' })
  })

  it('applies each event once', async () => {
    const created = event('tenant.created', { tenantId, jurisdiction: 'gb', dataRegion: 'uk' })
    expect(await service.applyIdentityEvent(created)).toBe(true)
    expect(await service.applyIdentityEvent(created)).toBe(false)
    expect(await count('processed_event')).toBe(1)
  })

  it('disposes of a deleted group\'s values only when its disposal is due, never while deferred', async () => {
    await service.syncTenants([{ tenantId, state: 'active' }])
    await tagline(team)
    await service.applyIdentityEvent(event('group.deleted', { groupId: team, tenantId, kind: 'standard', disposal: 'deferred', changeId: null }))
    expect(await count('value')).toBe(1)
    await service.applyIdentityEvent(event('group.disposal-due', { groupId: team, tenantId }))
    expect(await count('value')).toBe(0)
    expect(await count('history')).toBe(0)
  })

  it('disposes of a closed tenant\'s values and its groups\', and the tenant stays closed', async () => {
    await service.syncTenants([{ tenantId, state: 'active' }])
    await tagline(team)
    await tagline(root)
    await service.applyIdentityEvent(event('tenant.closed', { tenantId, disposal: 'due' }))
    expect(await count('value')).toBe(0)
    expect(await service.getConfiguration({ tenantId, visibility: 'public' })).toBeNull()
    await service.applyIdentityEvent(event('tenant.closing-cancelled', { tenantId }))
    expect(await service.getConfiguration({ tenantId, visibility: 'public' })).toBeNull()
  })

  it('ignores Identity\'s other events and refuses malformed ones', async () => {
    expect(await service.applyIdentityEvent(event('membership.added', { membershipId: id() }))).toBe(false)
    await expect(service.applyIdentityEvent(event('group.disposal-due', { groupId: 'not-an-id', tenantId }))).rejects.toBeInstanceOf(ConfigurationFailure)
    expect(await count('processed_event')).toBe(0)
  })
})
