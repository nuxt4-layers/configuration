import { readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { EventHandler, H3Event } from 'h3'
import { createApp, createRouter, defineEventHandler, getRequestHeader, toWebHandler } from 'h3'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runConfigurationMigrations } from '../server/database/migrations'
import { originRejected, configurationHttpError } from '../server/internal/http'
import {
  clearConfigurationComposition,
  provideConfigurationAccessDecision,
  provideConfigurationDatabase,
  provideConfigurationDirectory,
  provideConfigurationGovernance,
  provideConfigurationPlatformGroup,
  provideConfigurationSubjectResolver,
  provideConfigurationTenants,
} from '../server/utils/configuration-composition'
import { createTestDatabase, hasDatabase, requireDatabaseInCi } from './support/database'
import { toPosix } from './support/paths'
import { id, World } from './support/world'

requireDatabaseInCi()

const API = fileURLToPath(new URL('../server/api/configuration', import.meta.url))
const GROUP = 'configuration.group-settings:manage'
const TENANT = 'configuration.tenant-settings:manage'

/** Every endpoint file, routed as Nuxt routes it: `[param]` → `:param`, method from the suffix. */
function endpointFiles(directory: string = API): { file: string, method: string, route: string }[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return endpointFiles(path)
    const match = /^(.*)\.(get|post|put|patch|delete)\.ts$/.exec(toPosix(relative(API, path)))
    if (!match) throw new Error(`Unexpected file in server/api/configuration: ${entry.name}`)
    const route = `/api/configuration/${match[1]!}`.replace(/\[(\w+)\]/g, ':$1').replace(/\/index$/, '')
    return [{ file: path, method: match[2]!, route }]
  })
}

