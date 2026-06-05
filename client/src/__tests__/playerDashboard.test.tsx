import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import PlayerDashboard, { type PlayerProfileShape } from '@/pages/PlayerDashboard'

type LocationObserverProps = {
  onChange: (value: string) => void
}

function LocationObserver({ onChange }: LocationObserverProps) {
  const location = useLocation()
  useEffect(() => {
    onChange(`${location.pathname}${location.search}`)
  }, [location, onChange])
  return null
}

const user = userEvent.setup()

const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

vi.mock('@/components', () => ({
  Avatar: ({ initials }: { initials?: string }) => <div data-testid="avatar">{initials}</div>,
  AvatarMenu: () => null,
  AvailabilityPill: () => <span data-testid="availability-pill" />,
  DashboardMenu: () => <div data-testid="dashboard-menu" />,
  EditProfileModal: () => <div data-testid="edit-profile-modal" />,
  FriendsTab: () => <div data-testid="friends-tab">Friends tab</div>,
  FriendshipButton: () => <button data-testid="friendship-button" type="button">Friendship</button>,
  PublicReferencesSection: () => <div data-testid="public-references">Public references</div>,
  ReferencesTab: () => <div data-testid="references-tab">References tab</div>,
  PublicViewBanner: () => <div data-testid="public-view-banner" />,
  RoleBadge: () => <span data-testid="role-badge">Role badge</span>,
  TierBadge: () => <span data-testid="tier-badge">Tier</span>,
  TrustBadge: () => <span data-testid="trust-badge" />,
  VerifiedBadge: () => <span data-testid="verified-badge" />,
  NextStepCard: () => <div data-testid="next-step-card">Next Step</div>,
  ProfileHealthCard: () => <div data-testid="profile-health-card">Profile Health</div>,
  SocialLinksDisplay: () => <div data-testid="social-links-display" />,
  // Spy stub: surfaces showLastActive + lastActiveAt as data attributes
  // so integration tests can assert the value flows through from the
  // fetched profile → PlayerDashboard → HeroIdentityCard → LastActivePill.
  LastActivePill: ({
    lastActiveAt,
    showLastActive,
  }: {
    lastActiveAt?: string | null
    showLastActive?: boolean | null
  }) => (
    <span
      data-testid="last-active-pill"
      data-show-last-active={String(showLastActive)}
      data-last-active-at={String(lastActiveAt)}
    />
  ),
  WelcomeValueCard: () => <div data-testid="welcome-value-card" />,
  FreshnessCard: () => <div data-testid="freshness-card" />,
  RecentlyConnectedCard: () => <div data-testid="recently-connected-card" />,
  ProfileSnapshot: () => <div data-testid="profile-snapshot" />,
  CategoryConfirmationBanner: () => null,
  CountryDisplay: ({ fallbackText, className }: { countryId?: number | null; fallbackText?: string | null; showNationality?: boolean; className?: string }) => (
    <span data-testid="country-display" className={className}>{fallbackText}</span>
  ),
  DualNationalityDisplay: ({ fallbackText, className }: { primaryCountryId?: number | null; secondaryCountryId?: number | null; fallbackText?: string | null; mode?: string; className?: string }) => (
    <span data-testid="dual-nationality-display" className={className}>{fallbackText}</span>
  ),
  ScrollableTabs: ({ tabs, activeTab, onTabChange }: { tabs: { id: string; label: string }[]; activeTab: string; onTabChange: (id: string) => void }) => (
    <div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          data-testid={`tab-${tab.id}`}
          data-active={tab.id === activeTab}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
}))

vi.mock('@/components/Header', () => ({
  default: () => <div data-testid="header" />,
}))

vi.mock('@/components/Button', () => ({
  default: ({ children, onClick, type = 'button', ...props }: { children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit' | 'reset' }) => (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}))

vi.mock('@/components/ProfileActionMenu', () => ({
  default: () => <div data-testid="profile-action-menu" />,
}))

vi.mock('@/components/profile/ShareProfileButton', () => ({
  default: () => <button type="button" data-testid="share-profile-button">Share</button>,
}))

vi.mock('@/components/MediaTab', () => ({
  default: () => <div data-testid="media-tab">Media Tab</div>,
}))

vi.mock('@/components/JourneyTab', () => ({
  default: () => <div data-testid="journey-tab">Journey Tab</div>,
}))

vi.mock('@/components/CommentsTab', () => ({
  default: () => <div data-testid="comments-tab">Comments Tab</div>,
}))

vi.mock('@/components/AddVideoLinkModal', () => ({
  default: () => <div data-testid="add-video-modal" />,
}))

vi.mock('@/components/ProfilePostsTab', () => ({
  default: () => <div data-testid="profile-posts-tab">Profile Posts</div>,
}))

vi.mock('@/components/SignInPromptModal', () => ({
  default: () => null,
}))

vi.mock('@/components/ProfileViewersSection', () => ({
  ProfileViewersSection: () => <div data-testid="profile-viewers-section">Profile Viewers</div>,
}))

// PlayerBentoGrid is stubbed in this test — it has its own dedicated
// tests (playerBentoGrid.test.tsx) for owner/visitor card composition.
// Stubbing here keeps PlayerDashboard tests focused on the dashboard
// shell (Hero + Bento Grid vs tab content routing) without dragging
// in Supabase fetches from every child card.
vi.mock('@/components/dashboard/bento/PlayerBentoGrid', () => ({
  default: ({ readOnly }: { readOnly: boolean }) => (
    <div data-testid={readOnly ? 'player-bento-grid-visitor' : 'player-bento-grid-owner'}>
      Bento Grid ({readOnly ? 'visitor' : 'owner'})
    </div>
  ),
}))

// May 2026 Community redesign — stub PlayerCommunityHub / PublicCommunityView
// to surface the testids the redesign exposes, without dragging in the
// useTrustedReferences + useReferenceFriendOptions fetch graphs. Detailed
// behaviour for these is tested in their own component tests.
vi.mock('@/components/community/PlayerCommunityHub', () => ({
  default: () => (
    <div data-testid="player-community-hub">
      <div data-testid="credibility-network-card">Credibility</div>
      <div data-testid="community-references-selected">Selected references</div>
      <div data-testid="connections-section">Connections</div>
      <div data-testid="comments-tab">Comments Tab</div>
      <div data-testid="profile-posts-tab">Profile Posts</div>
    </div>
  ),
}))

vi.mock('@/components/community/PublicCommunityView', () => ({
  default: () => (
    <div data-testid="public-community-view">
      <div data-testid="public-community-stats">Stats strip</div>
      <div data-testid="public-references">Public references</div>
      <div data-testid="comments-tab">Comments Tab</div>
      <div data-testid="profile-posts-tab">Profile Posts</div>
    </div>
  ),
}))

vi.mock('@/hooks/useProfileStrength', () => ({
  useProfileStrength: () => ({
    percentage: 60,
    buckets: [
      { id: 'basic-info', label: 'Basic info completed', completed: true, weight: 25, action: { type: 'edit-profile' } },
      { id: 'highlight-video', label: 'Add your highlight video', completed: false, weight: 25, action: { type: 'add-video' } },
    ],
    loading: false,
    refresh: vi.fn(),
  }),
}))

vi.mock('@/hooks/useWorldClubLogo', () => ({
  useWorldClubLogo: () => null,
  // #4b — ScoutingCard's useInterest resolves the proven band via these.
  getClubLevelBand: () => null,
  getPlayerLeagueName: () => null,
  prefetchWorldClubLogos: () => Promise.resolve(),
}))

vi.mock('@/hooks/useTabDeepLinkScroll', () => ({
  useTabDeepLinkScroll: () => undefined,
}))

vi.mock('@/lib/analytics', () => ({
  trackReferenceBadgeClick: vi.fn(),
}))

type NotificationStoreSlice = {
  claimCommentHighlights: () => string[]
  clearCommentNotifications: () => void
  commentHighlightVersion: number
}

const buildNotificationStore = (): NotificationStoreSlice => ({
  claimCommentHighlights: vi.fn(() => []),
  clearCommentNotifications: vi.fn(),
  commentHighlightVersion: 0,
})

let notificationStoreState: NotificationStoreSlice = buildNotificationStore()
const setNotificationStoreState = (overrides: Partial<NotificationStoreSlice> = {}) => {
  notificationStoreState = { ...buildNotificationStore(), ...overrides }
}

vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (selector: (state: NotificationStoreSlice) => unknown) => selector(notificationStoreState),
}))

interface AuthState {
  user: { id: string } | null
  profile: unknown
}

let authStoreState: AuthState = { user: { id: 'viewer-1' }, profile: null }
const setAuthStoreState = (overrides: Partial<AuthState>) => {
  authStoreState = { ...authStoreState, ...overrides }
}

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authStoreState,
}))

