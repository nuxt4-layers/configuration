<script setup lang="ts">
const text = useConfigurationText()
const scope = useConfigurationAdminScope()
const route = useRoute()
useHead({ title: text('configuration.admin.title') })
</script>

<template>
  <main :class="configurationClasses.page">
    <div :class="configurationClasses.card">
      <h1 :class="configurationClasses.title">{{ text('configuration.admin.title') }}</h1>
      <ConfigurationSettingsAdmin v-if="scope" :key="JSON.stringify(scope)" :scope="scope" />
      <ConfigurationScopeChooser v-else :scope="route.query.scope as string | undefined" />
    </div>
  </main>
</template>
