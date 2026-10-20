import { CONFIGURATION_MESSAGES } from '../configuration-messages'
import type { ConfigurationMessageKey } from '../configuration-messages'

/**
 * The layer's text, with `{name}` placeholders filled in. Hosts change
 * wording in `app.config.ts` under `configuration.messages`. A key with no
 * message answers itself, so a missing message is visible, never blank.
 */
export function useConfigurationText() {
  const overrides = (useAppConfig() as { configuration?: { messages?: Record<string, string> } }).configuration?.messages ?? {}
  return function text(key: ConfigurationMessageKey | (string & {}), values: Record<string, string | number> = {}): string {
    const template = overrides[key] ?? (CONFIGURATION_MESSAGES as Record<string, string>)[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''))
  }
}

/** Whether the catalogue words a key (for labels with a fallback). */
export function hasConfigurationMessage(key: string): boolean {
  const overrides = (useAppConfig() as { configuration?: { messages?: Record<string, string> } }).configuration?.messages ?? {}
  return key in overrides || key in CONFIGURATION_MESSAGES
}
