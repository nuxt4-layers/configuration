import type { ConfigurationAnswer, ConfigurationChange, ConfigurationErrorCode, ConfigurationRisk, ConfigurationVisibility } from '../../shared/contracts'
import { CONFIGURATION_ERROR_CODES } from '../../shared/contracts'

/** A scope as the administration pages name it, from the route's query. */
export type ConfigurationAdminScope =
  | { scope: 'platform' }
  | { scope: 'tenant', governingGroupId: string, tenantId?: string }
  | { scope: 'group', groupId: string }
  | { scope: 'account' }

export interface ConfigurationDeclarationView {
  key: string
  risk: ConfigurationRisk
  visibility: ConfigurationVisibility
  sensitivity: 'organisational' | 'possibly-personal'
  inherits: 'lineage' | 'none'
  /** The value's JSON Schema, to build a form; the server checks every value again. */
  schema: Record<string, unknown>
}

export interface ConfigurationScopeView {
  viewerId: string
  tenantId: string | null
  declarations: ConfigurationDeclarationView[]
  values: Record<string, unknown>
  digests: Record<string, string>
  inForce: ConfigurationAnswer | null
  openChanges: ConfigurationChange[]
  closed: string | null
}

export interface ConfigurationErrorBody {
  code: ConfigurationErrorCode
  reason?: string
}

/** The contract error a failed request carried, if any. */
export function configurationErrorOf(error: unknown): ConfigurationErrorBody | null {
  const body = (error as { data?: { data?: unknown } } | null)?.data?.data as Partial<ConfigurationErrorBody> | undefined
  if (body && (CONFIGURATION_ERROR_CODES as readonly unknown[]).includes(body.code)) return { code: body.code!, ...(body.reason ? { reason: body.reason } : {}) }
  return null
}

function query(scope: ConfigurationAdminScope): Record<string, string> {
  return { ...scope }
}

/**
 * The client API of the administration pages. For the user experience only:
 * every request is decided again on the server, and the tenant comes from the
 * host name the page is served on.
 */
export function useConfigurationAdministration() {
  const request = useRequestFetch()
  return {
    readScope: (scope: ConfigurationAdminScope) => request<ConfigurationScopeView>('/api/configuration/admin', { query: query(scope) }),
    requestChange(body: { target: Record<string, string>, set: Record<string, unknown>, expected: Record<string, string | null>, justification: { reasonCode: string, reference?: string } }) {
      return $fetch<ConfigurationChange>('/api/configuration/changes', { method: 'POST', body })
    },
    decide: (change: ConfigurationChange, decision: 'approve' | 'reject') =>
      $fetch<ConfigurationChange>(`/api/configuration/changes/${change.changeId}/decision`, { method: 'POST', body: { changeDigest: change.digest, decision } }),
    cancel: (change: ConfigurationChange) => $fetch<ConfigurationChange>(`/api/configuration/changes/${change.changeId}/cancel`, { method: 'POST', body: {} }),
  }
}

/**
 * Shared state for an action: pending, the error to show and its code.
 * `disabled` stays true until hydrated, so a form never submits natively.
 */
export function useConfigurationAction() {
  const text = useConfigurationText()
  const pending = ref(false)
  const hydrated = ref(false)
  onMounted(() => { hydrated.value = true })
  const disabled = computed(() => pending.value || !hydrated.value)
  const error = ref<string | null>(null)
  const code = ref<ConfigurationErrorCode | null>(null)

  function messageFor(body: ConfigurationErrorBody | null): string {
    if (!body) return text('configuration.error.unavailable')
    if (body.reason && hasConfigurationMessage(`configuration.reason.${body.reason}`)) return text(`configuration.reason.${body.reason}`)
    return text(`configuration.error.${body.code}`)
  }

  async function run<T>(action: () => Promise<T>): Promise<T | null> {
    pending.value = true
    error.value = null
    code.value = null
    try {
      return await action()
    }
    catch (failure) {
      const body = configurationErrorOf(failure)
      code.value = body?.code ?? 'unavailable'
      error.value = messageFor(body)
      return null
    }
    finally {
      pending.value = false
    }
  }

  return { pending, disabled, error, code, run, messageFor, text }
}
