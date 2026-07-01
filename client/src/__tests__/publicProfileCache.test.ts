/**
 * Locks the public-profile cache contract. The pages READ via
 * publicProfileCacheKey(...) + requestCache.peek/dedupe, and the auth store BUSTS via
 * invalidatePublicProfileCache(...) on edit. If the key format drifts between those
 * two, "stale after edit" silently returns — so pin the format AND the invalidation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { requestCache } from '@/lib/requestCache'
import {
  PUBLIC_PROFILE_TTL,
  publicProfileCacheKey,
  invalidatePublicProfileCache,
  safeSeedPublicProfile,
  rememberBlockedPair,
  invalidateBlockedPair,
} from '@/lib/publicProfileCache'

// NB: deliberately NOT importing '@/lib/auth' here — it transitively imports
// '@/lib/supabase', which throws at module-init when the Supabase env vars are
// absent (CI's unit-test job has none). The setProfile→invalidatePublicProfileCache
// wiring is covered by the invalidate test below + the adversarial verification;
// a real-auth integration test isn't worth pulling supabase into this unit suite.

describe('publicProfileCache', () => {
  beforeEach(() => {
    requestCache.clear()
  })

  it('builds keys: username preferred, then id, else null', () => {
    expect(publicProfileCacheKey('public-profile', { username: 'val', id: 'x' })).toBe('public-profile-uname-val')
    expect(publicProfileCacheKey('public-profile', { id: 'x' })).toBe('public-profile-id-x')
    expect(publicProfileCacheKey('public-club', { username: 'club1' })).toBe('public-club-uname-club1')
    expect(publicProfileCacheKey('public-umpire', { id: 'u1' })).toBe('public-umpire-id-u1')
    expect(publicProfileCacheKey('public-profile', {})).toBeNull()
  })

  it('invalidate busts BOTH the id and username keys for an edited profile', async () => {
    const idKey = publicProfileCacheKey('public-profile', { id: 'p1' })!
    const unameKey = publicProfileCacheKey('public-profile', { username: 'pedro' })!

    // Seed both keys (the same profile reached via /id and via /username).
    await requestCache.dedupe(idKey, async () => ({ id: 'p1' }), PUBLIC_PROFILE_TTL)
    await requestCache.dedupe(unameKey, async () => ({ id: 'p1' }), PUBLIC_PROFILE_TTL)
    expect(requestCache.peek(idKey, PUBLIC_PROFILE_TTL)).toBeDefined()
    expect(requestCache.peek(unameKey, PUBLIC_PROFILE_TTL)).toBeDefined()

    // Owner edits → auth store calls this. Both keys must clear so the next visit refetches.
    invalidatePublicProfileCache({ id: 'p1', username: 'pedro' })

    expect(requestCache.peek(idKey, PUBLIC_PROFILE_TTL)).toBeUndefined()
    expect(requestCache.peek(unameKey, PUBLIC_PROFILE_TTL)).toBeUndefined()
  })

  it('invalidate is a safe no-op for the prefixes a profile does not use', () => {
    // A player has no public-club / public-umpire entry; invalidating must not throw.
    expect(() => invalidatePublicProfileCache({ id: 'p1', username: 'pedro' })).not.toThrow()
    expect(() => invalidatePublicProfileCache({})).not.toThrow()
  })
})

describe('safeSeedPublicProfile — block/test gating of the cache seed (privacy)', () => {
  const key = publicProfileCacheKey('public-profile', { id: 'target-1' })!
  const seed = (isTest = false) =>
    requestCache.dedupe(key, async () => ({ id: 'target-1', is_test_account: isTest }), PUBLIC_PROFILE_TTL)

  beforeEach(() => {
    requestCache.clear()
  })

  it('returns null when nothing is cached', () => {
    expect(safeSeedPublicProfile(key, { viewerId: 'v1' })).toBeNull()
  })

  it('anonymous viewer: seeds a cached non-test row (no block pair possible)', async () => {
    await seed()
    expect(safeSeedPublicProfile(key, {})).not.toBeNull()
  })

  it('logged-in viewer: does NOT seed until a not-blocked result is recorded', async () => {
    await seed()
    expect(safeSeedPublicProfile(key, { viewerId: 'v1' })).toBeNull() // block status unknown
    rememberBlockedPair('v1', 'target-1', false)
    expect(safeSeedPublicProfile(key, { viewerId: 'v1' })).not.toBeNull() // confirmed not blocked
  })

  it('logged-in viewer: NEVER seeds a blocked row (the regression this fixes)', async () => {
    await seed()
    rememberBlockedPair('v1', 'target-1', true)
    expect(safeSeedPublicProfile(key, { viewerId: 'v1' })).toBeNull()
    invalidateBlockedPair('v1', 'target-1') // back to unknown → still refuses to seed
    expect(safeSeedPublicProfile(key, { viewerId: 'v1' })).toBeNull()
  })

  it('never seeds a hidden test-account row to a non-test viewer (staging/test viewer may)', async () => {
    await seed(true)
    rememberBlockedPair('v1', 'target-1', false)
    expect(safeSeedPublicProfile(key, { viewerId: 'v1', viewerIsTest: false })).toBeNull()
    expect(safeSeedPublicProfile(key, { viewerId: 'v1', viewerIsTest: true })).not.toBeNull()
    expect(safeSeedPublicProfile(key, { viewerId: 'v1', isStaging: true })).not.toBeNull()
  })
})
