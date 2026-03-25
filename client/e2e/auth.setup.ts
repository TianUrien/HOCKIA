import { test as setup, expect } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load environment variables from multiple sources
// Priority: .env.staging (when staging mode) > .env.local > .env
if (process.env.E2E_STAGING_MODE === '1') {
  dotenv.config({ path: path.join(__dirname, '..', '.env.staging') })
}
dotenv.config({ path: path.join(__dirname, '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '.env') })
dotenv.config({ path: path.join(__dirname, '..', '..', '.env.local') })
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') })

function assertSafeE2EEnvironment() {
  // Hard opt-in: E2E writes are never allowed by default.
  if (process.env.E2E_ALLOW_WRITES !== '1') {
    throw new Error(
      '[E2E Safety Gate] Refusing to run E2E setup because writes are not explicitly enabled.\n' +
        'Set E2E_ALLOW_WRITES=1 to opt-in (required for auth.setup which can upsert profiles, seed vacancies, and send messages).\n' +
        'Tip: use a staging/test Supabase project, never production.'
    )
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  if (!supabaseUrl) {
    throw new Error('[E2E Safety Gate] Missing VITE_SUPABASE_URL (or SUPABASE_URL).')
  }

  // Hard allowlist: must match either exact URL or regex.
  const allowedExact = process.env.E2E_ALLOWED_SUPABASE_URL
  const allowedRegexRaw = process.env.E2E_ALLOWED_SUPABASE_URL_REGEX

  if (allowedExact) {
    if (supabaseUrl !== allowedExact) {
      throw new Error(
        '[E2E Safety Gate] Refusing to run: Supabase URL does not match allowlisted URL.\n' +
          `Expected: ${allowedExact}\n` +
          `Actual:   ${supabaseUrl}`
      )
    }
    return
  }

  if (allowedRegexRaw) {
    let allowedRegex: RegExp
    try {
      allowedRegex = new RegExp(allowedRegexRaw)
    } catch {
      throw new Error(
        '[E2E Safety Gate] Invalid E2E_ALLOWED_SUPABASE_URL_REGEX. Provide a valid JS regex string.\n' +
          `Got: ${allowedRegexRaw}`
      )
    }
    if (!allowedRegex.test(supabaseUrl)) {
      throw new Error(
        '[E2E Safety Gate] Refusing to run: Supabase URL does not match allowlisted regex.\n' +
          `Regex:  ${allowedRegexRaw}\n` +
          `Actual: ${supabaseUrl}`
      )
    }
    return
  }

  throw new Error(
    '[E2E Safety Gate] Refusing to run: no allowlist configured.\n' +
      'Set either E2E_ALLOWED_SUPABASE_URL (exact match) or E2E_ALLOWED_SUPABASE_URL_REGEX (pattern match).\n' +
      `Current Supabase URL: ${supabaseUrl}\n\n` +
      'Local example (safe for localhost only):\n' +
      '  export E2E_ALLOW_WRITES=1\n' +
      "  export E2E_ALLOWED_SUPABASE_URL_REGEX='^(http://127\\.0\\.0\\.1:54321|http://localhost:54321)$'\n"
  )
}

// Enforce safety gates as soon as this file is loaded.
assertSafeE2EEnvironment()

/**
 * Staging mode: set is_test_account=false so edge functions and DB triggers
 * treat test users as real users. EMAIL_ALLOWED_RECIPIENTS whitelist on staging
 * prevents emails from leaking to unintended recipients.
 */
const isStagingMode = process.env.E2E_STAGING_MODE === '1'
const testAccountFlag = !isStagingMode

if (isStagingMode) {
  console.log('[Auth Setup] STAGING MODE — is_test_account will be set to false')
}

/**
 * Authentication Setup for E2E Tests
 * 
 * This script authenticates test users via Supabase API and saves their
 * session storage state to be reused across tests.
 * 
 * Test users are created in the database beforehand (see e2e/README.md)
 * 
 * IMPORTANT: E2E tests require REAL email addresses to avoid Supabase email bounces.
 * Set these environment variables in .env.local:
 *   - E2E_PLAYER_EMAIL (e.g., yourname+e2e-player@gmail.com)
 *   - E2E_CLUB_EMAIL (e.g., yourname+e2e-club@gmail.com) 
 *   - E2E_COACH_EMAIL (e.g., yourname+e2e-coach@gmail.com)
 */

// Validate required environment variables
function getRequiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
      `E2E tests require real email addresses to avoid Supabase email bounces.\n` +
      `Set ${name} in your .env.local file (e.g., yourname+e2e-player@gmail.com)`
    )
  }
  return value
}

// Test user credentials - MUST use real email addresses
const TEST_PLAYER = {
  get email() { return getRequiredEnv('E2E_PLAYER_EMAIL') },
  get password() { return getRequiredEnv('E2E_PLAYER_PASSWORD') },
  profile: {
    role: 'player',
    full_name: 'E2E Test Player',
    username: 'e2e-test-player',
    base_location: 'London, UK',
    nationality: 'United Kingdom',
    position: 'midfielder',
    secondary_position: 'forward',
    gender: 'Men',
    date_of_birth: '1995-05-15',
    bio: 'E2E test player account for automated testing',
    onboarding_completed: true,
    is_test_account: testAccountFlag,
  },
}

const TEST_CLUB = {
  get email() { return getRequiredEnv('E2E_CLUB_EMAIL') },
  get password() { return getRequiredEnv('E2E_CLUB_PASSWORD') },
  profile: {
    role: 'club',
    full_name: 'E2E Test FC',
    username: 'e2e-test-fc',
    base_location: 'Manchester, UK',
    nationality: 'United Kingdom',
    club_bio: 'E2E test club account for automated testing',
    league_division: 'Division 1',
    contact_email: 'contact@e2e-test-fc.hockia.test',
    year_founded: 2020,
    onboarding_completed: true,
    is_test_account: testAccountFlag,
  },
}

const TEST_COACH = {
  get email() { return getRequiredEnv('E2E_COACH_EMAIL') },
  get password() { return getRequiredEnv('E2E_COACH_PASSWORD') },
  profile: {
    role: 'coach',
    full_name: 'E2E Test Coach',
    username: 'e2e-test-coach',
    base_location: 'Birmingham, UK',
    nationality: 'United Kingdom',
    bio: 'E2E test coach account for automated testing',
    position: 'Head Coach',
    onboarding_completed: true,
    is_test_account: testAccountFlag,
  },
}

const TEST_BRAND = {
  get email() { return getRequiredEnv('E2E_BRAND_EMAIL') },
  get password() { return getRequiredEnv('E2E_BRAND_PASSWORD') },
  profile: {
    role: 'brand',
    full_name: 'E2E Test Brand',
    username: 'e2e-test-brand',
    base_location: 'London, UK',
    bio: 'E2E test brand account for automated testing',
    onboarding_completed: true,
    is_test_account: testAccountFlag,
  },
}

// Storage state file paths
export const PLAYER_STORAGE_STATE = path.join(__dirname, '.auth/player.json')
export const CLUB_STORAGE_STATE = path.join(__dirname, '.auth/club.json')
export const COACH_STORAGE_STATE = path.join(__dirname, '.auth/coach.json')
export const BRAND_STORAGE_STATE = path.join(__dirname, '.auth/brand.json')

// Ensure auth directory exists
const authDir = path.join(__dirname, '.auth')
if (!fs.existsSync(authDir)) {
  fs.mkdirSync(authDir, { recursive: true })
}

// Shared data directory for cross-spec coordination (e.g. seeded vacancy ids)
const dataDir = path.join(__dirname, '.data')
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

function writeJsonFileSafe(filePath: string, data: unknown) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
  } catch (err) {
    console.warn(`[Auth Setup] Failed writing ${filePath}:`, err)
  }
}

