<script setup lang="ts">
/** The site's name for this host name (`site.name`), as text. */
const { value } = useConfiguration()
const name = value<string>('site.name')
</script>

<template>
  <span v-if="name">{{ name }}</span>
</template>
