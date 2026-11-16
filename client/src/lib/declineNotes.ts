/**
 * Club speed · fixed decline notes (Figma 05 CS5 204:1194 / CS6 204:1269).
 *
 * Founder ruling 2026-10-17: the note for declining several applicants at once,
 * and for telling everyone still waiting when a role closes, is a FIXED
 * template, not a Hockia AI draft. The club can edit the body; each player gets
 * it with their own first name in the greeting ("Hi Ana,"). Nothing here calls
 * a model.
 */
import { tRecruiting } from '@/i18n/ns/recruiting'
import { withLazyText } from '@/lib/opportunityLazyText'

type BulkReasonCode = 'position_filled' | 'different_level' | 'timing' | 'location' | 'eligibility' | 'other'
const BULK_REASON_KEYS: Record<BulkReasonCode, () => string> = {
  position_filled: () => tRecruiting('declineNotes.reasons.positionFilled'),
  different_level: () => tRecruiting('declineNotes.reasons.differentLevel'),
  timing: () => tRecruiting('declineNotes.reasons.timing'),
  location: () => tRecruiting('declineNotes.reasons.location'),
  eligibility: () => tRecruiting('declineNotes.reasons.eligibility'),
  other: () => tRecruiting('declineNotes.reasons.other'),
}

/** The reasons offered when declining several at once (Figma CS5 shows six).
 *  `label` is read in the current language each time. */
export const BULK_DECLINE_REASONS: { code: string; label: string }[] = (Object.keys(BULK_REASON_KEYS) as BulkReasonCode[])
  .map((code) => withLazyText({ code }, { label: BULK_REASON_KEYS[code] }))

/** The club note cap on the server (application-feedback CLUB_NOTE_MAX_CHARS). */
export const CLUB_NOTE_MAX = 600
/** Room left for the greeting ("Hi <first name>, "), so every personal note fits the cap. */
export const DECLINE_BODY_MAX = 540

const WHY: Record<string, () => string> = {
  position_filled: () => tRecruiting('declineNotes.why.positionFilled'),
  different_position: () => tRecruiting('declineNotes.why.differentPosition'),
  different_level: () => tRecruiting('declineNotes.why.differentLevel'),
  timing: () => tRecruiting('declineNotes.why.timing'),
  location: () => tRecruiting('declineNotes.why.location'),
  eligibility: () => tRecruiting('declineNotes.why.eligibility'),
  profile_incomplete: () => tRecruiting('declineNotes.why.profileIncomplete'),
  video_missing: () => tRecruiting('declineNotes.why.videoMissing'),
  other: () => tRecruiting('declineNotes.why.other'),
  role_closed: () => tRecruiting('declineNotes.why.roleClosed'),
}

/** The note body after the greeting, for a reason code (or 'role_closed'). */
export function declineNoteBody(reason: string, roleTitle: string): string {
  const why = (WHY[reason] ?? WHY.other)()
  const title = roleTitle.trim() || tRecruiting('declineNotes.thisOpportunity')
  return tRecruiting('declineNotes.body', { title, why })
}

/** "Hi Ana," — or "Hello," when the profile has no name. */
export function declineGreeting(firstName: string | null | undefined): string {
  const name = firstName?.trim()
  return name ? tRecruiting('declineNotes.greeting', { name }) : tRecruiting('declineNotes.greetingNoName')
}

/** The note one player receives: their own greeting, then the shared body (trimmed to the cap). */
export function personalDeclineNote(firstName: string | null | undefined, body: string): string {
  const text = `${declineGreeting(firstName)} ${body.trim()}`
  return text.length > CLUB_NOTE_MAX ? text.slice(0, CLUB_NOTE_MAX) : text
}

/** First word of a full name, or null when there is none. */
export function firstWord(fullName: string | null | undefined): string | null {
  return fullName?.trim().split(/\s+/)[0] || null
}

/** "Ana Costa, Mia Keller" — up to three names, then "and N more". */
export function namesLine(names: string[]): string {
  const shown = names.slice(0, 3).join(', ')
  return names.length > 3 ? tRecruiting('declineNotes.namesMore', { names: shown, count: names.length - 3 }) : shown
}

/** Undo toast after a bulk decision. */
export function bulkDecisionToast(count: number, status: 'maybe' | 'rejected'): string {
  return status === 'maybe' ? tRecruiting('declineNotes.bulkMaybe', { count }) : tRecruiting('declineNotes.bulkDeclined', { count })
}
