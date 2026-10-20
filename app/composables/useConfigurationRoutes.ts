/** Where the layer's pages are, and the host's sign-in page; empty when the pages are off. */
export function useConfigurationRoutes() {
  return (useRuntimeConfig().public as { configuration?: { routes?: { settings?: string, changes?: string, signIn?: string } } }).configuration?.routes ?? {}
}
