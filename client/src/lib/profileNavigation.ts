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
 * Brand id links go through `/brands/id/:id` (BrandIdRedirect), which
 * resolves the profile id to the brand's slug page. Never build
 * `/brands/${uuid}` — that hits the `:slug` route and a uuid never
 * matches a slug ("brand not found").
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
      return `/brands/id/${id}`
    default:
      return null
  }
}

/**
 * The owner's "edit my profile" deep link. Lands on the role-dispatched owner
 * dashboard (/dashboard/profile — DashboardRouter picks the right dashboard)
 * and opens EditProfileModal via the `?action=edit` handler each dashboard
 * installs. Role-agnostic on purpose: the editor lives on the dashboard, NOT
 * on the public /players/:username profile (which is read-only and ignored the
 * param entirely — the bug this replaced).
 */
export const OWN_PROFILE_EDIT_PATH = '/dashboard/profile?action=edit'
