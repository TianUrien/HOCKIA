import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.208.0/assert/mod.ts'
import { canDecline, DECLINABLE_STATUSES } from './application-decline.ts'
import { boundHistory } from './history-limits.ts'
import { escapeHtml, safeHttpsUrl } from './html-escape.ts'
import { detectEnvironment } from './sentry.ts'
import { profileIsAdult, profileIsHidden, targetIsInvisible } from './profile-visibility.ts'
import { isFreshWebhookTimestamp } from './webhook-time.ts'
import { ANSWER_LIST_CAP, sanitizeAnswers, facts } from './role-description-copy.ts'
import { checkUserRateLimit } from './rate-limit.ts'
import {
  buildPushPayload,
  pushAllowed,
  pushPreferenceColumn,
  safeInternalPath,
  shouldPushWebhookEvent,
} from '../send-push/push-payload.ts'

// ── application-feedback decline allow-list ─────────────────────────────

Deno.test('decline is allowed only from open decisions', () => {
  for (const s of ['pending', 'shortlisted', 'maybe', 'rejected', 'no_response']) assert(canDecline(s), s)
  for (const s of ['offered', 'accepted', 'signed', 'signed_pending_confirmation', 'withdrawn', 'filled', 'offer_declined', '', null, undefined, 3]) {
    assertFalse(canDecline(s), String(s))
  }
  assertEquals([...DECLINABLE_STATUSES].sort(), ['maybe', 'no_response', 'pending', 'rejected', 'shortlisted'])
})

// ── push: per-type preferences ──────────────────────────────────────────

Deno.test('push kinds map to the settings column the UI promises', () => {
  assertEquals(pushPreferenceColumn('message_received'), 'notify_messages')
  assertEquals(pushPreferenceColumn('conversation_started'), 'notify_messages')
  assertEquals(pushPreferenceColumn('vacancy_application_status'), 'notify_applications')
  assertEquals(pushPreferenceColumn('vacancy_application_received'), 'notify_applications')
  assertEquals(pushPreferenceColumn('applications_expired'), 'notify_applications')
  assertEquals(pushPreferenceColumn('opportunity_published'), 'notify_opportunities')
  assertEquals(pushPreferenceColumn('friend_request_received'), 'notify_friends')
  assertEquals(pushPreferenceColumn('friend_request_accepted'), 'notify_friends')
  for (const k of ['reference_request_received', 'reference_request_accepted', 'reference_request_rejected', 'reference_updated']) {
    assertEquals(pushPreferenceColumn(k), 'notify_references', k)
  }
  assertEquals(pushPreferenceColumn('profile_viewed'), 'notify_profile_views')
  assertEquals(pushPreferenceColumn('recruiting_update'), null)
  assertEquals(pushPreferenceColumn('system_announcement'), null)
})

Deno.test('notify_push is the master switch; a false type column blocks its kinds', () => {
  assertFalse(pushAllowed('message_received', { notify_push: false, notify_messages: true }))
  assertFalse(pushAllowed('recruiting_update', { notify_push: false }))
  assertFalse(pushAllowed('message_received', { notify_push: true, notify_messages: false }))
  assert(pushAllowed('message_received', { notify_push: true, notify_messages: true }))
  // NULL / missing counts as on (columns default to true).
  assert(pushAllowed('message_received', { notify_push: true, notify_messages: null }))
  assert(pushAllowed('friend_request_received', { notify_push: true }))
  // Master-only kinds ignore the per-type columns.
  assert(pushAllowed('recruiting_update', { notify_push: true, notify_applications: false }))
})

// ── push: routes ────────────────────────────────────────────────────────

Deno.test('reference pushes open the References tab like the in-app notification', () => {
  assertEquals(buildPushPayload('reference_request_received', {}, 'Ana').url, '/dashboard/profile?tab=references')
  assertEquals(buildPushPayload('reference_request_accepted', {}, 'Ana').url, '/dashboard/profile?tab=references&section=accepted')
  assertEquals(buildPushPayload('reference_request_rejected', {}, 'Ana').url, '/dashboard/profile?tab=references')
  assertEquals(buildPushPayload('reference_updated', {}, 'Ana').url, '/dashboard/profile?tab=references')
})

