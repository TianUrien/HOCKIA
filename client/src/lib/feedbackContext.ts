/**
 * feedbackContext — auto-captured context for a user_feedback submit.
 *
 * Pulls together everything the admin will want to triage with: a
 * sanitized route (no UUIDs), the raw path (admin-only on the DB
 * side via route_raw column), the user agent, viewport, environment,
 * and the app version (Vercel git SHA, when available).
 *
 * Mirrors the GA4 PII discipline shipped earlier this session — the
 * SANITIZED route uses the same `sanitizePath()` so UUIDs become
 * `:id`. The RAW route is passed alongside so the admin RPC can
 * expose it to developers without the user's own SELECT returning
 * it.
 */

import { sanitizePath } from './analyticsSanitizers'

export interface FeedbackContext {
  route: string
  route_raw: string
  user_agent: string
  viewport: string
  environment: string
  app_version: string | null
  sentry_replay_url: string | null
}

/**
 * Best-effort capture — every field is independently fault-tolerant
 * because we never want a missing field to block a feedback submit.
 * Server-side, all of these are TEXT NULLABLE so absent values are
 * fine.
 */
export function captureFeedbackContext(): FeedbackContext {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const search = typeof window !== 'undefined' ? window.location.search : ''
  const pathWithSearch = `${path}${search}`

  const route = sanitizePath(pathWithSearch)
  const route_raw = pathWithSearch

  const user_agent =
    typeof navigator !== 'undefined' ? navigator.userAgent : ''

  const viewport =
    typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : ''

  // Vite injects this from VITE_VERCEL_GIT_COMMIT_SHA when set in the
  // build environment. Null when running locally without it.
  const app_version =
    (import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA as string | undefined) ?? null

  const environment = (import.meta.env.MODE as string | undefined) ?? 'unknown'

  // Sentry replay URL — best-effort. The Sentry SDK exposes the
  // session replay ID at runtime; converting to a URL would require
  // knowing the Sentry org + project DSN, which the client doesn't
  // need to know about. Skip for MVP; the admin can correlate via
  // user_id + timestamp.
  const sentry_replay_url: string | null = null

  return {
    route,
    route_raw,
    user_agent,
    viewport,
    environment,
    app_version,
    sentry_replay_url,
  }
}
