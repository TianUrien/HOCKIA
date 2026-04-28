/**
 * Phase 1A — Quality Reset, deterministic suggested-action catalog.
 *
 * Pure functions (no Deno globals, no fetch). Source of truth for every
 * action chip the assistant ever emits. Called from `nl-search/index.ts`
 * at the end of each return path. All chips are deterministic by design;
 * LLM-generated chips are explicitly out of scope until Package B.
 *
 * Adding a new chip = edit one of these functions. Adding a new role or
 * entity = same. The unit tests pin the catalog so unintended drift
 * surfaces immediately.
 */

// ── Response envelope shapes (shared with index.ts) ────────────────────

export type ResponseKind =
  | 'text'                  // generic chat reply — knowledge / greeting / self-advice
  | 'results'               // search returned matches
  | 'no_results'            // search ran, returned zero
  | 'soft_error'            // transient failure — calm UI, recoverable
  | 'clarifying_question'   // medium-confidence intent, ask user to disambiguate
  | 'canned_redirect'       // opportunity / product redirects (Phase 0)

export interface AppliedSearch {
  entity: 'clubs' | 'players' | 'coaches' | 'brands' | 'umpires' | null
  gender_label: string | null    // "Women" / "Men"
  location_label: string | null  // "Spain" / "Madrid"
  age?: { min?: number; max?: number }
  /** Human-readable summary the UI can drop straight into a sentence. */
  role_summary: string
}

export type SuggestedActionIntent =
  | { type: 'free_text'; query: string }
  | { type: 'retry' }
  | { type: 'clear' }

export interface SuggestedAction {
  label: string
  intent: SuggestedActionIntent
}

