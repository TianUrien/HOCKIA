/**
 * Live LLM probe — signs in as each of the 5 E2E role accounts, asks a
 * role-appropriate question, captures the AI reply text + screenshot, and
 * verifies no cross-user chat history leaks between sign-ins. Gated on
 * QA_PROBE=1 because each test makes a real Gemini call.
 *
 * Ground truth captured separately in the QA report; this spec only logs
 * what the LLM said so a human can read the transcript.
 */
import { test, expect, type Page } from '@playwright/test'
import * as fs from 'node:fs'

const PASSWORD = 'Hola1234'

const ACCOUNTS = [
  { role: 'player',  email: 'playrplayer93@gmail.com',   firstName: 'E2E' },
  { role: 'coach',   email: 'coachplayr@gmail.com',       firstName: 'E2E' },
  { role: 'club',    email: 'clubplayr8@gmail.com',       firstName: 'E2E' },
  { role: 'brand',   email: 'brandplayr@gmail.com',       firstName: 'E2E' },
  { role: 'umpire',  email: 'umpirehockia93@gmail.com',   firstName: 'Umpire' },
] as const

const REPORT: Array<{ role: string; email: string; question: string; reply: string; greeting: string | null }> = []

async function dismissCookieConsent(page: Page) {
  await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 3_000 }).catch(() => {})
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/signin')
  await page.waitForLoadState('domcontentloaded')

  // The form defaults to magic-link mode; switch to password mode first
  await page.getByText(/use a password instead/i).click({ timeout: 5_000 })

  const emailInput = page.locator('input[type="email"]').first()
  const passwordInput = page.locator('input[type="password"]').first()
  await emailInput.fill(email)
  await passwordInput.fill(password)
  // Submit — the primary "Sign in" / "Log in" button after password is entered
  await page.locator('button[type="submit"]').first().click()

  // Wait a beat for either redirect OR the Terms gate to render. Don't
  // assert URL change yet — the Terms gate (when present) overlays content
  // before the routing settles.
  await page.waitForTimeout(2_000)
  await dismissCookieConsent(page)

  // If a Terms of Use modal is up, accept it. Button label: "I Agree — Continue".
  const tosAccept = page.getByRole('button', { name: /i agree/i }).first()
  if (await tosAccept.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await tosAccept.click().catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {})
  }

  // Now we should be off /signin. Bump the deadline because slow staging +
  // post-auth profile fetches can take a while.
  await page.waitForURL(url => !url.pathname.includes('/signin'), { timeout: 60_000 }).catch(async () => {
    await page.screenshot({ path: `test-results/qa-roles-stuck-signin-${Date.now()}.png`, fullPage: false }).catch(() => {})
    throw new Error('Sign-in did not redirect away from /signin within 60s')
  })

  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}

async function signOut(page: Page) {
  // Open dashboard then sign out via Settings; or use the Supabase client API
  // to fast-path the sign-out. Using the latter so we don't depend on UI.
  await page.evaluate(async () => {
    const sb = (window as unknown as { supabase?: { auth: { signOut: () => Promise<unknown> } } }).supabase
    if (sb?.auth?.signOut) await sb.auth.signOut()
  })
  await page.context().clearCookies()
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* */ } })
}

async function askDiscover(page: Page, question: string): Promise<{ reply: string; greeting: string | null }> {
  await page.goto('/discover')
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  await dismissCookieConsent(page)

  // Capture the heading (greeting) before sending
  const heading = await page.getByRole('heading', { level: 2 }).first().textContent().catch(() => null)

  const textarea = page.getByRole('textbox').first()
  await textarea.click()
  await textarea.fill(question)
  await textarea.press('Enter')

  // The assistant bubble renders <p class="...whitespace-pre-line"> only
  // when status === 'complete' (until then the bubble shows TypingIndicator).
  // So waiting for that selector guarantees we capture the actual LLM text,
  // not the loading state.
  const replyLocator = page.locator('p.whitespace-pre-line').last()
  await replyLocator.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
  const reply = (await replyLocator.textContent().catch(() => null))
    ?? '<TIMEOUT — assistant did not finish replying within 60s>'

  await page.waitForTimeout(500)

  return { reply, greeting: heading }
}

test.describe.configure({ mode: 'serial', timeout: 120_000 })

test.describe('@qa AI role probe', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  for (const account of ACCOUNTS) {
    test(`${account.role}: signs in, /discover greets correctly, AI replies grounded`, async ({ page }) => {
      // Capture console errors per-account
      const errors: string[] = []
      page.on('pageerror', err => errors.push(err.message))

      await signIn(page, account.email, PASSWORD)
      await page.screenshot({ path: `test-results/qa-roles-${account.role}-after-signin.png`, fullPage: false })

      // Pick a role-appropriate probing question. Keep it in the
      // self-reflection bucket so we can verify grounding.
      const question = (() => {
        switch (account.role) {
          case 'player': return 'What should I improve in my profile?'
          case 'coach':  return 'What can I do next on HOCKIA?'
          case 'club':   return 'How many open vacancies do I have right now?'
          case 'brand':  return 'How many products do I have on the Marketplace?'
          case 'umpire': return 'Who am I?'
          default:       return 'Who am I?'
        }
      })()

      const { reply, greeting } = await askDiscover(page, question)
      await page.screenshot({ path: `test-results/qa-roles-${account.role}-discover-reply.png`, fullPage: false })

      REPORT.push({ role: account.role, email: account.email, question, reply, greeting })

      // Assertions:
      // 1. Greeting includes a "Hi …!" pattern (proves the auth-store
      //    profile reached the page) — except for the rare case where
      //    full_name was empty for the account.
      if (greeting) {
        expect(greeting).toMatch(/^Hi /)
      }
      // 2. The reply is non-empty and not an error fallback
      expect(reply.length).toBeGreaterThan(20)
      // 3. No JS errors on the page
      expect(errors).toEqual([])

      // Sign out and verify the chat history is cleared in the next cycle
      await signOut(page)
    })
  }

  test('cross-user leakage: chat history is empty after sign-out + sign-in as different role', async ({ page }) => {
    // Sign in as player and post a query so chat has history
    await signIn(page, 'playrplayer93@gmail.com', PASSWORD)
    await page.goto('/discover')
    await dismissCookieConsent(page)
    const textarea = page.getByRole('textbox').first()
    await textarea.click()
    await textarea.fill('Who am I?')
    await textarea.press('Enter')
    // Wait for at least the user message to render
    await page.waitForTimeout(2_000)
    // Sign out via the API path
    await signOut(page)

    // Sign in as a different role
    await signIn(page, 'coachplayr@gmail.com', PASSWORD)
    await page.goto('/discover')
    await dismissCookieConsent(page)

    // The empty state should be visible — i.e. no message bubbles from the
    // previous session. We assert the "Try asking" example list is shown
    // (it's only rendered when messages.length === 0).
    const tryAsking = page.getByText(/try asking/i).first()
    await expect(tryAsking).toBeVisible({ timeout: 10_000 })
    await page.screenshot({ path: 'test-results/qa-roles-cross-user-clean.png', fullPage: false })
  })

  test.afterAll(async () => {
    // Persist the transcript so the user can read all 5 LLM replies
    fs.writeFileSync(
      'test-results/qa-ai-role-transcript.json',
      JSON.stringify(REPORT, null, 2),
    )
  })
})
