import { test, expect } from '@playwright/test'

/**
 * Mobile-viewport pass for the Home V2 Pulse tab (Tian's QA agent could not
 * hold a stable ~390px viewport — this covers the render half of that gap;
 * pull-to-refresh needs a real device). Runs meaningfully under the
 * mobile-player project (Pixel 5, 393×851, touch); on desktop projects it
 * still guards against horizontal overflow.
 */
test.describe('Pulse tab @ mobile viewport', () => {
  test('renders without horizontal overflow; tabs + modules mobile-clean', async ({ page }, testInfo) => {
    // Impression telemetry must actually land (prod QA caught every upsert
    // 403ing silently — the client swallows the error by design, so only a
    // network-level assertion can guard it).
    const failedImpressionWrites: number[] = []
    page.on('response', (res) => {
      if (res.url().includes('home_module_impressions') && res.status() >= 400) {
        failedImpressionWrites.push(res.status())
      }
    })

    await page.goto('/home')
    await expect(page.getByRole('button', { name: 'pulse', exact: true })).toBeVisible({ timeout: 15_000 })

    // Let the async modules land before measuring — the horizontal
    // opportunities rail is the most overflow-prone element on the page, so
    // asserting before it mounts would prove nothing. (Soft wait: modules
    // legitimately collapse when their data is empty.)
    await page
      .getByText(/Opportunities for you|Your applications/)
      .first()
      .waitFor({ timeout: 8_000 })
      .catch(() => {})

    // The page body must never scroll horizontally on a phone.
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    expect(overflow.scrollW, 'no horizontal overflow on Pulse').toBeLessThanOrEqual(overflow.clientW + 1)

    // Hero renders one of its two variants (never a blank tab).
    await expect(
      page.getByText(/Your week on HOCKIA/i).first(),
    ).toBeVisible()

    await page.screenshot({ path: testInfo.outputPath('pulse-mobile.png'), fullPage: true })

    // Feed tab also overflow-clean.
    await page.getByRole('button', { name: 'feed', exact: true }).click()
    await expect(page).toHaveURL(/tab=feed/)
    const feedOverflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    expect(feedOverflow.scrollW, 'no horizontal overflow on Feed').toBeLessThanOrEqual(feedOverflow.clientW + 1)

    expect(failedImpressionWrites, 'impression upserts must not 4xx (silent telemetry loss)').toEqual([])
  })
})
