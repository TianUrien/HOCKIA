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
import { isAdultByDob } from '@/lib/openToPlay'

export type OnboardingRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

export const ONBOARDING_ROLES: readonly OnboardingRole[] = ['player', 'coach', 'club', 'brand', 'umpire']

/** One line per role card. Player / coach / club / brand reuse the current
 *  /signup copy (still right). Umpire: the officiating-history line only —
 *  never "appointments" (founder ruling 2026-10-03). Gender-neutral. */
export const ROLE_CARDS: ReadonlyArray<{ role: OnboardingRole; title: string; detail: string }> = [
  { role: 'player', title: 'Player', detail: 'Build the profile that gets you found by clubs' },
  { role: 'coach', title: 'Coach', detail: 'Find coaching opportunities — and recruit players if you also manage a team' },
  { role: 'club', title: 'Club', detail: 'Recruit field hockey players with trust and context' },
  { role: 'brand', title: 'Brand', detail: 'Build your brand in the hockey community' },
  { role: 'umpire', title: 'Umpire', detail: 'Keep your officiating history in one place' },
]

export const ROLE_LOCK_COPY = 'You can’t change it later without support.'

/** "Continue as a player" / "Continue as an umpire"; "Continue" before a choice. */
export function roleCtaLabel(role: OnboardingRole | null): string {
  if (!role) return 'Continue'
  const article = /^[aeiou]/.test(role) ? 'an' : 'a'
  return `Continue as ${article} ${role}`
}

// ── Create with email ────────────────────────────────────────────────────────

/** Figma 114:434 helper: "At least 8 characters". The project's Supabase
 *  password policy is length-only (config.toml), so this is the whole rule. */
export const PASSWORD_MIN_LENGTH = 8

export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`
  return null
}

// ── Set up (players) ─────────────────────────────────────────────────────────

export const PLAYER_POSITIONS = ['goalkeeper', 'defender', 'midfielder', 'forward'] as const
export type PlayerPosition = (typeof PLAYER_POSITIONS)[number]

export const PHOTO_HELPER = 'A real match photo gets more profile views.'
export const OPEN_TO_PLAY_HELPER = 'Clubs can see you and message you about roles.'
/** Under 18: the switch is not offered and the copy promises nothing
 *  about being suggested — suggestions are 18+ AND open, server-side. */
export const OPEN_TO_PLAY_UNDER_18 = 'Open to play is for players 18 and over. Until then, clubs aren’t suggested your profile — you can still keep it up to date.'

export interface AboutYouDraft {
  fullName: string
  dateOfBirth: string
  playingCategory: string
  position: string
  secondaryPosition: string
}

/** Step 1 gate. The age itself is decided by declare_date_of_birth. */
export function aboutYouProblem(d: AboutYouDraft): string | null {
  if (!d.fullName.trim()) return 'Please add your full name.'
  if (!d.dateOfBirth) return 'Please add your date of birth.'
  if (!d.playingCategory) return 'Choose the category you play in.'
  if (!d.position) return 'Choose your position.'
  if (d.secondaryPosition && d.secondaryPosition === d.position) return 'Your second position must be different from your first.'
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
      ? (parsed.formData as Record<string, unknown>)
      : null
    return { step, formData }
  } catch {
    return null
  }
}

/** Serialises a wizard draft for storage. */
export function serializeWizardDraft(step: WizardDraftStep, formData: Record<string, unknown>, now: number = Date.now()): string {
  return JSON.stringify({ step, formData, savedAt: new Date(now).toISOString() })
}
