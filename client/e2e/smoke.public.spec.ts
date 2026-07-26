import { test, expect } from './fixtures'

test.describe('@smoke public', () => {
  test('landing loads and shows both primary CTAs', async ({ page }) => {
    await page.goto('/')

    // 2026-07 landing redesign: the page leads with TWO actions — "Explore
    // HOCKIA" (browse the public product with no account) and "Create your
    // profile" (signup). The single "Get Started" CTA of the previous dark
    // carousel hero is gone. Same markup on mobile and desktop.
    // They are LINKS, not buttons — a conversion page's primary actions must
    // support cmd/middle-click "open in new tab" and be crawlable.
    await expect(page.getByRole('link', { name: /explore hockia/i }).first()).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('link', { name: /create your profile/i }).first()).toBeVisible({ timeout: 20000 })
  })

  test('signup page loads and shows role selection', async ({ page }) => {
    await page.goto('/signup')

    await expect(page.getByRole('button', { name: /join as player/i })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /join as coach/i })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /join as club/i })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /join as brand/i })).toBeVisible({ timeout: 20000 })
  })

  test('opportunities page loads (public/indexable)', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await expect(page.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeVisible({ timeout: 20000 })
  })

  test('marketplace loads (public)', async ({ page }) => {
    await page.goto('/brands')

    // Legacy /brands redirects to /marketplace — Marketplace heading is visible
    await expect(
      page.getByRole('heading', { level: 1, name: /marketplace/i })
    ).toBeVisible({ timeout: 20000 })
  })

  test('community page loads (public)', async ({ page }) => {
    await page.goto('/community')
    await page.waitForLoadState('networkidle')

    // Community page intro (h1 title + description) was removed
    // 2026-05-29 — the page now starts directly with the segmented
    // control. Assert on those tabs as the stable "page rendered"
    // signal. `exact: true` to disambiguate from the ContextSwitcher's
    // "…show all members" button (recruiter view only, but anon view
    // can flip into recruiter mode after auth, so be defensive).
    await expect(
      page.getByRole('button', { name: 'Members', exact: true }),
    ).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Questions', exact: true })).toBeVisible()
  })

  test('world directory loads (public)', async ({ page }) => {
    await page.goto('/world')

    // World page should show some country or region content
    await expect(
      page.getByRole('heading', { level: 1 })
    ).toBeVisible({ timeout: 20000 })
  })
})
