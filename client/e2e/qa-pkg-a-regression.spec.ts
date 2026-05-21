/**
 * Deep QA — broader regression. Walks Home → Marketplace → Dashboard →
 * AI button → Discover; captures console errors; checks direct refresh
 * on /discover and /marketplace.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://hockia-git-staging-cristian-uriens-projects.vercel.app \
 *   QA_PROBE=1 npx playwright test e2e/qa-pkg-a-regression.spec.ts --project=chromium
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test'
import * as fs from 'node:fs'

const PASSWORD = 'Hola1234'
const COACH = 'coachplayr@gmail.com' // use coach to avoid rate-limit on player

interface ConsoleEntry {
  type: string
  text: string
}

function isInfraNoise(text: string): boolean {
  return (
    text.includes('Failed to load resource') ||
    text.toLowerCase().includes('source map') ||
    text.toLowerCase().includes('hmr') ||
    text.includes('Download the React DevTools') ||
    text.includes('vercel.live/_next-live/feedback') ||
    text.includes('google.com/g/collect') ||
    text.includes('analytics.google.com/g/collect') ||
    text.includes('[NOTIFICATIONS] Failed to fetch') ||
    text.includes('[UNREAD] Failed to fetch') ||
    text.includes('[OPPORTUNITY_ALERTS] Failed to fetch') ||
    text.includes('[REALTIME]') ||
    text.includes('subscribe to channel timed out')
  )
}

function attachConsole(page: Page, errors: ConsoleEntry[]) {
  const handler = (msg: ConsoleMessage) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (isInfraNoise(text)) return
    errors.push({ type: 'error', text })
  }
  page.on('console', handler)
  page.on('pageerror', err => {
    errors.push({ type: 'pageerror', text: err.message })
  })
}

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

test.describe.configure({ timeout: 240_000 })
test.use({ viewport: { width: 390, height: 844 } })

test.describe('@qa Package A regression', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  test('walk Home → Marketplace → Dashboard → AI button → Discover, capture console', async ({ page }) => {
    const errors: ConsoleEntry[] = []
    attachConsole(page, errors)

    await signIn(page, COACH)

    // /home
    await page.goto('/home')
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: 'test-results/pkg-a-regression-home.png', fullPage: false })

    // Marketplace via header button (mobile viewport)
    const marketplaceBtn = page.getByRole('button', { name: 'Marketplace', exact: true }).first()
    await marketplaceBtn.click({ timeout: 10_000 })
    await page.waitForURL('**/marketplace', { timeout: 10_000 })
    await expect(page.getByRole('heading', { level: 1, name: /^marketplace$/i })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/pkg-a-regression-marketplace.png', fullPage: false })

    // Dashboard via bottom-nav avatar
    const dashboardBtn = page.getByRole('button', { name: /go to dashboard/i }).first()
    await dashboardBtn.click({ force: true, timeout: 10_000 })
    await page.waitForURL(url => url.pathname.startsWith('/dashboard'), { timeout: 10_000 })
    await page.screenshot({ path: 'test-results/pkg-a-regression-dashboard.png', fullPage: false })

    // Back to /home, tap floating AI button
    await page.goto('/home')
    await page.waitForLoadState('domcontentloaded')
    const aiBtn = page.getByRole('button', { name: 'Open Hockia AI' })
    await expect(aiBtn).toBeVisible({ timeout: 10_000 })
    await aiBtn.click()
    await page.waitForURL('**/discover', { timeout: 10_000 })
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: 'test-results/pkg-a-regression-discover.png', fullPage: false })

    fs.writeFileSync(
      'test-results/pkg-a-regression-console.json',
      JSON.stringify(errors, null, 2),
    )
  })

  test('direct refresh: /discover loads from cold', async ({ page }) => {
    const errors: ConsoleEntry[] = []
    attachConsole(page, errors)
    await signIn(page, COACH)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    // Empty-state greeting should render.
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/pkg-a-direct-discover.png', fullPage: false })
    fs.writeFileSync(
      'test-results/pkg-a-discover-direct-console.json',
      JSON.stringify(errors, null, 2),
    )
  })

  test('direct refresh: /marketplace loads from cold', async ({ page }) => {
    const errors: ConsoleEntry[] = []
    attachConsole(page, errors)
    await signIn(page, COACH)
    await page.goto('/marketplace')
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByRole('heading', { level: 1, name: /^marketplace$/i })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/pkg-a-direct-marketplace.png', fullPage: false })
    fs.writeFileSync(
      'test-results/pkg-a-marketplace-direct-console.json',
      JSON.stringify(errors, null, 2),
    )
  })
})
