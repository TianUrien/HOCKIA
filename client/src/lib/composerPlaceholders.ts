/**
 * Composer placeholder rotation
 *
 * Replaces the static "What's on your mind?" textarea placeholder with a
 * per-role pool of prompts that cycle on each modal open. Research-backed
 * (NN/g, blank-page studies): templated/prompted starts convert ~78% vs
 * ~60% drop-off on a fully blank input. The cheapest unlock in Phase 0.
 *
 * Scope (intentional v1):
 *   - Pure rotation per role. No state-aware prompting yet (that comes in
 *     Phase 2 alongside the triggered post-draft modal — when we know the
 *     user just got verified / changed clubs / hit a tier, we'll prompt
 *     specifically). Today, just rotate.
 *   - Only applies to the default 'post' mode. 'transfer' / signing
 *     placeholders are intentionally specific and stay fixed.
 *   - Per-role copy reflects what each role actually publishes per the
 *     role-by-role analysis (Players: matches/training/opps; Coaches:
 *     methodology/insights; Clubs: results/staff; Umpires: credentials,
 *     never match specifics — per officials' professional norms).
 */

export type ComposerRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

const PLAYER_PROMPTS: string[] = [
  "What's on your mind?",
  'Just played a match? Share a moment from it.',
  'Working on something specific in training?',
  'Looking for opportunities? Tell people what you’re after.',
  'Got an update worth sharing with the hockey community?',
]

const COACH_PROMPTS: string[] = [
  "What's on your mind?",
  'Share something you’re working on with your team.',
  'A coaching insight worth passing on to peers?',
  'Just earned a certification or completed a course? Tell people.',
  'Reflections from the latest session?',
]

const CLUB_PROMPTS: string[] = [
  "What's new at your club?",
  'Tell people about a recent match.',
  'Welcoming someone new — player, coach, staff, sponsor?',
  'A moment from training worth sharing?',
  'Anything coming up your members should know about?',
]

const BRAND_PROMPTS: string[] = [
  "What's new with your brand?",
  'Launching a product? Tell the community.',
  'Behind the scenes worth sharing — design, factory, team?',
  'Welcome a new ambassador or partner.',
  'Spotlight an athlete you support.',
]

// Umpires: per NASO / TASO / Referee Magazine guidance, officials should
// NOT post specifics about matches, calls, players, coaches, or other
// officials. Steer toward credentials, courses, and federation content.
const UMPIRE_PROMPTS: string[] = [
  'Share a course you completed, a federation update, or your year in numbers...',
  'Just completed a course or clinic? Tell your peers.',
  'Federation update worth passing on?',
  'Reflecting on your season — in aggregate, not specifics?',
  'New panel or credential? Share the milestone.',
]

const ROLE_PROMPTS: Record<ComposerRole, string[]> = {
  player: PLAYER_PROMPTS,
  coach: COACH_PROMPTS,
  club: CLUB_PROMPTS,
  brand: BRAND_PROMPTS,
  umpire: UMPIRE_PROMPTS,
}

/**
 * Pick a placeholder for the given role, optionally seeded with a value
 * the caller can roll on each modal open. Falls back to "What's on your
 * mind?" for unknown roles or empty pools.
 */
export function pickPlaceholder(
  role: ComposerRole | null | undefined,
  seed: number = Math.random(),
): string {
  if (!role) return "What's on your mind?"
  const pool = ROLE_PROMPTS[role]
  if (!pool || pool.length === 0) return "What's on your mind?"
  const idx = Math.floor(seed * pool.length) % pool.length
  return pool[idx]
}
