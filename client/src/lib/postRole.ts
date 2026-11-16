import type { Database } from '@/lib/database.types'
import type { Vacancy } from '@/lib/supabase'
import { formatDurationText, genderPill } from '@/lib/opportunityCopy'
import { isYouthGender, playerRoleGender } from '@/lib/youthRoles'
import { humanizeToken } from '@/lib/identity'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'
import { dayFirst } from '@/lib/dayFirst'
import { withLazyText } from '@/lib/opportunityLazyText'
import { tClub } from '@/i18n/ns/club'
import { tEnums } from '@/i18n/ns/enums'

/**
 * Post a role (Figma 04 Club 330:318 → 330:431 → 330:596; DEV NOTEs
 * 330:769 / 330:774 / 330:781). One draft object across the three steps,
 * mapped 1:1 onto an opportunities row.
 */
export type RoleType = Database['public']['Enums']['opportunity_type']
export type RolePosition = Database['public']['Enums']['opportunity_position']
export type RoleGender = Database['public']['Enums']['opportunity_gender']
export type RoleLevel = 'competitive' | 'high_performance' | 'elite'
export type RolePay = 'paid' | 'unpaid_development' | 'either'

export interface PostRoleDraft {
  id: string | null
  type: RoleType
  position: RolePosition | null
  positionRequired: boolean
  gender: RoleGender | null
  title: string
  level: RoleLevel | null
  levelRequired: boolean
  skills: string[]
  skillsRequired: boolean
  startDate: string | null
  duration: string | null
  availabilityRequired: boolean
  city: string
  country: string
  locationRequired: boolean
  pay: RolePay | null
  payRequired: boolean
  benefits: string[]
  /** Free-text extras from older roles; kept as written. */
  customBenefits: string[]
  /** Package keys the form has no tile for (e.g. meals, education on older
   *  roles). Not editable here, but written back so editing never drops them. */
  otherBenefits: string[]
  euPassport: boolean
  description: string
  /** Optional cover photo (opportunities.cover_url, public URL in role-covers); null = generated cover in the club's colours. */
  coverUrl: string | null
  /** Coaches who recruit: the club or academy the role is for (opportunities.organization_name). Empty for clubs. */
  organizationName: string
}

export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 2000

/** An option whose label is read in the interface language on every use (never at import). */
function option<V extends string>(value: V, label: () => string): { value: V; label: string } {
  return withLazyText({ value }, { label })
}

export const PLAYER_POSITIONS: { value: RolePosition; label: string }[] = [
  option<RolePosition>('goalkeeper', () => tEnums('position.goalkeeper')),
  option<RolePosition>('defender', () => tEnums('position.defender')),
  option<RolePosition>('midfielder', () => tEnums('position.midfielder')),
  option<RolePosition>('forward', () => tEnums('position.forward')),
]

export const COACH_POSITIONS: { value: RolePosition; label: string }[] = [
  option<RolePosition>('head_coach', () => tEnums('coachSpecialization.head_coach')),
  option<RolePosition>('assistant_coach', () => tEnums('coachSpecialization.assistant_coach')),
  option<RolePosition>('youth_coach', () => tEnums('coachSpecialization.youth_coach')),
  option<RolePosition>('goalkeeper_coach', () => tEnums('coachSpecialization.goalkeeper_coach')),
  option<RolePosition>('strength_conditioning', () => tEnums('coachSpecialization.strength_conditioning')),
  option<RolePosition>('performance_analyst', () => tEnums('coachSpecialization.performance_analyst')),
  option<RolePosition>('sports_scientist', () => tEnums('coachSpecialization.sports_scientist')),
  option<RolePosition>('other_coach', () => tClub('postRoleLib.otherCoach')),
]

/**
 * English position names for the saved default title (rule: stored values
 * stay English, whatever the interface language).
 */
const POSITION_EN: Partial<Record<RolePosition, string>> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  midfielder: 'Midfielder',
  forward: 'Forward',
  head_coach: 'Head coach',
  assistant_coach: 'Assistant coach',
  youth_coach: 'Youth coach',
  goalkeeper_coach: 'Goalkeeper coach',
  strength_conditioning: 'Strength & conditioning',
  performance_analyst: 'Performance analyst',
  sports_scientist: 'Sports scientist',
  other_coach: 'Other',
}

