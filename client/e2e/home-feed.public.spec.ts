import { test, expect } from './fixtures'

test.describe('@smoke home feed public', () => {
  test('home feed loads and shows feed content', async ({ page }) => {
    await page.goto('/home')

    // Unauthenticated users may see the feed or be redirected to landing.
    // The landing headline changed in the 2026-07 redesign ("Built for Field
    // Hockey" → "See what HOCKIA can do before you join"), so match the CTA
    // instead — it's stable regardless of headline copy.
    await expect(
      page.getByText(/no activity yet/i)
        .or(page.getByRole('link', { name: /explore hockia/i }).first())
        .or(page.locator('[data-testid="feed-container"]').first())
    ).toBeVisible({ timeout: 20000 })
  })

  test('post composer is NOT shown when logged out', async ({ page }) => {
    await page.goto('/home')
    await page.waitForLoadState('networkidle')

    // The "Start a post..." trigger should not appear for unauthenticated users
    await expect(page.getByText('Start a post...')).not.toBeVisible({ timeout: 5000 })
  })

  test('system feed cards render correctly', async ({ page }) => {
    await page.goto('/home')
    await page.waitForLoadState('networkidle')

    // Wait for feed to load (either items or empty state)
    await expect(
      page.getByText(/no activity yet/i)
        .or(page.locator('[class*="shadow-sm"]').first())
    ).toBeVisible({ timeout: 20000 })

    // If there are feed items, verify they have basic card structure
    const feedCards = page.locator('div[class*="rounded-xl"][class*="border"]')
    const count = await feedCards.count()

    if (count > 0) {
      // First card should be visible and have content
      await expect(feedCards.first()).toBeVisible()
    }
  })
})
