import { test, expect, type Page } from './fixtures'

/**
 * Marketplace by need and place (Figma 08 · Brands P6: MK1, MK2, MK3). Not
 * part of @smoke. Runs on staging as the E2E player and reads only.
 *
 * Staging has no standing sample offers, so the hub shows the "little supply"
 * state and a need page may be empty: the tests accept rows or the empty
 * state, and assert the parts that do not depend on supply (redirect, need
 * page, country switch, Suggest a brand). The need chips on the hub (MK1) only
 * render when the country has supply and are not covered.
 *
 * QA_PROBE=1 also writes the hand-off screenshots to ../handoff-marketplace/built.
 */

const OUT = '../../handoff-marketplace/built'
const PHONE = { width: 393, height: 852 }
const QA_PROBE = Boolean(process.env.QA_PROBE)

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
  // Logos fade in over 150 ms once decoded; wait so shots show them at rest.
  await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 10_000 }).catch(() => undefined)
  await page.waitForTimeout(400)
}

/** Hand-off screenshots are only written on an explicit QA run. */
async function shot(page: Page, name: string, fullPage = false) {
  if (QA_PROBE) await page.screenshot({ path: `${OUT}/${name}`, fullPage })
}

test.describe('marketplace QA', () => {
  test('phone: /marketplace redirects to the hub; need page; country switch', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/marketplace')
    await expect(page).toHaveURL(/\/community\/brands$/)
    await expect(page.getByTestId('marketplace-hub')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('market-country-chip')).toBeVisible()
    await settle(page)
    await shot(page, 'phone-MK1-hub.png')
    await shot(page, 'phone-MK1-hub-full.png', true)

    await page.goto('/community/brands/need/moving_abroad')
    await expect(page.getByTestId('need-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Moving abroad' })).toBeVisible()
    const rowsOrEmpty = page.getByTestId('market-row').first().or(page.getByTestId('need-page-empty'))
    await expect(rowsOrEmpty).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await shot(page, 'phone-MK2-need-uk.png')

    await page.getByTestId('market-country-chip').click()
    await page.getByLabel('Search countries').fill('Germ')
    await page.getByRole('button', { name: 'Germany' }).first().click()
    await expect(page).toHaveURL(/near=\d+/)
    await expect(page.getByTestId('market-country-chip')).toHaveText(/Germany/)
    await expect(rowsOrEmpty).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await shot(page, 'phone-MK2-need-germany.png')
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
    await shot(page, 'phone-MK3-low-supply.png')
    await page.getByTestId('market-suggest-brand').click()
    await expect(page.getByTestId('suggest-brand-sheet')).toBeVisible()
    await shot(page, 'phone-MK3-suggest.png')
  })
})
