import type { Database } from '@/lib/database.types'
import type { Vacancy } from '@/lib/supabase'
import { formatDurationText, genderPill } from '@/lib/opportunityCopy'
import { humanizeToken } from '@/lib/identity'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'

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
  euPassport: boolean
  description: string
}

export const TITLE_MAX = 120
export const DESCRIPTION_MAX = 2000

export const PLAYER_POSITIONS: { value: RolePosition; label: string }[] = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
]

export const COACH_POSITIONS: { value: RolePosition; label: string }[] = [
  { value: 'head_coach', label: 'Head coach' },
  { value: 'assistant_coach', label: 'Assistant coach' },
  { value: 'youth_coach', label: 'Youth coach' },
  { value: 'goalkeeper_coach', label: 'Goalkeeper coach' },
  { value: 'strength_conditioning', label: 'Strength & conditioning' },
  { value: 'performance_analyst', label: 'Performance analyst' },
  { value: 'sports_scientist', label: 'Sports scientist' },
  { value: 'other_coach', label: 'Other' },
]

export const TEAMS: { value: RoleGender; label: string }[] = [
  { value: 'Men', label: 'Men' },
  { value: 'Women', label: 'Women' },
  { value: 'Mixed', label: 'Mixed' },
  { value: 'Boys', label: 'Boys' },
  { value: 'Girls', label: 'Girls' },
]

export const LEVELS: { value: RoleLevel; label: string }[] = [
  { value: 'competitive', label: 'Competitive' },
  { value: 'high_performance', label: 'High performance' },
  { value: 'elite', label: 'Elite' },
]

/** Figma's short labels for the specialist vocabulary (lib/specialistSkills values). */
export const SKILLS: { value: string; label: string; gkOnly?: boolean }[] = [
  { value: 'drag_flicker', label: 'Drag flicker' },
  { value: 'penalty_corner', label: 'Penalty corner' },
  { value: 'defensive_leader', label: 'Defensive leader' },
  { value: 'target_forward', label: 'Target forward' },
  { value: 'pressing', label: 'Pressing' },
  { value: 'playmaker', label: 'Playmaker' },
  { value: 'indoor', label: 'Indoor' },
  { value: 'sweeper_keeper', label: 'Sweeper keeper', gkOnly: true },
]

export function skillsFor(position: RolePosition | null): typeof SKILLS {
  return SKILLS.filter((s) => !s.gkOnly || position === 'goalkeeper')
}

export const PAY_OPTIONS: { value: RolePay; label: string }[] = [
  { value: 'paid', label: 'Paid' },
  { value: 'unpaid_development', label: 'Unpaid' },
  { value: 'either', label: 'Either' },
]

export const PACKAGE_KEYS = ['housing', 'flights', 'insurance', 'job', 'car', 'visa', 'bonuses', 'equipment'] as const

/** Length picker (DEV NOTE 330:774): writes clean text, never "7" or "3 month". */
export const DURATION_OPTIONS: string[] = [
  ...Array.from({ length: 12 }, (_, i) => (i === 0 ? '1 month' : `${i + 1} months`)),
  'Full season',
  'Permanent',
]

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
    euPassport: false,
    description: '',
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
    gender: v.gender ?? null,
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
    euPassport: v.eu_passport_required ?? false,
    description: v.description ?? '',
  }
}

function positionLabel(position: RolePosition | null): string | null {
  if (!position) return null
  return [...PLAYER_POSITIONS, ...COACH_POSITIONS].find((p) => p.value === position)?.label ?? humanizeToken(position)
}

/** Title when the club leaves it empty: "Men's midfielder" (the column is NOT NULL). */
export function defaultTitle(d: Pick<PostRoleDraft, 'type' | 'position' | 'gender'>): string {
  const pos = positionLabel(d.position)
  if (!pos) return ''
  if (d.type !== 'player') return pos
  const team = genderPill(d.gender)?.label
  return team ? `${team} ${pos.toLowerCase()}` : pos
}

export type Step = 1 | 2 | 3

