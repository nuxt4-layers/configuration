import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { toPosix } from './support/paths'
import * as contracts from '../shared/contracts'

const root = normalize(join(import.meta.dirname, '..'))

function files(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter(file => file.endsWith('.ts'))
    .map(file => toPosix(join(dir, file)))
}

function imports(file: string): string[] {
  const source = readFileSync(join(root, file), 'utf8')
  return [...source.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(([, specifier]) =>
    specifier!.startsWith('.') ? toPosix(relative(root, join(root, dirname(file), specifier!))) : specifier!)
}

const contractFiles = files('shared')
const catalogue = contracts.buildConfigurationCatalogue(contracts.CONFIGURATION_SETTINGS)

describe('Configuration public contract', () => {
  it('imports nothing but zod and its own modules', () => {
    for (const file of contractFiles) {
      for (const target of imports(file)) {
        expect(target === 'zod' || /^shared\//.test(target), `${file} imports ${target}`).toBe(true)
      }
    }
  })

  it('never imports another layer, member or the server', () => {
    for (const file of [...contractFiles, ...files('server')]) {
      for (const target of imports(file)) expect(/^@nuxt4-layers\//.test(target), `${file} imports ${target}`).toBe(false)
    }
  })

  it('builds the layer\'s catalogue, with every default valid', () => {
    expect([...catalogue.keys()]).toContain('organisation.legal-name')
    expect(catalogue.get('site.default-locale')!.default).toBe('en-GB')
  })

  it('marks what a regulator, customer or court relies on as high risk', () => {
    for (const key of ['organisation.legal-name', 'organisation.registration', 'organisation.tax-number', 'organisation.registered-address', 'legal.links', 'contact.data-protection']) {
      expect(catalogue.get(key)!.risk, key).toBe('high')
    }
  })

  it('marks addresses and contact points as possibly personal', () => {
    for (const key of ['organisation.registered-address', 'organisation.postal-address', 'contact.general', 'contact.data-protection']) {
      expect(catalogue.get(key)!.sensitivity, key).toBe('possibly-personal')
    }
  })

  it('refuses a host declaring in a reserved namespace, twice, without scopes, or with an invalid default', () => {
    const own = contracts.CONFIGURATION_SETTINGS
    const base = { schema: z.string(), scopes: ['platform'] as const, visibility: 'public' as const, sensitivity: 'organisational' as const, risk: 'low' as const }
    expect(() => contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'site.colour' }])).toThrow(/reserved/)
    expect(() => contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'shop.currency' }, { ...base, key: 'shop.currency' }])).toThrow(/twice/)
    expect(() => contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'shop.currency', scopes: [] }])).toThrow(/scope/)
    expect(() => contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'shop.currency', default: 3 as unknown as string }])).toThrow(/default/)
    expect(() => contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'Shop' }])).toThrow(/namespace/)
    expect(contracts.buildConfigurationCatalogue(own, [{ ...base, key: 'shop.currency' }]).has('shop.currency')).toBe(true)
  })

  it('carries no value in any event: identifiers, keys and codes only', () => {
    const envelope = { eventId: '01928c4e-0000-7000-8000-000000000001', occurredAt: '2026-10-20T12:00:00.000Z', correlationId: '01928c4e-0000-7000-8000-0000000000aa', actorId: null }
    const data = { scope: 'tenant', scopeId: '01928c4e-0000-7000-8000-000000000002', keys: ['organisation.legal-name'], changeId: '01928c4e-0000-7000-8000-000000000003' }
    expect(contracts.configurationEventSchema.safeParse({ ...envelope, type: 'configuration.changed', data }).success).toBe(true)
    expect(contracts.configurationEventSchema.safeParse({ ...envelope, type: 'configuration.changed', data: { ...data, value: 'Acme Ltd' } }).success).toBe(false)
    expect(contracts.configurationEventSchema.safeParse({ ...envelope, type: 'configuration.changed', data: { ...data, keys: ['Acme Ltd'] } }).success).toBe(false)
  })

  it('needs a second person for high and critical changes whatever a group asks, and lets groups raise it', () => {
    expect(contracts.requiredApprovals('low', 0)).toBe(0)
    expect(contracts.requiredApprovals('high', 0)).toBe(1)
    expect(contracts.requiredApprovals('critical', 2)).toBe(2)
    expect(contracts.requiredApprovals('medium', 1)).toBe(1)
  })

  it('requires aal2 for high, and phishing-resistant aal2 within 15 minutes for critical', () => {
    const now = new Date('2026-10-20T12:00:00Z')
    const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString()
    expect(contracts.meetsStepUp('medium', { level: 'aal1', phishingResistant: false, authenticatedAt: at(600) }, now)).toBe(true)
    expect(contracts.meetsStepUp('high', { level: 'aal1', phishingResistant: false, authenticatedAt: at(0) }, now)).toBe(false)
    expect(contracts.meetsStepUp('high', { level: 'aal2', phishingResistant: false, authenticatedAt: at(600) }, now)).toBe(true)
    expect(contracts.meetsStepUp('critical', { level: 'aal2', phishingResistant: false, authenticatedAt: at(1) }, now)).toBe(false)
    expect(contracts.meetsStepUp('critical', { level: 'aal2', phishingResistant: true, authenticatedAt: at(16) }, now)).toBe(false)
    expect(contracts.meetsStepUp('critical', { level: 'aal2', phishingResistant: true, authenticatedAt: at(5) }, now)).toBe(true)
  })

  it('makes canonical JSON independent of key order', () => {
    expect(contracts.canonicalJson({ b: 1, a: [{ d: 2, c: null }] })).toBe(contracts.canonicalJson({ a: [{ c: null, d: 2 }], b: 1 }))
  })
})

