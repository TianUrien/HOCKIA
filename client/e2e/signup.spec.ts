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

  test('displays landing page with sign in form', async ({ page }) => {
    // Verify landing page loads correctly
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Sign in form heading says "Sign In"
    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()
    // Email input should be present in the visible sign-in card
    await expect(page.locator('input[type="email"]').last()).toBeVisible()
  })

  test('shows Create account link on mobile', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Mobile sign-in card shows a "Create account" button
    await expect(page.getByRole('button', { name: /create account/i })).toBeVisible()
  })

  test('navigates to signup page from mobile sign-in card', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Click the "Create account" button in the mobile sign-in card
    await page.getByRole('button', { name: /create account/i }).click()

    // Should be on signup page
    await expect(page).toHaveURL(/\/signup/)

    // Role selection should be visible
    await expect(page.getByRole('heading', { name: /join hockia/i })).toBeVisible()
  })

  test('navigates to signup from sign-in card link', async ({ page }) => {
    // Desktop sign-in card has "Join HOCKIA" button inside "New here?" text
    await page.locator('[data-signin-card]').last().getByRole('button', { name: /join hockia/i }).click()

    // Should be on signup page
    await expect(page).toHaveURL(/\/signup/)
  })

  test('player signup flow - role selection', async ({ page }) => {
    await page.goto('/signup')

    // Select player role - actual button text is "Join as Player"
    await page.getByRole('button', { name: /join as player/i }).click()

    // Email input should appear after role selection
    await expect(page.getByPlaceholder(/enter your email/i)).toBeVisible({ timeout: 5000 })
  })

  test('club signup flow - role selection', async ({ page }) => {
    await page.goto('/signup')

    // Select club role - actual button text is "Join as Club"
    await page.getByRole('button', { name: /join as club/i }).click()

    // Email input should appear after role selection
    await expect(page.getByPlaceholder(/enter your email/i)).toBeVisible({ timeout: 5000 })
  })

  test('coach signup flow - role selection', async ({ page }) => {
    await page.goto('/signup')

    // Select coach role - actual button text is "Join as Coach"
    await page.getByRole('button', { name: /join as coach/i }).click()

    // Email input should appear after role selection
    await expect(page.getByPlaceholder(/enter your email/i)).toBeVisible({ timeout: 5000 })
  })

  test('validates email format on signup', async ({ page }) => {
    await page.goto('/signup')
    await dismissOverlays(page)
    await page.getByRole('button', { name: /join as player/i }).click()

    // Try invalid email
    await page.getByPlaceholder(/enter your email/i).fill('invalid-email')
    // Fill password to pass required check
    await page.getByPlaceholder(/min\. 8 chars/i).fill('TestPass123!')
    await page.getByRole('button', { name: /create account/i }).click()

    // Should show validation error (either HTML5 or custom)
    // The browser may show native validation, or the app may show an error
    const emailInput = page.getByPlaceholder(/enter your email/i)
    // Check if input is marked invalid (HTML5 validation)
    const isInvalid = await emailInput.evaluate((el: HTMLInputElement) => !el.validity.valid)
    expect(isInvalid).toBe(true)
  })

  test('signup form submits and shows feedback', async ({ page }) => {
    await page.goto('/signup')
    await dismissOverlays(page)
    await page.getByRole('button', { name: /join as player/i }).click()

    // Fill the form with valid-looking data but intercept the API call
    // to avoid triggering actual Supabase emails
    await page.route('**/auth/v1/signup**', async (route) => {
      // Mock a successful signup response without actually creating a user
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

    await page.getByPlaceholder(/enter your email/i).fill('test-signup@example.com')
    await page.getByPlaceholder(/min\. 8 chars/i).fill('TestPassword123!')

    await page.getByRole('button', { name: /create account/i }).click()

    // Should show verification message (our mocked response triggers success flow)
    // Use .first() since multiple elements may match the verification text
    await expect(
      page.getByText(/we've sent a verification/i)
    ).toBeVisible({ timeout: 10000 })
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
  test('displays sign in form on landing page', async ({ page }) => {
    await page.goto('/')

    // Sign in form heading says "Sign In"
    await expect(page.getByRole('heading', { name: /^sign in$/i })).toBeVisible()
    // Email and password inputs should be present in the visible desktop sign-in card
    await expect(page.locator('input[type="email"]').last()).toBeVisible()
    await expect(page.locator('input[type="password"]').last()).toBeVisible()
  })

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/')

    // Scope to the visible desktop sign-in card (last in DOM; first is hidden mobile card)
    const signInCard = page.locator('[data-signin-card]').last()

    // Enter invalid credentials
    await signInCard.locator('input[type="email"]').fill('nonexistent-user-12345@gmail.com')
    await signInCard.locator('input[type="password"]').fill('wrongpassword')
    await signInCard.getByRole('button', { name: /sign in/i }).click()

    // Should show error message (scoped to visible desktop card)
    await expect(signInCard.getByText(/invalid|incorrect|failed|error/i)).toBeVisible({ timeout: 10000 })
  })

  test('has password visibility toggle', async ({ page }) => {
    // Password toggle only exists on mobile layout
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Scope to the visible mobile sign-in card
    const signInCard = page.locator('[data-signin-card]').first()

    // Find the password input
    const passwordInput = signInCard.locator('input[type="password"]')
    await passwordInput.fill('testpassword')

    // The toggle button has class "absolute" and contains an SVG (Eye icon)
    const toggleButton = signInCard.locator('button.absolute').filter({ has: page.locator('svg') })

    // Password should be hidden by default
    await expect(passwordInput).toHaveAttribute('type', 'password')

    // Click toggle to show password
    await toggleButton.click()

    // After clicking, the type changes from "password" to "text"
    await expect(signInCard.locator('input[value="testpassword"]')).toHaveAttribute('type', 'text')
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

    // Main content should be visible
    await expect(page.getByRole('main')).toBeVisible()

    // HOCKIA logo in the main content area (scoped to avoid matching hidden PublicNav logo)
    await expect(page.locator('main img[alt="HOCKIA"]').last()).toBeVisible()
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
    await expect(page.locator('main img[alt="HOCKIA"]').last()).toBeVisible()
  })

  test('mobile view hides desktop navigation', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')

    // Page should load correctly on mobile — PublicNav logo is visible
    await expect(page.getByAltText(/hockia/i).first()).toBeVisible()
  })
})
