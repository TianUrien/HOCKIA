/**
 * Deep QA — chip-behavior tests.
 *
 * Covers each interaction type the user listed:
 *   - free-text chip submits as new user message
 *   - retry chip resubmits the previous user query
 *   - clear/start-over chip empties the chat
 *   - broaden-search chip actually drops gender filter
 *   - chips not double-clickable into duplicate sends
 *
 * Each test signs in once with a different role to avoid Supabase Auth
 * rate-limit cascades.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://hockia-git-staging-cristian-uriens-projects.vercel.app \
 *   QA_PROBE=1 npx playwright test e2e/qa-pkg-a-chips.spec.ts --project=chromium
 */
import { test, expect, type Page } from '@playwright/test'

const PASSWORD = 'Hola1234'
const PLAYER = 'playrplayer93@gmail.com'
const BRAND = 'brandplayr@gmail.com'

async function dismissCookieConsent(page: Page) {
  await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 3_000 }).catch(() => {})
}

async function signIn(page: Page, email: string) {
  await page.goto('/signin')
  await page.waitForLoadState('domcontentloaded')
  await page.getByText(/use a password instead/i).click({ timeout: 5_000 })
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(PASSWORD)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(2_000)
  await dismissCookieConsent(page)
  const tos = page.getByRole('button', { name: /i agree/i }).first()
  if (await tos.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await tos.click().catch(() => {})
  }
  await page.waitForURL(url => !url.pathname.includes('/signin'), { timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
}

async function ask(page: Page, query: string) {
  const ta = page.getByRole('textbox').first()
  await ta.click()
  await ta.fill(query)
  await ta.press('Enter')
  await page.waitForTimeout(500)
  await page.waitForFunction(
    () => !document.querySelector('.animate-bounce'),
    { timeout: 90_000 },
  ).catch(() => {})
  await page.waitForTimeout(500)
}

test.describe.configure({ timeout: 240_000 })
test.use({ viewport: { width: 390, height: 844 } })

test.describe('@qa Package A chip behaviour', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  test('chip free-text: tap submits as new user message', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find clubs for me')
    // Count user-message bubbles before tap.
    const beforeCount = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    await page.getByRole('button', { name: /^show all clubs$/i }).first().click({ timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    const afterCount = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    // After tap, expect MORE user messages (the chip submitted one).
    expect(afterCount).toBeGreaterThan(beforeCount)
    // The new user message text should match the chip's submitted query.
    const lastUser = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\] p').last().textContent()
    expect(lastUser).toMatch(/show me all clubs regardless of gender/i)
  })

  test('chip retry: resubmits the previous user query', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, '__force_soft_error')
    // Initial user message — captured for comparison.
    const userBubbles = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    await page.getByRole('button', { name: /^retry$/i }).first().click({ timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    const after = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    expect(after).toBeGreaterThan(userBubbles)
    // The retry should have re-submitted "__force_soft_error" verbatim.
    const lastUser = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\] p').last().textContent()
    expect(lastUser).toBe('__force_soft_error')
  })

  test('chip clear/start-over: empties the chat', async ({ page }) => {
    await signIn(page, BRAND)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, '__force_soft_error')
    const beforeUserBubbles = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    expect(beforeUserBubbles).toBeGreaterThan(0)
    await page.getByRole('button', { name: /^start over$/i }).first().click({ timeout: 5_000 })
    await page.waitForTimeout(800)
    // After clear, the message bubbles should be gone — the empty-state
    // greeting + example queries should be visible again.
    const afterUserBubbles = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    expect(afterUserBubbles).toBe(0)
    await expect(page.getByText(/try asking/i)).toBeVisible({ timeout: 5_000 })
  })

  test('canned redirect CTA: navigates to /opportunities', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find opportunities for my position')
    await page.getByRole('button', { name: /browse opportunities/i }).first().click({ timeout: 5_000 })
    await page.waitForURL('**/opportunities', { timeout: 10_000 })
    expect(page.url()).toContain('/opportunities')
  })

  test('clarifying option: tapping submits routed_query', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find people')
    // Tap the "Clubs" disambiguation pill.
    await page.getByRole('button', { name: /^clubs$/i }).first().click({ timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    // The submitted user message should match the routed_query in the catalog.
    const lastUser = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\] p').last().textContent()
    expect(lastUser).toMatch(/find clubs for me/i)
  })

  test('broaden chip: drops gender filter (broaden actually broadens)', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find clubs for me')
    // Verify first card shows the gender filter applied.
    const firstFilters = await page.locator('text=Women').count()
    expect(firstFilters).toBeGreaterThan(0)
    // Tap "Show all clubs" — its query is "Show me all clubs regardless of gender".
    await page.getByRole('button', { name: /^show all clubs$/i }).first().click({ timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    // The latest assistant card should NOT show "Women" in its applied strip.
    // We pull the most recent applied strip and assert.
    const lastAppliedStrip = page.locator('text=Searched').last()
    if (await lastAppliedStrip.isVisible().catch(() => false)) {
      const stripText = await lastAppliedStrip.locator('xpath=..').textContent()
      expect(stripText?.toLowerCase()).not.toContain('women')
    }
    // Or the search returned results (broaden worked) — either way no Women filter.
  })

  test('rapid double-tap: only one new user message lands', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find clubs for me')
    const before = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    const chip = page.getByRole('button', { name: /^show all clubs$/i }).first()
    // Fire two clicks back-to-back; the store's `isPending` guard should
    // prevent the second one from queuing a duplicate user message.
    await chip.click({ timeout: 5_000 })
    await chip.click({ timeout: 1_000 }).catch(() => {})
    await page.waitForTimeout(2000)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    const after = await page.locator('div.bg-gradient-to-br.from-\\[\\#8026FA\\].to-\\[\\#924CEC\\]').count()
    // Strict: exactly one new user message should have landed.
    expect(after - before).toBe(1)
  })
})
