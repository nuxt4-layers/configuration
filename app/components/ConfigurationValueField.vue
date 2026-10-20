<script setup lang="ts">
/**
 * One value's form, built from its JSON Schema: text, choices, numbers,
 * switches, groups of fields and lists. Anything else is edited as JSON. It
 * decides nothing: the server checks every value again.
 */
defineOptions({ name: 'ConfigurationValueField' })
const props = defineProps<{ schema: Record<string, unknown>, id: string, label: string, required?: boolean, hint?: string }>()
const model = defineModel<unknown>()
const text = useConfigurationText()

type Schema = Record<string, unknown> & { type?: string, enum?: string[], anyOf?: Schema[], properties?: Record<string, Schema>, required?: string[], items?: Schema, format?: string }
const schema = computed(() => props.schema as Schema)
const kind = computed(() => {
  const s = schema.value
  if (Array.isArray(s.enum)) return 'choice'
  if (s.type === 'string' || (Array.isArray(s.anyOf) && s.anyOf.every(option => option.type === 'string'))) return 'text'
  if (s.type === 'number' || s.type === 'integer') return 'number'
  if (s.type === 'boolean') return 'switch'
  if (s.type === 'object' && s.properties) return 'group'
  if (s.type === 'array' && s.items?.type === 'string' && !s.items.enum) return 'lines'
  if (s.type === 'array' && s.items?.type === 'object') return 'list'
  return 'json'
})

const fieldLabel = (name: string) => hasConfigurationMessage(`configuration.field.${name}`) ? text(`configuration.field.${name}`) : name
const optionLabel = (value: string) => hasConfigurationMessage(`configuration.social.${value}`) ? text(`configuration.social.${value}`) : value

const textValue = computed({
  get: () => typeof model.value === 'string' ? model.value : model.value === undefined || model.value === null ? '' : String(model.value),
  set: (value: string) => { model.value = value },
})
const numberValue = computed({
  get: () => typeof model.value === 'number' ? String(model.value) : '',
  set: (value: string) => { model.value = value === '' ? undefined : Number(value) },
})
const switchValue = computed({
  get: () => model.value === true,
  set: (value: boolean) => { model.value = value },
})
const lines = computed({
  get: () => Array.isArray(model.value) ? (model.value as unknown[]).join('\n') : '',
  set: (value: string) => { model.value = value.split('\n').map(line => line.trim()).filter(Boolean) },
})
const json = ref(model.value === undefined ? '' : JSON.stringify(model.value, null, 2))
watch(json, (value) => {
  try {
    model.value = value.trim() === '' ? undefined : JSON.parse(value)
  }
  catch {
    // Left as it is: the server answers with the problem when it is sent.
  }
})

const group = computed(() => (model.value && typeof model.value === 'object' && !Array.isArray(model.value) ? model.value : {}) as Record<string, unknown>)
function setProperty(name: string, value: unknown) {
  model.value = { ...group.value, [name]: value }
}

const items = computed(() => (Array.isArray(model.value) ? model.value : []) as Record<string, unknown>[])
function setItem(index: number, value: unknown) {
  const next = [...items.value]
  next[index] = value as Record<string, unknown>
  model.value = next
}
function addItem() {
  model.value = [...items.value, {}]
}
function removeItem(index: number) {
  model.value = items.value.filter((_, at) => at !== index)
}
const describedBy = computed(() => props.hint || kind.value === 'lines' ? `${props.id}-hint` : undefined)
</script>

<template>
  <fieldset v-if="kind === 'group'" :class="configurationClasses.fieldset">
    <legend :class="configurationClasses.legend">{{ label }}</legend>
    <ConfigurationValueField
      v-for="(child, name) in schema.properties"
      :key="name"
      :id="`${id}-${name}`"
      :schema="child"
      :label="fieldLabel(String(name))"
      :required="schema.required?.includes(String(name))"
      :model-value="group[name]"
      @update:model-value="value => setProperty(String(name), value)"
    />
  </fieldset>

  <fieldset v-else-if="kind === 'list'" :class="configurationClasses.fieldset">
    <legend :class="configurationClasses.legend">{{ label }}</legend>
    <div v-for="(item, index) in items" :key="index" :class="configurationClasses.stack">
      <ConfigurationValueField
        :id="`${id}-${index}`"
        :schema="schema.items!"
        :label="`${label} ${index + 1}`"
        :model-value="item"
        @update:model-value="value => setItem(index, value)"
      />
      <div :class="configurationClasses.row">
        <button type="button" :class="configurationClasses.secondaryButton" @click="removeItem(index)">{{ text('configuration.common.remove') }}</button>
      </div>
    </div>
    <div :class="configurationClasses.row">
      <button type="button" :class="configurationClasses.secondaryButton" @click="addItem">{{ text('configuration.common.add') }}</button>
    </div>
  </fieldset>

  <div v-else-if="kind === 'switch'" :class="configurationClasses.row">
    <input :id="id" v-model="switchValue" type="checkbox" :class="configurationClasses.checkbox">
    <label :for="id" :class="configurationClasses.label">{{ label }}</label>
  </div>

  <div v-else>
    <label :for="id" :class="configurationClasses.label">{{ label }}</label>
    <select v-if="kind === 'choice'" :id="id" v-model="textValue" :class="configurationClasses.select" :required="required" :aria-describedby="describedBy">
      <option value="" />
      <option v-for="option in schema.enum" :key="option" :value="option">{{ optionLabel(option) }}</option>
    </select>
    <input v-else-if="kind === 'text'" :id="id" v-model="textValue" :type="schema.format === 'email' ? 'email' : 'text'" :class="configurationClasses.input" :required="required" :aria-describedby="describedBy">
    <input v-else-if="kind === 'number'" :id="id" v-model="numberValue" type="number" :class="configurationClasses.input" :required="required" :aria-describedby="describedBy">
    <textarea v-else-if="kind === 'lines'" :id="id" v-model="lines" rows="4" :class="configurationClasses.input" :aria-describedby="describedBy" />
    <textarea v-else :id="id" v-model="json" rows="6" :class="configurationClasses.input" :aria-describedby="describedBy" />
    <p v-if="hint || kind === 'lines'" :id="`${id}-hint`" :class="configurationClasses.hint">{{ hint ?? text('configuration.admin.one-per-line') }}</p>
  </div>
</template>
