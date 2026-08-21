/**
 * The localStorage key supabase-js persists the session under (configured in
 * lib/supabase.ts `auth.storageKey`).
 *
 * Lives in its own module so code that only needs the KEY — e.g.
 * lib/persistedSession's synchronous first-frame check, and tests — can
 * import it without pulling in lib/supabase, whose module throws at import
 * time when the VITE_SUPABASE_* env vars are absent (the CI unit job runs
 * with none).
 */
export const AUTH_STORAGE_KEY = 'hockia-auth'
