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
  | 'opportunity_results'   // open roles a player / coach can apply to

export interface AppliedSearch {
  entity: 'clubs' | 'players' | 'coaches' | 'brands' | 'umpires' | null
  /** Phase 3e — primary category label. One of adult_women / adult_men /
   * girls / boys / mixed. Used by the frontend chip + suggested-action text.
   * Optional so existing fixtures (Deno tests) compile without modification;
   * the live nl-search response always populates it (or null). */
  category_label?: string | null
  /** @deprecated Phase 3e — superseded by category_label. Kept for one
   * deploy cycle so a stale frontend still renders adult_men/adult_women
   * chips correctly. The backend populates this only when the category is
   * adult_men or adult_women; otherwise it's null. */
  gender_label: string | null
  location_label: string | null  // "Spain" / "Madrid"
  age?: { min?: number; max?: number }
  /** Human-readable summary the UI can drop straight into a sentence. */
  role_summary: string
}

/** Display label for a category enum value — used by chip text + role_summary. */
function categoryDisplay(category: string | null | undefined): string {
  if (!category) return ''
  if (category === 'adult_women') return 'Adult Women'
  if (category === 'adult_men') return 'Adult Men'
  if (category === 'girls') return 'Girls'
  if (category === 'boys') return 'Boys'
  if (category === 'mixed') return 'Mixed'
  return ''
}

/** Possessive role-summary form. Adult Women → "women's"; Girls → "girls'";
 * Mixed → "mixed" (no apostrophe — reads better). Falls back to legacy
 * gender_label for adult_men / adult_women if category isn't set yet. */
