import { BENEFIT_TILES, genderPill } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'
import { DESCRIPTION_MAX, PAY_OPTIONS, TITLE_MAX, startLabel, type PostRoleDraft, type RoleGender, type RoleLevel, type RolePay, type RolePosition } from '@/lib/postRole'

/**
 * Club speed CS1–CS2 · Start with Hockia AI (Figma 05 204:892 / 204:981).
 * The club's sentence → role-description-draft (mode 'from_text') → the
 * validated fields below, merged into a new draft whose location already
 * comes from the club profile. Nothing is posted until "Post role"; whatever
 * the club didn't say stays empty and reads "Not set · optional".
 */
export interface AiRoleDraft {
  type: 'player' | 'coach'
  position: string | null
  team: string | null
  title: string
  level: string | null
  skills: string[]
  startDate: string | null
  duration: string | null
  pay: string | null
  package: string[]
  euPassport: boolean
  description: string
}

/** Router state handed from the start sheet to Post a role. */
export interface PostRoleStartState {
  ai?: { draft: AiRoleDraft; text: string }
  /** Hockia AI couldn't draft: start from scratch with the sentence in "About the role". */
  scratchText?: string
  /** Club speed CS3 · Post again: a closed role (the club's own) to copy. */
  postAgainId?: string
}

export const AI_TEXT_MAX = 500

/** Merge the drafted fields into a fresh draft (keeps its location, cover and defaults). */
export function applyAiDraft(base: PostRoleDraft, ai: AiRoleDraft): PostRoleDraft {
  const player = ai.type === 'player'
  return {
    ...base,
    type: ai.type,
    position: (ai.position as RolePosition | null) ?? null,
    gender: (ai.team as RoleGender | null) ?? null,
    title: ai.title.slice(0, TITLE_MAX),
    level: player ? ((ai.level as RoleLevel | null) ?? null) : null,
    skills: player ? ai.skills : [],
    startDate: ai.startDate,
    duration: ai.duration,
    pay: (ai.pay as RolePay | null) ?? null,
    benefits: ai.package.filter((k) => k in BENEFIT_TILES),
    euPassport: ai.euPassport,
    description: ai.description.slice(0, DESCRIPTION_MAX),
  }
}

export interface SummarySection {
  key: 'role' | 'offer' | 'where' | 'about'
  label: string
  lines: string[]
  /** "Not set · optional — level, start" */
  optionalMissing: string[]
  /** Needed before posting — position, team. */
  neededMissing: string[]
}

const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(' · ')

/** The four parts of "Check your role", each with an Edit. */
export function checkSummary(d: PostRoleDraft, opts: { fromClub: boolean }): SummarySection[] {
  const player = d.type === 'player'
  const team = genderPill(d.gender)?.label
  const pos = positionLabel(d.position)
  const title = d.title.trim()
  const pay = PAY_OPTIONS.find((p) => p.value === d.pay)?.label ?? null
  const pkg = d.benefits.map((k) => BENEFIT_TILES[k]?.label).filter(Boolean) as string[]
  const start = startLabel(d.startDate)
  const place = [d.city, d.country].map((x) => x.trim()).filter(Boolean).join(', ')
  return [
    {
      key: 'role',
      label: 'The role',
      lines: [join([pos, title && title.toLowerCase() !== (pos ?? '').toLowerCase() ? title : null, team ? `${team} team` : null])].filter(Boolean),
      optionalMissing: player && !d.level ? ['level'] : [],
      neededMissing: [!d.position ? (player ? 'position' : 'role') : null, !d.gender ? 'team' : null].filter((x): x is string => Boolean(x)),
    },
    {
      key: 'offer',
      label: 'The offer',
      lines: [join([start ? `Starts ${start}` : null, d.duration]), join([pay, ...pkg])].filter(Boolean),
      optionalMissing: [!start ? 'start' : null, !d.duration ? 'length' : null, !pay ? 'pay' : null].filter((x): x is string => Boolean(x)),
      neededMissing: [],
    },
    {
      key: 'where',
      label: 'Where',
      lines: place ? [join([place, opts.fromClub ? 'from your club profile' : null])] : [],
      optionalMissing: [],
      neededMissing: d.city.trim() && d.country.trim() ? [] : ['where the role is'],
    },
    {
      key: 'about',
      label: 'About the role',
      lines: d.description.trim() ? [d.description.trim()] : [],
      optionalMissing: d.description.trim() ? [] : ['description'],
      neededMissing: [],
    },
  ]
}

/** Why Hockia AI couldn't draft, in the toast. */
export function aiDraftFailedCopy(reason: string | null | undefined): string {
  return reason === 'limit'
    ? 'You’ve used today’s Hockia AI drafts. Your words are in “About the role” — fill in the rest.'
    : 'Hockia AI couldn’t draft this right now. Your words are in “About the role” — fill in the rest.'
}