describe('Setting values', () => {
  const check = (key: string, value: unknown) => catalogue.get(key)!.schema.safeParse(value)

  it('normalises safe text and refuses control and format characters', () => {
    expect(check('site.name', '  Acme   Widgets ').data).toBe('Acme Widgets')
    expect(check('site.name', 'Acme‮Widgets').success).toBe(false)
    expect(check('site.name', '').success).toBe(false)
    expect(check('site.name', 'x'.repeat(81)).success).toBe(false)
  })

  it('takes only https links or site paths, never script or credentials', () => {
    const links = (privacy: string) => check('legal.links', { privacy, terms: '/terms' })
    expect(links('https://example.org/privacy').success).toBe(true)
    expect(links('/legal/privacy').success).toBe(true)
    expect(links('javascript:alert(1)').success).toBe(false)
    expect(links('http://example.org').success).toBe(false)
    expect(links('https://user:secret@example.org').success).toBe(false)
    expect(links('//evil.example').success).toBe(false)
    expect(links('/../etc').success).toBe(false)
  })

  it('checks addresses, contact points and social links strictly', () => {
    expect(check('organisation.registered-address', { lines: ['1 High Street'], locality: 'Leeds', postcode: 'LS1 1AA', country: 'GB' }).success).toBe(true)
    expect(check('organisation.registered-address', { lines: [], country: 'GB' }).success).toBe(false)
    expect(check('organisation.registered-address', { lines: ['1 High Street'], country: 'GB', name: 'Jane' }).success).toBe(false)
    expect(check('contact.general', {}).success).toBe(false)
    expect(check('contact.data-protection', { email: 'dpo@example.org', identityId: '01928c4e-0000-7000-8000-000000000002' }).success).toBe(true)
    expect(check('contact.data-protection', { name: 'Jane Smith' }).success).toBe(false)
    expect(check('social.links', [{ network: 'mastodon', url: 'https://mastodon.social/@acme' }]).success).toBe(true)
    expect(check('social.links', [{ network: 'myspace', url: 'https://myspace.com/acme' }]).success).toBe(false)
  })

  it('needs exactly one placeholder in the title template', () => {
    expect(check('seo.title-template', '%s · Acme').success).toBe(true)
    expect(check('seo.title-template', 'Acme').success).toBe(false)
    expect(check('seo.title-template', '%s %s').success).toBe(false)
  })
})
