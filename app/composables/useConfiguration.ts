import type { MaybeRefOrGetter } from 'vue'
import { computed, toValue } from 'vue'
import type { ConfigurationAnswer } from '../../shared/contracts'

/**
 * The values in force for the current site, as the viewer may see them. For
 * the user experience only: it decides nothing.
 *
 * - `useConfiguration()`: the public platform and tenant values for this host
 *   name, cacheable, without signing in.
 * - `useConfiguration({ signedIn: true })` or `{ groupId }`: what the
 *   signed-in viewer may read, for the tenant or one of its groups.
 */
export function useConfiguration(options: { groupId?: MaybeRefOrGetter<string | undefined>, signedIn?: boolean } = {}) {
  const groupId = computed(() => toValue(options.groupId))
  const signedIn = computed(() => options.signedIn === true || groupId.value !== undefined)
  const request = useRequestFetch()
  const key = computed(() => `configuration:${signedIn.value ? 'viewer' : 'public'}:${groupId.value ?? ''}`)
  const { data, error, status, refresh } = useAsyncData(
    key,
    () => request<ConfigurationAnswer>(signedIn.value ? '/api/configuration' : '/api/configuration/public', {
      query: groupId.value ? { groupId: groupId.value } : undefined,
    }),
    { dedupe: 'defer' },
  )
  const values = computed<Readonly<Record<string, unknown>>>(() => data.value?.values ?? {})
  function value<T = unknown>(name: string) {
    return computed(() => values.value[name] as T | undefined)
  }
  return { data, values, value, error, status, refresh }
}
