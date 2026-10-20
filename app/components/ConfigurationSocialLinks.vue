<script setup lang="ts">
/** The organisation's social media links (`social.links`), as a labelled list. */
const props = defineProps<{ groupId?: string }>()
const text = useConfigurationText()
const { value } = useConfiguration({ groupId: () => props.groupId })
const links = value<{ network: string, url: string }[]>('social.links')
</script>

<template>
  <nav v-if="links?.length" :aria-label="text('configuration.social.label')">
    <ul>
      <li v-for="link in links" :key="link.url">
        <a :href="link.url" rel="me noopener">{{ text(`configuration.social.${link.network}`) }}</a>
      </li>
    </ul>
  </nav>
</template>