export interface ClarifyingOption {
  label: string
  routed_query: string
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Build a human-readable summary like "women's clubs in Spain" or "U21 defenders". */
export function buildRoleSummary(applied: Pick<AppliedSearch, 'entity' | 'gender_label' | 'location_label' | 'age'> | null): string {
  if (!applied?.entity) return 'profiles'
  const parts: string[] = []
  if (applied.gender_label === 'Women') parts.push("women's")
  else if (applied.gender_label === 'Men') parts.push("men's")
  if (applied.age?.max != null) parts.push(`U${applied.age.max + 1}`)
  parts.push(applied.entity)
  if (applied.location_label) parts.push(`in ${applied.location_label}`)
  return parts.join(' ')
}

/** Cross-entity suggestion based on (what they searched FOR × what they ARE). */
function crossEntityChip(entity: string | null | undefined, userRole: string | null): SuggestedAction | null {
  if (entity === 'clubs' && (userRole === 'player' || userRole === 'coach')) {
    return { label: 'Find opportunities', intent: { type: 'free_text', query: 'Find opportunities for my position' } }
  }
  if (entity === 'players' && userRole === 'club') {
    return { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches with head-coach experience' } }
  }
  if (entity === 'coaches' && (userRole === 'player' || userRole === 'club')) {
    return { label: 'Find clubs', intent: { type: 'free_text', query: 'Find clubs hiring' } }
  }
  if (entity === 'players' && userRole === 'brand') {
    return { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Show me products' } }
  }
  if (entity === 'brands' && (userRole === 'player' || userRole === 'coach' || userRole === 'club')) {
    return { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Show me products' } }
  }
  return null
}

// ── Catalog ────────────────────────────────────────────────────────────

/**
 * 4 chips after a search returned 0 results. Targets the most-likely recovery
 * paths in order: see-everything → narrow-by-country → drop-the-seeded-filter
 * → cross-entity. We only pad to 4 when each chip is meaningful — never with
 * placeholder filler.
 */
export function getNoResultsActions(applied: AppliedSearch | null, userRole: string | null): SuggestedAction[] {
  const actions: SuggestedAction[] = []
  const entity = applied?.entity ?? 'clubs'

  // 1. Show all of the entity (drops most filters).
  // Note the explicit "regardless of gender" — the backend recognizes this
  // phrasing and skips UserContext gender seeding so the broaden actually
  // broadens. Without it the user-context gender (e.g. Women) is re-applied
  // and the user sees the same no-results card again.
  actions.push({
    label: `Show all ${entity}`,
    intent: { type: 'free_text', query: `Show me all ${entity} regardless of gender` },
  })

  // 2. Search by country — only when location wasn't already part of the query.
  if (!applied?.location_label) {
    actions.push({
      label: 'Search by country',
      intent: { type: 'free_text', query: `Find ${entity} in Spain` },
    })
  }

  // 3. Remove the seeded filter (UserContext usually adds gender; lifting it is the
  //    most-impactful single change a player/coach can make to a club search).
  // Same explicit phrasing — see the catalog comment on chip 1.
  if (applied?.gender_label) {
    actions.push({
      label: `Remove ${applied.gender_label.toLowerCase()} filter`,
      intent: { type: 'free_text', query: `Find ${entity} regardless of gender` },
    })
  }

  // 4. Cross-entity suggestion.
  const cross = crossEntityChip(entity, userRole)
  if (cross) actions.push(cross)

  return actions.slice(0, 4)
}

/**
 * Recovery from a previous no-results: same set as no-results but rotated so
 * the user sees a different first chip than they did the first time. The
 * leading chip carries the most weight in tap-rate; rotating gives the second
 * pass a fresh angle.
 */
export function getRecoveryActions(lastApplied: AppliedSearch | null, userRole: string | null): SuggestedAction[] {
  const base = getNoResultsActions(lastApplied, userRole)
  if (base.length <= 1) return base
  // Move the first chip to the end → second chip becomes the lead.
  return [...base.slice(1), base[0]].slice(0, 4)
}

/**
 * Fixed chip set for soft errors. Calm tone, recovery-shaped. The `retry` and
 * `clear` intents are special markers the frontend resolves locally (no
 * network round-trip needed).
 */
export function getSoftErrorActions(): SuggestedAction[] {
  return [
    { label: 'Retry', intent: { type: 'retry' } },
    { label: 'Broaden search', intent: { type: 'free_text', query: 'Find clubs near me' } },
    { label: 'Browse opportunities', intent: { type: 'free_text', query: 'Find opportunities for my position' } },
    { label: 'Start over', intent: { type: 'clear' } },
  ]
}

/**
 * 3 role-aware chips for "who should I connect with?" / "what should I do
 * next?" / "what should I improve?" — the self-advice intent class. Each
 * chip is a concrete next-step a user with that role can take today.
 */
export function getSelfAdviceActions(userRole: string | null): SuggestedAction[] {
  switch (userRole) {
    case 'player':
      return [
        { label: 'Find clubs for me', intent: { type: 'free_text', query: 'Find clubs for me' } },
        { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches in my position' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'What should I improve in my profile?' } },
      ]
    case 'coach':
      return [
        { label: 'Find clubs hiring', intent: { type: 'free_text', query: 'Find clubs hiring head coaches' } },
        { label: 'Find players to recommend', intent: { type: 'free_text', query: 'Find players for my staff' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'What should I improve in my profile?' } },
      ]
    case 'club':
      return [
        { label: 'Find players for my team', intent: { type: 'free_text', query: 'Find players for my team' } },
        { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches with head-coach experience' } },
        { label: 'Improve my club profile', intent: { type: 'free_text', query: "What's missing from my club profile?" } },
      ]
    case 'brand':
      return [
        { label: 'Find ambassadors', intent: { type: 'free_text', query: 'Find player ambassadors' } },
        { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Show me products' } },
        { label: 'Improve my brand profile', intent: { type: 'free_text', query: "What's missing from my brand profile?" } },
      ]
    default:
      // Unknown role / unauthenticated. No chips beats wrong chips.
      return []
  }
}

/** Single chip after a greeting — invites the user to ask something useful. */
export function getGreetingActions(): SuggestedAction[] {
  return [
    { label: 'What can you do?', intent: { type: 'free_text', query: 'What can you help me with?' } },
  ]
}
