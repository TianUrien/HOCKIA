/**
 * Final Phase 0 staging-UI verification.
 *
 * Runs against the live staging URL. Triggers each scenario through the
 * actual deployed UI, captures screenshots + browser-console errors, then
 * walks through the top-level routes (Home, Marketplace, Dashboard) to
 * confirm no regression.
 *
 * Telemetry verification happens out-of-band via SQL against the staging
 * Supabase project — this spec is responsible for *triggering* the events;
 * the report cross-references DB rows after the spec finishes.
 *
 * Important: signs in ONCE per role (Supabase rate-limits ~5 attempts/min/user).
 * Each role group runs serially with the same browser context.
 *
 * Gated on QA_PROBE=1.
 */
import { test, expect, type Page, type ConsoleMessage, type BrowserContext } from '@playwright/test'
import * as fs from 'node:fs'

const PASSWORD = 'Hola1234'

const ACCOUNTS = {
  player: 'playrplayer93@gmail.com',
  club:   'clubplayr8@gmail.com',
  brand:  'brandplayr@gmail.com',
} as const

const SCENARIOS_BY_ROLE = {
  player: [
    { query: 'Find clubs for me', expect: 'clubs' },
    { query: 'Find opportunities for my position', expect: 'canned-opps' },
    { query: 'Find coaches in Germany', expect: 'coaches' },
  ],
  club: [
    { query: 'Find players for my team', expect: 'players' },
  ],
  brand: [
    { query: 'Find player ambassadors', expect: 'players' },
    { query: 'Show me products', expect: 'canned-products' },
  ],
} as const

interface ConsoleEntry {
  type: string
  text: string
  location: string
}

function attachConsoleCapture(page: Page) {
  const errors: ConsoleEntry[] = []
  const warnings: ConsoleEntry[] = []
  const handler = (msg: ConsoleMessage) => {
    const type = msg.type()
    const text = msg.text()
    const loc = msg.location()
    const where = `${loc.url ?? '?'}:${loc.lineNumber ?? '?'}`
    // Filter known noise (pre-existing infra, not Phase 0)
    const noise =
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
    if (noise) return
    if (type === 'error') errors.push({ type, text, location: where })
    if (type === 'warning') warnings.push({ type, text, location: where })
  }
  page.on('console', handler)
  page.on('pageerror', err => {
    errors.push({ type: 'pageerror', text: err.message, location: err.stack?.split('\n')[1] ?? '?' })
  })
  return { errors, warnings }
}

async function dismissCookieConsent(page: Page) {
  await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 3_000 }).catch(() => {})
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/signin')
  await page.waitForLoadState('domcontentloaded')
  await page.getByText(/use a password instead/i).click({ timeout: 5_000 })
  await page.locator('input[type="email"]').first().fill(email)
  await page.locator('input[type="password"]').first().fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForTimeout(2_000)
  await dismissCookieConsent(page)
  const tosAccept = page.getByRole('button', { name: /i agree/i }).first()
  if (await tosAccept.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await tosAccept.click().catch(() => {})
  }
  await page.waitForURL(url => !url.pathname.includes('/signin'), { timeout: 60_000 })
  await page.waitForLoadState('domcontentloaded')
}

interface ScenarioReport {
  role: string
  email: string
  query: string
  expect: string
  ai_reply: string | null
  greeting_text: string | null
  console_errors: ConsoleEntry[]
  console_warnings: ConsoleEntry[]
  screenshot: string
  duration_ms: number
}

function appendReport(entry: ScenarioReport) {
  const path = 'test-results/qa-staging-ui-report.json'
  let existing: ScenarioReport[] = []
  try {
    existing = JSON.parse(fs.readFileSync(path, 'utf-8')) as ScenarioReport[]
  } catch {
    existing = []
  }
  existing.push(entry)
  fs.writeFileSync(path, JSON.stringify(existing, null, 2))
}

test.describe.configure({ timeout: 240_000 })

// Reset the report file at the start of the run.
test.beforeAll(async () => {
  try {
    fs.mkdirSync('test-results', { recursive: true })
    fs.writeFileSync('test-results/qa-staging-ui-report.json', '[]')
  } catch { /* ignore */ }
})

