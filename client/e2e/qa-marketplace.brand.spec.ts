import { test, expect } from './fixtures'

/**
 * The need picker in the brand's offer editor (Figma 08 · Brands P6). Not part
 * of @smoke. Nothing is saved. QA_PROBE=1 also writes the hand-off screenshot.
 */
const OUT = '../../handoff-marketplace/built'

test('brand: offer editor has the need picker', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 852 })
  await page.goto('/dashboard/offers/new')
  await expect(page.getByTestId('offer-editor')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('offer-need-moving_abroad').click()
  await expect(page.getByTestId('offer-need-moving_abroad')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('offer-need-picker').scrollIntoViewIfNeeded()
  if (process.env.QA_PROBE) await page.screenshot({ path: `${OUT}/phone-editor-need-picker.png` })
})
