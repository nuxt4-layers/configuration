import { useConfiguration } from './useConfiguration'

/**
 * Sets the document's title template, language, description and Open Graph
 * site name from the public values for this host name.
 */
export function useConfigurationHead() {
  const { values } = useConfiguration()
  useHead(() => {
    const name = values.value['site.name'] as string | undefined
    const template = values.value['seo.title-template'] as string | undefined
    const description = values.value['seo.description'] as string | undefined
    return {
      titleTemplate: (title?: string) => !title ? (name ?? null) : template ? template.replace('%s', title) : name ? `${title} · ${name}` : title,
      htmlAttrs: { lang: (values.value['site.default-locale'] as string | undefined) ?? 'en-GB' },
      meta: [
        ...(description ? [{ name: 'description', content: description }] : []),
        ...(name ? [{ property: 'og:site_name', content: name }] : []),
      ],
    }
  })
}
