import { z } from 'zod'
import { identifierSchema } from './identifiers'
import type { ConfigurationCatalogue, ConfigurationVisibility } from './settings'
import { CONFIGURATION_VISIBILITIES } from './settings'

/** Scopes and how a value in force is found (docs/contracts.md §4). */

export const scopeReferenceSchema = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('platform') }),
  z.strictObject({ scope: z.literal('tenant'), tenantId: identifierSchema }),
  z.strictObject({ scope: z.literal('group'), groupId: identifierSchema }),
  z.strictObject({ scope: z.literal('account'), identityId: identifierSchema }),
])

export type ConfigurationScopeReference = z.infer<typeof scopeReferenceSchema>

/** Where a value in force came from. */
export type ConfigurationProvenance =
  | { source: 'locked' }
  | { source: 'account' }
  | { source: 'group', groupId: string }
  | { source: 'tenant' }
  | { source: 'platform' }
  | { source: 'deployment' }
  | { source: 'default' }

export type ConfigurationValues = Readonly<Record<string, unknown>>

export interface ConfigurationLayers {
  /** The deployment's values (`app.config.ts`, environment), which alone set `locked` keys. */
  deployment: ConfigurationValues
  platform: ConfigurationValues
  tenant?: ConfigurationValues
  /** A person's own account, asked about instead of a group. */
  account?: ConfigurationValues
  /** The group asked about first, then its ancestors up to its root group. */
  lineage?: readonly { groupId: string, values: ConfigurationValues }[]
}

export interface ConfigurationAnswer {
  values: Record<string, unknown>
  provenance: Record<string, ConfigurationProvenance>
}

export function visibilityRank(visibility: ConfigurationVisibility): number {
  return CONFIGURATION_VISIBILITIES.indexOf(visibility)
}

/**
 * The values in force, up to `visibility`, with each one's provenance. Keys
 * with no value anywhere and no default are left out. Pure: the caller has
 * already parsed every layer against the catalogue.
 */
export function resolveConfiguration(catalogue: ConfigurationCatalogue, layers: ConfigurationLayers, { keys, visibility }: { keys?: readonly string[], visibility: ConfigurationVisibility }): ConfigurationAnswer {
  const answer: ConfigurationAnswer = { values: {}, provenance: {} }
  const has = (values: ConfigurationValues | undefined, key: string) => values !== undefined && Object.hasOwn(values, key)
  for (const [key, declaration] of catalogue) {
    if (keys && !keys.includes(key)) continue
    if (visibilityRank(declaration.visibility) > visibilityRank(visibility)) continue
    const found = ((): [unknown, ConfigurationProvenance] | undefined => {
      if (declaration.locked) return has(layers.deployment, key) ? [layers.deployment[key], { source: 'locked' }] : undefined
      if (declaration.scopes.includes('account') && has(layers.account, key)) return [layers.account![key], { source: 'account' }]
      if (declaration.scopes.includes('group') && layers.lineage) {
        const lineage = declaration.inherits === 'none' ? layers.lineage.slice(0, 1) : layers.lineage
        const group = lineage.find(entry => has(entry.values, key))
        if (group) return [group.values[key], { source: 'group', groupId: group.groupId }]
      }
      if (declaration.scopes.includes('tenant') && has(layers.tenant, key)) return [layers.tenant![key], { source: 'tenant' }]
      if (declaration.scopes.includes('platform') && has(layers.platform, key)) return [layers.platform[key], { source: 'platform' }]
      if (has(layers.deployment, key)) return [layers.deployment[key], { source: 'deployment' }]
      return undefined
    })()
    if (found) {
      answer.values[key] = found[0]
      answer.provenance[key] = found[1]
    }
    else if (!declaration.locked && declaration.default !== undefined) {
      answer.values[key] = declaration.default
      answer.provenance[key] = { source: 'default' }
    }
  }
  return answer
}