/**
 * Authenticate a user via Supabase API and inject session into browser
 */
async function authenticateUser(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
  storagePath: string,
  profileData?: Record<string, unknown>
) {
  // Get Supabase credentials from environment
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Missing Supabase environment variables. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY'
    )
  }

  // Create Supabase client for authentication
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  // Authenticate via API
  console.log(`[Auth Setup] Authenticating ${email}...`)
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error(`[Auth Setup] Failed to authenticate ${email}:`, error.message)
    throw new Error(`Authentication failed for ${email}: ${error.message}`)
  }

  if (!data.session) {
    throw new Error(`No session returned for ${email}`)
  }

  console.log(`[Auth Setup] Successfully authenticated ${email}`)
  console.log(`[Auth Setup] User ID: ${data.user?.id}`)
  console.log(`[Auth Setup] Token expires at: ${data.session.expires_at}`)

  // If profile data is provided, ensure the profile is complete
  if (profileData && data.user) {
    console.log(`[Auth Setup] Ensuring profile is complete for ${email}...`)
    
    // Create authenticated client with the user's session
    const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
        },
      },
    })

    // Check if profile exists
    const { data: existingProfile, error: fetchError } = await authSupabase
      .from('profiles')
      .select('id, onboarding_completed, is_test_account')
      .eq('id', data.user.id)
      .single()

    if (fetchError && fetchError.code !== 'PGRST116') {
      console.warn(`[Auth Setup] Error fetching profile: ${fetchError.message}`)
    }

    // Upsert profile if it doesn't exist or isn't complete
    if (!existingProfile || !existingProfile.onboarding_completed) {
      const { error: upsertError } = await authSupabase
        .from('profiles')
        .upsert({
          id: data.user.id,
          email: data.user.email,
          ...profileData,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'id',
        })

      if (upsertError) {
        console.warn(`[Auth Setup] Error upserting profile: ${upsertError.message}`)
        // Continue anyway - the tests might still work
      } else {
        console.log(`[Auth Setup] Profile completed for ${email}`)
      }
    } else {
      console.log(`[Auth Setup] Profile already complete for ${email}`)

      // Sync is_test_account flag to match the desired state.
      // In staging mode (testAccountFlag=false), flip TO false for email testing.
      // In normal mode (testAccountFlag=true), flip TO true for safety.
      if (existingProfile.is_test_account !== profileData.is_test_account) {
        const { error: flagError } = await authSupabase
          .from('profiles')
          .update({ is_test_account: testAccountFlag, updated_at: new Date().toISOString() })
          .eq('id', data.user.id)

        if (flagError) {
          console.warn(`[Auth Setup] Error setting is_test_account=${testAccountFlag}: ${flagError.message}`)
        } else {
          console.log(`[Auth Setup] Set is_test_account=${testAccountFlag} for ${email}`)
        }
      }
    }

    // Ensure a predictable, open vacancy exists for E2E flows.
    // This allows vacancy-related tests to run deterministically.
    const role = (profileData as { role?: string }).role
    if (role === 'club') {
      const title = 'E2E Vacancy - Automated Test'
      const expectedFields = {
        club_id: data.user.id,
        opportunity_type: 'player' as const,
        title,
        position: 'midfielder',
        gender: 'Men',
        description: 'Automated E2E test vacancy. Safe to ignore.',
        location_city: 'London',
        location_country: 'United Kingdom',
        duration_text: '1 season',
        requirements: ['E2E'],
        benefits: ['housing'],
        priority: 'medium',
        status: 'open',
        published_at: new Date().toISOString(),
      }

      const { data: existingVacancy, error: existingVacancyError } = await authSupabase
        .from('opportunities')
        .select('id, status, title')
        .eq('club_id', data.user.id)
        .eq('title', title)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (existingVacancyError) {
        console.warn(`[Auth Setup] Error checking existing test vacancy: ${existingVacancyError.message}`)
      }

      let vacancyId: string | null = existingVacancy?.id ?? null

      if (!existingVacancy) {
        const { error: vacancyInsertError } = await authSupabase
          .from('opportunities')
          .insert(expectedFields as never)

        if (vacancyInsertError) {
          console.warn(`[Auth Setup] Error inserting test vacancy: ${vacancyInsertError.message}`)
        } else {
          console.log('[Auth Setup] Inserted E2E test vacancy')
        }

        const { data: insertedVacancy } = await authSupabase
          .from('opportunities')
          .select('id')
          .eq('club_id', data.user.id)
          .eq('title', title)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        vacancyId = insertedVacancy?.id ?? null
      } else {
        // Always reset all fields to expected values for deterministic tests
        const { error: vacancyUpdateError } = await authSupabase
          .from('opportunities')
          .update(expectedFields as never)
          .eq('id', existingVacancy.id)

        if (vacancyUpdateError) {
          console.warn(`[Auth Setup] Error updating test vacancy: ${vacancyUpdateError.message}`)
        } else {
          console.log('[Auth Setup] Reset E2E test vacancy to expected state')
        }

        vacancyId = existingVacancy.id
      }

      // Persist for cross-project/spec usage
      writeJsonFileSafe(path.join(dataDir, 'vacancy.json'), {
        id: vacancyId,
        title,
        clubId: data.user.id,
      })
      }
      }

  // Navigate to the app to set up the browser context
  await page.goto('/')

  // Wait for the page to fully load
  await page.waitForLoadState('domcontentloaded')

  // Inject the session into localStorage in the exact format Supabase expects
  // The format must match what @supabase/supabase-js stores internally
  await page.evaluate(
    ({ session, storageKey }) => {
      // Store session in the exact format the Supabase client uses
      const sessionData = {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_at: session.expires_at,
        expires_in: session.expires_in,
        token_type: session.token_type,
        user: session.user,
      }
      localStorage.setItem(storageKey, JSON.stringify(sessionData))
      console.log('[E2E] Session injected into localStorage')
    },
    { session: data.session, storageKey: 'hockia-auth' }
  )

  // Navigate to a protected route to trigger auth initialization
  await page.goto('/dashboard/profile')
  
  // Wait for the app to recognize the authenticated state
  // The page should either show the profile or redirect to onboarding
  try {
    // Wait for signs of authentication - either dashboard content or not being on landing page
    await Promise.race([
      page.waitForSelector('header:has-text("Profile")', { timeout: 15000 }),
      page.waitForSelector('[data-testid="dashboard"]', { timeout: 15000 }),
      page.waitForSelector('nav:has-text("Messages")', { timeout: 15000 }),
      page.waitForSelector('button:has-text("Sign Out")', { timeout: 15000 }),
      page.waitForSelector('a[href*="/dashboard"]', { timeout: 15000 }),
    ])
    console.log('[Auth Setup] Authentication confirmed - found authenticated UI elements')
  } catch {
    // Check current URL - if not on landing, we might be authenticated
    const currentUrl = page.url()
    if (currentUrl.includes('/dashboard') || currentUrl.includes('/onboarding')) {
      console.log(`[Auth Setup] Appears authenticated - on ${currentUrl}`)
    } else {
      // Take a screenshot for debugging
      const screenshotPath = storagePath.replace('.json', '-debug.png')
      await page.screenshot({ path: screenshotPath })
      console.log(`[Auth Setup] Warning: Could not confirm authentication. Screenshot: ${screenshotPath}`)
      console.log(`[Auth Setup] Current URL: ${currentUrl}`)
    }
  }

  // Pre-accept terms gate so E2E tests aren't blocked by it
  await page.evaluate(() => localStorage.setItem('hockia-terms-1.0', 'accepted'))

  // Save the storage state
  await page.context().storageState({ path: storagePath })
  console.log(`[Auth Setup] Saved storage state to ${storagePath}`)
}

