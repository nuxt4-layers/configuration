import { afterEach, describe, expect, it } from 'vitest'
import { CONFIGURATION_RETENTION } from '../shared/contracts'
import { clearConfigurationComposition, provideConfigurationRetention, useConfigurationRetention } from '../server/utils/configuration-composition'

describe('Composition: retention', () => {
  afterEach(() => clearConfigurationComposition())

  it('keeps history 400 days unless the host chooses, within 30 to 2,190 days', () => {
    expect(useConfigurationRetention()).toBe(400)
    expect(CONFIGURATION_RETENTION).toEqual({ defaultDays: 400, minimumDays: 30, maximumDays: 2190 })
    provideConfigurationRetention({ days: 30 })
    expect(useConfigurationRetention()).toBe(30)
    provideConfigurationRetention({ days: 2190 })
    expect(useConfigurationRetention()).toBe(2190)
  })

  it('refuses a period outside the bounds at start-up, keeping the one in force', () => {
    provideConfigurationRetention({ days: 90 })
    for (const days of [29, 2191, 90.5, Number.NaN]) expect(() => provideConfigurationRetention({ days })).toThrow(/30 to 2190/)
    expect(useConfigurationRetention()).toBe(90)
    clearConfigurationComposition()
    expect(useConfigurationRetention()).toBe(400)
  })
})
