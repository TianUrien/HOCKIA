/**
 * World Phase 0 — "Add club to directory" flow contract.
 *
 * Two invariants this locks:
 *
 * 1. COUNTRY SOURCE: the add form's country dropdown is populated from the
 *    full `countries` table, NOT `world_countries_with_directory`. The old
 *    view only listed countries that already had seeded leagues, which
 *    dead-ended legitimate countries with no World data yet (a Scottish
 *    player could not add her club because Scotland wasn't in the list).
 *
 * 2. SECURITY: the client creates a club via `create_world_club_from_career`
 *    passing ONLY the club name, country id, and (optional) province id. It
 *    must NEVER submit `claimed_profile_id`, `is_claimed`, verification, or a
 *    `created_from` value — the SECURITY DEFINER RPC decides those
 *    server-side (unclaimed, unverified, created_from='user'). A regression
 *    that let the client forge any of those would silently expand the
 *    existing claim/verification hole.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import WorldClubSearch from '@/components/WorldClubSearch'

// Country rows the FULL `countries` table would return — including Scotland,
// which has no seeded leagues and so would be ABSENT from the old directory
// view. Its presence here is the whole point of the fix.
const COUNTRY_ROWS = [
  { id: 372, name: 'Ireland', code: 'IE', flag_emoji: '🇮🇪' },
  { id: 826, name: 'Scotland', code: 'GB-SCT', flag_emoji: '🏴' },
]

const fromSpy = vi.fn()

vi.mock('@/lib/supabase', () => {
  const makeBuilder = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      eq: vi.fn(() => builder),
      order: vi.fn(() => builder),
      then: (resolve: (v: { data: unknown; error: null }) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(resolve),
    }
    return builder
  }

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name === 'search_world_clubs') return { data: [], error: null }
    if (name === 'create_world_club_from_career') {
      return {
        data: {
          success: true,
          club_id: 'new-club-uuid',
          club_name: args.p_club_name,
          avatar_url: null,
          already_exists: false,
        },
        error: null,
      }
    }
    return { data: null, error: null }
  })

  return {
    supabase: {
      from: vi.fn((table: string) => {
        fromSpy(table)
        if (table === 'countries') return makeBuilder(COUNTRY_ROWS)
        // world_provinces (or anything else) → no rows; region select stays hidden.
        return makeBuilder([])
      }),
      rpc,
    },
  }
})

import { supabase } from '@/lib/supabase'

function renderSearch(overrides: Partial<React.ComponentProps<typeof WorldClubSearch>> = {}) {
  const onClubSelect = vi.fn()
  render(
    <WorldClubSearch
      value="Grange"
      onChange={vi.fn()}
      onClubSelect={onClubSelect}
      onClubClear={vi.fn()}
      selectedClubId={null}
      {...overrides}
    />,
  )
  return { onClubSelect }
}

describe('WorldClubSearch — add-to-directory flow (World Phase 0)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists a country with no World data (Scotland) from the full countries table', async () => {
    renderSearch()

    // Focus opens the dropdown (search returns no matches) and reveals the
    // "Add … to directory" affordance.
    fireEvent.focus(screen.getByRole('searchbox'))
    const addBtn = await screen.findByText(/Add .*Grange.* to directory/i)
    fireEvent.click(addBtn)

    // The country list must be sourced from `countries`, never the
    // leagues-gated directory view.
    await waitFor(() =>
      expect(fromSpy).toHaveBeenCalledWith('countries'),
    )
    expect(fromSpy).not.toHaveBeenCalledWith('world_countries_with_directory')

    // Scotland — which has zero seeded leagues — is selectable.
    expect(await screen.findByRole('option', { name: /Scotland/ })).toBeTruthy()
  })

  it('creates a club passing ONLY name/country/province — no claim/verification/created_from', async () => {
    const { onClubSelect } = renderSearch()

    fireEvent.focus(screen.getByRole('searchbox'))
    fireEvent.click(await screen.findByText(/Add .*Grange.* to directory/i))
    await screen.findByRole('option', { name: /Scotland/ })

    // Pick Scotland (no leagues, no regions) and create.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '826' } })
    fireEvent.click(await screen.findByRole('button', { name: /Add Club/ }))

    await waitFor(() =>
      expect(supabase.rpc).toHaveBeenCalledWith(
        'create_world_club_from_career',
        expect.objectContaining({ p_club_name: 'Grange', p_country_id: 826 }),
      ),
    )

    // Assert the argument object contains ONLY the three whitelisted params.
    const createCall = (supabase.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === 'create_world_club_from_career',
    )
    expect(createCall).toBeTruthy()
    const args = createCall![1] as Record<string, unknown>
    expect(Object.keys(args).sort()).toEqual(['p_club_name', 'p_country_id', 'p_province_id'])
    // The forbidden fields must never be forwarded from the client.
    for (const forbidden of ['claimed_profile_id', 'is_claimed', 'created_from', 'p_profile_id', 'verified', 'is_verified']) {
      expect(args).not.toHaveProperty(forbidden)
    }

    // Province was never chosen → passed as undefined, letting the RPC create
    // a region-less club (regions are optional in Phase 0).
    expect(args.p_province_id).toBeUndefined()

    // The club handed back to the parent is unclaimed.
    await waitFor(() => expect(onClubSelect).toHaveBeenCalled())
    expect(onClubSelect.mock.calls[0][0]).toMatchObject({ is_claimed: false })
  })
})
