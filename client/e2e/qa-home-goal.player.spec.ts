import { test, expect, type Page } from './fixtures'

/**
 * QA screenshots for "What's your goal?" and "Gear and deals near you" on Home
 * (Figma page 02, YG: G1–G3, HR1). Not part of @smoke. Runs on staging as the
 * E2E player; needs a live sample offer in the player's country (created for
 * the run, removed after, with the player's goal). Screenshots go to
 * ../handoff-home/built (outside test-results, which Playwright wipes).
 */

const OUT = '../../handoff-home/built'
const PHONE = { width: 393, height: 852 }

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

test.describe('home goal + gear rail QA', () => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'writes to staging')

  test('phone: ask, Other sheet, set card, gear rail', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/home')
    const ask = page.getByTestId('home-goal-ask')
    await expect(ask).toBeVisible({ timeout: 30_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-G1-ask.png` })

    await page.getByTestId('goal-option-play_abroad').click()
    await page.getByTestId('goal-option-club_near_me').click()
    await page.getByTestId('goal-option-other').click()
    await page.getByTestId('goal-other-text').fill('Play in Germany next season while I finish my degree')
    await page.screenshot({ path: `${OUT}/phone-G2-other.png` })
    await page.getByTestId('goal-other-add').click()
    await expect(page.getByTestId('goal-save')).toHaveText(/3 of 3/)
    await page.screenshot({ path: `${OUT}/phone-G1-three-picked.png` })
    await page.getByTestId('goal-save').click()

    const set = page.getByTestId('home-goal-set')
    await expect(set).toBeVisible()
    // Rows come from real data a moment after the goal is saved.
    await expect(page.getByTestId('home-goal-row-abroad')).toBeVisible({ timeout: 15_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-G3-set.png` })

    const rail = page.getByTestId('home-gear-rail')
    await expect(rail).toBeVisible({ timeout: 20_000 })
    await rail.scrollIntoViewIfNeeded()
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-HR1-rail.png` })
    await expect(page.getByTestId('member-offer-card')).toHaveCount(0) // the rail replaces the single card in the feed
  })
})
