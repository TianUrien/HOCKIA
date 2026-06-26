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
      return { label: 'Shortlisted', className: 'bg-emerald-100 text-emerald-800' }
    case 'maybe':
      return { label: 'Under consideration', className: 'bg-amber-100 text-amber-800' }
    case 'rejected':
      // Soft, non-judgmental tone — a clear "no" without feeling punishing.
      return { label: 'Not selected', className: 'bg-rose-50 text-rose-700' }
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
        ? `You're still under consideration. ${reasonCopy}`
        : "You're still under consideration — no decision yet."
    case 'rejected':
      return reasonCopy
        ? `You weren't selected this time. ${reasonCopy} Keep going — the right fit is out there.`
        : "You weren't selected this time. It often comes down to fit, not ability — keep applying."
    default:
      return null
  }
}
