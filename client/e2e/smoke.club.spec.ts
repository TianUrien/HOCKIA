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
    // Debug: check localStorage BEFORE navigating
    await page.goto('about:blank')
    await page.goto('http://localhost:5173/')
    await page.waitForLoadState('domcontentloaded')
    const authBefore = await page.evaluate(() => {
      const raw = localStorage.getItem('hockia-auth')
      if (!raw) return 'NO_SESSION'
      try {
        const s = JSON.parse(raw)
        return `token=${s.access_token?.slice(0,20)}... user=${s.user?.id} expires=${s.expires_at}`
      } catch { return 'PARSE_ERROR' }
    })
    console.log(`[DEBUG club-auth] Session in localStorage: ${authBefore}`)

    await page.goto('/dashboard/profile')
    // Wait 5s for auth to initialize, then check state
    await page.waitForTimeout(5000)

    const debugState = await page.evaluate(() => {
      const raw = localStorage.getItem('hockia-auth')
      return {
        url: window.location.href,
        hasSession: !!raw,
        bodyText: document.body?.innerText?.slice(0, 300) || 'empty',
        allKeys: Object.keys(localStorage),
      }
    })
    console.log(`[DEBUG club-dashboard] URL: ${debugState.url}`)
    console.log(`[DEBUG club-dashboard] hasSession: ${debugState.hasSession}`)
    console.log(`[DEBUG club-dashboard] localStorage keys: ${debugState.allKeys.join(', ')}`)
    console.log(`[DEBUG club-dashboard] Body: ${debugState.bodyText}`)

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
    // Wait for SPA routing to settle (DashboardRouter may redirect first)
    await page.waitForURL(`**/applicants`, { timeout: CLUB_H1_TIMEOUT_MS })
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
    await page.waitForURL('**/clubs/e2e-test-fc', { timeout: CLUB_H1_TIMEOUT_MS })
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
