/**
 * Hockia AI v2 copy and rules (Figma "New-Hockia" 04 · Player — Live 44:321;
 * states 524:1494 first use / 524:1575 loading / 524:1644 no match /
 * 524:1715 can't answer / 524:1785 error; founder rulings 2026-10-03).
 *
 * Product rules carried here so every leaf component reads the same words:
 *   - players never see fit scores, levels or counts of competitors, and the
 *     AI never ranks the viewer against others (stripRankingLines);
 *   - copy is gender-neutral;
 *   - amber is only for "the viewer must act"; every Hockia AI notice is
 *     neutral (surface-muted, ink text).
 *
 * The daily cap itself is server-owned (ai_questions_today, nl-search); the
 * client only renders `kind: 'cap_reached'`.
 */
import type { OpportunityResultItem, SuggestedAction } from '@/hooks/useDiscover'
import en from '@/locales/en/hockiaAi.json'
import { tHockiaAi } from '@/i18n/ns/hockiaAi'
import { lazyTextRecord, withLazyText } from '@/lib/opportunityLazyText'

export const HOCKIA_AI_TITLE = 'Hockia AI'
export const COMPOSER_MAX_LENGTH = 500

/**
 * English copy for callers that still read a constant (they cannot follow the
 * interface language). New code reads `hockiaAiCopy`, which does.
 */
export const COMPOSER_PLACEHOLDER = en.copy.composerPlaceholder
/** Existing beta copy, reused verbatim. */
export const BETA_NOTE = en.copy.betaNote
export const TRY_ASKING_EYEBROW = en.copy.tryAsking
export const CAP_REACHED_COPY = en.copy.capReached
export const CONNECTION_ERROR_COPY = en.copy.connectionError
export const SOFT_ERROR_DEFAULT_COPY = en.copy.softErrorDefault
export const SEARCHING_LABEL = en.copy.searching

/** The same copy in the interface language, read on every use. */
export const hockiaAiCopy = /* @__PURE__ */ lazyTextRecord({
  composerPlaceholder: () => tHockiaAi('copy.composerPlaceholder'),
  betaNote: () => tHockiaAi('copy.betaNote'),
  tryAsking: () => tHockiaAi('copy.tryAsking'),
  capReached: () => tHockiaAi('copy.capReached'),
  connectionError: () => tHockiaAi('copy.connectionError'),
  softErrorDefault: () => tHockiaAi('copy.softErrorDefault'),
  searching: () => tHockiaAi('copy.searching'),
})

export const OPEN_ROLES_ROUTE = '/opportunities'
/** Phone leaf of the player's own profile editor (desktop opens the modal on the same URL). */
export const IMPROVE_PROFILE_ROUTE = '/dashboard/profile/edit'

/** Chip labels follow the interface language (read on every use). */
export const OPEN_ROLES_CHIP: SuggestedAction = /* @__PURE__ */ withLazyText(
  { intent: { type: 'navigate', route: OPEN_ROLES_ROUTE } } as Omit<SuggestedAction, 'label'>,
  { label: () => tHockiaAi('chips.openRoles') },
)
export const IMPROVE_PROFILE_CHIP: SuggestedAction = /* @__PURE__ */ withLazyText(
  { intent: { type: 'navigate', route: IMPROVE_PROFILE_ROUTE } } as Omit<SuggestedAction, 'label'>,
  { label: () => tHockiaAi('chips.improveProfile') },
)
export const TRY_AGAIN_CHIP: SuggestedAction = /* @__PURE__ */ withLazyText(
  { intent: { type: 'retry' } } as Omit<SuggestedAction, 'label'>,
  { label: () => tHockiaAi('chips.tryAgain') },
)

/** Roles that look for a role themselves (the Figma 04 Player viewer). */
export function isCandidateRole(role: string | null | undefined): boolean {
  return role === 'player' || role === 'coach'
}

/** Can't answer (refusal / out of scope): "Open roles for me" / "Improve my profile". */
export function cantAnswerChips(role: string | null | undefined): SuggestedAction[] {
  return isCandidateRole(role) ? [OPEN_ROLES_CHIP, IMPROVE_PROFILE_CHIP] : [IMPROVE_PROFILE_CHIP]
}

/** Error: "Try again" / "Open roles for me", shown below the neutral card. */
export function errorChips(role: string | null | undefined): SuggestedAction[] {
  return isCandidateRole(role) ? [TRY_AGAIN_CHIP, OPEN_ROLES_CHIP] : [TRY_AGAIN_CHIP]
}

/** Cap reached: no chips except "Open roles for me". */
export function capReachedChips(role: string | null | undefined): SuggestedAction[] {
  return isCandidateRole(role) ? [OPEN_ROLES_CHIP] : []
}

