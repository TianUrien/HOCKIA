import { test, expect, Page } from './fixtures'

/**
 * @smoke
 *
 * Diagnostic spec for the Friends-tab scroll bug. Reproduces the user's
 * report: on mobile viewport, after the page is scrolled down so the tab
 * strip is at the bottom edge of the viewport, clicking each tab in
 * sequence should bring the tab strip back to the top of the viewport
 * (via `useTabDeepLinkScroll` -> `scrollIntoView({block:'start'})` on
 * `#profile-tab-content`).
 *
 * The user reports Friends doesn't scroll like the others. We measure
 * each tab's settled position and compare.
 */

const TABS: Array<{ id: string; label: string }> = [
  { id: 'profile', label: 'Profile' },
  { id: 'journey', label: 'Journey' },
  { id: 'references', label: 'References' },
  { id: 'friends', label: 'Friends' },
  { id: 'comments', label: 'Comments' },
  { id: 'posts', label: 'Posts' },
]

const MOBILE_VIEWPORT = { width: 390, height: 844 } // iPhone 13/14

type TabMeasurement = {
  tabId: string
  url: string
  scrollY: number
  docHeight: number
  maxScrollY: number
  tabStripTop: number
  tabContentTop: number | null
  firstHeadingText: string | null
  firstHeadingTop: number | null
  withinTopThreshold: boolean
}

async function measureTab(page: Page, tabId: string): Promise<TabMeasurement> {
  return await page.evaluate((id) => {
    const stripContainer = document.querySelector('#profile-tab-content')
    const tabButton = document.querySelector<HTMLButtonElement>(`[data-tab-id="${id}"]`)
    const tabContentRect = stripContainer?.getBoundingClientRect() ?? null

    // Tab strip = the nav element inside profile-tab-content
    const navEl = stripContainer?.querySelector<HTMLElement>('nav[role="tablist"]') ?? null
    const stripRect = navEl?.getBoundingClientRect() ?? tabButton?.getBoundingClientRect() ?? null

    // Find the first heading within the tab content panel
    const contentPanel = stripContainer?.querySelector<HTMLElement>('.p-6, .md\\:p-8') ?? null
    const firstHeading =
      contentPanel?.querySelector<HTMLElement>('h1, h2, h3') ??
      stripContainer?.querySelector<HTMLElement>('h1, h2, h3') ??
      null
    const headingRect = firstHeading?.getBoundingClientRect() ?? null

    return {
      tabId: id,
      url: window.location.href,
      scrollY: window.scrollY,
      docHeight: Math.round(document.documentElement.scrollHeight),
      maxScrollY: Math.round(document.documentElement.scrollHeight - window.innerHeight),
      tabStripTop: stripRect ? Math.round(stripRect.top) : Number.NaN,
      tabContentTop: tabContentRect ? Math.round(tabContentRect.top) : null,
      firstHeadingText: firstHeading?.textContent?.trim().slice(0, 80) ?? null,
      firstHeadingTop: headingRect ? Math.round(headingRect.top) : null,
      withinTopThreshold:
        stripRect != null && Math.abs(stripRect.top) <= 50,
    }
  }, tabId)
}

