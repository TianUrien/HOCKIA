import { test, expect } from './fixtures'

/**
 * @smoke
 *
 * Diagnostic specs that originally tracked the player tab-strip scroll
 * behaviour. PR2 promoted the tab `?tab=X` URLs to dedicated section
 * routes (`/dashboard/profile/:section`) and DELETED the tab strip
 * entirely. The "each tab click should bring the strip near the top"
 * test is gone with the strip; the remaining specs verify the
 * still-relevant deep-link scroll behaviour and adjacent flows.
 *
 * Kept here (rather than split into separate files) to preserve git
 * history. Filename stays for the same reason; the contents now span
 * section deep-links, Community routing, and Discover seed UX.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 } // iPhone 13/14

test.describe('Profile section deep-links + adjacent flows (mobile)', () => {
  test.use({ viewport: MOBILE_VIEWPORT })

  test('?section=incoming deep-link scrolls Requests heading near top', async ({ page }) => {
    // PR2 route shape: /dashboard/profile/friends?section=incoming. The
    // legacy `/dashboard/profile?tab=friends&section=incoming` URL still
    // works via the redirect in PlayerDashboard.tsx but we test the
    // canonical shape directly here.
    await page.goto('/dashboard/profile/friends?section=incoming')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    // Wait for the friends section content to render
    await expect(page.getByRole('heading', { level: 2, name: /^Connections$/i })).toBeVisible({ timeout: 15000 })
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

    await page.goto('/dashboard/profile/friends?section=requests')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    await expect(page.getByRole('heading', { level: 2, name: /^Connections$/i })).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(800)

    // The TrustedReferences section should NOT exist (hideReferences=true)
    const trustedRefs = await page.locator('[data-deeplink-section="trusted-references"]').count()
    expect(trustedRefs, 'TrustedReferences should NOT render for player').toBe(0)
    expect(pageErrors).toEqual([])
  })

  test('@smoke legacy /dashboard/profile?tab=X redirects to /dashboard/profile/:section', async ({ page }) => {
    // Notifications/config.ts still emits the old URL shape. The
    // PlayerDashboard mount effect migrates them so the rendered
    // experience is identical. URL settles on the new route.
    await page.goto('/dashboard/profile?tab=friends')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    await expect(page.getByRole('heading', { level: 2, name: /^Connections$/i })).toBeVisible({ timeout: 15000 })

    await page.waitForFunction(
      () => window.location.pathname === '/dashboard/profile/friends',
      { timeout: 5000 },
    )

    const finalUrl = new URL(page.url())
    expect(finalUrl.pathname).toBe('/dashboard/profile/friends')
    expect(finalUrl.searchParams.get('tab')).toBeNull()
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
