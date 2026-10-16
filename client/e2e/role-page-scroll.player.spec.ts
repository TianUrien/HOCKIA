import { test, expect } from '@playwright/test'

/**
 * Regression guard for the frozen role page (iPhone, 15 Oct 2026): the
 * desktop detail dialog was mounted under the phone layout and its body
 * scroll lock pinned the document. Meaningful under the phone-sized
 * projects (mobile-player, webkit-player); on desktop it checks the dialog
 * still owns its own scroll.
 */
test.describe('Role page scrolls', () => {
  test('the document (phone) or the dialog (desktop) can scroll', async ({ page }, testInfo) => {
    await page.goto('/opportunities')
    const first = page.locator('a[href*="/opportunities/"]').filter({ hasNot: page.locator('[href="/opportunities"]') }).first()
    await expect(first).toBeVisible({ timeout: 20_000 })
    await first.click()
    await expect(page).toHaveURL(/\/opportunities\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await page.waitForLoadState('networkidle')

    const phone = Boolean(testInfo.project.use.isMobile)
    if (phone) {
      // The phone layout scrolls the document: it must not be pinned.
      const state = await page.evaluate(() => ({
        locked: document.body.getAttribute('data-chat-scroll-lock'),
        position: getComputedStyle(document.body).position,
        overflow: getComputedStyle(document.documentElement).overflow,
        tall: (document.scrollingElement?.scrollHeight ?? 0) > (document.scrollingElement?.clientHeight ?? 0),
      }))
      expect(state.locked, 'body carries a scroll lock on the phone role page').toBeNull()
      expect(state.position).not.toBe('fixed')
      expect(state.overflow).not.toBe('hidden')
      if (state.tall) {
        await page.evaluate(() => window.scrollTo(0, 400))
        expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
      }
    } else {
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      expect(await dialog.evaluate((d) => d.scrollHeight >= d.clientHeight)).toBe(true)
    }
  })
})
