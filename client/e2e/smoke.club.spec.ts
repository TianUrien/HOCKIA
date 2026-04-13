import { test, expect } from './fixtures'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type SeededVacancyData = {
  id: string | null
  title: string
  clubId: string
}

function readSeededVacancy(): SeededVacancyData {
  const filePath = path.join(__dirname, '.data', 'vacancy.json')
  const raw = fs.readFileSync(filePath, 'utf-8')
  return JSON.parse(raw) as SeededVacancyData
}

// Club dashboards gate H1 on a two-fetch chain (profile + club_media count + RLS checks)
// against real staging in CI. 20s is too tight under CI latency; 40s leaves headroom
// without masking real regressions (local still settles in < 3s).
const CLUB_H1_TIMEOUT_MS = process.env.CI ? 40_000 : 20_000

// Wait for in-flight requests to settle before asserting on rendered content.
// Helps in CI where SPA hydration races real-network Supabase queries.
async function waitForAppReady(page: import('@playwright/test').Page) {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {
    // Fallback: don't fail the test if networkidle never settles (e.g., polling);
    // the subsequent toBeVisible assertion is still the real signal.
  })
}

test.describe('@smoke club', () => {
  test('club dashboard loads for authenticated club user', async ({ page }) => {
    await page.goto('/dashboard/profile')
    await waitForAppReady(page)

    // Club name should render as H1
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: CLUB_H1_TIMEOUT_MS })

    // Should show club-specific tabs
    await expect(
      page.getByRole('button', { name: /overview/i })
        .or(page.getByRole('button', { name: /opportunities/i }))
    ).toBeVisible({ timeout: 10_000 })
  })

  test('club can open applicants page for seeded vacancy', async ({ page }) => {
    const seeded = readSeededVacancy()
    expect(seeded.id, 'Seeded vacancy id should be written by auth.setup').toBeTruthy()

    await page.goto(`/dashboard/opportunities/${seeded.id}/applicants`)
    await waitForAppReady(page)

    await expect(
      page.getByRole('heading', { level: 1, name: new RegExp(`Applicants for ${seeded.title}`, 'i') })
    ).toBeVisible({ timeout: CLUB_H1_TIMEOUT_MS })

    // Either the empty state or some applicants count should show
    const emptyState = page.getByRole('heading', { level: 3, name: 'No Applicants Yet' })
    const hasEmptyOrApplicants = await emptyState.isVisible() || await page.getByText(/\d+\s+applicants?/i).first().isVisible()
    expect(hasEmptyOrApplicants).toBe(true)
  })

  test('club public profile is accessible', async ({ page }) => {
    await page.goto('/clubs/e2e-test-fc')
    await waitForAppReady(page)

    await expect(
      page.getByRole('heading', { level: 1, name: /e2e test fc/i })
    ).toBeVisible({ timeout: CLUB_H1_TIMEOUT_MS })

    // Should show the Message action button (exact match avoids nav "Messages" icon)
    await expect(
      page.getByRole('button', { name: 'Message', exact: true })
    ).toBeVisible({ timeout: 10000 })
  })

  test('club cannot access brand dashboard', async ({ page }) => {
    await page.goto('/dashboard/brand')
    await page.waitForTimeout(3000)

    // Club should not see brand dashboard content
    const url = page.url()
    const isOnBrandDash = url.includes('/dashboard/brand')
    if (isOnBrandDash) {
      // If still on the URL, should show an error or empty state, not brand controls
      const hasBrandControls = await page.getByRole('button', { name: /add product/i }).isVisible().catch(() => false)
      expect(hasBrandControls).toBe(false)
    }
  })
})
