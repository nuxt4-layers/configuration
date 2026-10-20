import { z } from 'zod'

/**
 * Declared settings (docs/contracts.md §3.1). Nothing is stored unless a
 * setting declares it.
 */

/** `account`: a person's own account, which only that person reads or changes (docs/contracts.md §4.2). */
export const CONFIGURATION_SCOPES = ['platform', 'tenant', 'group', 'account'] as const
export type ConfigurationScopeKind = typeof CONFIGURATION_SCOPES[number]

export const CONFIGURATION_VISIBILITIES = ['public', 'members', 'server'] as const
export type ConfigurationVisibility = typeof CONFIGURATION_VISIBILITIES[number]

/** Risk levels, in Authorisation's catalogue's sense. */
export const CONFIGURATION_RISKS = ['low', 'medium', 'high', 'critical'] as const
export type ConfigurationRisk = typeof CONFIGURATION_RISKS[number]

export const CONFIGURATION_SENSITIVITIES = ['organisational', 'possibly-personal'] as const
export type ConfigurationSensitivity = typeof CONFIGURATION_SENSITIVITIES[number]

/** `namespace.name`, lower-case ASCII with `-`. */
export const SETTING_KEY_PATTERN = /^[a-z][a-z0-9-]{0,39}\.[a-z][a-z0-9-]{0,62}$/
export const settingKeySchema = z.string().regex(SETTING_KEY_PATTERN, 'not-a-setting-key')

/** The layer's own namespaces; hosts and other layers declare their own. */
export const RESERVED_NAMESPACES = ['site', 'organisation', 'contact', 'social', 'legal', 'seo'] as const

export interface ConfigurationSettingDeclaration<Value = unknown> {
  key: string
  schema: z.ZodType<Value>
  scopes: readonly ConfigurationScopeKind[]
  /** For `group`: take the nearest ancestor's value (`lineage`) or go straight to the tenant (`none`). */
  inherits?: 'lineage' | 'none'
  visibility: ConfigurationVisibility
  default?: Value
  sensitivity: ConfigurationSensitivity
  risk: ConfigurationRisk
  /** Only the deployment sets it; nobody changes it at run time. */
  locked?: boolean
}

/** Typed helper for declaring a setting. */
export function defineConfigurationSetting<Value>(declaration: ConfigurationSettingDeclaration<Value>): ConfigurationSettingDeclaration<Value> {
  return declaration
}

export function riskRank(risk: ConfigurationRisk): number {
  return CONFIGURATION_RISKS.indexOf(risk)
}

export function highestRisk(risks: readonly ConfigurationRisk[]): ConfigurationRisk {
  return risks.reduce<ConfigurationRisk>((highest, risk) => riskRank(risk) > riskRank(highest) ? risk : highest, 'low')
}

export type ConfigurationCatalogue = ReadonlyMap<string, ConfigurationSettingDeclaration>

/**
 * Builds a catalogue from the layer's declarations and the host's, refusing
 * anything a page would otherwise find out about later: a malformed key, a
 * host declaring in a reserved namespace, a duplicate, no scopes, or a
 * default its own schema refuses.
 */
export function buildConfigurationCatalogue(own: readonly ConfigurationSettingDeclaration[], added: readonly ConfigurationSettingDeclaration[] = []): ConfigurationCatalogue {
  const catalogue = new Map<string, ConfigurationSettingDeclaration>()
  const check = (declaration: ConfigurationSettingDeclaration, reservedAllowed: boolean) => {
    const { key } = declaration
    if (!SETTING_KEY_PATTERN.test(key)) throw new TypeError(`Setting key '${key}' is not namespace.name.`)
    const namespace = key.split('.')[0]!
    if (!reservedAllowed && (RESERVED_NAMESPACES as readonly string[]).includes(namespace)) throw new TypeError(`Setting '${key}' uses the layer's reserved namespace '${namespace}'.`)
    if (catalogue.has(key)) throw new TypeError(`Setting '${key}' is declared twice.`)
    if (declaration.scopes.length === 0 || declaration.scopes.some(scope => !CONFIGURATION_SCOPES.includes(scope))) throw new TypeError(`Setting '${key}' needs at least one valid scope.`)
    if (!CONFIGURATION_VISIBILITIES.includes(declaration.visibility)) throw new TypeError(`Setting '${key}' has an invalid visibility.`)
    // Nobody but the account's person reads an account's values, so none is public.
    if (declaration.scopes.includes('account') && declaration.visibility === 'public') throw new TypeError(`Setting '${key}' is set per account, so it cannot be public.`)
    if (!CONFIGURATION_RISKS.includes(declaration.risk)) throw new TypeError(`Setting '${key}' has an invalid risk.`)
    if (!CONFIGURATION_SENSITIVITIES.includes(declaration.sensitivity)) throw new TypeError(`Setting '${key}' has an invalid sensitivity.`)
    if (declaration.default !== undefined && !declaration.schema.safeParse(declaration.default).success) throw new TypeError(`Setting '${key}' has a default its schema refuses.`)
    catalogue.set(key, Object.freeze({ inherits: 'lineage', locked: false, ...declaration }))
  }
  for (const declaration of own) check(declaration, true)
  for (const declaration of added) check(declaration, false)
  return catalogue
}
