import { test, expect, type Page } from './fixtures'

/**
 * Authenticated tests for the Inbox (Messages segment).
 *
 * These run with a pre-authenticated player session (auth.setup.ts).
 * Desktop renders the master-detail inbox at /messages; phone widths are
 * redirected to /inbox. Rows carry `conversation-item` on desktop and
 * `conversation-row` on the phone list.
 */

const conversationRows = (page: Page) =>
  page.getByTestId('conversation-item').or(page.getByTestId('conversation-row'))

/** The list has settled when it shows either a row or the empty state. */
async function expectListOrEmptyState(page: Page) {
  await expect(
    conversationRows(page).first().or(page.getByText('No messages yet', { exact: true }).first()),
  ).toBeVisible({ timeout: 20000 })
}

test.describe('Messages Page - Authenticated', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/messages')
  })

  test('displays the inbox with its three segments', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 })

    const segments = page.getByRole('tablist', { name: 'Inbox sections' })
    await expect(segments.getByRole('tab', { name: 'Messages' })).toHaveAttribute('aria-selected', 'true')
    await expect(segments.getByRole('tab', { name: 'Requests' })).toBeVisible()
    await expect(segments.getByRole('tab', { name: /^Activity/ })).toBeVisible()
  })

  test('shows empty state or conversation list', async ({ page }) => {
    await expectListOrEmptyState(page)
  })

  test('search narrows the conversation list', async ({ page }) => {
    await expectListOrEmptyState(page)
    const before = await conversationRows(page).count()
    test.skip(before === 0, 'the E2E player has no conversations yet')

    await page.getByRole('searchbox', { name: 'Search conversations' }).fill('zz-no-such-conversation-zz')
    await expect(conversationRows(page)).toHaveCount(0)
  })
})

test.describe('Messages Page - Mobile', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/messages')
  })

  test('phone widths land on /inbox', async ({ page }) => {
    await expect(page).toHaveURL(/\/inbox$/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 })
  })

  test('mobile view shows conversation list', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 })
    await expectListOrEmptyState(page)
  })
})

test.describe('Messages Navigation', () => {
  test('can navigate to the inbox from the app navigation', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await expect(page.getByTestId('profile-hero-name')).toBeVisible({ timeout: 20000 })

    // Desktop: "Inbox" in the top bar. Phone: "Inbox" in the bottom tab bar.
    // (It was a header button labelled "Messages" before the 2026-10 inbox.)
    await page.getByRole('navigation').getByRole('button', { name: /^Inbox/ }).first().click()

    await expect(page).toHaveURL(/\/(inbox|messages)$/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible({ timeout: 20000 })
  })
})