for (const [role, scenarios] of Object.entries(SCENARIOS_BY_ROLE)) {
  const email = ACCOUNTS[role as keyof typeof ACCOUNTS]

  test.describe.serial(`@qa Phase 0 staging UI — ${role}`, () => {
    test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

    let context: BrowserContext
    let page: Page
    let errors: ConsoleEntry[]
    let warnings: ConsoleEntry[]
    let signedIn = false

    test.beforeAll(async ({ browser }) => {
      context = await browser.newContext()
      page = await context.newPage()
      const captured = attachConsoleCapture(page)
      errors = captured.errors
      warnings = captured.warnings
      await signIn(page, email, PASSWORD)
      signedIn = true
    })

    test.afterAll(async () => {
      await context?.close().catch(() => {})
    })

    for (const sc of scenarios) {
      test(`${role}: "${sc.query}"`, async () => {
        test.skip(!signedIn, 'sign-in failed')
        const startedAt = Date.now()

        // Reach Discover via the floating AI button (real user flow).
        // On desktop the floating button isn't shown, so fall back to /discover.
        await page.goto('/home')
        await page.waitForLoadState('domcontentloaded')
        const aiBtn = page.getByRole('button', { name: 'Open Hockia AI' })
        if (await aiBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
          await aiBtn.click()
          await page.waitForURL('**/discover', { timeout: 10_000 })
        } else {
          await page.goto('/discover')
        }
        await page.waitForLoadState('domcontentloaded')

        const greetingText = await page
          .getByRole('heading', { level: 2 })
          .first()
          .textContent()
          .catch(() => null)

        const textarea = page.getByRole('textbox').first()
        await textarea.click()
        await textarea.fill(sc.query)
        await textarea.press('Enter')

        const reply = page.locator('p.whitespace-pre-line').last()
        await reply.waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {})
        const replyText = (await reply.textContent().catch(() => null)) ?? null

        const safeName = sc.query.slice(0, 40).replace(/[^a-z]/gi, '_')
        const screenshot = `test-results/qa-staging-ui-${role}-${safeName}.png`
        await page.screenshot({ path: screenshot, fullPage: false })

        appendReport({
          role,
          email,
          query: sc.query,
          expect: sc.expect,
          ai_reply: replyText,
          greeting_text: greetingText,
          console_errors: [...errors],
          console_warnings: [...warnings],
          screenshot,
          duration_ms: Date.now() - startedAt,
        })
        // Reset the per-page console arrays for the next scenario
        errors.length = 0
        warnings.length = 0

        expect(replyText, `${sc.query} should produce an AI reply`).toBeTruthy()
      })
    }
  })
}

// Regression sweep — top-level routes after AI work.
// Uses its own context, signs in once.
test.describe.serial('@qa Phase 0 staging UI — regression', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  test('regression: Home → Marketplace → Dashboard → AI button → /discover', async ({ browser }) => {
    // Mobile viewport — the floating AI button is mobile-only.
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const page = await context.newPage()
    const { errors } = attachConsoleCapture(page)

    // Use brand account; player is the most rate-limit-prone since it has the
    // most scenarios. Brand has only 2 AI scenarios so it's least contended.
    await signIn(page, ACCOUNTS.brand, PASSWORD)

    await page.goto('/home')
    await page.waitForLoadState('domcontentloaded')
    await page.screenshot({ path: 'test-results/qa-staging-regression-home.png', fullPage: false })

    const marketplaceBtn = page.getByRole('button', { name: 'Marketplace', exact: true }).first()
    await marketplaceBtn.click()
    await page.waitForURL('**/marketplace', { timeout: 10_000 })
    await expect(page.getByRole('heading', { level: 1, name: /^marketplace$/i })).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/qa-staging-regression-marketplace.png', fullPage: false })

    const dashboardBtn = page.getByRole('button', { name: /go to dashboard/i }).first()
    // Avatar img inside the button intercepts pointer events; bypass actionability check
    await dashboardBtn.click({ force: true })
    await page.waitForURL(url => url.pathname.startsWith('/dashboard'), { timeout: 10_000 })
    await page.screenshot({ path: 'test-results/qa-staging-regression-dashboard.png', fullPage: false })

    await page.goto('/home')
    await page.waitForLoadState('domcontentloaded')
    const aiBtn = page.getByRole('button', { name: 'Open Hockia AI' })
    await expect(aiBtn).toBeVisible({ timeout: 10_000 })
    await aiBtn.click()
    await page.waitForURL('**/discover', { timeout: 10_000 })

    fs.writeFileSync(
      'test-results/qa-staging-regression-errors.json',
      JSON.stringify(errors, null, 2),
    )
    await context.close()
  })
})
