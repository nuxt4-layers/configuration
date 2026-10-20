import AxeBuilder from '@axe-core/playwright'
import { expect, test, type APIRequestContext, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { ORIGIN } from './constants'

/**
 * The administration pages in a real browser, against the built playground
 * with Theme Manager's styles: changing settings, approving a high-risk
 * change, keyboard use, and axe against WCAG 2.2 AA in light and dark mode.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

interface Scenario { tenantId: string, rootGroup: string, team: string, alice: string, bob: string, carol: string }

async function seed(request: APIRequestContext): Promise<Scenario> {
  const response = await request.post('/api/__playground/seed')
  expect(response.ok()).toBe(true)
  return response.json()
}

/** Stands in for Authentication: the playground reads the signed-in identity from this cookie in test mode. */
async function signInAs(context: BrowserContext, identityId: string) {
  await context.clearCookies()
  await context.addCookies([{ name: 'configuration_playground_subject', value: identityId, url: ORIGIN }])
}

/** Axe in light mode, then in dark mode (Theme Manager's `dark` class), then back. */
async function expectAccessible(page: Page) {
  for (const dark of [false, true]) {
    await page.evaluate(on => document.documentElement.classList.toggle('dark', on), dark)
    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
    expect(results.violations.map(v => `${dark ? 'dark' : 'light'} ${v.id}: ${v.nodes.map(n => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

/** WCAG 1.4.11, which axe does not check: a field's border and the focus indicator need 3:1 against their surface. */
async function expectNonTextContrast(page: Page, selector: string) {
  const ratios = await page.evaluate((target) => {
    const parse = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = (value: string) => {
      const [r, g, b] = parse(value).map((c) => {
        const v = c / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const ratio = (a: string, b: string) => {
      const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
      return (x! + 0.05) / (y! + 0.05)
    }
    const surface = (element: Element) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const colour = getComputedStyle(node).backgroundColor
        if (colour !== 'rgba(0, 0, 0, 0)') return colour
      }
      return 'rgb(255, 255, 255)'
    }
    const input = document.querySelector(target) as HTMLInputElement
    input.focus()
    const style = getComputedStyle(input)
    return {
      border: ratio(style.borderTopColor, surface(input)),
      focus: ratio(style.outlineColor, surface(input)),
      focusVisible: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 2,
    }
  }, selector)
  expect(ratios.focusVisible).toBe(true)
  expect(ratios.border).toBeGreaterThanOrEqual(3)
  expect(ratios.focus).toBeGreaterThanOrEqual(3)
}

const setting = (page: Page, name: string): Locator => page.getByRole('listitem').filter({ has: page.getByRole('heading', { level: 2, name, exact: true }) })
const settingsOf = (team: string) => `/configuration?scope=group&groupId=${team}`
const changesOf = (team: string) => `/configuration/changes?scope=group&groupId=${team}`

test('asks a signed-out visitor to sign in', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await context.clearCookies()
  await page.goto(settingsOf(scenario.team))
  await expect(page.getByRole('alert')).toContainText('Sign in to administer these settings.')
  await expectAccessible(page)
})

test('protects the pages from framing, caching and referrer leaks', async ({ request }) => {
  for (const path of ['/configuration', '/configuration/changes']) {
    const response = await request.get(path)
    expect(response.headers()['x-frame-options'], path).toBe('DENY')
    expect(response.headers()['cache-control'], path).toBe('no-store')
    expect(response.headers()['referrer-policy'], path).toBe('no-referrer')
  }
})

test('tells a member who may not administer the settings, without saying more', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.carol)
  await page.goto(settingsOf(scenario.team))
  await expect(page.getByRole('alert')).toContainText('You cannot administer these settings, or they do not exist.')
})

test('offers a choice of settings when the address names none', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.alice)
  await page.goto('/configuration')
  await page.getByLabel('Group identifier').fill(scenario.team)
  await page.getByRole('button', { name: 'Show settings' }).click()
  await expect(setting(page, 'Tagline')).toBeVisible()
  await expectAccessible(page)
})

test('applies a low-risk change at once, by keyboard', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.alice)
  await page.goto(settingsOf(scenario.team))
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible()
  await expectAccessible(page)

  const tagline = setting(page, 'Tagline')
  await tagline.getByRole('button', { name: 'Change' }).focus()
  await page.keyboard.press('Enter')
  await expectNonTextContrast(page, '#configuration-site-tagline-value')
  await tagline.getByLabel('Tagline').fill('Making widgets since 1999')
  await tagline.getByRole('button', { name: 'Save' }).focus()
  await page.keyboard.press('Enter')
  await expect(tagline.getByRole('status')).toHaveText('Saved.')
  await expect(tagline).toContainText('Making widgets since 1999')
  await expect(tagline).toContainText('Set here')
  await expectAccessible(page)
})

test('builds forms for structured settings, and explains a refused value in words', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.alice)
  await page.goto(settingsOf(scenario.team))
  const social = setting(page, 'Social media links')
  await social.getByRole('button', { name: 'Change' }).click()
  await social.getByRole('button', { name: 'Add' }).click()
  await social.getByLabel('Network').selectOption('mastodon')
  await social.getByLabel('Web address').fill('javascript:alert(1)')
  await social.getByRole('button', { name: 'Save' }).click()
  await expect(social.getByRole('alert')).toHaveText('Enter an https address or a path on this site starting with /.')
  await expectAccessible(page)
  await social.getByLabel('Web address').fill('https://mastodon.social/@acme')
  await social.getByRole('button', { name: 'Save' }).click()
  await expect(social.getByRole('status')).toHaveText('Saved.')
  await expect(social).toContainText('mastodon, https://mastodon.social/@acme')
})

test('sends a high-risk change for approval, which another manager gives', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.alice)
  await page.goto(settingsOf(scenario.team))
  const legal = setting(page, 'Legal name')
  await expect(legal).toContainText('High risk: needs a second person')
  await legal.getByRole('button', { name: 'Change' }).click()
  await legal.getByLabel('Legal name').fill('Acme Widgets Ltd')
  await legal.getByLabel('Reason').selectOption('legal-requirement')
  await legal.getByRole('button', { name: 'Save' }).click()
  await expect(legal.getByRole('status')).toContainText('Sent for approval. It applies once 1 other person approves')
  await expect(legal).toContainText('A change is awaiting a decision')
  await expect(legal).toContainText('Not set')

  await page.getByRole('link', { name: /Changes awaiting a decision/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Changes awaiting a decision' })).toBeVisible()
  const change = page.getByRole('article', { name: 'Legal name' })
  await expect(change).toContainText('You requested this change.')
  await expect(change.getByRole('button', { name: 'Approve' })).toHaveCount(0)
  await expect(change.getByRole('button', { name: 'Withdraw' })).toBeVisible()
  await expectAccessible(page)

  await signInAs(context, scenario.bob)
  await page.goto(changesOf(scenario.team))
  await expect(change).toContainText('Acme Widgets Ltd')
  await change.getByRole('button', { name: 'Approve' }).click()
  await expect(page.getByRole('status')).toHaveText('Approved and applied.')
  await expect(page.getByText('No changes are awaiting a decision.')).toBeVisible()

  await page.goto(settingsOf(scenario.team))
  await expect(setting(page, 'Legal name')).toContainText('Acme Widgets Ltd')
})

test('reflows to a narrow screen without horizontal scrolling', async ({ page, context, request }) => {
  const scenario = await seed(request)
  await signInAs(context, scenario.alice)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto(settingsOf(scenario.team))
  await expect(setting(page, 'Tagline')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
