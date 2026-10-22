import { test, expect } from './fixtures'

/**
 * Authenticated tests for the Opportunities page
 *
 * These tests run with a pre-authenticated player session.
 * The session is set up via auth.setup.ts and saved to storageState.
 */

// Helper: open filter panel on viewports where it's hidden (< lg / 1024px)
async function ensureFiltersVisible(page: import('@playwright/test').Page) {
  // Dismiss the notifications drawer if it's truly open (not just rendered off-screen)
  // When open, aria-modal="true" blocks all Playwright role queries outside the dialog
  const notifDialog = page.locator('[role="dialog"][aria-label="Notifications"]')
  if (await notifDialog.count() > 0 && await notifDialog.getAttribute('aria-modal') === 'true') {
    await page.getByRole('button', { name: 'Close notifications' }).click()
    await expect(notifDialog).not.toHaveAttribute('aria-modal', 'true', { timeout: 5000 })
  }

  const sidebar = page.getByRole('complementary')
  const isVisible = await sidebar.isVisible().catch(() => false)
  if (!isVisible) {
    const filtersToggle = page.getByRole('button', { name: /filters/i })
    if (await filtersToggle.isVisible().catch(() => false)) {
      await filtersToggle.click()
      await expect(sidebar).toBeVisible({ timeout: 5000 })
    }
  }
}

test.describe('Opportunities Page - Authenticated Player', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/opportunities')
    // Wait for page to load
    await page.waitForLoadState('networkidle')
  })

  test('displays opportunities page heading', async ({ page }) => {
    // Should see the Opportunities heading (not redirected to landing)
    await expect(page.getByRole('heading', { name: 'Opportunities', level: 1 })).toBeVisible({
      timeout: 10000,
    })
  })

  test('shows page description', async ({ page }) => {
    await expect(
      page.getByText(/discover field hockey opportunities/i)
    ).toBeVisible()
  })

  test('displays filters panel', async ({ page }) => {
    // On mobile/tablet (< lg), filters are hidden behind a toggle
    await ensureFiltersVisible(page)
    await expect(page.getByRole('heading', { name: 'Filters' })).toBeVisible()
  })

  test('shows position filters', async ({ page }) => {
    await ensureFiltersVisible(page)

    // Position filter section should be visible inside the filter sidebar
    const sidebar = page.getByRole('complementary')
    await expect(sidebar.getByText('Position', { exact: true })).toBeVisible()

    // Position checkbox options
    await expect(page.getByRole('checkbox', { name: /goalkeeper/i })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /defender/i })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /midfielder/i })).toBeVisible()
    await expect(page.getByRole('checkbox', { name: /forward/i })).toBeVisible()
  })

  test('shows gender filters', async ({ page }) => {
    await ensureFiltersVisible(page)
    await expect(page.getByText('Gender', { exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Men', exact: true })).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Women' })).toBeVisible()
  })

  test('shows location filter input', async ({ page }) => {
    await ensureFiltersVisible(page)
    const locationInput = page.getByPlaceholder(/city or country/i)
    await expect(locationInput).toBeVisible()

    // Can type in location filter
    await locationInput.fill('Spain')
    await expect(locationInput).toHaveValue('Spain')
  })

  test('shows vacancy count', async ({ page }) => {
    // Should show "Showing X opportunities"
    await expect(page.getByText(/showing \d+ opportunities/i)).toBeVisible()
  })

  test('can toggle view mode', async ({ page }) => {
    // View toggle buttons should be visible on desktop
    await page.setViewportSize({ width: 1280, height: 720 })

    const gridButton = page.getByTitle('Grid view')
    const listButton = page.getByTitle('List view')

    await expect(gridButton).toBeVisible()
    await expect(listButton).toBeVisible()

    // Click list view
    await listButton.click()

    // List view should now be active (has brand-purple active styling)
    await expect(listButton).toHaveClass(/bg-\[#8026FA\]/)
  })

  test('filters by position', async ({ page }) => {
    await ensureFiltersVisible(page)

    // Get initial count
    const countText = await page.getByText(/showing \d+ opportunities/i).textContent()
    const initialCount = parseInt(countText?.match(/\d+/)?.[0] || '0')

    // Apply goalkeeper filter using checkbox role
    const goalkeeperCheckbox = page.getByRole('checkbox', { name: /goalkeeper/i })
    await expect(goalkeeperCheckbox).toBeVisible({ timeout: 5000 })
    await goalkeeperCheckbox.click()

    // Wait for filter to apply by polling (replaces fragile waitForTimeout)
    await expect(async () => {
      const newCountText = await page.getByText(/showing \d+ opportunities/i).textContent()
      const newCount = parseInt(newCountText?.match(/\d+/)?.[0] || '0')
      expect(newCount).toBeLessThanOrEqual(initialCount)
    }).toPass({ timeout: 10000, intervals: [500, 1000, 2000] })
  })

  test('shows empty state when no vacancies match filter', async ({ page }) => {
    await ensureFiltersVisible(page)

    // Filter by a very specific location that won't match anything
    const locationInput = page.getByPlaceholder(/city or country/i)
    await locationInput.fill('zzz-nonexistent-location-12345')

    // Wait for filter to apply
    await page.waitForTimeout(500)

    // Should show "No opportunities found"
    await expect(page.getByText(/no opportunities found/i)).toBeVisible()
  })

  test('clear filters button works', async ({ page }) => {
    await ensureFiltersVisible(page)

    // Apply a filter first using checkbox role
    await page.getByRole('checkbox', { name: /goalkeeper/i }).click()
    await page.waitForTimeout(300)

    // Clear all button should appear
    const clearButton = page.getByRole('button', { name: /clear all/i })

    if (await clearButton.isVisible()) {
      await clearButton.click()
      await page.waitForTimeout(300)

      // Goalkeeper checkbox should be unchecked
      await expect(page.getByRole('checkbox', { name: /goalkeeper/i })).not.toBeChecked()
    }
  })
})

