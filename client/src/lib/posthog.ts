/**
 * PostHog — the product-analytics / funnel / experiment layer.
 *
 * Sits ON TOP of the owned first-party `events` pipeline (which stays the
 * source of truth for anything joined to business data). Every event we send
 * to the database is mirrored here, so PostHog's funnel builder, cohorts and
 * A/B experiments work off the SAME taxonomy — no second event vocabulary.
 *
 * Hard rules, mirroring how GA4 is handled in cookieConsent.ts:
 *  - CONSENT-GATED: nothing initialises or sends before the user accepts
 *    analytics cookies. Declining keeps it fully off.
 *  - NEVER on automated browsers (navigator.webdriver): the E2E suite runs
 *    against real environments and would otherwise drown real users in bot
 *    traffic — the single biggest historical distortion in our GA data.
 *  - NEVER on native (Capacitor) for now: GA4 is already blocked there for
 *    App Store Guideline 5.1.2 reasons, and the landing/registration funnel
 *    this exists to measure is a web surface. Flip WEB_ONLY to false once
 *    native product analytics is a deliberate, reviewed decision.
 *  - Autocapture OFF: we send an explicit, reviewed taxonomy. Autocapture
 *    would hoover up the TEXT of clicked elements (player names, club names,
 *    message snippets) into a third-party — a PII leak we don't accept.
 *  - IDENTITY SHARED: PostHog is keyed to the same `anonymous_id` the DB
 *    pipeline uses, so a funnel built here matches one built in SQL.
 *
 * TESTING GOTCHA (cost hours once — read before debugging "events aren't
 * arriving"): posthog-js has its OWN bot filter and silently drops capture()
 * in headless browsers — it returns undefined, queues nothing, sends nothing,
 * and logs nothing, even with `debug: true` and everything else healthy
 * (__loaded true, opted in, correct token/host). Overriding
 * `navigator.webdriver` is NOT enough. To verify the send path from an
 * automated browser, temporarily pass `opt_out_useragent_filter: true`;
 * events then POST to {api_host}/e/ immediately. NEVER ship that flag — the
 * filter is what keeps our E2E suite out of the analytics, and bot traffic
 * was historically the single biggest distortion in our GA data.
 */
import { Capacitor } from '@capacitor/core'
import { hasAnalyticsConsent } from '@/lib/cookieConsent'
import { getAnonymousId } from '@/lib/analyticsIdentity'
import { logger } from '@/lib/logger'

const POSTHOG_KEY =
  import.meta.env.VITE_POSTHOG_KEY ?? 'phc_wvnFZZiFtCasLbgqqTqSEtWWaNmBDMBrzsE5YmJVp6ek'
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com'
const WEB_ONLY = true

/** Only the surface we actually use — keeps us off posthog-js internals
 *  (their `loaded` callback hands back a narrower type than the class). */
interface PostHogClient {
  capture: (event: string, properties?: Record<string, unknown>) => unknown
  identify: (id: string, properties?: Record<string, unknown>) => unknown
  reset: () => unknown
  getFeatureFlag: (key: string) => string | boolean | undefined
}

let client: PostHogClient | null = null
let loading = false
/** Who we've already identified. PostHog's identify() is meant to be called
 *  once per user; the profile fetch can run more than once around a sign-in,
 *  which emitted duplicate $identify events (observed 2026-07-27). */
let identifiedUserId: string | null = null

// The SDK is code-split and loads asynchronously, but the most important
// events of a session (the landing entry page_view, an immediate CTA click)
// fire before that resolves. Without this buffer they'd be silently dropped —
// exactly the top-of-funnel data this integration exists to measure. Queue
// pre-load events and flush them on ready. Bounded so a never-loading SDK
// (blocked by an ad blocker) can't grow memory unbounded.
const MAX_QUEUE = 50
let queue: Array<{ event: string; properties?: Record<string, unknown> }> = []
let pendingIdentify: { id: string; properties?: Record<string, unknown> } | null = null

function flush(): void {
  if (!client) return
  const pending = queue
  queue = []
  for (const item of pending) {
    try {
      client.capture(item.event, item.properties)
    } catch {
      /* noop */
    }
  }
  if (pendingIdentify) {
    try {
      identifiedUserId = pendingIdentify.id
      client.identify(pendingIdentify.id, pendingIdentify.properties)
    } catch {
      /* noop */
    }
    pendingIdentify = null
  }
}

