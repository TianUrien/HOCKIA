import { test, expect } from './fixtures'

// Brand dashboards gate their testid/H1 on a two-fetch chain (profile + brands row
// + useBrandAnalytics) against real staging in CI. 20s is too tight; 40s leaves
// headroom without masking real regressions (local still settles in < 3s).
const BRAND_DASH_TIMEOUT_MS = process.env.CI ? 40_000 : 20_000

async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
    // Don't fail the test if networkidle never settles; the toBeVisible assertion is the real signal.
  })
}

test.describe('@smoke brand', () => {
  test('brand dashboard loads for authenticated brand user', async ({ page }) => {
    // Brand users land at /dashboard/profile which renders BrandDashboard
    await page.goto('/dashboard/profile')
    // DashboardRouter does profile fetch → role routing; wait for routing to settle
    await page.waitForURL(url => !url.pathname.includes('/complete-profile'), { timeout: BRAND_DASH_TIMEOUT_MS })
    await waitForAppReady(page)

    // The brand dashboard shows the brand name as h1 and has brand-specific tabs
    // Wait for any dashboard content to appear (brand name heading or tab navigation)
    await expect(
      page.getByTestId('dashboard-brand')
    ).toBeVisible({ timeout: BRAND_DASH_TIMEOUT_MS })
  })

  test('brand edit page loads when brand exists', async ({ page }) => {
    await page.goto('/dashboard/brand')

    // /dashboard/brand was the legacy stripped-down edit page. As of the
    // 2026-05-01 cleanup, it redirects to /dashboard/profile (canonical
    // brand dashboard via DashboardRouter). For brands without a brand row
    // yet, the chain redirects further to /brands/onboarding.
    // Wait for the redirect itself: a fixed 3 s wait failed under a loaded
    // full-suite run (2026-10-22/23) while passing alone.
    await page.waitForURL(/\/dashboard\/profile|\/brands\/onboarding/, { timeout: 15_000 })
  })

  test('legacy /brands and /marketplace land on Community › Brands', async ({ page }) => {
    // Marketplace by need and place (founder 2026-10-25): the hub is Community › Brands.
    await page.goto('/brands')
    await page.waitForURL('**/community/brands', { timeout: BRAND_DASH_TIMEOUT_MS })
    await page.goto('/marketplace')
    await page.waitForURL('**/community/brands', { timeout: BRAND_DASH_TIMEOUT_MS })
  })

  test('brand cannot access player dashboard', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await page.waitForTimeout(2000)

    // Brand user should see brand dashboard, not player content
    const url = page.url()
    const isBrandRelated = url.includes('/dashboard/brand') || url.includes('/brands/') || url.includes('/dashboard/profile')
    expect(isBrandRelated).toBe(true)

    // Should NOT show player-specific elements
    await expect(page.getByText(/highlight video/i)).not.toBeVisible()
  })

  // The 10-category guard (202604210100_expand_brand_categories) moved to a
  // unit test (brandCategories.test.tsx): the Marketplace Directory tab it
  // used is gone (Marketplace by need and place, 2026-10-25).

  // Guard against the "stuck on onboarding" UX hazard: a brand user with an
  // existing brand who lands on /brands/onboarding must be redirected away,
  // never trapped on a form they can't submit (create_brand would reject
  // with "Brand already exists").
  test('brand user visiting /brands/onboarding is redirected to their brand page', async ({ page }) => {
    await page.goto('/brands/onboarding')
    await page.waitForURL(url => !url.pathname.endsWith('/brands/onboarding'), { timeout: BRAND_DASH_TIMEOUT_MS })

    const url = page.url()
    // Either /brands/{slug} (brand already exists) or /dashboard/profile
    // (fallback). Both are acceptable — the key invariant is "not stuck on
    // /brands/onboarding".
    expect(url).not.toContain('/brands/onboarding')
  })
})
