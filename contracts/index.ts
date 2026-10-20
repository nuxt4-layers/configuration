/**
 * Public contract for `@nuxt4-layers/configuration-service`.
 *
 * The only supported cross-layer import path for Configuration's types and
 * pure helpers. It imports nothing but `zod`.
 */

export {
  correlationIdSchema,
  digestSchema,
  identifierSchema,
  instantSchema,
  reasonCodeSchema,
  REASON_CODE_PATTERN,
  UUID_PATTERN,
  UUID_V7_PATTERN,
} from '../shared/identifiers'

export type { ConfigurationConflictReason, ConfigurationErrorCode } from '../shared/errors'
export {
  ConfigurationCompositionError,
  ConfigurationFailure,
  CONFIGURATION_CONFLICT_REASONS,
  CONFIGURATION_ERROR_CODES,
  CONFIGURATION_ERROR_STATUS,
} from '../shared/errors'

export {
  assetReferenceSchema,
  codeSchema,
  contactPointSchema,
  countryCodeSchema,
  emailSchema,
  httpsUrlSchema,
  linkSchema,
  localeSchema,
  phoneNumberSchema,
  postalAddressSchema,
  safeTextSchema,
  sitePathSchema,
} from '../shared/values'

export type {
  ConfigurationCatalogue,
  ConfigurationRisk,
  ConfigurationScopeKind,
  ConfigurationSensitivity,
  ConfigurationSettingDeclaration,
  ConfigurationVisibility,
} from '../shared/settings'
export {
  buildConfigurationCatalogue,
  CONFIGURATION_RISKS,
  CONFIGURATION_SCOPES,
  CONFIGURATION_SENSITIVITIES,
  CONFIGURATION_VISIBILITIES,
  defineConfigurationSetting,
  highestRisk,
  RESERVED_NAMESPACES,
  riskRank,
  SETTING_KEY_PATTERN,
  settingKeySchema,
} from '../shared/settings'

export { CONFIGURATION_SETTINGS, SOCIAL_NETWORKS } from '../shared/catalogue'

export type {
  ConfigurationAnswer,
  ConfigurationLayers,
  ConfigurationProvenance,
  ConfigurationScopeReference,
  ConfigurationValues,
} from '../shared/scopes'
export { resolveConfiguration, scopeReferenceSchema, visibilityRank } from '../shared/scopes'

export type {
  ConfigurationAssurance,
  ConfigurationChange,
  ConfigurationChangeRequest,
  ConfigurationChangeRoute,
  ConfigurationChangeStatus,
  ConfigurationChangeTarget,
  ConfigurationSubject,
} from '../shared/changes'
export {
  APPROVAL_FLOOR,
  canonicalJson,
  CHANGE_ROUTES,
  CHANGE_STATUSES,
  changeTargetSchema,
  configurationChangeRequestSchema,
  CRITICAL_FRESHNESS_MINUTES,
  decisionSchema,
  justificationSchema,
  meetsStepUp,
  requiredApprovals,
  subjectSchema,
} from '../shared/changes'

export type { ConfigurationEvent, ConfigurationEventType } from '../shared/events'
export { configurationEventSchema } from '../shared/events'

export type { ConfigurationPermission } from '../shared/permissions'
export { CONFIGURATION_PERMISSIONS, MANAGE_PERMISSION, SCOPE_RISK_FLOOR, VIEW_PERMISSION } from '../shared/permissions'

export type {
  ConfigurationAccessDecision,
  ConfigurationActorFacts,
  ConfigurationClock,
  ConfigurationDatabase,
  ConfigurationDirectory,
  ConfigurationGovernance,
  ConfigurationGovernedGroup,
  ConfigurationGroupFacts,
  ConfigurationSafetyPeriods,
  ConfigurationTenants,
  Consistency,
  PostgresPoolLike,
} from '../shared/ports'