/** Prompts are sent to Hockia AI in English (`lng: 'en'`); the member reads them in the interface language. */
type Lng = { lng?: 'en' }
const tx = (key: string, opts: Lng & Record<string, unknown> = {}): string => tHockiaAi(key as never, opts as never) as unknown as string

/** Default examples for unauthenticated visits + the universal fallback set. */
const DEFAULT_EXAMPLES = ['examples.default1', 'examples.default2', 'examples.default3']

/** Founder example 2026-10-03: a precise role question a player can copy (English; the list itself follows the language). */
export const ROLE_EXAMPLE = en.examples.roleExample

/**
 * Role-aware choices (design audit 2026-10-21, A7): each role gets prompts
 * for its own job. Recruiters (clubs and recruiting coaches) find players,
 * draft a role and summarise applicants; brands find ambassadors; umpires
 * work on their officiating record; players keep theirs. No reference to a
 * Marketplace.
 */
const ROLE_EXAMPLES: Record<string, string[]> = {
  player: ['examples.player1', 'examples.player2', 'examples.roleExample'],
  brand: ['examples.brand1', 'examples.brand2', 'examples.brand3'],
  umpire: ['examples.umpire1', 'examples.umpire2', 'examples.umpire3'],
}

/** Recruiters (club or recruiting coach): "Find available players for <role>", "Draft a role", "Summarise my applicants". */
export function recruiterExamples(activeRoleTitle?: string | null, opts: Lng = {}): string[] {
  const role = activeRoleTitle?.trim()
  return [
    role ? tx('examples.recruiterFindForRole', { ...opts, role }) : tx('examples.recruiterFindForOpen', opts),
    tx('examples.recruiterDraft', opts),
    tx('examples.recruiterSummarise', opts),
  ]
}

/** Candidate coaches never get recruiter prompts they can't act on. */
const CANDIDATE_COACH_EXAMPLES = ['examples.coach1', 'examples.coach2', 'examples.coach3']

type AiViewer = { role?: string | null; coach_recruits_for_team?: boolean | null } | null | undefined

/** What a role option does: ask Hockia AI, open the profile builder, or open the screen where it happens. */
export type RoleOptionAction = { type: 'ask'; query: string } | { type: 'builder' } | { type: 'go'; to: string }
export interface RoleOption {
  /** FIND / LEARN / ASK: Hockia AI answers. DO IT FOR ME: the builder. OPEN: a screen, no AI answer. Translate with `eyebrowLabel`. */
  eyebrow: 'FIND' | 'LEARN' | 'ASK' | 'DO IT FOR ME' | 'OPEN'
  label: string
  action: RoleOptionAction
}

const EYEBROW_KEYS: Record<RoleOption['eyebrow'], string> = {
  FIND: 'eyebrow.find', LEARN: 'eyebrow.learn', ASK: 'eyebrow.ask', 'DO IT FOR ME': 'eyebrow.doItForMe', OPEN: 'eyebrow.open',
}
/** The eyebrow as the member reads it. */
export function eyebrowLabel(eyebrow: RoleOption['eyebrow']): string {
  return tx(EYEBROW_KEYS[eyebrow])
}

/** `labelKey` is shown; the query (English) is what Hockia AI reads. */
const ask = (eyebrow: RoleOption['eyebrow'], labelKey: string, vars: Record<string, unknown> = {}, queryKey = labelKey): RoleOption => ({
  eyebrow, label: tx(labelKey, vars), action: { type: 'ask', query: tx(queryKey, { ...vars, lng: 'en' }) },
})
const go = (labelKey: string, to: string): RoleOption => ({ eyebrow: 'OPEN', label: tx(labelKey), action: { type: 'go', to } })
/** Checking a profile or preparing an application needs an opportunity: pick one first. */
const PICK_OPPORTUNITY = '/opportunities'

/**
 * The first three choices per role (rebrand page 17, design target in
 * docs/design-handoff/hockia-ai-one-sheet.md). Hockia AI answers what it can
 * from real data; the rest open the screen where it happens (founder
 * 2026-11-06), so no answer invents numbers. Null for visitors without a role.
 */
