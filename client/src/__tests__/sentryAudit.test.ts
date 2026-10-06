import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn() } }))

import { buildSentryRelease } from '@/lib/sentryRelease'
import { scrubUrl, scrubBreadcrumb, scrubEvent } from '@/lib/sentryScrub'
import {
  isStaleChunkMessage,
  isExpectedRefusal,
  NEW_CONVERSATION_LIMIT_DETAIL,
  NEW_CONVERSATION_LIMIT_TEXT,
} from '@/lib/sentryFilters'
import { NEW_CONVERSATION_LIMIT_CODE, NEW_CONVERSATION_LIMIT_MESSAGE } from '@/lib/newConversationLimit'
import { INVITE_GENERIC_ERROR, inviteErrorMessage } from '@/lib/invites'
import type { ErrorEvent } from '@sentry/react'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('buildSentryRelease', () => {
  it('uses web@<sha> on Vercel', () => {
    expect(buildSentryRelease({ command: 'build', vercel: '1', vercelSha: SHA, gitSha: 'f'.repeat(40) })).toBe(`web@${SHA}`)
  })
  it('falls back to the git sha on a Vercel build without VERCEL_GIT_COMMIT_SHA', () => {
    expect(buildSentryRelease({ command: 'build', vercel: '1', gitSha: SHA })).toBe(`web@${SHA}`)
  })
  it('uses native@<git sha> for a non-Vercel build (cap:build)', () => {
    expect(buildSentryRelease({ command: 'build', gitSha: SHA })).toBe(`native@${SHA}`)
  })
  it('is dev on the dev server or without any sha', () => {
    expect(buildSentryRelease({ command: 'serve', vercel: '1', vercelSha: SHA })).toBe('dev')
    expect(buildSentryRelease({ command: 'build' })).toBe('dev')
    expect(buildSentryRelease({ command: 'build', vercel: '1' })).toBe('dev')
  })
  it('ignores values that are not a commit sha', () => {
    expect(buildSentryRelease({ command: 'build', gitSha: 'fatal: not a git repository' })).toBe('dev')
    expect(buildSentryRelease({ command: 'build', gitSha: ` ${SHA.toUpperCase()}\n` })).toBe(`native@${SHA}`)
  })
})

describe('scrubUrl', () => {
  it('drops the hash (implicit-flow tokens)', () => {
    expect(scrubUrl('https://inhockia.com/auth/callback#access_token=abc&refresh_token=def&type=signup'))
      .toBe('https://inhockia.com/auth/callback')
  })
  it('removes sensitive query params and keeps the rest', () => {
    expect(scrubUrl('https://inhockia.com/auth/callback?code=xyz&next=%2Fhome&token=t&token_hash=h&access_token=a&refresh_token=r'))
      .toBe('https://inhockia.com/auth/callback?next=%2Fhome')
  })
  it('works on relative paths and is case-insensitive on keys', () => {
    expect(scrubUrl('/auth/callback?Code=1&tab=2#x')).toBe('/auth/callback?tab=2')
    expect(scrubUrl('/home')).toBe('/home')
  })
  it('redacts emails in URLs', () => {
    expect(scrubUrl('/signin?email=jane.doe@example.com')).toBe('/signin?email=[REDACTED_EMAIL]')
  })
})

