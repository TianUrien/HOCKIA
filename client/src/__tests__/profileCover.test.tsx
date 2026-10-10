/**
 * Profile cover empty state + edit affordance (founder ruling 10 Oct 2026).
 * Owner, no cover: icon, "Add a cover photo", the role line, a secondary
 * "Add cover photo" pill — the pill and the banner both open the picker.
 * Owner, has cover: a "Change cover" pill. Visitor: never an edit prompt —
 * the decorative default cover (aria-hidden) or the image only.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toasts: Array<[string, string]> = []
const addToast = vi.fn((m: string, t: string) => { toasts.push([m, t]) })
vi.mock('@/lib/toast', () => ({ useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), rpc: vi.fn(), auth: { getSession: vi.fn() } } }))

// Club screen dependencies.
let clubPhotos: Array<{ id: string; url: string; caption: string | null }> = []
const refresh = vi.fn()
vi.mock('@/hooks/useClubProfileScrollData', () => ({
  useClubProfileScrollData: () => ({
    loading: false, photos: clubPhotos, members: [], memberCount: 0, openRoles: [], posts: [], postCount: 0,
    worldClub: null, viewsThisWeek: null, refresh,
  }),
}))
const clubAdd = vi.fn(async () => ({ added: 1, failed: [] as string[] }))
vi.mock('@/hooks/useClubMedia', () => ({ useClubMedia: () => ({ photos: [], loading: false, busy: false, add: clubAdd, remove: vi.fn(), reorder: vi.fn(), reload: vi.fn() }) }))
// Player hero dependencies.
let galleryPhotos: Array<{ id: string; url: string }> = []
const galleryAdd = vi.fn(async () => ({ added: 1, failed: [] as string[] }))
vi.mock('@/hooks/useGalleryPhotos', () => ({ useGalleryPhotos: () => ({ photos: galleryPhotos, loading: false, busy: false, add: galleryAdd, remove: vi.fn(), reorder: vi.fn(), reload: vi.fn() }) }))
let visitorCover: string | null = null
vi.mock('@/hooks/useCoverPhoto', () => ({ useCoverPhoto: () => visitorCover }))
vi.mock('@/hooks/useFriendship', () => ({
  useFriendship: () => ({ isFriend: false, isOutgoingRequest: false, isIncomingRequest: false, mutating: false, sendRequest: vi.fn(), acceptRequest: vi.fn() }),
}))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [] }) }))
vi.mock('@/lib/auth', () => ({ useAuthStore: (sel?: (s: unknown) => unknown) => { const s = { user: { id: 'u1' }, profile: { id: 'u1', role: 'player' } }; return sel ? sel(s) : s } }))
vi.mock('@/components/ProfileViewersSection', () => ({ ProfileViewersSection: () => null }))
vi.mock('@/components/home/PostComposerModal', () => ({ PostComposerModal: () => null }))
vi.mock('@/components/SignInPromptModal', () => ({ default: () => null }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
vi.mock('@/components/SettingsSheet', () => ({ default: () => null }))
vi.mock('@/components', () => ({
  Avatar: () => <div />,
  DualNationalityDisplay: () => null,
  LastActivePill: () => null,
  VerifiedBadge: () => null,
}))

import ProfileCover from '@/components/profile/ProfileCover'
import ClubProfileScreen from '@/components/profile/mobile/ClubProfileScreen'
import HeroIdentityCard from '@/components/dashboard/bento/HeroIdentityCard'
import type { ClubProfileShape } from '@/pages/ClubDashboard'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

const CLUB_LINE = 'Showcase your club, team, or home ground.'
const MEMBER_LINE = 'Show yourself on the pitch or with your team.'

function renderClub(readOnly: boolean) {
  const profile = { id: 'club-1', role: 'club', full_name: 'Test HC', avatar_url: null, base_location: 'Dublin', nationality_country_id: null } as unknown as ClubProfileShape
  const noop = vi.fn()
  return render(
    <MemoryRouter>
      <ClubProfileScreen
        profile={profile} readOnly={readOnly} isOwnProfile={!readOnly}
        onEdit={noop} onViewPublic={noop} onMessage={noop} onOpenFriends={noop} onOpenSquad={noop}
        onOpenRoles={noop} onPostRole={noop} onOpenClubLeague={noop} onOpenPosts={noop}
      />
    </MemoryRouter>,
  )
}

function renderPlayer(readOnly: boolean, role = 'player') {
  const profile = { id: 'p1', role, full_name: 'Val Turienzo', position: 'midfielder', avatar_url: null } as unknown as PlayerProfileShape
  return render(<MemoryRouter><HeroIdentityCard profile={profile} readOnly={readOnly} isOwnProfile={!readOnly} d2 onEdit={() => {}} onMessage={() => {}} /></MemoryRouter>)
}

let clickSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  clubPhotos = []
  galleryPhotos = []
  visitorCover = null
  toasts.length = 0
  vi.clearAllMocks()
  clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { clickSpy.mockRestore() })

describe('Owner, no cover', () => {
  it('club: icon, headline, club line and the secondary Add cover photo pill', () => {
    renderClub(false)
    const cover = screen.getByTestId('profile-cover')
    expect(cover.getAttribute('data-cover-state')).toBe('owner-empty')
    expect(within(cover).getByTestId('profile-cover-icon').querySelector('svg')?.getAttribute('class')).toContain('lucide-image-plus')
    expect(within(cover).getByText('Add a cover photo')).toBeTruthy()
    expect(within(cover).getByText(CLUB_LINE)).toBeTruthy()
    expect(within(cover).queryByText(MEMBER_LINE)).toBeNull()
    const add = within(cover).getByTestId('profile-cover-add')
    expect(add).toHaveTextContent('Add cover photo')
    // Secondary pill, not the solid primary.
    expect(add.className).toContain('ring-line')
    expect(add.className).not.toContain('bg-hockia-primary')
  })

  it('player and coach: the member line', () => {
    renderPlayer(false)
    expect(screen.getByText(MEMBER_LINE)).toBeTruthy()
    expect(screen.queryByText(CLUB_LINE)).toBeNull()
    expect(screen.getByTestId('profile-cover-add')).toBeTruthy()
  })

  it('coach gets the member line too', () => {
    renderPlayer(false, 'coach')
    expect(screen.getByText(MEMBER_LINE)).toBeTruthy()
  })

  it('both the banner and the button open the picker', () => {
    renderClub(false)
    const tap = screen.getByRole('button', { name: 'Add a cover photo' })
    expect(tap).toBe(screen.getByTestId('profile-cover-tap'))
    fireEvent.click(tap)
    expect(clickSpy).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('profile-cover-add'))
    expect(clickSpy).toHaveBeenCalledTimes(2)
  })

  it('a picked file goes through the existing club-media pipeline and refreshes the cover', async () => {
    renderClub(false)
    const file = new File(['x'], 'pitch.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(screen.getByTestId('profile-cover-input'), { target: { files: [file] } }) })
    expect(clubAdd).toHaveBeenCalledWith([file])
    await waitFor(() => expect(refresh).toHaveBeenCalled())
    expect(toasts).toContainEqual(['Cover updated.', 'success'])
  })

  it('a failed upload toasts and the empty state returns', async () => {
    galleryAdd.mockResolvedValueOnce({ added: 0, failed: ['pitch.jpg'] })
    renderPlayer(false)
    const file = new File(['x'], 'pitch.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(screen.getByTestId('profile-cover-input'), { target: { files: [file] } }) })
    expect(galleryAdd).toHaveBeenCalledWith([file])
    await waitFor(() => expect(toasts).toContainEqual(['Could not upload the cover. Please try again.', 'error']))
    expect(screen.queryByTestId('profile-cover-uploading')).toBeNull()
    expect(screen.getByText('Add a cover photo')).toBeTruthy()
  })

  it('shows the uploading state on the banner while the upload runs', async () => {
    let resolve: (v: { added: number; failed: string[] }) => void = () => {}
    const onUpload = vi.fn(() => new Promise<boolean>((r) => { resolve = (v) => r(v.added > 0) }))
    render(<ProfileCover owner role="player" hasCover={false} heightClassName="h-[236px]" avatarOverlap={52} onUpload={onUpload} />)
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })
    await act(async () => { fireEvent.change(screen.getByTestId('profile-cover-input'), { target: { files: [file] } }) })
    expect(screen.getByTestId('profile-cover-uploading')).toHaveTextContent('Uploading cover')
    await act(async () => { resolve({ added: 1, failed: [] }) })
    expect(screen.queryByTestId('profile-cover-uploading')).toBeNull()
  })
})

describe('Owner, has cover', () => {
  it('club: shows the image and a Change cover pill (no empty state)', () => {
    clubPhotos = [{ id: 'm1', url: 'https://cdn.example/pitch.jpg', caption: null }]
    renderClub(false)
    const change = screen.getByRole('button', { name: 'Change cover' })
    expect(change).toHaveTextContent('Change cover')
    expect(screen.queryByText('Add a cover photo')).toBeNull()
    fireEvent.click(change)
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  it('player: the top gallery photo is the cover, with Change cover', () => {
    galleryPhotos = [{ id: 'g1', url: 'https://cdn.example/me.jpg' }]
    renderPlayer(false)
    expect(screen.getByTestId('profile-cover').getAttribute('data-cover-state')).toBe('image')
    expect(screen.getByTestId('profile-cover-change')).toBeTruthy()
    expect(screen.queryByTestId('profile-cover-add')).toBeNull()
  })
})

describe('Visitor', () => {
  it('no cover: the decorative default cover, aria-hidden, no edit prompts', () => {
    renderClub(true)
    const def = screen.getByTestId('profile-cover-default')
    expect(def.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByText('Add a cover photo')).toBeNull()
    expect(screen.queryByText('Add cover photo')).toBeNull()
    expect(screen.queryByText('Change cover')).toBeNull()
    expect(screen.queryByTestId('profile-cover-input')).toBeNull()
    expect(screen.queryByTestId('profile-cover-tap')).toBeNull()
  })

  it('player visitor with no cover sees the default cover too', () => {
    renderPlayer(true)
    expect(screen.getByTestId('profile-cover-default')).toBeTruthy()
    expect(screen.queryByText(MEMBER_LINE)).toBeNull()
    expect(screen.queryByRole('button', { name: /cover/i })).toBeNull()
  })

  it('with a cover: only the image', () => {
    visitorCover = 'https://cdn.example/me.jpg'
    renderPlayer(true)
    const cover = screen.getByTestId('profile-cover')
    expect(cover.getAttribute('data-cover-state')).toBe('image')
    expect(cover.querySelector('img')).toBeTruthy()
    expect(screen.queryByTestId('profile-cover-default')).toBeNull()
    expect(screen.queryByRole('button', { name: /cover/i })).toBeNull()
    expect(screen.queryByTestId('profile-cover-input')).toBeNull()
  })

  it('club visitor with photos: image only', () => {
    clubPhotos = [{ id: 'm1', url: 'https://cdn.example/pitch.jpg', caption: null }]
    renderClub(true)
    expect(screen.getByTestId('profile-cover').getAttribute('data-cover-state')).toBe('image')
    expect(screen.queryByRole('button', { name: /cover/i })).toBeNull()
  })
})
