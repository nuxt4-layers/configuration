import type { ConfigurationRisk, ConfigurationScopeKind } from './settings'

/** Configuration's permissions, for the host to add to Authorisation's catalogue (docs/contracts.md §10). */
export const CONFIGURATION_PERMISSIONS = [
  { permission: 'configuration.settings:view', risk: 'low', effect: 'view' },
  { permission: 'configuration.group-settings:manage', risk: 'medium', effect: 'manage' },
  { permission: 'configuration.tenant-settings:manage', risk: 'high', effect: 'manage' },
  { permission: 'configuration.platform-settings:manage', risk: 'critical', effect: 'manage' },
] as const satisfies readonly { permission: string, risk: ConfigurationRisk, effect: 'view' | 'manage' }[]

export type ConfigurationPermission = typeof CONFIGURATION_PERMISSIONS[number]['permission']

export const VIEW_PERMISSION = 'configuration.settings:view' satisfies ConfigurationPermission

/**
 * The permission requested and approved on a scope's governing group. An
 * account has none: only its own person reads or changes it, in their
 * personal group, with no approver (personal-group sovereignty).
 */
export const MANAGE_PERMISSION: Readonly<Record<Exclude<ConfigurationScopeKind, 'account'>, ConfigurationPermission>> = {
  platform: 'configuration.platform-settings:manage',
  tenant: 'configuration.tenant-settings:manage',
  group: 'configuration.group-settings:manage',
}

/** Every platform change is at least `high`: every tenant sees it. */
export const SCOPE_RISK_FLOOR: Readonly<Record<ConfigurationScopeKind, ConfigurationRisk>> = {
  platform: 'high',
  tenant: 'low',
  group: 'low',
  account: 'low',
}

/**
 * The permission that lets a person read a scope as its administrator. The
 * platform's settings are the hosting application's own, so only those who
 * may change them (the platform group's owners, unless explicitly granted)
 * may read them there.
 */
export function readPermission(scope: Exclude<ConfigurationScopeKind, 'account'>): ConfigurationPermission {
  return scope === 'platform' ? MANAGE_PERMISSION.platform : VIEW_PERMISSION
}