Deno.test('club invitation pushes mirror config.ts', () => {
  const invite = buildPushPayload('club_invitation_received', {}, 'Dublin HC', '11111111-2222-3333-4444-555555555555')
  assertEquals(invite.url, '/clubs/id/11111111-2222-3333-4444-555555555555')
  assertEquals(invite.body, 'Dublin HC invited you to join their club')
  assertEquals(buildPushPayload('club_invitation_received', {}, 'Dublin HC').url, '/home')
  const accepted = buildPushPayload('club_invitation_accepted', {}, 'Ana')
  assertEquals(accepted.url, '/dashboard/profile')
  assertEquals(accepted.body, 'Ana joined your club')
})

Deno.test('recruiting target_url must be an in-app path', () => {
  const url = (target_url: unknown) => buildPushPayload('recruiting_update', { target_url }, 'X').url
  assertEquals(url('/messages/abc'), '/messages/abc')
  assertEquals(url('//evil.example/x'), '/messages')
  assertEquals(url('/\\evil.example'), '/messages')
  assertEquals(url('https://evil.example'), '/messages')
  assertEquals(url(null), '/messages')
  assertEquals(safeInternalPath('/ok?x=1'), '/ok?x=1')
  assertEquals(safeInternalPath('//x'), null)
})

Deno.test('webhook events: INSERT pushes; UPDATE only when created_at moved', () => {
  assert(shouldPushWebhookEvent({ type: 'INSERT', record: { created_at: 'a' } }))
  assert(shouldPushWebhookEvent({ recipient_profile_id: 'r', kind: 'k' })) // bare record
  assert(shouldPushWebhookEvent({
    type: 'UPDATE',
    record: { created_at: '2026-10-06T10:00:01Z' },
    old_record: { created_at: '2026-10-06T09:00:00Z' },
  }))
  // mark read / seen / cleared: created_at untouched → no push
  assertFalse(shouldPushWebhookEvent({
    type: 'UPDATE',
    record: { created_at: '2026-10-06T09:00:00Z', read_at: '2026-10-06T10:00:00Z' },
    old_record: { created_at: '2026-10-06T09:00:00Z', read_at: null },
  }))
  assertFalse(shouldPushWebhookEvent({ type: 'UPDATE', record: { created_at: 'x' } }))
  assertFalse(shouldPushWebhookEvent({ type: 'DELETE', old_record: {} }))
  assertFalse(shouldPushWebhookEvent(null))
})

// ── nl-search history bounds ────────────────────────────────────────────

Deno.test('history: each turn ≤ 1,000 chars, total ≤ 6,000, newest kept', () => {
  const big = (c: string) => c.repeat(5000)
  const raw = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: big(String.fromCharCode(97 + i)) }))
  const out = boundHistory(raw)
  assert(out.every((t) => t.content.length <= 1000))
  assertEquals(out.reduce((n, t) => n + t.content.length, 0), 6000)
  assertEquals(out.length, 6)
  // newest turn (index 11 → 'l') is last
  assertEquals(out[out.length - 1].content[0], 'l')
})

Deno.test('history: drops invalid turns and non-arrays', () => {
  assertEquals(boundHistory('nope'), [])
  assertEquals(boundHistory(null), [])
  assertEquals(
    boundHistory([{ role: 'system', content: 'x' }, { role: 'user', content: 5 }, { role: 'user', content: 'hi', extra: 1 }]),
    [{ role: 'user', content: 'hi' }],
  )
})

Deno.test('history: partial oldest turn fits the remaining budget', () => {
  const out = boundHistory([
    { role: 'user', content: 'a'.repeat(900) },
    { role: 'assistant', content: 'b'.repeat(900) },
  ], { totalChars: 1000 })
  assertEquals(out.map((t) => t.content.length), [100, 900])
})

// ── email escaping ──────────────────────────────────────────────────────

Deno.test('escapeHtml escapes markup and quotes', () => {
  assertEquals(escapeHtml(`<b>"Tom" & 'Jerry'</b>`), '&lt;b&gt;&quot;Tom&quot; &amp; &#39;Jerry&#39;&lt;/b&gt;')
  assertEquals(escapeHtml(null), '')
  assertEquals(escapeHtml(undefined), '')
})