vi.mock('@/lib/supabase', () => {
  // Single chainable builder that covers both the conversation-resolver
  // path (select → or → maybeSingle) and the RecruitmentVisibilityWidget's
  // count-style query (select → eq → eq, then await). The `.then` makes
  // the builder thenable so an awaited query without an explicit
  // terminator resolves to a `{count, data, error}` shape.
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    // ScoutingCard (visitor view) now resolves country names via
    // useCountries → .from('countries').select().order('name').then().
    order: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'mock-conversation' }, error: null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
    then: (resolve: (value: { data: null; count: number; error: null }) => unknown) =>
      Promise.resolve({ data: null, count: 0, error: null }).then(resolve),
  }

  return {
    supabase: {
      from: vi.fn(() => builder),
      rpc: vi.fn().mockResolvedValue({ data: false, error: null }),
    },
  }
})

const baseProfile: PlayerProfileShape = {
  id: 'player-1',
  role: 'player',
  full_name: 'Jordan Hall',
  avatar_url: null,
  base_location: 'London',
  bio: 'Midfielder',
  nationality: 'United Kingdom',
  nationality_country_id: null,
  nationality2_country_id: null,
  gender: 'Female',
  date_of_birth: '2000-01-01',
  position: 'Midfield',
  secondary_position: 'Defense',
  current_club: 'London HC',
  email: 'jordan@example.com',
  contact_email: 'jordan@example.com',
  contact_email_public: true,
}

