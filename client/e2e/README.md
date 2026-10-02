# E2E Testing Setup

This directory contains end-to-end tests for HOCKIA using Playwright.

## ⚠️ IMPORTANT: Use Dedicated Test Accounts

E2E tests should use dedicated test accounts with **real, deliverable email addresses** (Gmail aliases are fine) to avoid Supabase email bounces.

Do not hard-code real emails/passwords in this repo. Use environment variables locally and CI secrets in your pipeline.

### Environment Setup

Add these to your `.env.local` (recommended) or your CI secrets:

```bash
E2E_PLAYER_EMAIL=yourname+e2e-player@gmail.com
E2E_PLAYER_PASSWORD=your-strong-test-password
E2E_CLUB_EMAIL=yourname+e2e-club@gmail.com
E2E_CLUB_PASSWORD=your-strong-test-password
E2E_COACH_EMAIL=yourname+e2e-coach@gmail.com
E2E_COACH_PASSWORD=your-strong-test-password
```

### E2E Safety Gate (writes)

`e2e/auth.setup.ts` can write to the database (create/patch profiles, seed vacancies, send messages). To prevent accidental writes to production, it is **blocked by default**.

To enable it, you must set:

```bash
# 1) Explicit opt-in
export E2E_ALLOW_WRITES=1

# 2) Explicit allowlist for the target Supabase URL
# Recommended for local Supabase only:
export E2E_ALLOWED_SUPABASE_URL_REGEX='^(http://127\\.0\\.0\\.1:54321|http://localhost:54321)$'
```

For CI or staging, prefer `E2E_ALLOWED_SUPABASE_URL` (exact match) instead of a regex.

---

## Suite size and projects

The current counts (36 spec files, 24 `@smoke`-tagged tests) and the full
Playwright project table (`setup`, `chromium`, `chromium-player`,
`chromium-club`, `chromium-coach`, `chromium-brand`, `mobile-player`,
`staging`) are maintained in
[`docs/engineering/testing.md`](../../docs/engineering/testing.md); the spec
suffix decides the project (`.player.spec.ts`, `.club.spec.ts`,
`.coach.spec.ts`, `.brand.spec.ts`, `.authenticated.spec.ts`,
`.staging.spec.ts`, otherwise public). `auth.setup.ts` signs the role
accounts in and stores their sessions under `e2e/.auth/` (gitignored);
`fixtures.ts` holds the page objects.

## Setting Up Test Users

The auth setup script (`auth.setup.ts`) automatically:
1. Authenticates test users via Supabase API
2. Creates/completes their profiles if not already done
3. Saves the session state for use in authenticated tests

### Required Environment Variables

If these are not set, E2E tests will fail with a clear error message.

## Running Tests

### All Tests (Public Only)
```bash
npm run test:e2e
```

### With Authentication Setup
```bash
# This runs the setup project first, then authenticated tests
npx playwright test --project=chromium-player
```

### Run All Projects
```bash
npx playwright test
```

### Specific Test File
```bash
npx playwright test e2e/signup.spec.ts
```

### Debug Mode
```bash
npm run test:e2e:debug
```

### UI Mode
```bash
npm run test:e2e:ui
```

## Writing Tests

### Public Tests (No Auth)
Name your file `*.spec.ts`:

```typescript
import { test, expect } from './fixtures'

test('my public test', async ({ page }) => {
  await page.goto('/')
  // ...
})
```

### Authenticated Tests (Player)
Name your file `*.authenticated.spec.ts` or `*.player.spec.ts`:

```typescript
import { test, expect } from './fixtures'

test('my authenticated test', async ({ page }) => {
  // Session is already authenticated via storageState
  await page.goto('/opportunities')
  // ...
})
```

### Club-Specific Tests
Name your file `*.club.spec.ts`:

```typescript
import { test, expect } from './fixtures'

test('club can create vacancy', async ({ page }) => {
  await page.goto('/dashboard/profile')
  // ...
})
```

## Page Objects

Use the provided page objects for cleaner tests:

```typescript
import { test, expect } from './fixtures'

test('using page objects', async ({ opportunitiesPage, page }) => {
  await opportunitiesPage.openOpportunitiesPage()
  await opportunitiesPage.filterByLocation('Spain')
  await opportunitiesPage.waitForLoadingToComplete()
})
```

## Troubleshooting

### "Authentication failed"
- Ensure test users exist in your Supabase database
- Check that VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set
- Verify the email is confirmed for the test users

### Tests redirect to landing page
- The session might have expired
- Delete `e2e/.auth/` and re-run to regenerate sessions
- Check that the test file uses the correct naming pattern

### Flaky tests
- Increase timeouts in page object methods
- Use `waitForLoadState('networkidle')` after navigation
- Check for loading spinners before assertions

## CI/CD Integration

For CI, ensure environment variables are set in your CI config:

```yaml
# Example GitHub Actions
env:
  VITE_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
  VITE_SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
  E2E_PLAYER_EMAIL: ${{ secrets.E2E_PLAYER_EMAIL }}
  E2E_PLAYER_PASSWORD: ${{ secrets.E2E_PLAYER_PASSWORD }}
```
