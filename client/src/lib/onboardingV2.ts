/**
 * Account-first onboarding (founder rulings 2026-10-03; Figma 04 Player
 * 104:2096 First run · 114:434 Create with email · 101:892 Choose your role ·
 * 114:537 Set up About you · 114:608 Set up Where you play).
 *
 * Pure copy and rules shared by the screens and their tests. The server owns
 * every gate that matters: declare_date_of_birth decides the age outcome,
 * set_open_to_play refuses "open" for anyone under 18, prevent_role_change
 * locks the role. Nothing here is the only place a rule exists.
 */
import i18n from '@/i18n'
import { tOnboarding } from '@/i18n/ns/onboarding.core'
import { isAdultByDob } from '@/lib/openToPlay'
import { withoutSensitiveDraftFields } from '@/lib/draftPrivacy'

/** Translator for the onboarding catalog (the active language by default). */
export type OnboardingT = typeof tOnboarding

/** The English copy whatever the interface language. Only for values sent to
 *  analytics (validation `reason`), so the funnel reads the same in every language. */
export const tOnboardingEnglish: OnboardingT = i18n.getFixedT('en', 'onboarding')

export type OnboardingRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

export const ONBOARDING_ROLES: readonly OnboardingRole[] = ['player', 'coach', 'club', 'brand', 'umpire']

/** One line per role card. Player / coach / club / brand reuse the current
 *  /signup copy (still right). Umpire: the officiating-history line only —
 *  never "appointments" (founder ruling 2026-10-03). Gender-neutral. */
export function getRoleCards(t: OnboardingT = tOnboarding): ReadonlyArray<{ role: OnboardingRole; title: string; detail: string }> {
  return [
    { role: 'player', title: t('chooseRole.cards.playerTitle'), detail: t('chooseRole.cards.playerDetail') },
    { role: 'coach', title: t('chooseRole.cards.coachTitle'), detail: t('chooseRole.cards.coachDetail') },
    { role: 'club', title: t('chooseRole.cards.clubTitle'), detail: t('chooseRole.cards.clubDetail') },
    { role: 'brand', title: t('chooseRole.cards.brandTitle'), detail: t('chooseRole.cards.brandDetail') },
    { role: 'umpire', title: t('chooseRole.cards.umpireTitle'), detail: t('chooseRole.cards.umpireDetail') },
  ]
}

/** "Continue as a player" / "Continue as an umpire"; "Continue" before a choice. */
export function roleCtaLabel(role: OnboardingRole | null, t: OnboardingT = tOnboarding): string {
  if (!role) return t('chooseRole.continue')
  return t(`chooseRole.continueAs.${role}`)
}

// ── Create with email ────────────────────────────────────────────────────────

/** Production Supabase Auth requires 8+ characters with a lowercase letter,
 *  an uppercase letter and a number (local config.toml is length-only, which
 *  is how sign-up drifted: Sentry JAVASCRIPT-REACT-DC/DF, 2026-10-18).
 *  Settings and Reset password already enforce the same rule. */
export const PASSWORD_MIN_LENGTH = 8
/** English only: kept for the screens that still import it (Create with email,
 *  Reset password, outside the onboarding migration). Use `passwordHelp()`. */
export const PASSWORD_HELP = `At least ${PASSWORD_MIN_LENGTH} characters, with a lowercase letter, an uppercase letter and a number`

/** The password rule in the interface language. */
export function passwordHelp(t: OnboardingT = tOnboarding): string {
  return t('password.help', { min: PASSWORD_MIN_LENGTH })
}

export function passwordProblem(password: string, t: OnboardingT = tOnboarding): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return t('password.tooShort', { min: PASSWORD_MIN_LENGTH })
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) return t('password.mix')
  return null
}

/** Supabase's own password-policy refusal, in plain words (null for other errors). */
export function passwordPolicyMessage(message: string | undefined, t: OnboardingT = tOnboarding): string | null {
  if (!message) return null
  if (/at least one character of each/i.test(message)) return t('password.mix')
  if (/password should be at least/i.test(message)) return t('password.tooShort', { min: PASSWORD_MIN_LENGTH })
  return null
}

// ── Set up (players) ─────────────────────────────────────────────────────────

export const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number]

// Player set-up copy lives in the onboarding catalog (`player.*`). Under 18:
// the Open to play switch is not offered and the copy promises nothing about
// being suggested — suggestions are 18+ AND open, server-side.
// Ruling 2026-10-16: the 18+ gate stays; juniors get the waitlist only (an
// under-18 date of birth ends set-up on the age-gate screen).

export interface AboutYouDraft {
  fullName: string
  dateOfBirth: string
  playingCategory: string
  position: string
  secondaryPosition: string
}

