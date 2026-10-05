/**
 * Release audit 2026-10-05 · where a notification takes you, for EVERY kind.
 *
 * The existing tests cover about half of the kinds one by one. This file walks
 * the database enum (`profile_notification_kind`), so a kind added to the
 * database without client copy / a route, or a route that no longer exists in
 * App.tsx, fails here. It also puts the in-app row and the push payload
 * (supabase/functions/send-push/push-payload.ts, redeployed in this release)
 * side by side: a tap on the push and a tap on the row must open the same
 * place.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { matchPath } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Constants } from '@/lib/database.types'
import type { NotificationKind, NotificationRecord } from '@/lib/api/notifications'
import { getNotificationConfig, resolveNotificationRoute } from '@/components/notifications/config'
import { buildPushPayload } from '../../../supabase/functions/send-push/push-payload.ts'

const KINDS = Constants.public.Enums.profile_notification_kind as readonly NotificationKind[]

const APP_SOURCE = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
const APP_ROUTES = [...new Set([...APP_SOURCE.matchAll(/<Route\s+path="(\/[^"]*)"/g)].map((m) => m[1]))]

/** True when the path part of `url` is a route App.tsx declares. */
function isAppRoute(url: string): boolean {
  const pathname = url.split(/[?#]/)[0]
  return APP_ROUTES.some((pattern) => matchPath({ path: pattern, end: true }, pathname) !== null)
}

const CONVERSATION = '11111111-1111-4111-8111-111111111111'
const OPPORTUNITY = '22222222-2222-4222-8222-222222222222'
const ACTOR = '33333333-3333-4333-8333-333333333333'

function notification(kind: NotificationKind, over: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'n1',
    kind,
    sourceEntityId: null,
    metadata: {},
    targetUrl: null,
    createdAt: '2026-10-05T10:00:00.000Z',
    readAt: null,
    seenAt: null,
    clearedAt: null,
    actor: { id: ACTOR, fullName: 'Ana Club', role: 'club', username: 'ana', avatarUrl: null, baseLocation: 'Rosario' },
    ...over,
  }
}

const BARE_ACTOR = { id: null, fullName: null, role: null, username: null, avatarUrl: null, baseLocation: null }

/** What the server puts in metadata for the kinds whose route depends on it. */
const FULL_METADATA = {
  conversation_id: CONVERSATION,
  opportunity_id: OPPORTUNITY,
  target_url: `/messages/${CONVERSATION}`,
  title: 'Offer received',
  summary: 'Ana Club sent you an offer.',
}

describe('the enum is the source of the list', () => {
  it('has the 25 kinds this release ships with (update the tests below when one is added)', () => {
    expect(KINDS.length).toBe(25)
    expect(new Set(KINDS).size).toBe(KINDS.length)
  })
})

describe('in-app row × every notification kind', () => {
  it('every kind has its own copy: none falls back to "You have a new update"', () => {
    for (const kind of KINDS) {
      const n = notification(kind, { metadata: FULL_METADATA })
      const config = getNotificationConfig(n)
      expect(config.badgeText, kind).not.toBe('Notification')
      expect(config.getTitle(n), kind).not.toBe('You have a new update')
    }
  })

  it('with NO metadata and NO actor, every kind still renders a clean title and description', () => {
    for (const kind of KINDS) {
      const n = notification(kind, { actor: BARE_ACTOR })
      const config = getNotificationConfig(n)
      const title = config.getTitle(n)
      const description = config.getDescription?.(n) ?? null
      expect(title.trim().length, kind).toBeGreaterThan(0)
      for (const text of [title, description ?? '']) {
        expect(text, kind).not.toMatch(/undefined|null|NaN|\[object/)
        // No raw enum tokens ("head_coach", "signed_pending_confirmation").
        expect(text, kind).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
      }
    }
  })

  it('with full metadata, every kind opens a route that exists in App.tsx', () => {
    for (const kind of KINDS) {
      const route = resolveNotificationRoute(notification(kind, { metadata: FULL_METADATA }))
      expect(route, kind).toBeTruthy()
      expect(isAppRoute(route as string), `${kind} → ${route}`).toBe(true)
    }
  })

  it('with NO metadata, every kind still opens an existing route (never a dead link)', () => {
    for (const kind of KINDS) {
      const route = resolveNotificationRoute(notification(kind))
      // Read in place when there is nowhere better to go.
      if (route === null) {
        expect(['system_announcement', 'recruiting_update'], kind).toContain(kind)
        continue
      }
      expect(isAppRoute(route), `${kind} → ${route}`).toBe(true)
    }
  })

  it('the id-carrying kinds put the id in the path', () => {
    const route = (kind: NotificationKind) => resolveNotificationRoute(notification(kind, { metadata: FULL_METADATA }))
    expect(route('message_received')).toBe(`/messages/${CONVERSATION}`)
    expect(route('conversation_started')).toBe(`/messages/${CONVERSATION}`)
    expect(route('opportunity_published')).toBe(`/opportunities/${OPPORTUNITY}`)
    // The applicant must never be sent to the club's applicants list.
    expect(route('vacancy_application_status')).toBe(`/opportunities/${OPPORTUNITY}`)
    expect(route('vacancy_application_received')).toBe(`/dashboard/opportunities/${OPPORTUNITY}/applicants`)
    expect(route('club_invitation_received')).toBe(`/clubs/id/${ACTOR}`)
  })

  it('recruiting_update follows each target the server functions write', () => {
    // The three shapes written by the recruiting SQL (send_invite, make_offer,
    // mark_signed, …: '/messages/<conversation>', '/messages', and
    // '/dashboard/opportunities/<role>/applicants').
    for (const target of [`/messages/${CONVERSATION}`, '/messages', `/dashboard/opportunities/${OPPORTUNITY}/applicants`]) {
      const viaColumn = resolveNotificationRoute(notification('recruiting_update', { targetUrl: target }))
      const viaMetadata = resolveNotificationRoute(notification('recruiting_update', { metadata: { target_url: target } }))
      expect(viaColumn).toBe(target)
      expect(viaMetadata).toBe(target)
      expect(isAppRoute(target), target).toBe(true)
    }
  })

  /** The row admin_send_removed_account_notice (20261004300000) writes when the
   *  conversation is hidden: the same '/messages' in the column AND in metadata. */
  const hiddenConversationNotice = () =>
    notification('system_announcement', {
      targetUrl: '/messages',
      metadata: { notice: 'removed_account', title: 'A message about your safety', summary: 'text', target_url: '/messages' },
    })

  it('a normal announcement keeps its link; a safety notice with a listed conversation opens it', () => {
    expect(resolveNotificationRoute(notification('system_announcement', { targetUrl: '/opportunities' }))).toBe('/opportunities')
    const listed = notification('system_announcement', {
      targetUrl: `/messages/${CONVERSATION}`,
      metadata: { notice: 'removed_account', target_url: `/messages/${CONVERSATION}` },
    })
    expect(resolveNotificationRoute(listed)).toBe(`/messages/${CONVERSATION}`)
  })

  it('the safety-notice config itself asks for "read in place" when the conversation is not listed', () => {
    const notice = hiddenConversationNotice()
    expect(getNotificationConfig(notice).getRoute?.(notice)).toBeNull()
  })

  // BUG (release audit 2026-10-05, LOW, components/notifications/config.ts:424-431,
  // shipped in this release by bd730047): the config returns null so the row is
  // read in place, but resolveNotificationRoute — the only function the drawer
  // and the Inbox call — treats null as "no route yet" and falls back to
  // notification.targetUrl, which is the very '/messages' the config refused.
  // The row stays tappable and opens an inbox where that conversation is not
  // listed. Fix: let a config return an explicit "no route" (e.g. `false`), or
  // skip the fallback when the config defines getRoute.
  it.fails('BUG: the safety notice about a removed account is read in place (no route) when its conversation is not listed', () => {
    expect(resolveNotificationRoute(hiddenConversationNotice())).toBeNull()
  })
})

describe('push payload × every notification kind', () => {
  it('every kind opens a route that exists in App.tsx, with and without metadata', () => {
    for (const kind of KINDS) {
      for (const metadata of [{}, FULL_METADATA]) {
        const { url } = buildPushPayload(kind, metadata, 'Ana Club')
        expect(url.startsWith('/'), `${kind} → ${url}`).toBe(true)
        expect(isAppRoute(url), `${kind} → ${url}`).toBe(true)
      }
    }
  })

  it('title and body are never empty and never leak a raw token', () => {
    for (const kind of KINDS) {
      const { title, body } = buildPushPayload(kind, {}, 'Ana Club')
      for (const text of [title, body]) {
        expect(text.trim().length, kind).toBeGreaterThan(0)
        expect(text, kind).not.toMatch(/undefined|null|NaN|\[object/)
        expect(text, kind).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
      }
    }
  })

  it('a recruiting push only follows a same-app path: an absolute or protocol-relative target is dropped', () => {
    expect(buildPushPayload('recruiting_update', { target_url: `/messages/${CONVERSATION}` }, 'x').url).toBe(`/messages/${CONVERSATION}`)
    expect(buildPushPayload('recruiting_update', { target_url: 'https://evil.example/phish' }, 'x').url).toBe('/messages')
    expect(buildPushPayload('recruiting_update', { target_url: 'javascript:alert(1)' }, 'x').url).toBe('/messages')
  })

  // BUG (release audit 2026-10-05, LOW, send-push/push-payload.ts:290): the
  // guard is `startsWith('/')`, which a protocol-relative URL passes. Only the
  // server's own SQL writes target_url today, so nothing reaches it; the guard
  // should still refuse it (`startsWith('/') && !startsWith('//')`).
  it.fails('BUG: a protocol-relative target ("//host/path") is refused too', () => {
    expect(buildPushPayload('recruiting_update', { target_url: '//evil.example/phish' }, 'x').url).toBe('/messages')
  })

  it('an unknown kind (a database value newer than the deployed function) still yields a usable push', () => {
    const out = buildPushPayload('kind_added_next_month', {}, 'Ana Club')
    expect(out.title.length).toBeGreaterThan(0)
    expect(isAppRoute(out.url)).toBe(true)
  })
})

// ── The tap on a push and the tap on the row must agree ─────────────────────

/** Path + the `tab` the dashboard opens: what decides which screen appears. */
function screenOf(url: string): string {
  const [pathname, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  const section = /^\/dashboard\/profile\/([^/]+)$/.exec(pathname)?.[1]
  const tab = section ?? params.get('tab')
  const base = section ? '/dashboard/profile' : pathname
  return tab ? `${base} [${tab}]` : base
}

/**
 * Kinds where the push and the row disagree today. Each is a real defect for
 * the person tapping the push; see the it.fails per group below.
 */
const PUSH_OPENS_WRONG_TAB: NotificationKind[] = ['reference_request_received', 'reference_updated', 'reference_request_rejected']
const PUSH_HAS_NO_COPY: NotificationKind[] = ['club_invitation_received', 'club_invitation_accepted']
// An announcement's row follows the admin-set target; its push goes to the
// feed by design (the full text is in the list).
const BY_DESIGN: NotificationKind[] = ['system_announcement']

describe('push ↔ in-app parity', () => {
  it('for every other kind, the push opens the same screen as the row', () => {
    const skip = new Set<NotificationKind>([...PUSH_OPENS_WRONG_TAB, ...PUSH_HAS_NO_COPY, ...BY_DESIGN])
    const compared: string[] = []
    for (const kind of KINDS.filter((k) => !skip.has(k))) {
      const inApp = resolveNotificationRoute(notification(kind, { metadata: FULL_METADATA })) as string
      const push = buildPushPayload(kind, FULL_METADATA, 'Ana Club').url
      expect(screenOf(push), `${kind}: row ${inApp} vs push ${push}`).toBe(screenOf(inApp))
      compared.push(kind)
    }
    expect(compared.length).toBe(KINDS.length - skip.size)
  })

  // BUG (release audit 2026-10-05, MEDIUM, send-push/push-payload.ts:66-95):
  // reference pushes still deep-link into the Friends tab. References moved to
  // their own tab on 2026-05-08 and the in-app rows were fixed then
  // (notifications/config.ts: "same noun, different feature"); the push
  // payload was not. Tapping "Ann requested a reference" opens Friends →
  // incoming friend requests, where there is nothing to answer; "updated" /
  // "declined" open Friends with a `section=references` anchor that does not
  // exist for players (FriendsTab is mounted with hideReferences).
  it.fails('BUG: reference pushes open the References tab, like their rows', () => {
    for (const kind of PUSH_OPENS_WRONG_TAB) {
      const inApp = resolveNotificationRoute(notification(kind)) as string
      const push = buildPushPayload(kind, {}, 'Ana Club').url
      expect(screenOf(push), kind).toBe(screenOf(inApp))
    }
  })

  // BUG (same audit, LOW-MEDIUM, send-push/push-payload.ts default branch):
  // the two club-invitation kinds have no case in buildPushPayload, so the
  // push reads "HOCKIA · You have a new notification" and opens the feed,
  // while the row says who invited you and opens that club.
  it.fails('BUG: club invitation pushes name the club and open the same place as their rows', () => {
    for (const kind of PUSH_HAS_NO_COPY) {
      const push = buildPushPayload(kind, {}, 'Ana Club')
      expect(push.body, kind).toContain('Ana Club')
      expect(push.body, kind).not.toBe('You have a new notification')
    }
  })

  it('the documented exceptions are still exceptions (delete an entry here when it is fixed)', () => {
    for (const kind of [...PUSH_OPENS_WRONG_TAB, ...PUSH_HAS_NO_COPY]) {
      const inApp = resolveNotificationRoute(notification(kind)) as string
      const push = buildPushPayload(kind, {}, 'Ana Club').url
      expect(screenOf(push), kind).not.toBe(screenOf(inApp))
    }
  })
})
