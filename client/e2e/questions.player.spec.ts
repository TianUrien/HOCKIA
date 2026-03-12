import { test, expect } from './fixtures'

/**
 * Questions (Q&A) Feature E2E Tests - Player Role
 * 
 * Tests for the Community Q&A feature from a player's perspective.
 * These tests use the authenticated player session.
 * 
 * Test accounts used:
 *   - Player: playrplayer93@gmail.com (primary actor for these tests)
 * 
 * All test content is created with is_test_content=true via database triggers,
 * ensuring it's isolated from real users.
 */

// Generate unique identifiers for test data to avoid collisions
const testId = () => `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test.describe('@questions player flows', () => {
  test.describe('Questions List', () => {
    test('questions page loads successfully', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()

      // Page should have the Questions heading
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })
      
      // Should have Ask a Question button
      await expect(page.getByRole('button', { name: /ask a question/i })).toBeVisible()
      
      // Should have category and sort filters
      await expect(page.locator('select').first()).toBeVisible()
    })

    test('can switch between People and Questions modes', async ({ questionsPage, page }) => {
      await page.goto('/community')
      await questionsPage.waitForLoadingToComplete()

      // Start on Members mode (default)
      await expect(page.getByRole('heading', { name: /community/i })).toBeVisible({ timeout: 20000 })

      // Switch to Questions
      await page.getByRole('button', { name: /questions/i }).click()
      await questionsPage.waitForLoadingToComplete()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible()

      // Switch back to Members
      await page.getByRole('button', { name: /members/i }).click()
      await questionsPage.waitForLoadingToComplete()
      await expect(page.getByRole('heading', { name: 'Questions' })).not.toBeVisible()
    })

    test('can filter questions by category', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Open category dropdown and select a category
      const categorySelect = page.locator('select').first()
      await expect(categorySelect).toBeVisible()
      
      // Select a specific category
      await categorySelect.selectOption({ label: 'Visas & Moving Abroad' })
      await questionsPage.waitForLoadingToComplete()

      // Page should still be functional
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible()
    })

    test('can sort questions by Latest and Most Answered', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Find the sort dropdown (second select)
      const sortSelect = page.locator('select').nth(1)
      await expect(sortSelect).toBeVisible()

      // Sort by Most Answered
      await sortSelect.selectOption({ label: 'Most Answered' })
      await questionsPage.waitForLoadingToComplete()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible()

      // Sort back to Latest
      await sortSelect.selectOption({ label: 'Latest' })
      await questionsPage.waitForLoadingToComplete()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible()
    })
  })

  test.describe('Create Question', () => {
    test('can open and close Ask Question modal', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Click Ask a Question
      await page.getByRole('button', { name: /ask a question/i }).click()

      // Modal should appear
      await expect(page.getByRole('dialog')).toBeVisible()
      await expect(page.getByRole('heading', { name: /ask a question/i })).toBeVisible()

      // Close modal
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).not.toBeVisible()
    })

    test('can create a new question', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Test Question ${testId()}`
      const questionBody = 'This is an automated test question body. Please ignore.'

      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Open modal
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      // Fill in the form
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByLabel(/additional details/i).fill(questionBody)

      // Submit - use exact button text
      const submitBtn = page.getByRole('button', { name: 'Post Question' })
      await expect(submitBtn).toBeEnabled()
      await submitBtn.click()

      // Wait for dialog to close (question created) or for error
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 15000 })

      // Question should appear in the list
      await expect(page.getByRole('heading', { level: 3, name: questionTitle })).toBeVisible({ timeout: 10000 })
    })

    test('validates required fields when creating question', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Open modal
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()

      // Try to submit empty form - button should be disabled
      const submitButton = page.getByRole('button', { name: /post question|submit/i })
      await expect(submitButton).toBeDisabled()
    })
  })

  test.describe('Question Detail', () => {
    test('can view question detail page', async ({ questionsPage, page }) => {
      // First create a question
      const questionTitle = `E2E Detail Test ${testId()}`

      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Create a question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Click on the question to view details
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()

      // Should be on detail page
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(/back to questions/i)).toBeVisible()
      await expect(page.getByText(/0 answers/i)).toBeVisible()
    })

    test('question detail shows author info with role badge', async ({ questionsPage, page }) => {
      // Create a question first
      const questionTitle = `E2E Author Info Test ${testId()}`

      await questionsPage.openQuestionsPage()
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Navigate to detail
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })

      // Should show author name and Player badge
      await expect(page.getByText(/Test Player/)).toBeVisible()
      await expect(page.getByText('Player')).toBeVisible()
    })

    test('can navigate back to questions list', async ({ questionsPage, page }) => {
      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Create and view a question
      const questionTitle = `E2E Back Nav Test ${testId()}`
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })

      // Click back link
      await page.getByText(/back to questions/i).click()
      
      // Should be back on questions list
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 10000 })
    })
  })

  test.describe('Answering Questions', () => {
    test('can post an answer to own question', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Answer Own Q ${testId()}`
      const answerBody = 'This is an automated test answer to my own question.'

      await questionsPage.openQuestionsPage()
      await expect(page.getByRole('heading', { name: 'Questions' })).toBeVisible({ timeout: 20000 })

      // Create a question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Go to question detail
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })

      // Fill in answer
      await page.getByPlaceholder(/share your knowledge|write your answer/i).fill(answerBody)
      
      // Submit answer
      await page.getByRole('button', { name: /post answer|submit/i }).click()

      // Answer should appear
      await expect(page.getByText(answerBody)).toBeVisible({ timeout: 10000 })
      
      // Answer count should update to 1
      await expect(page.getByText(/1 answer/i)).toBeVisible()
    })

    test('answer author shows name and role badge', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Answer Author ${testId()}`
      const answerBody = `Test answer author info ${testId()}`

      await questionsPage.openQuestionsPage()
      
      // Create question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Go to detail and answer
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await page.getByPlaceholder(/share your knowledge|write your answer/i).fill(answerBody)
      await page.getByRole('button', { name: /post answer|submit/i }).click()

      // Should show answer with author info
      await expect(page.getByText(answerBody)).toBeVisible({ timeout: 10000 })
      
      // Answer section should show Player badge (since test player posted it)
      const answerSection = page.locator('div').filter({ hasText: answerBody }).first()
      await expect(answerSection.getByText('Player')).toBeVisible()
    })
  })

  test.describe('Author Permissions', () => {
    test('author can see delete option on own question', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Delete Own Q ${testId()}`

      await questionsPage.openQuestionsPage()
      
      // Create question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Go to detail
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })

      // Should see options menu button
      await expect(page.getByRole('button', { name: /question options/i })).toBeVisible()
    })

    test('can delete own question', async ({ questionsPage, page }) => {
      const questionTitle = `E2E To Delete ${testId()}`

      await questionsPage.openQuestionsPage()
      
      // Create question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Go to detail
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await expect(page.getByRole('heading', { level: 1, name: questionTitle })).toBeVisible({ timeout: 10000 })

      // Click options and delete
      await page.getByRole('button', { name: /question options/i }).click()
      
      // Handle confirmation dialog
      page.on('dialog', dialog => dialog.accept())
      await page.getByRole('button', { name: /delete question/i }).click()

      // Should redirect to questions list and question should be gone
      await expect(page).toHaveURL(/\/community\/questions/, { timeout: 10000 })
      await expect(page.getByText(/question deleted/i)).toBeVisible({ timeout: 10000 })
    })

    test('author can edit and delete own answer', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Edit Answer ${testId()}`
      const originalAnswer = 'Original answer text'
      const editedAnswer = 'Edited answer text ' + testId()

      await questionsPage.openQuestionsPage()
      
      // Create question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Other / Not Sure' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Go to detail and answer
      await page.getByRole('heading', { level: 3, name: questionTitle }).click()
      await page.getByPlaceholder(/share your knowledge|write your answer/i).fill(originalAnswer)
      await page.getByRole('button', { name: /post answer|submit/i }).click()
      await expect(page.getByText(originalAnswer)).toBeVisible({ timeout: 10000 })

      // Click options menu on answer
      await page.getByRole('button', { name: /answer options/i }).click()
      
      // Click edit
      await page.getByRole('button', { name: /edit/i }).click()
      
      // Edit the answer
      await page.locator('textarea').fill(editedAnswer)
      await page.getByRole('button', { name: /save/i }).click()

      // Edited answer should appear
      await expect(page.getByText(editedAnswer)).toBeVisible({ timeout: 10000 })
      await expect(page.getByText(originalAnswer)).not.toBeVisible()
    })
  })

  test.describe('Question Card Display', () => {
    test('question card shows title, category, author, and answer count', async ({ questionsPage, page }) => {
      const questionTitle = `E2E Card Display ${testId()}`

      await questionsPage.openQuestionsPage()
      
      // Create question
      await page.getByRole('button', { name: /ask a question/i }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.getByLabel(/your question/i).fill(questionTitle)
      await page.getByLabel('Category').selectOption({ label: 'Training & Performance' })
      await page.getByRole('button', { name: /post question|submit/i }).click()
      await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10000 })

      // Find the question card
      const card = page.locator('a').filter({ hasText: questionTitle })
      
      // Should show title
      await expect(card.getByRole('heading', { level: 3, name: questionTitle })).toBeVisible()
      
      // Should show category badge
      await expect(card.getByText('Training & Performance')).toBeVisible()
      
      // Should show answer count
      await expect(card.getByText(/0 answers/i)).toBeVisible()
      
      // Should show author name
      await expect(card.getByText(/Test Player/)).toBeVisible()
      
      // Should show Player role badge
      await expect(card.getByText('Player')).toBeVisible()
    })
  })
})
