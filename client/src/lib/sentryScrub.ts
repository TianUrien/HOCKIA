import type { Breadcrumb, BrowserOptions, ErrorEvent } from '@sentry/react'

type TransactionEvent = Parameters<NonNullable<BrowserOptions['beforeSendTransaction']>>[0]

/**
 * PII / credential scrubbing for everything sent to Sentry. Pure: no SDK
 * calls, so it is unit-tested directly and used by main.tsx's beforeSend,
 * beforeSendTransaction and beforeBreadcrumb.
 *
 * Supabase auth puts credentials in URLs: the implicit flow returns
 * `#access_token=…&refresh_token=…`, PKCE returns `?code=…`, and email links
 * carry `?token=…` / `?token_hash=…`. Any of those in event.request.url or a
 * navigation/fetch breadcrumb would hand a live session to anyone reading the
 * issue. The hash is dropped entirely (the app keeps no state worth reporting
 * there) and the sensitive query params are removed.
 */
const SENSITIVE_PARAMS = new Set([
  'access_token',
  'refresh_token',
  'provider_token',
  'provider_refresh_token',
  'id_token',
  'code',
  'token',
  'token_hash',
])

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

export function scrubEmails(text: string): string {
  return text.replace(EMAIL_RE, '[REDACTED_EMAIL]')
}

// In URLs the @ is often percent-encoded (?email=jane%40example.com).
const URL_EMAIL_RE = /[a-zA-Z0-9._%+-]+(?:@|%40)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi

function paramKey(segment: string): string {
  const raw = segment.split('=')[0]
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' ')).toLowerCase()
  } catch {
    return raw.toLowerCase()
  }
}

/**
 * Strips the hash and sensitive query params; works on absolute and relative
 * URLs. Other params are kept byte-for-byte (no re-encoding).
 */
export function scrubUrl(url: string): string {
  const withoutHash = url.split('#')[0]
  const q = withoutHash.indexOf('?')
  const base = q === -1 ? withoutHash : withoutHash.slice(0, q)
  const kept = q === -1
    ? []
    : withoutHash.slice(q + 1).split('&').filter((seg) => seg && !SENSITIVE_PARAMS.has(paramKey(seg)))
  const out = kept.length ? `${base}?${kept.join('&')}` : base
  return out.replace(URL_EMAIL_RE, '[REDACTED_EMAIL]')
}

const URL_KEYS = ['url', 'to', 'from'] as const

function scrubValue(value: unknown): unknown {
  return typeof value === 'string' ? scrubEmails(value) : value
}

export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb {
  if (typeof crumb.message === 'string') crumb.message = scrubEmails(crumb.message)
  if (crumb.data) {
    const data: Record<string, unknown> = { ...crumb.data }
    for (const key of Object.keys(data)) {
      const value = data[key]
      if ((URL_KEYS as readonly string[]).includes(key) && typeof value === 'string') {
        data[key] = scrubUrl(value)
      } else {
        data[key] = scrubValue(value)
      }
    }
    crumb.data = data
  }
  return crumb
}

function scrubRequest(event: ErrorEvent | TransactionEvent): void {
  const req = event.request
  if (!req) return
  if (typeof req.url === 'string') req.url = scrubUrl(req.url)
  if (typeof req.query_string === 'string') {
    req.query_string = scrubUrl(`?${req.query_string}`).replace(/^[^?]*\??/, '')
  }
  if (req.headers) {
    for (const key of Object.keys(req.headers)) {
      if (key.toLowerCase() === 'referer') req.headers[key] = scrubUrl(req.headers[key])
    }
  }
}

export function scrubEvent<E extends ErrorEvent | TransactionEvent>(event: E): E {
  if (event.user) {
    delete event.user.email
    delete event.user.ip_address
    delete event.user.username
  }
  scrubRequest(event)
  if (typeof event.message === 'string') event.message = scrubEmails(event.message)
  for (const ex of event.exception?.values ?? []) {
    if (typeof ex.value === 'string') ex.value = scrubEmails(ex.value)
  }
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(scrubBreadcrumb)
  return event
}
