/**
 * Phase 0 acceptance probe — runs the 6 scenarios the user asked for, signs
 * into the matching role account, sends the query, captures the AI reply
 * AND the staging database row to verify entity-type purity.
 *
 * Gated on QA_PROBE=1.
 */
import { test, expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import * as fs from 'node:fs'

const PASSWORD = 'Hola1234'
const SUPABASE_URL = process.env.VITE_SUPABASE_URL!
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface Scenario {
  account: { role: string; email: string }
  query: string
  expected_entity_type: string
  expected_role_in_results: string | null  // null when canned/no search
  expectation: string
}

const SCENARIOS: Scenario[] = [
  {
    account: { role: 'player', email: 'playrplayer93@gmail.com' },
    query: 'Find clubs for me',
    expected_entity_type: 'clubs',
    expected_role_in_results: 'club',
    expectation: 'all results have role=club, no players/coaches/brands',
  },
  {
    account: { role: 'player', email: 'playrplayer93@gmail.com' },
    query: 'Find opportunities for my position',
    expected_entity_type: 'opportunities',
    expected_role_in_results: null,
    expectation: 'canned redirect to /opportunities, no mixed profile results',
  },
  {
    account: { role: 'player', email: 'playrplayer93@gmail.com' },
    query: 'Find coaches in Germany',
    expected_entity_type: 'coaches',
    expected_role_in_results: 'coach',
    expectation: 'all results have role=coach',
  },
  {
    account: { role: 'club', email: 'clubplayr8@gmail.com' },
    query: 'Find players for my team',
    expected_entity_type: 'players',
    expected_role_in_results: 'player',
    expectation: 'all results have role=player',
  },
  {
    account: { role: 'brand', email: 'brandplayr@gmail.com' },
    query: 'Find player ambassadors',
    expected_entity_type: 'players',
    expected_role_in_results: 'player',
    expectation: 'all results have role=player',
  },
  {
    account: { role: 'brand', email: 'brandplayr@gmail.com' },
    query: 'Show me products',
    expected_entity_type: 'products',
    expected_role_in_results: null,
    expectation: 'canned redirect to /marketplace, no mixed profile results',
  },
]

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
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
}

async function signOutFast(page: Page) {
  await page.evaluate(async () => {
    const sb = (window as unknown as { supabase?: { auth: { signOut: () => Promise<unknown> } } }).supabase
    if (sb?.auth?.signOut) await sb.auth.signOut()
  })
  await page.context().clearCookies()
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear() } catch { /* */ } })
}

interface ScenarioResult {
  account: string
  query: string
  expected_entity_type: string
  expected_role_in_results: string | null
  /** What the AI replied (text). */
  ai_reply: string
  /** What the keyword router classified the query as (from discovery_events._meta). */
  router_entity_type: string
  router_confidence: string
  /** What the backend actually enforced. */
  enforced_role: string | null
  filter_source: string
  effective_roles: string[]
  /** Are all returned profiles the expected role? */
  all_results_correct_role: boolean | null
  result_count: number
  response_time_ms: number
  pass: boolean
  notes: string[]
}

const REPORT: ScenarioResult[] = []

