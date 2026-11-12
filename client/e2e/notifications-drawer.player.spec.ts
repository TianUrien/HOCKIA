import { test, expect } from '@playwright/test'

/**
 * Notifications regression (QA-flagged area).
 *
 * Desktop: the drawer must never be open on a fresh /home load, must open from
 * the header bell and dismiss from Close, and the page must stay interactive
 * afterwards, all with REAL mouse clicks.
 *
 * Phone: there is no bell. Notifications are the Activity segment of the Inbox
 * (2026-10 inbox), reached from the bottom tab bar.
 */
test.describe('notifications drawer probe', () => {
  test('desktop: opens via bell, closes via Close, page stays interactive', async ({ page, isMobile }) => {
    test.skip(isMobile, 'phone has no bell: covered by the Activity test below')

    await page.goto('/home')
    await expect(page.getByTestId('home-new-post')).toBeVisible({ timeout: 20_000 })

    // Drawer must NOT be open on load.
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Open via the header bell (real click).
    await page.getByRole('button', { name: 'Notifications', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible()

    // Close via the drawer's close control (real click).
    await page.getByRole('button', { name: 'Close notifications' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // Page is still interactive: a top-bar destination responds to a real click.
    await page.getByRole('navigation').getByRole('button', { name: 'Community', exact: true }).click()
    await expect(page).toHaveURL(/\/community/)

    // Navigation is a PUSH (prod QA: replace:true ate the history entry and
    // Back skipped Home entirely). Back must restore Home, not leave the app.
    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('phone: notifications live in Inbox › Activity', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'desktop uses the bell drawer: covered above')

    await page.goto('/home')
    await expect(page.getByTestId('header-new-post')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toHaveCount(0)

    await page.getByRole('navigation').getByRole('button', { name: /^Inbox/ }).click()
    await expect(page).toHaveURL(/\/inbox$/)

    const activity = page.getByRole('tablist', { name: 'Inbox sections' }).getByRole('tab', { name: /^Activity/ })
    await activity.click()
    await expect(activity).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/\/inbox\/activity$/)

    // Segments are one screen (the switch replaces the history entry), so
    // Back leaves the Inbox for where the member came from.
    await page.goBack()
    await expect(page).toHaveURL(/\/home$/)
  })
})