type RenderOptions = {
  initialPath?: string
  readOnly?: boolean
  profileOverrides?: Partial<PlayerProfileShape>
}

const renderDashboard = (options?: RenderOptions) => {
  const locationHistory: string[] = []
  const initialEntries = [options?.initialPath ?? '/dashboard/profile']
  const profile = { ...baseProfile, ...(options?.profileOverrides ?? {}) }
  const dashboardEl = (
    <PlayerDashboard profileData={profile} readOnly={options?.readOnly ?? false} />
  )

  // PR2 routes are section-segmented; useParams() needs the matching
  // Route pattern to return params.section, etc. We declare each shape
  // here so any test-initialPath works (Bento landing, section page,
  // visitor URL, visitor section URL, legacy ?tab= via redirect).
  const utils = render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationObserver onChange={(value) => locationHistory.push(value)} />
      <Routes>
        <Route path="/dashboard/profile" element={dashboardEl} />
        <Route path="/dashboard/profile/:section" element={dashboardEl} />
        <Route path="/players/:username" element={dashboardEl} />
        <Route path="/players/:username/:section" element={dashboardEl} />
        <Route path="/players/id/:id" element={dashboardEl} />
        <Route path="/players/id/:id/:section" element={dashboardEl} />
      </Routes>
    </MemoryRouter>
  )

  return { ...utils, locationHistory }
}

beforeEach(() => {
  vi.clearAllMocks()
  addToast.mockReset()
  setAuthStoreState({ user: { id: 'viewer-1' }, profile: null })
  setNotificationStoreState()
})