test.describe('Vacancy Details - Authenticated Player', () => {
  test('can view vacancy details by clicking a card', async ({ page }) => {
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')

    // Cards use the .group class; the Filters panel does not.
    // This avoids matching the "Filters" h2 that also sits inside a rounded-xl div.
    const cardTitles = page.locator('.group h2')

    if (await cardTitles.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click the card (parent .group container)
      const card = cardTitles.first().locator('xpath=ancestor::div[contains(@class,"group")]').first()
      await card.click()

      // Wait for the detail view overlay to open (use aria-label to avoid matching "Close" text button)
      await expect(
        page.getByLabel('Close', { exact: true })
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('shows action buttons on vacancy detail', async ({ page }) => {
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')

    // Click the first opportunity card to open detail view
    const cardTitles = page.locator('.group h2')

    if (await cardTitles.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const card = cardTitles.first().locator('xpath=ancestor::div[contains(@class,"group")]').first()
      await card.click()

      // Wait for detail view to open (use aria-label to avoid matching "Close" text button)
      await expect(
        page.getByLabel('Close', { exact: true })
      ).toBeVisible({ timeout: 10000 })

      // Detail view should always show action buttons in the footer
      await expect(page.getByRole('button', { name: /close|apply/i }).first()).toBeVisible()
      await expect(page.getByRole('button', { name: 'View profile', exact: true }).or(
        page.getByRole('link', { name: 'View profile', exact: true })
      ).or(
        page.getByRole('button', { name: 'View Club Profile', exact: true })
      )).toBeVisible({ timeout: 5000 })
    }
  })
})

test.describe('Responsive Opportunities - Authenticated', () => {
  test('mobile filter toggle works', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/opportunities')
    await page.waitForLoadState('networkidle')

    // On mobile, filters should be hidden by default
    const filtersButton = page.getByRole('button', { name: /filters/i })

    if (await filtersButton.isVisible()) {
      await filtersButton.click()

      // Filters panel should now be visible (scope to sidebar to avoid card matches)
      const sidebar = page.getByRole('complementary')
      await expect(sidebar.getByText('Position', { exact: true })).toBeVisible()
    }
  })
})
