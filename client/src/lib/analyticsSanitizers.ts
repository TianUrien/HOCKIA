/**
 * Analytics sanitizers — strip PII before any payload reaches GA4.
 *
 * QA agent flagged three GA4-standard params leaking identifiers on
 * every hit (pre-existing, pre-AI-Opinion):
 *   - `uid` carried the raw recruiter profile UUID
 *   - `dl` (document_location) carried player UUIDs from URLs like
 *     `/players/id/<uuid>`
 *   - `dt` (document_title) carried profile names from titles like
 *     "Valentina Turienzo — Player | HOCKIA"
 *
 * Per the analytics design intent ("viewer_role should be the only
 * profile attribute GA sees"), this module is the boundary that
 * scrubs identifiers before they cross into GA's data stream. Used
 * exclusively by `lib/analytics.ts`.
 */

// UUID v4-shaped pattern. Covers the 36-char hyphenated form which
// is what Supabase + most of our routes use. Case-insensitive because
// some old URLs upper-case the hex.
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi

/**
 * Replace UUID-shaped segments in a path with `:id` so GA receives
 * the route pattern without identifiers. Preserves query string
 * structure but scrubs UUIDs inside query values too.
 *
 * Examples:
 *   /players/id/9a34cbdf-10f9-48f5-89d6-fc071db95c60 → /players/id/:id
 *   /admin/users/<uuid>?return=/coaches/id/<uuid>    → /admin/users/:id?return=/coaches/id/:id
 *   /home                                            → /home (unchanged)
 */
export function sanitizePath(path: string): string {
  if (!path) return path
  const [pathOnly, query] = path.split('?')
  // Reset global flag state by using fresh RegExp each call (the
  // .replace path doesn't carry state, but being explicit avoids
  // surprises if someone refactors to .exec later).
  const cleanPath = pathOnly.replace(UUID_PATTERN, ':id')
  if (!query) return cleanPath
  const cleanQuery = query.replace(UUID_PATTERN, ':id')
  return `${cleanPath}?${cleanQuery}`
}

// Routes where document.title pattern includes identifying info
// (typically `<entity name> — <role> | HOCKIA`). For these, we
// override with a generic title regardless of what document.title
// actually contains. New identifying routes should be added here.
const IDENTIFYING_ROUTES: Array<[RegExp, string]> = [
  [/^\/players\/id\/:id/, 'Player profile'],
  [/^\/coaches\/id\/:id/, 'Coach profile'],
  [/^\/clubs\/id\/:id/, 'Club profile'],
  [/^\/umpires\/id\/:id/, 'Umpire profile'],
  [/^\/brands\/[^/?]+/, 'Brand profile'],
  [/^\/opportunities\/:id/, 'Opportunity detail'],
  [/^\/admin\/users\/:id/, 'Admin user detail'],
  [/^\/admin\/opportunities\/:id/, 'Admin opportunity detail'],
  [/^\/conversations\/:id/, 'Conversation'],
]

/**
 * Pick a safe page_title for analytics. For identifying routes,
 * return a generic label like "Player profile | HOCKIA" regardless
 * of the actual document.title. For other routes, fall back to the
 * caller-provided title (typically document.title — trusted only on
 * non-identifying routes).
 */
export function pathToSafeTitle(sanitizedPath: string, fallback: string): string {
  for (const [pattern, title] of IDENTIFYING_ROUTES) {
    if (pattern.test(sanitizedPath)) {
      return `${title} | HOCKIA`
    }
  }
  return fallback
}

/**
 * One-way hash for the GA4 `user_id` param. Preserves cross-device
 * tracking (same input → same hash) while removing the ability for
 * GA or anyone with GA access to correlate the value with a real
 * Supabase profile UUID.
 *
 * 16-char prefix of SHA-256 — 64 bits of entropy is more than enough
 * to keep collisions astronomically unlikely across our user base.
 * Namespaced with a literal prefix so even if someone exfiltrated
 * GA data they can't rainbow-table HOCKIA's hashes against a
 * generic UUID hash table.
 */
export async function hashUserId(userId: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(`hockia-analytics:${userId}`)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
