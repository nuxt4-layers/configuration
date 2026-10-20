import pg from 'pg'
import { z } from 'zod'
import { getCookie } from 'h3'
import type { H3Event } from 'h3'
import { defineConfigurationSetting, UUID_V7_PATTERN } from '../../../shared/contracts'
import { World } from '../../../tests/support/world'

/**
 * The playground's composition, as a host's Nitro plugin would be.
 *
 * By default nobody is signed in and, with `PLAYGROUND_DATABASE_URL`, only
 * the database is supplied: it only proves the layer composes.
 *
 * With CONFIGURATION_PLAYGROUND_TEST=1 (browser tests only), Identity and
 * Authorisation are the in-memory stand-ins the tests use, the signed-in
 * identity comes from the `configuration_playground_subject` cookie
 * (standing in for Authentication), and `/api/__playground/seed` sets the
 * scene. None of it is fit for production.
 */
export const testMode = process.env.CONFIGURATION_PLAYGROUND_TEST === '1'
export const world = new World()
export let pool: pg.Pool | null = null

export default defineNitroPlugin(async () => {
  // A host's own setting, chosen per account (and defaulted by the platform or an organisation).
  provideConfigurationCatalogue([
    defineConfigurationSetting({ key: 'notices.digest', schema: z.enum(['daily', 'weekly', 'never']), scopes: ['platform', 'tenant', 'account'], visibility: 'members', sensitivity: 'organisational', risk: 'low', default: 'weekly' }),
  ])
  provideConfigurationDeployment({ 'site.name': 'Configuration playground', 'seo.title-template': '%s · Configuration playground' })
  provideConfigurationSubjectResolver({
    async resolve(event) {
      if (!testMode) return null
      const identityId = getCookie(event as H3Event, 'configuration_playground_subject')
      if (!identityId || !UUID_V7_PATTERN.test(identityId)) return null
      return { identityId, kind: 'person', assurance: { level: 'aal2', phishingResistant: true, authenticatedAt: new Date().toISOString() } }
    },
  })
  const url = process.env.PLAYGROUND_DATABASE_URL
  if (!url) return
  pool = new pg.Pool({ connectionString: url })
  provideConfigurationDatabase({ dialect: 'postgres', pool })
  await migrateConfigurationDatabase()
  if (!testMode) return
  provideConfigurationDirectory(world.directory)
  provideConfigurationTenants(world.tenantPort)
  provideConfigurationGovernance(world.governance)
  provideConfigurationAccessDecision(world.access)
  provideConfigurationPlatformGroup(world.group(world.tenant()))
})