/**
 * Setup: Authenticate Player user
 */
setup('@smoke authenticate as player', async ({ page }) => {
  await authenticateUser(page, TEST_PLAYER.email, TEST_PLAYER.password, PLAYER_STORAGE_STATE, TEST_PLAYER.profile)
})

/**
 * Setup: Authenticate Club user  
 */
setup('@smoke authenticate as club', async ({ page }) => {
  await authenticateUser(page, TEST_CLUB.email, TEST_CLUB.password, CLUB_STORAGE_STATE, TEST_CLUB.profile)
})

/**
 * Setup: Authenticate Coach user
 */
setup('@smoke authenticate as coach', async ({ page }) => {
  await authenticateUser(page, TEST_COACH.email, TEST_COACH.password, COACH_STORAGE_STATE, TEST_COACH.profile)
})

/**
 * Setup: Authenticate Brand user
 */
setup('@smoke authenticate as brand', async ({ page }) => {
  await authenticateUser(page, TEST_BRAND.email, TEST_BRAND.password, BRAND_STORAGE_STATE, TEST_BRAND.profile)

  // Ensure a brand entity exists for the E2E test user
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return

  const { data: authData } = await createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  }).auth.signInWithPassword({ email: TEST_BRAND.email, password: TEST_BRAND.password })

  if (!authData?.session) return

  const authSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${authData.session.access_token}` } },
  })

  const brandSlug = 'e2e-test-brand'
  const brandName = 'E2E Test Brand'

  const { data: existingBrand } = await authSupabase
    .from('brands')
    .select('id, slug')
    .eq('profile_id', authData.user.id)
    .maybeSingle()

  const brandFields = {
    profile_id: authData.user.id,
    name: brandName,
    slug: brandSlug,
    category: 'equipment',
    bio: 'E2E automated test brand. Safe to ignore.',
    website_url: 'https://e2e-test-brand.hockia.test',
  }

  if (!existingBrand) {
    const { error: insertError } = await authSupabase
      .from('brands')
      .insert(brandFields)

    if (insertError) {
      console.warn(`[Auth Setup] Error inserting test brand: ${insertError.message}`)
    } else {
      console.log('[Auth Setup] Inserted E2E test brand')
    }
  } else {
    // Reset brand to expected values (name/slug may have drifted)
    const { error: updateError } = await authSupabase
      .from('brands')
      .update({ name: brandName, slug: brandSlug, category: 'equipment' })
      .eq('id', existingBrand.id)

    if (updateError) {
      console.warn(`[Auth Setup] Error resetting test brand: ${updateError.message}`)
    } else {
      console.log(`[Auth Setup] Reset E2E test brand (slug: ${brandSlug})`)
    }
  }

  writeJsonFileSafe(path.join(dataDir, 'brand.json'), {
    slug: existingBrand?.slug ?? brandSlug,
    name: brandName,
    profileId: authData.user.id,
  })
})
