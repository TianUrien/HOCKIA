/**
 * adminApi.getAllCountries — World Phase 0 source contract.
 *
 * Every World admin country dropdown (Add/Edit Club, league/region modals,
 * filters, campaign audience) reads from getAllCountries(). The Add Club
 * path used to read `world_countries_with_directory` (countries that already
 * have seeded leagues), so an admin literally could not add a club in a
 * country with no World data yet — Ireland was missing from the dropdown.
 * Phase 0 consolidated every surface onto this one function; this locks it:
 * the query targets the full `countries` table and returns every row.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const fromSpy = vi.fn()
const orderMock = vi.fn()

vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'anon',
  supabase: {
    // adminApi binds supabase.rpc at module load — must exist even though
    // getAllCountries doesn't use it.
    rpc: vi.fn(),
    from: (table: string) => {
      fromSpy(table)
      return {
        select: () => ({ order: orderMock }),
      }
    },
  },
}))

import { getAllCountries } from '@/features/admin/api/adminApi'

const ALL_COUNTRIES = [
  { id: 372, code: 'IE', name: 'Ireland', flag_emoji: '🇮🇪' },
  { id: 826, code: 'GB-SCT', name: 'Scotland', flag_emoji: '🏴' },
  { id: 900, code: 'GB-NIR', name: 'Northern Ireland', flag_emoji: '🇬🇧' },
]

describe('getAllCountries — reads the full countries table (Phase 0)', () => {
  beforeEach(() => {
    fromSpy.mockClear()
    orderMock.mockReset()
    orderMock.mockResolvedValue({ data: ALL_COUNTRIES, error: null })
  })

  it('queries `countries`, never the leagues-gated directory view', async () => {
    await getAllCountries()
    expect(fromSpy).toHaveBeenCalledWith('countries')
    expect(fromSpy).not.toHaveBeenCalledWith('world_countries_with_directory')
  })

  it('returns every legitimate country — including ones with no World data (Ireland, Scotland, NIR)', async () => {
    const result = await getAllCountries()
    const names = result.map((c) => c.name)
    expect(names).toContain('Ireland')
    expect(names).toContain('Scotland')
    expect(names).toContain('Northern Ireland')
    expect(result).toHaveLength(ALL_COUNTRIES.length)
    // Shape is mapped through cleanly.
    expect(result.find((c) => c.code === 'GB-NIR')).toMatchObject({
      id: 900,
      code: 'GB-NIR',
      name: 'Northern Ireland',
    })
  })

  it('throws a descriptive error when the query fails', async () => {
    orderMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
    await expect(getAllCountries()).rejects.toThrow(/Failed to get all countries: boom/)
  })
})
