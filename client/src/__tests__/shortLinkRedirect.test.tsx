import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const m = vi.hoisted(() => ({
  rpc: vi.fn(),
  replace: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: m.rpc } }))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/attribution', () => ({ currentPlatform: () => 'web' }))
vi.mock('@/lib/analyticsIdentity', () => ({ getDeviceContext: () => ({ device: 'Desktop', browser: 'Chrome' }) }))

import ShortLinkGate from '@/components/ShortLinkGate'

function Probe() {
  const loc = useLocation()
  return <div data-testid="where">{loc.pathname + loc.search}</div>
}

// Mounted exactly as App.tsx does: the gate swaps the app shell for the
// resolver on /l/<code>. There is NO <Route>, so the page must read the
// code from the pathname — the bug a Route-wrapped test would hide.
function mount(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ShortLinkGate>
        <Probe />
      </ShortLinkGate>
    </MemoryRouter>,
  )
}

describe('ShortLinkRedirect (via ShortLinkGate)', () => {
  beforeEach(() => {
    m.rpc.mockReset()
    m.replace.mockReset()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, replace: m.replace, origin: 'http://localhost' },
      writable: true, configurable: true,
    })
  })

  it('resolves the code and navigates in-app with utm + hk_link, replacing history', async () => {
    m.rpc.mockResolvedValue({ data: { code: 'ig', destination: '/', utm_source: 'instagram', utm_medium: 'social', utm_campaign: 'bio' }, error: null })
    mount('/l/IG')
    expect(screen.getByTestId('short-link-redirect')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/?utm_source=instagram&utm_medium=social&utm_campaign=bio&hk_link=ig'))
    expect(m.rpc).toHaveBeenCalledWith('resolve_short_link', expect.objectContaining({ p_code: 'ig', p_platform: 'web', p_device: 'Desktop' }))
    expect(m.replace).not.toHaveBeenCalled()
  })

  it('leaves the SPA for external destinations', async () => {
    m.rpc.mockResolvedValue({ data: { code: 'site', destination: 'https://inhockia.com/', utm_source: 'qr' }, error: null })
    mount('/l/site')
    await waitFor(() => expect(m.replace).toHaveBeenCalledWith('https://inhockia.com/?utm_source=qr&hk_link=site'))
  })

  it('an unknown code goes home untagged', async () => {
    m.rpc.mockResolvedValue({ data: null, error: null })
    mount('/l/nope')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'))
    expect(screen.getByTestId('where').textContent).toBe('/')
  })

  it('a failed lookup also goes home instead of stranding the visitor', async () => {
    m.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    mount('/l/ig')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/'))
  })
})
