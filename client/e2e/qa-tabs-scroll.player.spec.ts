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

  test('?section=incoming deep-link lands on Inbox › Requests (phone)', async ({ page }) => {
    // 2026-09 redesign: on phones friend requests live in Inbox › Requests;
    // the Friends leaf lists friends only. The friend_request_received
    // notification still emits /dashboard/profile/friends?section=incoming,
    // so PlayerDashboard redirects it.
    await page.goto('/dashboard/profile/friends?section=incoming')
    await page.waitForFunction(() => window.location.pathname === '/inbox/requests', { timeout: 15000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible({ timeout: 15000 })
  })

  test('?section=requests legacy is silently no-op for player (hideReferences=true)', async ({ page }) => {
    // A page error here would mean the FriendsTab handler tried to scroll a
    // null target. We listen for that and let the test fail loudly.
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto('/dashboard/profile/friends?section=requests')
    await page.waitForSelector('.animate-spin', { state: 'hidden', timeout: 30000 }).catch(() => {})
    // Phone: /friends is the Friends — own leaf screen (2026-09 redesign).
    await expect(page.getByTestId('friends-screen-own')).toBeVisible({ timeout: 15000 })
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
    // Phone: /friends is the Friends — own leaf screen (2026-09 redesign).
    await expect(page.getByTestId('friends-screen-own')).toBeVisible({ timeout: 15000 })

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

})
