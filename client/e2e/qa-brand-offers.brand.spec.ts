import { test, expect, type Page } from './fixtures'

/**
 * Brand offers (Figma "08 · Brands", P1; publish now since 2026-10-25). Not
 * part of @smoke. Runs against staging as the E2E brand.
 *
 * Leaves nothing behind: the list, the editor, the photo-required rule, a
 * draft that is created and deleted, the dashboard card, and the admin page
 * (rendered with mocked RPC answers; the take-down RPC is covered by
 * supabase/tests/security/brand_offers_publish_now.probe.sql).
 *
 * Not covered here: publishing an offer and ending it. A published offer
 * needs an uploaded photo and an ended offer cannot be deleted, so each run
 * would leave a stored image and an "Ended" row on the E2E brand. The
 * publish path is covered by the SQL probe above.
 *
 * QA_PROBE=1 also writes the design hand-off screenshots outside the
 * repository; unattended runs write none.
 */

const OUT = '../../handoff-brand-offers-p2/built/publish-now'
const PHONE = { width: 393, height: 852 }
const QA_PROBE = Boolean(process.env.QA_PROBE)
// Titles are unique per run: a title left by an interrupted run must never
// make the next run's row locators ambiguous.
const RUN = Date.now().toString(36)

async function settle(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined)
}

/** Hand-off screenshots are only written on an explicit QA run. */
async function shot(page: Page, name: string, fullPage = false) {
  if (QA_PROBE) await page.screenshot({ path: `${OUT}/${name}`, fullPage })
}

async function fillOffer(page: Page, title: string) {
  await page.getByLabel('Title').fill(title)
  await page.getByLabel('What members get').fill('A free grip fitting at your club, for the best price in town.')
  await page.getByLabel('Link').fill('example.com/hockia')
  await page.getByTestId('offer-add-country').click()
  await page.getByLabel('Search countries').fill('Netherl')
  await page.getByRole('button', { name: 'Netherlands' }).first().click()
  await page.getByRole('button', { name: 'Players' }).click()
}

test.describe('brand offers QA', () => {
  test.skip(!process.env.E2E_ALLOW_WRITES, 'writes to staging')

  test('phone: list, editor, draft actions, delete draft', async ({ page }) => {
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/offers')
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await shot(page, 'phone-01-list.png')

    const draftTitle = `QA test offer ${RUN}`
    await page.getByTestId('offers-new').click()
    await expect(page.getByTestId('offer-editor')).toBeVisible()
    await fillOffer(page, draftTitle)
    await page.getByRole('button', { name: 'Coaches' }).click()
    await shot(page, 'phone-02-editor.png', true)
    // Viewport-only: the sticky bars must not cover fields on a real phone.
    await page.getByLabel('Title').focus()
    await page.waitForTimeout(600)
    await shot(page, 'phone-02a-editor-viewport-top.png')
    await page.getByLabel('Starts').focus()
    await page.waitForTimeout(600)
    await shot(page, 'phone-02b-editor-viewport-dates.png')
    await expect(page.getByLabel('Starts')).toBeInViewport()
    // A photo is required to publish (2026-11-07). Without one, Publish
    // names what is missing and nothing is sent: the editor stays open.
    await page.getByTestId('offer-send').click()
    await expect(page.getByText('Add a photo', { exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/dashboard\/offers\/new$/)

    await page.getByTestId('offer-save-draft').click()
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
    const row = page.getByTestId('offer-row').filter({ hasText: draftTitle })
    await expect(row).toBeVisible()
    await settle(page)
    await shot(page, 'phone-03-list-with-draft.png', true)

    await row.getByTestId('offer-row-menu').click()
    await expect(page.getByTestId('offer-actions')).toBeVisible()
    // The "Draft saved" toast is cleared when the sheet opens (it must never cover sheet buttons).
    await expect(page.getByText('Draft saved')).toHaveCount(0)
    await shot(page, 'phone-04-actions.png')

    await page.getByTestId('offer-action-delete').click()
    await expect(page.getByTestId('offer-confirm-delete')).toBeVisible()
    await shot(page, 'phone-05-confirm-delete.png')
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
    await shot(page, 'desktop-01-editor.png')
  })

  test('brand dashboard: the Offers card opens the list (B0b)', async ({ page }) => {
    // The E2E brand has offers, so the card shows "N of 5 live" (B0b). The
    // first-offer variant (B0, "Create an offer") only exists for a brand
    // with no offers at all and is not reachable with this account.
    await page.setViewportSize(PHONE)
    await page.goto('/dashboard/profile')
    const card = page.getByTestId('brand-offers-card')
    await expect(card).toBeVisible({ timeout: 20_000 })
    await card.scrollIntoViewIfNeeded()
    await shot(page, 'phone-00b-dashboard-b0b.png')
    await expect(page.getByTestId('brand-offers-link')).toHaveText(/\d of 5 live/)
    await page.getByTestId('brand-offers-link').click()
    await expect(page).toHaveURL(/\/dashboard\/offers$/)
    await expect(page.getByTestId('brand-offers')).toBeVisible({ timeout: 20_000 })
  })

  test('admin: live offers and take down (mocked sample data)', async ({ page }) => {
    const sample = [
      {
        id: '00000000-0000-4000-8000-000000000001', brand_id: 'b1', brand_name: 'Northline Hockey (sample)', brand_logo_url: null, brand_profile_id: 'p1',
        status: 'live', pending: null, pending_status: null, review_note: null,
        title: 'Summer camp places', body: 'Reserved places at our July training camp in Cork for HOCKIA members.', image_url: null,
        link_url: 'https://example.com/camp', country_ids: [19], area: 'Cork', roles: ['player'], starts_at: null, ends_at: '2027-07-31T23:59:59Z',
        submitted_at: new Date(Date.now() - 2 * 3600_000).toISOString(), live_at: null, brand_live_count: 2, brand_offer_count: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000002', brand_id: 'b2', brand_name: 'Grip Lab (sample)', brand_logo_url: null, brand_profile_id: 'p2',
        status: 'live', pending: null, pending_status: null, review_note: null,
        title: 'Free grip fitting at your club', body: 'A free grip fitting for HOCKIA members at their own club.', image_url: null,
        link_url: 'https://example.com/grip', country_ids: [5, 30], area: null, roles: ['player', 'coach'], starts_at: null, ends_at: null,
        submitted_at: new Date(Date.now() - 5 * 3600_000).toISOString(), live_at: null, brand_live_count: 1, brand_offer_count: 3,
      },
    ]
    await page.route('**/rest/v1/rpc/is_platform_admin', (r) => r.fulfill({ json: true }))
    await page.route('**/rest/v1/rpc/admin_list_brand_offers', async (r) => {
      const tab = (r.request().postDataJSON() as { p_tab?: string })?.p_tab
      await r.fulfill({ json: tab === 'live' ? sample : [] })
    })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/admin/offers')
    await expect(page.getByTestId('admin-brand-offers')).toBeVisible({ timeout: 20_000 })
    await settle(page)
    await shot(page, 'admin-01-live.png')
    await expect(page.getByText('Ireland · Cork (by where members live)')).toBeVisible()
    await page.getByTestId('admin-offer-take-down').click()
    await page.getByRole('button', { name: 'A claim we can’t check' }).click()
    await shot(page, 'admin-02-take-down.png')
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /Taken down/ }).click()
    await expect(page.getByTestId('admin-offers-empty')).toBeVisible()
    await shot(page, 'admin-03-empty.png')
  })
})
