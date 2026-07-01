import { requestCache } from './requestCache'

/**
 * Shared cache contract for the logged-out / visitor PUBLIC profile pages
 * (PublicPlayerProfile, PublicClubProfile, PublicUmpireProfile).
 *
 * Single source of truth for the key format + TTL so the pages (which READ via
 * requestCache.peek/dedupe) and the auth store (which BUSTS on profile edit) can
 * never drift apart — a mismatch would silently bring back the "stale after edit"
 * bug this module exists to prevent.
 */

/**
 * TTL (ms) for cached public-profile rows. BOTH peek() and dedupe() must pass this:
 * requestCache.peek()'s own default is 30s, so omitting it silently shrinks the
 * window and makes the cache appear to miss while dedupe still hits.
 */
export const PUBLIC_PROFILE_TTL = 120_000

export type PublicProfilePrefix = 'public-profile' | 'public-club' | 'public-umpire'

const PREFIXES: readonly PublicProfilePrefix[] = ['public-profile', 'public-club', 'public-umpire']

const unameKey = (prefix: PublicProfilePrefix, username: string) => `${prefix}-uname-${username}`
const idKey = (prefix: PublicProfilePrefix, id: string) => `${prefix}-id-${id}`

/**
 * Cache key for a public profile row — prefer the username route, else the id route
 * (mirrors how each public page is actually reached). Returns null when neither is
 * present (an invalid URL), which the pages treat as "no cache".
 */
export function publicProfileCacheKey(
  prefix: PublicProfilePrefix,
  params: { username?: string | null; id?: string | null },
): string | null {
  if (params.username) return unameKey(prefix, params.username)
  if (params.id) return idKey(prefix, params.id)
  return null
}

/**
 * Bust every cached public-profile entry for a person — BOTH the username- and
 * id-keyed variants, across all role prefixes — so an owner's edit shows on their
 * own session immediately instead of waiting out the TTL. (Other devices remain
 * TTL-bounded; a client cache can't reach across browsers.) Unused prefixes for the
 * person's role are harmless no-ops.
 */
export function invalidatePublicProfileCache(params: { id?: string | null; username?: string | null }) {
  for (const prefix of PREFIXES) {
    if (params.id) requestCache.invalidate(idKey(prefix, params.id))
    if (params.username) requestCache.invalidate(unameKey(prefix, params.username))
  }
}

// ── Per-viewer block-pair cache ────────────────────────────────────────────────
// The public profile row is viewer-independent, but whether a given viewer may SEE
// it is not (block / test-account gating). Seeding the cached row on first paint
// (the perf win) must NOT render a blocked or hidden profile. The test gate is
// synchronous (both inputs are known), but the block gate is an async is_blocked_pair
// RPC. So we cache the block RESULT per (viewer,target) pair and only seed the cached
// profile when a recent check said NOT blocked — otherwise we fall through to the
// async check (a brief spinner) instead of flashing a blocked profile.
const blockPairKey = (viewerId: string, targetId: string) => `block-pair-${viewerId}-${targetId}`

/** Cached block result for a pair: false = not blocked, true = blocked, undefined = unknown. */
export function peekBlockedPair(viewerId: string, targetId: string): boolean | undefined {
  return requestCache.peek<boolean>(blockPairKey(viewerId, targetId), PUBLIC_PROFILE_TTL)
}

/** Remember an is_blocked_pair result so the next visit can gate the seed synchronously
 *  (overwrites — the block status can flip). */
export function rememberBlockedPair(viewerId: string, targetId: string, blocked: boolean): void {
  requestCache.set(blockPairKey(viewerId, targetId), blocked)
}

/** Drop the cached block result for a pair (call on block/unblock so it re-checks). */
export function invalidateBlockedPair(viewerId: string, targetId: string): void {
  requestCache.invalidate(blockPairKey(viewerId, targetId))
}

/**
 * Return the cached public-profile row ONLY if it is safe to paint from cache for
 * this viewer — i.e. the test-account gate passes AND (for a logged-in viewer) a
 * recent is_blocked_pair check confirmed the pair is NOT blocked. Returns null when
 * there's no cache, the row is a hidden test account, or the block status is
 * blocked/unknown — in which case the caller must show a loader and run the async
 * gate before rendering. Anonymous viewers can't be in a block pair, so only the
 * test gate applies to them.
 */
export function safeSeedPublicProfile<T extends { id: string; is_test_account?: boolean | null }>(
  cacheKey: string | null,
  gate: { viewerId?: string | null; viewerIsTest?: boolean; isStaging?: boolean },
): T | null {
  if (!cacheKey) return null
  const cached = requestCache.peek<T>(cacheKey, PUBLIC_PROFILE_TTL)
  if (!cached) return null
  if (cached.is_test_account && !gate.viewerIsTest && !gate.isStaging) return null
  if (gate.viewerId && peekBlockedPair(gate.viewerId, cached.id) !== false) return null
  return cached
}
