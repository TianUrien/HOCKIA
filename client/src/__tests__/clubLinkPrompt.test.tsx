/**
 * ClubLinkPrompt — World Phase 0 recovery path.
 *
 * The prompt shows on the player/coach dashboard when the user has a
 * free-text `current_club` but no linked `current_world_club_id`. Before
 * Phase 0 it rendered NOTHING when `search_world_clubs` found no match — the
 * exact dead-end for clubs in countries World hasn't mapped yet (e.g.
 * Scotland). Phase 0 gives that no-match case an "add it to the directory"
 * action so those users can still contribute their club.
 *
 * These lock:
 *  - no match + onAddClub  → renders the primary "Add … to directory" CTA.
 *  - a match + onAddClub    → still offers a secondary "Not one of these? Add it".
 *  - no match + NO onAddClub → renders nothing (no orphan CTA).
 *  - already linked / wrong role → never shows.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import ClubLinkPrompt from '@/components/ClubLinkPrompt'

// Flush the component's async search effect (rpc await + setState) inside act
// so negative "renders nothing" assertions are made after settle, no warning.
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })

// Keep Avatar/Flag as trivial stubs so the test is about behaviour, not their
// internals (StorageImage, flag CDN, etc.).
vi.mock('@/components/Avatar', () => ({ default: () => <div data-testid="avatar" /> }))
vi.mock('@/components/Flag', () => ({ default: () => <span data-testid="flag" /> }))

type Profile = {
  id: string
  role: string
  current_club: string | null
  current_world_club_id: string | null
}

const authState: { profile: Profile | null; setProfile: (p: Profile) => void } = {
  profile: null,
  setProfile: vi.fn(),
}

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

// search_world_clubs result is swapped per-test via `searchResult`.
let searchResult: unknown[] = []

vi.mock('@/lib/supabase', () => {
  const makeProfilesBuilder = () => {
    const builder: Record<string, unknown> = {
      update: vi.fn(() => builder),
      eq: vi.fn(() => Promise.resolve({ error: null })),
    }
    return builder
  }
  return {
    supabase: {
      rpc: vi.fn(async () => ({ data: searchResult, error: null })),
      from: vi.fn(() => makeProfilesBuilder()),
    },
  }
})

const MATCH = {
  id: 'wc-1',
  club_name: 'Grange Edinburgh HC',
  avatar_url: null,
  country_name: 'Scotland',
  country_code: 'GB-SCT',
  flag_emoji: '🏴',
  men_league_name: null,
  women_league_name: null,
}

function setProfile(overrides: Partial<Profile> = {}) {
  authState.profile = {
    id: 'user-1',
    role: 'player',
    current_club: 'Grange Edinburgh',
    current_world_club_id: null,
    ...overrides,
  }
}

describe('ClubLinkPrompt — Phase 0 add-club recovery', () => {
  beforeEach(() => {
    window.localStorage.clear()
    searchResult = []
    authState.profile = null
  })

  it('offers "Add … to the directory" as the primary action when no club matches', async () => {
    setProfile()
    searchResult = []
    const onAddClub = vi.fn()

    render(<ClubLinkPrompt onAddClub={onAddClub} />)

    const cta = await screen.findByRole('button', { name: /add your club to the directory/i })
    fireEvent.click(cta)
    expect(onAddClub).toHaveBeenCalledTimes(1)
  })

  it('renders nothing on a no-match when there is no way to add', async () => {
    setProfile()
    searchResult = []

    const { container } = render(<ClubLinkPrompt />)
    // Give the async search a chance to resolve; the component must stay empty.
    await flush()
    expect(container.textContent).toBe('')
  })

  it('shows matches plus a secondary "add it" escape hatch', async () => {
    setProfile()
    searchResult = [MATCH]
    const onAddClub = vi.fn()

    render(<ClubLinkPrompt onAddClub={onAddClub} />)

    // The matched club is offered for one-tap linking…
    expect(await screen.findByText(/Grange Edinburgh HC/)).toBeTruthy()
    // …and a secondary "Not one of these? Add it" routes to the add flow.
    const escape = screen.getByRole('button', { name: /not one of these\? add it/i })
    fireEvent.click(escape)
    expect(onAddClub).toHaveBeenCalledTimes(1)
  })

  it('never shows once the club is already linked', async () => {
    setProfile({ current_world_club_id: 'wc-existing' })
    searchResult = [MATCH]

    const { container } = render(<ClubLinkPrompt onAddClub={vi.fn()} />)
    await flush()
    expect(container.textContent).toBe('')
  })

  it('never shows for a role that has no club field (e.g. brand)', async () => {
    setProfile({ role: 'brand' })
    searchResult = []

    const { container } = render(<ClubLinkPrompt onAddClub={vi.fn()} />)
    await flush()
    expect(container.textContent).toBe('')
  })

  it('dismissal is user-scoped: user A dismissing does NOT hide the prompt for user B', async () => {
    // Same class of bug the repo fixed in WelcomeValueCard — an unscoped
    // localStorage key let one account's dismissal hide the card for every
    // account on a shared browser.
    setProfile({ id: 'user-a' })
    searchResult = []
    const { unmount } = render(<ClubLinkPrompt onAddClub={vi.fn()} />)
    await screen.findByRole('button', { name: /add your club to the directory/i })
    fireEvent.click(screen.getByLabelText(/dismiss/i))
    unmount()

    // The key must be scoped to user A…
    expect(window.localStorage.getItem('club-link-prompt-dismissed:user-a')).toBe('true')

    // …so user B on the same browser still gets the prompt.
    setProfile({ id: 'user-b' })
    render(<ClubLinkPrompt onAddClub={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /add your club to the directory/i })).toBeTruthy()
  })
})
