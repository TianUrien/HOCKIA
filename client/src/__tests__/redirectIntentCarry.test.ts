/**
 * The destination picked before sign-up (club invite, a role they tried to
 * apply to) must survive onboarding and a browser switch (Instagram's in-app
 * browser → confirmation email opened in Safari).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: vi.fn(async () => ({})) } } }))

import { consumeRedirectIntent, pendingRedirectIntent, POST_AUTH_NEXT_KEY, REDIRECT_INTENT_KEY } from '@/lib/redirectIntent'

beforeEach(() => sessionStorage.clear())

describe('pendingRedirectIntent', () => {
  it('prefers a safe ?next=, else the tab stash, never an unsafe one', () => {
    sessionStorage.setItem(REDIRECT_INTENT_KEY, '/invite/club/tok')
    expect(pendingRedirectIntent('/opportunities/1')).toBe('/opportunities/1')
    expect(pendingRedirectIntent(null)).toBe('/invite/club/tok')
    expect(pendingRedirectIntent('//evil.example')).toBe('/invite/club/tok')
    sessionStorage.setItem(REDIRECT_INTENT_KEY, '/\\evil.example')
    expect(pendingRedirectIntent(null)).toBeNull()
  })
})

describe('consumeRedirectIntent', () => {
  it('uses the tab stash once', () => {
    sessionStorage.setItem(REDIRECT_INTENT_KEY, '/invite/club/tok')
    expect(consumeRedirectIntent(null, vi.fn())).toBe('/invite/club/tok')
    expect(consumeRedirectIntent(null, vi.fn())).toBeNull()
  })

  it('falls back to the destination carried on the account (other browser) and clears it', () => {
    const clear = vi.fn()
    const user = { user_metadata: { [POST_AUTH_NEXT_KEY]: '/invite/club/tok' } }
    expect(consumeRedirectIntent(user, clear)).toBe('/invite/club/tok')
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('never returns an unsafe carried destination, but still clears it', () => {
    const clear = vi.fn()
    expect(consumeRedirectIntent({ user_metadata: { [POST_AUTH_NEXT_KEY]: 'https://evil.example' } }, clear)).toBeNull()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('returns null with nothing pending and leaves metadata alone', () => {
    const clear = vi.fn()
    expect(consumeRedirectIntent({ user_metadata: {} }, clear)).toBeNull()
    expect(clear).not.toHaveBeenCalled()
  })
})
