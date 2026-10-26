/**
 * The icon-badge sync must never trigger the iOS notification prompt: on iOS
 * Badge.set/clear request permission first, which prompted every fresh install
 * at launch. Only sync when permission is already granted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const badge = vi.hoisted(() => ({ checkPermissions: vi.fn(), clear: vi.fn(), set: vi.fn() }))
vi.mock('@capawesome/capacitor-badge', () => ({ Badge: badge }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } }))
vi.mock('@capacitor/status-bar', () => ({ StatusBar: {}, Style: {} }))

import { setAppBadge } from '@/lib/nativeUi'

describe('setAppBadge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does nothing (and asks nothing) before notification permission is granted', async () => {
    badge.checkPermissions.mockResolvedValue({ display: 'prompt' })
    await setAppBadge(0)
    await setAppBadge(3)
    expect(badge.clear).not.toHaveBeenCalled()
    expect(badge.set).not.toHaveBeenCalled()
  })

  it('syncs the count once permission is granted', async () => {
    badge.checkPermissions.mockResolvedValue({ display: 'granted' })
    await setAppBadge(0)
    expect(badge.clear).toHaveBeenCalledTimes(1)
    await setAppBadge(3)
    expect(badge.set).toHaveBeenCalledWith({ count: 3 })
  })
})
