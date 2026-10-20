import { useRuntimeConfig } from '#imports'
import { setTrustForwardedHost } from '../internal/http'

/** Applies the layer's runtime configuration to its HTTP boundary. */
export default defineNitroPlugin(() => {
  setTrustForwardedHost(useRuntimeConfig().configuration?.trustForwardedHost === true)
})
