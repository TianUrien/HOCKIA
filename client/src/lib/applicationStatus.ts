/**
 * The ONE set of words for an application's status, shown to the applicant
 * everywhere (founder ruling 2026-09-26: the My applications labels win —
 * Pulse, the application timeline, the role page and notifications reuse
 * them). `pending` reads "In review"; My applications additionally shows
 * "No reply · Nd" / "Role closed" for a pending application (see
 * applicationStatusPill in lib/opportunityCopy).
 */
export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  pending: 'In review',
  shortlisted: 'Shortlisted',
  maybe: 'Replied',
  rejected: 'Not selected',
  withdrawn: 'Withdrawn',
  no_response: 'No reply',
}

export function applicationStatusLabel(status: string | null | undefined): string | null {
  if (!status) return null
  return APPLICATION_STATUS_LABELS[status] ?? null
}

/**
 * Player-facing badge for an application status, shown on the opportunity detail
 * once the player has applied. Keeps the club's response HUMAN and kind — never a
 * raw enum value ("maybe"), never harsh.
 *
 * Statuses (application_status enum): pending | shortlisted | maybe | rejected.
 * Returns null for `pending` (and any unknown value) because the "Application
 * Submitted" pill already conveys that the application is in and awaiting review —
 * a badge there would be redundant. A badge appears only once the club responds.
 *
 * Mirrors the notification copy mapping in
 * client/src/components/notifications/config.ts (applicationStatusCopy).
 */
export function playerApplicationStatusBadge(
  status: string | null | undefined,
): { label: string; className: string } | null {
  switch (status) {
    case 'shortlisted':
      return { label: APPLICATION_STATUS_LABELS.shortlisted, className: 'bg-emerald-100 text-emerald-800' }
    case 'maybe':
      // Amber is reserved for "the viewer must act soon" (founder 2026-09-26).
      // The player can't act on "Replied", so it's neutral grey.
      return { label: APPLICATION_STATUS_LABELS.maybe, className: 'bg-gray-100 text-gray-600' }
    case 'rejected':
      // Founder ruling 2026-09-25: grey, never rose/red — not being selected
      // is not an error. One grey state, matching opportunityCopy's tone 'grey'.
      return { label: APPLICATION_STATUS_LABELS.rejected, className: 'bg-gray-100 text-gray-600' }
    case 'no_response':
      // Auto-expiry terminal state (Task 3b). Copy is deliberately NEUTRAL
      // about the club: many teams answer off-platform (15/21 opportunities
      // carry WhatsApp/email contacts), so "no response" would blame them
      // for a silence that may not exist. Never blame either side.
      return { label: APPLICATION_STATUS_LABELS.no_response, className: 'bg-gray-100 text-gray-600' }
    default:
      return null
  }
}

/**
 * Optional reason a club can attach when it marks an application "Maybe" or
 * "Not a fit". Stored as a CODE in opportunity_applications.metadata.status_reason
 * and captured per-change in application_status_history.reason. The codes are the
 * contract shared by: the club picker (ApplicantCard), the AI explanation edge
 * function (which turns a code into a kind player message), and the deterministic
 * fallback copy below. Add codes here only — never invent a code elsewhere.
 *
 * `label` is what the CLUB sees while choosing. It is never shown to the player
 * verbatim (the player sees the kind, translated message instead).
 */
export interface ApplicationStatusReason {
  code: string
  label: string
}

export const APPLICATION_STATUS_REASONS: ApplicationStatusReason[] = [
  { code: 'position_filled', label: 'Position already filled' },
  { code: 'different_position', label: 'Looking for a different position' },
  { code: 'different_level', label: 'Looking for a different level' },
  { code: 'timing', label: "Timing didn't line up" },
  { code: 'location', label: 'Location / relocation' },
  { code: 'eligibility', label: 'Passport / eligibility' },
  { code: 'profile_incomplete', label: 'Profile needs more detail' },
  { code: 'video_missing', label: 'Needs video / footage' },
  { code: 'other', label: 'Other reason' },
]

const REASON_LABEL_BY_CODE: Record<string, string> = Object.fromEntries(
  APPLICATION_STATUS_REASONS.map((r) => [r.code, r.label]),
)

/** Club-facing label for a reason code (falls back to the raw code if unknown). */
export function applicationReasonLabel(code: string | null | undefined): string | null {
  if (!code) return null
  return REASON_LABEL_BY_CODE[code] ?? null
}

/** Shown to a club that tries to change an application the player withdrew. */
export const WITHDRAWN_APPLICATION_MESSAGE = 'This player withdrew their application'

/**
 * True when a status write was refused because the application is withdrawn:
 * the DB guard's error on a direct update, or application-feedback's 409.
 */
