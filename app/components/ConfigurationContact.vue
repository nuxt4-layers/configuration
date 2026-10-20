<script setup lang="ts">
/** An organisational contact point: `contact.general` (default) or `contact.data-protection`. */
const props = withDefaults(defineProps<{ kind?: 'general' | 'data-protection', groupId?: string }>(), { kind: 'general' })
const text = useConfigurationText()
const { values } = useConfiguration({ groupId: () => props.groupId })
const contact = computed(() => values.value[`contact.${props.kind}`] as { email?: string, phone?: string, url?: string } | undefined)
</script>

<template>
  <dl v-if="contact" :aria-label="text('configuration.contact.label')">
    <template v-if="contact.email">
      <dt>{{ text('configuration.contact.email') }}</dt>
      <dd><a :href="`mailto:${contact.email}`">{{ contact.email }}</a></dd>
    </template>
    <template v-if="contact.phone">
      <dt>{{ text('configuration.contact.phone') }}</dt>
      <dd><a :href="`tel:${contact.phone}`">{{ contact.phone }}</a></dd>
    </template>
    <template v-if="contact.url">
      <dt>{{ text('configuration.contact.url') }}</dt>
      <dd><a :href="contact.url" rel="noopener">{{ contact.url }}</a></dd>
    </template>
  </dl>
</template>
