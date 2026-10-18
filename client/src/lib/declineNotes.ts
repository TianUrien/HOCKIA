/**
 * Club speed · fixed decline notes (Figma 05 CS5 204:1194 / CS6 204:1269).
 *
 * Founder ruling 2026-10-17: the note for declining several applicants at once,
 * and for telling everyone still waiting when a role closes, is a FIXED
 * template, not a Hockia AI draft. The club can edit the body; each player gets
 * it with their own first name in the greeting ("Hi Ana,"). Nothing here calls
 * a model.
 */

/** The reasons offered when declining several at once (Figma CS5 shows six). */
export const BULK_DECLINE_REASONS: { code: string; label: string }[] = [
  { code: 'position_filled', label: 'Position filled' },
  { code: 'different_level', label: 'Different level' },
  { code: 'timing', label: 'Timing' },
  { code: 'location', label: 'Location' },
  { code: 'eligibility', label: 'Eligibility' },
  { code: 'other', label: 'Other' },
]

/** The club note cap on the server (application-feedback CLUB_NOTE_MAX_CHARS). */
export const CLUB_NOTE_MAX = 600
/** Room left for the greeting ("Hi <first name>, "), so every personal note fits the cap. */
export const DECLINE_BODY_MAX = 540

const WHY: Record<string, string> = {
  position_filled: 'We’ve filled this position',
  different_position: 'We’re looking for a different position for this role',
  different_level: 'We’re looking for a different level for this role',
  timing: 'The timing doesn’t work for this role',
  location: 'The location doesn’t work for this role',
  eligibility: 'We need different eligibility for this role',
  profile_incomplete: 'We need a fuller profile for this role',
  video_missing: 'We need match video for this role',
  other: 'We’ve decided to go another way for this role',
  role_closed: 'We’ve closed this role',
}

/** The note body after the greeting, for a reason code (or 'role_closed'). */
export function declineNoteBody(reason: string, roleTitle: string): string {
  const why = WHY[reason] ?? WHY.other
  const title = roleTitle.trim() || 'this role'
  return `thank you for applying to ${title}. ${why}, so we won’t move forward this time. We’d be glad to see you apply to our next roles.`
}

/** "Hi Ana," — or "Hello," when the profile has no name. */
export function declineGreeting(firstName: string | null | undefined): string {
  const name = firstName?.trim()
  return name ? `Hi ${name},` : 'Hello,'
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
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown
}

/** Undo toast after a bulk decision. */
export function bulkDecisionToast(count: number, status: 'maybe' | 'rejected'): string {
  const who = count === 1 ? '1 applicant' : `${count} applicants`
  return status === 'maybe' ? `${who} marked maybe` : `${who} declined`
}