export async function isWithdrawnApplicationError(err: unknown): Promise<boolean> {
  if (!err || typeof err !== 'object') return false
  const e = err as { message?: unknown; context?: unknown }
  if (typeof e.message === 'string' && e.message.includes('withdrawn application cannot be changed')) return true
  const res = e.context
  if (res instanceof Response && res.status === 409) {
    try {
      const body = (await res.clone().json()) as { error?: string } | null
      return body?.error === 'withdrawn'
    } catch {
      return false
    }
  }
  return false
}

/**
 * Deterministic, kind, player-facing explanation for a reason code. This is the
 * FALLBACK used when the AI explanation is unavailable, and the baseline the AI
 * is asked to stay faithful to. Tone rules: never blame the player, never imply
 * they're not good enough, and where possible point at a constructive next step.
 * Mirror any change in supabase/functions/application-feedback (Deno can't import
 * this module).
 */
export function applicationReasonPlayerCopy(code: string | null | undefined): string | null {
  switch (code) {
    case 'position_filled':
      return 'The position looks to be covered already — this is about timing, not your level. Openings still looking for your position may be a better fit.'
    case 'different_position':
      return "They're prioritising a different position for this opening. Opportunities matching your position are likely a stronger fit."
    case 'different_level':
      return "They're looking for a different level for this particular opening. Keep building your profile and proven experience."
    case 'timing':
      return "The timing or availability didn't line up for this one — worth keeping them on your radar for the future."
    case 'location':
      return "The location or relocation didn't work out for this opening."
    case 'eligibility':
      return 'There was a passport or eligibility consideration specific to this opening.'
    case 'profile_incomplete':
      return 'Adding more detail to your profile could help clubs picture you faster next time.'
    case 'video_missing':
      return 'Clubs often want footage before moving forward — a highlight reel or full-match video could strengthen future applications.'
    case 'other':
      return null
    default:
      return null
  }
}

/**
 * Always-present, kind, generic explanation shown when the application-feedback
 * edge function is UNREACHABLE (so the timeline is never a blank status node).
 * Status-based — unlike applicationReasonPlayerCopy, which is reason-based and
 * returns null for shortlisted / no-reason. The edge function's own fallbackMessage
 * is the richer (club- and position-aware) version; this is the client's last resort.
 */
export function applicationStatusFallbackMessage(
  status: string | null | undefined,
  reason: string | null | undefined,
): string | null {
  const reasonCopy = applicationReasonPlayerCopy(reason)
  switch (status) {
    case 'shortlisted':
      return "Good news — you've been shortlisted. Keep your profile sharp while the club reviews."
    case 'maybe':
      return reasonCopy
        ? `The club replied — no final decision yet. ${reasonCopy}`
        : 'The club replied — no final decision yet.'
    case 'rejected':
      return reasonCopy
        ? `You weren't selected this time. ${reasonCopy} Keep going — the right fit is out there.`
        : "You weren't selected this time. It often comes down to fit, not ability — keep applying."
    case 'no_response':
      // No AI pass for expiries (application-feedback only covers real club
      // responses) — this deterministic line IS the player-facing message.
      // Neutral about the club: they may have answered off-platform.
      return "This application is no longer active on HOCKIA. Applications close automatically after a while without an update here, so you're never left waiting — your energy is better spent on what's open now."
    default:
      return null
  }
}

/**
 * The applicant's own note, sent with the application (Apply sheet → saved as
 * opportunity_applications.metadata.message; the server caps it at 1000
 * characters). Returns the trimmed text, or null when there is none. Render it
 * as plain text (React escapes it) with pre-wrap + break-words.
 */
export function applicationNote(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>).message
  if (typeof raw !== 'string') return null
  const text = raw.trim()
  return text ? text.slice(0, 1000) : null
}

/** Statuses a club can still move with Decline / Maybe / Shortlist. Anything
 *  else (no_response, filled, withdrawn, and the signing statuses) is past
 *  review: the phone review shows a grey note instead of the decision bar. */
const DECIDABLE_APPLICATION_STATUSES = new Set(['pending', 'shortlisted', 'maybe', 'rejected'])

export function isDecidableApplicationStatus(status: string | null | undefined): boolean {
  return !!status && DECIDABLE_APPLICATION_STATUSES.has(status)
}

/** The grey note that replaces the decision bar on a closed application. */
export function closedApplicationNote(status: string | null | undefined, firstName: string): string {
  switch (status) {
    case 'no_response': return `This application closed without a reply. You can still message ${firstName}.`
    case 'filled': return `This role was filled. You can still message ${firstName}.`
    case 'withdrawn': return `${firstName} withdrew this application. You can still message ${firstName}.`
    default: return `This application is past review. You can still message ${firstName}.`
  }
}