describe('scrubBreadcrumb / scrubEvent', () => {
  it('scrubs navigation and fetch breadcrumb URLs and emails in messages/data', () => {
    const crumb = scrubBreadcrumb({
      category: 'navigation',
      message: 'user jane@example.com',
      data: { from: '/auth/callback?code=abc', to: '/home#access_token=t', url: 'https://x.supabase.co/auth/v1/token?refresh_token=r', note: 'mail bob@example.org' },
    })
    expect(crumb.message).toBe('user [REDACTED_EMAIL]')
    expect(crumb.data).toEqual({
      from: '/auth/callback',
      to: '/home',
      url: 'https://x.supabase.co/auth/v1/token',
      note: 'mail [REDACTED_EMAIL]',
    })
  })
  it('scrubs request url, user, exception values and breadcrumbs on an event', () => {
    const event = scrubEvent({
      type: undefined,
      message: 'failed for a@b.co',
      user: { id: 'u1', email: 'a@b.co', ip_address: '1.2.3.4', username: 'x' },
      request: { url: 'https://inhockia.com/auth/callback?code=c#access_token=t', headers: { Referer: 'https://inhockia.com/x?token=t' } },
      exception: { values: [{ type: 'Error', value: 'duplicate key for someone@example.com' }] },
      breadcrumbs: [{ message: 'hi z@z.io', data: { to: '/a?code=1' } }],
    } as ErrorEvent)
    expect(event.user).toEqual({ id: 'u1' })
    expect(event.request?.url).toBe('https://inhockia.com/auth/callback')
    expect(event.request?.headers?.Referer).toBe('https://inhockia.com/x')
    expect(event.message).toBe('failed for [REDACTED_EMAIL]')
    expect(event.exception?.values?.[0].value).toBe('duplicate key for [REDACTED_EMAIL]')
    expect(event.breadcrumbs?.[0]).toEqual({ message: 'hi [REDACTED_EMAIL]', data: { to: '/a' } })
  })
})

describe('isStaleChunkMessage', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://inhockia.com/assets/HomePage-abc.js',
    'error loading dynamically imported module: https://inhockia.com/assets/HomePage-abc.js',
    'Importing a module script failed.',
    'Failed to load module script: Expected a JavaScript module script',
    "'text/html' is not a valid JavaScript MIME type.",
  ])('matches %s', (msg) => {
    expect(isStaleChunkMessage(msg)).toBe(true)
  })
  it('ignores other errors', () => {
    expect(isStaleChunkMessage('Cannot read properties of undefined')).toBe(false)
    expect(isStaleChunkMessage(undefined)).toBe(false)
    expect(isStaleChunkMessage('')).toBe(false)
  })
})

describe('isExpectedRefusal', () => {
  it('stays in sync with lib/newConversationLimit', () => {
    expect(NEW_CONVERSATION_LIMIT_DETAIL).toBe(NEW_CONVERSATION_LIMIT_CODE)
    expect(NEW_CONVERSATION_LIMIT_MESSAGE.startsWith(NEW_CONVERSATION_LIMIT_TEXT)).toBe(true)
  })
  it('matches the blocked-member and new-conversation refusals', () => {
    expect(isExpectedRefusal({ message: 'This user is not available for messaging right now.', code: 'P0001' })).toBe(true)
    expect(isExpectedRefusal({ message: 'anything', details: 'new_conversation_limit' })).toBe(true)
    expect(isExpectedRefusal({ message: NEW_CONVERSATION_LIMIT_MESSAGE })).toBe(true)
    expect(isExpectedRefusal(new Error('This user is not available for messaging right now.'))).toBe(true)
  })
  it('does not match real errors', () => {
    expect(isExpectedRefusal({ message: 'permission denied for table messages', code: '42501' })).toBe(false)
    expect(isExpectedRefusal(null)).toBe(false)
    expect(isExpectedRefusal('This user is not available for messaging right now.')).toBe(false)
  })
})

describe('invite refusal reporting', () => {
  it('only unknown failures map to the generic (reportable) copy', () => {
    expect(inviteErrorMessage({ message: 'Daily invite limit reached (20 per day)' })).not.toBe(INVITE_GENERIC_ERROR)
    expect(inviteErrorMessage({ message: 'This player already has an open invite from you' })).not.toBe(INVITE_GENERIC_ERROR)
    expect(inviteErrorMessage({ message: 'This role is not open' })).not.toBe(INVITE_GENERIC_ERROR)
    expect(inviteErrorMessage({ message: 'connection reset' })).toBe(INVITE_GENERIC_ERROR)
  })
})

describe('scrubUrl encoding', () => {
  it('keeps other params byte-for-byte and catches percent-encoded emails', () => {
    expect(scrubUrl('/s?q=a+b%20c&x=1&code=2')).toBe('/s?q=a+b%20c&x=1')
    expect(scrubUrl('/signin?email=jane%40example.com&code=1')).toBe('/signin?email=[REDACTED_EMAIL]')
    expect(scrubUrl('/a?access%5Ftoken=t&b=1')).toBe('/a?b=1')
  })
})
