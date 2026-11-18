import { tCommunity } from '@/i18n/ns/community'

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

// Each role's pool is five prompts in the community catalog
// (composer.<role>.p1…p5). Text is read when a placeholder is picked, never
// at module load, so it follows the interface language.
//
// Player prompts: matches, training, opportunities. Coach: methodology and
// insights. Club: results and staff. Brand: launches and athletes.
// Umpires: per NASO / TASO / Referee Magazine guidance, officials should
// NOT post specifics about matches, calls, players, coaches, or other
// officials. Steer toward credentials, courses, and federation content.
const PROMPT_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const

const ROLES: readonly ComposerRole[] = ['player', 'coach', 'club', 'brand', 'umpire']

/**
 * Pick a placeholder for the given role, optionally seeded with a value
 * the caller can roll on each modal open. Falls back to "What's on your
 * mind?" for unknown roles or empty pools.
 */
export function pickPlaceholder(
  role: ComposerRole | null | undefined,
  seed: number = Math.random(),
): string {
  if (!role || !ROLES.includes(role)) return tCommunity('composer.fallback')
  const idx = Math.floor(seed * PROMPT_IDS.length) % PROMPT_IDS.length
  return tCommunity(`composer.${role}.${PROMPT_IDS[idx]}`)
}
