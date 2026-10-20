import { randomBytes } from 'node:crypto'
import type { ConfigurationClock } from '../../shared/contracts'
import { ConfigurationFailure } from '../../shared/contracts'

/**
 * PRIVATE. Time and identifiers. Every time Configuration keeps or judges
 * comes from the host's clock; a clock that throws or answers anything but a
 * valid `Date` fails the operation closed as `unavailable`.
 */

export const systemConfigurationClock: ConfigurationClock = Object.freeze({ now: () => new Date() })

export function timeFrom(clock: ConfigurationClock): Date {
  let answer: unknown
  try {
    answer = clock.now()
  }
  catch {
    throw new ConfigurationFailure('unavailable', 'clock-failed')
  }
  if (!(answer instanceof Date) || !Number.isFinite(answer.getTime())) throw new ConfigurationFailure('unavailable', 'clock-invalid')
  return new Date(answer.getTime())
}

/** A UUIDv7 (RFC 9562) for the given time. */
export function uuidv7(at: number): string {
  const bytes = randomBytes(16)
  bytes.writeUIntBE(Math.max(0, Math.floor(at)), 0, 6)
  bytes[6] = (bytes[6]! & 0x0f) | 0x70
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