test.describe('Profile tab strip scroll behavior (mobile)', () => {
  test.use({ viewport: MOBILE_VIEWPORT })

  test.beforeEach(async ({ page }) => {
    // Make sure each test starts fresh on the dashboard
    await page.goto('/dashboard/profile')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    // Ensure the tab strip is rendered
    await expect(page.locator('nav[role="tablist"]').first()).toBeVisible({ timeout: 10000 })
  })

  test('@smoke each tab click should bring the tab strip near the top of the viewport', async ({ page }) => {
    // Capture console errors during the run for the report
    const consoleErrors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text())
      }
    })
    page.on('pageerror', (err) => {
      consoleErrors.push(`pageerror: ${err.message}`)
    })

    const measurements: TabMeasurement[] = []

    for (const tab of TABS) {
      // Step 1: scroll page to its bottom so the tab strip is below
      // the upper viewport — this matches the user's reported context.
      await page.evaluate(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' as ScrollBehavior })
      })
      // Brief settle — give layout time to stabilize after the scroll-to-bottom
      await page.waitForTimeout(150)

      // Step 2: click the tab
      const button = page.locator(`[data-tab-id="${tab.id}"]`).first()
      await expect(button).toBeVisible()
      await button.click()

      // Step 3: wait for the URL to reflect the click and for any
      // smooth-scroll to fully settle.
      await page.waitForURL((url) => url.searchParams.get('tab') === tab.id, { timeout: 10000 }).catch(() => {})
      await page.waitForTimeout(800) // smooth scroll settle

      // Step 4: capture measurements
      const measurement = await measureTab(page, tab.id)
      measurements.push(measurement)

      // For Friends specifically, also grab a screenshot for visual evidence
      if (tab.id === 'friends') {
        await page.screenshot({
          path: `test-results/qa-tabs-scroll-friends-${Date.now()}.png`,
          fullPage: false,
        })
      }
    }

    // Print to test output for the report
    console.log('\n=== Tab Strip Scroll Measurements (mobile 390x844) ===')
    for (const m of measurements) {
      console.log(
        `tab=${m.tabId.padEnd(11)} stripTop=${String(m.tabStripTop).padStart(5)} ` +
          `scrollY=${String(m.scrollY).padStart(5)} ` +
          `maxScrollY=${String(m.maxScrollY).padStart(5)} ` +
          `docH=${String(m.docHeight).padStart(5)} ` +
          `firstHeadingTop=${String(m.firstHeadingTop ?? 'null').padStart(5)} ` +
          `nearTop=${m.withinTopThreshold ? 'YES' : 'NO '} ` +
          `heading="${m.firstHeadingText ?? ''}" url=${m.url.replace(/^.*?\/dashboard/, '/dashboard')}`,
      )
    }
    if (consoleErrors.length > 0) {
      console.log('\nConsole errors during run:')
      consoleErrors.forEach((e) => console.log('  ' + e))
    }

    // URL assertions — every tab click must end with ?tab=<id> and no
    // stale ?section= carrying over from a prior deep-link.
    for (const m of measurements) {
      const u = new URL(m.url)
      expect(u.searchParams.get('tab'), `tab param for ${m.tabId}`).toBe(m.tabId)
      expect(u.searchParams.get('section'), `section param for ${m.tabId}`).toBeNull()
    }

    // Behaviour comparison — find the worst tab by tab-strip Y, and the best.
    const sorted = [...measurements].sort((a, b) => a.tabStripTop - b.tabStripTop)
    const minTop = sorted[0].tabStripTop
    const maxTop = sorted[sorted.length - 1].tabStripTop
    const friends = measurements.find((m) => m.tabId === 'friends')!
    const references = measurements.find((m) => m.tabId === 'references')!
    console.log(`\nspread: minTop=${minTop} maxTop=${maxTop} delta=${maxTop - minTop}`)
    console.log(`friends.stripTop - references.stripTop = ${friends.tabStripTop - references.tabStripTop}`)

    // We don't fail the test on a delta — this is diagnostic. We DO fail if
    // *any* tab leaves the strip dramatically off-screen (>200px below the
    // top), because that would be an obvious regression.
    for (const m of measurements) {
      expect.soft(m.tabStripTop, `${m.tabId} tab strip should be near viewport top`).toBeLessThanOrEqual(200)
    }
  })

  test('?section=incoming deep-link scrolls Incoming Requests heading near top', async ({ page }) => {
    await page.goto('/dashboard/profile?tab=friends&section=incoming')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    // Wait for the friends tab content to render
    await expect(page.getByRole('heading', { level: 2, name: /^Friends$/i })).toBeVisible({ timeout: 15000 })
    // The deep-link scroll runs after fetchConnections settles. Give it a
    // generous beat — connections fetch + smooth scroll.
    await page.waitForTimeout(1500)

    const incomingTop = await page
      .locator('section[data-deeplink-section="incoming-requests"]')
      .evaluate((el) => Math.round(el.getBoundingClientRect().top))
      .catch(() => null)

    console.log(`incoming-requests section top after ?section=incoming: ${incomingTop}`)

    // Acceptable window: scroll-mt-[88px] gives 88px of headroom — anchor
    // top should be roughly between 0 and 120 px.
    expect(incomingTop, 'incoming-requests anchor must exist when ?section=incoming').not.toBeNull()
    expect(incomingTop!).toBeGreaterThanOrEqual(-10)
    expect(incomingTop!).toBeLessThanOrEqual(150)
  })

  test('?section=requests legacy is silently no-op for player (hideReferences=true)', async ({ page }) => {
    // A page error here would mean the FriendsTab handler tried to scroll a
    // null target. We listen for that and let the test fail loudly.
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/dashboard/profile?tab=friends&section=requests')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    await expect(page.getByRole('heading', { level: 2, name: /^Friends$/i })).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(800)

    // The TrustedReferences section should NOT exist (hideReferences=true)
    const trustedRefs = await page.locator('[data-deeplink-section="trusted-references"]').count()
    expect(trustedRefs, 'TrustedReferences should NOT render for player').toBe(0)
    expect(pageErrors).toEqual([])
  })

  test('Community: clicking "View Profile" on a coach member routes to /coaches/...', async ({ page }) => {
    await page.goto('/community')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1500) // let infinite-scroll first batch settle

    // Filter by Coaches role
    const coachChip = page.getByRole('button', { name: /^Coaches$/ }).first()
    if (await coachChip.isVisible({ timeout: 2000 }).catch(() => false)) {
      await coachChip.click()
      await page.waitForTimeout(800)
    }

    // Dismiss the cookie banner if it overlays the page (it covers tiles
    // at the bottom of the viewport on mobile).
    const cookieAccept = page.getByRole('button', { name: /^Accept$/ })
    if (await cookieAccept.isVisible({ timeout: 1500 }).catch(() => false)) {
      await cookieAccept.click().catch(() => {})
    }

    // Each tile is a <button aria-label="View [Name]'s profile"> containing
    // the role badge text "Coach". Filter to those tiles whose visible text
    // includes "Coach" (the role badge).
    const coachTile = page
      .locator('button[aria-label*="profile"]')
      .filter({ hasText: /Coach/ })
      .first()
    await expect(coachTile).toBeVisible({ timeout: 5000 })
    await coachTile.scrollIntoViewIfNeeded().catch(() => {})
    await coachTile.click()

    // Wait for the preview modal
    const modal = page.locator('[role="dialog"][aria-modal="true"]')
    await expect(modal).toBeVisible({ timeout: 5000 })
    const modalText = (await modal.textContent()) ?? ''
    console.log(`opened preview modal — first 100 chars: ${modalText.slice(0, 100)}`)

    // Click "View Profile" in the modal — it's a button, not a link, so we
    // observe URL change after click.
    const viewProfileBtn = modal.getByRole('button', { name: /view profile/i }).first()
    await expect(viewProfileBtn).toBeVisible({ timeout: 5000 })
    await Promise.all([
      page.waitForURL(/\/(coaches|players)\/id\//, { timeout: 5000 }),
      viewProfileBtn.click(),
    ])
    const finalUrl = page.url()
    console.log(`coach preview "View Profile" landed on: ${finalUrl}`)

    expect(finalUrl, 'Coach View Profile should route to /coaches/id/...').toMatch(/\/coaches\/id\//)
    expect(finalUrl, 'Coach View Profile must NOT route to /players/id/...').not.toMatch(/\/players\/id\//)
  })

  test('Discover: ?q= seed never flashes "Try asking" examples', async ({ page }) => {
    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${err.message}`))

    // Slow the nl-search edge fn so any seed-loading UI has time to render.
    await page.route('**/functions/v1/nl-search**', async (route) => {
      await new Promise((r) => setTimeout(r, 2500))
      await route.continue()
    })

    // Start navigation but observe DOM aggressively from the moment paint is
    // possible. We poll every 50ms for up to 6s, capturing any frame where
    // either "Try asking" or "Working on your question" is visible.
    let tryAskingSeen = false
    let workingSeen = false
    let seedConsumed = false

    const navP = page.goto('/discover?q=Find%20defenders')

    const start = Date.now()
    while (Date.now() - start < 6000) {
      try {
        const flags = await page.evaluate(() => {
          const text = document.body.innerText || ''
          return {
            hasTryAsking: /Try asking/i.test(text),
            hasWorking: /Working on your question/i.test(text),
            qStripped: !new URL(window.location.href).searchParams.has('q'),
          }
        })
        if (flags.hasTryAsking) tryAskingSeen = true
        if (flags.hasWorking) workingSeen = true
        if (flags.qStripped) seedConsumed = true
        if (seedConsumed && tryAskingSeen) break // got our evidence
        if (seedConsumed && workingSeen) break // also done
      } catch { /* page navigating — ignore */ }
      await page.waitForTimeout(50)
    }
    await navP.catch(() => {})

    // Also assert the page didn't auto-redirect to the canned-redirect target
    // (the seeded query "Find defenders" is a normal nl-search query, not canned).
    const finalUrl = page.url()
    const stillOnDiscover = /\/discover/.test(finalUrl)

    console.log(`discover seed: workingSeen=${workingSeen} tryAskingSeen=${tryAskingSeen} seedConsumed=${seedConsumed} finalUrl=${finalUrl}`)

    // The contract from the recent fix: "Try asking" examples must NEVER
    // be visible during a seeded query — otherwise the user might click
    // an example and kick off a parallel chat with the wrong query.
    expect(tryAskingSeen, '"Try asking" must NOT appear during seeded query').toBe(false)
    // The "Working on your question…" loading state is informational only —
    // sendMessage synchronously pushes the user-msg + placeholder, which
    // flips hasMessages=true within the same React commit, so the loading
    // branch (gated on !hasMessages) typically does not render. We log it
    // for visibility but don't fail the test on it.
    if (!workingSeen) {
      console.log('NOTE: "Working on your question…" did not appear — likely never visible because sendMessage commits user-msg synchronously.')
    }
    expect.soft(stillOnDiscover, 'page should remain on /discover after seeded query').toBe(true)
    expect(consoleErrors).toEqual([])
  })
})