/** Step 1 gate. The age itself is decided by declare_date_of_birth. */
export function aboutYouProblem(d: AboutYouDraft, t: OnboardingT = tOnboarding): string | null {
  if (!d.fullName.trim()) return t('player.errors.fullName')
  if (!d.dateOfBirth) return t('player.errors.dateOfBirth')
  if (!d.playingCategory) return t('player.errors.category')
  if (!d.position) return t('player.errors.position')
  if (d.secondaryPosition && d.secondaryPosition === d.position) return t('player.errors.secondPosition')
  return null
}

/** Whether the Open to play switch is offered on step 2: 18+ by a known DOB. */
export function offersOpenToPlay(dob: string | null | undefined, today: Date = new Date()): boolean {
  return isAdultByDob(dob, today)
}

/** Draft key for the two-step set-up (separate from the legacy 3-step wizard's). */
export function setupDraftKey(userId: string): string {
  return `hockia-onboarding-v2:player:${userId}`
}

// ── Coach wizard draft (onboarding QA 2026-10-04) ───────────────────────

/** Draft key for the coach set-up wizard; same shape as the player's. */
export function coachDraftKey(userId: string): string {
  return `hockia-onboarding-v2:coach:${userId}`
}

/** Key used by the 3-step wizard before the v2 keys (still read for coaches). */
export function legacyWizardDraftKey(role: string, userId: string): string {
  return `hockia-onboarding-draft:${role}:${userId}`
}

export type WizardDraftStep = 1 | 2 | 3

export interface WizardDraft {
  step: WizardDraftStep | null
  formData: Record<string, unknown> | null
}

/** Drafts older than this are dropped (the form may have changed since). */
export const WIZARD_DRAFT_MAX_AGE_DAYS = 7

/**
 * Parses a stored wizard draft. Null when missing, unreadable or stale; the
 * caller removes stale drafts. Pure — no storage access.
 */
export function parseWizardDraft(raw: string | null, now: number = Date.now()): WizardDraft | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { step?: unknown; formData?: unknown; savedAt?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.savedAt === 'string') {
      const ageDays = (now - Date.parse(parsed.savedAt)) / 86_400_000
      if (Number.isFinite(ageDays) && ageDays > WIZARD_DRAFT_MAX_AGE_DAYS) return null
    }
    const step = parsed.step === 1 || parsed.step === 2 || parsed.step === 3 ? parsed.step : null
    const formData = parsed.formData && typeof parsed.formData === 'object' && !Array.isArray(parsed.formData)
      ? withoutSensitiveDraftFields(parsed.formData as Record<string, unknown>)
      : null
    return { step, formData }
  } catch {
    return null
  }
}

/** Serialises a wizard draft for storage, without personal details (see draftPrivacy). */
export function serializeWizardDraft(step: WizardDraftStep, formData: Record<string, unknown>, now: number = Date.now()): string {
  return JSON.stringify({ step, formData: withoutSensitiveDraftFields(formData), savedAt: new Date(now).toISOString() })
}

// ── Set up (coaches) ─────────────────────────────────────────────────────────
// Figma New-Hockia D6: 586:806 "About you" · 586:849 "Your coaching" ·
// 587:911 missing answers · dev note 587:1030. Founder rulings 2026-10-04/05:
// the recruit question is required with nothing preselected; Skip leaves
// coach_recruits_for_team false and saves Open to coach ON.

// The rest of the coach set-up copy lives in the onboarding catalog (`coach.*`).

export function getCoachRecruitOptions(t: OnboardingT = tOnboarding): ReadonlyArray<{ value: boolean; title: string; detail: string }> {
  return [
    { value: true, title: t('coach.coaching.recruitYesTitle'), detail: t('coach.coaching.recruitYesDetail') },
    { value: false, title: t('coach.coaching.recruitNoTitle'), detail: t('coach.coaching.recruitNoDetail') },
  ]
}

export function getCoachErrors(t: OnboardingT = tOnboarding) {
  return {
    fullName: t('coach.errors.fullName'),
    dateOfBirth: t('coach.errors.dateOfBirth'),
    nationality: t('coach.errors.nationality'),
    location: t('coach.errors.location'),
    specialization: t('coach.errors.specialization'),
    specializationCustom: t('coach.errors.specializationCustom'),
    categories: t('coach.errors.categories'),
    recruits: t('coach.errors.recruits'),
  }
}

export interface CoachAboutYouDraft {
  fullName: string
  dateOfBirth: string
  nationalityCountryId: number | null
  location: string
}

export type CoachAboutYouField = 'fullName' | 'dateOfBirth' | 'nationality' | 'location'

/** Step 1 gate, one message per field (inline footnotes). Empty = valid. */
export function coachAboutYouErrors(d: CoachAboutYouDraft, t: OnboardingT = tOnboarding): Partial<Record<CoachAboutYouField, string>> {
  const errors: Partial<Record<CoachAboutYouField, string>> = {}
  const messages = getCoachErrors(t)
  if (!d.fullName.trim()) errors.fullName = messages.fullName
  if (!d.dateOfBirth) errors.dateOfBirth = messages.dateOfBirth
  if (!d.nationalityCountryId) errors.nationality = messages.nationality
  if (!d.location.trim()) errors.location = messages.location
  return errors
}

