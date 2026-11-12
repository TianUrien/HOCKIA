import { test, expect } from '@playwright/test'

/**
 * Regression guard for the frozen role page (iPhone, 15 Oct 2026): the
 * desktop detail dialog was mounted under the phone layout and its body
 * scroll lock pinned the document. Most meaningful under the phone-sized
 * projects (mobile-player, webkit-player); the desktop project checks the
 * same thing for the desktop role page.
 */
test.describe('Role page scrolls', () => {
  test('the role page document can scroll', async ({ page }) => {
    await page.goto('/opportunities')
    // Opportunities v2 cards are buttons, not links (16 Oct 2026).
    const first = page.getByTestId('role-card').first().getByTestId('role-card-open')
    await expect(first).toBeVisible({ timeout: 20_000 })
    await first.click()
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle')

    // Phone and desktop both render the role as a page since Opportunities v2
    // (16 Oct 2026; desktop used to open a dialog): the document scrolls and
    // must not be pinned.
    await expect(page.getByTestId('role-detail').or(page.getByTestId('role-detail-desktop'))).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)

    const state = await page.evaluate(() => ({
      locked: document.body.getAttribute('data-chat-scroll-lock'),
      position: getComputedStyle(document.body).position,
      overflow: getComputedStyle(document.documentElement).overflow,
      tall: (document.scrollingElement?.scrollHeight ?? 0) > (document.scrollingElement?.clientHeight ?? 0),
    }))
    expect(state.locked, 'body carries a scroll lock on the role page').toBeNull()
    expect(state.position).not.toBe('fixed')
    expect(state.overflow).not.toBe('hidden')
    if (state.tall) {
      // The page scrolls smoothly, so the position is polled, not read once.
      await page.evaluate(() => window.scrollTo(0, 400))
      await expect.poll(() => page.evaluate(() => window.scrollY), { timeout: 5_000 }).toBeGreaterThan(0)
    }
  })
})
