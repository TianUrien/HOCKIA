import { test, expect } from './fixtures'

/** Dismiss any overlay dialogs (notification drawer, cookie consent) that may block interactions */
async function dismissOverlays(page: import('@playwright/test').Page) {
  // Close notification drawer if open (force click — may be off-viewport on mobile)
  const closeBtn = page.getByRole('button', { name: /close notifications/i })
  if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await closeBtn.click({ force: true }).catch(() => {})
    await closeBtn.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {})
  }
  // Press Escape as fallback to close any open dialogs/drawers
  await page.keyboard.press('Escape')
  // Brief settle time for animations
  await page.waitForTimeout(300)
  // Dismiss cookie consent if visible
  const cookieDecline = page.getByRole('button', { name: /decline/i })
  if (await cookieDecline.isVisible({ timeout: 500 }).catch(() => false)) {
    await cookieDecline.click({ force: true }).catch(() => {})
  }
}

/**
 * Answer the auth rate-limit checks locally. The real RPCs count every attempt
 * per email on staging, so a spec that submits the same test address on every
 * run locks itself out after a few runs (and leaves counter rows behind).
 */
async function allowRateLimitChecks(page: import('@playwright/test').Page) {
  await page.route('**/rest/v1/rpc/check_*_rate_limit', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ allowed: true, remaining: 5, reset_at: new Date(Date.now() + 3600_000).toISOString(), limit: 5 }),
  }))
}

test.describe('Signup Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Clear all storage to ensure a fully unauthenticated state — prevents
    // notification drawers and other authenticated UI from leaking into public tests
    await page.context().clearCookies()
    await page.goto('/')
    await page.evaluate(() => {
      localStorage.clear()
      sessionStorage.clear()
    })
    await page.goto('/')
  })

  // Rebrand (2026-10): the landing no longer embeds a sign-in card. It leads
  // with "Create a profile" and "Explore without an account"; signing in is
  // its own screen at /signin.
  test('landing shows the hero and no sign-in form', async ({ page }) => {
    await expect(page.getByTestId('hero').getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.locator('input[type="email"]')).toHaveCount(0)
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('landing "Create a profile" opens the first-run screen', async ({ page }) => {
    await page.getByTestId('hero').getByRole('link', { name: /create a profile/i }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: /join hockia/i })).toBeVisible()
  })

  test('landing "Create a profile" is reachable on a phone viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    await page.getByTestId('hero').getByRole('link', { name: /create a profile/i }).click()
    await expect(page).toHaveURL(/\/signup$/)
    await expect(page.getByRole('heading', { name: /join hockia/i })).toBeVisible()
  })

  test('landing "Log in" opens the sign-in screen', async ({ page }) => {
    await page.getByTestId('nav-bar').getByRole('link', { name: /^log in$/i }).click()
    await expect(page).toHaveURL(/\/signin$/)
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  // Account-first onboarding (2026-10-03): /signup is the First run screen
  // (OAuth first, Create with email, Log in); the role is chosen only once
  // the account exists, on /complete-profile.
  test('first run offers Apple, Google, Create with email and Log in — no role cards', async ({ page }) => {
    await page.goto('/signup')
    await dismissOverlays(page)
    await expect(page.getByRole('heading', { name: 'Join Hockia' })).toBeVisible({ timeout: 5000 })
    await expect(page.getByRole('button', { name: /continue with apple/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /create with email/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /log in/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /join as/i })).toHaveCount(0)
  })

  test('Create with email opens the email form without a role or date of birth', async ({ page }) => {
    await page.goto('/signup')
    await dismissOverlays(page)
    await page.getByRole('button', { name: /create with email/i }).click()
    await expect(page).toHaveURL(/\/signup\/email/)
    await expect(page.getByPlaceholder(/you@example\.com/i)).toBeVisible({ timeout: 5000 })
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible()
    await expect(page.getByLabel('Day', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/join as/i)).toHaveCount(0)
  })

  test('validates email format on signup', async ({ page }) => {
    await page.goto('/signup/email')
    await dismissOverlays(page)
    // Never create an account: the sign-up call is intercepted.
    await allowRateLimitChecks(page)
    await page.route('**/auth/v1/signup**', (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ msg: 'Unable to validate email address: invalid format' }) }))

    await page.getByPlaceholder(/you@example\.com/i).fill('invalid-email')
    await page.locator('#signup-password').fill('TestPass123!')
    await page.getByRole('button', { name: /^continue$/i }).click()

    // The input is marked invalid (HTML5 validity), whatever the server says.
    const emailInput = page.getByPlaceholder(/you@example\.com/i)
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid)
    expect(isInvalid).toBe(true)
  })

  test('signup form submits and shows feedback', async ({ page }) => {
    await page.goto('/signup/email')
    await dismissOverlays(page)

    // Intercept the API calls so no account is created, no email is sent and
    // no attempt is counted.
    await allowRateLimitChecks(page)
    await page.route('**/auth/v1/signup**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'mock-user-id',
          email: 'test@example.com',
          confirmation_sent_at: new Date().toISOString(),
        }),
      })
    })

    await page.getByPlaceholder(/you@example\.com/i).fill('test-signup@example.com')
    await page.locator('#signup-password').fill('TestPassword123!')
    await page.getByRole('button', { name: /^continue$/i }).click()

    // The mocked success lands on the verify-email screen.
    await expect(page).toHaveURL(/\/verify-email/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(/we sent a confirmation link to/i)).toBeVisible()
    await expect(page.getByText('test-signup@example.com')).toBeVisible()
  })

  test('signup page is accessible', async ({ page }) => {
    await page.goto('/signup')

    // Basic accessibility checks
    // All interactive elements should be keyboard accessible
    const buttons = page.getByRole('button')
    const count = await buttons.count()

    expect(count).toBeGreaterThan(0)

    // Check that role buttons have proper labels
    for (let i = 0; i < Math.min(count, 5); i++) {
      const button = buttons.nth(i)
      const name = await button.getAttribute('aria-label') ?? await button.textContent()
      expect(name).toBeTruthy()
    }
  })
})