function blocked(): string | null {
  if (typeof window === 'undefined') return 'ssr'
  if (WEB_ONLY && Capacitor.isNativePlatform()) return 'native'
  if (navigator?.webdriver) return 'automation'
  if (!POSTHOG_KEY) return 'no-key'
  if (!hasAnalyticsConsent()) return 'no-consent'
  return null
}

/**
 * Initialise PostHog. Safe to call repeatedly — no-ops when already loaded or
 * when any gate says no. Called on app start (if consent already stored) and
 * again the moment the user accepts the cookie banner.
 */
export function initPostHog(): void {
  if (client || loading) return
  if (blocked()) return
  loading = true

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        api_host: POSTHOG_HOST,
        // We fire page_view ourselves (sanitized paths — raw URLs can carry
        // profile UUIDs/usernames), and our own SPA router owns navigation.
        capture_pageview: false,
        capture_pageleave: true,
        // Every passive capture surface off: we send an explicit taxonomy, and
        // each of these would otherwise ship element text / page content to a
        // third party (dead-clicks and surveys load their own scripts too).
        autocapture: false,
        capture_dead_clicks: false,
        disable_session_recording: true,
        disable_surveys: true,
        capture_performance: false,
        // Heatmaps were the one surface we DIDN'T pin here, so the project's
        // remote config switched them on and they started despite everything
        // else being off. Pin it explicitly rather than depending on a
        // dashboard toggle staying correct.
        enable_heatmaps: false,
        // Reuse the DB pipeline's visitor id so both systems agree on who is
        // who, and unique/returning counts reconcile across the two.
        bootstrap: { distinctID: getAnonymousId() },
        persistence: 'localStorage+cookie',
        debug: import.meta.env.DEV,
        // Volume is tiny (~12k events/month), so send immediately rather than
        // batching — an event is never lost to a tab closing mid-batch, and
        // the landing funnel's first events are exactly the ones at risk.
        request_batching: false,
        // Quota + privacy: don't mint a person record for every drive-by.
        person_profiles: 'identified_only',
        loaded: (ph) => {
          client = ph
          flush()
        },
      })
      client = posthog
      flush()
    })
    .catch((err) => {
      logger.debug('[posthog] load failed (non-fatal)', err)
    })
    .finally(() => {
      loading = false
    })
}

/** Mirror of trackDbEvent — same event name + properties. */
export function phCapture(event: string, properties?: Record<string, unknown>): void {
  if (blocked()) return
  try {
    if (!client) {
      if (queue.length < MAX_QUEUE) queue.push({ event, properties })
      return
    }
    client.capture(event, properties)
  } catch {
    /* analytics must never break the app */
  }
}

/** Called on login/registration so anonymous history stitches to the user. */
export function phIdentify(userId: string, properties?: Record<string, unknown>): void {
  if (blocked() || !userId) return
  // Idempotent: repeated calls for the SAME user are dropped, so a re-run of
  // the profile fetch can't emit a second $identify.
  if (identifiedUserId === userId) return
  try {
    if (!client) {
      pendingIdentify = { id: userId, properties }
      return
    }
    identifiedUserId = userId
    client.identify(userId, properties)
  } catch {
    /* noop */
  }
}

/** Called on logout — starts a fresh anonymous identity. */
export function phReset(): void {
  // Clear FIRST so a failed reset can't strand the guard and block the next
  // user's identify on a shared browser.
  identifiedUserId = null
  try {
    client?.reset()
  } catch {
    /* noop */
  }
}

/**
 * A/B variant for the landing redesign. Returns null when PostHog isn't
 * available (no consent, bot, native) — callers MUST treat null as "show the
 * control", so the page always renders regardless of analytics.
 */
export function phVariant(flagKey: string): string | null {
  if (blocked()) return null
  try {
    const v = client?.getFeatureFlag(flagKey)
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/** Test seam. */
export function __resetPostHogForTests(): void {
  client = null
  loading = false
  queue = []
  pendingIdentify = null
  identifiedUserId = null
}
