import { test, expect, type Page } from './fixtures'

/**
 * QA screenshots for the Marketplace by need and place (Figma 08 · Brands P6:
 * MK1, MK2, MK3). Not part of @smoke. Runs on staging as the E2E player
 * against labelled sample offers and products (created for the run, removed
 * after). Screenshots go to ../handoff-marketplace/built.
 */

const OUT = '../../handoff-marketplace/built'
const PHONE = { width: 393, height: 852 }

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  // Logos fade in over 150 ms once decoded; wait so shots show them at rest.
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(400)
}

test.describe('marketplace QA', () => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'needs staging samples')

  test('phone: /marketplace redirects to the hub; need page; country switch', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/marketplace')
    await expect(page).toHaveURL(/\/community\/brands$/)
    const hub = page.getByTestId('marketplace-hub')
    await expect(hub).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('market-rail-offers')).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-MK1-hub.png` })
    await page.screenshot({ path: `${OUT}/phone-MK1-hub-full.png`, fullPage: true })

    await page.getByTestId('market-need-chip-moving_abroad').click()
    await expect(page).toHaveURL(/\/community\/brands\/need\/moving_abroad/)
    await expect(page.getByTestId('need-page')).toBeVisible()
    await expect(page.getByTestId('market-row').first()).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-MK2-need-uk.png` })

    await page.getByTestId('market-country-chip').click()
    await page.getByLabel('Search countries').fill('Germ')
    await page.getByRole('button', { name: 'Germany' }).first().click()
    await expect(page).toHaveURL(/near=\d+/)
    await expect(page.getByTestId('market-row').first()).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-MK2-need-germany.png` })
    await expect(page.getByTestId('need-page-ask-ai')).toHaveText(/Germany/)
  })

  test('phone: little supply in another country (MK3) and Suggest a brand', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/community/brands')
    await expect(page.getByTestId('marketplace-hub')).toBeVisible({ timeout: 30_000 })
    await page.getByTestId('market-country-chip').click()
    await page.getByLabel('Search countries').fill('Germ')
    await page.getByRole('button', { name: 'Germany' }).first().click()
    await expect(page.getByTestId('market-low-supply')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-MK3-low-supply.png` })
    await page.getByTestId('market-suggest-brand').click()
    await expect(page.getByTestId('suggest-brand-sheet')).toBeVisible()
    await page.screenshot({ path: `${OUT}/phone-MK3-suggest.png` })
  })
})
