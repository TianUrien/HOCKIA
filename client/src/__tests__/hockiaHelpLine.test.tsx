import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'

const rpc = vi.fn()
const track = vi.fn()
const resolveRoute = vi.fn()
let userId: string | null = 'member-1'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: (...a: unknown[]) => track(...a) }))
vi.mock('@/lib/startConversation', () => ({ resolveConversationRoute: (...a: unknown[]) => resolveRoute(...a) }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: { user: { id: string } | null }) => unknown) => sel({ user: userId ? { id: userId } : null }) }))

import { HockiaHelpLine } from '@/components/HockiaHelpLine'
import { helpScreen, resetHelpProfile } from '@/lib/hockiaHelp'
import { loadMessageDraft, saveMessageDraft } from '@/lib/messageDrafts'

const HELP = '11111111-2222-3333-4444-555555555555'

/** Renders inside a router and reports where it navigated to. */
function Probe({ onPath }: { onPath: (p: string) => void }) {
  const l = useLocation()
  if (l.pathname !== '/start') onPath(l.pathname + l.search)
  return null
}
function renderRouted(ui: React.ReactElement, onNavigate: (route: string) => void) {
  return render(<MemoryRouter initialEntries={['/start']}>{ui}<Probe onPath={onNavigate} /></MemoryRouter>)
}

/**
 * "Ask Hockia" at failure and help moments (founder 2026-11-21, proposal
 * brand-promotion.md, phase 2): only when a help account is set, only for a
 * signed-in member, never for that account itself.
 */
describe('HockiaHelpLine', () => {
  beforeEach(() => {
    rpc.mockReset(); track.mockReset(); resolveRoute.mockReset()
    resetHelpProfile()
    window.localStorage.clear()
    userId = 'member-1'
    window.history.replaceState(null, '', '/opportunities/0b6f2a1e-1111-4222-8333-444455556666')
  })

  it('shows nothing when no help account is set', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    const { container } = render(<HockiaHelpLine moment="error_screen" />)
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('hockia_help_profile_id'))
    expect(container.textContent).toBe('')
    expect(track).not.toHaveBeenCalled()
  })

  it('shows nothing when the setting cannot be read, and asks again on the next screen', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no such function' } })
    const a = render(<HockiaHelpLine moment="error_screen" />)
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1))
    expect(a.container.textContent).toBe('')
    a.unmount()
    // A failed read is not remembered: the next mount reads again and can show the line.
    rpc.mockResolvedValue({ data: HELP, error: null })
    render(<HockiaHelpLine moment="error_screen" />)
    expect(await screen.findByRole('button', { name: 'Ask Hockia' })).toBeTruthy()
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it('shows nothing to a signed-out visitor or to the help account itself', async () => {

    resetHelpProfile(); rpc.mockReset(); rpc.mockResolvedValue({ data: HELP, error: null })
    userId = null
    const b = render(<HockiaHelpLine moment="error_screen" />)
    expect(b.container.textContent).toBe('')
    expect(rpc).not.toHaveBeenCalled()
    b.unmount()

    userId = HELP
    const c = render(<HockiaHelpLine moment="error_screen" />)
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(c.container.textContent).toBe('')
  })

  it('offers the chat, records the moment without ids, and prepares a draft that names the screen', async () => {
    rpc.mockResolvedValue({ data: HELP, error: null })
    resolveRoute.mockResolvedValue(`/messages?new=${HELP}`)
    const onNavigate = vi.fn()
    renderRouted(<HockiaHelpLine moment="search_empty" />, onNavigate)
    const ask = await screen.findByRole('button', { name: 'Ask Hockia' })
    expect(screen.getByTestId('hockia-help-line').textContent).toBe('Can’t find it? Ask Hockia')
    expect(track).toHaveBeenCalledWith('help_moment_shown', undefined, undefined, { moment: 'search_empty', screen: '/opportunities/:id' })

    fireEvent.click(ask)
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(`/messages?new=${HELP}`))
    expect(track).toHaveBeenCalledWith('help_moment_open', undefined, undefined, { moment: 'search_empty', screen: '/opportunities/:id' })
    expect(resolveRoute).toHaveBeenCalledWith('member-1', HELP)
    expect(loadMessageDraft('member-1', `pending-${HELP}`)).toBe('I need help on this screen: /opportunities/:id\n')
  })

  it('never replaces something the member already started typing', async () => {
    rpc.mockResolvedValue({ data: HELP, error: null })
    resolveRoute.mockResolvedValue('/messages?conversation=c1')
    saveMessageDraft('member-1', 'c1', 'My own words')
    const onNavigate = vi.fn()
    renderRouted(<HockiaHelpLine moment="settings_help" />, onNavigate)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Hockia' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/messages?conversation=c1'))
    expect(screen.getByTestId('hockia-help-line').textContent).toBe('Have a question? Ask Hockia')
    expect(loadMessageDraft('member-1', 'c1')).toBe('My own words')
  })

  it('inside the app it navigates with the router: no page load, so typed feedback or a Hockia AI thread is kept', async () => {
    rpc.mockResolvedValue({ data: HELP, error: null })
    resolveRoute.mockResolvedValue('/messages?conversation=c9')
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, pathname: '/search' } })
    const onNavigate = vi.fn()
    renderRouted(<HockiaHelpLine moment="ai_no_result" />, onNavigate)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Hockia' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/messages?conversation=c9'))
    expect(assign).not.toHaveBeenCalled()
  })

  it('on an error screen it loads the chat as a fresh page', async () => {
    rpc.mockResolvedValue({ data: HELP, error: null })
    resolveRoute.mockResolvedValue('/messages?conversation=c9')
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, assign, pathname: '/home' } })
    renderRouted(<HockiaHelpLine moment="error_screen" hard />, vi.fn())
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Hockia' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/messages?conversation=c9'))
    expect(screen.getByTestId('hockia-help-line').textContent).toBe('Not working? Ask Hockia')
  })

  it('names the screen as a route pattern: no id, username, slug or secret token leaves the device', () => {
    expect(helpScreen('/players/id/0b6f2a1e-1111-4222-8333-444455556666/videos')).toBe('/players/id/:id/:id')
    expect(helpScreen('/world/clubs/1234')).toBe('/world/clubs/:id')
    expect(helpScreen('/settings')).toBe('/settings')
    expect(helpScreen('/brands/northline-hockey')).toBe('/brands/:id')
    expect(helpScreen('/players/some.username')).toBe('/players/:id')
    // 64 and 32 hex characters: an invitation and an investor token.
    expect(helpScreen(`/invite/club/${'a1'.repeat(32)}`)).toBe('/invite/club/:id')
    expect(helpScreen(`/investors/${'f0'.repeat(16)}`)).toBe('/investors/:id')
    expect(helpScreen('/')).toBe('/')
  })
})
