/**
 * PR-2 visual verification — captures screenshots of each rendered state
 * to confirm the dispatcher routes responses to the right component.
 *
 * Targets the staging Vercel deploy with PR-1 backend + PR-2 frontend.
 *
 * Run:
 *   PLAYWRIGHT_BASE_URL=https://hockia-git-staging-cristian-uriens-projects.vercel.app \
 *   QA_PROBE=1 npx playwright test e2e/qa-pr2-visual.spec.ts --project=chromium
 */
import { test, type Page } from '@playwright/test'

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
  const textarea = page.getByRole('textbox').first()
  await textarea.click()
  await textarea.fill(query)
  await textarea.press('Enter')
  // Wait for the assistant card to fully populate (chips, applied strip, etc.)
  await page.waitForTimeout(500) // user message + assistant placeholder
  // Wait for the typing indicator to disappear
  await page.waitForFunction(
    () => !document.querySelector('.animate-bounce'),
    { timeout: 90_000 },
  ).catch(() => {})
  await page.waitForTimeout(500) // allow chip layout to settle
}

async function snapAssistantCard(page: Page, name: string) {
  // Capture full mobile-viewport view of the chat area for review.
  await page.screenshot({ path: `test-results/pr2-${name}.png`, fullPage: false })
}

test.describe.configure({ timeout: 180_000 })

test.describe('@qa PR-2 visual states', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  // Mobile viewport so the floating AI button + bottom-nav are visible.
  test.use({ viewport: { width: 390, height: 844 } })

  test('player: no_results card (the screenshot scenario)', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find clubs for me')
    await snapAssistantCard(page, 'no_results')
  })

  test('player: text response with self-advice chips', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Who should I connect with?')
    await snapAssistantCard(page, 'self_advice_chips')
  })

  test('player: greeting with single chip', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Hi')
    await snapAssistantCard(page, 'greeting_chip')
  })

  test('player: canned_redirect card with CTA button', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find opportunities for my position')
    await snapAssistantCard(page, 'canned_redirect')
  })

  test('brand: search_results card', async ({ page }) => {
    await signIn(page, BRAND)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find player ambassadors')
    await snapAssistantCard(page, 'search_results')
  })

  test('player: chip tap submits as new user message', async ({ page }) => {
    await signIn(page, PLAYER)
    await page.goto('/discover')
    await page.waitForLoadState('domcontentloaded')
    await dismissCookieConsent(page)
    await ask(page, 'Find clubs for me')
    await snapAssistantCard(page, 'chip_before_tap')
    // Tap "Show all clubs" chip — should resubmit as a new user message.
    const showAllChip = page.getByRole('button', { name: /show all clubs/i }).first()
    await showAllChip.click({ timeout: 5_000 })
    await page.waitForTimeout(1500)
    await page.waitForFunction(
      () => !document.querySelector('.animate-bounce'),
      { timeout: 90_000 },
    ).catch(() => {})
    await page.waitForTimeout(500)
    await snapAssistantCard(page, 'chip_after_tap')
  })
})
