import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { buildConfigurationCatalogue, CONFIGURATION_SETTINGS, resolveConfiguration } from '../contracts'

const catalogue = buildConfigurationCatalogue(CONFIGURATION_SETTINGS, [
  { key: 'shop.currency', schema: z.string(), scopes: ['platform', 'tenant', 'group'], inherits: 'none', visibility: 'public', sensitivity: 'organisational', risk: 'low', default: 'GBP' },
  { key: 'shop.region', schema: z.string(), scopes: ['platform'], visibility: 'public', sensitivity: 'organisational', risk: 'low', locked: true },
  { key: 'shop.webhook-path', schema: z.string(), scopes: ['platform'], visibility: 'server', sensitivity: 'organisational', risk: 'medium' },
])

describe('Resolving the values in force', () => {
  it('takes the group, then its ancestors, then the tenant, platform, deployment and default, with provenance', () => {
    const answer = resolveConfiguration(catalogue, {
      deployment: { 'site.name': 'Deployed', 'site.tagline': 'Deployed tagline' },
      platform: { 'site.name': 'Platform', 'organisation.legal-name': 'Platform Ltd' },
      tenant: { 'site.name': 'Tenant', 'organisation.legal-name': 'Tenant Ltd' },
      lineage: [
        { groupId: 'child', values: {} },
        { groupId: 'root', values: { 'organisation.legal-name': 'Root Ltd' } },
      ],
    }, { visibility: 'members' })
    expect(answer.values['organisation.legal-name']).toBe('Root Ltd')
    expect(answer.provenance['organisation.legal-name']).toEqual({ source: 'group', groupId: 'root' })
    expect(answer.values['site.name']).toBe('Tenant')
    expect(answer.provenance['site.name']).toEqual({ source: 'tenant' })
    expect(answer.provenance['site.tagline']).toEqual({ source: 'deployment' })
    expect(answer.provenance['site.default-locale']).toEqual({ source: 'default' })
    expect(answer.values).not.toHaveProperty('site.logo')
  })

  it('never takes a group value for a setting groups may not set', () => {
    const answer = resolveConfiguration(catalogue, { deployment: {}, platform: {}, lineage: [{ groupId: 'g', values: { 'site.name': 'Group' } }] }, { visibility: 'members' })
    expect(answer.values).not.toHaveProperty('site.name')
  })

  it('skips ancestors for a setting that does not inherit', () => {
    const answer = resolveConfiguration(catalogue, {
      deployment: {},
      platform: {},
      tenant: { 'shop.currency': 'EUR' },
      lineage: [{ groupId: 'child', values: {} }, { groupId: 'root', values: { 'shop.currency': 'USD' } }],
    }, { visibility: 'members' })
    expect(answer.values['shop.currency']).toBe('EUR')
  })

  it('takes a locked setting only from the deployment', () => {
    const locked = resolveConfiguration(catalogue, { deployment: { 'shop.region': 'eu' }, platform: { 'shop.region': 'us' } }, { visibility: 'server' })
    expect(locked.values['shop.region']).toBe('eu')
    expect(locked.provenance['shop.region']).toEqual({ source: 'locked' })
  })

  it('answers only up to the visibility asked', () => {
    const layers = { deployment: { 'shop.webhook-path': '/hooks' }, platform: {} }
    expect(resolveConfiguration(catalogue, layers, { visibility: 'public' }).values).not.toHaveProperty('shop.webhook-path')
    expect(resolveConfiguration(catalogue, layers, { visibility: 'server' }).values['shop.webhook-path']).toBe('/hooks')
  })

  it('answers only the keys asked', () => {
    const answer = resolveConfiguration(catalogue, { deployment: {}, platform: { 'site.name': 'P', 'site.tagline': 'T' } }, { keys: ['site.name'], visibility: 'public' })
    expect(Object.keys(answer.values)).toEqual(['site.name'])
  })
})
