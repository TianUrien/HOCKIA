import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Tests for the auth storage key migration from 'playr-auth' → 'hockia-auth'.
 *
 * The migration logic in lib/supabase.ts runs at module load time:
 * 1. If 'playr-auth' exists and 'hockia-auth' does NOT → copy to 'hockia-auth'
 * 2. If 'playr-auth' exists and 'hockia-auth' already exists → keep 'hockia-auth'
 * 3. Always remove 'playr-auth' if it exists
 *
 * We test the migration logic directly (extracted) rather than relying on module
 * side-effects, since re-importing a module in vitest doesn't re-execute top-level code.
 */

const LEGACY_KEY = 'playr-auth'
const NEW_KEY = 'hockia-auth'

/** Extracted migration logic — mirrors lib/supabase.ts lines 22-31 */
function runMigration() {
  const legacy = window.localStorage.getItem(LEGACY_KEY)
  if (legacy && !window.localStorage.getItem(NEW_KEY)) {
    window.localStorage.setItem(NEW_KEY, legacy)
  }
  if (legacy) {
    window.localStorage.removeItem(LEGACY_KEY)
  }
}

describe('Auth storage key migration (playr-auth → hockia-auth)', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('migrates legacy key to new key when new key does not exist', () => {
    const sessionData = JSON.stringify({ access_token: 'test-token', user: { id: '123' } })
    localStorage.setItem(LEGACY_KEY, sessionData)

    runMigration()

    expect(localStorage.getItem(NEW_KEY)).toBe(sessionData)
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('does not overwrite existing new key with legacy data', () => {
    const legacyData = JSON.stringify({ access_token: 'old-token' })
    const newData = JSON.stringify({ access_token: 'current-token' })
    localStorage.setItem(LEGACY_KEY, legacyData)
    localStorage.setItem(NEW_KEY, newData)

    runMigration()

    // New key should keep its original value
    expect(localStorage.getItem(NEW_KEY)).toBe(newData)
    // Legacy key should be removed
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('removes legacy key even when new key already exists', () => {
    localStorage.setItem(LEGACY_KEY, 'stale-data')
    localStorage.setItem(NEW_KEY, 'current-data')

    runMigration()

    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('does nothing when no legacy key exists', () => {
    const newData = JSON.stringify({ access_token: 'token' })
    localStorage.setItem(NEW_KEY, newData)

    runMigration()

    expect(localStorage.getItem(NEW_KEY)).toBe(newData)
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })

  it('does nothing when neither key exists', () => {
    runMigration()

    expect(localStorage.getItem(NEW_KEY)).toBeNull()
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull()
  })
})
