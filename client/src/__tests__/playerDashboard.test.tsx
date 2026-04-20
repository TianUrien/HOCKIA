import { useEffect } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { vi } from 'vitest'
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
  DashboardMenu: () => <div data-testid="dashboard-menu" />,
  EditProfileModal: () => <div data-testid="edit-profile-modal" />, 
  FriendsTab: () => <div data-testid="friends-tab">Friends tab</div>,
  FriendshipButton: () => <button data-testid="friendship-button" type="button">Friendship</button>,
  PublicReferencesSection: () => <div data-testid="public-references">Public references</div>,
  PublicViewBanner: () => <div data-testid="public-view-banner" />,
  RoleBadge: () => <span data-testid="role-badge">Role badge</span>,
  ProfileStrengthCard: () => <div data-testid="profile-strength-card">Profile Strength</div>,
  NextStepCard: () => <div data-testid="next-step-card">Next Step</div>,
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
  default: ({ children, ...props }: { children: React.ReactNode }) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
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

vi.mock('@/hooks/useProfileStrength', () => ({
  useProfileStrength: () => ({
    percentage: 60,
    buckets: [
      { id: 'basic-info', label: 'Basic info completed', completed: true, weight: 25, action: { type: 'edit-profile' } },
      { id: 'profile-photo', label: 'Add a profile photo', completed: true, weight: 20, action: { type: 'edit-profile' } },
      { id: 'highlight-video', label: 'Add your highlight video', completed: false, weight: 25, action: { type: 'add-video' } },
      { id: 'journey', label: 'Share a moment in your Journey', completed: true, weight: 15, action: { type: 'tab', tab: 'journey' } },
      { id: 'media-gallery', label: 'Add a photo or video to your Gallery', completed: false, weight: 15, action: { type: 'tab', tab: 'profile' } },
    ],
    loading: false,
    refresh: vi.fn(),
  }),
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
  const conversationQuery = {
    select: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'mock-conversation' }, error: null }),
    insert: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  }

  return {
    supabase: {
      from: vi.fn(() => conversationQuery),
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

  const utils = render(
    <MemoryRouter initialEntries={initialEntries}>
      <LocationObserver onChange={(value) => locationHistory.push(value)} />
      <PlayerDashboard profileData={profile} readOnly={options?.readOnly ?? false} />
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

describe('PlayerDashboard', () => {
  it('syncs the active tab with the URL and updates query params on change', async () => {
    const { locationHistory } = renderDashboard({ initialPath: '/dashboard/profile?tab=friends', readOnly: true })

    expect(screen.getByTestId('friends-tab')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Comments' }))
    expect(await screen.findByTestId('comments-tab')).toBeInTheDocument()

    const lastLocation = locationHistory.at(-1)
    expect(lastLocation).toBe('/dashboard/profile?tab=comments')
  })

  it('claims comment highlights when entering the comments tab', async () => {
    const claimCommentHighlights = vi.fn(() => ['comment-99']) as () => string[]
    const clearCommentNotifications = vi.fn()
    setNotificationStoreState({
      claimCommentHighlights,
      clearCommentNotifications,
    })

    renderDashboard({ initialPath: '/dashboard/profile?tab=comments' })

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

  // Basic Information section is hidden in public view (readOnly mode)
  // Contact email visibility tests now only apply to the owner's view
  it('hides Basic Information section in public view', () => {
    renderDashboard({ readOnly: true })

    expect(screen.queryByText('Basic Information')).not.toBeInTheDocument()
  })

  it('shows a private contact email note to the owner when hidden', () => {
    const privateEmail = 'private@example.com'
    renderDashboard({ readOnly: false, profileOverrides: { contact_email_public: false, contact_email: privateEmail } })

    expect(screen.getByText(/Private contact email:/i)).toBeInTheDocument()
    expect(screen.getByText(privateEmail)).toBeInTheDocument()
  })
})
