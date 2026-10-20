<script setup lang="ts">
import type { ConfigurationProvenance } from '../../shared/contracts'
import type { ConfigurationAdminScope, ConfigurationDeclarationView, ConfigurationScopeView } from '../composables/useConfigurationAdministration'

/**
 * One setting of a scope: its value in force and where it comes from, and a
 * form to change or clear it. Saving requests a change, which applies at
 * once or waits for approval; the server decides which.
 */
const props = defineProps<{ declaration: ConfigurationDeclarationView, view: ConfigurationScopeView, scope: ConfigurationAdminScope }>()
const emit = defineEmits<{ changed: [] }>()
const administration = useConfigurationAdministration()
const action = useConfigurationAction()
const text = action.text

const REASONS = ['correction', 'update', 'rebrand', 'legal-requirement', 'new-domain', 'other'] as const
const key = computed(() => props.declaration.key)
const domId = computed(() => `configuration-${key.value.replace(/\W/g, '-')}`)
const label = computed(() => hasConfigurationMessage(`configuration.setting.${key.value}`) ? text(`configuration.setting.${key.value}`) : key.value)
const setHere = computed(() => Object.hasOwn(props.view.values, key.value))
const inForce = computed(() => props.view.inForce?.values[key.value])
const provenance = computed(() => props.view.inForce?.provenance[key.value] as ConfigurationProvenance | undefined)
const pending = computed(() => props.view.openChanges.some(change => change.keys.includes(key.value)))
const where = computed(() => {
  if (setHere.value) return text('configuration.admin.set-here')
  if (!provenance.value) return text('configuration.admin.not-set')
  return text(`configuration.admin.inherited.${provenance.value.source}`)
})

const editing = ref(false)
const draft = ref<unknown>(undefined)
const reasonCode = ref<string>('update')
const reference = ref('')
const notice = ref<string | null>(null)

function edit() {
  draft.value = structuredClone(toRaw(props.view.values[key.value] ?? inForce.value))
  notice.value = null
  editing.value = true
}

function target(): Record<string, string> {
  if (props.scope.scope === 'platform') return { scope: 'platform' }
  if (props.scope.scope === 'group') return { scope: 'group', groupId: props.scope.groupId }
  return { scope: 'tenant', tenantId: props.view.tenantId ?? '', governingGroupId: props.scope.governingGroupId }
}

async function send(value: unknown) {
  notice.value = null
  const change = await action.run(() => administration.requestChange({
    target: target(),
    set: { [key.value]: value },
    expected: { [key.value]: props.view.digests[key.value] ?? null },
    justification: { reasonCode: reasonCode.value, ...(reference.value.trim() ? { reference: reference.value.trim() } : {}) },
  }))
  if (!change) return
  const time = text('configuration.common.utc', { time: formatConfigurationTime(change.expiresAt ?? change.appliesAt) })
  notice.value = change.status === 'applied'
    ? text('configuration.admin.saved')
    : change.route === 'published-delay'
      ? text('configuration.admin.delayed', { time })
      : change.route === 'approvers'
        ? text('configuration.admin.awaiting', { count: change.requiredApprovals, time })
        : text('configuration.admin.awaiting-owner', { time })
  editing.value = false
  emit('changed')
}

const save = () => send(pruneConfigurationValue(draft.value) ?? null)
const clear = () => send(null)
</script>

<template>
  <li :class="configurationClasses.listItem">
    <div :class="configurationClasses.stack" class="w-full">
      <div :class="configurationClasses.row">
        <h2 :id="`${domId}-label`" :class="configurationClasses.legend">{{ label }}</h2>
        <span :class="configurationClasses.badge">{{ text(`configuration.admin.risk.${declaration.risk}`) }}</span>
        <span v-if="pending" :class="configurationClasses.badge">{{ text('configuration.admin.pending') }}</span>
      </div>
      <p :class="configurationClasses.text">{{ summariseConfigurationValue(inForce) || text('configuration.admin.not-set') }}</p>
      <p :class="configurationClasses.muted">{{ where }}</p>

      <ConfigurationAlert v-if="action.error.value" tone="error">{{ action.error.value }}</ConfigurationAlert>
      <ConfigurationAlert v-if="notice" tone="success" :focus-on-mount="false">{{ notice }}</ConfigurationAlert>

      <div v-if="!editing && !view.closed" :class="configurationClasses.row">
        <button type="button" :class="configurationClasses.secondaryButton" :aria-describedby="`${domId}-label`" :disabled="action.disabled.value" @click="edit">{{ text('configuration.common.edit') }}</button>
      </div>

      <form v-if="editing" :class="configurationClasses.stack" novalidate @submit.prevent="save">
        <ConfigurationValueField :id="`${domId}-value`" v-model="draft" :schema="declaration.schema" :label="label" />
        <div>
          <label :for="`${domId}-reason`" :class="configurationClasses.label">{{ text('configuration.admin.reason') }}</label>
          <select :id="`${domId}-reason`" v-model="reasonCode" :class="configurationClasses.select">
            <option v-for="reason in REASONS" :key="reason" :value="reason">{{ text(`configuration.reason-code.${reason}`) }}</option>
          </select>
        </div>
        <div>
          <label :for="`${domId}-reference`" :class="configurationClasses.label">{{ text('configuration.admin.reference') }}</label>
          <input :id="`${domId}-reference`" v-model="reference" type="text" :class="configurationClasses.input" :aria-describedby="`${domId}-reference-hint`">
          <p :id="`${domId}-reference-hint`" :class="configurationClasses.hint">{{ text('configuration.admin.reference-hint') }}</p>
        </div>
        <div :class="configurationClasses.row">
          <button type="submit" :class="configurationClasses.primaryButton" :disabled="action.disabled.value">{{ text('configuration.common.save') }}</button>
          <button v-if="setHere" type="button" :class="configurationClasses.dangerButton" :disabled="action.disabled.value" @click="clear">{{ text('configuration.admin.clear') }}</button>
          <button type="button" :class="configurationClasses.secondaryButton" @click="editing = false">{{ text('configuration.common.cancel') }}</button>
        </div>
      </form>
    </div>
  </li>
</template>