describe.skipIf(!hasDatabase)('the /api/configuration endpoints', () => {
  let pool: pg.Pool
  let drop: () => Promise<void>
  let handler: (request: Request) => Promise<Response>
  let world: World
  let resolverFails = false
  let tenantA: string
  let tenantB: string
  let rootA: string
  let teamA: string
  let rootB: string
  const alice = id()
  const bob = id()
  const carol = id()
  const dave = id()

  async function call(method: string, url: string, options: { as?: string, body?: unknown, origin?: string | null, headers?: Record<string, string> } = {}) {
    const target = new URL(url)
    const headers: Record<string, string> = { 'content-type': 'application/json', 'host': target.host, ...options.headers }
    if (options.as) headers['x-test-subject'] = options.as
    const origin = options.origin === undefined ? target.origin : options.origin
    if (origin) headers.origin = origin
    const response = await handler(new Request(url, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) }))
    const text = await response.text()
    const json = text ? JSON.parse(text) : null
    return { status: response.status, data: json?.data ?? json, headers: response.headers }
  }

  async function seed(scope: 'platform' | 'tenant' | 'group', scopeId: string, tenantId: string | null, values: Record<string, unknown>) {
    for (const [key, value] of Object.entries(values)) {
      await pool.query(`insert into "configuration"."value" ("scope", "scope_id", "tenant_id", "key", "value", "change_id", "updated_at") values ($1, $2, $3, $4, $5::jsonb, $6, now())`, [scope, scopeId, tenantId, key, JSON.stringify(value), id()])
    }
  }

  beforeAll(async () => {
    const database = await createTestDatabase()
    drop = database.drop
    pool = new pg.Pool({ connectionString: database.url })
    await runConfigurationMigrations(pool, 'configuration')
    const app = createApp()
    const router = createRouter()
    app.use(defineEventHandler((event) => {
      if (originRejected(event)) throw configurationHttpError('forbidden')
    }))
    for (const endpoint of endpointFiles()) {
      const module = await import(endpoint.file) as { default: EventHandler }
      router[endpoint.method as 'get' | 'post'](endpoint.route, module.default)
    }
    app.use(router)
    handler = toWebHandler(app)
  })

  afterAll(async () => {
    clearConfigurationComposition()
    await pool?.end()
    await drop?.()
  })

  beforeEach(async () => {
    await pool.query('truncate "configuration"."value", "configuration"."change", "configuration"."approval", "configuration"."history", "configuration"."outbox"')
    clearConfigurationComposition()
    resolverFails = false
    world = new World()
    tenantA = world.tenant()
    tenantB = world.tenant()
    rootA = world.group(tenantA)
    teamA = world.group(tenantA, rootA)
    rootB = world.group(tenantB)
    world.risks.set(TENANT, 'high')
    provideConfigurationDatabase({ dialect: 'postgres', pool })
    provideConfigurationDirectory(world.directory)
    provideConfigurationTenants(world.tenantPort)
    provideConfigurationGovernance(world.governance)
    provideConfigurationAccessDecision(world.access)
    provideConfigurationPlatformGroup(world.group(world.tenant()))
    provideConfigurationSubjectResolver({
      async resolve(event) {
        if (resolverFails) throw new Error('authentication is down')
        const identityId = getRequestHeader(event as H3Event, 'x-test-subject')
        return identityId ? { identityId, kind: 'person', assurance: { level: 'aal2', phishingResistant: true, authenticatedAt: new Date().toISOString() } } : null
      },
    })
    await seed('platform', '', null, { 'site.name': 'Platform', 'site.tagline': 'Platform tagline' })
    await seed('tenant', tenantA, tenantA, { 'site.name': 'Acme', 'site.host-names': ['acme.test', 'www.acme.test'] })
    await seed('tenant', tenantB, tenantB, { 'site.name': 'Bravo', 'site.host-names': ['bravo.test'] })
  })

  it('answers the public values of the tenant a host name resolves to, never its host names', async () => {
    const acme = await call('GET', 'http://acme.test/api/configuration/public')
    expect(acme.status).toBe(200)
    expect(acme.data.values['site.name']).toBe('Acme')
    expect(acme.data.values).not.toHaveProperty('site.host-names')
    expect(acme.headers.get('cache-control')).toBe('public, max-age=60')
    expect((await call('GET', 'http://WWW.Acme.test:3000/api/configuration/public')).data.values['site.name']).toBe('Acme')
    expect((await call('GET', 'http://bravo.test/api/configuration/public')).data.values['site.name']).toBe('Bravo')
    expect((await call('GET', 'http://unknown.test/api/configuration/public')).data.values['site.name']).toBe('Platform')
  })

  it('ignores X-Forwarded-Host unless the host trusts it', async () => {
    const forwarded = await call('GET', 'http://bravo.test/api/configuration/public', { headers: { 'x-forwarded-host': 'acme.test' } })
    expect(forwarded.data.values['site.name']).toBe('Bravo')
  })

  it('answers 304 to a matching ETag', async () => {
    const first = await call('GET', 'http://acme.test/api/configuration/public')
    const again = await call('GET', 'http://acme.test/api/configuration/public', { headers: { 'if-none-match': first.headers.get('etag')! } })
    expect(again.status).toBe(304)
  })

  it('never serves a group\'s values anonymously, and serves them to members by what they may see', async () => {
    await seed('group', teamA, tenantA, { 'site.tagline': 'Team tagline' })
    expect((await call('GET', 'http://acme.test/api/configuration/public')).data.values['site.tagline']).toBe('Platform tagline')
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`)).status).toBe(401)

    world.join(alice, teamA)
    const member = await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`, { as: alice })
    expect(member.status).toBe(200)
    expect(member.data.values['site.tagline']).toBe('Team tagline')
    expect(member.data.provenance['site.tagline']).toEqual({ source: 'group', groupId: teamA })

    world.join(bob, rootA)
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`, { as: bob })).data.values['site.tagline']).toBe('Team tagline')
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`, { as: carol })).status).toBe(403)
    // A group of another tenant is not reachable on this tenant's host name.
    world.join(carol, rootB)
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${rootB}`, { as: carol })).status).toBe(403)
  })

  it('refuses state-changing requests without an Origin on the request\'s own host', async () => {
    const body = { target: { scope: 'group', groupId: teamA }, set: { 'site.tagline': 'x' }, expected: { 'site.tagline': null }, justification: { reasonCode: 'rebrand' } }
    world.grant(alice, GROUP, teamA)
    expect((await call('POST', 'http://acme.test/api/configuration/changes', { as: alice, body, origin: null })).status).toBe(403)
    expect((await call('POST', 'http://acme.test/api/configuration/changes', { as: alice, body, origin: 'http://evil.test' })).status).toBe(403)
    expect((await call('POST', 'http://acme.test/api/configuration/changes', { as: alice, body })).status).toBe(200)
  })

  it('runs a high change through approval over HTTP', async () => {
    world.grant(alice, GROUP, teamA)
    world.grant(bob, GROUP, teamA)
    world.join(alice, teamA)
    const requested = await call('POST', 'http://acme.test/api/configuration/changes', {
      as: alice,
      body: { target: { scope: 'group', groupId: teamA }, set: { 'organisation.legal-name': 'Acme Team Ltd' }, expected: { 'organisation.legal-name': null }, justification: { reasonCode: 'incorporation' } },
    })
    expect(requested.status).toBe(202)
    expect(requested.data).toMatchObject({ status: 'awaiting', route: 'approvers', risk: 'high' })
    const { changeId, digest } = requested.data

    expect((await call('POST', `http://acme.test/api/configuration/changes/${changeId}/decision`, { as: alice, body: { changeDigest: digest, decision: 'approve' } })).data).toMatchObject({ code: 'conflict', reason: 'own-request' })
    expect((await call('GET', `http://bravo.test/api/configuration/changes/${changeId}`, { as: bob })).status).toBe(403)
    const decided = await call('POST', `http://acme.test/api/configuration/changes/${changeId}/decision`, { as: bob, body: { changeDigest: digest, decision: 'approve' } })
    expect(decided.data.status).toBe('applied')
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`, { as: alice })).data.values['organisation.legal-name']).toBe('Acme Team Ltd')

    const history = await call('GET', `http://acme.test/api/configuration/history?scope=group&groupId=${teamA}`, { as: alice })
    expect(history.status).toBe(403)
    world.grant(alice, 'configuration.settings:view', teamA)
    expect((await call('GET', `http://acme.test/api/configuration/history?scope=group&groupId=${teamA}`, { as: alice })).data).toEqual([expect.objectContaining({ key: 'organisation.legal-name', changeId })])
  })

  it('administers a tenant only on its own host names', async () => {
    world.grant(dave, TENANT, rootB)
    world.grant(dave, 'configuration.settings:view', rootB)
    const body = { target: { scope: 'tenant', tenantId: tenantB, governingGroupId: rootB }, set: { 'site.tagline': 'x' }, expected: { 'site.tagline': null }, justification: { reasonCode: 'rebrand' } }
    expect((await call('POST', 'http://acme.test/api/configuration/changes', { as: dave, body })).status).toBe(403)
    expect((await call('GET', `http://acme.test/api/configuration/admin?scope=tenant&governingGroupId=${rootB}`, { as: dave })).status).toBe(403)
    const admin = await call('GET', `http://bravo.test/api/configuration/admin?scope=tenant&governingGroupId=${rootB}`, { as: dave })
    expect(admin.status).toBe(200)
    expect(admin.data.values['site.host-names']).toEqual(['bravo.test'])
    // Another tenant's host cannot name this tenant in the query either.
    expect((await call('GET', `http://acme.test/api/configuration/admin?scope=tenant&tenantId=${tenantB}&governingGroupId=${rootB}`, { as: dave })).status).toBe(403)
  })

  it('administers any scope Authorisation allows on the platform\'s own host name, where a tenant gets its first one', async () => {
    world.grant(dave, TENANT, rootB)
    world.grant(carol, TENANT, rootB)
    world.grant(dave, 'configuration.settings:view', rootB)
    await pool.query(`delete from "configuration"."value" where "key" = 'site.host-names' and "scope_id" = $1`, [tenantB])
    const admin = await call('GET', `http://platform.test/api/configuration/admin?scope=tenant&tenantId=${tenantB}&governingGroupId=${rootB}`, { as: dave })
    expect(admin.status).toBe(200)
    const claim = await call('POST', 'http://platform.test/api/configuration/changes', {
      as: dave,
      body: { target: { scope: 'tenant', tenantId: tenantB, governingGroupId: rootB }, set: { 'site.host-names': ['bravo.example'] }, expected: { 'site.host-names': null }, justification: { reasonCode: 'new-domain' } },
    })
    expect(claim.data).toMatchObject({ status: 'awaiting', route: 'approvers' })
    expect((await call('POST', `http://platform.test/api/configuration/changes/${claim.data.changeId}/decision`, { as: carol, body: { changeDigest: claim.data.digest, decision: 'approve' } })).data.status).toBe('applied')
    expect((await call('GET', 'http://bravo.example/api/configuration/public')).data.values['site.name']).toBe('Bravo')
    // Without the permission, the platform's host reaches nothing.
    expect((await call('GET', `http://platform.test/api/configuration/admin?scope=tenant&tenantId=${tenantB}&governingGroupId=${rootB}`, { as: alice })).status).toBe(403)
  })

  it('refuses a host name another tenant answers on', async () => {
    world.grant(dave, TENANT, rootB)
    world.grant(carol, TENANT, rootB)
    const admin = await call('GET', `http://bravo.test/api/configuration/admin?scope=tenant&governingGroupId=${rootB}`, { as: dave })
    expect(admin.status).toBe(403)
    world.grant(dave, 'configuration.settings:view', rootB)
    const { digests } = (await call('GET', `http://bravo.test/api/configuration/admin?scope=tenant&governingGroupId=${rootB}`, { as: dave })).data
    const claim = await call('POST', 'http://bravo.test/api/configuration/changes', {
      as: dave,
      body: { target: { scope: 'tenant', tenantId: tenantB, governingGroupId: rootB }, set: { 'site.host-names': ['bravo.test', 'acme.test'] }, expected: { 'site.host-names': digests['site.host-names'] }, justification: { reasonCode: 'new-domain' } },
    })
    expect(claim.status).toBe(409)
    expect(claim.data).toMatchObject({ code: 'conflict', reason: 'host-taken' })
  })

  it('stays coarse: unknown changes are forbidden, bad bodies name only a problem code', async () => {
    world.grant(alice, GROUP, teamA)
    expect((await call('GET', `http://acme.test/api/configuration/changes/${id()}`, { as: alice })).status).toBe(403)
    expect((await call('GET', 'http://acme.test/api/configuration/changes/not-an-id', { as: alice })).status).toBe(403)
    const extra = await call('POST', 'http://acme.test/api/configuration/changes', { as: alice, body: { target: { scope: 'group', groupId: teamA }, set: { 'site.tagline': 'x' }, expected: { 'site.tagline': null }, justification: { reasonCode: 'rebrand' }, actor: bob } })
    expect(extra.status).toBe(400)
    const bad = await call('POST', 'http://acme.test/api/configuration/changes', { as: alice, body: { target: { scope: 'group', groupId: teamA }, set: { 'legal.links': { privacy: 'javascript:alert(1)', terms: '/t' } }, expected: { 'legal.links': null }, justification: { reasonCode: 'rebrand' } } })
    expect(bad.data).toEqual({ code: 'validation-failed', messageKey: 'configuration.error.validation-failed', reason: 'not-a-link' })
    expect((await call('GET', 'http://acme.test/api/configuration')).status).toBe(401)
  })

  it('fails closed when the subject resolver or a port fails', async () => {
    resolverFails = true
    expect((await call('GET', 'http://acme.test/api/configuration', { as: alice })).status).toBe(503)
    resolverFails = false
    world.join(alice, teamA)
    world.failing = true
    expect((await call('GET', `http://acme.test/api/configuration?groupId=${teamA}`, { as: alice })).status).toBe(503)
    clearConfigurationComposition()
    expect((await call('GET', 'http://acme.test/api/configuration/public')).status).toBe(503)
  })
})
