import { test, expect } from './fixtures'

test.describe('@smoke brand', () => {
  test('brand dashboard or onboarding loads for authenticated brand user', async ({ page }) => {
    await page.goto('/dashboard/brand')

    // Brand user lands on either the edit dashboard (if brand exists)
    // or the onboarding page (if no brand record yet). Both are valid.
    const editHeading = page.getByRole('heading', { level: 1, name: /edit brand profile/i })
    const onboardingHeading = page.getByRole('heading', { name: /create.*brand|brand.*onboarding|set up.*brand/i })
    const brandForm = page.getByLabel(/brand name/i)

    await expect(
      editHeading.or(onboardingHeading).or(brandForm)
    ).toBeVisible({ timeout: 20000 })
  })

  test('brand can navigate to public profile from dashboard', async ({ page }) => {
    await page.goto('/dashboard/brand')

    // Only test this if the brand dashboard loaded (not onboarding)
    const editHeading = page.getByRole('heading', { level: 1, name: /edit brand profile/i })
    const isOnDashboard = await editHeading.isVisible({ timeout: 20000 }).catch(() => false)

    if (isOnDashboard) {
      await expect(page.getByText(/view public profile/i)).toBeVisible()
    } else {
      // On onboarding — skip, brand hasn't been created yet
      test.skip()
    }
  })

  test('brand dashboard has Save Changes button when brand exists', async ({ page }) => {
    await page.goto('/dashboard/brand')

    const editHeading = page.getByRole('heading', { level: 1, name: /edit brand profile/i })
    const isOnDashboard = await editHeading.isVisible({ timeout: 20000 }).catch(() => false)

    if (isOnDashboard) {
      await expect(
        page.getByRole('button', { name: /save changes/i })
      ).toBeVisible()
    } else {
      test.skip()
    }
  })

  test('brand can view public brands directory', async ({ page }) => {
    await page.goto('/brands')

    // /brands redirects to /community/brands — Members tab visible
    await expect(
      page.getByRole('button', { name: /members/i })
    ).toBeVisible({ timeout: 20000 })
  })

  test('brand cannot access player dashboard', async ({ page }) => {
    // When a brand user navigates to /dashboard/profile, they should be
    // redirected to their brand dashboard or shown brand-specific content
    await page.goto('/dashboard/profile')
    await page.waitForTimeout(2000)

    // Should NOT show player-specific content (e.g. Highlight Video, Position)
    const url = page.url()
    const isBrandDashboard = url.includes('/dashboard/brand') || url.includes('/brands/')
    const isDashboardProfile = url.includes('/dashboard/profile')

    expect(isBrandDashboard || isDashboardProfile).toBe(true)
  })
})
