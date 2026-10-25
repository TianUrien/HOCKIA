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
    'How do I add an appointment?',
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
