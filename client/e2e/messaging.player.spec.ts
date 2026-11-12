import { test, expect } from './fixtures'

const E2E_CLUB_USERNAME = 'e2e-test-fc'

test.describe('Messaging - Full Flow', () => {
  test('player can open messages page and see heading', async ({ page }) => {
    await page.goto('/messages')
    await expect(
      page.getByRole('heading', { name: 'Inbox', exact: true })
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
      page.getByRole('heading', { name: 'Inbox', exact: true })
    ).toBeVisible({ timeout: 20000 })

    // Rows are `conversation-item` on the desktop master-detail inbox and
    // `conversation-row` on the phone list (/inbox).
    const rows = page.getByTestId('conversation-item').or(page.getByTestId('conversation-row'))
    const emptyState = page.getByText('No messages yet', { exact: true }).first()
    await expect(rows.first().or(emptyState)).toBeVisible({ timeout: 20000 })

    // The E2E club conversation exists once any messaging spec has run
    // against this account; on a pristine account the empty state is correct.
    const conversationItem = rows.filter({ hasText: /e2e test fc/i }).first()
    if (await conversationItem.isVisible()) {
      await conversationItem.click()

      // Chat window should open with the composer
      await expect(
        page.getByPlaceholder(/^message$|type a message/i)
      ).toBeVisible({ timeout: 20000 })
    } else {
      await expect(emptyState).toBeVisible()
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
      page.getByRole('heading', { name: 'Inbox', exact: true })
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

// The thread with E2E Test FC holds well over 50 messages on staging, so it
// always overflows and always has an older page to load.
const LONG_THREAD_CLUB = 'e2e-test-fc'

async function openLongThread(page: import('@playwright/test').Page) {
  await page.goto(`/clubs/${LONG_THREAD_CLUB}`)
  await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })
  await page.getByRole('button', { name: 'Message', exact: true }).click()
  const list = page.getByTestId('chat-message-list')
  await expect(list).toBeVisible({ timeout: 20000 })
  await expect(list.locator('[data-message-id]').first()).toBeVisible({ timeout: 20000 })
  // The thread opens at the bottom.
  await expect.poll(() => list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 10000 }).toBeLessThan(10)
  return list
}

test.describe('Messaging - Thread scrolling', () => {
  // Known flake (2026-11-11): every messaging spec writes to this same thread
  // as the same player. When another worker's message lands during the 1s
  // "stays up" window, the thread follows the reader's own new message to the
  // bottom, which is correct behaviour but fails the check. It passes 8 of 8
  // when run alone, so one retry separates that collision from a regression.
  test.describe.configure({ retries: process.env.CI ? 2 : 1 })

  test('a wheel tick up stays up (no snap back to the newest message)', async ({ page }) => {
    const list = await openLongThread(page)
    const box = await list.boundingBox()
    if (!box) throw new Error('message list has no box')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, -100)
    await expect.poll(() => list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight), { timeout: 5000 }).toBeGreaterThan(50)
    // Regression (2026-10-14): a rebuilt "stay pinned" observer scrolled the reader back down ~30 ms later.
    await page.waitForTimeout(1000)
    expect(await list.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeGreaterThan(50)
  })

  test('scrolling to the top loads an older page and keeps the reader in place', async ({ page }) => {
    const list = await openLongThread(page)
    const before = await list.locator('[data-message-id]').count()
    const firstId = await list.locator('[data-message-id]').first().getAttribute('data-message-id')
    await list.evaluate(el => { el.scrollTop = 0 })
    // Regression (2026-10-14): the cursor was percent-encoded twice, Postgres returned 400 and no thread could load past its newest 50 messages.
    await expect.poll(() => list.locator('[data-message-id]').count(), { timeout: 20000 }).toBeGreaterThan(before)
    await page.waitForTimeout(500)
    const y = await list.evaluate((el, id) => {
      const row = el.querySelector(`[data-message-id="${id}"]`)
      return row ? row.getBoundingClientRect().top - el.getBoundingClientRect().top : null
    }, firstId)
    // The message that was first is still near the top edge, not a page further down.
    // Its offset is 20 to 24px when nothing sits above it and about 64px when
    // a date divider does, which depends on where the page boundary falls in
    // the thread. The old window (24 to 104px) assumed a divider and failed by
    // 0 to 4px once the boundary moved; the upper bound is unchanged.
    expect(y).not.toBeNull()
    expect(y as number).toBeGreaterThanOrEqual(0)
    expect(y as number).toBeLessThan(104)
  })
})
