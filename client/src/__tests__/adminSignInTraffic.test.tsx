import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Admin "Sign-in traffic" (brief 2026-11-11): attempts per network and device,
// shown as hash tags, with what the rate limit would have refused.

let rpcCalls: { fn: string; args: Record<string, unknown> | undefined }[] = []
let summary: Record<string, unknown> | null = null
let rpcError: { message: string } | null = null

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      rpcCalls.push({ fn, args })
      return Promise.resolve({ data: summary, error: rpcError })
    },
  },
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon-key',
}))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }))

import { AdminSignInTraffic } from '@/features/admin/pages/AdminSignInTraffic'

const base = {
  hours: 24, rate_limit_enabled: false, turnstile_enforced: false,
  device_max: 10, ip_max: 40, window_seconds: 300, signups_per_hour: 30,
}

describe('AdminSignInTraffic', () => {
  beforeEach(() => { rpcCalls = []; summary = null; rpcError = null })

  it('shows both switches, the totals and the busiest sources as codes', async () => {
    summary = {
      ...base,
      totals: [
        { kind: 'oauth_start', outcome: 'allowed', attempts: 40 },
        { kind: 'oauth_start', outcome: 'would_limit', attempts: 15 },
        { kind: 'password_signin_failed', outcome: 'observed', attempts: 3 },
      ],
      sources: [{
        network: 'a1b2c3d4', device: 'e5f6a7b8', device_label: 'Android 11 · IN2023 · WebView', platform: 'android',
        app_version: '1.26', country: 'AR', attempts: 55, oauth_starts: 55, failed_signins: 0, new_accounts: 0,
        would_limit: 15, refused: 0, first_seen: '2026-11-10T10:00:00Z', last_seen: '2026-11-10T10:04:00Z',
      }],
    }
    render(<MemoryRouter><AdminSignInTraffic /></MemoryRouter>)

    await waitFor(() => expect(screen.getByText('a1b2c3d4 · e5f6a7b8')).toBeInTheDocument())
    expect(rpcCalls[0]).toEqual({ fn: 'admin_get_auth_attempts', args: { p_hours: 24 } })
    expect(screen.getByText('Rate limit: off')).toBeInTheDocument()
    expect(screen.getByText('Bot check required: off')).toBeInTheDocument()
    expect(screen.getByText('Android 11 · IN2023 · WebView · android · 1.26 · AR')).toBeInTheDocument()
    expect(screen.getByText('15 would be limited')).toBeInTheDocument()
    expect(screen.getByText(/10 per device and 40 per network every 5 minutes/)).toBeInTheDocument()
  })

  it('says so when nothing was recorded, and shows a load failure', async () => {
    summary = { ...base, totals: [], sources: [] }
    const { unmount } = render(<MemoryRouter><AdminSignInTraffic /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('No sign-in or sign-up attempts recorded in this period.')).toBeInTheDocument())
    unmount()

    rpcError = { message: 'Unauthorized' }
    render(<MemoryRouter><AdminSignInTraffic /></MemoryRouter>)
    await waitFor(() => expect(screen.getByText('Failed to get sign-in traffic: Unauthorized')).toBeInTheDocument())
  })
})
