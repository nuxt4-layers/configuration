/**
 * The components' text (en-GB). Hosts change wording or add locales in
 * `app.config.ts` under `configuration.messages`.
 */
export const CONFIGURATION_MESSAGES = {
  'configuration.organisation.label': 'Organisation details',
  'configuration.organisation.registration': 'Registered in {jurisdiction}, number {number}',
  'configuration.organisation.tax-number': 'Tax number: {number}',
  'configuration.organisation.tax-number.gb-vat': 'VAT number: {number}',
  'configuration.organisation.registered-address': 'Registered address',
  'configuration.contact.label': 'Contact',
  'configuration.contact.email': 'Email',
  'configuration.contact.phone': 'Phone',
  'configuration.contact.url': 'Contact page',
  'configuration.social.label': 'Social media',
  'configuration.legal.label': 'Legal',
  'configuration.legal.privacy': 'Privacy notice',
  'configuration.legal.terms': 'Terms',
  'configuration.legal.cookies': 'Cookies',
  'configuration.legal.accessibility': 'Accessibility statement',
  'configuration.legal.modern-slavery': 'Modern slavery statement',
  'configuration.social.bluesky': 'Bluesky',
  'configuration.social.facebook': 'Facebook',
  'configuration.social.github': 'GitHub',
  'configuration.social.instagram': 'Instagram',
  'configuration.social.linkedin': 'LinkedIn',
  'configuration.social.mastodon': 'Mastodon',
  'configuration.social.threads': 'Threads',
  'configuration.social.tiktok': 'TikTok',
  'configuration.social.x': 'X',
  'configuration.social.youtube': 'YouTube',
  'configuration.social.other': 'Website',
} as const

export type ConfigurationMessageKey = keyof typeof CONFIGURATION_MESSAGES

export function useConfigurationText() {
  const overrides = (useAppConfig() as { configuration?: { messages?: Record<string, string> } }).configuration?.messages ?? {}
  return function text(key: ConfigurationMessageKey | (string & {}), values: Record<string, string> = {}): string {
    const template = overrides[key] ?? (CONFIGURATION_MESSAGES as Record<string, string>)[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? '')
  }
}