export interface CoachCoachingDraft {
  specialization: string
  specializationCustom: string
  categories: readonly string[]
  /** null = unanswered (client-only; the column stays boolean). */
  recruitsForTeam: boolean | null
}

export type CoachCoachingField = 'specialization' | 'categories' | 'recruits'

/** Step 2 gate, one message per group (D6.6b). Empty = valid. */
export function coachCoachingErrors(d: CoachCoachingDraft, t: OnboardingT = tOnboarding): Partial<Record<CoachCoachingField, string>> {
  const errors: Partial<Record<CoachCoachingField, string>> = {}
  const messages = getCoachErrors(t)
  if (!d.specialization) errors.specialization = messages.specialization
  else if (d.specialization === 'other' && !d.specializationCustom.trim()) errors.specialization = messages.specializationCustom
  if (d.categories.length === 0) errors.categories = messages.categories
  if (d.recruitsForTeam === null) errors.recruits = messages.recruits
  return errors
}

/** "Head Coach" → "Head coach" (Figma uses sentence case in the Select). */
export function sentenceCaseLabel(label: string): string {
  if (!label) return label
  return label.charAt(0) + label.slice(1).toLowerCase()
}

/**
 * Chip toggle with the existing "Any category" rule: 'any' is exclusive
 * (stored as ['any']); picking a specific category while Any is on replaces it.
 */
export function toggleCoachCategory<T extends string>(current: readonly T[], value: T, any: T): T[] {
  if (value === any) return current.includes(any) ? [] : [any]
  const specifics = current.filter((c) => c !== any)
  return specifics.includes(value) ? specifics.filter((c) => c !== value) : [...specifics, value]
}

export interface CoachSetupDraft {
  fullName: string
  dateOfBirth: string
  nationalityCountryId: number | null
  nationality2CountryId: number | null
  location: string
  baseCity: string
  baseCountryId: number | null
  locationSelected: boolean
  specialization: string
  specializationCustom: string
  categories: string[]
  currentClub: string
  currentWorldClubId: string | null
  recruitsForTeam: boolean | null
  openToCoach: boolean
}

/**
 * Reads a stored coach draft. Accepts the v2 shape `{ draft, savedAt }` and
 * migrates the 3-step wizard's `{ step, formData, savedAt }` (field names of
 * the old CompleteProfile form). The old wizard preselected "Not right now",
 * so only an explicit `true` survives as an answer. Date of birth and
 * nationalities are never restored (see draftPrivacy). Null when missing,
 * unreadable or older than WIZARD_DRAFT_MAX_AGE_DAYS. Pure.
 */
export function parseCoachDraft(raw: string | null, now: number = Date.now()): Partial<CoachSetupDraft> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { draft?: unknown; formData?: unknown; savedAt?: unknown }
    if (!parsed || typeof parsed !== 'object') return null
    if (typeof parsed.savedAt === 'string') {
      const ageDays = (now - Date.parse(parsed.savedAt)) / 86_400_000
      if (Number.isFinite(ageDays) && ageDays > WIZARD_DRAFT_MAX_AGE_DAYS) return null
    }
    const isObj = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
    if (isObj(parsed.draft)) return withoutSensitiveDraftFields(parsed.draft as Partial<CoachSetupDraft>)
    if (!isObj(parsed.formData)) return null
    const f = parsed.formData
    const out: Partial<CoachSetupDraft> = {}
    const str = (k: string) => (typeof f[k] === 'string' ? (f[k] as string) : undefined)
    const num = (k: string) => (typeof f[k] === 'number' ? (f[k] as number) : undefined)
    if (str('fullName') !== undefined) out.fullName = str('fullName')
    if (str('city') !== undefined) out.location = str('city')
    if (str('baseCity') !== undefined) out.baseCity = str('baseCity')
    if (num('baseCountryId') !== undefined) out.baseCountryId = num('baseCountryId')
    if (typeof f.locationSelected === 'boolean') out.locationSelected = f.locationSelected
    if (str('coachSpecialization') !== undefined) out.specialization = str('coachSpecialization')
    if (str('coachSpecializationCustom') !== undefined) out.specializationCustom = str('coachSpecializationCustom')
    if (Array.isArray(f.coachingCategories)) out.categories = f.coachingCategories.filter((c): c is string => typeof c === 'string')
    if (str('currentClub') !== undefined) out.currentClub = str('currentClub')
    if (typeof f.currentWorldClubId === 'string') out.currentWorldClubId = f.currentWorldClubId
    if (f.coachRecruitsForTeam === true) out.recruitsForTeam = true
    return out
  } catch {
    return null
  }
}

/** Serialises a coach draft (v2 shape, same as the player's), without personal details. */
export function serializeCoachDraft(draft: CoachSetupDraft, now: number = Date.now()): string {
  return JSON.stringify({ draft: withoutSensitiveDraftFields(draft), savedAt: new Date(now).toISOString() })
}
