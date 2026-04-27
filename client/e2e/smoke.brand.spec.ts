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

    // The edit page either shows "Edit Brand Profile" or redirects to onboarding
    // Wait for the page to settle
    await page.waitForTimeout(3000)

    const url = page.url()
    // Should be on edit page OR redirected to onboarding
    expect(
      url.includes('/dashboard/brand') || url.includes('/brands/onboarding')
    ).toBe(true)
  })

  test('brand can view public marketplace', async ({ page }) => {
    await page.goto('/brands')
    // Legacy /brands redirects client-side to /marketplace — wait for redirect to land
    await page.waitForURL('**/marketplace', { timeout: BRAND_DASH_TIMEOUT_MS })
    await waitForAppReady(page)

    // Marketplace heading visible on the canonical brand-discovery surface
    await expect(
      page.getByRole('heading', { level: 1, name: /marketplace/i })
    ).toBeVisible({ timeout: BRAND_DASH_TIMEOUT_MS })
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

  // Regression guard for the category taxonomy expansion
  // (202604210100_expand_brand_categories). If any of the 10 categories goes
  // missing from the filter, one of the label maps / enums is out of sync
  // with the DB constraint.
  //
  // After the marketplace redesign, brand discovery moved out of Community
  // into /marketplace (BrandsPage). The category filter is rendered by
  // <BrandCategoryFilter> inside the Directory tab — pill-row buttons rather
  // than a <select>. We assert each label appears as a button child of
  // the filter. Switching to the Directory tab is required because the
  // page defaults to the Feed tab.
  test('marketplace directory filter shows all 10 expanded categories', async ({ page }) => {
    await page.goto('/marketplace')
    await waitForAppReady(page)

    // BrandsPage defaults to the Feed tab; switch to the Directory tab so
    // the BrandCategoryFilter is rendered.
    await page.getByRole('button', { name: /directory/i }).click()

    const filter = page.getByTestId('brand-category-filter')
    await expect(filter).toBeVisible({ timeout: BRAND_DASH_TIMEOUT_MS })

    // The pill row uses "All" (not "All categories") for the null filter;
    // the remaining 10 labels come from BRAND_CATEGORIES.
    const expectedLabels = [
      'All',
      'Equipment',
      'Apparel',
      'Accessories',
      'Nutrition',
      'Technology',
      'Coaching & Training',
      'Recruiting',
      'Media',
      'Services',
      'Other',
    ]

    for (const label of expectedLabels) {
      await expect(
        filter.getByRole('button', { name: label, exact: true })
      ).toBeVisible()
    }
  })

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
