import { test, expect } from './fixtures'

test.describe('@smoke public', () => {
  test('landing loads and shows Join CTA', async ({ page }) => {
    await page.goto('/')

    // Landing CTA is implemented as a button (not a link) and varies by breakpoint.
    const joinCta = page
      .getByRole('button', { name: /join hockia/i })
      .or(page.getByRole('button', { name: /join now/i }))
      .first()
    await expect(joinCta).toBeVisible({ timeout: 20000 })
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

  test('brands directory loads (public)', async ({ page }) => {
    await page.goto('/brands')

    // /brands redirects to /community/brands — Members tab is active
    await expect(
      page.getByRole('button', { name: /members/i })
    ).toBeVisible({ timeout: 20000 })
  })

  test('community page loads (public)', async ({ page }) => {
    await page.goto('/community')
    await page.waitForLoadState('networkidle')

    // Community heading should be visible
    await expect(
      page.getByRole('heading', { name: /community/i })
    ).toBeVisible({ timeout: 20000 })

    // Tab switcher should show Members and Questions tabs
    await expect(page.getByRole('button', { name: /members/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /questions/i })).toBeVisible()
  })

  test('world directory loads (public)', async ({ page }) => {
    await page.goto('/world')

    // World page should show some country or region content
    await expect(
      page.getByRole('heading', { level: 1 })
    ).toBeVisible({ timeout: 20000 })
  })
})
