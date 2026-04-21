/**
 * profileFreshness.ts
 *
 * Pure nudge-selection logic for profile freshness. Given a set of
 * "last activity" timestamps per section and the denormalized counts we
 * already have on the profile row, returns a single prioritised nudge
 * (or null) suggesting the owner refresh a section that's gone stale.
 *
 * Kept separate from the data-fetching hook (useProfileFreshness) so the
 * prioritisation + threshold rules can be unit-tested without mounting a
 * dashboard or mocking Supabase.
 *
 * v1 scope (positive tone, owner-only):
 * - Only nudge sections that were *already non-empty* — "add your first
 *   Journey entry" is NextStepCard's job, not this.
 * - Prioritise by days-since-update so the most impactful nudge wins.
 * - No DB writes, no migration. Dismissal with a 7-day cooldown lives in
 *   the component (localStorage), not here.
 */

export type FreshnessNudgeId =
  | 'journey-stale'
  | 'gallery-stale'
  | 'bio-stale'
  | 'posts-stale'
  | 'products-stale'
  | 'media-stale'

/** Which tab/section the CTA should route the user to. */
export type FreshnessAction =
  | { type: 'tab'; tab: string }
  | { type: 'edit-profile' }

export interface FreshnessNudge {
  id: FreshnessNudgeId
  /** Display message shown in the nudge card — positive, encouraging tone. */
  message: string
  ctaLabel: string
  action: FreshnessAction
  /** Days since the section was last updated (used for prioritisation). */
  daysSince: number
}

export interface FreshnessSignals {
  /** ISO timestamp of the latest Journey entry update. Null when the section is empty. */
  lastJourneyAt?: string | null
  /** ISO timestamp of the latest Gallery photo. Null when the section is empty. */
  lastGalleryAt?: string | null
  /**
   * ISO timestamp the owner last edited their bio. In practice this is
   * `profiles.updated_at` (it flips on any edit), which is coarse but good
   * enough for a 180-day refresh nudge.
   */
  lastBioAt?: string | null
  /** ISO timestamp of the latest owner post. Null when the section is empty. */
  lastPostAt?: string | null
  /** ISO timestamp of the latest Brand product update. Null when the section is empty. */
  lastProductAt?: string | null
  /** ISO timestamp of the latest Club media upload. Null when the section is empty. */
  lastMediaAt?: string | null
}

/** Days-since thresholds. Only nudge when the section is older than its threshold. */
export const FRESHNESS_THRESHOLDS: Record<FreshnessNudgeId, number> = {
  'journey-stale': 30,
  'gallery-stale': 45,
  'bio-stale': 180,
  'posts-stale': 14,
  'products-stale': 30,
  'media-stale': 45,
}

/** Role-specific ordering — only these nudge ids are considered for each role. */
const NUDGES_BY_ROLE: Record<'player' | 'coach' | 'club' | 'brand' | 'umpire', FreshnessNudgeId[]> = {
  player: ['journey-stale', 'gallery-stale'],
  coach: ['journey-stale', 'gallery-stale', 'bio-stale'],
  club: ['media-stale', 'journey-stale'],
  brand: ['posts-stale', 'products-stale'],
  // Umpires don't have Journey or Gallery in Phase B — the only meaningful
  // freshness signal is a stale bio. Expand once Officiating Journey ships.
  umpire: ['bio-stale'],
}

function daysBetween(fromIso: string, nowMs: number): number {
  const then = Date.parse(fromIso)
  if (Number.isNaN(then)) return 0
  return Math.floor((nowMs - then) / (1000 * 60 * 60 * 24))
}

function buildNudge(
  id: FreshnessNudgeId,
  daysSince: number
): FreshnessNudge {
  const weeks = Math.round(daysSince / 7)
  const period = weeks < 2
    ? `${daysSince} days`
    : weeks < 8
      ? `${weeks} weeks`
      : `${Math.round(daysSince / 30)} months`

  switch (id) {
    case 'journey-stale':
      return {
        id,
        message: `Your last Journey update was ${period} ago — add a recent moment to keep clubs current.`,
        ctaLabel: 'Update Journey',
        action: { type: 'tab', tab: 'journey' },
        daysSince,
      }
    case 'gallery-stale':
      return {
        id,
        message: `Your Gallery hasn't been updated in ${period} — a fresh photo or clip shows you're active.`,
        ctaLabel: 'Add to Gallery',
        action: { type: 'tab', tab: 'profile' },
        daysSince,
      }
    case 'bio-stale':
      return {
        id,
        message: `Your bio is ${period} old — a refresh helps clubs see where you're at now.`,
        ctaLabel: 'Edit bio',
        action: { type: 'edit-profile' },
        daysSince,
      }
    case 'posts-stale':
      return {
        id,
        message: `Your last post was ${period} ago — a fresh update keeps followers engaged.`,
        ctaLabel: 'New post',
        action: { type: 'tab', tab: 'posts' },
        daysSince,
      }
    case 'products-stale':
      return {
        id,
        message: `Your products haven't been updated in ${period} — refresh stock or add a new item.`,
        ctaLabel: 'Manage products',
        action: { type: 'tab', tab: 'products' },
        daysSince,
      }
    case 'media-stale':
      return {
        id,
        message: `Club media hasn't been updated in ${period} — fresh photos show the club is active.`,
        ctaLabel: 'Add media',
        action: { type: 'tab', tab: 'overview' },
        daysSince,
      }
  }
}

/**
 * Pick the single highest-priority freshness nudge for a role, or null when
 * every eligible section is fresh or was never filled — empty sections belong
 * to NextStepCard, not here. A null `last*At` signal is the proof-of-empty;
 * the fetch layer returns null when the underlying query has no rows.
 *
 * Priority rule: among sections over their staleness threshold, return the
 * one with the highest `daysSince`. Ties broken by the role-specific
 * declaration order in NUDGES_BY_ROLE.
 */
export function pickFreshnessNudge(
  role: 'player' | 'coach' | 'club' | 'brand' | 'umpire',
  signals: FreshnessSignals,
  now: Date = new Date()
): FreshnessNudge | null {
  const nowMs = now.getTime()
  const candidates: FreshnessNudge[] = []

  const considered = NUDGES_BY_ROLE[role] ?? []

  const signalByNudge: Record<FreshnessNudgeId, string | null | undefined> = {
    'journey-stale': signals.lastJourneyAt,
    'gallery-stale': signals.lastGalleryAt,
    'bio-stale': signals.lastBioAt,
    'posts-stale': signals.lastPostAt,
    'products-stale': signals.lastProductAt,
    'media-stale': signals.lastMediaAt,
  }

  for (const id of considered) {
    const iso = signalByNudge[id]
    if (!iso) continue
    const days = daysBetween(iso, nowMs)
    if (days >= FRESHNESS_THRESHOLDS[id]) candidates.push(buildNudge(id, days))
  }

  if (candidates.length === 0) return null
  return candidates.reduce((best, c) => (c.daysSince > best.daysSince ? c : best))
}
