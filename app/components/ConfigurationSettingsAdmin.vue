<script setup lang="ts">
import type { ConfigurationAdminScope } from '../composables/useConfigurationAdministration'

/** A scope's settings, each with its value in force and a form to change it. */
const props = defineProps<{ scope: ConfigurationAdminScope }>()
const administration = useConfigurationAdministration()
const action = useConfigurationAction()
const text = action.text
const routes = useConfigurationRoutes()
const { data: view, error, refresh } = await useAsyncData(
  () => `configuration-admin:${JSON.stringify(props.scope)}`,
  () => administration.readScope(props.scope),
)
const failure = computed(() => error.value ? action.messageFor(configurationErrorOf(error.value)) : null)
const unauthenticated = computed(() => configurationErrorOf(error.value)?.code === 'unauthenticated')
</script>

<template>
  <div :class="configurationClasses.stack">
    <ConfigurationAlert v-if="failure" tone="error">
      <p>{{ failure }}</p>
      <p v-if="unauthenticated && routes.signIn" class="mt-2"><NuxtLink :to="routes.signIn" :class="configurationClasses.link">{{ text('configuration.error.unauthenticated') }}</NuxtLink></p>
    </ConfigurationAlert>
    <template v-else-if="view">
      <ConfigurationAlert v-if="view.closed" tone="warning" :focus-on-mount="false">{{ text('configuration.admin.closed') }}</ConfigurationAlert>
      <p v-if="routes.changes">
        <NuxtLink :to="{ path: routes.changes, query: { ...scope } }" :class="configurationClasses.actionLink">
          {{ text('configuration.admin.view-changes') }} ({{ view.openChanges.length }})
        </NuxtLink>
      </p>
      <p v-if="view.declarations.length === 0">{{ text('configuration.admin.no-settings') }}</p>
      <ul v-else :class="configurationClasses.list">
        <ConfigurationSettingEditor v-for="declaration in view.declarations" :key="declaration.key" :declaration="declaration" :view="view" :scope="scope" @changed="refresh()" />
      </ul>
    </template>
  </div>
</template>
