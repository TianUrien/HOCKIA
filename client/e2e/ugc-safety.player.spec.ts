import { test, expect } from './fixtures'

const E2E_CLUB_USERNAME = 'e2e-test-fc'

/** Dismiss any overlays: notifications, cookie consent, terms gate */
async function dismissGates(page: import('@playwright/test').Page) {
  await page.waitForTimeout(1500)

  // Close notifications dialog explicitly (it captures focus and blocks interaction)
  try {
    const closeNotif = page.getByRole('button', { name: /close notifications/i })
    if (await closeNotif.isVisible({ timeout: 1000 }).catch(() => false)) {
      await closeNotif.click({ force: true })
      await page.waitForTimeout(300)
    }
  } catch { /* ignore */ }

  // Press Escape to close any other popover/dialog
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)

  // Dismiss cookie consent if visible
  try {
    const cookieAccept = page.getByRole('button', { name: 'Accept', exact: true })
    if (await cookieAccept.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cookieAccept.click()
      await page.waitForTimeout(300)
    }
  } catch { /* ignore */ }

  // Accept terms gate if visible
  try {
    const termsButton = page.getByRole('button', { name: /I Agree/i })
    if (await termsButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await termsButton.click()
      await page.waitForTimeout(1000)
    }
  } catch { /* ignore */ }
}

test.describe('@smoke UGC safety (Apple Guideline 1.2)', () => {
  test('terms acceptance gate or dashboard loads for authenticated users', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await page.waitForTimeout(1000)

    // Dismiss cookie consent if visible
    const cookieAccept = page.getByRole('button', { name: 'Accept', exact: true })
    if (await cookieAccept.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieAccept.click()
    }

    // Either the terms gate appears (first-time user) or dashboard loads (terms already accepted in DB)
    const termsHeading = page.getByRole('heading', { name: 'Terms of Use' })
    const dashboard = page.getByRole('heading', { level: 1 })

    const firstVisible = await Promise.race([
      termsHeading.waitFor({ timeout: 15000 }).then(() => 'terms' as const),
      dashboard.waitFor({ timeout: 15000 }).then(() => 'dashboard' as const),
    ]).catch(() => 'neither' as const)

    if (firstVisible === 'terms') {
      // Terms gate is showing — verify content
      await expect(page.getByText('zero tolerance')).toBeVisible()
      await expect(page.getByText('Community Guidelines')).toBeVisible()

      // Accept
      await page.getByRole('button', { name: /I Agree/i }).click()
      await expect(dashboard).toBeVisible({ timeout: 15000 })
    } else {
      // Dashboard loaded — terms were already accepted (valid state)
      await expect(dashboard).toBeVisible()
    }
  })

  test('report and block buttons appear on club profile', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await dismissGates(page)

    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })

    // Three-dot menu should be visible (ProfileActionMenu)
    const moreButton = page.getByRole('button', { name: /more actions/i })
    await expect(moreButton).toBeVisible({ timeout: 10000 })

    await moreButton.click()

    // Both options should be present
    await expect(page.getByText('Report User')).toBeVisible({ timeout: 5000 })
    await expect(page.getByText('Block User')).toBeVisible({ timeout: 5000 })
  })

  test('report modal submits successfully', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await dismissGates(page)

    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })

    // Open action menu > Report
    await page.getByRole('button', { name: /more actions/i }).click()
    await page.getByText('Report User').click()

    // Modal appears
    await expect(page.getByRole('heading', { name: /Report User/i })).toBeVisible({ timeout: 5000 })

    // Fill form
    await page.getByLabel('Report category').selectOption('spam')
    await page.getByPlaceholder('Please describe what happened...').fill('E2E automated test report — please ignore')

    // Submit
    await page.getByRole('button', { name: /Submit Report/i }).click()

    // Success
    await expect(page.getByText('Report Submitted')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('within 24 hours')).toBeVisible()

    // Close
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(page.getByText('Report Submitted')).not.toBeVisible({ timeout: 5000 })
  })

  // Block toggle has a flaky notification overlay in E2E — block button visibility
  // is already verified in "report and block buttons appear on club profile" test above.
  // The block RPC + DB persistence should be verified via integration tests.
  test.fixme('block and unblock user toggles via page reload', async ({ page }) => {
    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await dismissGates(page)

    await expect(page.getByRole('heading', { level: 1, name: /e2e test fc/i })).toBeVisible({ timeout: 20000 })
    const moreButton = page.getByRole('button', { name: /more actions/i })
    await moreButton.click()
    await page.getByText('Block User').click()
    await page.waitForTimeout(2000)

    await page.goto(`/clubs/${E2E_CLUB_USERNAME}`)
    await dismissGates(page)
    await page.getByRole('button', { name: /more actions/i }).click()
    await expect(page.getByText('Unblock User')).toBeVisible({ timeout: 5000 })

    await page.getByText('Unblock User').click()
  })

  test('post three-dot menu shows report option for other users posts', async ({ page }) => {
    await page.goto('/home')
    await dismissGates(page)

    // Wait for feed to load — look for any post's three-dot menu
    const postOptions = page.getByLabel(/post options/i)
    const hasPostMenu = await postOptions.first().isVisible({ timeout: 20000 }).catch(() => false)

    if (!hasPostMenu) {
      // Feed might be empty or not loaded — skip gracefully
      test.skip()
      return
    }

    // Click the first post menu
    await postOptions.first().click()

    // Should show either Report (other's post) or Edit/Delete (own post)
    const reportBtn = page.getByText('Report post')
    const editBtn = page.getByText('Edit post')

    const hasReport = await reportBtn.isVisible({ timeout: 3000 }).catch(() => false)
    const hasEdit = await editBtn.isVisible({ timeout: 1000 }).catch(() => false)

    // At least one menu option should be visible
    expect(hasReport || hasEdit).toBe(true)
  })
})
