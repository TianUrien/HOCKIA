/**
 * "Continue with Facebook" runtime switch: the store apps bake their bundle,
 * so the button must be switchable without a new build (app_settings
 * 'facebook_login_enabled' via the facebook_login_enabled() RPC).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }))

import { resetFacebookLoginSwitch, useFacebookLoginEnabled } from '@/hooks/useFacebookLoginEnabled'

beforeEach(() => {
  resetFacebookLoginSwitch()
  rpc.mockReset()
})
afterEach(() => vi.unstubAllEnvs())

describe('useFacebookLoginEnabled', () => {
  it('is hidden while the runtime switch is off', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const { result } = renderHook(() => useFacebookLoginEnabled())
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('facebook_login_enabled'))
    expect(result.current).toBe(false)
  })

  it('shows once the runtime switch is on (store apps, no new build)', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    const { result } = renderHook(() => useFacebookLoginEnabled())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('stays hidden when the switch cannot be read', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'nope' } })
    const { result } = renderHook(() => useFacebookLoginEnabled())
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(result.current).toBe(false)
    resetFacebookLoginSwitch()
    rpc.mockRejectedValue(new Error('offline'))
    const second = renderHook(() => useFacebookLoginEnabled())
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2))
    expect(second.result.current).toBe(false)
  })

  it('the build flag forces it on without asking the server', () => {
    vi.stubEnv('VITE_ENABLE_FACEBOOK_LOGIN', 'true')
    const { result } = renderHook(() => useFacebookLoginEnabled())
    expect(result.current).toBe(true)
    expect(rpc).not.toHaveBeenCalled()
  })

  it('asks the server once per page load', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    renderHook(() => useFacebookLoginEnabled())
    renderHook(() => useFacebookLoginEnabled())
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
  })
})
