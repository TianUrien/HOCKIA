import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── mocks ────────────────────────────────────────────────────────────────
const invokeMock = vi.fn()
const deleteEqs: unknown[][] = []
const deleteResult = { error: null as unknown }
const upsertMock = vi.fn((row: unknown, opts?: unknown) => Promise.resolve({ error: null, row, opts }))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
    from: () => ({
      update: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ id: 'x' }], error: null }) }) }),
      upsert: (row: unknown, opts?: unknown) => upsertMock(row, opts),
      delete: () => {
        const calls: unknown[][] = []
        const chain = {
          eq: (...a: unknown[]) => {
            calls.push(a)
            if (calls.length === 2) {
              deleteEqs.push(...calls)
              return Promise.resolve(deleteResult)
            }
            return chain
          },
        }
        return chain
      },
    }),
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
}))

const nativeState = { native: true }
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => nativeState.native,
    getPlatform: () => 'ios',
  },
}))

type Listener = (payload: unknown) => void
const listeners = new Map<string, Listener>()
const pushPlugin = {
  checkPermissions: vi.fn(() => Promise.resolve({ receive: 'granted' })),
  register: vi.fn(() => {
    queueMicrotask(() => listeners.get('registration')?.({ value: 'tok-123' }))
    return Promise.resolve()
  }),
  addListener: vi.fn((event: string, cb: Listener) => {
    listeners.set(event, cb)
    return Promise.resolve({ remove: () => { listeners.delete(event); return Promise.resolve() } })
  }),
}
vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: pushPlugin }))

import {
  NATIVE_PUSH_TOKEN_KEY,
  addPushTapListener,
  refreshNativePushRegistration,
  removeThisDevicePushSubscription,
  safePushPath,
} from '@/lib/nativePush'
import { APPLICATION_MOVED_ON_MESSAGE, isApplicationMovedOnError } from '@/lib/applicationStatus'
import { holdDecision, UNDO_WINDOW_MS } from '@/lib/pendingDecisions'

beforeEach(() => {
  nativeState.native = true
  deleteEqs.length = 0
  deleteResult.error = null
  listeners.clear()
  invokeMock.mockReset()
  upsertMock.mockClear()
  pushPlugin.checkPermissions.mockClear()
  pushPlugin.register.mockClear()
  window.localStorage.clear()
})

// ── push tap paths ───────────────────────────────────────────────────────
describe('safePushPath', () => {
  it('accepts same-origin relative paths only', () => {
    expect(safePushPath('/messages/abc')).toBe('/messages/abc')
    expect(safePushPath('/dashboard/profile?tab=references')).toBe('/dashboard/profile?tab=references')
    expect(safePushPath('//evil.example/x')).toBeNull()
    expect(safePushPath('/\\evil.example')).toBeNull()
    expect(safePushPath('https://evil.example')).toBeNull()
    expect(safePushPath('javascript:alert(1)')).toBeNull()
    expect(safePushPath('/ok\nbad')).toBeNull()
    expect(safePushPath(undefined)).toBeNull()
    expect(safePushPath(42)).toBeNull()
  })
})

describe('addPushTapListener', () => {
  it('navigates to the payload url on tap, ignoring unsafe ones', async () => {
    const navigate = vi.fn()
    const dispose = await addPushTapListener(navigate)
    const tap = listeners.get('pushNotificationActionPerformed')!
    tap({ notification: { data: { url: '/messages/c1' } } })
    tap({ notification: { data: { url: '//evil.example' } } })
    tap({ notification: { data: {} } })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/messages/c1')
    dispose()
  })

  it('is a no-op on the web', async () => {
    nativeState.native = false
    const navigate = vi.fn()
    await addPushTapListener(navigate)
    expect(listeners.size).toBe(0)
  })
})

// ── token hygiene ────────────────────────────────────────────────────────
describe('removeThisDevicePushSubscription', () => {
  it("deletes only this device's row for the signed-in user", async () => {
    window.localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, 'tok-abc')
    await removeThisDevicePushSubscription('user-1')
    expect(deleteEqs).toEqual([['profile_id', 'user-1'], ['fcm_token', 'tok-abc']])
    expect(window.localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)).toBeNull()
  })

  it('does nothing without a remembered token, a user, or on the web', async () => {
    await removeThisDevicePushSubscription('user-1')
    window.localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, 'tok-abc')
    await removeThisDevicePushSubscription(null)
    nativeState.native = false
    await removeThisDevicePushSubscription('user-1')
    expect(deleteEqs).toEqual([])
  })

  it('never throws when the delete fails', async () => {
    window.localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, 'tok-abc')
    deleteResult.error = { message: 'network' }
    await expect(removeThisDevicePushSubscription('user-1')).resolves.toBeUndefined()
    expect(window.localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)).toBe('tok-abc')
  })
})

describe('refreshNativePushRegistration', () => {
  it('re-registers and upserts the token when permission is already granted', async () => {
    await expect(refreshNativePushRegistration('user-1')).resolves.toBe(true)
    expect(pushPlugin.register).toHaveBeenCalledTimes(1)
    expect(upsertMock).toHaveBeenCalledTimes(1)
    const row = (upsertMock.mock.calls[0] as unknown[])[0] as Record<string, unknown>
    expect(row).toMatchObject({ profile_id: 'user-1', fcm_token: 'tok-123', platform: 'ios', endpoint: 'fcm:tok-123' })
    expect(window.localStorage.getItem(NATIVE_PUSH_TOKEN_KEY)).toBe('tok-123')
  })

  it('never prompts or registers without a granted permission', async () => {
    pushPlugin.checkPermissions.mockImplementationOnce(() => Promise.resolve({ receive: 'prompt' }))
    await expect(refreshNativePushRegistration('user-1')).resolves.toBe(false)
    expect(pushPlugin.register).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

// ── decline refused because the application moved on ─────────────────────
describe('decline 409 invalid_status', () => {
  afterEach(() => { vi.useRealTimers() })

  it('recognises only the invalid_status 409', async () => {
    const moved = new Response(JSON.stringify({ error: 'invalid_status' }), { status: 409 })
    const withdrawn = new Response(JSON.stringify({ error: 'withdrawn' }), { status: 409 })
    expect(await isApplicationMovedOnError({ context: moved })).toBe(true)
    expect(await isApplicationMovedOnError({ context: withdrawn })).toBe(false)
    expect(await isApplicationMovedOnError(new Error('x'))).toBe(false)
    expect(APPLICATION_MOVED_ON_MESSAGE).not.toMatch(/error|fail/i)
  })

  it('reports movedOn to the caller instead of a generic failure', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-06T12:00:00Z') })
    invokeMock.mockResolvedValue({
      data: null,
      error: { message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error: 'invalid_status' }), { status: 409 }) },
    })
    const done = vi.fn()
    holdDecision({ kind: 'decline', applicationId: 'app-9', reason: 'timing', message: 'Thanks.' }, done)
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 10)
    expect(done).toHaveBeenCalledWith(false, undefined, true)
  })
})
