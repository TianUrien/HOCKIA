import { test, expect } from './fixtures'

const E2E_CLUB_USERNAME = 'e2e-test-fc'
const E2E_VACANCY_TITLE = 'E2E Vacancy - Automated Test'

async function getE2EVacancyCard(page: import('@playwright/test').Page) {
  const titleHeading = page.getByRole('heading', { level: 2, name: E2E_VACANCY_TITLE })
  return titleHeading.locator('xpath=ancestor::div[contains(@class,"rounded-xl")]').first()
}

test.describe('@smoke player', () => {
  test('dashboard loads for authenticated player', async ({ page }) => {
    await page.goto('/dashboard/profile')

    // Profile name heading should render
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })

    // Should show player-specific nav items
    await expect(page.getByRole('button', { name: /overview/i })
      .or(page.getByText(/profile strength/i))
    ).toBeVisible({ timeout: 10000 })
  })

  test('player can open seeded vacancy details', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await opportunitiesPage.waitForLoadingToComplete()

    await expect(page.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeVisible({ timeout: 20000 })

    const card = await getE2EVacancyCard(page)
    await expect(card).toBeVisible({ timeout: 20000 })

    // Cards are now fully clickable — click the card to open detail view
    await card.click()

    await expect(page.getByRole('heading', { level: 1, name: E2E_VACANCY_TITLE })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: 'Close', exact: true })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: E2E_VACANCY_TITLE })).not.toBeVisible({ timeout: 20000 })
  })

  test('player can start a message from a club profile', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)

    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })

    // Avoid strict-mode ambiguity with the "Messages" nav button.
    await page.getByRole('button', { name: 'Message', exact: true }).click()

    // Messaging page should load
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible({ timeout: 20000 })
  })

  test('player can send a message and see it in the thread', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })

    // Avoid strict-mode ambiguity with the "Messages" nav button.
    await page.getByRole('button', { name: 'Message', exact: true }).click()
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    const message = `E2E smoke message ${Date.now()}`
    const textarea = page.getByPlaceholder(/type a message/i)
    await textarea.fill(message)
    await page.keyboard.press('Enter')

    const messageList = page.getByTestId('chat-message-list')
    await expect(messageList.getByText(message)).toBeVisible({ timeout: 20000 })
  })

  test('player can message a brand from its profile', async ({ page }) => {
    await page.goto('/brands/e2e-test-brand')

    await expect(
      page.getByRole('heading', { name: /e2e test brand/i })
    ).toBeVisible({ timeout: 20000 })

    // "Send Message" button should be visible (brand messaging is now enabled)
    const messageLink = page.getByRole('link', { name: /send message/i })
    await expect(messageLink).toBeVisible({ timeout: 10000 })

    await messageLink.click()

    // Should navigate to messages with the brand's profile_id
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })
    await expect(page.getByPlaceholder(/type a message/i)).toBeVisible({ timeout: 20000 })
  })

  test('player can send a message to a brand', async ({ page }) => {
    await page.goto('/brands/e2e-test-brand')
    await expect(
      page.getByRole('heading', { name: /e2e test brand/i })
    ).toBeVisible({ timeout: 20000 })

    await page.getByRole('link', { name: /send message/i }).click()
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    const composer = page.getByPlaceholder(/type a message/i)
    await expect(composer).toBeVisible({ timeout: 20000 })

    const message = `E2E brand message ${Date.now()}`
    await composer.fill(message)
    await page.keyboard.press('Enter')

    const messageList = page.getByTestId('chat-message-list')
    await expect(messageList.getByText(message)).toBeVisible({ timeout: 20000 })
  })

  test('player cannot access club dashboard applicants', async ({ page }) => {
    await page.goto('/dashboard/opportunities/some-fake-id/applicants')

    // Player should NOT see applicants management UI — wait for redirect or error
    // Use Playwright's toPass polling to avoid hardcoded timeouts
    await expect(async () => {
      const url = page.url()
      const isRedirected = !url.includes('/applicants')
      const showsError = await page.getByRole('heading', { name: /error/i }).isVisible().catch(() => false)
      const showsFailure = await page.getByText(/failed to load applicants/i).isVisible().catch(() => false)
      expect(isRedirected || showsError || showsFailure).toBe(true)
    }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })
  })
})