async function fetchLatestEventByQuery(queryText: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  // Wait briefly for the fire-and-forget event insert to land
  await new Promise(r => setTimeout(r, 2_500))
  const { data } = await supabase
    .from('discovery_events')
    .select('parsed_filters, result_count, response_time_ms, intent, user_id')
    .eq('query_text', queryText)
    .gte('created_at', new Date(Date.now() - 60_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data as { parsed_filters: any; result_count: number; response_time_ms: number; intent: string; user_id: string } | null
}

test.describe.configure({ mode: 'serial', timeout: 180_000 })

test.describe('@qa Phase 0 acceptance', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')
  test.skip(!SUPABASE_URL || !SUPABASE_SERVICE_KEY, 'staging Supabase service key required')

  for (const scenario of SCENARIOS) {
    test(`${scenario.account.role}: "${scenario.query}" → ${scenario.expected_entity_type}`, async ({ page }) => {
      await signIn(page, scenario.account.email, PASSWORD)

      // Send the query via the Discover UI
      await page.goto('/discover')
      await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
      await dismissCookieConsent(page)
      const textarea = page.getByRole('textbox').first()
      await textarea.click()
      await textarea.fill(scenario.query)
      await textarea.press('Enter')

      // Wait for the assistant reply text to render
      const replyLocator = page.locator('p.whitespace-pre-line').last()
      await replyLocator.waitFor({ state: 'visible', timeout: 60_000 }).catch(() => {})
      const aiReply = (await replyLocator.textContent().catch(() => null)) ?? '<no reply>'

      // Pull the discovery_events row to check what the backend actually did
      const event = await fetchLatestEventByQuery(scenario.query)
      const meta = event?.parsed_filters?._meta ?? {}

      // Verify the backend enforced exactly the expected role(s)
      let allCorrectRole: boolean | null = null
      if (scenario.expected_role_in_results) {
        const effective = meta.effective_roles as string[] | undefined
        allCorrectRole = !!effective
          && effective.length === 1
          && effective[0] === scenario.expected_role_in_results
      }

      const notes: string[] = []
      const checks = {
        router_correct: meta.router_entity_type === scenario.expected_entity_type,
        confidence_high: meta.router_confidence === 'high',
        enforcement_correct: scenario.expected_role_in_results
          ? meta.enforced_role === scenario.expected_role_in_results
          : (event?.intent === 'canned_redirect'),
        no_mixed_results: allCorrectRole !== false,
      }
      if (!checks.router_correct) notes.push(`router classified as ${meta.router_entity_type}, expected ${scenario.expected_entity_type}`)
      if (!checks.confidence_high) notes.push(`confidence was ${meta.router_confidence}, not high`)
      if (!checks.enforcement_correct) notes.push(`enforcement: enforced_role=${meta.enforced_role}, intent=${event?.intent}`)
      if (allCorrectRole === false) notes.push(`mixed results — effective_roles=${JSON.stringify(meta.effective_roles)}`)

      const pass = Object.values(checks).every(Boolean)

      REPORT.push({
        account: scenario.account.email,
        query: scenario.query,
        expected_entity_type: scenario.expected_entity_type,
        expected_role_in_results: scenario.expected_role_in_results,
        ai_reply: aiReply,
        router_entity_type: meta.router_entity_type ?? '<missing>',
        router_confidence: meta.router_confidence ?? '<missing>',
        enforced_role: meta.enforced_role ?? null,
        filter_source: meta.filter_source ?? '<missing>',
        effective_roles: meta.effective_roles ?? [],
        all_results_correct_role: allCorrectRole,
        result_count: event?.result_count ?? 0,
        response_time_ms: event?.response_time_ms ?? 0,
        pass,
        notes,
      })

      await page.screenshot({ path: `test-results/qa-phase0-${scenario.account.role}-${scenario.query.slice(0, 30).replace(/[^a-z]/gi, '_')}.png`, fullPage: false })

      // Soft-assert: log every check so we can iterate on the worst scenario,
      // but DON'T short-circuit the suite on the first miss. The aggregate
      // pass/fail comes from REPORT in the afterAll write-out.
      console.log(`  ${pass ? 'PASS' : 'FAIL'} — router=${meta.router_entity_type}/${meta.router_confidence}, enforced=${meta.enforced_role}, source=${meta.filter_source}, results=${event?.result_count}, ms=${event?.response_time_ms}`)
      if (!pass) {
        for (const n of notes) console.log(`    note: ${n}`)
      }

      await signOutFast(page)
    })
  }

  test.afterAll(async () => {
    fs.writeFileSync(
      'test-results/qa-phase0-report.json',
      JSON.stringify(REPORT, null, 2),
    )
  })
})
