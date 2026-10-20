// Composition harness: proves the layer composes in a host, with Theme
// Manager as a peer. Not published.
export default defineNuxtConfig({
  extends: ['..', '@nuxt4-layers/theme-manager'],
  css: ['~/assets/css/main.css'],
  compatibilityDate: '2026-06-30',
})
