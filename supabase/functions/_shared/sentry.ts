// deno-lint-ignore-file no-explicit-any
/**
 * Lightweight Sentry error reporting for Supabase Edge Functions.
 *
 * Uses Sentry's HTTP Envelope API directly — zero dependencies, no SDK,
 * no cold-start overhead. Fire-and-forget: never blocks the response.
 *
 * Gracefully no-ops when SENTRY_DSN is not configured (local dev, tests).
 */

declare const Deno: {
  env: { get(key: string): string | undefined }
}

// ---------------------------------------------------------------------------
// DSN parsing (lazy singleton, follows supabase-client.ts pattern)
// ---------------------------------------------------------------------------

interface ParsedDsn {
  host: string
  projectId: string
  publicKey: string
  envelopeUrl: string
  dsn: string
}

let _parsed: ParsedDsn | false | null = null

function parseDsn(): ParsedDsn | false {
  if (_parsed !== null) return _parsed

  const dsn = Deno.env.get('SENTRY_DSN')
  if (!dsn) {
    _parsed = false
    return false
  }

  try {
    const url = new URL(dsn)
    const publicKey = url.username
    const host = url.hostname
    const projectId = url.pathname.replace(/\//g, '')

    if (!publicKey || !host || !projectId) {
      console.warn('[SENTRY] Invalid DSN format, disabling error reporting')
      _parsed = false
      return false
    }

    _parsed = {
      host,
      projectId,
      publicKey,
      envelopeUrl: `https://${host}/api/${projectId}/envelope/`,
      dsn,
    }
    return _parsed
  } catch {
    console.warn('[SENTRY] Failed to parse DSN, disabling error reporting')
    _parsed = false
    return false
  }
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

function getEnvironment(): string {
  const explicit = Deno.env.get('SENTRY_ENVIRONMENT')
  if (explicit) return explicit

  const siteUrl = Deno.env.get('PUBLIC_SITE_URL') ?? ''
  if (siteUrl.includes('inhockia.com')) return 'production'
  if (siteUrl.includes('staging')) return 'staging'
  return 'development'
}

// ---------------------------------------------------------------------------
// PII scrubbing
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

function scrubPii(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(EMAIL_REGEX, '[REDACTED_EMAIL]')
  }
  if (Array.isArray(value)) {
    return value.map(scrubPii)
  }
  if (value && typeof value === 'object') {
    const scrubbed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === 'email' || k === 'ip_address' || k === 'username') continue
      scrubbed[k] = scrubPii(v)
    }
    return scrubbed
  }
  return value
}

// ---------------------------------------------------------------------------
// In-memory rate limiter (per function, per minute)
// ---------------------------------------------------------------------------

const MAX_EVENTS_PER_FUNCTION_PER_MINUTE = 10
const rateLimitBuckets = new Map<string, number[]>()

function isRateLimited(functionName: string): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const key = functionName || '_global'

  let timestamps = rateLimitBuckets.get(key)
  if (!timestamps) {
    timestamps = []
    rateLimitBuckets.set(key, timestamps)
  }

  // Prune expired entries
  const cutoff = now - windowMs
  while (timestamps.length > 0 && timestamps[0] < cutoff) {
    timestamps.shift()
  }

  if (timestamps.length >= MAX_EVENTS_PER_FUNCTION_PER_MINUTE) {
    return true
  }

  timestamps.push(now)
  return false
}

// ---------------------------------------------------------------------------
// User context
// ---------------------------------------------------------------------------

let _userId: string | undefined

/** Set the user ID for subsequent Sentry events in this request. */
export function setSentryUser(id: string): void {
  _userId = id
}

// ---------------------------------------------------------------------------
// Core: build and send envelope
// ---------------------------------------------------------------------------

interface SentryContext {
  functionName?: string
  correlationId?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
}

function sendEnvelope(event: Record<string, any>): void {
  const config = parseDsn()
  if (!config) return

  const envelope = [
    JSON.stringify({
      event_id: event.event_id,
      dsn: config.dsn,
      sent_at: new Date().toISOString(),
    }),
    JSON.stringify({ type: 'event', content_type: 'application/json' }),
    JSON.stringify(event),
  ].join('\n')

  fetch(config.envelopeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-sentry-envelope',
      'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=hockia-edge/1.0, sentry_key=${config.publicKey}`,
    },
    body: envelope,
  }).catch(() => {
    // Silently swallow — never block the edge function
  })
}

function buildBaseEvent(context?: SentryContext): Record<string, any> {
  const tags: Record<string, string> = {
    runtime: 'deno',
    ...(context?.functionName ? { function_name: context.functionName } : {}),
    ...(context?.correlationId ? { correlation_id: context.correlationId } : {}),
    ...context?.tags,
  }

  return {
    event_id: crypto.randomUUID().replace(/-/g, ''),
    timestamp: Date.now() / 1000,
    platform: 'node',
    server_name: 'supabase-edge',
    environment: getEnvironment(),
    tags,
    extra: context?.extra ? scrubPii(context.extra) as Record<string, unknown> : undefined,
    user: _userId ? { id: _userId } : undefined,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Report an error to Sentry. Fire-and-forget — never blocks.
 * No-ops if SENTRY_DSN is not configured or rate limit reached.
 */
export function captureException(error: unknown, context?: SentryContext): void {
  if (!parseDsn()) return
  if (isRateLimited(context?.functionName ?? '_global')) return

  const err = error instanceof Error ? error : new Error(String(error))

  const event = {
    ...buildBaseEvent(context),
    level: 'error',
    exception: {
      values: [
        {
          type: err.name || 'Error',
          value: scrubPii(err.message) as string,
          mechanism: { type: 'generic', handled: true },
          stacktrace: err.stack
            ? {
                frames: err.stack
                  .split('\n')
                  .slice(1, 20)
                  .map((line: string) => ({ filename: line.trim() }))
                  .reverse(),
              }
            : undefined,
        },
      ],
    },
  }

  sendEnvelope(event)
}

/**
 * Report a message to Sentry. Fire-and-forget — never blocks.
 * No-ops if SENTRY_DSN is not configured or rate limit reached.
 */
export function captureMessage(
  message: string,
  level: 'info' | 'warning' | 'error' | 'fatal' = 'error',
  context?: SentryContext,
): void {
  if (!parseDsn()) return
  if (isRateLimited(context?.functionName ?? '_global')) return

  const event = {
    ...buildBaseEvent(context),
    level,
    message: { formatted: scrubPii(message) as string },
  }

  sendEnvelope(event)
}
