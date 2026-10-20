<script setup lang="ts">
/**
 * The organisation's legal name, registration, tax number and registered
 * address: what UK company websites must show. A group that trades
 * separately passes its `groupId`.
 */
const props = defineProps<{ groupId?: string }>()
const text = useConfigurationText()
const { value } = useConfiguration({ groupId: () => props.groupId })

interface Address { lines: string[], locality?: string, region?: string, postcode?: string, country: string }
const legalName = value<string>('organisation.legal-name')
const tradingName = value<string>('organisation.trading-name')
const registration = value<{ jurisdiction: string, number: string }>('organisation.registration')
const taxNumber = value<{ scheme: string, number: string }>('organisation.tax-number')
const address = value<Address>('organisation.registered-address')
const addressLines = computed(() => address.value ? [...address.value.lines, address.value.locality, address.value.region, address.value.postcode, address.value.country].filter(Boolean) as string[] : [])
const taxLabel = computed(() => {
  if (!taxNumber.value) return ''
  const specific = `configuration.organisation.tax-number.${taxNumber.value.scheme}`
  const label = text(specific, { number: taxNumber.value.number })
  return label === specific ? text('configuration.organisation.tax-number', { number: taxNumber.value.number }) : label
})
</script>

<template>
  <section v-if="legalName" :aria-label="text('configuration.organisation.label')">
    <p>
      <strong>{{ legalName }}</strong>
      <template v-if="tradingName && tradingName !== legalName">
        ({{ tradingName }})
      </template>
    </p>
    <p v-if="registration">
      {{ text('configuration.organisation.registration', registration) }}
    </p>
    <p v-if="taxNumber">
      {{ taxLabel }}
    </p>
    <address v-if="addressLines.length">
      <span>{{ text('configuration.organisation.registered-address') }}:</span>
      <template v-for="line in addressLines" :key="line">
        <br>{{ line }}
      </template>
    </address>
  </section>
</template>
