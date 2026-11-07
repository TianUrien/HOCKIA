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

export const HOCKIA_AI_TITLE = 'Hockia AI'
export const COMPOSER_PLACEHOLDER = 'Ask about clubs, players or opportunities'
export const COMPOSER_MAX_LENGTH = 500
/** Existing beta copy, reused verbatim. */
export const BETA_NOTE =
  'Hockia AI is in beta. It can help you explore Hockia, but answers may sometimes be incomplete or inaccurate.'
export const TRY_ASKING_EYEBROW = 'Try asking'
export const CAP_REACHED_COPY = "You've reached today's limit. Try again tomorrow."
export const CONNECTION_ERROR_COPY = "I had trouble connecting just now. Let's try a different angle."
export const SOFT_ERROR_DEFAULT_COPY = "I had trouble with that one. Let's try a different angle."
export const SEARCHING_LABEL = 'Searching'

export const OPEN_ROLES_ROUTE = '/opportunities'
/** Phone leaf of the player's own profile editor (desktop opens the modal on the same URL). */
export const IMPROVE_PROFILE_ROUTE = '/dashboard/profile/edit'

export const OPEN_ROLES_CHIP: SuggestedAction = {
  label: 'Opportunities for me',
  intent: { type: 'navigate', route: OPEN_ROLES_ROUTE },
}
export const IMPROVE_PROFILE_CHIP: SuggestedAction = {
  label: 'Improve my profile',
  intent: { type: 'navigate', route: IMPROVE_PROFILE_ROUTE },
}
export const TRY_AGAIN_CHIP: SuggestedAction = { label: 'Try again', intent: { type: 'retry' } }

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

/** Default examples for unauthenticated visits + the universal fallback set. */
const DEFAULT_EXAMPLES = [
  'Find U25 defenders with a EU passport and 2+ references',
  'Show female defenders open to play',
  'Find men goalkeepers from New Zealand',
]

/** Founder example 2026-10-03: a precise role question a player can copy. */
export const ROLE_EXAMPLE = 'Goalkeeper opportunities in Serie A1 with no passport requirement'

/**
 * Role-aware choices (design audit 2026-10-21, A7): each role gets prompts
 * for its own job. Recruiters (clubs and recruiting coaches) find players,
 * draft a role and summarise applicants; brands find ambassadors; umpires
 * work on their officiating record; players keep theirs. No reference to a
 * Marketplace.
 */
const ROLE_EXAMPLES: Record<string, string[]> = {
  player: ['What should I improve in my profile?', 'What clubs would suit me?', ROLE_EXAMPLE],
  brand: [
    'Find players who could be ambassadors',
    'What’s missing from my brand profile?',
    'How can athletes find my brand?',
  ],
  umpire: [
    'What should I add to my officiating record?',
    'Show me umpires based in my country',
    'How do I add my latest match?',
  ],
}

/** Recruiters (club or recruiting coach): "Find available players for <role>", "Draft a role", "Summarise my applicants". */
export function recruiterExamples(activeRoleTitle?: string | null): string[] {
  const role = activeRoleTitle?.trim()
  return [role ? `Find available players for ${role}` : 'Find available players for my open opportunity', 'Draft an opportunity', 'Summarise my applicants']
}

/** Candidate coaches never get recruiter prompts they can't act on. */
const CANDIDATE_COACH_EXAMPLES = ['What should I add to my profile?', 'Show me clubs hiring head coaches', 'Who should I connect with?']

type AiViewer = { role?: string | null; coach_recruits_for_team?: boolean | null } | null | undefined

/** What a role option does: ask Hockia AI, open the profile builder, or open the screen where it happens. */
export type RoleOptionAction = { type: 'ask'; query: string } | { type: 'builder' } | { type: 'go'; to: string }
export interface RoleOption {
  /** FIND / LEARN / ASK: Hockia AI answers. DO IT FOR ME: the builder. OPEN: a screen, no AI answer. */
  eyebrow: 'FIND' | 'LEARN' | 'ASK' | 'DO IT FOR ME' | 'OPEN'
  label: string
  action: RoleOptionAction
}

const ask = (eyebrow: RoleOption['eyebrow'], label: string, query = label): RoleOption => ({ eyebrow, label, action: { type: 'ask', query } })
const go = (label: string, to: string): RoleOption => ({ eyebrow: 'OPEN', label, action: { type: 'go', to } })
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
      ask('FIND', role ? `Find available players for ${role}` : 'Find available players for my open opportunity'),
      ask('ASK', 'Summarise my applicants'),
      ask('DO IT FOR ME', 'Draft a new opportunity', 'Draft an opportunity'),
    ]
  }
  switch (profile?.role) {
    case 'player':
      return [
        ask('FIND', 'Find opportunities that fit me'),
        go('Check my profile against an opportunity', PICK_OPPORTUNITY),
        { eyebrow: 'DO IT FOR ME', label: 'Fill my profile from my files', action: { type: 'builder' } },
      ]
    case 'coach':
      return [
        ask('FIND', 'Find coaching opportunities for me'),
        go('Check my profile against an opportunity', PICK_OPPORTUNITY),
        go('Prepare my application', PICK_OPPORTUNITY),
      ]
    case 'brand':
      // Ambassadors: no per-brand country list on the server yet, so no "in my countries".
      return [
        ask('FIND', 'Find ambassador candidates', 'Find player ambassadors'),
        go('How did my offers do this month?', '/dashboard/results'),
        go('Write a new offer for members', '/dashboard/offers/new'),
      ]
    case 'umpire':
      return [
        go('Add my latest match', '/dashboard/profile?tab=officiating&add=match'),
        ask('LEARN', 'What is missing from my record?'),
        ask('FIND', 'Who are the umpires based in my country?'),
      ]
    default:
      return null
  }
}

export function isRecruiterProfile(profile: AiViewer): boolean {
  return profile?.role === 'club' || (profile?.role === 'coach' && Boolean(profile.coach_recruits_for_team))
}

/** Three "Try asking" rows for the first-use screen. */
export function exampleQueriesFor(profile: AiViewer, activeRoleTitle?: string | null): string[] {
  if (isRecruiterProfile(profile)) return recruiterExamples(activeRoleTitle)
  if (profile?.role === 'coach') return CANDIDATE_COACH_EXAMPLES
  const examples = profile?.role ? ROLE_EXAMPLES[profile.role] : null
  return examples && examples.length > 0 ? examples : DEFAULT_EXAMPLES
}

/** The medium-detent greeting line, per role (audit A7). */
export function aiIntroFor(profile: AiViewer): string {
  if (isRecruiterProfile(profile)) return 'Ask me to find available players, draft an opportunity or summarise your applicants.'
  switch (profile?.role) {
    case 'brand': return 'Ask me to find players who could be your ambassadors, or anything about hockey.'
    case 'umpire': return 'Ask me about your officiating record, other umpires, or anything about hockey.'
    case 'coach': return 'Ask me to find coaching opportunities, or anything about hockey.'
    default: return 'I see you’re browsing opportunities. Ask me to find the ones that fit you, or anything about hockey.'
  }
}

/** Replaces "Do I fit?": facts about the profile against the role, not a verdict (audit A7). */
export const CHECK_PROFILE_AGAINST_ROLE = 'Check my profile against this opportunity'

/** "From 24 open roles · updated today"; null when the pool size is unknown. */
export function fromOpenRolesCaption(total: number | null | undefined): string | null {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0) return null
  return `From ${total} open ${total === 1 ? 'opportunity' : 'opportunities'} · updated today`
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