/** English team words for the saved default title ("Men's midfielder"). */
const TEAM_EN: Record<string, string> = { Men: "Men's", Women: "Women's", Mixed: 'Mixed', Boys: 'Boys', Girls: 'Girls' }

/**
 * Teams a PLAYER role can target. No Boys/Girls: under-18s are never
 * recruitable (founder ruling 2026-09-25; the DB rejects them too).
 */
export const TEAMS: { value: RoleGender; label: string }[] = [
  option<RoleGender>('Men', () => tClub('postRoleLib.teams.men')),
  option<RoleGender>('Women', () => tClub('postRoleLib.teams.women')),
  option<RoleGender>('Mixed', () => tClub('postRoleLib.teams.mixed')),
]

/**
 * Teams a COACH role can target: the player teams plus Boys and Girls
 * (founder ruling 2026-09-26). Required like a player role's team.
 */
export const COACH_TEAMS: { value: RoleGender; label: string }[] = [
  ...TEAMS,
  option<RoleGender>('Boys', () => tClub('postRoleLib.teams.boys')),
  option<RoleGender>('Girls', () => tClub('postRoleLib.teams.girls')),
]

export function teamsFor(type: RoleType): typeof TEAMS {
  return type === 'player' ? TEAMS : COACH_TEAMS
}

export { COACH_TEAM_HINT, coachTeamHint } from '@/lib/youthRoles'

/** Player ↔ Coach: the team stays, except Boys/Girls, which a player role can't use. */
export function switchRoleType(d: PostRoleDraft, type: RoleType): PostRoleDraft {
  if (d.type === type) return d
  return { ...d, type, position: null, skills: [], gender: type === 'player' ? playerRoleGender(d.gender) : d.gender }
}

export const LEVELS: { value: RoleLevel; label: string }[] = [
  option<RoleLevel>('competitive', () => tClub('postRoleLib.levels.competitive')),
  option<RoleLevel>('high_performance', () => tClub('postRoleLib.levels.highPerformance')),
  option<RoleLevel>('elite', () => tClub('postRoleLib.levels.elite')),
]

/** Figma's short labels for the specialist vocabulary (lib/specialistSkills values). */
export const SKILLS: { value: string; label: string; gkOnly?: boolean }[] = [
  option('drag_flicker', () => tClub('postRoleLib.skills.dragFlicker')),
  option('penalty_corner', () => tClub('postRoleLib.skills.penaltyCorner')),
  option('defensive_leader', () => tClub('postRoleLib.skills.defensiveLeader')),
  option('target_forward', () => tClub('postRoleLib.skills.targetForward')),
  option('pressing', () => tClub('postRoleLib.skills.pressing')),
  option('playmaker', () => tClub('postRoleLib.skills.playmaker')),
  option('indoor', () => tClub('postRoleLib.skills.indoor')),
  withLazyText({ value: 'sweeper_keeper', gkOnly: true }, { label: () => tClub('postRoleLib.skills.sweeperKeeper') }),
]

export function skillsFor(position: RolePosition | null): typeof SKILLS {
  return SKILLS.filter((s) => !s.gkOnly || position === 'goalkeeper')
}

export const PAY_OPTIONS: { value: RolePay; label: string }[] = [
  option<RolePay>('paid', () => tClub('postRoleLib.pay.paid')),
  option<RolePay>('unpaid_development', () => tClub('postRoleLib.pay.unpaid')),
  option<RolePay>('either', () => tClub('postRoleLib.pay.either')),
]

export const PACKAGE_KEYS = ['housing', 'flights', 'insurance', 'job', 'car', 'visa', 'bonuses', 'equipment'] as const

/** Length picker (DEV NOTE 330:774): writes clean text, never "7" or "3 month". */
export const DURATION_OPTIONS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => (i === 0 ? '1 month' : `${i + 1} months`)),
  'Full season',
  'Permanent',
]

