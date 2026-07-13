import { test, expect } from '@playwright/test'

/**
 * Notifications drawer regression (QA-flagged area): the drawer must never be
 * open on a fresh /home load, must open from the bell and dismiss from Close,
 * and the page must stay interactive after — all with REAL mouse clicks: open /home → bell → drawer
 * visible → Close → drawer dismissed → page interactive (tab switch works).
 */
test.describe('notifications drawer probe', () => {
  test('opens via bell, closes via Close, page stays interactive', async ({ page }) => {
    await page.goto('/home')
    await expect(page.getByRole('button', { name: 'pulse', exact: true })).toBeVisible({ timeout: 15_000 })

    // Drawer must NOT be open on load.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Open via the header bell (real click).
    await page.getByRole('button', { name: 'Notifications', exact: true }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // Close via the drawer's close control (real click).
    await page.getByRole('button', { name: 'Close notifications' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Page is still interactive: switch tabs with real clicks.
    await page.getByRole('button', { name: 'feed', exact: true }).click()
    await expect(page).toHaveURL(/tab=feed/)
    await page.getByRole('button', { name: 'pulse', exact: true }).click()
    await expect(page).not.toHaveURL(/tab=feed/)

    // Tab switches are PUSH navigations (prod QA: replace:true ate the
    // history entry — Back skipped Home entirely). Back must restore the
    // previous tab, not leave the page.
    await page.goBack()
    await expect(page).toHaveURL(/tab=feed/)
    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
  })
})
