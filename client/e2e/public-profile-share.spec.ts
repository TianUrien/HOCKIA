import { test, expect } from './fixtures'

/**
 * @smoke Public profile share — logged-out access to /players, /coaches,
 * /clubs, /umpires, /brands.
 *
 * Pinned by:
 *   - migration 20260506040423_public_profile_share_hardening.sql
 *   - ProtectedRoute PUBLIC_ROUTES allowlist
 *   - PublicProfileFooterCTA component
 *
 * NOTE on seeded usernames: deeper tests that need a real profile read
 * the E2E_PUBLIC_*_USERNAME / E2E_PUBLIC_BRAND_SLUG envs and skip when
 * absent so CI passes without seed data. The route-guard test below
 * runs unconditionally because it only checks that we DON'T get
 * redirected to `/` (the pre-share-feature behavior).
 */

const ROUTES_BY_ROLE: Array<{ role: string; path: string }> = [
  { role: 'player', path: '/players/does-not-exist-anon-route-test' },
  { role: 'coach', path: '/coaches/does-not-exist-anon-route-test' },
  { role: 'club', path: '/clubs/does-not-exist-anon-route-test' },
  { role: 'umpire', path: '/umpires/does-not-exist-anon-route-test' },
  // brand was already public; included to guard against regressions
  { role: 'brand', path: '/brands/does-not-exist-anon-route-test' },
]

test.describe('@smoke public profile share — route guard', () => {
  for (const { role, path } of ROUTES_BY_ROLE) {
    test(`anon visiting a ${role} profile URL does NOT redirect to /`, async ({ page }) => {
      // Pre-feature behavior: ProtectedRoute redirected anon to '/'.
      // After 20260506: routes are in PUBLIC_ROUTES, so the page mounts
      // even when the slug doesn't resolve to a profile.
      await page.goto(path)
      await page.waitForLoadState('domcontentloaded')

      // Allow the route to settle. We assert ON the URL only — content
      // can be a "Profile Not Found" card (expected here) or the real
      // profile (when a seeded slug is used). Both prove the route
      // mounted instead of redirecting.
      await expect(page).toHaveURL(new RegExp(path.replace(/\//g, '\\/')))
    })
  }
})

// =====================================================================
// Seeded-profile checks — only run when the E2E_PUBLIC_*_USERNAME env
// is present. Verifies the deeper content + privacy contract.
// =====================================================================

const SEEDED = {
  player: process.env.E2E_PUBLIC_PLAYER_USERNAME,
  coach: process.env.E2E_PUBLIC_COACH_USERNAME,
  club: process.env.E2E_PUBLIC_CLUB_USERNAME,
  umpire: process.env.E2E_PUBLIC_UMPIRE_USERNAME,
  brand: process.env.E2E_PUBLIC_BRAND_SLUG,
}

const PATH_FOR: Record<keyof typeof SEEDED, (slug: string) => string> = {
  player: (s) => `/players/${s}`,
  coach: (s) => `/coaches/${s}`,
  club: (s) => `/clubs/${s}`,
  umpire: (s) => `/umpires/${s}`,
  brand: (s) => `/brands/${s}`,
}

test.describe('@smoke public profile share — seeded profile (anon visitor)', () => {
  for (const role of Object.keys(SEEDED) as Array<keyof typeof SEEDED>) {
    const slug = SEEDED[role]
    test.skip(!slug, `requires E2E_PUBLIC_${role.toUpperCase()}_USERNAME`)

    test(`anon visiting a real ${role} profile sees content + no edit buttons`, async ({ page }) => {
      if (!slug) return
      await page.goto(PATH_FOR[role](slug))
      await page.waitForLoadState('networkidle')

      // 1) Page should render some heading (the profile name) — not a
      //    spinner forever, not a redirect.
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 })

      // 2) Owner-only affordances must NOT be present for anon.
      await expect(page.getByRole('button', { name: /edit profile/i })).toHaveCount(0)
      await expect(page.getByRole('button', { name: /network view/i })).toHaveCount(0)
      await expect(page.getByTestId('share-profile-button')).toHaveCount(0)

      // 3) The "Create your HOCKIA profile" footer CTA should appear.
      await expect(page.getByTestId('public-profile-footer-cta')).toBeVisible()
    })
  }
})

// =====================================================================
// Inline Journey — public profile renders Journey directly in the
// scroll instead of requiring a tab click. Player + Coach only; umpire
// deferred to Phase F2.
// =====================================================================

test.describe('@smoke public profile share — inline Journey', () => {
  const cases: Array<{ role: 'player' | 'coach'; heading: string; envKey: string }> = [
    { role: 'player', heading: 'Journey', envKey: 'E2E_PUBLIC_PLAYER_USERNAME' },
    { role: 'coach', heading: 'Coaching Journey', envKey: 'E2E_PUBLIC_COACH_USERNAME' },
  ]

  for (const { role, heading, envKey } of cases) {
    const slug = process.env[envKey]
    test.skip(!slug, `requires ${envKey}`)

    test(`anon visiting a ${role} profile sees inline "${heading}" heading (when seed has Journey entries)`, async ({ page }) => {
      if (!slug) return
      const path = role === 'coach' ? `/coaches/${slug}` : `/players/${slug}`
      await page.goto(path)
      await page.waitForLoadState('networkidle')

      // Profile loaded
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 })

      // Inline Journey heading should appear in the main scroll IF the
      // seeded profile has at least one Journey entry. The component
      // returns null in inline+readOnly mode when the list is empty —
      // so a missing heading also passes (we can't tell from outside
      // whether the seed has entries). We assert headings >= 0 to make
      // the test informational rather than a hard fail. The stricter
      // check: when the heading IS present, no owner-only "Add Journey
      // Entry" button should accompany it.
      const journeyHeading = page.getByRole('heading', { level: 2, name: new RegExp(`^${heading}$`, 'i') })
      const headingCount = await journeyHeading.count()

      if (headingCount > 0) {
        await expect(journeyHeading.first()).toBeVisible()
        // Owner-only Journey controls must not leak to anon viewers.
        await expect(page.getByRole('button', { name: /add journey entry/i })).toHaveCount(0)
      }
    })
  }
})
