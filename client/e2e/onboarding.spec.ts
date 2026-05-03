import { test, expect } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Onboarding pre-prod release validation
 * ============================================================================
 * Targets the surfaces that the Tier-1 + Tier-2 polish sprint changed:
 *
 *   - Routes / redirects (/dashboard/brand, /coaches/*, /dashboard?tab=*)
 *   - Already-onboarded redirect guard on /complete-profile
 *   - Brand form polish (slug placeholder, category placeholder, URL validation)
 *   - Mobile viewport for the main onboarding entry
 *
 * Tests that would require RESETTING a test account's onboarding_completed
 * flag (full new-user signup → wizard → dashboard) are intentionally NOT
 * automated here — auth.setup.ts uses fixed test accounts that are
 * pre-onboarded so other tests can rely on them. A reset-onboard-then-
 * complete-then-dashboard test would either destroy that state or need
 * its own throwaway account, both of which create more risk than they
 * close. Those flows are documented in the manual-verification list at
 * the bottom of the pre-prod release report instead.
 *
 * RUNTIME ENVIRONMENTS
 * ----------------------------------------------------------------------------
 * Two distinct runners use --grep @smoke:
 *   1. Local CI (`npm run test:e2e:smoke`) — runs --project=setup first to
 *      generate e2e/.auth/<role>.json storage states, then runs the smoke
 *      projects. Auth-dependent tests work normally.
 *   2. Synthetic monitoring (.github/workflows/synthetic.yml) — runs
 *      --project=chromium --grep @smoke against PROD. No setup project,
 *      no storage files. Auth-dependent tests would ENOENT-fail.
 *
 * The auth-dependent tests below check `existsSync(authFile)` and
 * `test.skip()` cleanly when the file is absent — local CI runs them,
 * synthetic monitoring skips them without false alarms.
 * ============================================================================
 */

// Helper: skip the calling test cleanly when a storage-state file isn't
// present (synthetic monitoring scenario). Returns the resolved path so
// callers can pass it straight to browser.newContext().
const requireAuthFile = (relativePath: string): string => {
  const absolute = resolve(process.cwd(), relativePath)
  test.skip(
    !existsSync(absolute),
    `Skipping — storage state ${relativePath} not present (synthetic-monitoring run with no --project=setup).`,
  )
  return absolute
}

test.describe('@smoke onboarding routes — already-onboarded redirect guard', () => {
  test('player who is already onboarded gets redirected away from /complete-profile', async ({ browser }) => {
    const storageState = requireAuthFile('e2e/.auth/player.json')
    // This player has onboarding_completed=true on staging.
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.goto('/complete-profile')
    // CompleteProfile init effect should detect onboarding_completed and
    // navigate({ replace: true }) to /dashboard/profile.
    await page.waitForURL((url) => !url.pathname.includes('/complete-profile'), { timeout: 10_000 })
    expect(page.url()).toContain('/dashboard/profile')
    await context.close()
  })

  test('coach who is already onboarded gets redirected away from /complete-profile', async ({ browser }) => {
    const storageState = requireAuthFile('e2e/.auth/coach.json')
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.goto('/complete-profile')
    await page.waitForURL((url) => !url.pathname.includes('/complete-profile'), { timeout: 10_000 })
    expect(page.url()).toContain('/dashboard/profile')
    await context.close()
  })
})

test.describe('@smoke onboarding routes — legacy redirects', () => {
  test('/dashboard/brand redirects to canonical /dashboard/profile (cleanup #1)', async ({ browser }) => {
    const storageState = requireAuthFile('e2e/.auth/brand.json')
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.goto('/dashboard/brand')
    await page.waitForURL(
      (url) => url.pathname.includes('/dashboard/profile') || url.pathname.includes('/brands/onboarding'),
      { timeout: 10_000 },
    )
    // The brand test account has a brand row, so the redirect chain should
    // land on /dashboard/profile via DashboardRouter (rich BrandDashboard).
    // Brands without a brand row would land on /brands/onboarding — both
    // are acceptable terminal states; neither is the legacy edit page.
    const finalUrl = page.url()
    expect(finalUrl).not.toContain('/dashboard/brand')
    expect(
      finalUrl.includes('/dashboard/profile') || finalUrl.includes('/brands/onboarding')
    ).toBe(true)
    await context.close()
  })

  test('/dashboard/profile?tab=vacancies does NOT 404 (route fix)', async ({ browser }) => {
    const storageState = requireAuthFile('e2e/.auth/club.json')
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.goto('/dashboard/profile?tab=vacancies')
    // The page should render (not the 404 fallback). DashboardRouter resolves
    // the tab param via its internal state. Wait for either dashboard testid.
    await page.waitForLoadState('networkidle')
    // Catch the 404 fallback by its visible text — the actual fallback uses
    // PageTitle text "Page not found" or similar. If that's not visible, we
    // landed on a dashboard.
    const isNotFound = await page.getByText(/page not found|not found/i).isVisible().catch(() => false)
    expect(isNotFound).toBe(false)
    await context.close()
  })
})

test.describe('@smoke onboarding routes — coach alias 404 fix', () => {
  test('/coaches/:username route alias resolves to a profile page', async ({ page }) => {
    // Public route — no auth needed. Use a username that's likely to exist;
    // if it doesn't, we still verify the route doesn't 404 at the App.tsx
    // level (the page may show a "user not found" state, but that's NOT
    // the App.tsx 404 fallback).
    await page.goto('/coaches/nonexistent-test-user')
    await page.waitForLoadState('networkidle')
    // The App.tsx 404 fallback would show "Page not found". The
    // PublicPlayerProfile (which also serves coaches) shows its own
    // not-found state when no profile matches — we accept either as
    // long as it's not the App-level 404.
    const isAppLevelNotFound = await page.getByText(/the page you're looking for/i).isVisible().catch(() => false)
    expect(isAppLevelNotFound).toBe(false)
  })

  test('/coaches/id/:id route alias resolves to a profile page', async ({ page }) => {
    // Use a clearly invalid UUID — same logic as above; if the route is
    // mounted, we get PublicPlayerProfile's "not found"; if it isn't,
    // we get App.tsx 404.
    await page.goto('/coaches/id/00000000-0000-0000-0000-000000000000')
    await page.waitForLoadState('networkidle')
    const isAppLevelNotFound = await page.getByText(/the page you're looking for/i).isVisible().catch(() => false)
    expect(isAppLevelNotFound).toBe(false)
  })
})

test.describe('@smoke onboarding — brand form polish', () => {
  test('brand category dropdown shows placeholder, not silent default', async ({ browser }) => {
    // The brand test account already has a brand row, so /brands/onboarding
    // redirects them to their dashboard. Skipping in CI by checking
    // whether we landed on /brands/onboarding before asserting placeholder.
    const storageState = requireAuthFile('e2e/.auth/brand.json')
    const context = await browser.newContext({ storageState })
    const page = await context.newPage()
    await page.goto('/brands/onboarding')
    await page.waitForLoadState('networkidle')

    // If brand row exists, BrandOnboardingPage redirects → skip placeholder
    // assertion (the test brand account is post-onboarding by design).
    if (!page.url().includes('/brands/onboarding')) {
      test.skip(true, 'Test brand account already onboarded — placeholder assertion not reachable here. Manually verify on a fresh brand signup.')
      await context.close()
      return
    }

    // Brand form is mounted. Category select should default to empty (placeholder).
    const select = page.getByLabel(/category/i)
    await expect(select).toHaveValue('')
    await expect(select.locator('option').first()).toHaveText(/choose a category/i)
    await context.close()
  })
})

test.describe('@smoke onboarding — mobile layout', () => {
  test('/complete-profile renders without horizontal overflow at 375px (iPhone SE class)', async ({ page }) => {
    // Set viewport directly via setViewportSize (per-test, not per-describe)
    // so we don't have to use device presets at the describe level
    // (which Playwright forbids — would require its own worker).
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/complete-profile')
    await page.waitForLoadState('domcontentloaded')

    // Layout-only check; the page may redirect to / or render a loading
    // state for an unauthenticated user — the only invariant we care
    // about is "no horizontal scrollbar on a phone-class viewport."
    const overflow = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth
      const viewport = window.innerWidth
      return docWidth - viewport
    })
    // ≤2px slack for sub-pixel rounding in zoom / DPR translations.
    expect(overflow).toBeLessThanOrEqual(2)
  })
})
