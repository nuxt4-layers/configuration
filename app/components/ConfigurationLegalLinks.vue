<script setup lang="ts">
/** Links to the legal pages (`legal.links`), in a fixed order. */
const props = defineProps<{ groupId?: string }>()
const text = useConfigurationText()
const { value } = useConfiguration({ groupId: () => props.groupId })
const legal = value<Record<string, string | undefined>>('legal.links')
const ORDER = ['privacy', 'terms', 'cookies', 'accessibility', 'modern-slavery'] as const
const links = computed(() => ORDER.flatMap(name => legal.value?.[name] ? [{ name, href: legal.value[name]! }] : []))
</script>

<template>
  <nav v-if="links.length" :aria-label="text('configuration.legal.label')">
    <ul>
      <li v-for="link in links" :key="link.name">
        <NuxtLink :to="link.href">
          {{ text(`configuration.legal.${link.name}`) }}
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
