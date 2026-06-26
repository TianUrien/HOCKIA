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