/**
 * The picker's option as the club reads it. The value itself is saved
 * (duration_text) and stays English; only known options are translated.
 */
export function durationLabel(value: string): string {
  const m = /^(\d+) months?$/.exec(value)
  if (m) return tClub('postRoleLib.duration.months', { count: Number(m[1]) })
  if (value === 'Full season') return tClub('postRoleLib.duration.fullSeason')
  if (value === 'Permanent') return tClub('postRoleLib.duration.permanent')
  return value
}

/** Legacy duration text → the picker's value when it maps cleanly. */
export function normalizeDuration(raw: string | null | undefined): string | null {
  const t = formatDurationText(raw)
  if (!t) return null
  const m = /^(\d+)\s*months?$/i.exec(t)
  if (m) {
    const n = Number(m[1])
    return n === 1 ? '1 month' : `${n} months`
  }
  const hit = DURATION_OPTIONS.find((o) => o.toLowerCase() === t.toLowerCase())
  return hit ?? t
}

export interface ClubDefaults {
  baseLocation: string | null
  countryName: string | null
  /** A coach's current club, prefilled as "On behalf of". */
  organizationName?: string | null
}

/** City and country prefilled from the club profile ("Kilkenny, Ireland"). */
export function locationFromClub({ baseLocation, countryName }: ClubDefaults): { city: string; country: string } {
  const parts = (baseLocation ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const city = parts[0] ?? ''
  const country = countryName?.trim() || (parts.length > 1 ? parts[parts.length - 1] : '')
  return { city, country }
}

export function emptyDraft(defaults: ClubDefaults): PostRoleDraft {
  const { city, country } = locationFromClub(defaults)
  return {
    id: null,
    type: 'player',
    position: null,
    positionRequired: true,
    gender: null,
    title: '',
    level: null,
    levelRequired: false,
    skills: [],
    skillsRequired: false,
    startDate: null,
    duration: null,
    availabilityRequired: false,
    city,
    country,
    locationRequired: false,
    pay: null,
    payRequired: false,
    benefits: [],
    customBenefits: [],
    otherBenefits: [],
    euPassport: false,
    description: '',
    coverUrl: null,
    organizationName: defaults.organizationName?.trim() ?? '',
  }
}

export function draftFromRow(v: Vacancy): PostRoleDraft {
  const level = (['competitive', 'high_performance', 'elite'] as string[]).includes(v.level_sought ?? '') ? (v.level_sought as RoleLevel) : null
  const pay = (['paid', 'unpaid_development', 'either'] as string[]).includes(v.compensation ?? '') ? (v.compensation as RolePay) : null
  return {
    id: v.id,
    type: v.opportunity_type ?? 'player',
    position: v.position ?? null,
    positionRequired: v.position_required ?? false,
    // A legacy youth player role opens with no team, so the club has to pick an adult one.
    gender: (v.opportunity_type ?? 'player') === 'player' ? playerRoleGender(v.gender) : v.gender ?? null,
    title: v.title ?? '',
    level,
    levelRequired: v.level_required ?? false,
    skills: v.specialist_skills_wanted ?? [],
    skillsRequired: v.specialists_required ?? false,
    startDate: v.start_date ?? null,
    duration: normalizeDuration(v.duration_text),
    availabilityRequired: v.availability_required ?? false,
    city: v.location_city ?? '',
    country: v.location_country ?? '',
    locationRequired: v.location_required ?? false,
    pay,
    payRequired: v.compensation_required ?? false,
    benefits: (v.benefits ?? []).filter((b) => (PACKAGE_KEYS as readonly string[]).includes(b)),
    customBenefits: v.custom_benefits ?? [],
    otherBenefits: (v.benefits ?? []).filter((b) => !(PACKAGE_KEYS as readonly string[]).includes(b)),
    euPassport: v.eu_passport_required ?? false,
    description: v.description ?? '',
    coverUrl: v.cover_url ?? null,
    organizationName: v.organization_name ?? '',
  }
}

function positionLabel(position: RolePosition | null): string | null {
  if (!position) return null
  return [...PLAYER_POSITIONS, ...COACH_POSITIONS].find((p) => p.value === position)?.label ?? humanizeToken(position)
}

/**
 * Title when the club leaves it empty: "Men's midfielder", "Girls head coach"
 * (the column is NOT NULL). Saved on the role and shown to everyone, so it is
 * always built in English.
 */
export function defaultTitle(d: Pick<PostRoleDraft, 'type' | 'position' | 'gender'>): string {
  if (!d.position) return ''
  const pos = POSITION_EN[d.position] ?? humanizeToken(d.position) ?? d.position
  const gender = d.type === 'player' ? playerRoleGender(d.gender) : d.gender
  const team = gender ? TEAM_EN[gender] : undefined
  return team ? `${team} ${pos.toLowerCase()}` : pos
}

export type Step = 1 | 2 | 3

/** What blocks Continue on a step, in the club's words; null = can continue. */
export function stepProblem(d: PostRoleDraft, step: Step): string | null {
  if (step === 1) {
    if (!d.position) return d.type === 'player' ? tClub('postRoleLib.problems.position') : tClub('postRoleLib.problems.role')
    // Every role names its team; a player role only an adult one.
    if (!d.gender || (d.type === 'player' && isYouthGender(d.gender))) return tClub('postRoleLib.problems.team')
    if (d.title.trim().length > TITLE_MAX) return tClub('postRoleLib.problems.titleLength', { max: TITLE_MAX })
    if (d.skillsRequired && d.skills.length === 0) return tClub('postRoleLib.problems.skill')
    return null
  }
  if (step === 2) {
    if (!d.city.trim() || !d.country.trim()) return tClub('postRoleLib.problems.location')
    return null
  }
  if (d.description.length > DESCRIPTION_MAX) return tClub('postRoleLib.problems.descriptionLength', { max: DESCRIPTION_MAX })
  return stepProblem(d, 1) ?? stepProblem(d, 2)
}

/** The opportunities row for this draft. Player-only fields are cleared for coach roles; the team is kept for both. */
export function draftToRow(d: PostRoleDraft, clubId: string, status: 'draft' | 'open'): OpportunityInsert {
  const player = d.type === 'player'
  return {
    club_id: clubId,
    opportunity_type: d.type,
    position: d.position,
    position_required: player && d.positionRequired,
    gender: player ? playerRoleGender(d.gender) : d.gender,
    title: d.title.trim().slice(0, TITLE_MAX) || defaultTitle(d) || 'New opportunity',
    level_sought: d.level,
    level_required: player && d.levelRequired && d.level !== null,
    specialist_skills_wanted: player ? pruneSpecialistSkillsForPosition(d.skills, d.position) : [],
    specialists_required: player && d.skillsRequired && d.skills.length > 0,
    start_date: d.startDate,
    duration_text: d.duration,
    availability_required: player && d.availabilityRequired,
    location_city: d.city.trim(),
    location_country: d.country.trim(),
    location_required: player && d.locationRequired,
    compensation: d.pay,
    compensation_required: player && d.payRequired && d.pay !== null,
    benefits: [...d.benefits, ...(d.otherBenefits ?? []).filter((b) => !d.benefits.includes(b))],
    custom_benefits: d.customBenefits,
    eu_passport_required: d.euPassport,
    description: d.description.trim().slice(0, DESCRIPTION_MAX) || null,
    cover_url: d.coverUrl,
    organization_name: d.organizationName.trim() || null,
    status,
  }
}

type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert']
export type OpportunityEditPatch = Omit<OpportunityInsert, 'status' | 'club_id' | 'published_at'>

/**
 * The update for editing a role that is already live (open or closed): every
 * form field, but never status, published_at or club_id — editing must not
 * re-publish, re-date or unpublish the role. filled_via_hockia and the close
 * fields are not form fields, so they are never sent either.
 */
export function draftToEditPatch(d: PostRoleDraft, clubId: string): OpportunityEditPatch {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { status: _status, club_id: _clubId, published_at: _publishedAt, ...patch } = draftToRow(d, clubId, 'open')
  return patch
}

/** The role as the preview card renders it (Vacancy shape, no id yet). */
export function draftAsVacancy(d: PostRoleDraft, clubId: string): Vacancy {
  const now = new Date().toISOString()
  return { ...(draftToRow(d, clubId, 'open') as unknown as Vacancy), id: d.id ?? 'preview', created_at: now, published_at: now }
}

export interface ChecklistItem { key: string; label: string; ok: boolean }

/**
 * Step 3's "What players ask first" (DEV NOTE 330:781): client-side, no
 * score. Coach roles get the coach version, built only from fields the form
 * collects (founder review 2026-09-26).
 */
export function roleChecklist(d: PostRoleDraft): ChecklistItem[] {
  return d.type === 'player' ? playerChecklist(d) : coachChecklist(d)
}

/** Step 3 headings: who the preview and checklist speak for. */
export function checkStepCopy(type: RoleType): { sub: string; checklistTitle: string } {
  const player = type === 'player'
  return {
    sub: player ? tClub('postRoleLib.check.subPlayer') : tClub('postRoleLib.check.subCoach'),
    checklistTitle: player ? tClub('postRoleLib.check.titlePlayer') : tClub('postRoleLib.check.titleCoach'),
  }
}

/**
 * Level hint (founder copy 2026-09-26). The level ranks applicants and is
 * never shown to them — RoleCard, the role page and My applications carry
 * no level.
 */
export function levelHint(type: RoleType): string {
  return type === 'player' ? tClub('postRoleLib.levelHint.player') : tClub('postRoleLib.levelHint.coach')
}

/** Step 2 ("The offer") hints, in the words of who the role is for. */
export function offerStepCopy(type: RoleType): { when: string; package: string; euPassport: string } {
  if (type === 'player') {
    return {
      when: tClub('postRoleLib.offer.whenPlayer'),
      package: tClub('postRoleLib.offer.packagePlayer'),
      euPassport: tClub('postRoleLib.offer.euPassportPlayer'),
    }
  }
  return {
    when: tClub('postRoleLib.offer.whenCoach'),
    package: tClub('postRoleLib.offer.packageCoach'),
    euPassport: tClub('postRoleLib.offer.euPassportCoach'),
  }
}

export function coachChecklist(d: PostRoleDraft): ChecklistItem[] {
  return [
    { key: 'when', label: tClub('postRoleLib.checklist.coachWhen'), ok: Boolean(d.startDate && d.duration) },
    { key: 'pay', label: tClub('postRoleLib.checklist.pay'), ok: d.pay !== null },
    { key: 'relocation', label: tClub('postRoleLib.checklist.coachRelocation'), ok: d.benefits.includes('housing') && d.benefits.includes('visa') },
    { key: 'team', label: tClub('postRoleLib.checklist.coachTeam'), ok: Boolean(d.gender && d.level) },
    { key: 'about', label: tClub('postRoleLib.checklist.coachAbout'), ok: d.description.trim().length >= 40 },
  ]
}

/** "What players ask first" (DEV NOTE 330:781): client-side, no score. */
export function playerChecklist(d: PostRoleDraft): ChecklistItem[] {
  return [
    { key: 'when', label: tClub('postRoleLib.checklist.playerWhen'), ok: Boolean(d.startDate && d.duration) },
    { key: 'pay', label: tClub('postRoleLib.checklist.pay'), ok: d.pay !== null },
    { key: 'relocation', label: tClub('postRoleLib.checklist.playerRelocation'), ok: d.benefits.includes('housing') && d.benefits.includes('flights') },
    { key: 'about', label: tClub('postRoleLib.checklist.playerAbout'), ok: d.description.trim().length >= 40 },
  ]
}

/**
 * "Must have: Midfielder. Always required: Men's team. Everything else ranks
 * players, it doesn't block them." Coach roles are never gated by team
 * (lib/opportunityEligibility), so their team isn't listed as a blocker.
 */
export function hardnessFootnote(d: PostRoleDraft): string {
  const must: string[] = []
  const player = d.type === 'player'
  if (player) {
    if (d.positionRequired && d.position) must.push(positionLabel(d.position) as string)
    if (d.levelRequired && d.level) must.push(LEVELS.find((l) => l.value === d.level)?.label ?? d.level)
    if (d.skillsRequired && d.skills.length) must.push(d.skills.map((s) => SKILLS.find((x) => x.value === s)?.label ?? s).join(', '))
    if (d.availabilityRequired && d.startDate) must.push(tClub('postRoleLib.footnote.availableFromStart'))
    if (d.locationRequired && d.city) must.push(tClub('postRoleLib.footnote.basedIn', { city: d.city }))
    if (d.payRequired && d.pay) must.push(PAY_OPTIONS.find((p) => p.value === d.pay)?.label.toLowerCase() ?? d.pay)
  }
  const always: string[] = []
  if (player && d.gender) always.push(tClub('postRoleLib.footnote.team', { team: genderPill(d.gender)?.label ?? d.gender }))
  if (d.euPassport) always.push(tClub('postRoleLib.footnote.euPassport'))
  const parts: string[] = []
  if (must.length) parts.push(tClub('postRoleLib.footnote.mustHave', { items: must.join(', ') }))
  if (always.length) parts.push(tClub('postRoleLib.footnote.alwaysRequired', { items: always.join(', ') }))
  if (must.length || always.length) parts.push(player ? tClub('postRoleLib.footnote.restRanksPlayers') : tClub('postRoleLib.footnote.restRanksCoaches'))
  else parts.push(player ? tClub('postRoleLib.footnote.nothingBlocksPlayers') : tClub('postRoleLib.footnote.nothingBlocksCoaches'))
  return parts.join(' ')
}

/** Recruiting-context target for Find players: youth teams rank the adult pool of the same side. */
export function recruitingTarget(gender: RoleGender | null): 'Men' | 'Women' | 'Mixed' | null {
  if (gender === 'Men' || gender === 'Boys') return 'Men'
  if (gender === 'Women' || gender === 'Girls') return 'Women'
  if (gender === 'Mixed') return 'Mixed'
  return null
}

/** "1 Sep" for the Start field and the step-2 summary (day first, lib/dayFirst; the year only when it isn't this year). */
export function startLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  return dayFirst(iso.slice(0, 10), { now })
}