describe('PlayerDashboard (Bento Grid)', () => {
  it('renders the owner Bento Grid on the default /dashboard/profile route', () => {
    renderDashboard()
    expect(screen.getByTestId('player-bento-grid-owner')).toBeInTheDocument()
    expect(screen.queryByTestId('player-bento-grid-visitor')).not.toBeInTheDocument()
  })

  it('renders the visitor Bento Grid on the public profile route', () => {
    renderDashboard({ readOnly: true })
    expect(screen.getByTestId('player-bento-grid-visitor')).toBeInTheDocument()
    expect(screen.queryByTestId('player-bento-grid-owner')).not.toBeInTheDocument()
  })

  it('does not render the standalone NextStepCard (its content moved into Hero progress section)', () => {
    // NextStepCard used to sit above the Bento Grid as a separate
    // gamification spine. It was removed because the Hero's Profile
    // Complete section + "Full checklist" accordion now own that role —
    // the per-bucket actions live inside the Hero, not as a sibling card.
    renderDashboard()
    expect(screen.queryByTestId('next-step-card')).not.toBeInTheDocument()
  })

  it('does not render the standalone NextStepCard for visitors either', () => {
    renderDashboard({ readOnly: true })
    expect(screen.queryByTestId('next-step-card')).not.toBeInTheDocument()
  })

  it('renders section content when the owner deep-links to a section route', async () => {
    renderDashboard({ initialPath: '/dashboard/profile/friends' })
    // Bento Grid hides; section content shows
    expect(screen.queryByTestId('player-bento-grid-owner')).not.toBeInTheDocument()
    expect(screen.getByTestId('friends-tab')).toBeInTheDocument()
    // The PR2-deleted tab strip is fully gone — section navigation now
    // happens via card CTAs from the Bento landing.
    expect(screen.queryByRole('button', { name: 'Comments' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument()
  })

  it('redirects legacy ?tab=X URLs to the new /:section route shape', async () => {
    const { locationHistory } = renderDashboard({ initialPath: '/dashboard/profile?tab=friends' })
    // Notifications/config.ts still emits ?tab= URLs; PlayerDashboard
    // migrates them on mount. The rendered content is the same.
    expect(screen.getByTestId('friends-tab')).toBeInTheDocument()
    await waitFor(() => {
      expect(locationHistory.at(-1)).toBe('/dashboard/profile/friends')
    })
  })

  it('owner "Back to dashboard" button on a section page returns to the Bento Grid', async () => {
    const { locationHistory } = renderDashboard({ initialPath: '/dashboard/profile/journey' })
    expect(screen.getByTestId('journey-tab')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to dashboard/i }))
    expect(await screen.findByTestId('player-bento-grid-owner')).toBeInTheDocument()
    expect(screen.queryByTestId('journey-tab')).not.toBeInTheDocument()
    expect(locationHistory.at(-1)).toBe('/dashboard/profile')
  })

  it('renders only the active section content (one at a time) in owner mode', () => {
    renderDashboard({ initialPath: '/dashboard/profile/friends', readOnly: false })
    expect(screen.getByTestId('friends-tab')).toBeInTheDocument()
    expect(screen.queryByTestId('journey-tab')).not.toBeInTheDocument()
    expect(screen.queryByTestId('comments-tab')).not.toBeInTheDocument()
  })

  it('visitor section URL renders the section content with a Back-to-profile shortcut', () => {
    renderDashboard({ initialPath: '/players/jordan/journey', readOnly: true })
    expect(screen.getByRole('button', { name: /back to profile/i })).toBeInTheDocument()
    expect(screen.getByTestId('journey-tab')).toBeInTheDocument()
    // No tab strip anywhere
    expect(screen.queryByRole('button', { name: 'Profile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Journey' })).not.toBeInTheDocument()
  })

  it('visitor "Back to profile" button on a section page returns to the visitor Bento Grid', async () => {
    const { locationHistory } = renderDashboard({ initialPath: '/players/jordan/friends', readOnly: true })
    await user.click(screen.getByRole('button', { name: /back to profile/i }))
    expect(await screen.findByTestId('player-bento-grid-visitor')).toBeInTheDocument()
    expect(locationHistory.at(-1)).toBe('/players/jordan')
  })

  it('the owner /community page renders the PlayerCommunityHub redesign (credibility card, references, connections, comments, posts)', () => {
    // May 2026 Community redesign — the old stacked FriendsTab +
    // ReferencesTab + CommentsTab + ProfilePostsTab block was replaced
    // by the PlayerCommunityHub. The individual focused routes
    // (/friends, /references, /comments, /posts) still render the
    // legacy surfaces, but /community is now the curated hub view.
    renderDashboard({ initialPath: '/dashboard/profile/community' })

    expect(screen.getByTestId('credibility-network-card')).toBeInTheDocument()
    expect(screen.getByTestId('community-references-selected')).toBeInTheDocument()
    expect(screen.getByTestId('connections-section')).toBeInTheDocument()
    expect(screen.getByTestId('comments-tab')).toBeInTheDocument()
    expect(screen.getByTestId('profile-posts-tab')).toBeInTheDocument()
    // Bento Grid is hidden on section pages.
    expect(screen.queryByTestId('player-bento-grid-owner')).not.toBeInTheDocument()
  })

  it('the visitor /community page renders the slimmer PublicCommunityView', () => {
    renderDashboard({ initialPath: '/players/jordan/community', readOnly: true })

    expect(screen.getByTestId('public-community-stats')).toBeInTheDocument()
    expect(screen.getByTestId('public-references')).toBeInTheDocument()
    // Visitor view does not expose the owner-only references list.
    expect(screen.queryByTestId('community-references-selected')).not.toBeInTheDocument()
    expect(screen.queryByTestId('connections-section')).not.toBeInTheDocument()
    expect(screen.getByTestId('comments-tab')).toBeInTheDocument()
    expect(screen.getByTestId('profile-posts-tab')).toBeInTheDocument()
  })

  it('claims comment highlights when entering the comments section', async () => {
    const claimCommentHighlights = vi.fn(() => ['comment-99']) as () => string[]
    const clearCommentNotifications = vi.fn()
    setNotificationStoreState({
      claimCommentHighlights,
      clearCommentNotifications,
    })

    renderDashboard({ initialPath: '/dashboard/profile/comments' })

    await waitFor(() => {
      expect(claimCommentHighlights).toHaveBeenCalled()
      expect(clearCommentNotifications).toHaveBeenCalled()
    })
  })

  it('navigates to an existing conversation when messaging a player', async () => {
    setAuthStoreState({ user: { id: 'viewer-42' }, profile: null })

    const { locationHistory } = renderDashboard({ readOnly: true })

    await user.click(screen.getByRole('button', { name: /message/i }))

    await waitFor(() => {
      const lastLocation = locationHistory.at(-1)
      expect(lastLocation).toBe('/messages?conversation=mock-conversation')
    })
  })

  // ── LastActivePill prop-flow regression guard ──────────────────────
  // Catches the "select clause forgets show_last_active" regression
  // (Batch 8 staging QA) — verifies the value flows through PlayerDashboard
  // and HeroIdentityCard into the LastActivePill props.
  //
  // 2026-05-27: ScoutingCard now owns the visitor-view activity surface
  // (Zone 1 status line), so HeroIdentityCard hides LastActivePill in
  // the visitor view. The regression guard still matters — the
  // show_last_active column still has to flow through the SELECT — so
  // we assert it via the owner view where Hero still renders the pill.

  it('passes show_last_active=false through to LastActivePill', () => {
    renderDashboard({
      readOnly: false,
      profileOverrides: {
        ...({ show_last_active: false, last_active_at: '2026-05-08T12:00:00Z' } as Record<string, unknown>),
      },
    })

    const pill = screen.getByTestId('last-active-pill')
    expect(pill.getAttribute('data-show-last-active')).toBe('false')
    expect(pill.getAttribute('data-last-active-at')).toBe('2026-05-08T12:00:00Z')
  })

  it('passes show_last_active=true through to LastActivePill', () => {
    renderDashboard({
      readOnly: false,
      profileOverrides: {
        ...({ show_last_active: true, last_active_at: '2026-05-08T12:00:00Z' } as Record<string, unknown>),
      },
    })

    const pill = screen.getByTestId('last-active-pill')
    expect(pill.getAttribute('data-show-last-active')).toBe('true')
  })

  it('falls through to null (graceful default) when show_last_active is missing from the profile', () => {
    renderDashboard({
      readOnly: false,
      profileOverrides: {
        ...({ last_active_at: '2026-05-08T12:00:00Z' } as Record<string, unknown>),
      },
    })

    const pill = screen.getByTestId('last-active-pill')
    expect(pill.getAttribute('data-show-last-active')).toBe('null')
  })
})
