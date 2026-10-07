/**
 * Sentry bootstrap for both shells (the web app and the Capacitor apps).
 *
 *   - Web (Vercel): `@sentry/react` alone, exactly as before.
 *   - Native (iOS / Android): `@sentry/capacitor` wraps the SAME React SDK —
 *     `SentryCapacitor.init(options, SentryReact.init)` — and adds the native
 *     layer (sentry-cocoa / sentry-android): crashes, app hangs and watchdog
 *     terminations, JS events routed through the native transport (offline
 *     cache), and tags set from JS synced to the native scope.
 *
 * The native SDK receives `dsn`, `enabled`, `environment`, `release` and
 * `tracesSampleRate` from the shared options (the plugin forwards primitives
 * only; `beforeSend`, `beforeBreadcrumb` and `ignoreErrors` stay on the JS
 * side), so a native crash lands under the same `native@<sha>` release as the
 * JS errors. `enabled: false` (development, or no DSN) leaves the native SDK
 * uninitialised too.
 *
 * Bundle cost (CI method, 2026-10-07): the plugin adds ~5.7 KB gzip to the
 * eager chunks (472.5 → 478.2 KB against the 480 KB budget in standards.md).
 * Loading it lazily on native was measured too and saved only ~2 KB, because
 * most of its weight is @sentry/browser code that lands in the shared eager
 * `sentry` chunk either way — not worth an asynchronous init on native.
 *
 * Kept out of main.tsx so the shell selection is unit-testable
 * (__tests__/sentryInit.test.ts). Release doc: docs/engineering/native-release.md.
 */
import * as SentryReact from '@sentry/react'
import * as SentryCapacitor from '@sentry/capacitor'
import type { CapacitorOptions } from '@sentry/capacitor'
import { Capacitor } from '@capacitor/core'
import { isNetworkFailureMessage } from '@/lib/sentryHelpers'
import { EXPECTED_REFUSAL_MESSAGES, isExpectedRefusal } from '@/lib/sentryFilters'
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentryScrub'
import { getAppVersion } from '@/lib/appVersion'

export type SentryEnvironment = 'development' | 'staging' | 'production'
export type SentryShell = 'native' | 'web'

declare global {
  interface Window {
    /** Native-only release-verification hooks; see docs/engineering/native-release.md. */
    __hockiaSentry?: { jsError: () => void; nativeCrash: () => void }
  }
}

/**
 * Staging is a production-MODE build (Vercel), so MODE can't distinguish it —
 * the baked-in Supabase project ref can (house staging-detection pattern,
 * same as OpportunitiesPage).
 */
export function detectSentryEnvironment(): SentryEnvironment {
  if (import.meta.env.MODE !== 'production') return 'development'
  return import.meta.env.VITE_SUPABASE_URL?.includes('ivjkdaylalhsteyyclvl') ? 'staging' : 'production'
}

/**
 * Options shared by both shells. Typed as CapacitorOptions: the browser option
 * set minus the replay and profiling keys, which are web-only and added by
 * initSentry() for the web shell.
 */
