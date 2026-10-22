import { test, expect } from './fixtures'

/**
 * Hockia AI is one sheet (founder ruling 2026-10-22,
 * docs/design-handoff/hockia-ai-one-sheet.md). /discover is no longer a
 * page: old links land on Home with the sheet open, and the header mascot
 * opens the same sheet. Uses the authenticated player session.
 *
 * Answers come from an AI backend and are non-deterministic, so these tests
 * cover the sheet's behaviour, not answer content.
 */

const sheet = (page: import('@playwright/test').Page) => page.getByTestId('hockia-ai-sheet')
const composer = (page: import('@playwright/test').Page) => sheet(page).locator('textarea')

test.describe('@discover Hockia AI sheet (player)', () => {
  test('/discover opens the sheet over Home', async ({ page }) => {
    await page.goto('/discover')
    await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 })
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 })
    await expect(composer(page)).toBeVisible()
  })

  test('/discover?q= puts the question in the composer without sending it', async ({ page }) => {
    await page.goto('/discover?q=Find%20defenders')
    await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 })
    await expect(composer(page)).toHaveValue('Find defenders', { timeout: 10_000 })
    await expect(page.getByTestId('ai-searching')).toHaveCount(0)
  })

  test('/discovery (old alias) opens the sheet too', async ({ page }) => {
    await page.goto('/discovery')
    await expect(page).toHaveURL(/\/home$/, { timeout: 10_000 })
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 })
  })

  test('the header mascot opens the sheet on the current screen', async ({ page }) => {
    // Home has the shared header on every width (phone Opportunities has its own).
    await page.goto('/home')
    await page.locator('header').getByTestId(/^header-hockia-ai/).filter({ visible: true }).first().click()
    await expect(sheet(page)).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/home$/)
  })

  test('Enter sends; Shift+Enter keeps a new line', async ({ page }) => {
    await page.goto('/discover')
    const box = composer(page)
    await expect(box).toBeVisible({ timeout: 10_000 })
    await box.fill('Line one')
    await box.press('Shift+Enter')
    await box.pressSequentially('Line two')
    await expect(box).toHaveValue(/Line one\nLine two/)
    await box.fill('Find goalkeepers')
    await box.press('Enter')
    await expect(
      page.getByTestId('ai-searching').first().or(sheet(page).getByText(/results|no profiles|found|couldn/i).first()),
    ).toBeVisible({ timeout: 30_000 })
  })

  test('a failed answer offers Try again', async ({ page }) => {
    await page.route('**/functions/v1/nl-search', (route) => route.fulfill({ status: 500, body: 'Internal Server Error' }))
    await page.goto('/discover')
    const box = composer(page)
    await expect(box).toBeVisible({ timeout: 10_000 })
    await box.fill('Test error handling')
    await box.press('Enter')
    await expect(sheet(page).getByRole('button', { name: /try again/i })).toBeVisible({ timeout: 15_000 })
  })
})
