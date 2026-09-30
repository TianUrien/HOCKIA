/**
 * Club v2 leaf 10 — first run + Edit club profile (Figma 04 Club D1.25,
 * D1.27; DEV NOTES 368:1093 and 368:1103). Pure helpers first, then the two
 * screens with their data mocked.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clubLeagueRowValue, contactRowValue, foundedYears, isFirstRunOpportunities, isValidWebsite,
  photosRowValue, websiteLabel, yearFoundedError,
} from '@/lib/clubEdit'

const NOW = new Date('2026-09-27T12:00:00Z')

describe('Edit club helpers', () => {
  it('year founded: optional, 1850 up to this year', () => {
    expect(yearFoundedError('', NOW)).toBeNull()
    expect(yearFoundedError('1955', NOW)).toBeNull()
    expect(yearFoundedError('2026', NOW)).toBeNull()
    expect(yearFoundedError('2027', NOW)).toMatch(/between 1850 and 2026/)
    expect(yearFoundedError('1849', NOW)).not.toBeNull()
    expect(yearFoundedError('99999', NOW)).not.toBeNull()
    const years = foundedYears(NOW)
    expect(years[0]).toBe(2026)
    expect(years[years.length - 1]).toBe(1850)
  })
  it('website: scheme optional, host needs a dot; row shows the bare host', () => {
    expect(isValidWebsite('')).toBe(true)
    expect(isValidWebsite('kilkennyhc.com')).toBe(true)
    expect(isValidWebsite('https://not-a-url')).toBe(false)
    expect(isValidWebsite('hello world')).toBe(false)
    expect(websiteLabel('https://www.kilkennyhc.com/')).toBe('kilkennyhc.com')
    expect(websiteLabel('  ')).toBeNull()
  })
  it('Club & league row: linked with the lead league, or not linked', () => {
    expect(clubLeagueRowValue(true, 'Leinster Division 1A', 'Leinster Division 1A')).toBe('Linked · Leinster Division 1A')
    expect(clubLeagueRowValue(true, null, 'Serie A1')).toBe('Linked · Serie A1')
    expect(clubLeagueRowValue(true, null, null)).toBe('Linked')
    expect(clubLeagueRowValue(false, 'Anything', null)).toBeNull()
  })
  it('photos and contact rows; empty reads "Add"', () => {
    expect(photosRowValue(2)).toBe('2 photos')
    expect(photosRowValue(1)).toBe('1 photo')
    expect(photosRowValue(0)).toBeNull()
    expect(photosRowValue(null)).toBeNull()
    expect(contactRowValue('a@b.co', false)).toBe('Private · a@b.co')
    expect(contactRowValue('a@b.co', null)).toBe('Private · a@b.co')
    expect(contactRowValue('a@b.co', true)).toBe('Shown on your profile · a@b.co')
    expect(contactRowValue('', true)).toBeNull()
  })
  it('first run only once loaded and with no role at all (a draft counts as a role)', () => {
    expect(isFirstRunOpportunities(true, [], [])).toBe(false)
    expect(isFirstRunOpportunities(false, [], [])).toBe(true)
    expect(isFirstRunOpportunities(false, [{ status: 'draft' }], [])).toBe(false)
    expect(isFirstRunOpportunities(false, [], [{ status: 'closed' }])).toBe(false)
  })
})

// ── Screens ─────────────────────────────────────────────────────────

const navigateMock = vi.hoisted(() => vi.fn())
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return { ...actual, useNavigate: () => navigateMock }
})

const toast = vi.hoisted(() => ({ addToast: vi.fn() }))
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: typeof toast) => unknown) => sel(toast) }))

const db = vi.hoisted(() => ({
  update: vi.fn(),
  eq: vi.fn(),
  count: 2 as number,
  media: [] as Array<{ id: string; file_url: string; caption: string | null; order_index: number; created_at: string }>,
  deleteReturns: [{ id: 'x' }] as unknown[],
  calls: [] as string[],
}))
vi.mock('@/lib/storage', () => ({ deleteStorageObject: vi.fn(() => { db.calls.push('storage-delete'); return Promise.resolve() }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'club_media') {
        return {
          select: (_cols: string, opts?: { head?: boolean }) => (opts?.head
            ? { eq: () => Promise.resolve({ count: db.count, error: null }) }
            : { eq: () => ({ order: () => ({ order: () => Promise.resolve({ data: db.media, error: null }) }) }) }),
          delete: () => {
            db.calls.push('row-delete')
            return { eq: () => ({ select: () => Promise.resolve({ data: db.deleteReturns, error: null }) }) }
          },
        }
      }
      return {
        update: (patch: unknown) => {
          db.update(table, patch)
          return { eq: (col: string, val: string) => { db.eq(col, val); return Promise.resolve({ error: null }) } }
        },
      }
    },
    storage: { from: vi.fn() },
  },
}))
vi.mock('@/lib/profile', () => ({ invalidateProfile: vi.fn() }))
vi.mock('@/hooks/useCountries', () => ({
  useCountries: () => ({
    countries: [{ id: 104, name: 'Ireland', common_name: null, nationality_name: 'Irish', flag_emoji: '🇮🇪' }],
    getCountryById: (id: number) => (id === 104 ? { id: 104, name: 'Ireland', common_name: null, nationality_name: 'Irish', flag_emoji: '🇮🇪' } : undefined),
  }),
}))

const club = {
  id: 'club-1', role: 'club', full_name: 'Kilkenny Hockey Club', avatar_url: null, year_founded: 1955,
  nationality_country_id: 104, nationality: 'Irish', base_location: 'Kilkenny, Ireland', base_city: 'Kilkenny', base_country_id: 104,
  current_world_club_id: 'wc-1', mens_league_division: 'Leinster Division 1A', womens_league_division: 'Leinster Division 1A',
  club_bio: 'We’re a hockey club based in Ireland.', website: 'https://kilkennyhc.com', social_links: {},
  contact_email: 'hello@kilkennyhc.com', contact_email_public: false,
}
const auth = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => (sel ? sel(auth.state) : auth.state),
    { getState: () => auth.state },
  ),
}))

import ClubEditScreen from '@/components/club/ClubEditScreen'

const renderEdit = () => render(<MemoryRouter initialEntries={['/dashboard/club/edit']}><ClubEditScreen /></MemoryRouter>)
const row = (label: string) => {
  const el = screen.getAllByText(label).find((n) => n.className.includes('w-[120px]'))
  if (!el?.parentElement) throw new Error(`no row ${label}`)
  return el.parentElement
}

describe('ClubEditScreen (D1.27)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.count = 2
    auth.state = { user: { id: 'club-1' }, profile: { ...club }, refreshProfile: vi.fn().mockResolvedValue(undefined) }
  })

  it('club rows in Figma order; player-only fields are gone', async () => {
    renderEdit()
    expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to Profile' }).textContent).toContain('Profile')
    expect(screen.getByText('Club crest')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add your crest' })).toBeTruthy()
    for (const g of ['Identity', 'Location', 'Hockey', 'About', 'Contact']) expect(screen.getByRole('heading', { name: g })).toBeTruthy()
    expect(within(row('Name')).getByText('Kilkenny Hockey Club')).toBeTruthy()
    expect(within(row('Type')).getByText('Club')).toBeTruthy()
    expect(within(row('Type')).getByLabelText('Locked')).toBeTruthy()
    expect(row('Type').tagName).toBe('DIV')
    expect(within(row('Year founded')).getByText('1955')).toBeTruthy()
    expect(within(row('Country')).getByText('🇮🇪 Ireland')).toBeTruthy()
    expect(within(row('City')).getByText('Kilkenny')).toBeTruthy()
    expect(within(row('Club & league')).getByText('Linked · Leinster Division 1A')).toBeTruthy()
    expect(within(row('Website')).getByText('kilkennyhc.com')).toBeTruthy()
    expect(within(row('Contact email')).getByText('Private · hello@kilkennyhc.com')).toBeTruthy()
    await waitFor(() => expect(within(row('Photos')).getByText('2 photos')).toBeTruthy())
    for (const gone of ['Position', 'Category', 'Date of birth', 'Passports', 'Open to play', 'Available from']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
  })

  it('empty values read "Add" in brand colour; not linked reads "Link your club"', async () => {
    db.count = 0
    auth.state = { ...auth.state, profile: { ...club, year_founded: null, website: null, club_bio: null, contact_email: null, current_world_club_id: null } }
    renderEdit()
    const add = within(row('Year founded')).getByText('Add')
    expect(add.className).toContain('text-hockia-primary')
    expect(within(row('Website')).getByText('Add')).toBeTruthy()
    expect(within(row('Contact email')).getByText('Add')).toBeTruthy()
    expect(within(row('Club & league')).getByText('Link your club').className).toContain('text-hockia-primary')
    await waitFor(() => expect(within(row('Photos')).getByText('Add')).toBeTruthy())
  })

  it('Back and Done return to the club profile; Club & league and Photos open their screens', () => {
    renderEdit()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard/profile')
    fireEvent.click(screen.getByRole('button', { name: 'Back to Profile' }))
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard/profile')
    fireEvent.click(row('Club & league'))
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard/profile/league?from=edit')
    fireEvent.click(row('Photos'))
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard/profile/media?from=edit')
  })

  it('name: required, saves full_name only', async () => {
    renderEdit()
    fireEvent.click(row('Name'))
    const input = screen.getByRole('textbox', { name: 'Club name' })
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The club name is required.')
    expect(db.update).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: ' Kilkenny HC ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('profiles', { full_name: 'Kilkenny HC' }))
    expect(db.eq).toHaveBeenCalledWith('id', 'club-1')
  })

  it('year founded: a picker; Not set clears it', async () => {
    renderEdit()
    fireEvent.click(row('Year founded'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Year founded' }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('profiles', { year_founded: null }))
  })

  it('website: refuses a host without a dot', async () => {
    renderEdit()
    fireEvent.click(row('Website'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Website' }), { target: { value: 'https://not-a-url' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/doesn’t look right/)
    expect(db.update).not.toHaveBeenCalled()
  })

  it('contact email: private by default; the switch shares it with members', async () => {
    renderEdit()
    fireEvent.click(row('Contact email'))
    const sw = screen.getByRole('switch', { name: 'Show on your profile' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(sw)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('profiles', { contact_email: 'hello@kilkennyhc.com', contact_email_public: true }))
  })

  it('opened from Settings: back reads Settings and returns there; leaves keep the way back', () => {
    render(<MemoryRouter initialEntries={['/dashboard/club/edit?from=settings']}><ClubEditScreen /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }))
    expect(navigateMock).toHaveBeenCalledWith('/settings')
    fireEvent.click(row('Club & league'))
    expect(navigateMock).toHaveBeenCalledWith('/dashboard/profile/league?from=edit&via=settings')
  })

  it('every edit sheet has Cancel: closes without saving', async () => {
    renderEdit()
    for (const label of ['Name', 'About', 'Contact email', 'Website']) {
      fireEvent.click(row(label))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull())
    }
    expect(db.update).not.toHaveBeenCalled()
  })

  it('contact email switch uses the shared copy', () => {
    renderEdit()
    fireEvent.click(row('Contact email'))
    expect(screen.getByText('Off: players message you on Hockia.')).toBeTruthy()
  })

  it('about: writes club_bio (not the player bio)', async () => {
    renderEdit()
    fireEvent.click(row('About'))
    fireEvent.change(screen.getByRole('textbox', { name: 'About' }), { target: { value: 'New text' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(db.update).toHaveBeenCalledWith('profiles', { club_bio: 'New text' }))
  })
})

// ── D1.25 first run ─────────────────────────────────────────────────

const roles = vi.hoisted(() => ({ state: { loading: false, open: [] as unknown[], closed: [] as unknown[], expiryDays: 14, refresh: vi.fn() } }))
vi.mock('@/hooks/useClubRoles', () => ({ useClubRoles: () => roles.state }))
vi.mock('@/hooks/useScouting', () => ({
  useScoutingContext: () => ({ ctx: null, roleTitle: null }),
  useRoleShortlist: () => ({ loading: false, rows: [] }),
}))
vi.mock('@/hooks/useRecruitingContext', () => ({ useRecruitingViewKind: vi.fn() }))

import ClubOpportunitiesScreen from '@/components/club/ClubOpportunitiesScreen'

const renderOpps = () => render(<MemoryRouter initialEntries={['/opportunities']}><ClubOpportunitiesScreen /></MemoryRouter>)

describe('ClubOpportunitiesScreen first run (D1.25)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.state = { user: { id: 'club-1' }, profile: { ...club } }
    roles.state = { loading: false, open: [], closed: [], expiryDays: 14, refresh: vi.fn() }
  })

  it('no roles: one clear action, scouting before posting, no segmented control or counters', () => {
    renderOpps()
    expect(screen.getByTestId('club-opportunities-first-run')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Post your first role' })).toBeTruthy()
    expect(screen.getByText(/Describe the role once\. Players who fit find it in Opportunities/)).toBeTruthy()
    expect(screen.getByText('Not ready to post? Find players and shortlist them first.')).toBeTruthy()
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.queryByText('Open')).toBeNull()
    expect(screen.queryByTestId('club-waiting-notice')).toBeNull()
    expect(screen.queryByTestId('club-shortlist-count')).toBeNull()
  })

  it('Post a role and the + open step 1; Find players now opens with No context', () => {
    renderOpps()
    // The card's button and the + in the nav do the same.
    const posts = screen.getAllByRole('button', { name: 'Post a role' })
    expect(posts).toHaveLength(2)
    for (const b of posts) {
      navigateMock.mockClear()
      fireEvent.click(b)
      expect(navigateMock).toHaveBeenCalledWith('/dashboard/opportunities/new')
    }
    fireEvent.click(screen.getByRole('button', { name: /Find players now/ }))
    expect(navigateMock).toHaveBeenLastCalledWith('/dashboard/find-players?context=none')
  })

  it('while loading, and once any role exists, the normal screen shows', () => {
    roles.state = { ...roles.state, loading: true }
    const { unmount } = renderOpps()
    expect(screen.queryByTestId('club-opportunities-first-run')).toBeNull()
    unmount()
    roles.state = { ...roles.state, loading: false, closed: [{ id: 'r1', status: 'closed', closed_reason: 'filled', pipeline: { toReview: 0, shortlisted: 0, declined: 0, closed: 0, total: 0 }, pendingAppliedAt: [] }] }
    renderOpps()
    expect(screen.queryByTestId('club-opportunities-first-run')).toBeNull()
    expect(screen.getByTestId('club-scouting-group')).toBeTruthy()
  })
})

// ── Route entry ─────────────────────────────────────────────────────

const media = vi.hoisted(() => ({ phone: true }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => media.phone }))

import { Route, Routes } from 'react-router-dom'
import { ClubEditEntry } from '@/pages/ClubRecruitingRoutes'

const renderEntry = () => render(
  <MemoryRouter initialEntries={['/dashboard/club/edit']}>
    <Routes>
      <Route path="/dashboard/club/edit" element={<ClubEditEntry />} />
      <Route path="/dashboard/profile" element={<p>v1 profile</p>} />
    </Routes>
  </MemoryRouter>,
)

describe('ClubEditEntry (/dashboard/club/edit)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    media.phone = true
    auth.state = { user: { id: 'club-1' }, profile: { ...club }, refreshProfile: vi.fn() }
  })
  it('phone club → Edit club profile', async () => {
    renderEntry()
    expect(await screen.findByTestId('club-edit-screen')).toBeTruthy()
  })
  it('desktop club, or another role → the v1 editor on the profile', async () => {
    media.phone = false
    const { unmount } = renderEntry()
    expect(await screen.findByText('v1 profile')).toBeTruthy()
    unmount()
    media.phone = true
    auth.state = { ...auth.state, profile: { ...club, role: 'player' } }
    renderEntry()
    expect(await screen.findByText('v1 profile')).toBeTruthy()
  })
})

// ── Club Manage media (Photos row) ──────────────────────────────────

vi.mock('@/hooks/useClubProfileScrollData', () => ({ clearClubProfileScrollCache: vi.fn() }))
vi.mock('@/components/home/MediaLightbox', () => ({ MediaLightbox: () => null }))

describe('useClubMedia', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.calls = []
    db.deleteReturns = [{ id: 'p1' }]
    db.media = [
      { id: 'p1', file_url: 'https://x/club-media/c/1.jpg', caption: null, order_index: 1, created_at: '2026-09-01' },
      { id: 'p2', file_url: 'https://x/club-media/c/2.jpg', caption: null, order_index: 0, created_at: '2026-09-02' },
    ]
  })
  const load = async () => {
    const { useClubMedia } = await vi.importActual<typeof import('@/hooks/useClubMedia')>('@/hooks/useClubMedia')
    const hook = renderHook(() => useClubMedia('club-1'))
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    return hook
  }
  it('loads club_media newest-first', async () => {
    const { result } = await load()
    expect(result.current.photos.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(result.current.photos[0].url).toBe('https://x/club-media/c/1.jpg')
  })
  it('delete: the row first, the storage object only after it succeeded', async () => {
    const { result } = await load()
    let ok = false
    await act(async () => { ok = await result.current.remove(result.current.photos[0]) })
    expect(ok).toBe(true)
    expect(db.calls).toEqual(['row-delete', 'storage-delete'])
    expect(result.current.photos.map((p) => p.id)).toEqual(['p2'])
  })
  it('a refused delete (no row back) keeps the file and the photo', async () => {
    db.deleteReturns = []
    const { result } = await load()
    let ok = true
    await act(async () => { ok = await result.current.remove(result.current.photos[0]) })
    expect(ok).toBe(false)
    expect(db.calls).toEqual(['row-delete'])
    expect(result.current.photos).toHaveLength(2)
  })
})

const clubMedia = vi.hoisted(() => ({
  state: { photos: [] as Array<{ id: string; url: string; caption: string | null; orderIndex: number }>, loading: false, busy: false },
  add: vi.fn(), remove: vi.fn(), reorder: vi.fn(),
}))

describe('ClubManageMediaScreen', () => {
  let Screen: typeof import('@/components/club/ClubManageMediaScreen').default
  // The real screen against a stubbed hook (the hook is tested above).
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.doMock('@/hooks/useClubMedia', () => ({
      useClubMedia: () => ({ ...clubMedia.state, add: clubMedia.add, remove: clubMedia.remove, reorder: clubMedia.reorder, reload: vi.fn() }),
    }))
    Screen = (await import('@/components/club/ClubManageMediaScreen')).default
    clubMedia.state = { photos: [], loading: false, busy: false }
  })
  const photo = (id: string, i: number) => ({ id, url: `https://x/club-media/c/${id}.jpg`, caption: null, orderIndex: i })

  it('empty: one clear add action, no Reorder; back names its parent', () => {
    const onBack = vi.fn()
    render(<MemoryRouter><Screen clubId="club-1" parent="Edit profile" onBack={onBack} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Media' })).toBeTruthy()
    expect(screen.getByText('Photos · 0')).toBeTruthy()
    expect(screen.getByTestId('club-media-empty').textContent).toContain('Add photos of your club')
    expect(screen.queryByRole('button', { name: 'Reorder' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Edit profile' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('adds the picked files', async () => {
    clubMedia.add.mockResolvedValue({ added: 2, failed: [] })
    render(<MemoryRouter><Screen clubId="club-1" parent="Profile" onBack={vi.fn()} /></MemoryRouter>)
    const files = [new File(['a'], 'a.jpg', { type: 'image/jpeg' }), new File(['b'], 'b.jpg', { type: 'image/jpeg' })]
    fireEvent.change(screen.getByTestId('club-media-input'), { target: { files } })
    await waitFor(() => expect(clubMedia.add).toHaveBeenCalledWith(files))
    expect(toast.addToast).toHaveBeenCalledWith('2 photos added.', 'success')
  })

  it('reorder stages moves and deletes; Cancel throws them away, Done saves after confirming deletes', async () => {
    clubMedia.state.photos = [photo('a', 2), photo('b', 1), photo('c', 0)]
    clubMedia.remove.mockResolvedValue(true)
    clubMedia.reorder.mockResolvedValue(true)
    render(<MemoryRouter><Screen clubId="club-1" parent="Profile" onBack={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('Photos · 3')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Reorder' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete photo' })[2])
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(clubMedia.remove).not.toHaveBeenCalled()
    expect(screen.getAllByRole('button', { name: /Photo \d/ })).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Reorder' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Move later' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete photo' })[2])
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(clubMedia.remove).toHaveBeenCalledWith(photo('c', 0)))
    await waitFor(() => expect(clubMedia.reorder).toHaveBeenCalledWith([photo('b', 1), photo('a', 2)]))
  })
})
