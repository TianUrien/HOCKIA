/**
 * Open to play (D2 · 30-second profile) — the client side of
 * public.set_open_to_play() and public.can_toggle_open_to_play().
 *
 * set_open_to_play saves open_to_play + available_from + availability_duration
 * in one write and stamps availability_confirmed_at (founder ruling
 * 2026-09-26: D2 records the confirmation; no reminder job). It refuses to turn
 * Open to play ON for anyone who is not 18+ by date of birth; turning it OFF is
 * always allowed. The switch itself is only shown when canToggleOpenToPlay()
 * is true (16–17-year-olds and unknown ages don't get it).
 */
import { supabase } from '@/lib/supabase'
import { isMissingBackendError } from '@/lib/missingBackend'
import { isAvailabilityDuration, type AvailabilityDuration } from '@/lib/availabilityDuration'

export {
  AVAILABILITY_DURATIONS,
  AVAILABILITY_DURATION_LABELS,
  isAvailabilityDuration,
  type AvailabilityDuration,
} from '@/lib/availabilityDuration'

export type SetOpenToPlayOutcome =
  | 'saved'
  | 'unauthenticated'
  | 'invalid_input'
  | 'not_found'
  | 'not_a_player'
  | 'under_18'
  | 'dob_required'
  | 'invalid_duration'
  | 'invalid_date'
  | 'error'

export interface SetOpenToPlayResult {
  ok: boolean
  outcome: SetOpenToPlayOutcome
  /** Server timestamp written to profiles.availability_confirmed_at (on success). */
  confirmedAt: string | null
  error?: unknown
}

export interface SetOpenToPlayInput {
  open: boolean
  /** 'YYYY-MM-DD' or null for "no start date". */
  availableFrom?: string | null
  duration?: AvailabilityDuration | null
}

const KNOWN_OUTCOMES: readonly SetOpenToPlayOutcome[] = [
  'saved', 'unauthenticated', 'invalid_input', 'not_found', 'not_a_player',
  'under_18', 'dob_required', 'invalid_duration', 'invalid_date',
]

/** Map the RPC's jsonb reply to a typed result. Exported for tests. */
export function parseSetOpenToPlayResponse(raw: unknown): SetOpenToPlayResult {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const outcome = KNOWN_OUTCOMES.includes(obj.outcome as SetOpenToPlayOutcome)
    ? (obj.outcome as SetOpenToPlayOutcome)
    : 'error'
  const confirmedAt = typeof obj.availability_confirmed_at === 'string' ? obj.availability_confirmed_at : null
  return { ok: outcome === 'saved', outcome, confirmedAt }
}

/** Save the Open to play screen. Never throws; inspect `ok` / `outcome`. */
export async function setOpenToPlay(input: SetOpenToPlayInput): Promise<SetOpenToPlayResult> {
  if (input.duration != null && !isAvailabilityDuration(input.duration)) {
    return { ok: false, outcome: 'invalid_duration', confirmedAt: null }
  }
  const { data, error } = await supabase.rpc('set_open_to_play', {
    p_open: input.open,
    // The generated Args type marks these optional (SQL DEFAULT NULL); an
    // explicit null clears the stored value, which is what the screen means.
    p_available_from: (input.availableFrom ?? null) as string | undefined,
    p_duration: (input.duration ?? null) as string | undefined,
  })
  if (error) return { ok: false, outcome: 'error', confirmedAt: null, error }
  return parseSetOpenToPlayResponse(data)
}

/** Should the Open to play switch be shown to this profile? (18+ players only). */
export async function canToggleOpenToPlay(profileId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_toggle_open_to_play', { p_uid: profileId })
  if (error) return false
  return data === true
}

/**
 * Like canToggleOpenToPlay, but tells "the RPC isn't deployed here yet" (null)
 * apart from a real answer, so the screen can fall back to the date of birth
 * it already has instead of hiding the switch from everyone.
 */
export async function checkCanToggleOpenToPlay(profileId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('can_toggle_open_to_play', { p_uid: profileId })
  if (error) return isMissingBackendError(error) ? null : false
  return data === true
}

/** 18+ by a known date of birth ('YYYY-MM-DD'), UTC calendar — mirrors profile_is_adult(). */
export function isAdultByDob(dob: string | null | undefined, today: Date = new Date()): boolean {
  const m = dob ? /^(\d{4})-(\d{2})-(\d{2})/.exec(dob) : null
  if (!m) return false
  const y = Number(m[1]); const mo = Number(m[2]); const d = Number(m[3])
  const ty = today.getUTCFullYear(); const tm = today.getUTCMonth() + 1; const td = today.getUTCDate()
  const age = ty - y - (tm < mo || (tm === mo && td < d) ? 1 : 0)
  return age >= 18
}
