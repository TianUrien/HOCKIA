import { test, expect } from './fixtures'

const E2E_VACANCY_TITLE = 'E2E Vacancy - Automated Test'

/** Opportunities v2 card for the seeded vacancy (phone and desktop share it since 16 Oct 2026). */
function getE2EVacancyCard(page: import('@playwright/test').Page) {
  return page.getByTestId('role-card').filter({ hasText: E2E_VACANCY_TITLE }).first()
}

test.describe('Vacancy Application Flow - Player', () => {
  test('authenticated player sees opportunities and the seeded E2E vacancy', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await opportunitiesPage.waitForLoadingToComplete()

    await expect(page.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeVisible()

    const card = getE2EVacancyCard(page)
    await expect(card).toBeVisible({ timeout: 20000 })
    // The subline names the club and the city.
    await expect(card.getByTestId('role-card-subline')).toContainText('E2E Test FC')
    await expect(card.getByTestId('role-card-subline')).toContainText('London')
  })

  test('quick chips narrow results deterministically', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await opportunitiesPage.waitForLoadingToComplete()
    await expect(getE2EVacancyCard(page)).toBeVisible({ timeout: 20000 })

    const chips = page.getByRole('group', { name: /filters/i }).last()
    // The seeded vacancy is a Men's role: Women's hides it, Men's keeps it.
    await chips.getByRole('button', { name: /Women/ }).click()
    await expect(getE2EVacancyCard(page)).toBeHidden({ timeout: 10000 })
    await chips.getByRole('button', { name: /Women/ }).click()
    await chips.getByRole('button', { name: /^Men/ }).click()
    await expect(getE2EVacancyCard(page)).toBeVisible({ timeout: 10000 })
  })

  test('player can open the role page and come back', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await opportunitiesPage.waitForLoadingToComplete()

    const card = getE2EVacancyCard(page)
    await expect(card).toBeVisible({ timeout: 20000 })
    await card.getByTestId('role-card-open').click()

    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}/, { timeout: 20000 })
    await expect(page.getByRole('heading', { level: 1, name: E2E_VACANCY_TITLE })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('heading', { level: 2, name: 'How applying works' })).toBeVisible()

    await page.getByTestId('role-close').click()
    await expect(page.getByRole('heading', { level: 1, name: 'Opportunities' })).toBeVisible({ timeout: 20000 })
  })

  test('player can open the apply sheet and send an application', async ({ page, opportunitiesPage }) => {
    await opportunitiesPage.openOpportunitiesPage()
    await opportunitiesPage.waitForLoadingToComplete()

    const card = getE2EVacancyCard(page)
    await expect(card).toBeVisible({ timeout: 20000 })

    // Already applied on a previous run: the card carries the Applied tag.
    if (await card.getByTestId('applied-tag').isVisible().catch(() => false)) return

    await card.getByTestId('role-card-open').click()
    await page.waitForURL(/\/opportunities\/[0-9a-f-]{36}/, { timeout: 20000 })
    await expect(async () => {
      await page.getByTestId('role-apply').click({ timeout: 5000 })
    }).toPass({ timeout: 15000, intervals: [500, 1000, 2000] })

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByTestId('apply-role-summary')).toBeVisible({ timeout: 10000 })
    const send = dialog.getByTestId('send-application')
    // A profile that does not meet the role's rules gets an explanation instead.
    if (await send.isDisabled()) {
      await expect(dialog.getByTestId('apply-not-eligible')).toBeVisible()
      return
    }
    await send.click()
    await expect(page.getByTestId('application-sent')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('application-sent-done').click()
    await expect(page.getByTestId('applied-state')).toBeVisible({ timeout: 20000 })
  })
})
