import type {
  ConfigurationAccessDecision,
  ConfigurationCatalogue,
  ConfigurationClock,
  ConfigurationDatabase,
  ConfigurationDirectory,
  ConfigurationGovernance,
  ConfigurationSettingDeclaration,
  ConfigurationSubjectResolver,
  ConfigurationTenants,
  ConfigurationValues,
} from '../../shared/contracts'
import { buildConfigurationCatalogue, CONFIGURATION_SETTINGS, ConfigurationCompositionError, identifierSchema } from '../../shared/contracts'
import { systemConfigurationClock } from '../internal/clock'

/**
 * Composition registry. The host calls the `provide*` functions from a Nitro
 * plugin; the layer's server code calls the `use*` functions. Required ports
 * fail closed: using one before it is supplied throws
 * `ConfigurationCompositionError`. There is no implicit store.
 */

let database: (ConfigurationDatabase & { schema: string }) | null = null
let directory: ConfigurationDirectory | null = null
let tenants: ConfigurationTenants | null = null
let governance: ConfigurationGovernance | null = null
let access: ConfigurationAccessDecision | null = null
let platformGroupId: string | null = null
let clock: ConfigurationClock | null = null
let subjectResolver: ConfigurationSubjectResolver | null = null
let catalogue: ConfigurationCatalogue = buildConfigurationCatalogue(CONFIGURATION_SETTINGS)
let deployment: ConfigurationValues = Object.freeze({})
let version = 0

const NAME = /^[a-z_][a-z0-9_]{0,62}$/

function changed(): void {
  version++
}

/** Bumped by every `provide*` call, so the server functions rebuild their service. */
export function configurationCompositionVersion(): number {
  return version
}

export function provideConfigurationDatabase(next: ConfigurationDatabase): void {
  if (next?.dialect !== 'postgres' || typeof next.pool?.query !== 'function' || typeof next.pool.connect !== 'function') {
    throw new TypeError('provideConfigurationDatabase expects { dialect: \'postgres\', pool } with a pg-compatible pool.')
  }
  const schema = next.schema ?? 'configuration'
  if (!NAME.test(schema)) throw new TypeError(`Invalid configuration schema name '${schema}'.`)
  if (next.runtimeRole !== undefined && !NAME.test(next.runtimeRole)) throw new TypeError(`Invalid runtime role name '${next.runtimeRole}'.`)
  database = { ...next, schema }
  changed()
}

/** The host's and other layers' own settings, added to the layer's catalogue. A mistake fails here, at start-up. */
export function provideConfigurationCatalogue(declarations: readonly ConfigurationSettingDeclaration[]): void {
  const next = buildConfigurationCatalogue(CONFIGURATION_SETTINGS, declarations)
  checkDeployment(next, deployment)
  catalogue = next
  changed()
}

/**
 * The deployment's values (`app.config.ts`, environment): the only source of
 * `locked` settings, and the layer below the platform's for the rest. Each
 * is parsed against its declaration; an unknown key or invalid value fails here.
 */
export function provideConfigurationDeployment(values: Readonly<Record<string, unknown>>): void {
  deployment = Object.freeze(checkDeployment(catalogue, values))
  changed()
}

function checkDeployment(against: ConfigurationCatalogue, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const parsed: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    const declaration = against.get(key)
    if (!declaration) throw new TypeError(`Deployment value for undeclared setting '${key}'.`)
    const result = declaration.schema.safeParse(value)
    if (!result.success) throw new TypeError(`Deployment value for '${key}' is invalid (${result.error.issues[0]?.message ?? 'invalid'}).`)
    parsed[key] = result.data
  }
  return parsed
}

/** Identity's directory: groups' tenant, kind, state and lineage; actors' kind and memberships. */
export function provideConfigurationDirectory(next: ConfigurationDirectory): void {
  if (typeof next?.describeGroup !== 'function' || typeof next.describeActor !== 'function') {
    throw new TypeError('provideConfigurationDirectory expects describeGroup(groupId, options) and describeActor(identityId, options) functions.')
  }
  directory = next
  changed()
}

/** Identity's tenants: whether one exists, and its state. */
export function provideConfigurationTenants(next: ConfigurationTenants): void {
  if (typeof next?.describeTenant !== 'function') throw new TypeError('provideConfigurationTenants expects a describeTenant(tenantId) function.')
  tenants = next
  changed()
}

/** Identity's access governance: approval requirements, safety periods, owners, recovery holds. */
export function provideConfigurationGovernance(next: ConfigurationGovernance): void {
  if (typeof next?.describeGroup !== 'function' || typeof next.isOwner !== 'function' || typeof next.countOwners !== 'function') {
    throw new TypeError('provideConfigurationGovernance expects describeGroup, isOwner and countOwners functions.')
  }
  governance = next
  changed()
}

/** Authorisation's decisions on Configuration's permissions. */
export function provideConfigurationAccessDecision(next: ConfigurationAccessDecision): void {
  if (typeof next?.allows !== 'function' || typeof next.countQualifying !== 'function' || typeof next.riskOf !== 'function') {
    throw new TypeError('provideConfigurationAccessDecision expects allows, countQualifying and riskOf functions.')
  }
  access = next
  changed()
}

/** The platform group, where platform-wide changes are decided (§7.1). */
export function provideConfigurationPlatformGroup(groupId: string): void {
  platformGroupId = identifierSchema.parse(groupId)
  changed()
}

/** The signed-in subject for an HTTP request, from Authentication through the host; `null` when nobody is signed in. */
export function provideConfigurationSubjectResolver(next: ConfigurationSubjectResolver): void {
  if (typeof next?.resolve !== 'function') throw new TypeError('provideConfigurationSubjectResolver expects an object with a resolve(event) function.')
  subjectResolver = next
  changed()
}

/** Optional: the suite's clock. Without it, the system clock. */
export function provideConfigurationClock(next: ConfigurationClock): void {
  if (typeof next?.now !== 'function') throw new TypeError('provideConfigurationClock expects an object with a now() function.')
  clock = next
  changed()
}

function required<T>(value: T | null, name: string): T {
  if (value === null) throw new ConfigurationCompositionError(name)
  return value
}

export const useConfigurationDatabase = () => required(database, 'ConfigurationDatabase')
export const useConfigurationDirectory = () => required(directory, 'ConfigurationDirectory')
export const useConfigurationTenants = () => required(tenants, 'ConfigurationTenants')
export const useConfigurationGovernance = () => required(governance, 'ConfigurationGovernance')
export const useConfigurationAccessDecision = () => required(access, 'ConfigurationAccessDecision')
export const useConfigurationPlatformGroup = () => required(platformGroupId, 'ConfigurationPlatformGroup')
export const useConfigurationSubjectResolver = () => required(subjectResolver, 'ConfigurationSubjectResolver')
export const useConfigurationClock = (): ConfigurationClock => clock ?? systemConfigurationClock
export const useConfigurationCatalogue = (): ConfigurationCatalogue => catalogue
export const useConfigurationDeployment = (): ConfigurationValues => deployment

/** Test helper: removes every supplied port and declaration. */
export function clearConfigurationComposition(): void {
  database = null
  directory = null
  tenants = null
  governance = null
  access = null
  platformGroupId = null
  clock = null
  subjectResolver = null
  catalogue = buildConfigurationCatalogue(CONFIGURATION_SETTINGS)
  deployment = Object.freeze({})
  changed()
}
