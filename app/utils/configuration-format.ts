/** Formatting and pruning of setting values for the administration pages. */

/** A value as one line of text: strings as they are, lists and objects joined. */
export function summariseConfigurationValue(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(summariseConfigurationValue).filter(Boolean).join('; ')
  return Object.values(value as Record<string, unknown>).map(summariseConfigurationValue).filter(Boolean).join(', ')
}

/**
 * A form's draft as a value to send: empty strings, empty lists and empty
 * objects left out, so optional parts stay unset. The server checks the rest.
 */
export function pruneConfigurationValue(value: unknown): unknown {
  if (typeof value === 'string') return value.trim() === '' ? undefined : value
  if (Array.isArray(value)) {
    const items = value.map(pruneConfigurationValue).filter(item => item !== undefined)
    return items.length > 0 ? items : undefined
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, pruneConfigurationValue(item)] as const).filter(([, item]) => item !== undefined)
    return entries.length > 0 ? Object.fromEntries(entries) : undefined
  }
  return value
}

/** A time for the pages, in UTC so the server's and browser's render agree. */
export function formatConfigurationTime(iso: string | null | undefined, locale = 'en-GB'): string {
  if (!iso) return ''
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(iso))
}
