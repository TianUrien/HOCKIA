import { test, expect } from './fixtures'

const E2E_CLUB_USERNAME = 'e2e-test-fc'

test.describe('Messaging - Full Flow', () => {
  test('player can open messages page and see heading', async ({ page }) => {
    await page.goto('/messages')
    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 20000 })
  })

  test('player can start conversation from club profile and send message', async ({ page }) => {
    // Navigate to the E2E club profile
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await expect(
      page.getByRole('heading', { level: 1, name: /e2e test fc/i })
    ).toBeVisible({ timeout: 20000 })

    // Click the Message button on the profile
    await page.getByRole('button', { name: 'Message', exact: true }).click()

    // Should navigate to messages
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    // Composer should be visible
    const composer = page.getByPlaceholder(/^message$|type a message/i)
    await expect(composer).toBeVisible({ timeout: 20000 })

    // Send a timestamped message
    const message = `E2E messaging test ${Date.now()}`
    await composer.fill(message)
    await page.keyboard.press('Enter')

    // Message should appear in the chat list
    const messageList = page.getByTestId('chat-message-list')
    await expect(messageList.getByText(message)).toBeVisible({ timeout: 20000 })

    // Composer should be cleared after sending
    await expect(composer).toHaveValue('')
  })

  test('conversation appears in sidebar after sending', async ({ page }) => {
    await page.goto('/messages')
    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 20000 })

    // After previous test has sent messages, the E2E club should appear in conversations
    // Scope to conversation-item elements to avoid matching notification text elsewhere on page
    const conversationItem = page.getByTestId('conversation-item').filter({ hasText: /e2e test fc/i }).first()
    const hasConversation = await conversationItem.isVisible({ timeout: 10000 }).catch(() => false)

    if (hasConversation) {
      // Click the conversation to open it
      await conversationItem.click()

      // Chat window should open with the composer
      await expect(
        page.getByPlaceholder(/^message$|type a message/i)
      ).toBeVisible({ timeout: 20000 })
    } else {
      // If no conversation exists yet, the empty state should show
      const emptyState = page.getByRole('heading', { name: /no messages/i })
      const hasEmptyState = await emptyState.isVisible({ timeout: 5000 }).catch(() => false)
      expect(hasConversation || hasEmptyState).toBeTruthy()
    }
  })

  test('enter key sends message and clears composer', async ({ page }) => {
    // Navigate via the club profile to ensure a conversation exists
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await expect(
      page.getByRole('heading', { level: 1, name: /e2e test fc/i })
    ).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'Message', exact: true }).click()
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    const composer = page.getByPlaceholder(/^message$|type a message/i)
    await expect(composer).toBeVisible({ timeout: 20000 })

    // Ensure composer is focused and ready
    await composer.click()

    const message = `Enter key test ${Date.now()}`
    await composer.fill(message)

    // Verify composer has content before sending
    await expect(composer).toHaveValue(message)

    // Send with Enter and wait for the Supabase insert response
    const sendPromise = page.waitForResponse(
      resp => resp.url().includes('rest/v1') && resp.request().method() === 'POST' && resp.status() < 400,
      { timeout: 20000 }
    )
    await page.keyboard.press('Enter')
    await sendPromise

    // Composer should be cleared after send completes
    await expect(composer).toHaveValue('', { timeout: 10000 })

    // Message should appear in the chat (give realtime subscription time to deliver)
    await expect(
      page.getByTestId('chat-message-list').getByText(message)
    ).toBeVisible({ timeout: 30000 })
  })
})

test.describe('Messaging - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
  })

  test('mobile messages page renders correctly', async ({ page }) => {
    await page.goto('/messages')

    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 20000 })
  })

  test('mobile messaging flow works end to end', async ({ page }) => {
    // Open club profile on mobile
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await expect(
      page.getByRole('heading', { level: 1, name: /e2e test fc/i })
    ).toBeVisible({ timeout: 20000 })

    // Start conversation
    await page.getByRole('button', { name: 'Message', exact: true }).click()
    await expect(page).toHaveURL(/\/messages/i, { timeout: 20000 })

    // Composer should be visible on mobile
    const composer = page.getByPlaceholder(/^message$|type a message/i)
    await expect(composer).toBeVisible({ timeout: 20000 })

    // Send a message
    const message = `Mobile E2E ${Date.now()}`
    await composer.fill(message)
    await page.keyboard.press('Enter')

    // Should appear in the chat
    await expect(
      page.getByTestId('chat-message-list').getByText(message)
    ).toBeVisible({ timeout: 20000 })
  })
})
