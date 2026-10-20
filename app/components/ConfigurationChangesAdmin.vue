<script setup lang="ts">
import type { ConfigurationChange } from '../../shared/contracts'
import type { ConfigurationAdminScope } from '../composables/useConfigurationAdministration'

/**
 * A scope's open changes: what each would do beside what is there now, and,
 * for whoever may decide, approve or reject; the requester may withdraw.
 * Whether someone may decide is the server's call: the buttons only offer.
 */
const props = defineProps<{ scope: ConfigurationAdminScope }>()
const administration = useConfigurationAdministration()
const action = useConfigurationAction()
const text = action.text
const routes = useConfigurationRoutes()
const notice = ref<string | null>(null)
const { data: view, error, refresh } = await useAsyncData(
  () => `configuration-changes:${JSON.stringify(props.scope)}`,
  () => administration.readScope(props.scope),
)
const failure = computed(() => error.value ? action.messageFor(configurationErrorOf(error.value)) : null)
const labelOf = (key: string) => hasConfigurationMessage(`configuration.setting.${key}`) ? text(`configuration.setting.${key}`) : key
const time = (iso: string | null) => text('configuration.common.utc', { time: formatConfigurationTime(iso) })

function routeText(change: ConfigurationChange): string {
  if (change.status === 'delayed' || change.route === 'published-delay') return text('configuration.change.route.published-delay', { time: time(change.appliesAt) })
  return text(`configuration.change.route.${change.route}`, { count: change.requiredApprovals, time: time(change.expiresAt) })
}

async function decide(change: ConfigurationChange, decision: 'approve' | 'reject') {
  notice.value = null
  const result = await action.run(() => administration.decide(change, decision))
  if (!result) return
  notice.value = result.status === 'applied' ? text('configuration.change.approved') : text('configuration.change.recorded')
  await refresh()
}

async function withdraw(change: ConfigurationChange) {
  notice.value = null
  if (await action.run(() => administration.cancel(change))) {
    notice.value = text('configuration.change.withdrawn')
    await refresh()
  }
}
</script>

<template>
  <div :class="configurationClasses.stack">
    <p v-if="routes.settings">
      <NuxtLink :to="{ path: routes.settings, query: { ...scope } }" :class="configurationClasses.actionLink">{{ text('configuration.admin.view-settings') }}</NuxtLink>
    </p>
    <ConfigurationAlert v-if="failure" tone="error">{{ failure }}</ConfigurationAlert>
    <ConfigurationAlert v-if="action.error.value" tone="error">{{ action.error.value }}</ConfigurationAlert>
    <ConfigurationAlert v-if="notice" tone="success" :focus-on-mount="false">{{ notice }}</ConfigurationAlert>
    <template v-if="view">
      <p v-if="view.openChanges.length === 0" :class="configurationClasses.text">{{ text('configuration.admin.no-changes') }}</p>
      <ul :class="configurationClasses.list">
        <li v-for="change in view.openChanges" :key="change.changeId" :class="configurationClasses.listItem">
          <article :aria-labelledby="`change-${change.changeId}`" :class="configurationClasses.stack" class="w-full">
            <div :class="configurationClasses.row">
              <h2 :id="`change-${change.changeId}`" :class="configurationClasses.legend">{{ change.keys.map(labelOf).join(', ') }}</h2>
              <span :class="configurationClasses.badge">{{ text(`configuration.admin.risk.${change.risk}`) }}</span>
            </div>
            <p :class="configurationClasses.muted">{{ text('configuration.change.requested', { time: time(change.requestedAt) }) }} · {{ text(`configuration.reason-code.${change.justification.reasonCode}`) }}<template v-if="change.justification.reference"> · {{ change.justification.reference }}</template></p>
            <p :class="configurationClasses.text">{{ routeText(change) }}</p>
            <p v-if="change.heldUntil" :class="configurationClasses.text">{{ text('configuration.change.held', { time: time(change.heldUntil) }) }}</p>
            <dl v-for="key in change.keys" :key="key" :class="configurationClasses.definitions">
              <dt :class="configurationClasses.term">{{ labelOf(key) }}: {{ text('configuration.change.current') }}</dt>
              <dd :class="configurationClasses.definition">{{ summariseConfigurationValue(view.values[key]) || text('configuration.admin.not-set') }}</dd>
              <dt :class="configurationClasses.term">{{ labelOf(key) }}: {{ text('configuration.change.proposed') }}</dt>
              <dd :class="configurationClasses.definition">{{ summariseConfigurationValue(change.set[key]) || text('configuration.admin.not-set') }}</dd>
            </dl>
            <p v-if="change.requesterId === view.viewerId" :class="configurationClasses.muted">{{ text('configuration.change.yours') }}</p>
            <div :class="configurationClasses.row">
              <template v-if="change.requesterId === view.viewerId">
                <button type="button" :class="configurationClasses.secondaryButton" :disabled="action.disabled.value" @click="withdraw(change)">{{ text('configuration.change.cancel') }}</button>
              </template>
              <template v-else-if="change.status === 'awaiting'">
                <button type="button" :class="configurationClasses.primaryButton" :disabled="action.disabled.value" @click="decide(change, 'approve')">{{ text('configuration.change.approve') }}</button>
                <button type="button" :class="configurationClasses.dangerButton" :disabled="action.disabled.value" @click="decide(change, 'reject')">{{ text('configuration.change.reject') }}</button>
              </template>
            </div>
          </article>
        </li>
      </ul>
    </template>
  </div>
</template>
