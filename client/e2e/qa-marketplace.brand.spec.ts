import { test, expect } from './fixtures'

/** QA: the need picker in the brand's offer editor (Figma 08 · Brands P6). Not part of @smoke. */
const OUT = '../../handoff-marketplace/built'

test('brand: offer editor has the need picker', async ({ page }) => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'staging only')
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto('/dashboard/offers/new')
  await expect(page.getByTestId('offer-editor')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('offer-need-moving_abroad').click()
  await expect(page.getByTestId('offer-need-moving_abroad')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('offer-need-picker').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${OUT}/phone-editor-need-picker.png` })
})
