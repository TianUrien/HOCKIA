// deno-lint-ignore-file no-explicit-any
/**
 * Deno test for email-sender.ts Sentry integration.
 *
 * Verifies captureException fires on every error path:
 *   - Resend API errors (non-retryable)
 *   - Retry exhaustion (individual + batch)
 *   - Database recording failures
 *   - No Sentry on success
 *
 * Run:  deno test supabase/functions/_shared/email-sender.test.ts --no-check --allow-env --allow-net
 */

// ---------------------------------------------------------------------------
// Environment setup — must happen BEFORE importing email-sender/sentry
// ---------------------------------------------------------------------------

Deno.env.set('SENTRY_DSN', 'https://abc123@o123.ingest.sentry.io/456')
Deno.env.set('PUBLIC_SITE_URL', 'https://staging.oplayr.com')

// ---------------------------------------------------------------------------
// Intercept global fetch — captures both Resend and Sentry calls
// ---------------------------------------------------------------------------

const _originalFetch = globalThis.fetch
let fetchStub: ((input: string | URL | Request, init?: RequestInit) => Promise<Response>) | null = null

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  if (fetchStub) return fetchStub(input, init)
  return _originalFetch(input, init)
}) as typeof fetch

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let sentryFetchCalls: string[] = []

function resetState() {
  sentryFetchCalls = []
  fetchStub = null
}

function createMockSupabase(insertError: { message: string } | null = null) {
  return {
    from: (_table: string) => ({
      insert: (_rows: any) => Promise.resolve({
        error: insertError,
        data: null,
      }),
    }),
  } as any
}

function createMockLogger() {
  const logs: Array<{ level: string; message: string; meta?: any }> = []
  return {
    logger: {
      info: (msg: string, meta?: any) => logs.push({ level: 'info', message: msg, meta }),
      warn: (msg: string, meta?: any) => logs.push({ level: 'warn', message: msg, meta }),
      error: (msg: string, meta?: any) => logs.push({ level: 'error', message: msg, meta }),
    },
    logs,
  }
}

function getUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function makeFetchStub(resendStatus: number, resendBody: any) {
  return async (input: string | URL | Request, _init?: RequestInit) => {
    const url = getUrl(input)
    if (url.includes('sentry.io')) {
      sentryFetchCalls.push(url)
      return new Response('ok', { status: 200 })
    }
    return new Response(JSON.stringify(resendBody), { status: resendStatus })
  }
}

// ---------------------------------------------------------------------------
// Import email-sender (after env is configured)
// ---------------------------------------------------------------------------

const { sendTrackedEmail, sendTrackedBatch } = await import('./email-sender.ts')

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

Deno.test('sendTrackedEmail — Resend API 400 triggers Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(400, { message: 'Invalid email' })
  const { logger } = createMockLogger()

  const result = await sendTrackedEmail({
    supabase: createMockSupabase(),
    resendApiKey: 'test-key',
    to: 'bad@test.com',
    subject: 'Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_api_error',
    logger,
  })

  if (result.success) throw new Error('Expected failure')
  if (!result.error?.includes('400')) throw new Error(`Unexpected error: ${result.error}`)
  if (sentryFetchCalls.length === 0) throw new Error('Expected Sentry envelope')
  console.log(`  ✓ Sentry fired (${sentryFetchCalls.length} call(s))`)
})

Deno.test('sendTrackedEmail — retry exhaustion triggers Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(500, 'Internal Server Error')
  const { logger } = createMockLogger()

  const result = await sendTrackedEmail({
    supabase: createMockSupabase(),
    resendApiKey: 'test-key',
    to: 'retry@test.com',
    subject: 'Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_retry_exhaust',
    logger,
  })

  if (result.success) throw new Error('Expected failure')
  if (sentryFetchCalls.length === 0) throw new Error('Expected Sentry after retry exhaustion')
  console.log(`  ✓ Sentry fired after retries (${sentryFetchCalls.length} call(s))`)
})

Deno.test('sendTrackedEmail — DB recording failure triggers Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(200, { id: 'resend-123' })
  const { logger } = createMockLogger()

  const result = await sendTrackedEmail({
    supabase: createMockSupabase({ message: 'unique constraint violation' }),
    resendApiKey: 'test-key',
    to: 'user@test.com',
    subject: 'Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_db_fail',
    logger,
  })

  // Email itself succeeds
  if (!result.success) throw new Error('Expected send success')
  // DB failure should trigger Sentry
  if (sentryFetchCalls.length === 0) throw new Error('Expected Sentry for DB failure')
  console.log(`  ✓ Sentry fired for DB failure (${sentryFetchCalls.length} call(s))`)
})

Deno.test('sendTrackedBatch — batch API error triggers Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(403, { message: 'Forbidden' })
  const { logger } = createMockLogger()

  const result = await sendTrackedBatch({
    supabase: createMockSupabase(),
    resendApiKey: 'test-key',
    recipients: [
      { email: 'a@test.com', recipientRole: 'player' },
      { email: 'b@test.com', recipientRole: 'coach' },
    ],
    subject: 'Batch Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_batch_error',
    logger,
  })

  if (result.stats.failed === 0) throw new Error('Expected failures')
  if (sentryFetchCalls.length === 0) throw new Error('Expected Sentry for batch API error')
  console.log(`  ✓ Sentry fired for batch error (${sentryFetchCalls.length} call(s))`)
})

Deno.test('sendTrackedBatch — DB batch recording failure triggers Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(200, { data: [{ id: 'b-1' }, { id: 'b-2' }] })
  const { logger } = createMockLogger()

  const result = await sendTrackedBatch({
    supabase: createMockSupabase({ message: 'connection timeout' }),
    resendApiKey: 'test-key',
    recipients: [
      { email: 'a@test.com', recipientRole: 'player' },
      { email: 'b@test.com', recipientRole: 'coach' },
    ],
    subject: 'Batch Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_batch_db',
    logger,
  })

  if (result.stats.sent === 0) throw new Error('Expected some sends')
  if (sentryFetchCalls.length === 0) throw new Error('Expected Sentry for DB batch recording failure')
  console.log(`  ✓ Sentry fired for batch DB failure (${sentryFetchCalls.length} call(s))`)
})

Deno.test('sendTrackedEmail — success does NOT trigger Sentry', async () => {
  resetState()
  fetchStub = makeFetchStub(200, { id: 'resend-ok' })
  const { logger } = createMockLogger()

  const result = await sendTrackedEmail({
    supabase: createMockSupabase(),
    resendApiKey: 'test-key',
    to: 'happy@test.com',
    subject: 'Test',
    html: '<p>Test</p>',
    text: 'Test',
    templateKey: 'test_success',
    logger,
  })

  if (!result.success) throw new Error('Expected success')
  if (sentryFetchCalls.length > 0) throw new Error(`Sentry should NOT fire on success (got ${sentryFetchCalls.length})`)
  console.log('  ✓ No Sentry on success')
})
