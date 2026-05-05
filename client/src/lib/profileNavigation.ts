/**
 * Shared profile-URL builders for the role-aware deep links.
 *
 * Why this lives separately from each card: usernames are nullable on
 * profiles, and the rest of the app uses an `/<role>/id/<uuid>` fallback
 * route for that case (see App.tsx routes `/players/id/:id`,
 * `/coaches/id/:id`, `/umpires/id/:id`). Earlier Pulse-card builders
 * checked username only and silently no-op'd the CTA when username was
 * null — which is the default state for every account today (no
 * onboarding step ever sets it). This helper unifies the builder so all
 * Pulse cards (and any future deep-link consumers) get the id fallback
 * for free.
 */

type RoleLike = string | null | undefined

/**
 * Returns the path to view a profile by its role + id (uuid).
 *
 * Brand has no `/brands/id/:id` route today (brands are slug-only); when
 * the caller is brand we return `/brands/${id}` as a best-effort that
 * will resolve via slug-or-id lookup if the slug router supports it,
 * otherwise null.
 */
export function profilePath(
  role: RoleLike,
  username: string | null | undefined,
  id: string | null | undefined,
): string | null {
  // Prefer username when available — friendlier URLs.
  if (username && username.trim().length > 0) {
    switch (role) {
      case 'player':
        return `/players/${username}`
      case 'coach':
        return `/coaches/${username}`
      case 'club':
        return `/clubs/${username}`
      case 'umpire':
        return `/umpires/${username}`
      case 'brand':
        return `/brands/${username}`
      default:
        return null
    }
  }

  if (!id) return null

  // Fallback to /<role>/id/<uuid>. Routes exist for player, coach,
  // umpire — same pattern the rest of the app uses (MemberCard,
  // DiscoverResultCard, ProfileViewersSection, NotificationsDrawer).
  switch (role) {
    case 'player':
      return `/players/id/${id}`
    case 'coach':
      return `/coaches/id/${id}`
    case 'umpire':
      return `/umpires/id/${id}`
    case 'club':
      return `/clubs/id/${id}`
    case 'brand':
      // Brand has no id route; falling back to the slug pattern returns
      // null so callers can skip navigation rather than 404.
      return null
    default:
      return null
  }
}

/**
 * Convenience for the "open my own edit flow" deep link. Adds
 * `?action=edit` to the profile path. Same null-fallback semantics.
 */
export function ownProfileEditPath(
  role: RoleLike,
  username: string | null | undefined,
  id: string | null | undefined,
): string | null {
  const base = profilePath(role, username, id)
  return base ? `${base}?action=edit` : null
}
