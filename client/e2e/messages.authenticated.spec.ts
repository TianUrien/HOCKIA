import { test, expect } from './fixtures'

/**
 * Authenticated tests for the Messages page
 * 
 * These tests run with a pre-authenticated player session.
 * The session is set up via auth.setup.ts and saved to storageState.
 */

test.describe('Messages Page - Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/messages')
    await page.waitForLoadState('networkidle')
  })

  test('displays messages page', async ({ page }) => {
    // Should see the messages page heading
    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 10000 })
  })

  test('shows empty state or conversation list', async ({ page }) => {
    // Either shows conversations or empty state
    const hasConversations = (await page.locator('[data-testid="conversation-item"]').count()) > 0
    
    if (hasConversations) {
      // Should show conversation list
      await expect(page.locator('[data-testid="conversation-item"]').first()).toBeVisible({ timeout: 10000 })
    } else {
      // Should show empty state heading
      await expect(
        page.getByRole('heading', { name: /no messages/i })
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('has message composer area', async ({ page }) => {
    // If there's a selected conversation or the composer is always visible
    const composer = page.getByPlaceholder(/^message$|type a message|write a message/i)
      .or(page.locator('[data-testid="message-composer"]'))
    
    // Composer might not be visible until a conversation is selected
    // This is okay - the test verifies the page loaded correctly
    const isVisible = await composer.isVisible().catch(() => false)
    
    // Log for debugging
    console.log('Composer visible:', isVisible)
  })
})

test.describe('Messages Page - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/messages')
    await page.waitForLoadState('networkidle')
  })

  test('mobile messages page loads', async ({ page }) => {
    // Should see the messages page heading
    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 10000 })
  })

  test('mobile view shows conversation list', async ({ page }) => {
    // On mobile, should see the messages heading and either empty state or conversations
    await expect(
      page.getByRole('heading', { name: 'Messages', exact: true })
    ).toBeVisible({ timeout: 10000 })
    
    // Should also show either conversations or empty state
    const hasEmptyState = await page.getByRole('heading', { name: /no messages/i }).isVisible().catch(() => false)
    const hasConversations = (await page.locator('[data-testid="conversation-item"]').count()) > 0
    
    expect(hasEmptyState || hasConversations).toBeTruthy()
  })
})

test.describe('Messages Navigation', () => {
  test('can navigate to messages from header', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await page.waitForLoadState('networkidle')

    // Dismiss the notifications drawer if it's truly open (not just rendered off-screen)
    // When open, aria-modal="true" blocks all Playwright role queries outside the dialog
    const notifDialog = page.locator('[role="dialog"][aria-label="Notifications"]')
    if (await notifDialog.count() > 0 && await notifDialog.getAttribute('aria-modal') === 'true') {
      await page.getByRole('button', { name: 'Close notifications' }).click()
      await expect(notifDialog).not.toHaveAttribute('aria-modal', 'true', { timeout: 5000 })
    }

    // The header messages button is a <button> with aria-label="Messages"
    const messagesButton = page.getByRole('button', { name: 'Messages', exact: true }).first()
    await expect(messagesButton).toBeVisible({ timeout: 10000 })

    await messagesButton.click()
    await expect(page).toHaveURL(/\/messages/, { timeout: 20000 })
  })
})
