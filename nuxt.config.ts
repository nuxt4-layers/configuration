/**
 * Nuxt layer entry point for `@nuxt4-layers/configuration`.
 *
 * Hosts compose this layer by package name from `extends` and supply the
 * ports from a Nitro plugin with the `provideConfiguration*` functions.
 */
export default defineNuxtConfig({
  compatibilityDate: '2026-06-30',

  runtimeConfig: {
    configuration: {
      /**
       * Trust `X-Forwarded-Host` when resolving the tenant from the host name
       * (`NUXT_CONFIGURATION_TRUST_FORWARDED_HOST`). Only behind the host's own
       * proxy, which sets it; otherwise a client could choose its tenant.
       */
      trustForwardedHost: false,
    },
  },
})
