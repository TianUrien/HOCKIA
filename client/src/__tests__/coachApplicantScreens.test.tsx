/**
 * Club v2 applicant screens for a coach who recruits (follow-up to D6).
 *
 *  - Route guard: on phones the v2 Applicants / Applicant review / Hockia
 *    suggests screens open for clubs AND coaches who recruit; players and
 *    coaches who only look for a role keep today's pages and redirects;
 *    desktop is unchanged for everyone.
 *  - A coach owner goes back to Opportunities · My roles, and "Edit role"
 *    opens the coach's own role form there (never the club's phone editor).
 *  - The offer and mark-as-signed sheets name the organisation the role is
 *    for (world club → organisation on the role → club on the coach's
 *    profile), never the coach as a club.
 *  - A coach with no club anywhere cannot mark a signing (the career entry
 *    would be named after the coach).
 *
 * The clock is pinned; no test reads the real date. Supabase is mocked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

// ── fixtures the mocks read ─────────────────────────────────────────────────
type Profile = Record<string, unknown>
const CLUB: Profile = { id: 'club1', role: 'club', full_name: 'E2E Test FC', avatar_url: null }
const COACH: Profile = { id: 'coach1', role: 'coach', coach_recruits_for_team: true, full_name: 'Jo Coach', avatar_url: 'https://x.test/jo.jpg', current_club: 'Typed Club', current_world_club_id: null }
const CANDIDATE_COACH: Profile = { id: 'coach2', role: 'coach', coach_recruits_for_team: false, full_name: 'Sam Coach' }
const PLAYER: Profile = { id: 'player1', role: 'player', full_name: 'Pat Player' }

const fx = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, profile: null as Record<string, unknown> | null },
  phone: true,
  tables: {} as Record<string, unknown[]>,
  road: null as Record<string, unknown> | null,
  roleOwner: 'coach1',
}))
const navigateSpy = vi.hoisted(() => vi.fn())

vi.mock('react-router-dom', async (orig) => {
  const actual = await orig<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateSpy }
})
vi.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    const rows = () => fx.tables[table] ?? []
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'or', 'order', 'limit', 'update']) chain[m] = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve({ data: rows(), count: 0, error: null }).then(res, rej)
    return chain
  }
  return {
    SUPABASE_URL: 'https://example.test',
    SUPABASE_ANON_KEY: 'anon',
    supabase: {
      from: (t: string) => builder(t),
      rpc: vi.fn(() => Promise.resolve({ data: [], error: null })),
      functions: { invoke: vi.fn(() => Promise.resolve({ data: null, error: null })) },
    },
  }
})
vi.mock('@/lib/auth', () => ({
  useAuthStore: Object.assign((sel?: (s: unknown) => unknown) => (sel ? sel(fx.auth) : fx.auth), { getState: () => fx.auth }),
}))
vi.mock('@/lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }))
vi.mock('@/lib/trackDbEvent', () => ({ trackDbEvent: vi.fn() }))
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => fx.phone }))
vi.mock('@/hooks/useCountries', () => ({ useCountries: () => ({ countries: [], loading: false }) }))
vi.mock('@/hooks/useRoleSuggestions', () => ({ useRoleSuggestions: () => ({ data: null, suggestions: [], loading: false, error: false, refetch: () => undefined }) }))
vi.mock('@/hooks/useRoleApplicants', () => ({
  patchRoleApplicantStatus: vi.fn(),
  markRoleApplicantViewed: vi.fn(),
  useRoleApplicants: () => ({
    loading: false, error: null, expiryDays: 14, refresh: vi.fn(), setLocalStatus: vi.fn(), applicants: [],
    role: { id: 'r1', club_id: fx.roleOwner, status: 'open', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', opportunity_type: 'player' },
  }),
}))
vi.mock('@/hooks/useSigning', () => ({
  useApplicationRoad: () => ({ data: fx.road, loading: false, refetch: vi.fn() }),
  useSigningActions: () => ({ busy: false, makeOffer: vi.fn(), withdrawOffer: vi.fn(), markSigned: vi.fn(), undoMarkSigned: vi.fn(), setTrial: vi.fn() }),
}))
vi.mock('@/hooks/useProfileScrollData', () => ({
  useProfileScrollData: () => ({ highlights: [], fullMatches: [], reels: [], fullGameLinks: [], career: [] }),
}))
vi.mock('@/hooks/useTrustedReferences', () => ({ useTrustedReferences: () => ({ acceptedReferences: [] }) }))
vi.mock('@/components/ProfileActionMenu', () => ({ default: () => null }))
// The "…" on the role: only where "Edit role" goes matters here.
vi.mock('@/components/club/RoleActions', () => ({
  RoleActions: ({ onEdit }: { onEdit?: () => void }) => (
    <button type="button" data-testid="role-edit" data-custom-edit={onEdit ? 'yes' : 'no'} onClick={() => onEdit?.()}>Edit role</button>
  ),
}))
vi.mock('@/pages/ApplicantsList', () => ({ default: () => <div data-testid="applicants-v1" /> }))
vi.mock('@/pages/OpportunitiesPage', () => ({ default: () => <div data-testid="opportunities-page" /> }))
vi.mock('@/components/club/HockiaSuggestsScreen', () => ({ default: () => <div data-testid="hockia-suggests-screen" /> }))
vi.mock('@/components/club/SuggestRefineScreen', () => ({ default: () => <div data-testid="suggest-refine-screen" /> }))

import { ApplicantReviewEntry, ApplicantsEntry, HockiaSuggestsEntry } from '@/pages/ClubRecruitingRoutes'
import ApplicantsScreen from '@/components/club/ApplicantsScreen'
import ApplicantReviewScreen from '@/components/club/ApplicantReviewScreen'
import OfferSheet from '@/components/club/OfferSheet'
import MarkSignedSheet from '@/components/club/MarkSignedSheet'
import { usePublisherOrganisation } from '@/hooks/usePublisherOrganisation'
import { COACH_SIGNING_NEEDS_CLUB_NOTE, coachSigningNeedsClub, publisherOrganisation, recruiterRolesHome } from '@/lib/coachRoles'
import { markSignedBody, offerContractNote } from '@/lib/signing'
import { draftInviteNote } from '@/lib/invites'

const NOW = new Date('2026-10-04T12:00:00Z')
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterAll(() => { vi.useRealTimers() })

const as = (profile: Profile | null) => { fx.auth = { user: profile ? { id: profile.id as string } : null, profile } }

const ROAD_ROLE = { id: 'r1', title: 'Men’s 1st player', position: 'midfielder', opportunity_type: 'player', status: 'open', start_date: null, duration_text: null, compensation: null, benefits: [], custom_benefits: [], world_club_id: null, organization_name: null }
const road = (role: Record<string, unknown> = {}) => ({ trial: false, talked: false, signedAt: null, shortlistedAt: '2026-10-01T00:00:00Z', offer: null, waiting: 0, role: { ...ROAD_ROLE, ...role } })
const application = (status: string) => ({
  status, applied_at: '2026-09-28T00:00:00Z', metadata: {}, opportunity_id: 'r1',
  applicant: { id: 'p1', full_name: 'Leandro Bica', avatar_url: null, role: 'player', position: 'midfielder', secondary_position: null, nationality_country_id: null, nationality2_country_id: null, base_location: null, playing_category: 'adult_men', gender: 'Men', last_active_at: null, current_club: null, current_world_club_id: null, specialist_skills: [] },
})

beforeEach(() => {
  navigateSpy.mockReset()
  fx.phone = true
  fx.tables = {}
  fx.road = null
  fx.roleOwner = 'coach1'
  as(null)
})

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}{l.search}</div>
}
const withClient = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>
)
const renderRoute = (path: string, pattern: string, element: ReactNode) =>
  render(withClient(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={element} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  ))
const inRouter = (ui: ReactNode) => render(withClient(<MemoryRouter>{ui}</MemoryRouter>))

// ── 1 · route guard matrix ─────────────────────────────────────────────────
const APPLICANTS = '/dashboard/opportunities/r1/applicants'
const REVIEW = '/dashboard/opportunities/r1/applicants/a1'
const SUGGESTED = '/dashboard/opportunities/r1/suggested'

describe('route guard · Applicants', () => {
  const open = () => renderRoute(APPLICANTS, '/dashboard/opportunities/:opportunityId/applicants', <ApplicantsEntry />)

  it.each([
    ['club', CLUB, 'club1'],
    ['recruiting coach', COACH, 'coach1'],
  ])('phone · %s → the v2 screen', async (_n, profile, owner) => {
    as(profile); fx.roleOwner = owner
    open()
    expect(await screen.findByTestId('applicants-screen')).toBeTruthy()
    expect(screen.queryByTestId('applicants-v1')).toBeNull()
  })

  it.each([
    ['non-recruiting coach', CANDIDATE_COACH],
    ['player', PLAYER],
  ])('phone · %s → today’s page', async (_n, profile) => {
    as(profile)
    open()
    expect(await screen.findByTestId('applicants-v1')).toBeTruthy()
    expect(screen.queryByTestId('applicants-screen')).toBeNull()
  })

  it.each([
    ['club', CLUB],
    ['recruiting coach', COACH],
    ['non-recruiting coach', CANDIDATE_COACH],
    ['player', PLAYER],
  ])('desktop · %s → today’s page', async (_n, profile) => {
    as(profile); fx.phone = false
    open()
    expect(await screen.findByTestId('applicants-v1')).toBeTruthy()
    expect(screen.queryByTestId('applicants-screen')).toBeNull()
  })

  it('phone · profile still loading → blank, never the v1 page', () => {
    as(null)
    const { container } = open()
    expect(screen.queryByTestId('applicants-v1')).toBeNull()
    expect(screen.queryByTestId('applicants-screen')).toBeNull()
    expect(container.querySelector('.min-h-screen.bg-white')).toBeTruthy()
  })
})

describe('route guard · Applicant review', () => {
  const open = () => renderRoute(REVIEW, '/dashboard/opportunities/:opportunityId/applicants/:applicationId', <ApplicantReviewEntry />)

  it.each([
    ['club', CLUB],
    ['recruiting coach', COACH],
  ])('phone · %s → the v2 review', async (_n, profile) => {
    as(profile)
    open()
    expect(await screen.findByTestId('applicant-review-screen')).toBeTruthy()
  })

  it.each([
    ['non-recruiting coach', CANDIDATE_COACH, true],
    ['player', PLAYER, true],
    ['club', CLUB, false],
    ['recruiting coach', COACH, false],
    ['non-recruiting coach', CANDIDATE_COACH, false],
    ['player', PLAYER, false],
  ])('%s · phone=%s → back to the role’s applicants', (_n, profile, phone) => {
    as(profile); fx.phone = phone as boolean
    open()
    expect(screen.getByTestId('where').textContent).toBe(APPLICANTS)
    expect(screen.queryByTestId('applicant-review-screen')).toBeNull()
  })

  it('phone · profile still loading → blank', () => {
    as(null)
    open()
    expect(screen.queryByTestId('where')).toBeNull()
    expect(screen.queryByTestId('applicant-review-screen')).toBeNull()
  })
})

describe('route guard · Hockia suggests', () => {
  const open = (refine = false) => renderRoute(refine ? `${SUGGESTED}/ask` : SUGGESTED, refine ? '/dashboard/opportunities/:opportunityId/suggested/ask' : '/dashboard/opportunities/:opportunityId/suggested', <HockiaSuggestsEntry refine={refine} />)

  it.each([
    ['club', CLUB],
    ['recruiting coach', COACH],
  ])('phone · %s → the suggests screen and its refine chat', async (_n, profile) => {
    as(profile)
    const first = open()
    expect(await screen.findByTestId('hockia-suggests-screen')).toBeTruthy()
    first.unmount()
    open(true)
    expect(await screen.findByTestId('suggest-refine-screen')).toBeTruthy()
  })

  it.each([
    ['non-recruiting coach', CANDIDATE_COACH, true, '/home'],
    ['player', PLAYER, true, '/home'],
    ['non-recruiting coach', CANDIDATE_COACH, false, '/home'],
    ['player', PLAYER, false, '/home'],
    ['club', CLUB, false, APPLICANTS],
    ['recruiting coach', COACH, false, APPLICANTS],
  ])('%s · phone=%s → %s', (_n, profile, phone, target) => {
    as(profile); fx.phone = phone as boolean
    open()
    expect(screen.getByTestId('where').textContent).toBe(target)
  })
})

// ── 2 · a coach owner's way back ───────────────────────────────────────────
describe('Applicants · back and edit for the owner', () => {
  it('a coach goes back to My roles; no link to the club Opportunities tab', () => {
    as(COACH)
    inRouter(<ApplicantsScreen roleId="r1" />)
    const back = screen.getByRole('button', { name: 'Back to My roles' })
    expect(screen.queryByRole('button', { name: 'Back to Opportunities' })).toBeNull()
    fireEvent.click(back)
    expect(navigateSpy).toHaveBeenCalledWith('/opportunities?view=mine')
    expect(navigateSpy).not.toHaveBeenCalledWith('/opportunities')
  })

  it('a coach’s Edit role opens their own role form on My roles, never the club phone editor', () => {
    as(COACH)
    inRouter(<ApplicantsScreen roleId="r1" />)
    const edit = screen.getByTestId('role-edit')
    expect(edit.getAttribute('data-custom-edit')).toBe('yes')
    fireEvent.click(edit)
    expect(navigateSpy).toHaveBeenCalledWith('/opportunities?view=mine', { state: { editRoleId: 'r1' } })
    expect(navigateSpy.mock.calls.some(([to]) => typeof to === 'string' && to.endsWith('/edit'))).toBe(false)
  })

  it('a club is unchanged: back to Opportunities, the default phone editor', () => {
    as(CLUB); fx.roleOwner = 'club1'
    inRouter(<ApplicantsScreen roleId="r1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Opportunities' }))
    expect(navigateSpy).toHaveBeenCalledWith('/opportunities')
    expect(screen.getByTestId('role-edit').getAttribute('data-custom-edit')).toBe('no')
  })

  it('the Hockia suggests entry row shows on a coach’s own open player role', () => {
    as(COACH)
    inRouter(<ApplicantsScreen roleId="r1" />)
    fireEvent.click(screen.getByTestId('suggests-entry'))
    expect(navigateSpy).toHaveBeenCalledWith(SUGGESTED, expect.anything())
  })

  it('recruiterRolesHome', () => {
    expect(recruiterRolesHome(COACH)).toEqual({ path: '/opportunities?view=mine', label: 'My roles' })
    expect(recruiterRolesHome(CLUB)).toEqual({ path: '/opportunities', label: 'Opportunities' })
    expect(recruiterRolesHome(CANDIDATE_COACH)).toEqual({ path: '/opportunities', label: 'Opportunities' })
    expect(recruiterRolesHome(null)).toEqual({ path: '/opportunities', label: 'Opportunities' })
  })
})

// ── 3 · the organisation, never the coach ──────────────────────────────────
describe('publisherOrganisation', () => {
  it('a club account is its own organisation', () => {
    expect(publisherOrganisation({ role: 'club', full_name: ' E2E Test FC ', avatar_url: 'crest.png' }, null, null)).toEqual({ name: 'E2E Test FC', avatarUrl: 'crest.png', isClub: true })
  })

  it('a coach: world club → organisation on the role → club on the profile', () => {
    const coach = { role: 'coach', coach_recruits_for_team: true, full_name: 'Jo Coach', avatar_url: 'jo.jpg', current_club: 'Typed Club' }
    expect(publisherOrganisation(coach, { organization_name: 'Role Org' }, { club_name: 'Barnes HC', avatar_url: 'barnes.png' })).toEqual({ name: 'Barnes HC', avatarUrl: 'barnes.png', isClub: false })
    expect(publisherOrganisation(coach, { organization_name: 'Role Org' }, null)).toEqual({ name: 'Role Org', avatarUrl: null, isClub: false })
    expect(publisherOrganisation(coach, { organization_name: '  ' }, null)).toEqual({ name: 'Typed Club', avatarUrl: null, isClub: false })
  })

  it('a coach with no club anywhere has no organisation — never their own name or photo', () => {
    const org = publisherOrganisation({ role: 'coach', full_name: 'Jo Coach', avatar_url: 'jo.jpg', current_club: null }, { organization_name: null }, null)
    expect(org).toEqual({ name: null, avatarUrl: null, isClub: false })
  })

  it('the hook reads the role’s world club first, then the coach’s', async () => {
    as({ ...COACH, current_world_club_id: 'wc-coach' })
    fx.tables = { world_clubs: [{ club_name: 'Barnes HC', avatar_url: 'barnes.png' }] }
    const Probe = ({ role }: { role: { world_club_id?: string | null; organization_name?: string | null } | null }) => {
      const org = usePublisherOrganisation(role)
      return <div data-testid="org">{org.name ?? 'none'}|{org.avatarUrl ?? 'none'}|{String(org.isClub)}</div>
    }
    render(withClient(<Probe role={{ world_club_id: null, organization_name: 'Role Org' }} />))
    await waitFor(() => expect(screen.getByTestId('org').textContent).toBe('Barnes HC|barnes.png|false'))
  })

  it('the hook never queries a world club for a club account', () => {
    as({ ...CLUB, current_world_club_id: 'wc-club' })
    fx.tables = { world_clubs: [{ club_name: 'Other name', avatar_url: 'x.png' }] }
    const Probe = () => <div data-testid="org">{usePublisherOrganisation(null).name}</div>
    render(withClient(<Probe />))
    expect(screen.getByTestId('org').textContent).toBe('E2E Test FC')
  })
})

describe('sheet copy', () => {
  it('mark as signed: a club gets the squad line; a coach gets the organisation', () => {
    expect(markSignedBody('Leandro', true)).toBe('Leandro will be asked to confirm. Then they join your squad on Hockia and the signing goes on their career.')
    expect(markSignedBody('Leandro', true, 'E2E Test FC')).toContain('join your squad')
    expect(markSignedBody('Leandro', false, 'Barnes HC')).toBe('Leandro will be asked to confirm. Then the signing with Barnes HC goes on their career.')
    expect(markSignedBody('Leandro', false)).toBe('Leandro will be asked to confirm. Then the signing goes on their career.')
  })

  it('offer footnote names who the contract is with', () => {
    expect(offerContractNote(true, 'E2E Test FC')).toContain('between your club and the player')
    expect(offerContractNote(false, 'Barnes HC')).toContain('between Barnes HC and the player')
    expect(offerContractNote(false, null)).toContain('between the club and the player')
  })

  it('the invite note names the organisation', () => {
    const note = draftInviteNote({ firstName: 'Leandro', clubName: 'Barnes HC', role: { id: 'r1', title: 'Men’s 1st player', position: 'midfielder', gender: 'Men', compensation: null, benefits: [], opportunity_type: 'player' } })
    expect(note).toContain('Barnes HC')
  })

  it('OfferSheet (coach): the organisation in the footnote, no "your club"', () => {
    inRouter(<OfferSheet open firstName="Leandro" roleLabel="Midfielder" role={ROAD_ROLE} current={null} publisherIsClub={false} organisation="Barnes HC" busy={false} onClose={vi.fn()} onSend={vi.fn()} />)
    const note = screen.getByTestId('offer-contract-note').textContent ?? ''
    expect(note).toContain('Barnes HC')
    expect(note).not.toContain('your club')
  })

  it('OfferSheet (club): unchanged copy by default', () => {
    inRouter(<OfferSheet open firstName="Leandro" roleLabel="Midfielder" role={ROAD_ROLE} current={null} busy={false} onClose={vi.fn()} onSend={vi.fn()} />)
    expect(screen.getByTestId('offer-contract-note').textContent).toBe('An offer on Hockia sets out what you’re offering. The contract itself is between your club and the player.')
  })

  it('MarkSignedSheet (coach): the organisation, not a squad', () => {
    inRouter(<MarkSignedSheet open firstName="Leandro" playerAvatar={null} playerName="Leandro Bica" clubAvatar={null} clubName="Barnes HC" publisherIsClub={false} roleLabel="Midfielder" waiting={0} busy={false} onClose={vi.fn()} onConfirm={vi.fn()} />)
    const body = screen.getByTestId('mark-signed-body').textContent ?? ''
    expect(body).toContain('signing with Barnes HC')
    expect(body).not.toContain('your squad')
  })
})

// ── 4 · the review screen with a coach as the owner ────────────────────────
describe('Applicant review · coach owner', () => {
  const openReview = (status: string) => {
    fx.tables = {
      opportunity_applications: [application(status)],
      opportunities: [{ gender: 'Men', club_id: 'coach1' }],
      application_response_settings: [{ expiry_days: 14 }],
    }
    return inRouter(<ApplicantReviewScreen roleId="r1" applicationId="a1" />)
  }

  it('mark as signed names the role’s organisation, never the coach', async () => {
    as(COACH)
    fx.road = road({ organization_name: 'Barnes HC' })
    openReview('accepted')
    const main = await screen.findByTestId('road-main')
    expect(main.textContent).toBe('Mark as signed')
    fireEvent.click(main)
    const sheet = await screen.findByTestId('mark-signed-sheet')
    expect(sheet.textContent).toContain('signing with Barnes HC')
    expect(sheet.textContent).not.toContain('Jo Coach')
    expect(sheet.textContent).not.toContain('your squad')
    // The coach's own photo is never drawn as the club crest.
    expect(sheet.querySelector('img[src*="jo.jpg"]')).toBeNull()
  })

  it('the offer sheet names the organisation (the club typed on the coach’s profile when the role has none)', async () => {
    as(COACH)
    fx.road = road()
    openReview('shortlisted')
    const main = await screen.findByTestId('road-main')
    expect(main.textContent).toBe('Make an offer')
    fireEvent.click(main)
    const note = await screen.findByTestId('offer-contract-note')
    expect(note.textContent).toContain('between Typed Club and the player')
    expect(screen.getByTestId('offer-sheet').textContent).not.toContain('Jo Coach')
  })

  it('a coach with no club on the role or the profile cannot mark a signing', async () => {
    as({ ...COACH, current_club: null })
    fx.road = road()
    openReview('accepted')
    const waiting = await screen.findByTestId('road-waiting')
    expect(waiting.textContent).toBe(COACH_SIGNING_NEEDS_CLUB_NOTE)
    expect(screen.queryByTestId('road-main')).toBeNull()
  })

  it('… and "Mark as signed" leaves the menu too, while offers stay', async () => {
    as({ ...COACH, current_club: '  ' })
    fx.road = road()
    openReview('shortlisted')
    expect((await screen.findByTestId('road-main')).textContent).toBe('Make an offer')
    fireEvent.click(screen.getByTestId('road-more'))
    expect(await screen.findByTestId('road-menu-decline')).toBeTruthy()
    expect(screen.queryByTestId('road-menu-mark_signed')).toBeNull()
  })

  it('coachSigningNeedsClub mirrors confirm_signing’s naming order', () => {
    expect(coachSigningNeedsClub({ role: 'coach', current_club: null }, { organization_name: null })).toBe(true)
    expect(coachSigningNeedsClub({ role: 'coach', current_club: null }, null)).toBe(true)
    expect(coachSigningNeedsClub({ role: 'coach', current_club: 'Typed Club' }, { organization_name: null })).toBe(false)
    expect(coachSigningNeedsClub({ role: 'coach', current_club: null }, { organization_name: 'Role Org' })).toBe(false)
    // A linked world club alone does not name the career entry on the server.
    expect(coachSigningNeedsClub({ role: 'coach', current_club: null }, { organization_name: null, world_club_id: 'wc1' })).toBe(true)
    expect(coachSigningNeedsClub({ role: 'club' }, null)).toBe(false)
  })

  it('a club owner is unchanged: its own name and the squad line', async () => {
    as(CLUB)
    fx.road = road()
    fx.tables = {
      opportunity_applications: [application('accepted')],
      opportunities: [{ gender: 'Men', club_id: 'club1' }],
      application_response_settings: [{ expiry_days: 14 }],
    }
    inRouter(<ApplicantReviewScreen roleId="r1" applicationId="a1" />)
    fireEvent.click(await screen.findByTestId('road-main'))
    const sheet = await screen.findByTestId('mark-signed-sheet')
    expect(sheet.textContent).toContain('join your squad')
    expect(sheet.textContent).not.toContain('signing with')
  })
})
