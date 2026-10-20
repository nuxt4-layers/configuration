import { z } from 'zod'
import { instantSchema } from './identifiers'
import { settingKeySchema } from './settings'

/**
 * A scope's values as a versioned document, for moving them between
 * environments (docs/contracts.md §12.2). Importing one is an ordinary
 * pending change: it never bypasses approvals.
 */
export const CONFIGURATION_DOCUMENT_FORMAT = 'nuxt4-layers.configuration'

export const configurationDocumentSchema = z.strictObject({
  format: z.literal(CONFIGURATION_DOCUMENT_FORMAT, { error: 'not-a-configuration-document' }),
  version: z.literal(1, { error: 'unsupported-version' }),
  /** The kind of scope it was exported from; it imports only into the same kind. */
  scope: z.enum(['platform', 'tenant', 'group']),
  exportedAt: instantSchema,
  /** Each key's value as set at that scope; values are checked against the catalogue on import. */
  values: z.record(settingKeySchema, z.unknown()).refine(values => Object.keys(values).length >= 1 && Object.keys(values).length <= 50, 'empty-document'),
})

export type ConfigurationDocument = z.infer<typeof configurationDocumentSchema>