function buildSharedOptions(environment: SentryEnvironment): CapacitorOptions {
  return {
    dsn: import.meta.env.VITE_SENTRY_DSN,
    // Never report from development: local sessions, HMR artifacts and
    // dev-server e2e teardowns were ~85% of the Sentry feed (2026-07-14
    // triage), burying real production signals.
    enabled: Boolean(import.meta.env.VITE_SENTRY_DSN) && environment !== 'development',
    environment,
    // The SAME release name the source-map upload used (vite.config.ts →
    // lib/sentryRelease): web@<sha> on Vercel, native@<sha> in the Capacitor
    // bundle, dev locally. Native store version/build are tags (set below).
    release: import.meta.env.VITE_SENTRY_RELEASE || 'dev',
    // PERF (Lighthouse 2026-07-29): integrations attach AFTER first paint —
    // see main.tsx. init() itself is cheap; browserTracing + replay setup were
    // part of a 5.4s mobile render delay (sentry chunk alone: 643ms boot-up
    // time on emulated mobile). Error capture works from init; only the
    // tracing/replay extras wait for idle.
    integrations: [],
    tracesSampleRate: environment === 'production' ? 0.3 : 1.0,
    // Substring-matched against the error message. These are expected
    // user-input errors from Supabase Auth — not application bugs — and
    // should not page anyone or clutter the dashboard.
    ignoreErrors: [
      // A native OAuth attempt deliberately superseded by a newer tap — expected,
      // handled in lib/nativeOAuth + AuthScreen; belt-and-braces here.
      'OAuth cancelled — superseded by a newer sign-in attempt',
      // Wrong password / wrong email entry on /signin
      'Invalid login credentials',
      // /signup or /signin hammered too quickly — Supabase rate limit
      'Email rate limit exceeded',
      // Duplicate signup attempt — UI should already guide them to /signin
      'User already registered',
      // Leaked-password protection (enabled 2026-08-27) rejecting a weak or
      // breached password — the form shows the message; it is user input.
      'Password is known to be weak',
      // Auth endpoint cooldown after a rapid retry (resend / reset) — a
      // guardrail firing as designed, not a failure.
      'you can only request this after',
      // Tried to sign in before clicking the verification email — user input.
      'Email not confirmed',
      // iOS WKWebView injected-script noise (Sentry JAVASCRIPT-REACT-CF,
      // 2026-09-01): no source file, symbol not in our bundle — a system or
      // reader-mode script erroring inside the webview, not our code.
      "Can't find variable: EmptyRanges",
      // Microsoft Outlook SafeLink scanner executing our JS while previewing
      // emailed links — a well-known bot artifact, not a user (Sentry triage
      // 2026-08-07: fired only from /community with 0 real users).
      'Object Not Found Matching Id',
      // React Query cancels in-flight fetches on unmount/navigation; the
      // rejection is the mechanism working, not a failure.
      'CancelledError',
      // Expected auth outcomes (Sentry triage 2026-09-24): the user left the
      // OAuth flow open, or hit a signed-out page — the UI already explains.
      'OAuth timed out after 5 minutes',
      'Auth session missing',
      // Android WebView bridge torn down mid-call after the app was
      // backgrounded — the OS reclaimed the page, not a code path.
      'Java object is gone',
      // Deliberate business refusals the UI already explains (blocked member,
      // daily new-conversation allowance) — release audit 2026-10-06.
      ...EXPECTED_REFUSAL_MESSAGES,
    ],
    beforeBreadcrumb(crumb) {
      // Navigation / fetch URLs can carry auth tokens (#access_token, ?code=).
      return scrubBreadcrumb(crumb)
    },
    beforeSendTransaction(event) {
      return scrubEvent(event)
    },
    beforeSend(event, hint) {
      // Network failures (Safari "Load failed", Chrome "Failed to fetch"): the
      // request never reached the server — offline, a blocked ISP, a dropped
      // connection. Nothing in the app to fix, and they hide real errors in
      // the alert stream. Keep them COUNTED so an outage spike stays visible,
      // but as info-level, tagged, and sampled 1 in 4 (founder ruling
      // 2026-09-24: out of alerts, still counted). Alert rules key on
      // level:error, so these never page.
      const original = hint?.originalException
      if (isExpectedRefusal(original)) return null
      const message = [event.message, ...(event.exception?.values?.map((v) => v.value) ?? []), original instanceof Error ? original.message : '']
        .filter((m): m is string => typeof m === 'string')
        .join('\n')
      if (isNetworkFailureMessage(message)) {
        if (Math.random() >= 0.25) return null
        event.level = 'info'
        event.tags = { ...event.tags, network_failure: 'true' }
        event.fingerprint = ['network-failure']
      }
      // Scrub PII before sending: user email/IP/username, emails in messages,
      // exception values and breadcrumbs, and auth tokens / the hash in URLs.
      return scrubEvent(event)
    },
  }
}

/**
 * Initialise Sentry for the shell we are running in and set the runtime tags.
 * Returns which shell was initialised.
 */
export function initSentry(): SentryShell {
  const environment = detectSentryEnvironment()
  const isNative = Capacitor.isNativePlatform()
  const shared = buildSharedOptions(environment)

  if (isNative) {
    // The Capacitor SDK merges these options, installs its default
    // integrations (device context, native release, frame rewriting) and
    // calls the React SDK's init as the sibling. Replay is never attached on
    // native (Apple guideline 5.1.2) — the Capacitor option type has no
    // replay keys at all.
    SentryCapacitor.init(
      {
        ...shared,
        enableNative: true,
        enableNativeCrashHandling: true,
      },
      SentryReact.init,
    )
  } else {
    SentryReact.init({
      ...shared,
      replaysSessionSampleRate: environment === 'production' ? 0.05 : 1.0,
      replaysOnErrorSampleRate: 1.0,
    })
  }

  // Which shell is running, plus (native) the store version and build — one
  // web bundle serves both native apps, so these can only be known at runtime.
  // On native the scope is synced to the native SDK, so crashes carry them too.
  SentryReact.setTag('platform', isNative ? Capacitor.getPlatform() : 'web')
  if (isNative) {
    void getAppVersion().then((info) => {
      if (!info) return
      SentryReact.setTags({ app_version: info.version, app_build: info.build })
    })
    exposeVerificationHooks()
  }
  return isNative ? 'native' : 'web'
}

/**
 * Release-verification hooks (docs/engineering/native-release.md, section 5).
 * Native only and without UI: reachable solely from a debugger attached to
 * the WebView, which store builds do not allow. `jsError` throws on the next
 * tick so it reaches the global handlers like a real uncaught error;
 * `nativeCrash` kills the process so the native SDK reports a crash on the
 * next launch.
 */
function exposeVerificationHooks(): void {
  if (typeof window === 'undefined') return
  window.__hockiaSentry = {
    jsError: () => {
      window.setTimeout(() => {
        throw new Error(`[sentry-verify] JS error from the native shell at ${new Date().toISOString()}`)
      }, 0)
    },
    nativeCrash: () => SentryCapacitor.nativeCrash(),
  }
}
