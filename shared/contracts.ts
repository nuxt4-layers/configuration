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
} from './identifiers'

export type { ConfigurationConflictReason, ConfigurationErrorCode } from './errors'
export {
  ConfigurationCompositionError,
  ConfigurationFailure,
  CONFIGURATION_CONFLICT_REASONS,
  CONFIGURATION_ERROR_CODES,
  CONFIGURATION_ERROR_STATUS,
} from './errors'

export {
  assetReferenceSchema,
  codeSchema,
  contactPointSchema,
  countryCodeSchema,
  emailSchema,
  hostNameSchema,
  httpsUrlSchema,
  linkSchema,
  localeSchema,
  phoneNumberSchema,
  postalAddressSchema,
  safeTextSchema,
  sitePathSchema,
} from './values'

export type {
  ConfigurationCatalogue,
  ConfigurationRisk,
  ConfigurationScopeKind,
  ConfigurationSensitivity,
  ConfigurationSettingDeclaration,
  ConfigurationVisibility,
} from './settings'
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
} from './settings'

export { CONFIGURATION_SETTINGS, SOCIAL_NETWORKS } from './catalogue'

export type {
  ConfigurationAnswer,
  ConfigurationLayers,
  ConfigurationProvenance,
  ConfigurationScopeReference,
  ConfigurationValues,
} from './scopes'
export { resolveConfiguration, scopeReferenceSchema, visibilityRank } from './scopes'

export type {
  ConfigurationAssurance,
  ConfigurationChange,
  ConfigurationChangeRequest,
  ConfigurationChangeRoute,
  ConfigurationChangeStatus,
  ConfigurationChangeTarget,
  ConfigurationSubject,
} from './changes'
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
} from './changes'

export type { ConfigurationEvent, ConfigurationEventType } from './events'
export { configurationEventSchema } from './events'

export type { ConfigurationPermission } from './permissions'
export { CONFIGURATION_PERMISSIONS, MANAGE_PERMISSION, readPermission, SCOPE_RISK_FLOOR, VIEW_PERMISSION } from './permissions'

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
  ConfigurationSubjectResolver,
  ConfigurationTenants,
  Consistency,
  PostgresPoolLike,
} from './ports'
