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
