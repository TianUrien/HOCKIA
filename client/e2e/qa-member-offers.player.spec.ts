import { test, expect, type Page } from './fixtures'

/**
 * QA screenshots for brand offers Phase 2 (members see offers; Figma 08 ·
 * Brands P2). Not part of @smoke. Runs on staging as the E2E player and needs
 * a live sample offer for the player's country (created for the run, then
 * removed). Screenshots go to ../handoff-brand-offers-p2/built (outside
 * test-results, which Playwright wipes).
 */

const OUT = '../../handoff-brand-offers-p2/built'
const PHONE = { width: 393, height: 852 }

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

test.describe('member offers QA', () => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'writes to staging')

  test('phone: Home card, Not useful + Undo, offer detail', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/home')
    const card = page.getByTestId('member-offer-card').first()
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-H1-home-card.png` })

    await card.getByTestId('member-offer-not-useful').click()
    await expect(page.getByTestId('member-offer-dismissed')).toBeVisible()
    await page.getByTestId('member-offer-dismissed').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/phone-H2-not-useful.png` })
    await page.getByTestId('member-offer-undo').click()
    await expect(page.getByTestId('member-offer-card').first()).toBeVisible()

    await page.getByTestId('member-offer-card').first().getByTestId('member-offer-see').click()
    await expect(page).toHaveURL(/\/offers\/[0-9a-f-]+$/)
    await expect(page.getByTestId('offer-detail')).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-OD1-detail.png` })
    await page.screenshot({ path: `${OUT}/phone-OD1-detail-full.png`, fullPage: true })
  })

  test('phone: Community › Brands rail', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/community/brands')
    await expect(page.getByTestId('brand-offers-rail')).toBeVisible({ timeout: 30_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-BT1-brands.png` })
  })

  test('desktop: Home card and offer detail', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/home')
    const card = page.getByTestId('member-offer-card').first()
    await expect(card).toBeVisible({ timeout: 30_000 })
    await card.scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: `${OUT}/desktop-HD1-home.png` })
    await card.getByTestId('member-offer-see').click()
    await expect(page.getByTestId('offer-detail')).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/desktop-OD2-detail.png` })
  })
})
