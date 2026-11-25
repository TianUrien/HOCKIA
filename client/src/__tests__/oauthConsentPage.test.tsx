/**
 * Assistant connector consent page (/oauth/consent, 2026-11-25): signed-out
 * members are sent to sign in with the authorization id kept; an earlier
 * approval redirects straight away; Allow and Don't allow hand Supabase's
 * redirect to the browser, and only an https one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const { oauth, authState } = vi.hoisted(() => ({
  oauth: { getAuthorizationDetails: vi.fn(), approveAuthorization: vi.fn(), denyAuthorization: vi.fn() },
  authState: { user: null as unknown, profile: null as unknown, loading: false },
}))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { oauth } } }))
vi.mock('@/lib/auth', () => ({ useAuthStore: () => authState }))

import OAuthConsentPage from '@/pages/OAuthConsentPage'

const assign = vi.fn()

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/oauth/consent${search}`]}>
      <Routes>
        <Route path="/oauth/consent" element={<OAuthConsentPage />} />
        <Route path="/signin" element={<p>signin page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  Object.values(oauth).forEach((fn) => fn.mockReset())
  assign.mockReset()
  vi.stubGlobal('location', { ...window.location, assign })
  sessionStorage.clear()
  Object.assign(authState, { user: { id: 'u1' }, profile: { full_name: 'Ana Test' }, loading: false })
})
afterEach(() => vi.unstubAllGlobals())

describe('OAuthConsentPage', () => {
  it('asks a signed-out member to sign in and keeps the authorization id for afterwards', () => {
    authState.user = null
    renderAt('?authorization_id=abc')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(screen.getByText('signin page')).toBeTruthy()
    expect(sessionStorage.getItem('hockia-redirect-after-login')).toBe('/oauth/consent?authorization_id=abc')
    expect(oauth.getAuthorizationDetails).not.toHaveBeenCalled()
  })

  it('never follows the details redirect_uri: it carries no code', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { redirect_uri: 'https://mcp.example/callback', client: { name: 'x' }, scope: '' }, error: null })
    renderAt('?authorization_id=abc')
    await screen.findByText('Allow the Hockia connector?')
    expect(assign).not.toHaveBeenCalled()
  })

  it('shows what the connector can read and approves on Allow', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: 'Hockia connector' }, scope: 'openid' }, error: null })
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'https://mcp.example/callback?code=2' }, error: null })
    renderAt('?authorization_id=abc')
    await screen.findByText('Allow the Hockia connector?')
    expect(screen.getByText('It cannot apply, send messages, post or change anything.')).toBeTruthy()
    expect(screen.getByText('Signed in as Ana Test')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mcp.example/callback?code=2'))
    expect(oauth.approveAuthorization).toHaveBeenCalledWith('abc', { skipBrowserRedirect: true })
  })

  it("denies on Don't allow", async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: 'x' }, scope: '' }, error: null })
    oauth.denyAuthorization.mockResolvedValue({ data: { redirect_url: 'https://mcp.example/callback?error=access_denied' }, error: null })
    renderAt('?authorization_id=abc')
    fireEvent.click(await screen.findByRole('button', { name: "Don't allow" }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://mcp.example/callback?error=access_denied'))
    expect(oauth.approveAuthorization).not.toHaveBeenCalled()
  })

  it('never follows a redirect that is not https', async () => {
    oauth.getAuthorizationDetails.mockResolvedValue({ data: { client: { name: 'x' }, scope: '' }, error: null })
    oauth.approveAuthorization.mockResolvedValue({ data: { redirect_url: 'javascript:alert(1)' }, error: null })
    renderAt('?authorization_id=abc')
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }))
    await screen.findByText('Hockia could not finish connecting. Try again from your AI assistant.')
    expect(assign).not.toHaveBeenCalled()
  })

  it('treats a missing or unknown authorization as expired', async () => {
    renderAt('')
    await screen.findByText('This link has expired')
    oauth.getAuthorizationDetails.mockResolvedValue({ data: null, error: { message: 'not found' } })
    renderAt('?authorization_id=zzz')
    expect((await screen.findAllByText('This link has expired')).length).toBeGreaterThan(0)
  })
})