export function roleOptionsFor(profile: AiViewer, activeRoleTitle?: string | null): RoleOption[] | null {
  if (isRecruiterProfile(profile)) {
    const role = activeRoleTitle?.trim()
    return [
      role ? ask('FIND', 'options.findForRole', { role }) : ask('FIND', 'options.findForOpen'),
      ask('ASK', 'options.summarise'),
      ask('DO IT FOR ME', 'options.draftNew', {}, 'options.draftQuery'),
    ]
  }
  switch (profile?.role) {
    case 'player':
      return [
        ask('FIND', 'options.playerFind'),
        go('options.checkProfile', PICK_OPPORTUNITY),
        { eyebrow: 'DO IT FOR ME', label: tx('options.fillFromFiles'), action: { type: 'builder' } },
      ]
    case 'coach':
      return [
        ask('FIND', 'options.coachFind'),
        go('options.checkProfile', PICK_OPPORTUNITY),
        go('options.prepareApplication', PICK_OPPORTUNITY),
      ]
    case 'brand':
      // Ambassadors: no per-brand country list on the server yet, so no "in my countries".
      return [
        go('options.brandAmbassadors', '/dashboard/ambassadors'),
        go('options.brandOffersMonth', '/dashboard/results'),
        go('options.brandWriteOffer', '/dashboard/offers/new'),
      ]
    case 'umpire':
      return [
        go('options.umpireAddMatch', '/dashboard/profile?tab=officiating&add=match'),
        ask('LEARN', 'options.umpireMissing'),
        ask('FIND', 'options.umpireCountry'),
      ]
    default:
      return null
  }
}

export function isRecruiterProfile(profile: AiViewer): boolean {
  return profile?.role === 'club' || (profile?.role === 'coach' && Boolean(profile.coach_recruits_for_team))
}

/** Three "Try asking" rows for the first-use screen. `lng: 'en'` gives the English prompts Hockia AI reads, in the same order. */
export function exampleQueriesFor(profile: AiViewer, activeRoleTitle?: string | null, opts: Lng = {}): string[] {
  if (isRecruiterProfile(profile)) return recruiterExamples(activeRoleTitle, opts)
  if (profile?.role === 'coach') return CANDIDATE_COACH_EXAMPLES.map((k) => tx(k, opts))
  const examples = profile?.role ? ROLE_EXAMPLES[profile.role] : null
  return (examples && examples.length > 0 ? examples : DEFAULT_EXAMPLES).map((k) => tx(k, opts))
}

/** The medium-detent greeting line, per role (audit A7). */
export function aiIntroFor(profile: AiViewer): string {
  if (isRecruiterProfile(profile)) return tx('intro.recruiter')
  switch (profile?.role) {
    case 'brand': return tx('intro.brand')
    case 'umpire': return tx('intro.umpire')
    case 'coach': return tx('intro.coach')
    default: return tx('intro.default')
  }
}

/** English, for callers that read a constant. */
export const CHECK_PROFILE_AGAINST_ROLE = en.copy.checkProfileAgainstRole
/** Replaces "Do I fit?": facts about the profile against the role, not a verdict (audit A7). `lng: 'en'` for the prompt. */
export function checkProfileAgainstRole(opts: Lng = {}): string {
  return tx('copy.checkProfileAgainstRole', opts)
}

/** "From 24 open roles · updated today"; null when the pool size is unknown. */
export function fromOpenRolesCaption(total: number | null | undefined): string | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null
  return tx('copy.fromOpenRoles', { count: total })
}

/**
 * Lines that rank or score the viewer against other people. The backend's
 * candidate answers never contain them; this is the belt for free-text
 * answers from the model. Applied to candidate viewers only.
 */
const RANKING_PATTERN =
  /\b(rank(?:ed|ing|s)?|outrank\w*|ahead of (?:other|most|the)|behind (?:other|most)|better than (?:other|most)|top \d+ ?%|percentile|compared (?:to|with) other|stronger than other|more competitive than|your (?:fit|match) (?:score|level)|fit score|match score|(?:strong|possible|good) match)\b/i

export function stripRankingLines(text: string | null | undefined): string {
  if (!text) return ''
  const kept = text
    .split('\n')
    .map(line =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter(sentence => !RANKING_PATTERN.test(sentence))
        .join(' '),
    )
    .filter((line, i, all) => line.trim() !== '' || (i > 0 && i < all.length - 1))
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

/** List item / Role result (534:2448): "Club · Position" then "League · package". */
export function roleResultTitle(o: Pick<OpportunityResultItem, 'organization' | 'position_label' | 'title'>): string {
  const parts = [o.organization, o.position_label].filter((p): p is string => !!p && p.trim() !== '')
  return parts.length > 0 ? parts.join(' · ') : o.title
}

export function roleResultMeta(
  o: Pick<OpportunityResultItem, 'league_label' | 'location_label' | 'benefit_labels'>,
): string | null {
  const first = o.league_label || o.location_label || null
  const pkg = (o.benefit_labels ?? []).slice(0, 2).join(', ')
  const parts = [first, pkg || null].filter((p): p is string => !!p)
  return parts.length > 0 ? parts.join(' · ') : null
}
