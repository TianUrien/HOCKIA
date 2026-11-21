import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

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

  it('shows nothing when the setting cannot be read, to a signed-out visitor, or to the help account itself', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no such function' } })
    const a = render(<HockiaHelpLine moment="error_screen" />)
    await waitFor(() => expect(rpc).toHaveBeenCalled())
    expect(a.container.textContent).toBe('')
    a.unmount()

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
    render(<HockiaHelpLine moment="search_empty" onNavigate={onNavigate} />)
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
    render(<HockiaHelpLine moment="error_screen" onNavigate={onNavigate} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask Hockia' }))
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/messages?conversation=c1'))
    expect(screen.getByTestId('hockia-help-line').textContent).toBe('Not working? Ask Hockia')
    expect(loadMessageDraft('member-1', 'c1')).toBe('My own words')
  })

  it('names the screen without ids', () => {
    expect(helpScreen('/players/id/0b6f2a1e-1111-4222-8333-444455556666/videos')).toBe('/players/id/:id/videos')
    expect(helpScreen('/world/clubs/1234')).toBe('/world/clubs/:id')
    expect(helpScreen('/settings')).toBe('/settings')
  })
})
