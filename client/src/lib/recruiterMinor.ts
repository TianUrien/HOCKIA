import { isRecruitingViewer, type RecruiterAccessProfile } from './recruiterAccess'

/**
 * Founder ruling 2026-10-06: clubs and coaches who recruit cannot START a
 * conversation with an under-18 (and an under-18 cannot start one with them).
 * Existing conversations keep working. The database refuses the conversation
 * insert with this exact message and the DETAIL code below.
 */
export const RECRUITER_MINOR_MESSAGE = "This member can't be contacted by clubs or coaches."
export const RECRUITER_MINOR_CODE = 'recruiter_minor'

type ErrorLike = { message?: unknown; details?: unknown } | null | undefined

/** True when a Supabase error is the recruiter / under-18 refusal. */
export function isRecruiterMinorError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as ErrorLike
  return e?.details === RECRUITER_MINOR_CODE || e?.message === RECRUITER_MINOR_MESSAGE
}

/**
 * Whether a viewer may not START a conversation with a member whose age the page
 * already knows (server-computed). Unknown age → not decided here; the server
 * still has the final word.
 */
export function recruiterCannotStartWith(
  viewer: RecruiterAccessProfile | null | undefined,
  memberAge: number | null | undefined,
): boolean {
  return isRecruitingViewer(viewer) && typeof memberAge === 'number' && memberAge < 18
}
