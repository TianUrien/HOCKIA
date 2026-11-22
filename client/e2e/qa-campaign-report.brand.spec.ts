import { test, expect, type Page } from './fixtures'

/**
 * Campaign preview in three places and the per-campaign report (founder
 * 2026-11-21). Not part of @smoke. Runs against staging as the E2E brand and
 * writes nothing: the editor is filled and closed without saving, and the
 * report is opened for a campaign that already exists (skipped when the E2E
 * brand has none that went live).
 *
 * QA_PROBE=1 also writes screenshots outside the repository.
 */
const OUT = process.env.QA_SHOTS_DIR ?? '../../handoff-campaign-report'
const PHONE = { width: 393, height: 852 }
const QA_PROBE = Boolean(process.env.QA_PROBE)

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}
async function shot(page: Page, name: string, fullPage = false) {
  if (QA_PROBE) await page.screenshot({ path: `${OUT}/${name}`, fullPage })
}

test.describe('campaign preview and report QA', () => {
  test('desktop editor: the preview shows Home, Hockia AI and the page with the objective button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('offers-new').click()
    await page.getByTestId('offer-objective-ask').click()
    await page.locator('#offer-title').fill('Questions about choosing a stick?')
    await page.locator('#offer-body').fill('Write to us about sizes and materials. A person answers.')
    const preview = page.getByTestId('campaign-preview')
    await expect(preview.getByTestId('offer-preview')).toBeVisible()
    await settle(page)
    await shot(page, 'preview-home.png')

    await preview.getByRole('tab').nth(1).click()
    await expect(preview.getByTestId('campaign-preview-ai')).toContainText('Questions about choosing a stick?')
    await shot(page, 'preview-ai.png')

    await preview.getByRole('tab').nth(2).click()
    // A question campaign with no link: the conversation is the only action.
    await expect(preview.getByTestId('campaign-preview-actions').locator('span.flex')).toHaveCount(1)
    await shot(page, 'preview-page.png')
  })

  test('phone: the report of a campaign that went live', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    const menus = page.getByTestId('offer-row-menu')
    test.skip((await menus.count()) === 0, 'the E2E brand has no campaigns')
    await menus.first().click()
    const report = page.getByTestId('offer-action-report')
    test.skip((await report.count()) === 0, 'the first campaign never went live')
    await report.click()
    await expect(page).toHaveURL(/\/dashboard\/offers\/[0-9a-f-]+\/report$/)
    await expect(page.getByTestId('campaign-report-header')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('campaign-report-number')).toBeVisible()
    await expect(page.getByTestId('campaign-report-rows')).toBeVisible()
    await settle(page)
    await shot(page, 'report-phone.png', true)

    await page.getByTestId('campaign-report-preview').click()
    await expect(page.getByTestId('campaign-preview')).toBeVisible()
    // The sheet slides in; wait for it to rest before the hand-off screenshot.
    if (QA_PROBE) await page.waitForTimeout(600)
    await shot(page, 'report-preview-sheet.png')
  })

  test('desktop: a link to /dashboard/offers/new opens the editor beside the list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/dashboard/offers/new')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('offer-editor')).toBeVisible()
    await expect(page.getByTestId('offer-objective')).toBeVisible()
  })

  test('phone: the page preview shows whole button labels, in the interface language', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/offers/new')
    await expect(page.getByTestId('offer-editor')).toBeVisible({ timeout: 20_000 })
    const preview = page.getByTestId('campaign-preview')
    const actions = preview.getByTestId('campaign-preview-actions')
    // No label is cut: each one is as wide as its text needs, on as many lines as it takes.
    const whole = async () => expect(await actions.locator('span.flex').evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1))).toBe(true)

    await page.getByTestId('offer-objective-ambassador').click()
    await preview.getByRole('tab').nth(2).click()
    await expect(actions.locator('span.flex')).toHaveCount(1)
    await whole()
    await preview.scrollIntoViewIfNeeded()
    if (QA_PROBE) await preview.screenshot({ path: `${OUT}/preview-page-ambassador-phone.png` })

    await page.getByTestId('offer-objective-offer').click()
    await page.locator('#offer-link').fill('shop.example.com/hockia')
    await expect(actions.locator('span.flex')).toHaveCount(2)
    await whole()
    await preview.scrollIntoViewIfNeeded()
    if (QA_PROBE) await preview.screenshot({ path: `${OUT}/preview-page-offer-phone.png` })
  })

  test('phone: "How are my campaigns doing?" is answered inside Hockia AI with a card per campaign', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.getByTestId('hockia-ai-button').first().click()
    await expect(page.getByTestId('hockia-ai-sheet')).toBeVisible()
    // The second brand choice: answered in the sheet, it does not leave for a screen.
    await page.getByTestId('hockia-ai-option').nth(1).click()
    await expect(page.getByTestId('hockia-ai-campaigns')).toBeVisible()
    await expect(page.getByTestId('hockia-ai-campaigns-lead')).toBeVisible({ timeout: 20_000 })
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
    if (QA_PROBE) await page.waitForTimeout(600)
    await shot(page, 'ai-campaigns.png')
  })

  test('phone: a campaign from one sentence shows a draft card in Hockia AI (the draft function is mocked; nothing is saved)', async ({ page }) => {
    await page.setViewportSize(PHONE)
    // The edge function is answered here, so the test spends no model call and does not depend on its deploy.
    await page.route('**/functions/v1/campaign-draft', (r) => r.fulfill({
      json: { draft: { objective: 'ask', title: 'Questions about choosing a stick?', body: 'Write to us about sizes and materials. A person answers.', need: 'gear', roles: ['player'], place: 'everywhere', perk: null }, source: 'ai' },
    }))
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.getByTestId('hockia-ai-button').first().click()
    await expect(page.getByTestId('hockia-ai-sheet')).toBeVisible()
    await page.getByTestId('hockia-ai-option').nth(2).click()
    await expect(page.getByTestId('hockia-ai-campaign-composer')).toBeVisible()
    await page.getByTestId('hockia-ai-campaign-input').fill('I want players to write to us with questions about choosing a stick')
    if (QA_PROBE) await page.waitForTimeout(400)
    await shot(page, 'ai-compose-ask.png')
    await page.getByTestId('hockia-ai-campaign-send').click()
    await expect(page.getByTestId('hockia-ai-campaign-draft-title')).toHaveText('Questions about choosing a stick?')
    await expect(page.getByTestId('hockia-ai-campaign-objective-ask')).toHaveAttribute('aria-checked', 'true')
    // It has not left the page and has not saved anything: that only happens on "Continue in the editor".
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
    if (QA_PROBE) await page.waitForTimeout(400)
    await shot(page, 'ai-compose-draft.png')
  })
})
