import { test, expect } from '@playwright/test'

/**
 * Phone-width pass for Home and the activity screen. Home no longer has
 * pulse/feed tabs: the Pulse card moved to /pulse ("Your activity") and the
 * old /home?tab=pulse deep link redirects there. Runs meaningfully under the
 * mobile-player project (Pixel 5, 393×851, touch); on desktop projects it
 * still guards against horizontal overflow.
 */
async function overflow(page: import('@playwright/test').Page) {
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }))
}

test.describe('Home + activity @ mobile viewport', () => {
  test('legacy pulse link lands on /pulse; both screens render without horizontal overflow', async ({ page }, testInfo) => {
    // Impression telemetry must actually land (prod QA caught every upsert
    // 403ing silently: the client swallows the error by design, so only a
    // network-level assertion can guard it).
    const failedImpressionWrites: number[] = []
    page.on('response', (res) => {
      if (res.url().includes('home_module_impressions') && res.status() >= 400) {
        failedImpressionWrites.push(res.status())
      }
    })

    await page.goto('/home?tab=pulse')
    await expect(page).toHaveURL(/\/pulse$/, { timeout: 20_000 })
    await expect(page.getByTestId('activity-screen')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Your activity' })).toBeVisible()
    await page.waitForLoadState('networkidle').catch(() => {})

    const activity = await overflow(page)
    expect(activity.scrollW, 'no horizontal overflow on Your activity').toBeLessThanOrEqual(activity.clientW + 1)
    await page.screenshot({ path: testInfo.outputPath('activity-mobile.png'), fullPage: true })

    // Home: wait for the feed so the horizontal rails (the most
    // overflow-prone elements) are mounted before measuring.
    await page.goto('/home')
    await expect(page.getByTestId('home-next-step')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('user-post-card').first()).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})

    const home = await overflow(page)
    expect(home.scrollW, 'no horizontal overflow on Home').toBeLessThanOrEqual(home.clientW + 1)

    expect(failedImpressionWrites, 'impression upserts must not 4xx (silent telemetry loss)').toEqual([])
  })
})
