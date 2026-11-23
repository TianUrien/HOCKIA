/**
 * Push delivery log (public.push_delivery_log, 20261123120000): one row per
 * device for every push send-push attempts. Pure helpers, so they are tested
 * without a provider; index.ts collects the rows and writes them once.
 *
 * A row never carries a device token, an endpoint or the push text.
 */

export type PushPlatform = 'ios' | 'android' | 'web'
export type PushOutcome = 'sent' | 'rejected' | 'failed' | 'rate_limited' | 'not_configured'

export interface DeliveryRow {
  notification_id: string | null
  recipient_profile_id: string
  kind: string
  platform: PushPlatform
  outcome: PushOutcome
  detail: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The notification row's id when the push came from one (grouped pushes have none). */
export function notificationIdOf(record: { id?: unknown } | null | undefined): string | null {
  const id = record?.id
  return typeof id === 'string' && UUID.test(id) ? id : null
}

/** Which provider family a subscription belongs to. */
export function platformOf(sub: { fcm_token?: string | null; platform?: string | null }): PushPlatform {
  if (!sub.fcm_token || sub.platform === 'web') return 'web'
  return sub.platform === 'ios' ? 'ios' : 'android'
}

/**
 * A short reason from a provider error, safe to store: links and long
 * token-like runs are removed, and the text is capped at 200 characters.
 */
export function providerDetail(err: unknown): string | null {
  const e = err as { statusCode?: unknown; message?: unknown } | null | undefined
  const status = typeof e?.statusCode === 'number' ? String(e.statusCode) : ''
  const message = typeof e?.message === 'string' ? e.message : typeof err === 'string' ? err : ''
  const text = [status, message].filter(Boolean).join(' ')
    .replace(/https?:\/\/\S+/g, '[link]')
    .replace(/[A-Za-z0-9_:\-]{32,}/g, '[token]')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? text.slice(0, 200) : null
}

/** One line for Sentry when at least one device failed; null when none did. */
export function failureSummary(kind: string, rows: DeliveryRow[]): string | null {
  const failed = rows.filter((r) => r.outcome === 'failed')
  if (failed.length === 0) return null
  const byPlatform = new Map<PushPlatform, number>()
  for (const r of failed) byPlatform.set(r.platform, (byPlatform.get(r.platform) ?? 0) + 1)
  const parts = [...byPlatform.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([p, n]) => `${p} ${n}`)
  const reason = failed[0].detail ? `: ${failed[0].detail}` : ''
  return `send-push: ${failed.length} of ${rows.length} device(s) failed for ${kind} (${parts.join(', ')})${reason}`
}
