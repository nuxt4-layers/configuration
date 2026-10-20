<script setup lang="ts">
const text = useConfigurationText()
const scope = useConfigurationAdminScope()
useHead({ title: text('configuration.admin.changes-title') })
</script>

<template>
  <main :class="configurationClasses.page">
    <div :class="configurationClasses.card">
      <h1 :class="configurationClasses.title">{{ text('configuration.admin.changes-title') }}</h1>
      <ConfigurationChangesAdmin v-if="scope" :key="JSON.stringify(scope)" :scope="scope" />
      <ConfigurationScopeChooser v-else />
    </div>
  </main>
</template>
