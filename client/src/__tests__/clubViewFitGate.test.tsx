/**
 * Club view of a player's profile — the Fit card follows the "viewer recruits"
 * rule (founder rule: a coach who recruits "can post roles… and sees the Fit
 * card like a club"). Candidate coaches and players never get it, and a
 * recruiting coach's level is compared from the club they coach at.
 */
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
const tables = vi.hoisted(() => ({ data: {} as Record<string, unknown> }))
const viewerRef = vi.hoisted(() => ({ profile: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'order', 'limit']) b[m] = () => b
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(tables.data[table]) ? (tables.data[table] as unknown[])[0] ?? null : tables.data[table] ?? null, error: null })
    b.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables.data[table] ?? [], error: null })
    return b
  }
  return { supabase: { from: (t: string) => builder(t), rpc } }
})
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel: (s: { profile: unknown }) => unknown) => sel({ profile: viewerRef.profile }) }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() }) }))
vi.mock('@/lib/undoToast', () => ({ useUndoToast: (sel: (s: { show: () => void }) => unknown) => sel({ show: vi.fn() }) }))
vi.mock('@/hooks/useShortlists', () => ({ useShortlists: () => ({ lists: [], create: vi.fn() }) }))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingContext: () => ({ active: null }) }))
vi.mock('@/hooks/useSavedProfiles', () => ({ markSavedProfileId: vi.fn(), useIsProfileSaved: () => ({ isSaved: false, mutating: false, toggle: vi.fn() }) }))

import { useClubViewOfPlayer, viewerLeagueIds } from '@/hooks/useClubViewOfPlayer'

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
)

const player = { id: 'p1', role: 'player', full_name: 'Sam Player', current_world_club_id: null }

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: [{ state: 'yellow', components: { gender_match: 1, competition_proximity: 0, availability: 0.6, recency: 1 } }], error: null })
  tables.data = {
    opportunities: [{ id: 'r1', title: 'Midfielder', gender: 'Men' }],
    opportunity_applications: [],
    application_response_settings: null,
    world_clubs: { men_league_id: 7, women_league_id: null },
    world_leagues: [{ level_band_global: 4 }],
  }
})

describe('useClubViewOfPlayer — Fit card gate', () => {
  it('a coach who recruits gets the Fit card, like a club', async () => {
    viewerRef.profile = { id: 'c1', role: 'coach', coach_recruits_for_team: true, mens_league_id: null, womens_league_id: null, current_world_club_id: 'wc1' }
    const { result } = renderHook(() => useClubViewOfPlayer(player), { wrapper })
    await waitFor(() => expect(result.current.fit?.state).toBe('yellow'))
    expect(rpc).toHaveBeenCalledWith('compute_club_fit', expect.objectContaining({ p_owner_id: 'c1', p_player_id: 'p1', p_target: 'Men', p_opportunity_id: 'r1' }))
    // Level is compared from the club the coach coaches at.
    expect(result.current.fit?.clubLeagueBanded).toBe(true)
  })

  it('a club still gets it', async () => {
    viewerRef.profile = { id: 'k1', role: 'club', mens_league_id: 7, womens_league_id: null, current_world_club_id: 'wc1' }
    const { result } = renderHook(() => useClubViewOfPlayer(player), { wrapper })
    await waitFor(() => expect(result.current.fit?.state).toBe('yellow'))
  })

  it('a coach who only looks for a role never gets it', async () => {
    viewerRef.profile = { id: 'c2', role: 'coach', coach_recruits_for_team: false }
    const { result } = renderHook(() => useClubViewOfPlayer(player), { wrapper })
    expect(result.current.enabled).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(rpc).not.toHaveBeenCalled()
    expect(result.current.fit).toBeNull()
  })

  it('a player never gets it', async () => {
    viewerRef.profile = { id: 'p2', role: 'player' }
    const { result } = renderHook(() => useClubViewOfPlayer(player), { wrapper })
    await new Promise((r) => setTimeout(r, 20))
    expect(rpc).not.toHaveBeenCalled()
    expect(result.current.fit).toBeNull()
  })
})

describe('viewerLeagueIds', () => {
  it('uses the viewer club’s leagues, then the profile’s own, without duplicates', () => {
    expect(viewerLeagueIds({ mens_league_id: null, womens_league_id: null }, { men_league_id: 3, women_league_id: 5 })).toEqual([3, 5])
    expect(viewerLeagueIds({ mens_league_id: 3, womens_league_id: 9 }, { men_league_id: 3, women_league_id: null })).toEqual([3, 9])
  })
  it('a coach with no club and no league → nothing to compare from', () => {
    expect(viewerLeagueIds({ mens_league_id: null, womens_league_id: null }, null)).toEqual([])
  })
})
