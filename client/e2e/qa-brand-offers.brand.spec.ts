import { test, expect, type Page } from './fixtures'

/**
 * QA screenshots for brand offers Phase 1 (Figma "08 · Brands", P1). Not part
 * of @smoke. The brand flow runs against staging as the E2E brand and deletes
 * the draft it creates. The admin queue is rendered with mocked RPC answers
 * (illustrative sample offers): the review RPCs themselves are covered by
 * supabase/tests/security/brand_offers.probe.sql.
 */

const OUT = 'test-results/brand-offers'
const PHONE = { width: 393, height: 852 }

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

test.describe('brand offers QA', () => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'writes to staging')

  test('phone: list, editor, actions, delete draft', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-01-list.png` })

    await page.getByTestId('offers-new').click()
    await expect(page.getByTestId('offer-editor')).toBeVisible()
    await page.getByLabel('Title').fill('QA test offer: grip fitting')
    await page.getByLabel('What members get').fill('A free grip fitting at your club, for the best price in town.')
    await page.getByLabel('Link').fill('example.com/hockia')
    await page.getByTestId('offer-add-country').click()
    await page.getByLabel('Search countries').fill('Netherl')
    await page.getByRole('button', { name: 'Netherlands' }).first().click()
    await page.getByRole('button', { name: 'Players' }).click()
    await page.getByRole('button', { name: 'Coaches' }).click()
    await page.screenshot({ path: `${OUT}/phone-02-editor.png`, fullPage: true })

    await page.getByTestId('offer-save-draft').click()
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
    const row = page.getByTestId('offer-row').filter({ hasText: 'QA test offer' })
    await expect(row).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${OUT}/phone-03-list-with-draft.png`, fullPage: true })

    await row.getByTestId('offer-row-menu').click()
    await expect(page.getByTestId('offer-actions')).toBeVisible()
    await page.screenshot({ path: `${OUT}/phone-04-actions.png` })

    await page.getByTestId('offer-action-delete').click()
    await expect(page.getByTestId('offer-confirm-delete')).toBeVisible()
    await page.screenshot({ path: `${OUT}/phone-05-confirm-delete.png` })
    await page.getByTestId('offer-confirm-yes').click()
    await expect(row).toHaveCount(0)
  })

  test('desktop: list beside the editor', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await page.getByTestId('offers-new').click()
    await expect(page.getByTestId('offer-editor')).toBeVisible()
    await page.getByLabel('Title').fill('Kit for your first season abroad')
    await page.getByLabel('What members get').fill('15% off your first full kit when you join a club in a new country.')
    await settle(page)
    await page.screenshot({ path: `${OUT}/desktop-01-editor.png` })
  })

  test('brand dashboard links to Offers', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/profile')
    const link = page.getByTestId('brand-offers-link')
    await expect(link).toBeVisible({ timeout: 20_000 })
    await link.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${OUT}/phone-00-dashboard-link.png` })
    await link.click()
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
  })

  test('admin queue and reject dialog (mocked sample data)', async ({ page }) => {
    const sample = [
      {
        id: '00000000-0000-4000-8000-000000000001', brand_id: 'b1', brand_name: 'Northline Hockey (sample)', brand_logo_url: null, brand_profile_id: 'p1',
        status: 'in_review', pending: null, pending_status: null, review_note: null,
        title: 'Summer camp places', body: 'Reserved places at our July training camp in Cork for HOCKIA members.', image_url: null,
        link_url: 'https://example.com/camp', country_ids: [], area: 'Cork', roles: ['player'], starts_at: null, ends_at: '2027-07-31T23:59:59Z',
        submitted_at: new Date(Date.now() - 2 * 3600_000).toISOString(), live_at: null, brand_live_count: 2, brand_offer_count: 1,
      },
    ]
    await page.route('**/rest/v1/rpc/is_platform_admin', (r) => r.fulfill({ json: true }))
    await page.route('**/rest/v1/rpc/admin_list_brand_offers', async (r) => {
      const tab = (r.request().postDataJSON() as { p_tab?: string })?.p_tab
      await r.fulfill({ json: tab === 'to_review' ? sample : [] })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/offers')
    await expect(page.getByTestId('admin-brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await page.screenshot({ path: `${OUT}/admin-01-queue.png` })
    await page.getByTestId('admin-offer-approve').click()
    await expect(page.getByText('Tick the remaining checks to approve.')).toBeVisible()
    await page.screenshot({ path: `${OUT}/admin-01b-approve-with-checks-left.png` })
    await page.getByTestId('admin-offer-reject').click()
    await page.getByRole('button', { name: 'A claim we can’t check' }).click()
    await page.screenshot({ path: `${OUT}/admin-02-reject.png` })
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /Live/ }).click()
    await expect(page.getByTestId('admin-offers-empty')).toBeVisible()
    await page.screenshot({ path: `${OUT}/admin-03-empty.png` })
  })
})
