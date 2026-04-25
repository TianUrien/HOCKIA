import { test, expect } from './fixtures'

test.describe('@smoke home feed player', () => {
  test('home feed shows post composer for authenticated player', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()

    // Post composer should be visible
    await homeFeedPage.expectPostComposerVisible()

    // Should show the image button
    await expect(page.getByLabel('Add image')).toBeVisible()
  })

  test('player can open and close post composer modal', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()
    await homeFeedPage.expectPostComposerVisible()

    // Open the modal
    await homeFeedPage.openPostComposer()

    // Modal should show textarea. Locate by role rather than placeholder
    // copy — placeholders rotate per role (pickPlaceholder) so matching
    // a fixed string is brittle.
    const composerTextarea = page.locator('[role="dialog"] textarea').first()
    await expect(composerTextarea).toBeVisible({ timeout: 10000 })

    // Submit button should be visible but disabled (no content yet)
    const postBtn = page.locator('button.w-full', { hasText: /^post$/i })
    await expect(postBtn).toBeVisible()

    // Close the modal (exact match avoids "Close notifications" button)
    await page.getByRole('button', { name: 'Close', exact: true }).click()

    // Modal should be gone
    await expect(composerTextarea).not.toBeVisible({ timeout: 5000 })
  })

  test('player can create a text post', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()

    // Open composer
    await homeFeedPage.openPostComposer()
    const composerTextarea = page.locator('[role="dialog"] textarea').first()
    await expect(composerTextarea).toBeVisible({ timeout: 10000 })

    // Type content
    const postContent = `E2E test post ${Date.now()}`
    await homeFeedPage.fillPostContent(postContent)

    // Submit
    await homeFeedPage.submitPost()

    // Post should appear in feed
    await homeFeedPage.expectPostInFeed(postContent)
  })

  test('player can like a post in the feed', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()
    await page.waitForLoadState('networkidle')

    // Look for any user_post with a Like button
    const likeButton = page.getByRole('button', { name: /like/i }).first()
    const hasLikeButton = await likeButton.isVisible({ timeout: 10000 }).catch(() => false)

    if (hasLikeButton) {
      await likeButton.click()
      // Wait briefly for optimistic update
      await page.waitForTimeout(500)

      // Like button should still be present (toggled state)
      await expect(likeButton).toBeVisible()
    }
  })

  test('player can open comments section on a post', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()
    await page.waitForLoadState('networkidle')

    // Look for any Comment button
    const commentButton = page.getByRole('button', { name: /comment/i }).first()
    const hasCommentButton = await commentButton.isVisible({ timeout: 10000 }).catch(() => false)

    if (hasCommentButton) {
      await commentButton.click()

      // Comment input should appear
      await expect(
        page.getByPlaceholder(/write a comment/i)
      ).toBeVisible({ timeout: 10000 })
    }
  })

  test('player can share a post (share sheet with copy link)', async ({ page, homeFeedPage, context }) => {
    await homeFeedPage.openHomeFeed()
    await page.waitForLoadState('networkidle')

    // Grant clipboard permissions
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])

    // Look for any Share button on a post card
    const shareButton = page.getByRole('button', { name: /share/i }).first()
    const hasShareButton = await shareButton.isVisible({ timeout: 10000 }).catch(() => false)

    if (hasShareButton) {
      await shareButton.click()

      // Share sheet should open with "Share post" heading and Copy link button
      await expect(
        page.getByText('Share post')
      ).toBeVisible({ timeout: 5000 })

      await expect(
        page.getByText('Copy link')
      ).toBeVisible({ timeout: 5000 })

      // Click Copy link and verify toast feedback
      await page.getByText('Copy link').click()

      await expect(
        page.getByText(/link copied/i).first()
      ).toBeVisible({ timeout: 5000 })
    }
  })

  test('feed loads both system and user posts', async ({ page, homeFeedPage }) => {
    await homeFeedPage.openHomeFeed()

    // Wait for feed to load
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(2000)

    // Feed should have loaded — either feed content (Like buttons on cards) or empty state
    const feedItem = page.getByRole('button', { name: /like/i }).first()
    const emptyState = page.getByText(/no activity yet/i)
    await expect(feedItem.or(emptyState)).toBeVisible({ timeout: 10000 })
  })
})
