/**
 * Edge mirror of the SQL visibility predicates, for functions that read
 * profiles with the service client (RLS does not apply there).
 *
 *   profileIsHidden  ≡ public.profile_is_hidden(is_blocked, frozen_minor_at)
 *   profileIsAdult   ≡ public.profile_is_adult(date_of_birth): known DOB and
 *                      at least 18 today (UTC); unknown DOB = false.
 *
 * Keep in sync with supabase/migrations/20260707151000_age_gate_core.sql and
 * 20260928210000_d2_open_to_play_age_league.sql.
 */

export function profileIsHidden(isBlocked: boolean | null | undefined, frozenMinorAt: string | null | undefined): boolean {
  return Boolean(isBlocked) || (frozenMinorAt !== null && frozenMinorAt !== undefined)
}

export function profileIsAdult(dateOfBirth: string | null | undefined, now: Date = new Date()): boolean {
  if (!dateOfBirth) return false
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateOfBirth)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const ty = now.getUTCFullYear()
  const tm = now.getUTCMonth() + 1
  const td = now.getUTCDate()
  let age = ty - y
  if (tm < mo || (tm === mo && td < d)) age -= 1
  return age >= 18
}

export interface TargetVisibilityInput {
  target: {
    is_blocked: boolean | null
    frozen_minor_at: string | null
    date_of_birth: string | null
    is_test_account: boolean | null
  }
  viewerIsTestAccount: boolean
  /** A user_blocks row exists in either direction. */
  blockedPair: boolean
  now?: Date
}

/**
 * True when the target must look like it does not exist to this viewer:
 * hidden, under 18 / unknown age, a test account seen by a real member, or
 * a block either way.
 */
export function targetIsInvisible(input: TargetVisibilityInput): boolean {
  const { target } = input
  if (profileIsHidden(target.is_blocked, target.frozen_minor_at)) return true
  if (!profileIsAdult(target.date_of_birth, input.now)) return true
  if (target.is_test_account && !input.viewerIsTestAccount) return true
  return input.blockedPair
}
