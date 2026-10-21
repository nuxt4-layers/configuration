import { z } from 'zod'
import type { ConfigurationScopeKind, ConfigurationSettingDeclaration } from './settings'
import { defineConfigurationSetting } from './settings'
import { identifierSchema } from './identifiers'
import {
  assetReferenceSchema,
  codeSchema,
  contactPointSchema,
  emailSchema,
  httpsUrlSchema,
  hostNameSchema,
  linkSchema,
  localeSchema,
  phoneNumberSchema,
  postalAddressSchema,
  safeTextSchema,
} from './values'

/** The layer's own catalogue (docs/contracts.md §3.2). */

const ALL: readonly ConfigurationScopeKind[] = ['platform', 'tenant', 'group']
const ABOVE_GROUPS: readonly ConfigurationScopeKind[] = ['platform', 'tenant']

/** Networks for `social.links`. */
export const SOCIAL_NETWORKS = ['bluesky', 'facebook', 'github', 'instagram', 'linkedin', 'mastodon', 'threads', 'tiktok', 'x', 'youtube', 'other'] as const

export const CONFIGURATION_SETTINGS: readonly ConfigurationSettingDeclaration[] = [
  defineConfigurationSetting({ key: 'site.name', schema: safeTextSchema({ max: 80 }), scopes: ABOVE_GROUPS, visibility: 'public', sensitivity: 'organisational', risk: 'medium' }),
  // The host names a tenant answers on: requests to them resolve to the tenant.
  // Unique across tenants; never served over HTTP.
  defineConfigurationSetting({
    key: 'site.host-names',
    schema: z.array(hostNameSchema).min(1).max(10).refine(names => new Set(names).size === names.length, 'duplicate-host-name'),
    scopes: ['tenant'],
    visibility: 'server',
    sensitivity: 'organisational',
    risk: 'high',
  }),
  defineConfigurationSetting({ key: 'site.tagline', schema: safeTextSchema({ max: 160 }), scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'low' }),
  defineConfigurationSetting({ key: 'site.default-locale', schema: localeSchema, scopes: ABOVE_GROUPS, visibility: 'public', sensitivity: 'organisational', risk: 'medium', default: 'en-GB' }),
  defineConfigurationSetting({ key: 'site.logo', schema: assetReferenceSchema, scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'medium' }),
  defineConfigurationSetting({ key: 'site.default-theme', schema: codeSchema, scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'low' }),
  defineConfigurationSetting({ key: 'organisation.legal-name', schema: safeTextSchema({ max: 200 }), scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'high' }),
  defineConfigurationSetting({ key: 'organisation.trading-name', schema: safeTextSchema({ max: 200 }), scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'medium' }),
  defineConfigurationSetting({
    key: 'organisation.registration',
    schema: z.strictObject({ jurisdiction: z.string().regex(/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/, 'not-a-jurisdiction'), number: safeTextSchema({ max: 40 }) }),
    scopes: ALL,
    visibility: 'public',
    sensitivity: 'organisational',
    risk: 'high',
  }),
  defineConfigurationSetting({ key: 'organisation.tax-number', schema: z.strictObject({ scheme: codeSchema, number: safeTextSchema({ max: 40 }) }), scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'high' }),
  defineConfigurationSetting({ key: 'organisation.registered-address', schema: postalAddressSchema, scopes: ALL, visibility: 'public', sensitivity: 'possibly-personal', risk: 'high' }),
  defineConfigurationSetting({ key: 'organisation.postal-address', schema: postalAddressSchema, scopes: ALL, visibility: 'public', sensitivity: 'possibly-personal', risk: 'medium' }),
  defineConfigurationSetting({ key: 'contact.general', schema: contactPointSchema, scopes: ALL, visibility: 'public', sensitivity: 'possibly-personal', risk: 'medium' }),
  defineConfigurationSetting({
    key: 'contact.data-protection',
    // A role or mailbox; a named person only by Identity's identifier, shown through Profile.
    schema: z.strictObject({ email: emailSchema.optional(), phone: phoneNumberSchema.optional(), url: httpsUrlSchema.optional(), identityId: identifierSchema.optional() })
      .refine(value => Object.keys(value).length > 0, 'empty-contact'),
    scopes: ALL,
    visibility: 'public',
    sensitivity: 'possibly-personal',
    risk: 'high',
  }),
  defineConfigurationSetting({
    key: 'contact.security',
    // Where vulnerabilities are reported: a site's security.txt (RFC 9116). Whoever
    // can change it receives the reports, hence `high`. A site's, never a group's.
    schema: z.strictObject({
      email: emailSchema.optional(),
      phone: phoneNumberSchema.optional(),
      url: httpsUrlSchema.optional(),
      policy: linkSchema.optional(),
      encryption: httpsUrlSchema.optional(),
      acknowledgements: linkSchema.optional(),
      preferredLanguages: z.array(localeSchema).max(10).optional(),
    }).refine(value => value.email !== undefined || value.phone !== undefined || value.url !== undefined, 'empty-contact'),
    scopes: ABOVE_GROUPS,
    visibility: 'public',
    sensitivity: 'possibly-personal',
    risk: 'high',
  }),
  defineConfigurationSetting({
    key: 'social.links',
    schema: z.array(z.strictObject({ network: z.enum(SOCIAL_NETWORKS, { error: 'unknown-network' }), url: linkSchema })).max(20),
    scopes: ALL,
    visibility: 'public',
    sensitivity: 'organisational',
    risk: 'low',
  }),
  defineConfigurationSetting({
    key: 'legal.links',
    schema: z.strictObject({ 'privacy': linkSchema, 'terms': linkSchema, 'cookies': linkSchema.optional(), 'accessibility': linkSchema.optional(), 'modern-slavery': linkSchema.optional() }),
    scopes: ALL,
    visibility: 'public',
    sensitivity: 'organisational',
    risk: 'high',
  }),
  defineConfigurationSetting({ key: 'seo.description', schema: safeTextSchema({ max: 300 }), scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'low' }),
  defineConfigurationSetting({ key: 'seo.image', schema: assetReferenceSchema, scopes: ALL, visibility: 'public', sensitivity: 'organisational', risk: 'low' }),
  defineConfigurationSetting({
    key: 'seo.title-template',
    schema: safeTextSchema({ max: 80 }).refine(value => value.split('%s').length === 2, 'needs-one-placeholder'),
    scopes: ABOVE_GROUPS,
    visibility: 'public',
    sensitivity: 'organisational',
    risk: 'low',
  }),
]
