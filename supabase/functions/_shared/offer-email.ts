/**
 * A club's offer in the application-status email (founder decision 2026-11-18:
 * an offer also reaches the player by email). Rendered by
 * notify-application-status; queued by enqueue_application_status_emails.
 */

/** "25 de noviembre" / "25 November" from a YYYY-MM-DD date; null when it cannot be read. */
export function offerDateLabel(date: string | null | undefined, language: 'en' | 'es'): string | null {
  if (!date) return null
  const d = new Date(`${date.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(language === 'es' ? 'es' : 'en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' })
}
