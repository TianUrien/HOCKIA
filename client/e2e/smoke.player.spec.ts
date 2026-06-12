import { test, expect } from './fixtures'

const E2E_CLUB_USERNAME = 'e2e-test-fc'
const E2E_VACANCY_TITLE = 'E2E Vacancy - Automated Test'

async function getE2EVacancyCard(page: import('@playwright/test').Page) {
  const titleHeading = page.getByRole('heading', { level: 2, name: E2E_VACANCY_TITLE })
  return titleHeading.locator('xpath=ancestor::div[contains(@class,"rounded-2xl")]').first()
}

test.describe('@smoke player', () => {
  test('dashboard loads for authenticated player', async ({ page }) => {
    await page.goto('/dashboard/profile')

    // Profile name heading should render
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })

    // The Bento Grid is the landing view (no tab strip). Verify the
    // owner variant renders + at least one of its cards.
    await expect(page.getByTestId('player-bento-grid-owner')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('journey-card')).toBeVisible({ timeout: 10000 })

    // PR2 — section pages are now their own routes; legacy ?tab=X URLs
    // redirect on mount. Both should land on the journey section page.
    await page.goto('/dashboard/profile?tab=journey')
    await page.waitForFunction(
      () => window.location.pathname === '/dashboard/profile/journey',
      { timeout: 10000 },
    )
    await expect(page.getByRole('button', { name: /back to dashboard/i })).toBeVisible({ timeout: 10000 })
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

  test('player can edit and delete their own message', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'Message', exact: true }).click()
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    // Send a fresh message we own (and will clean up by deleting it).
    const original = `E2E edit/delete ${Date.now()}`
    await page.getByPlaceholder(/type a message/i).fill(original)
    await page.keyboard.press('Enter')

    const messageList = page.getByTestId('chat-message-list')
    await expect(messageList.getByText(original)).toBeVisible({ timeout: 20000 })

    // Scope every action to THIS message's row (unique text), so accumulated
    // test messages in the shared conversation never make `.last()` ambiguous.
    const rowFor = (text: string) => messageList.locator('.chat-message-wrapper', { hasText: text })
    const edited = `${original} UPDATED`

    // EDIT
    await rowFor(original).getByTestId('message-options-trigger').click()
    await page.getByTestId('message-edit-action').click()
    await page.getByTestId('message-edit-editor').getByLabel('Edit message').fill(edited)
    await page.getByTestId('message-edit-save').click()

    // Editor closes and the bubble shows the edited text + the "edited" label
    // (exact match — the message text itself must not collide with the label).
    await expect(page.getByTestId('message-edit-editor')).toHaveCount(0)
    await expect(rowFor(edited).getByText('edited', { exact: true })).toBeVisible({ timeout: 20000 })

    // DELETE — confirm, then assert the tombstone (also cleans up the row).
    await rowFor(edited).getByTestId('message-options-trigger').click()
    await page.getByTestId('message-delete-action').click()
    const confirm = page.getByTestId('message-delete-confirm')
    await expect(confirm).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()

    await expect(rowFor(edited)).toHaveCount(0)
    await expect(messageList.getByTestId('message-deleted').last()).toBeVisible({ timeout: 20000 })
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
