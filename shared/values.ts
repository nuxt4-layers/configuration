import { z } from 'zod'

/**
 * Building blocks for settings' value schemas (docs/contracts.md §3.3).
 * Every string is bounded; text carries no markup and pages render it as text.
 */

const UNSAFE_CHARACTERS = /[\p{Cc}\p{Cf}\p{Co}\p{Cs}]/u

function codePoints(value: string): number {
  return [...value].length
}

/** Safe text: NFC, spaces collapsed and trimmed, no control, format or private-use characters. */
export function safeTextSchema({ min = 1, max }: { min?: number, max: number }) {
  return z.string()
    .overwrite(value => value.normalize('NFC').replace(/\s+/gu, ' ').trim())
    .refine(value => !UNSAFE_CHARACTERS.test(value), 'unsafe-characters')
    .refine(value => codePoints(value) >= min, 'too-short')
    .refine(value => codePoints(value) <= max, 'too-long')
}

/** An `https` URL without credentials, at most 2,048 characters. */
export const httpsUrlSchema = z.string().max(2048, 'too-long').refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  }
  catch {
    return false
  }
}, 'not-an-https-url')

/** A site-relative path such as `/legal/privacy`: no scheme, no host, no `..`. */
export const sitePathSchema = z.string().max(512, 'too-long').regex(/^\/(?!\/)[A-Za-z0-9\-._~/%]*$/, 'not-a-site-path').refine(value => !value.split('/').includes('..'), 'not-a-site-path')

/** Either of the above, for links that may stay on the site. */
export const linkSchema = z.union([httpsUrlSchema, sitePathSchema], { error: 'not-a-link' })

export const emailSchema = z.email({ error: 'not-an-email' }).max(254, 'too-long')

/** E.164, e.g. `+442079460000`. */
export const phoneNumberSchema = z.string().regex(/^\+[1-9][0-9]{6,14}$/, 'not-a-phone-number')

/** A BCP 47 language tag, e.g. `en-GB`, `cy-GB`. */
export const localeSchema = z.string().max(35).regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, 'not-a-locale')

/** ISO 3166-1 alpha-2. */
export const countryCodeSchema = z.string().regex(/^[A-Z]{2}$/, 'not-a-country-code')

/** A code chosen from a host's or the layer's list: `mastodon`, `gb-vat`. */
export const codeSchema = z.string().max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, 'not-a-code')

/** A reference to a file in the host's asset store, with its alternative text. */
export const assetReferenceSchema = z.strictObject({
  assetId: z.string().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'not-an-asset-id'),
  alt: safeTextSchema({ min: 0, max: 250 }),
})

export const postalAddressSchema = z.strictObject({
  lines: z.array(safeTextSchema({ max: 120 })).min(1).max(4),
  locality: safeTextSchema({ max: 120 }).optional(),
  region: safeTextSchema({ max: 120 }).optional(),
  postcode: safeTextSchema({ max: 20 }).optional(),
  country: countryCodeSchema,
})

export const contactPointSchema = z.strictObject({
  email: emailSchema.optional(),
  phone: phoneNumberSchema.optional(),
  url: httpsUrlSchema.optional(),
}).refine(value => value.email !== undefined || value.phone !== undefined || value.url !== undefined, 'empty-contact')
