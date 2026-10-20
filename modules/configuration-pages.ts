import { createResolver, defineNuxtModule, extendPages } from 'nuxt/kit'

/**
 * Registers the administration pages: the settings of a scope and the
 * changes awaiting a decision. The components and the public API work
 * without them.
 *
 * Hosts configure it in nuxt.config.ts:
 *   configuration: { pages: { paths: { settings: '/admin/settings' } } }  // move the pages
 *   configuration: { pages: { enabled: false } }                          // own pages, keep the components
 */
export interface ConfigurationPagePaths {
  settings: string
  changes: string
}

export interface ConfigurationModuleOptions {
  pages: { enabled: boolean, paths: ConfigurationPagePaths }
  /** The host's sign-in page, linked when someone is signed out. */
  signIn: string
}

const PAGES: { key: keyof ConfigurationPagePaths, file: string }[] = [
  { key: 'settings', file: 'SettingsPage.vue' },
  { key: 'changes', file: 'ChangesPage.vue' },
]

export default defineNuxtModule<ConfigurationModuleOptions>({
  meta: { name: '@nuxt4-layers/configuration-service/pages', configKey: 'configuration' },
  defaults: {
    pages: { enabled: true, paths: { settings: '/configuration', changes: '/configuration/changes' } },
    signIn: '/sign-in',
  },
  setup(options, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const publicConfig = nuxt.options.runtimeConfig.public as Record<string, unknown>
    const routes: Record<string, string> = { signIn: options.signIn }
    publicConfig.configuration = { routes }
    if (!options.pages.enabled) return

    for (const page of PAGES) {
      const path = options.pages.paths[page.key]
      if (!path.startsWith('/') || path.startsWith('//')) throw new Error(`configuration.pages.paths.${page.key} must be an absolute path, got '${path}'.`)
      routes[page.key] = path
    }

    // Administration pages: never framed, never cached, never leaking a path
    // in a Referer. Headers a host sets for the same path take precedence.
    const routeRules = (nuxt.options.routeRules ??= {}) as Record<string, { headers?: Record<string, string> }>
    for (const path of Object.values(options.pages.paths)) {
      const rule = (routeRules[path] ??= {})
      rule.headers = {
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        ...rule.headers,
      }
    }

    extendPages((pages) => {
      for (const page of PAGES) {
        pages.push({ name: `configuration-${page.key}`, path: options.pages.paths[page.key], file: resolve('../app/configuration-pages', page.file) })
      }
    })
  },
})