/** Role posted's own route, so a refresh re-renders it from the saved role. */
export function rolePostedPath(roleId: string): string {
  return `/dashboard/opportunities/${roleId}/posted`
}

export interface RolePostedCopy {
  title: string
  body: string
  findLabel: string
  pushTitle: string
}

/**
 * Where "Find … for this role" goes: player roles → Find players ranked for
 * the role (?role= also activates it there on a direct link); coach roles →
 * Community coaches. The caller activates the role's recruiting context
 * before navigating, so the next screen is scoped to THIS role.
 */
export function roleFindPath(type: PostRoleDraft['type'], roleId: string): string {
  return type === 'player' ? `/dashboard/find-players?role=${encodeURIComponent(roleId)}` : '/community/coaches'
}

/**
 * Role posted (Figma 04 Club D1.26 368:780; DEV NOTE 368:1098). Title =
 * "<position> is live". Coach roles find coaches, not players (founder
 * ruling 2026-09-26).
 */
export function rolePostedCopy(d: Pick<PostRoleDraft, 'type' | 'position'>): RolePostedCopy {
  const player = d.type === 'player'
  const position = positionLabel(d.position)
  return {
    title: position ? tClub('postRoleLib.posted.title', { position }) : tClub('postRoleLib.posted.titleFallback'),
    body: player ? tClub('postRoleLib.posted.bodyPlayer') : tClub('postRoleLib.posted.bodyCoach'),
    findLabel: player ? tClub('postRoleLib.posted.findPlayers') : tClub('postRoleLib.posted.findCoaches'),
    pushTitle: player ? tClub('postRoleLib.posted.pushPlayers') : tClub('postRoleLib.posted.pushCoaches'),
  }
}

/** The reply window line; `days` = application_response_settings.expiry_days. */
export function replyWindowLine(days: number): string {
  return tClub('postRoleLib.replyWindow', { count: days })
}
