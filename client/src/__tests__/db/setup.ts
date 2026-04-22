/**
 * Shared test helpers for database integration tests.
 *
 * Provides authenticated Supabase clients for each test role so tests can
 * verify RLS policies, triggers, and state transitions from different
 * perspectives.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const supabaseUrl =
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || ''
const supabaseAnonKey =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name}`)
  return v
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export interface AuthenticatedClient {
  client: SupabaseClient
  userId: string
  email: string
}

/**
 * Sign in with email/password and return a Supabase client that carries the
 * resulting JWT so all subsequent queries respect RLS as that user.
 */
export async function authenticateAs(
  email: string,
  password: string
): Promise<AuthenticatedClient> {
  // Initial client just for auth
  const tmp = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await tmp.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Auth failed (${email}): ${error.message}`)
  if (!data.session || !data.user) throw new Error(`No session (${email})`)

  // Authenticated client
  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    },
  })

  return { client, userId: data.user.id, email }
}

// ---------------------------------------------------------------------------
// Convenience: role-specific auth
// ---------------------------------------------------------------------------

export function authenticatePlayer() {
  return authenticateAs(
    requireEnv('E2E_PLAYER_EMAIL'),
    requireEnv('E2E_PLAYER_PASSWORD')
  )
}

export function authenticateClub() {
  return authenticateAs(
    requireEnv('E2E_CLUB_EMAIL'),
    requireEnv('E2E_CLUB_PASSWORD')
  )
}

export function authenticateCoach() {
  return authenticateAs(
    requireEnv('E2E_COACH_EMAIL'),
    requireEnv('E2E_COACH_PASSWORD')
  )
}

export function authenticateBrand() {
  return authenticateAs(
    requireEnv('E2E_BRAND_EMAIL'),
    requireEnv('E2E_BRAND_PASSWORD')
  )
}

export function authenticateUmpire() {
  return authenticateAs(
    requireEnv('E2E_UMPIRE_EMAIL'),
    requireEnv('E2E_UMPIRE_PASSWORD')
  )
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Unique marker per test run to isolate test data. */
export function marker() {
  return `__dbtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Returns true when all required env vars are present (used to skip). */
export function hasRequiredEnv(): boolean {
  return !!(
    supabaseUrl &&
    supabaseAnonKey &&
    process.env.E2E_PLAYER_EMAIL &&
    process.env.E2E_PLAYER_PASSWORD &&
    process.env.E2E_CLUB_EMAIL &&
    process.env.E2E_CLUB_PASSWORD &&
    process.env.E2E_COACH_EMAIL &&
    process.env.E2E_COACH_PASSWORD &&
    process.env.E2E_BRAND_EMAIL &&
    process.env.E2E_BRAND_PASSWORD &&
    process.env.E2E_UMPIRE_EMAIL &&
    process.env.E2E_UMPIRE_PASSWORD
  )
}
