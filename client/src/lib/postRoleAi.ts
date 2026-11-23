import { BENEFIT_TILES, genderPill } from '@/lib/opportunityCopy'
import { positionLabel } from '@/lib/identity'
import { tHockiaAi } from '@/i18n/ns/hockiaAi'
import { DESCRIPTION_MAX, LEVELS, PAY_OPTIONS, SKILLS, TITLE_MAX, hardnessFootnote, startLabel, type PostRoleDraft, type RoleGender, type RoleLevel, type RolePay, type RolePosition } from '@/lib/postRole'

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
  key: 'role' | 'who' | 'offer' | 'where' | 'about'
  label: string
  lines: string[]
  /** "Who you want" only: what blocks a candidate and what only ranks them. */
  note?: string
  /** "Not set · optional — level, start" */
  optionalMissing: string[]
  /** Needed before posting — position, team. */
  neededMissing: string[]
}

const join = (xs: (string | null | undefined | false)[]) => xs.filter(Boolean).join(', ')

/**
 * The parts of "Check your role", each with an Edit. "Who you want" says back
 * the level, skills and EU passport the club asked for, and which of them
 * block a candidate (audit 2026-11-23: the check showed none of these, so a
 * club could not see whether Hockia AI understood who it is looking for).
 */
export function checkSummary(d: PostRoleDraft, opts: { fromClub: boolean }): SummarySection[] {
  const player = d.type === 'player'
  const team = genderPill(d.gender)?.label
  const pos = positionLabel(d.position)
  const title = d.title.trim()
  const pay = PAY_OPTIONS.find((p) => p.value === d.pay)?.label ?? null
  const pkg = d.benefits.map((k) => BENEFIT_TILES[k]?.label).filter(Boolean) as string[]
  const start = startLabel(d.startDate)
  const level = player ? LEVELS.find((l) => l.value === d.level)?.label ?? null : null
  const skills = player ? d.skills.map((k) => SKILLS.find((x) => x.value === k)?.label ?? k) : []
  const place = [d.city, d.country].map((x) => x.trim()).filter(Boolean).join(', ')
  return [
    {
      key: 'role',
      label: tHockiaAi('postRole.sectionRole'),
      lines: [join([pos, title && title.toLowerCase() !== (pos ?? '').toLowerCase() ? title : null, team ? tHockiaAi('postRole.teamLine', { team }) : null])].filter(Boolean),
      optionalMissing: [],
      neededMissing: [!d.position ? (player ? tHockiaAi('postRole.missingPosition') : tHockiaAi('postRole.missingRole')) : null, !d.gender ? tHockiaAi('postRole.missingTeam') : null].filter((x): x is string => Boolean(x)),
    },
    {
      key: 'who',
      label: tHockiaAi('postRole.sectionWho'),
      lines: [level ? tHockiaAi('postRole.levelLine', { level }) : null, skills.length ? tHockiaAi('postRole.skillsLine', { skills: skills.join(', ') }) : null, d.euPassport ? tHockiaAi('postRole.euPassportLine') : null].filter((x): x is string => Boolean(x)),
      note: hardnessFootnote(d),
      optionalMissing: player ? [!level ? tHockiaAi('postRole.missingLevel') : null, !skills.length ? tHockiaAi('postRole.missingSkills') : null].filter((x): x is string => Boolean(x)) : [],
      neededMissing: [],
    },
    {
      key: 'offer',
      label: tHockiaAi('postRole.sectionOffer'),
      lines: [join([start ? tHockiaAi('postRole.starts', { date: start }) : null, d.duration]), join([pay, ...pkg])].filter(Boolean),
      optionalMissing: [!start ? tHockiaAi('postRole.missingStart') : null, !d.duration ? tHockiaAi('postRole.missingLength') : null, !pay ? tHockiaAi('postRole.missingPay') : null].filter((x): x is string => Boolean(x)),
      neededMissing: [],
    },
    {
      key: 'where',
      label: tHockiaAi('postRole.sectionWhere'),
      lines: place ? [join([place, opts.fromClub ? tHockiaAi('postRole.fromClub') : null])] : [],
      optionalMissing: [],
      neededMissing: d.city.trim() && d.country.trim() ? [] : [tHockiaAi('postRole.missingWhere')],
    },
    {
      key: 'about',
      label: tHockiaAi('postRole.sectionAbout'),
      lines: d.description.trim() ? [d.description.trim()] : [],
      optionalMissing: d.description.trim() ? [] : [tHockiaAi('postRole.missingDescription')],
      neededMissing: [],
    },
  ]
}

/** Why Hockia AI couldn't draft, in the toast. */
export function aiDraftFailedCopy(reason: string | null | undefined): string {
  return reason === 'limit' ? tHockiaAi('postRole.draftLimit') : tHockiaAi('postRole.draftFailed')
}
