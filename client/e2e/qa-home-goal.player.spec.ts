import { test, expect } from './fixtures'

/**
 * "What's your goal?" on Home (Figma page 02, YG: G1–G3). Not part of the
 * smoke suite. Runs on staging as the E2E player and is repeatable: the goal
 * is only saved when the account has none yet (a pristine account, first run);
 * afterwards the saved goal is read back and Change is opened and cancelled,
 * which writes nothing.
 *
 * Not covered: the "Gear and deals near you" rail (HR1). It needs a live offer
 * in the player's country, and the E2E brand has none (see qa-brand-offers).
 */

const PHONE = { width: 393, height: 852 }

test.describe('home goal', () => {
  test('phone: the goal is asked once, shown as a card, and Change can be cancelled', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/home')

    const ask = page.getByTestId('home-goal-ask')
    const set = page.getByTestId('home-goal-set')
    await expect(ask.or(set)).toBeVisible({ timeout: 30_000 })

    if (await ask.isVisible()) {
      // Pristine account: answer the question (G1) with two goals.
      await page.getByTestId('goal-option-play_abroad').click()
      await page.getByTestId('goal-option-club_near_me').click()
      await expect(page.getByTestId('goal-save')).toHaveText(/2 of 3/)
      await page.getByTestId('goal-save').click()
    }

    // G3: the saved goal leads Home, with rows built from real data.
    await expect(set).toBeVisible()
    await expect(ask).toHaveCount(0)
    await expect(page.getByTestId('home-goal-row-abroad')).toBeVisible({ timeout: 15_000 })

    // Change reopens the question with the saved goals already picked.
    await page.getByTestId('home-goal-change').click()
    await expect(ask).toBeVisible()
    await expect(page.getByTestId('goal-option-play_abroad')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('goal-option-club_near_me')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('goal-save')).toHaveText(/\d of 3/)
    // "Later" belongs to the first ask only; a change offers Cancel.
    await expect(page.getByTestId('goal-later')).toHaveCount(0)

    // Unpicking a goal and cancelling must not change what is saved.
    await page.getByTestId('goal-option-play_abroad').click()
    await expect(page.getByTestId('goal-option-play_abroad')).toHaveAttribute('aria-pressed', 'false')
    await ask.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(set).toBeVisible()
    await expect(page.getByTestId('home-goal-row-abroad')).toBeVisible()
  })
})
