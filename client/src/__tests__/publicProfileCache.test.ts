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
} from '@/lib/publicProfileCache'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'

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

  it('setProfile busts the public cache — covers setProfile-only quick edits (Availability/ClubLink)', async () => {
    // The one-tap toggles update a PUBLIC column then call setProfile() WITHOUT a
    // force-refresh, so the bust has to live in the store action itself.
    const idKey = publicProfileCacheKey('public-profile', { id: 'me-id' })!
    const unameKey = publicProfileCacheKey('public-profile', { username: 'me-name' })!
    await requestCache.dedupe(idKey, async () => ({ open_to_play: false }), PUBLIC_PROFILE_TTL)
    await requestCache.dedupe(unameKey, async () => ({ open_to_play: false }), PUBLIC_PROFILE_TTL)
    expect(requestCache.peek(idKey, PUBLIC_PROFILE_TTL)).toBeDefined()

    useAuthStore.getState().setProfile({ id: 'me-id', username: 'me-name' } as unknown as Profile)

    expect(requestCache.peek(idKey, PUBLIC_PROFILE_TTL)).toBeUndefined()
    expect(requestCache.peek(unameKey, PUBLIC_PROFILE_TTL)).toBeUndefined()

    useAuthStore.getState().setProfile(null) // reset store for other tests
  })
})