function categorySummaryForm(applied: Pick<AppliedSearch, 'category_label' | 'gender_label'> | null): string {
  const cat = applied?.category_label ?? null
  if (cat === 'adult_women') return "women's"
  if (cat === 'adult_men') return "men's"
  if (cat === 'girls') return "girls'"
  if (cat === 'boys') return "boys'"
  if (cat === 'mixed') return 'mixed'
  // Legacy gender fallback so any in-flight call without category_label
  // still produces sensible role_summary text.
  if (applied?.gender_label === 'Women') return "women's"
  if (applied?.gender_label === 'Men') return "men's"
  return ''
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

/** Build a human-readable summary like "women's clubs in Spain" or "girls' coaches". */
export function buildRoleSummary(applied: Pick<AppliedSearch, 'entity' | 'category_label' | 'gender_label' | 'location_label' | 'age'> | null): string {
  if (!applied?.entity) return 'profiles'
  const parts: string[] = []
  const summary = categorySummaryForm(applied)
  if (summary) parts.push(summary)
  if (applied.age?.max != null) parts.push(`U${applied.age.max + 1}`)
  parts.push(applied.entity)
  if (applied.location_label) parts.push(`in ${applied.location_label}`)
  return parts.join(' ')
}

/** Cross-entity suggestion based on (what they searched FOR × what they ARE).
 *  Phase 4 chip-label fix — `query` matches `label` exactly so the bubble
 *  the user sees after clicking matches the chip they tapped. The LLM is
 *  capable of expanding short queries from user context; if a short form
 *  needs to be recognized by the intent router, we add a pattern there. */
function crossEntityChip(entity: string | null | undefined, userRole: string | null): SuggestedAction | null {
  if (entity === 'clubs' && (userRole === 'player' || userRole === 'coach')) {
    return { label: 'Find opportunities', intent: { type: 'free_text', query: 'Find opportunities' } }
  }
  if (entity === 'players' && userRole === 'club') {
    return { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches' } }
  }
  if (entity === 'coaches' && (userRole === 'player' || userRole === 'club')) {
    return { label: 'Find clubs', intent: { type: 'free_text', query: 'Find clubs' } }
  }
  if (entity === 'players' && userRole === 'brand') {
    return { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Browse Marketplace' } }
  }
  if (entity === 'brands' && (userRole === 'player' || userRole === 'coach' || userRole === 'club')) {
    return { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Browse Marketplace' } }
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

  // 1. Show all of the entity (drops most filters). Phase 4 — query
  // matches the label exactly. The QUERY_FORBIDS_CATEGORY_SEED regex in
  // nl-search/index.ts is patterned to match `show all ${entity}` so the
  // broaden still bypasses auto-seed.
  actions.push({
    label: `Show all ${entity}`,
    intent: { type: 'free_text', query: `Show all ${entity}` },
  })

  // 2. Search by country — only when location wasn't already part of the
  // query. Phase 4 — label = query. The user gets clarified by the LLM
  // (e.g. "Which country?") which keeps the conversational shape honest.
  if (!applied?.location_label) {
    actions.push({
      label: 'Search by country',
      intent: { type: 'free_text', query: 'Search by country' },
    })
  }

  // 3. Remove the seeded filter. Phase 3e — chip label uses the user-facing
  //    category name ("Adult Women", "Girls", etc.) instead of "men/women".
  //    Falls back to legacy gender_label so any AppliedSearch produced before
  //    the category_label rollout still generates a sensible chip.
  //    Phase 4 — query matches label exactly. The QUERY_FORBIDS_CATEGORY_SEED
  //    regex is extended to match `remove ... filter` patterns so this
  //    broaden chip still skips the auto-seed re-application.
  const seededLabel = applied?.category_label
    ? categoryDisplay(applied.category_label)
    : applied?.gender_label
      ? (applied.gender_label === 'Men' ? 'Adult Men' : 'Adult Women')
      : null
  if (seededLabel) {
    actions.push({
      label: `Remove ${seededLabel} filter`,
      intent: { type: 'free_text', query: `Remove ${seededLabel} filter` },
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
    { label: 'Broaden search', intent: { type: 'free_text', query: 'Broaden search' } },
    { label: 'Browse opportunities', intent: { type: 'free_text', query: 'Browse opportunities' } },
    { label: 'Start over', intent: { type: 'clear' } },
  ]
}

/**
 * Alternate chip set for *repeated* soft errors — when the previous turn was
 * also a soft_error and a plain "retry" feels insufficient. Shifts the
 * leading chip from Retry → Start over (recommend starting fresh) and
 * trades "Broaden search" for a more concrete "Search clubs" so the user
 * always has at least one query that's known to land in a real path.
 */
export function getRepeatedSoftErrorActions(): SuggestedAction[] {
  return [
    { label: 'Start over', intent: { type: 'clear' } },
    { label: 'Browse opportunities', intent: { type: 'free_text', query: 'Browse opportunities' } },
    { label: 'Search clubs', intent: { type: 'free_text', query: 'Search clubs' } },
    { label: 'Try again', intent: { type: 'retry' } },
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
        { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'Improve my profile' } },
      ]
    case 'coach':
      return [
        { label: 'Find clubs hiring', intent: { type: 'free_text', query: 'Find clubs hiring' } },
        { label: 'Find players to recommend', intent: { type: 'free_text', query: 'Find players to recommend' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'Improve my profile' } },
      ]
    case 'club':
      return [
        { label: 'Find players for my team', intent: { type: 'free_text', query: 'Find players for my team' } },
        { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches' } },
        { label: 'Improve my club profile', intent: { type: 'free_text', query: 'Improve my club profile' } },
      ]
    case 'brand':
      return [
        { label: 'Find ambassadors', intent: { type: 'free_text', query: 'Find ambassadors' } },
        { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Browse Marketplace' } },
        { label: 'Improve my brand profile', intent: { type: 'free_text', query: 'Improve my brand profile' } },
      ]
    case 'umpire':
      // Phase 4 — umpire role was previously falling through to the default
      // (empty chip array), leaving self-advice replies with no forward
      // step. Chip targets reflect the umpire mental model: peer network,
      // appointments for credibility, profile-improvement loop.
      return [
        { label: 'Find other officials', intent: { type: 'free_text', query: 'Find other officials' } },
        { label: 'Add an appointment', intent: { type: 'free_text', query: 'Add an appointment' } },
        { label: 'Improve my umpire profile', intent: { type: 'free_text', query: 'Improve my umpire profile' } },
      ]
    default:
      // Unknown role / unauthenticated. No chips beats wrong chips.
      return []
  }
}

/** Greeting chips — role-aware, 3 chips per role. Phase 4 audit P3-2: the
 *  single "What can you do?" chip felt lonely on first contact. Adding two
 *  role-shaped starter actions gives the user a real menu without forcing
 *  them to type a free-text query. label === query throughout (chip alignment
 *  invariant). */
export function getGreetingActions(userRole: string | null = null): SuggestedAction[] {
  // Common across all roles — capability help.
  const help: SuggestedAction = {
    label: 'What can you do?',
    intent: { type: 'free_text', query: 'What can you do?' },
  }
  switch (userRole) {
    case 'player':
      return [
        help,
        { label: 'Find clubs for me', intent: { type: 'free_text', query: 'Find clubs for me' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'Improve my profile' } },
      ]
    case 'coach':
      return [
        help,
        { label: 'Find clubs hiring', intent: { type: 'free_text', query: 'Find clubs hiring' } },
        { label: 'Improve my profile', intent: { type: 'free_text', query: 'Improve my profile' } },
      ]
    case 'club':
      return [
        help,
        { label: 'Find players for my team', intent: { type: 'free_text', query: 'Find players for my team' } },
        { label: 'Find coaches', intent: { type: 'free_text', query: 'Find coaches' } },
      ]
    case 'brand':
      return [
        help,
        { label: 'Find ambassadors', intent: { type: 'free_text', query: 'Find ambassadors' } },
        { label: 'Browse Marketplace', intent: { type: 'free_text', query: 'Browse Marketplace' } },
      ]
    case 'umpire':
      return [
        help,
        { label: 'Find other officials', intent: { type: 'free_text', query: 'Find other officials' } },
        { label: 'Improve my umpire profile', intent: { type: 'free_text', query: 'Improve my umpire profile' } },
      ]
    default:
      // Unknown role / unauthenticated — keep the single capability chip.
      return [help]
  }
}