Deno.test('safeHttpsUrl accepts only https', () => {
  assertEquals(safeHttpsUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png')
  assertEquals(safeHttpsUrl('http://cdn.example/a.png'), null)
  assertEquals(safeHttpsUrl('javascript:alert(1)'), null)
  assertEquals(safeHttpsUrl('data:image/png;base64,AAAA'), null)
  assertEquals(safeHttpsUrl('" onerror="x'), null)
  assertEquals(safeHttpsUrl(''), null)
  assertEquals(safeHttpsUrl(null), null)
})

Deno.test('email templates escape member values and drop non-https avatars', async () => {
  const { generateEmailHtml } = await import('./friend-request-email.ts')
  const html = generateEmailHtml({
    id: 'u1',
    full_name: '<script>x</script> Ana',
    username: null,
    avatar_url: 'javascript:alert(1)',
    base_location: '"><img src=x>',
    role: 'player',
  } as never)
  assertFalse(html.includes('<script>x</script>'))
  assert(html.includes('&lt;script&gt;x&lt;/script&gt; Ana'))
  assertFalse(html.includes('javascript:alert(1)'))
  assertFalse(html.includes('"><img src=x>'))
})

Deno.test('template renderer escapes headings, is_html values and avatars', async () => {
  const { renderBlock, renderAvatarHtml } = await import('./email-renderer.ts')
  const vars = { name: '<i>Ana</i>', url: 'javascript:alert(1)' }
  assertEquals(
    renderBlock({ type: 'heading', text: 'Hi {{name}}' }, vars).includes('Hi &lt;i&gt;Ana&lt;/i&gt;'),
    true,
  )
  const para = renderBlock({ type: 'paragraph', is_html: true, text: '<a href="https://x.test">{{name}}</a>' }, vars)
  assert(para.includes('<a href="https://x.test">&lt;i&gt;Ana&lt;/i&gt;</a>'))
  assertEquals(renderBlock({ type: 'button', text: 'Go', url: '{{url}}' }, vars), '')
  assertFalse(renderAvatarHtml('http://insecure.test/a.png', 'Ana').includes('<img'))
  assert(renderAvatarHtml('https://secure.test/a.png', 'Ana').includes('<img src="https://secure.test/a.png"'))
})

// ── Sentry environment ──────────────────────────────────────────────────

Deno.test('environment detection: explicit wins, staging before the prod domain', () => {
  const env = (vars: Record<string, string>) => (k: string) => vars[k]
  assertEquals(detectEnvironment(env({ SENTRY_ENVIRONMENT: 'staging', PUBLIC_SITE_URL: 'https://inhockia.com' })), 'staging')
  assertEquals(detectEnvironment(env({ PUBLIC_SITE_URL: 'https://staging.inhockia.com' })), 'staging')
  assertEquals(detectEnvironment(env({ PUBLIC_SITE_URL: 'https://inhockia.com' })), 'production')
  assertEquals(detectEnvironment(env({ PUBLIC_SITE_URL: 'https://www.inhockia.com' })), 'production')
  assertEquals(detectEnvironment(env({ PUBLIC_SITE_URL: 'http://localhost:5173' })), 'development')
  assertEquals(detectEnvironment(env({})), 'development')
  assertEquals(detectEnvironment(env({ SENTRY_ENVIRONMENT: '  ' , PUBLIC_SITE_URL: 'https://staging.inhockia.com' })), 'staging')
})

// ── ai-opinion candidate visibility ─────────────────────────────────────

Deno.test('profileIsAdult mirrors SQL: known DOB and 18+ today (UTC)', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  assert(profileIsAdult('2008-10-06', now))
  assertFalse(profileIsAdult('2008-10-07', now))
  assertFalse(profileIsAdult(null, now))
  assertFalse(profileIsAdult('not-a-date', now))
  assert(profileIsHidden(true, null))
  assert(profileIsHidden(false, '2026-01-01T00:00:00Z'))
  assertFalse(profileIsHidden(null, null))
})

