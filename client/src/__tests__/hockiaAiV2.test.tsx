/**
 * Hockia AI v2 (Figma 04 · Player — Live 44:321 + states 524:1494 / 1575 /
 * 1644 / 1715 / 1785; founder rulings 2026-10-03).
 *
 * Every state renders from the chat store; nl-search is never called. The
 * rules under test: first use, loading, answer with role rows, no match,
 * can't answer, neutral error, cap card, the composer, no gradients, no
 * fit / level / competitor-count text for a player, chips send or navigate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { DiscoverChatMessage, OpportunityResultItem } from '@/hooks/useDiscover'

vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
vi.mock('@/lib/sentryHelpers', () => ({ reportSupabaseError: vi.fn() }))
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components/FeedbackModal', () => ({ default: () => <div data-testid="feedback-modal" /> }))

type Viewer = { user: { id: string } | null; profile: { id: string; role: string; full_name: string; coach_recruits_for_team?: boolean } | null }
const authState: Viewer = {
  user: { id: 'p1' },
  profile: { id: 'p1', role: 'player', full_name: 'Tian Urien' },
}
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (selector?: (s: Viewer) => unknown) => (selector ? selector(authState) : authState),
    { getState: () => authState },
  ),
}))

import DiscoverPage from '@/pages/DiscoverPage'
import { useDiscoverChat } from '@/hooks/useDiscover'
import {
  CAP_REACHED_COPY,
  COMPOSER_PLACEHOLDER,
  ROLE_EXAMPLE,
  cantAnswerChips,
  capReachedChips,
  errorChips,
  exampleQueriesFor,
  fromOpenRolesCaption,
  roleResultMeta,
  roleResultTitle,
  stripRankingLines,
} from '@/lib/hockiaAi'

const roles: OpportunityResultItem[] = [
  {
    id: 'o1', title: 'Goalkeeper', position_label: 'Goalkeeper', category_label: "Women's team",
    location_label: 'Bra, Italy', organization: 'HC Bra', logo_url: null,
    benefit_labels: ['Housing', 'Paid'], deadline: null, navigate_to: '/opportunities/o1',
  },
  {
    id: 'o2', title: 'Goalkeeper', position_label: 'Goalkeeper', category_label: "Women's team",
    location_label: 'Rome, Italy', organization: 'Butterfly Roma', logo_url: null,
    benefit_labels: ['Flights'], deadline: null, navigate_to: '/opportunities/o2',
  },
]

function msg(partial: Partial<DiscoverChatMessage> & Pick<DiscoverChatMessage, 'role'>): DiscoverChatMessage {
  return { id: Math.random().toString(36).slice(2), content: '', timestamp: 1, status: 'complete', ...partial }
}

function setChat(messages: DiscoverChatMessage[], isPending = false) {
  useDiscoverChat.setState({ messages, isPending })
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/opportunities" element={<div>Opportunities page</div>} />
        <Route path="/opportunities/:id" element={<div>Role page</div>} />
        <Route path="/dashboard/profile/edit" element={<div>Edit profile page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const FORBIDDEN_PLAYER_TEXT = /strong match|good match|possible match|fit score|match score|fit level|your level|\d+\s+(?:other\s+)?(?:applicants|candidates|competitors)|ranked|percentile/i

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  authState.profile = { id: 'p1', role: 'player', full_name: 'Tian Urien' }
  setChat([])
})

describe('Hockia AI v2 — states', () => {
  it('first use: sparkle mark, greeting, beta note, three example rows that send', () => {
    const sendMessage = vi.fn()
    useDiscoverChat.setState({ sendMessage })
    const { container } = renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Hockia AI' })).toBeInTheDocument()
    expect(screen.getByText('Hi Tian')).toBeInTheDocument()
    expect(screen.getByText(/Hockia AI is in beta/)).toBeInTheDocument()
    expect(screen.getByText('Try asking')).toBeInTheDocument()
    const examples = screen.getAllByTestId('discover-example-query')
    expect(examples).toHaveLength(3)
    expect(examples.map(e => e.textContent)).toContain(`“${ROLE_EXAMPLE}”`)
    fireEvent.click(examples[2])
    expect(sendMessage).toHaveBeenCalledWith(ROLE_EXAMPLE)
    expect(container.innerHTML).not.toMatch(/gradient/)
  })

  it('loading: "Searching" with animated dots, no skeleton cards', () => {
    setChat([msg({ role: 'user', content: 'Goalkeeper roles' }), msg({ role: 'assistant', status: 'sending' })], true)
    const { container } = renderPage()
    expect(screen.getByRole('status', { name: 'Searching' })).toBeInTheDocument()
    expect(container.querySelectorAll('.animate-dotWave')).toHaveLength(3)
    expect(container.querySelector('[data-testid*="skeleton"]')).toBeNull()
    expect(container.innerHTML).not.toMatch(/animate-pulse|gradient/)
  })

  it('answer: role rows as "Club · Position" / "League · package", pool caption, chevron to the role page', () => {
    setChat([
      msg({ role: 'user', content: 'Goalkeeper roles in Serie A1' }),
      msg({
        role: 'assistant', kind: 'opportunity_results', content: 'I found 2 goalkeeper roles in Italy you can apply to.',
        opportunities: roles, open_roles_total: 24, opportunity_filters: ['Goalkeeper', 'Italy'],
        suggested_actions: [{ label: 'Roles with housing', intent: { type: 'free_text', query: 'Goalkeeper roles with housing' } }],
      }),
    ])
    const { container } = renderPage()

    expect(screen.getByTestId('ai-user-bubble')).toHaveTextContent('Goalkeeper roles in Serie A1')
    const rows = screen.getAllByTestId('ai-role-result')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('HC Bra · Goalkeeper')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Bra, Italy · Housing, Paid')).toBeInTheDocument()
    expect(screen.getByText('From 24 open roles · updated today')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(FORBIDDEN_PLAYER_TEXT)
    expect(container.innerHTML).not.toMatch(/gradient/)

    fireEvent.click(rows[1])
    expect(screen.getByText('Role page')).toBeInTheDocument()
  })

  it('no match: the zero-result message, the pool line and chips', () => {
    setChat([
      msg({ role: 'user', content: 'Goalkeeper roles in Serie A1' }),
      msg({
        role: 'assistant', kind: 'no_results', content: 'There are no goalkeeper roles in Italy you can apply to right now.',
        opportunities: [], opportunity_filters: ['Goalkeeper', 'Italy'], open_roles_total: 24,
        suggested_actions: [{ label: 'Show all open roles', intent: { type: 'free_text', query: 'Show me all open roles for me' } }],
        cta: { label: 'Browse all opportunities', route: '/opportunities' },
      }),
    ])
    renderPage()
    expect(screen.getByText(/no goalkeeper roles in Italy/)).toBeInTheDocument()
    expect(screen.getByText('From 24 open roles · updated today')).toBeInTheDocument()
    const chips = screen.getAllByTestId('ai-chip').map(c => c.textContent)
    expect(chips).toEqual(['Show all open roles', 'Browse all opportunities'])
    expect(screen.queryByTestId('ai-role-result')).toBeNull()
  })

  it("can't answer: neutral text with Open roles for me / Improve my profile", () => {
    setChat([
      msg({ role: 'user', content: 'Who will win the Olympics?' }),
      msg({ role: 'assistant', kind: 'text', content: "I can help with clubs, players and roles on HOCKIA, not that one." }),
    ])
    renderPage()
    expect(screen.getByText(/not that one/)).toBeInTheDocument()
    const chips = screen.getAllByTestId('ai-chip').map(c => c.textContent)
    expect(chips).toEqual(['Open roles for me', 'Improve my profile'])
    fireEvent.click(screen.getByRole('button', { name: 'Improve my profile' }))
    expect(screen.getByText('Edit profile page')).toBeInTheDocument()
  })

  it('error: neutral SoftErrorCard (no amber) with Try again / Open roles for me BELOW the card', () => {
    setChat([
      msg({ role: 'user', content: 'Goalkeeper roles' }),
      msg({ role: 'assistant', status: 'error', content: 'Search failed', error: 'Search failed' }),
    ])
    const { container } = renderPage()
    const card = screen.getByTestId('ai-notice-card')
    expect(card).toHaveAttribute('data-tone', 'neutral')
    expect(card.className).toMatch(/bg-surface-muted/)
    expect(container.innerHTML).not.toMatch(/amber|warning|gradient/)
    expect(card).toHaveTextContent(/trouble connecting/)
    const chips = screen.getAllByTestId('ai-chip')
    expect(chips.map(c => c.textContent)).toEqual(['Try again', 'Open roles for me'])
    for (const chip of chips) expect(card.contains(chip)).toBe(false)

    const sendMessage = vi.fn()
    useDiscoverChat.setState({ sendMessage })
    fireEvent.click(chips[0])
    expect(sendMessage).toHaveBeenCalledWith('Goalkeeper roles')
    fireEvent.click(chips[1])
    expect(screen.getByText('Opportunities page')).toBeInTheDocument()
  })

  it('cap reached: the limit card with only "Open roles for me"', () => {
    setChat([
      msg({ role: 'user', content: 'One more' }),
      msg({ role: 'assistant', kind: 'cap_reached', content: CAP_REACHED_COPY, suggested_actions: [] }),
    ])
    renderPage()
    const card = screen.getByTestId('ai-notice-card')
    expect(card).toHaveTextContent("You've reached today's limit — try again tomorrow.")
    expect(card).toHaveAttribute('data-tone', 'neutral')
    expect(screen.getAllByTestId('ai-chip').map(c => c.textContent)).toEqual(['Open roles for me'])
  })

  it('composer: the placeholder, no attach button, 44 pt purple send, Enter sends', () => {
    const sendMessage = vi.fn()
    useDiscoverChat.setState({ sendMessage })
    renderPage()
    const composer = screen.getByPlaceholderText(COMPOSER_PLACEHOLDER)
    expect(screen.queryByRole('button', { name: /attach|camera|photo/i })).toBeNull()
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toBeDisabled()
    expect(send.className).toMatch(/h-11 w-11/)
    expect(send.className).toMatch(/bg-hockia-primary/)
    fireEvent.change(composer, { target: { value: 'Clubs in Spain' } })
    expect(send).toBeEnabled()
    fireEvent.keyDown(composer, { key: 'Enter' })
    expect(sendMessage).toHaveBeenCalledWith('Clubs in Spain')
  })

  it('More sheet: Clear conversation empties the chat; Report a problem opens the feedback modal', async () => {
    setChat([msg({ role: 'user', content: 'Hi' }), msg({ role: 'assistant', kind: 'text', content: 'Hello' })])
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByTestId('ai-clear'))
    expect(useDiscoverChat.getState().messages).toHaveLength(0)
    expect(screen.getByTestId('ai-first-use')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    fireEvent.click(screen.getByTestId('ai-report'))
    expect(await screen.findByTestId('feedback-modal')).toBeInTheDocument()
  })

  it('a player never sees ranking lines even when the model writes one', () => {
    setChat([
      msg({ role: 'user', content: 'How do I compare?' }),
      msg({ role: 'assistant', kind: 'text', content: 'Your profile is complete. You are ranked above most goalkeepers in Italy. Add a highlight video next.' }),
    ])
    const { container } = renderPage()
    expect(container.textContent).toContain('Your profile is complete.')
    expect(container.textContent).toContain('Add a highlight video next.')
    expect(container.textContent).not.toMatch(FORBIDDEN_PLAYER_TEXT)
  })
})

describe('lib/hockiaAi', () => {
  it('chips depend on the viewer role', () => {
    expect(cantAnswerChips('player').map(c => c.label)).toEqual(['Open roles for me', 'Improve my profile'])
    expect(cantAnswerChips('club').map(c => c.label)).toEqual(['Improve my profile'])
    expect(errorChips('coach').map(c => c.label)).toEqual(['Try again', 'Open roles for me'])
    expect(errorChips('brand').map(c => c.label)).toEqual(['Try again'])
    expect(capReachedChips('player').map(c => c.label)).toEqual(['Open roles for me'])
    expect(capReachedChips('club')).toEqual([])
  })

  it('examples: players get the role example, clubs keep their own three', () => {
    expect(exampleQueriesFor({ role: 'player' })).toContain(ROLE_EXAMPLE)
    expect(exampleQueriesFor({ role: 'player' })).toHaveLength(3)
    expect(exampleQueriesFor({ role: 'club' })).toHaveLength(3)
    expect(exampleQueriesFor({ role: 'club' })).not.toContain(ROLE_EXAMPLE)
    expect(exampleQueriesFor({ role: 'coach', coach_recruits_for_team: true })[0]).toMatch(/staff/)
    expect(exampleQueriesFor(null)).toHaveLength(3)
  })

  it('fromOpenRolesCaption: singular, plural, unknown', () => {
    expect(fromOpenRolesCaption(1)).toBe('From 1 open role · updated today')
    expect(fromOpenRolesCaption(24)).toBe('From 24 open roles · updated today')
    expect(fromOpenRolesCaption(undefined)).toBeNull()
    expect(fromOpenRolesCaption(null)).toBeNull()
    expect(fromOpenRolesCaption(-1)).toBeNull()
  })

  it('stripRankingLines removes only the ranking sentences', () => {
    expect(stripRankingLines('Great profile. You rank in the top 10% of defenders. Keep going.')).toBe('Great profile. Keep going.')
    expect(stripRankingLines('Line one.\nCompared to other players you are strong.\nLine three.')).toBe('Line one.\n\nLine three.')
    expect(stripRankingLines('Nothing to strip here.')).toBe('Nothing to strip here.')
    expect(stripRankingLines(null)).toBe('')
  })

  it('role row text: club · position, league/location · package', () => {
    expect(roleResultTitle(roles[0])).toBe('HC Bra · Goalkeeper')
    expect(roleResultTitle({ organization: null, position_label: null, title: 'Open role' })).toBe('Open role')
    expect(roleResultMeta({ ...roles[0], league_label: 'Serie A1' })).toBe('Serie A1 · Housing, Paid')
    expect(roleResultMeta({ league_label: null, location_label: null, benefit_labels: [] })).toBeNull()
  })
})
