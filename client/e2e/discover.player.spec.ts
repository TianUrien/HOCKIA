import { test, expect } from './fixtures'

/**
 * Discovery (AI-Powered Search) E2E Tests
 *
 * Tests the natural-language search feature that queries player/coach/club
 * profiles via an edge function. Uses the authenticated player session.
 *
 * Test account: E2E Player (playrplayer93@gmail.com)
 *
 * NOTE: Discovery calls an AI-powered backend, so results are non-deterministic.
 * Tests focus on UI behavior (loading, results rendering, error handling)
 * rather than asserting specific result content.
 */

test.describe('@discover player flows', () => {
  test.describe('Page Load & Empty State', () => {
    test('discover page loads with header and search input', async ({ page }) => {
      await page.goto('/discover')

      // Header should show Discover title
      await expect(page.getByText('Discover')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('AI-powered search')).toBeVisible()

      // Search textarea should be visible
      await expect(page.locator('textarea')).toBeVisible()
    })

    test('empty state shows example query buttons', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.getByText('Discover')).toBeVisible({ timeout: 10000 })

      // Should show clickable example queries
      const exampleButtons = page.locator('button').filter({ hasText: /find|show/i })
      await expect(exampleButtons.first()).toBeVisible({ timeout: 10000 })
    })

    test('example query button populates search and triggers query', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.getByText('Discover')).toBeVisible({ timeout: 10000 })

      // Click the first example query button
      const exampleButtons = page.locator('button').filter({ hasText: /find|show/i })
      await expect(exampleButtons.first()).toBeVisible({ timeout: 10000 })
      await exampleButtons.first().click()

      // Should show a user message bubble (the query was submitted)
      // Wait for the typing indicator (3 dots) or a response
      await expect(
        page.locator('.animate-bounce').first()
          .or(page.getByText(/results|no profiles|found/i).first())
      ).toBeVisible({ timeout: 30000 })
    })
  })

  test.describe('Search Flow', () => {
    test('can type and submit a search query via Enter key', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 })

      // Type a search query
      const textarea = page.locator('textarea')
      await textarea.fill('Find goalkeepers')
      await textarea.press('Enter')

      // Should show loading indicator or results
      await expect(
        page.locator('.animate-bounce').first()
          .or(page.getByText(/results|no profiles|found/i).first())
      ).toBeVisible({ timeout: 30000 })
    })

    test('can submit a search query via send button', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 })

      // Type a query
      await page.locator('textarea').fill('Show defenders')

      // Click the send button (circular button with Send icon)
      const sendButton = page.locator('button').filter({ has: page.locator('svg') }).last()
      await sendButton.click()

      // Should show loading or results
      await expect(
        page.locator('.animate-bounce').first()
          .or(page.getByText(/results|no profiles|found/i).first())
      ).toBeVisible({ timeout: 30000 })
    })

    test('shows results after a successful search', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 })

      // Use a broad query likely to return results
      const textarea = page.locator('textarea')
      await textarea.fill('Show all players')
      await textarea.press('Enter')

      // Wait for typing indicator to appear then disappear (response received)
      await expect(async () => {
        // Either we see result cards or a text response from the assistant
        const resultCards = page.locator('a[href*="/players/"], a[href*="/clubs/"]')
        const textResponse = page.locator('div').filter({ hasText: /found|result|profile|player/i })
        const cardCount = await resultCards.count()
        const hasText = await textResponse.count()
        expect(cardCount + hasText).toBeGreaterThan(0)
      }).toPass({ timeout: 30000 })
    })

    test('result cards show player info and are clickable', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 })

      const textarea = page.locator('textarea')
      await textarea.fill('Find players')
      await textarea.press('Enter')

      // Wait for result cards to appear
      const resultCards = page.locator('a[href*="/players/"], a[href*="/clubs/"]')
      await expect(async () => {
        const count = await resultCards.count()
        expect(count).toBeGreaterThan(0)
      }).toPass({ timeout: 30000 })

      // First result card should show name and role badge
      const firstCard = resultCards.first()
      await expect(firstCard).toBeVisible()

      // Card should have a name (non-empty text content)
      const cardText = await firstCard.textContent()
      expect(cardText!.length).toBeGreaterThan(0)
    })
  })

  test.describe('Chat Interaction', () => {
    test('New button clears chat history', async ({ page }) => {
      await page.goto('/discover')
      await expect(page.locator('textarea')).toBeVisible({ timeout: 10000 })

      // Submit a query first
      const textarea = page.locator('textarea')
      await textarea.fill('Find goalkeepers')
      await textarea.press('Enter')

      // Wait for response
      await expect(async () => {
        const messages = page.locator('div').filter({ hasText: 'Find goalkeepers' })
        expect(await messages.count()).toBeGreaterThan(0)
      }).toPass({ timeout: 30000 })

      // Click New button to clear chat
      const newButton = page.getByRole('button', { name: /new/i })
      await expect(newButton).toBeVisible()
      await newButton.click()

      // Chat should be cleared — example query buttons should reappear
      await expect(
        page.locator('button').filter({ hasText: /find|show/i }).first()
      ).toBeVisible({ timeout: 10000 })
    })

    test('textarea is disabled during pending request', async ({ page }) => {
      await page.goto('/discover')
      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 10000 })

      await textarea.fill('Find midfielders')
      await textarea.press('Enter')

      // Textarea should be disabled while request is pending
      await expect(textarea).toBeDisabled({ timeout: 5000 })
    })

    test('Shift+Enter does not submit (allows multiline)', async ({ page }) => {
      await page.goto('/discover')
      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 10000 })

      await textarea.fill('Line one')
      await textarea.press('Shift+Enter')
      await textarea.type('Line two')

      // Should still be in the textarea, not submitted
      const value = await textarea.inputValue()
      expect(value).toContain('Line one')
      expect(value).toContain('Line two')
    })
  })

  test.describe('Error Handling', () => {
    test('shows error state with retry button on failure', async ({ page }) => {
      // Intercept the nl-search request and force a failure
      await page.route('**/functions/v1/nl-search', route =>
        route.fulfill({ status: 500, body: 'Internal Server Error' })
      )

      await page.goto('/discover')
      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 10000 })

      await textarea.fill('Test error handling')
      await textarea.press('Enter')

      // Should show error message with retry button
      await expect(page.getByRole('button', { name: /retry/i })).toBeVisible({ timeout: 15000 })
    })
  })

  test.describe('Filter Chips', () => {
    test('shows filter chips after a filtered search', async ({ page }) => {
      await page.goto('/discover')
      const textarea = page.locator('textarea')
      await expect(textarea).toBeVisible({ timeout: 10000 })

      // Use a query that should produce filter chips
      await textarea.fill('Find U25 defenders')
      await textarea.press('Enter')

      // Wait for response
      await expect(async () => {
        // Filter chips or results should appear
        const chips = page.locator('span').filter({ hasText: /defender|u25|player/i })
        const results = page.locator('a[href*="/players/"]')
        expect(await chips.count() + await results.count()).toBeGreaterThan(0)
      }).toPass({ timeout: 30000 })
    })
  })
})
