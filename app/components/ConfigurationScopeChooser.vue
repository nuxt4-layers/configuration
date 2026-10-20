<script setup lang="ts">
/**
 * Chooses which settings to administer. The tenant is always the one this
 * host name belongs to; a tenant's settings are governed from one of its
 * root groups, a group's from the group itself, and your account's by you alone.
 */
const props = defineProps<{ scope?: string, groupId?: string, governingGroupId?: string }>()
const text = useConfigurationText()
const route = useRoute()
const scope = ref(props.scope ?? 'group')
const groupId = ref(props.groupId ?? '')
const governingGroupId = ref(props.governingGroupId ?? '')
function show() {
  const query: Record<string, string> = { scope: scope.value }
  if (scope.value === 'group') query.groupId = groupId.value.trim()
  if (scope.value === 'tenant') query.governingGroupId = governingGroupId.value.trim()
  return navigateTo({ path: route.path, query })
}
</script>

<template>
  <form :class="configurationClasses.stack" @submit.prevent="show">
    <fieldset :class="configurationClasses.fieldset">
      <legend :class="configurationClasses.legend">{{ text('configuration.admin.choose-scope') }}</legend>
      <div v-for="option in ['account', 'group', 'tenant', 'platform']" :key="option" :class="configurationClasses.row">
        <input :id="`configuration-scope-${option}`" v-model="scope" type="radio" name="scope" :value="option" :class="configurationClasses.radio">
        <label :for="`configuration-scope-${option}`" :class="configurationClasses.label">{{ text(`configuration.admin.scope.${option}`) }}</label>
      </div>
    </fieldset>
    <div v-if="scope === 'group'">
      <label for="configuration-group-id" :class="configurationClasses.label">{{ text('configuration.admin.group-id') }}</label>
      <input id="configuration-group-id" v-model="groupId" type="text" :class="configurationClasses.input" required>
    </div>
    <div v-if="scope === 'tenant'">
      <label for="configuration-governing-group-id" :class="configurationClasses.label">{{ text('configuration.admin.governing-group-id') }}</label>
      <input id="configuration-governing-group-id" v-model="governingGroupId" type="text" :class="configurationClasses.input" required>
    </div>
    <div :class="configurationClasses.row">
      <button type="submit" :class="configurationClasses.primaryButton">{{ text('configuration.admin.show') }}</button>
    </div>
  </form>
</template>