Deno.test('targetIsInvisible: hidden, minor, test account, or a block', () => {
  const now = new Date('2026-10-06T12:00:00Z')
  const adult = { is_blocked: false, frozen_minor_at: null, date_of_birth: '1995-01-01', is_test_account: false }
  assertFalse(targetIsInvisible({ target: adult, viewerIsTestAccount: false, blockedPair: false, now }))
  assert(targetIsInvisible({ target: { ...adult, is_blocked: true }, viewerIsTestAccount: false, blockedPair: false, now }))
  assert(targetIsInvisible({ target: { ...adult, frozen_minor_at: '2026-01-01' }, viewerIsTestAccount: false, blockedPair: false, now }))
  assert(targetIsInvisible({ target: { ...adult, date_of_birth: '2012-01-01' }, viewerIsTestAccount: false, blockedPair: false, now }))
  assert(targetIsInvisible({ target: { ...adult, date_of_birth: null }, viewerIsTestAccount: false, blockedPair: false, now }))
  assert(targetIsInvisible({ target: { ...adult, is_test_account: true }, viewerIsTestAccount: false, blockedPair: false, now }))
  assertFalse(targetIsInvisible({ target: { ...adult, is_test_account: true }, viewerIsTestAccount: true, blockedPair: false, now }))
  assert(targetIsInvisible({ target: adult, viewerIsTestAccount: false, blockedPair: true, now }))
})

// ── video-webhook timestamp ─────────────────────────────────────────────

Deno.test('webhook timestamps older than 300 s are refused', () => {
  const now = 1_800_000_000_000
  assert(isFreshWebhookTimestamp(now / 1000, now))
  assert(isFreshWebhookTimestamp(now / 1000 - 300, now))
  assertFalse(isFreshWebhookTimestamp(now / 1000 - 301, now))
  assertFalse(isFreshWebhookTimestamp(now / 1000 + 301, now))
  assertFalse(isFreshWebhookTimestamp(Number.NaN, now))
})

// ── role-description-draft inputs ───────────────────────────────────────

Deno.test('sanitizeAnswers caps list answers and drops malformed ones', () => {
  const many = Array.from({ length: 50 }, (_, i) => `skill_${i}`)
  const a = sanitizeAnswers({ skills: many, package: 'housing', euPassport: 'yes', position: 'midfielder' })
  assertEquals(a.skills?.length, ANSWER_LIST_CAP)
  assertEquals(a.package, undefined)
  assertEquals(a.euPassport, false)
  assertEquals(sanitizeAnswers(null), {})
  assertEquals(sanitizeAnswers([1, 2]), {})
  // facts() no longer throws on a non-array list answer
  assert(facts(sanitizeAnswers({ skills: 'oops' }), 'Club', null).length > 0)
  assertEquals(sanitizeAnswers({ skills: ['a', 3, 'b'] }).skills, ['a', 'b'])
})

// ── check_rate_limit helper ─────────────────────────────────────────────

Deno.test('checkUserRateLimit: allowed, refused with retryAfter, and fail modes', async () => {
  const client = (result: { data?: unknown; error?: unknown }) => ({
    rpc: (_fn: string, _args: unknown) => Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
  })
  assertEquals((await checkUserRateLimit(client({ data: { allowed: true } }), 'u', 'role_draft', 20, 3600)).allowed, true)
  const refused = await checkUserRateLimit(
    client({ data: { allowed: false, reset_at: new Date(Date.now() + 90_000).toISOString() } }), 'u', 'role_draft', 20, 3600)
  assertEquals(refused.allowed, false)
  assert((refused.retryAfter ?? 0) >= 89 && (refused.retryAfter ?? 0) <= 91)
  const openOnError = await checkUserRateLimit(client({ error: { message: 'boom' } }), 'u', 'a', 1, 1)
  assertEquals([openOnError.allowed, openOnError.error], [true, 'boom'])
  const closedOnError = await checkUserRateLimit(client({ error: { message: 'boom' } }), 'u', 'a', 1, 1, 'closed')
  assertEquals(closedOnError.allowed, false)
})