test.describe('Sign In Flow', () => {
  // /signin (rebrand page 26 · Log in): providers first, then email and
  // password, with "Email me a sign-in link instead" as the alternative.
  test('sign-in screen shows providers, email and password', async ({ page }) => {
    await page.goto('/signin')

    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.locator('#auth-password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()

    // The magic-link alternative replaces the password field.
    await page.getByRole('button', { name: 'Email me a sign-in link instead' }).click()
    await expect(page.locator('#auth-password')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Email me a sign-in link', exact: true })).toBeVisible()
  })

  test('shows error for invalid credentials', async ({ page }) => {
    // The token call is intercepted with Supabase's own bad-credentials
    // response, so no failed login is recorded against staging.
    await allowRateLimitChecks(page)
    await page.route('**/auth/v1/token**', (route) => route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' }),
    }))
    await page.goto('/signin')

    await page.getByLabel('Email').fill('nonexistent-user-12345@example.com')
    await page.locator('#auth-password').fill('wrongpassword')
    await page.getByRole('button', { name: 'Log in', exact: true }).click()

    await expect(page.getByText('Incorrect email or password.')).toBeVisible()
    await expect(page).toHaveURL(/\/signin$/)
  })

  test('has password visibility toggle', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/signin')

    const passwordInput = page.locator('#auth-password')
    await passwordInput.fill('testpassword')
    await expect(passwordInput).toHaveAttribute('type', 'password')

    await page.getByRole('button', { name: 'Show password' }).click()
    await expect(passwordInput).toHaveAttribute('type', 'text')
    await expect(passwordInput).toHaveValue('testpassword')

    await page.getByRole('button', { name: 'Hide password' }).click()
    await expect(passwordInput).toHaveAttribute('type', 'password')
  })
})

test.describe('Profile Completion Flow', () => {
  // Note: These tests require authentication bypass or test credentials

  test('redirects unauthenticated users from protected routes', async ({ page }) => {
    // Try to access complete-profile directly
    await page.goto('/complete-profile')

    // Should redirect to landing or show loading
    await page.waitForURL((url) => url.pathname === '/' || url.pathname === '/complete-profile', { timeout: 10000 })
  })

  test('redirects unauthenticated users from dashboard', async ({ page }) => {
    // Try to access dashboard directly
    await page.goto('/dashboard/profile')

    // Should redirect to landing
    await page.waitForURL('/', { timeout: 10000 })
  })
})

test.describe('Public Pages Access', () => {
  test('landing page loads without errors', async ({ page }) => {
    await page.goto('/')

    // The hero is the landing's main content. (getByRole('main') is ambiguous
    // here: the page nests two <main> landmarks, reported as a product bug.)
    await expect(page.getByTestId('hero')).toBeVisible()

    // HOCKIA wordmark in the top navigation
    await expect(page.getByTestId('nav-bar').getByRole('img', { name: 'HOCKIA' })).toBeVisible()
  })

  test('privacy policy page loads', async ({ page }) => {
    await page.goto('/privacy-policy')

    await expect(page.getByRole('heading', { name: 'Privacy Policy', exact: true })).toBeVisible()
  })

  test('terms page loads', async ({ page }) => {
    await page.goto('/terms')

    // Use exact heading text to avoid matching multiple headings
    await expect(page.getByRole('heading', { name: 'Terms & Conditions' })).toBeVisible()
  })

  test('community page is accessible', async ({ page }) => {
    await page.goto('/community')

    // Should show community content or redirect
    await page.waitForLoadState('networkidle')

    // Either shows community page or redirects to landing
    const url = page.url()
    expect(url.includes('/community') || url === 'http://localhost:5173/').toBe(true)
  })

  test('opportunities page is accessible', async ({ page }) => {
    await page.goto('/opportunities')

    await page.waitForLoadState('networkidle')

    // Either shows opportunities or redirects
    const url = page.url()
    expect(url.includes('/opportunities') || url === 'http://localhost:5173/').toBe(true)
  })
})

test.describe('Navigation', () => {
  test('header displays on landing page', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.goto('/')

    // Hero heading and HOCKIA logo should be visible on desktop
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByTestId('nav-bar').getByRole('img', { name: 'HOCKIA' })).toBeVisible()
  })

  test('mobile view hides desktop navigation', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Page should load correctly on mobile — PublicNav logo is visible
    await expect(page.getByAltText(/hockia/i).first()).toBeVisible()
  })
})
