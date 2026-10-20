import type { ConfigurationChangeTarget, ConfigurationEvent, ConfigurationSubject, ConfigurationVisibility } from '../../shared/contracts'
import { ConfigurationCompositionError, ConfigurationFailure } from '../../shared/contracts'
import { runConfigurationMigrations } from '../database/migrations'
import type { ConfigurationService } from '../internal/service'
import { createConfigurationService } from '../internal/service'
import {
  configurationCompositionVersion,
  useConfigurationAccessDecision,
  useConfigurationCatalogue,
  useConfigurationClock,
  useConfigurationDatabase,
  useConfigurationDeployment,
  useConfigurationDirectory,
  useConfigurationGovernance,
  useConfigurationPlatformGroup,
  useConfigurationTenants,
} from './configuration-composition'

/**
 * Configuration's server functions (docs/contracts.md §12). A missing port
 * fails closed as `unavailable`.
 */

let cached: { version: number, service: ConfigurationService } | null = null

function missing<T>(use: () => T): () => T {
  return () => {
    try {
      return use()
    }
    catch (error) {
      if (error instanceof ConfigurationCompositionError) throw new ConfigurationFailure('unavailable', 'port-missing')
      throw error
    }
  }
}

function service(): ConfigurationService {
  const version = configurationCompositionVersion()
  if (cached?.version !== version) {
    const database = missing(useConfigurationDatabase)()
    cached = {
      version,
      service: createConfigurationService({
        pool: database.pool,
        schema: database.schema,
        catalogue: useConfigurationCatalogue,
        deployment: useConfigurationDeployment,
        directory: missing(useConfigurationDirectory),
        tenants: missing(useConfigurationTenants),
        governance: missing(useConfigurationGovernance),
        access: missing(useConfigurationAccessDecision),
        platformGroupId: missing(useConfigurationPlatformGroup),
        clock: useConfigurationClock,
      }),
    }
  }
  return cached.service
}

/** Applies Configuration's migrations through the migration pool (or the pool), granting the runtime role data access only. */
export async function migrateConfigurationDatabase(): Promise<string[]> {
  const database = useConfigurationDatabase()
  return runConfigurationMigrations(database.migrationPool ?? database.pool, database.schema, database.runtimeRole)
}

/** The tenant a request's host name resolves to, or `null`. */
export function getConfigurationTenantForHost(host: string) {
  return service().tenantForHost(host)
}

/** The values a viewer may read (anonymous: public platform and tenant values only). */
export function readConfigurationForViewer(input: { subject: ConfigurationSubject | null, tenantId: string | null, groupId?: string }) {
  return service().readForViewer(input)
}

/** The values in force with provenance; server code passes `visibility: 'server'`. */
export function getConfiguration(input: { tenantId?: string, groupId?: string, keys?: readonly string[], visibility: ConfigurationVisibility }) {
  return service().getConfiguration(input)
}

/** Requests, decides, cancels and reads pending changes; reads a scope for editing. */
export function getConfigurationChanges() {
  return service().changes
}

export function listConfigurationHistory(input: { subject: ConfigurationSubject, target: ConfigurationChangeTarget, limit?: number, tenantId?: string | null }) {
  return service().listHistory(input)
}

/** Server-only: expiry, delayed changes and retention. */
export function runConfigurationMaintenance() {
  return service().runMaintenance()
}

/** Server-only: publishes the outbox, at least once, in order. */
export function relayConfigurationOutbox(input: { publish: (event: ConfigurationEvent) => Promise<void>, limit?: number }) {
  return service().relayOutbox(input)
}

/** Server-only: on Identity's `group.disposal-due`. */
export function disposeConfigurationGroup(input: { groupId: string, correlationId: string }) {
  return service().disposeGroup(input)
}

/** Server-only: on Identity's `tenant.disposal-due`. */
export function disposeConfigurationTenant(input: { tenantId: string, correlationId: string }) {
  return service().disposeTenant(input)
}

/** Server-only: the tenant's part of a tenant export. */
export function exportConfigurationTenantData(input: { tenantId: string }) {
  return service().exportTenantData(input)
}
