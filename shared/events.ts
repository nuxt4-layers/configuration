import { z } from 'zod'
import { correlationIdSchema, identifierSchema, instantSchema, reasonCodeSchema } from './identifiers'
import { CHANGE_ROUTES } from './changes'
import { CONFIGURATION_RISKS, CONFIGURATION_SCOPES, settingKeySchema } from './settings'

/**
 * Outbox events (docs/contracts.md §9). Identifiers, keys and codes only:
 * every schema is strict, so a value can never ride along.
 */

const scope = {
  scope: z.enum(CONFIGURATION_SCOPES),
  scopeId: identifierSchema.nullable(),
}

const envelope = {
  eventId: identifierSchema,
  occurredAt: instantSchema,
  correlationId: correlationIdSchema,
  actorId: identifierSchema.nullable(),
}

export const configurationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.change-requested'),
    data: z.strictObject({
      changeId: identifierSchema,
      ...scope,
      governingGroupId: identifierSchema,
      keys: z.array(settingKeySchema).min(1),
      risk: z.enum(CONFIGURATION_RISKS),
      route: z.enum(CHANGE_ROUTES),
      requiredApprovals: z.number().int().min(0),
      expiresAt: instantSchema.nullable(),
      appliesAt: instantSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.change-held'),
    data: z.strictObject({ changeId: identifierSchema, heldUntil: instantSchema }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.change-decided'),
    data: z.strictObject({
      changeId: identifierSchema,
      outcome: z.enum(['applied', 'rejected', 'expired', 'cancelled']),
      approverIds: z.array(identifierSchema),
      reasonCode: reasonCodeSchema.nullable(),
    }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.changed'),
    data: z.strictObject({ ...scope, keys: z.array(settingKeySchema).min(1), changeId: identifierSchema }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.reset'),
    data: z.strictObject({ ...scope, reasonCode: z.enum(['tenant-disposed', 'group-disposed']) }),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('configuration.retention-applied'),
    data: z.strictObject({ history: z.number().int().min(0), changes: z.number().int().min(0) }),
  }),
])

export type ConfigurationEvent = z.infer<typeof configurationEventSchema>
export type ConfigurationEventType = ConfigurationEvent['type']