/** What blocks Continue on a step, in the club's words; null = can continue. */
export function stepProblem(d: PostRoleDraft, step: Step): string | null {
  if (step === 1) {
    if (!d.position) return d.type === 'player' ? 'Choose a position.' : 'Choose the role.'
    if (d.type === 'player' && !d.gender) return 'Choose the team.'
    if (d.title.trim().length > TITLE_MAX) return `Keep the title to ${TITLE_MAX} characters.`
    if (d.skillsRequired && d.skills.length === 0) return 'Pick a specialist skill, or make it nice to have.'
    return null
  }
  if (step === 2) {
    if (!d.city.trim() || !d.country.trim()) return 'Add where the role is.'
    return null
  }
  if (d.description.length > DESCRIPTION_MAX) return `Keep “About the role” to ${DESCRIPTION_MAX} characters.`
  return stepProblem(d, 1) ?? stepProblem(d, 2)
}

/** The opportunities row for this draft. Player-only fields are cleared for coach roles. */
export function draftToRow(d: PostRoleDraft, clubId: string, status: 'draft' | 'open'): Database['public']['Tables']['opportunities']['Insert'] {
  const player = d.type === 'player'
  return {
    club_id: clubId,
    opportunity_type: d.type,
    position: d.position,
    position_required: player && d.positionRequired,
    gender: player ? d.gender : null,
    title: d.title.trim().slice(0, TITLE_MAX) || defaultTitle(d) || 'New role',
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
    benefits: d.benefits,
    custom_benefits: d.customBenefits,
    eu_passport_required: d.euPassport,
    description: d.description.trim().slice(0, DESCRIPTION_MAX) || null,
    status,
  }
}

/** The role as the preview card renders it (Vacancy shape, no id yet). */
export function draftAsVacancy(d: PostRoleDraft, clubId: string): Vacancy {
  const now = new Date().toISOString()
  return { ...(draftToRow(d, clubId, 'open') as unknown as Vacancy), id: d.id ?? 'preview', created_at: now, published_at: now }
}

export interface ChecklistItem { key: string; label: string; ok: boolean }

/** "What players ask first" (DEV NOTE 330:781): client-side, no score. */
export function playerChecklist(d: PostRoleDraft): ChecklistItem[] {
  return [
    { key: 'when', label: 'Start date and length', ok: Boolean(d.startDate && d.duration) },
    { key: 'pay', label: 'Pay', ok: d.pay !== null },
    { key: 'relocation', label: 'Housing and flights', ok: d.benefits.includes('housing') && d.benefits.includes('flights') },
    { key: 'about', label: 'A few lines about the team and the season', ok: d.description.trim().length >= 40 },
  ]
}

/** "Must have: Midfielder. Always required: Men's team. Everything else ranks players, it doesn't block them." */
export function hardnessFootnote(d: PostRoleDraft): string {
  const must: string[] = []
  if (d.type === 'player') {
    if (d.positionRequired && d.position) must.push(positionLabel(d.position) as string)
    if (d.levelRequired && d.level) must.push(LEVELS.find((l) => l.value === d.level)?.label ?? d.level)
    if (d.skillsRequired && d.skills.length) must.push(d.skills.map((s) => SKILLS.find((x) => x.value === s)?.label ?? s).join(', '))
    if (d.availabilityRequired && d.startDate) must.push('available from the start date')
    if (d.locationRequired && d.city) must.push(`based in ${d.city}`)
    if (d.payRequired && d.pay) must.push(PAY_OPTIONS.find((p) => p.value === d.pay)?.label.toLowerCase() ?? d.pay)
  }
  const always: string[] = []
  if (d.type === 'player' && d.gender) always.push(`${genderPill(d.gender)?.label ?? d.gender} team`)
  if (d.euPassport) always.push('EU passport')
  const parts: string[] = []
  if (must.length) parts.push(`Must have: ${must.join(', ')}.`)
  if (always.length) parts.push(`Always required: ${always.join(', ')}.`)
  parts.push(must.length || always.length ? 'Everything else ranks players, it doesn’t block them.' : 'Nothing blocks players; everything here ranks them.')
  return parts.join(' ')
}

/** Recruiting-context target for Find players: youth teams rank the adult pool of the same side. */
export function recruitingTarget(gender: RoleGender | null): 'Men' | 'Women' | 'Mixed' | null {
  if (gender === 'Men' || gender === 'Boys') return 'Men'
  if (gender === 'Women' || gender === 'Girls') return 'Women'
  if (gender === 'Mixed') return 'Mixed'
  return null
}

/** "Sep 1" for the Start field (the year only when it isn't this year). */
export function startLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]
  return d.getFullYear() === now.getFullYear() ? `${month} ${d.getDate()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`
}
