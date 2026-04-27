/**
 * One-off QA probe for the marketplace + floating-AI navigation change.
 * Runs only when QA_PROBE=1 to keep the smoke suite fast.
 *
 * Verifies:
 *  - AI button is rendered, positioned above the Dashboard slot, and
 *    horizontally centred within tolerance.
 *  - AI button hides on /discover.
 *  - /marketplace renders with the new heading + tabs.
 *  - /community/brands → 301 redirect to /marketplace.
 *  - Mobile header swap: Sparkles gone, Store present.
 */
import { test, expect } from './fixtures'

test.describe('@qa marketplace + AI floating button', () => {
  test.skip(!process.env.QA_PROBE, 'set QA_PROBE=1 to run')

  test('AI button is centred above Dashboard slot on mobile home', async ({ page }) => {
    await page.goto('/home')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    // Dismiss cookie consent so the bottom region is visually unobstructed
    // for the screenshot (the consent banner is `pointer-events-none` so it
    // doesn't affect hit-testing, but it visually covers the AI button).
    await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 5_000 }).catch(() => {})

    const aiBtn = page.getByRole('button', { name: /open hockia ai/i })
    const dashBtn = page.getByRole('button', { name: /go to dashboard/i }).last()

    await expect(aiBtn).toBeVisible()
    await expect(dashBtn).toBeVisible()

    const aiBox = await aiBtn.boundingBox()
    const dashBox = await dashBtn.boundingBox()
    if (!aiBox || !dashBox) throw new Error('Could not measure boxes')

    const aiCenterX = aiBox.x + aiBox.width / 2
    const dashCenterX = dashBox.x + dashBox.width / 2

    // Horizontal centring: tolerate ±2px
    expect(Math.abs(aiCenterX - dashCenterX)).toBeLessThan(2)

    // AI button must sit ABOVE the dashboard button
    expect(aiBox.y + aiBox.height).toBeLessThanOrEqual(dashBox.y)

    // Spacing: ~16px breathing room (mb-4)
    const gap = dashBox.y - (aiBox.y + aiBox.height)
    expect(gap).toBeGreaterThanOrEqual(12)
    expect(gap).toBeLessThanOrEqual(24)

    // AI button is reasonably sized: ~48px
    expect(aiBox.width).toBeGreaterThanOrEqual(44)
    expect(aiBox.width).toBeLessThanOrEqual(52)

    // Verify routing — tap should land on /discover
    await aiBtn.click()
    await page.waitForURL('**/discover', { timeout: 10_000 })
    expect(page.url()).toMatch(/\/discover$/)
  })

  test('AI button visual snapshot on /home (clean state)', async ({ page }) => {
    await page.goto('/home')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await page.getByRole('button', { name: /^accept$/i }).click({ timeout: 5_000 }).catch(() => {})
    await expect(page.getByRole('button', { name: 'Open HOCKIA AI' })).toBeVisible()
    await page.screenshot({ path: 'test-results/qa-home-clean.png', fullPage: false })
  })

  test('AI button hides on /discover', async ({ page }) => {
    await page.goto('/discover')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    await expect(page.getByRole('button', { name: /open hockia ai/i })).toHaveCount(0)
  })

  test('Mobile header has Marketplace button, no Discover/Sparkles button', async ({ page }) => {
    await page.goto('/home')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    // Wait until the bottom nav (and so the header cluster) has rendered with
    // a logged-in profile — the AI floating button is a deterministic signal
    // for that since both the AI button and the header cluster gate on
    // `user && profile`.
    await expect(page.getByRole('button', { name: 'Open HOCKIA AI' })).toBeVisible({ timeout: 10_000 })

    // Marketplace button — exact aria-label match. Desktop has its own
    // Marketplace button at lg+, but at the mobile-player viewport the
    // desktop cluster is `hidden lg:flex` so only the mobile cluster
    // contributes a Marketplace button.
    await expect(page.getByRole('button', { name: 'Marketplace', exact: true })).toBeVisible()

    // Legacy header Discover (Sparkles) button is gone on mobile. Desktop
    // keeps it under aria-label="HOCKIA AI"; both names absent on mobile.
    await expect(page.getByRole('button', { name: 'Discover', exact: true })).toHaveCount(0)
    await expect(page.locator('header').getByRole('button', { name: 'HOCKIA AI', exact: true })).toHaveCount(0)
  })

  test('Marketplace renders correctly', async ({ page }) => {
    await page.goto('/marketplace')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    await expect(page.getByRole('heading', { level: 1, name: /^marketplace$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^feed$/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^directory$/i })).toBeVisible()

    await page.screenshot({ path: 'test-results/qa-marketplace-feed.png', fullPage: false })
  })

  test('/community/brands redirects to /marketplace', async ({ page }) => {
    await page.goto('/community/brands')
    await page.waitForURL('**/marketplace', { timeout: 15_000 })
    expect(page.url()).toMatch(/\/marketplace$/)
  })

  test('No bottom-nav slot is active on /marketplace', async ({ page }) => {
    await page.goto('/marketplace')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

    // Bottom nav buttons with aria-current="page" should be 0
    const activeNavSlots = page.locator('nav[class*="fixed bottom-0"] button[aria-current="page"]')
    await expect(activeNavSlots).toHaveCount(0)
  })
})
