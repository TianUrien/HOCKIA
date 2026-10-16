import { test, expect } from './fixtures'

const E2E_COACH_USERNAME = 'e2e-test-coach'

test.describe('@smoke coach', () => {
  test('coach dashboard loads for authenticated coach', async ({ page }) => {
    await page.goto('/dashboard/profile')

    // Coach name heading should render
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })

    // Profile v2 landing (coach mode of the person profile).
    await expect(page.getByTestId('profile-v2')).toBeVisible({ timeout: 10000 })
  })

  test('coach public profile is accessible', async ({ page }) => {
    await page.goto(`/members/${E2E_COACH_USERNAME}`)

    await expect(
      page.getByRole('heading', { level: 1, name: /e2e test coach/i })
    ).toBeVisible({ timeout: 20000 })
  })

  test('coach can view opportunities page', async ({ page }) => {
    await page.goto('/opportunities')

    await expect(
      page.getByRole('heading', { level: 1, name: 'Opportunities' })
    ).toBeVisible({ timeout: 20000 })
  })

  test('coach can access messages page', async ({ page }) => {
    await page.goto('/messages')

    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 20000 })
  })

  test('coach can view community page', async ({ page }) => {
    await page.goto('/community')

    // Community page intro removed 2026-05-29 — assert on the
    // segmented control tabs as the stable "page rendered" signal.
    // `exact: true` is required because the ContextSwitcher's "Clear
    // scope" button has aria-label "…show all members" which loose
    // /members/i matching also picks up — strict-mode violation
    // otherwise.
    // 2026-09 redesign: Community is members only — role chips (All · Players ·
    // Coaches · Clubs · Brands · Umpires) replaced the Members | Questions
    // switch; questions are a post kind inside Home.
    const chips = page.getByRole('tablist', { name: 'Member type' })
    await expect(chips.getByRole('tab', { name: 'All', exact: true })).toBeVisible({ timeout: 20000 })
    await expect(chips.getByRole('tab', { name: 'Players', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Questions', exact: true })).toHaveCount(0)
  })

  test('coach cannot access brand dashboard', async ({ page }) => {
    await page.goto('/dashboard/brand')
    await page.waitForTimeout(3000)

    const url = page.url()
    const isOnBrandDash = url.includes('/dashboard/brand')
    if (isOnBrandDash) {
      // Should not see brand-specific controls
      const hasBrandControls = await page.getByRole('button', { name: /add product/i }).isVisible().catch(() => false)
      expect(hasBrandControls).toBe(false)
    }
  })

  test('coach cannot access club applicants page', async ({ page }) => {
    await page.goto('/dashboard/opportunities/some-fake-id/applicants')

    await expect(async () => {
      const url = page.url()
      const isRedirected = !url.includes('/applicants')
      const showsError = await page.getByRole('heading', { name: /error/i }).isVisible().catch(() => false)
      // v1 page (candidate coach) or the desktop D4 page (coach who recruits): both refuse a role that isn't theirs.
      const showsFailure = await page.getByText(/failed to load applicants/i).isVisible().catch(() => false)
        || await page.getByTestId('applicants-error').isVisible().catch(() => false)
      expect(isRedirected || showsError || showsFailure).toBe(true)
    }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })
  })
})
