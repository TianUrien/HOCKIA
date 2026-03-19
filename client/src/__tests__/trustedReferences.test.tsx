import { MemoryRouter } from 'react-router-dom'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { ReferenceCard, IncomingReferenceRequest, GivenReference } from '@/hooks/useTrustedReferences'
import TrustedReferencesSection from '@/components/TrustedReferencesSection'

vi.mock('@/lib/supabase', () => ({
  SUPABASE_URL: 'https://supabase.test',
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      or: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null })
    })
  }
}))

const mockNavigate = vi.fn()

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom')
  return {
    ...actual,
    useNavigate: () => mockNavigate
  }
})

const mockUseTrustedReferences = vi.fn()
vi.mock('@/hooks/useTrustedReferences', () => ({
  useTrustedReferences: (profileId: string) => mockUseTrustedReferences(profileId)
}))

const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast })
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => ({
    user: { id: 'viewer-1' },
    profile: { id: 'viewer-1', role: 'player' }
  })
}))

const dismissNotification = vi.fn()
vi.mock('@/lib/notifications', () => ({
  useNotificationStore: (selector: (state: { dismissBySource: typeof dismissNotification }) => unknown) =>
    selector({ dismissBySource: dismissNotification })
}))

vi.mock('@/components/ReferenceEndorsementModal', () => ({
  __esModule: true,
  default: ({ isOpen, onSubmit }: { isOpen: boolean; onSubmit: (endorsement: string | null) => Promise<boolean> }) =>
    isOpen ? (
      <div data-testid="endorsement-modal">
        <button onClick={() => { void onSubmit('Rock solid leader') }}>
          Confirm endorsement
        </button>
      </div>
    ) : null
}))

vi.mock('@/components/ConfirmActionModal', () => ({
  __esModule: true,
  default: ({ isOpen, onConfirm, title }: { isOpen: boolean; onConfirm: () => void; title: string }) =>
    isOpen ? (
      <div data-testid="confirm-modal">
        <p>{title}</p>
        <button onClick={onConfirm}>Confirm</button>
      </div>
    ) : null
}))

const renderSection = (profileRole: 'player' | 'coach' | 'club', friendOptions = defaultFriends) =>
  render(
    <MemoryRouter>
      <TrustedReferencesSection profileId="profile-1" friendOptions={friendOptions} profileRole={profileRole} />
    </MemoryRouter>
  )

type HookState = {
  loading: boolean
  isOwner: boolean
  acceptedReferences: ReferenceCard[]
  pendingReferences: ReferenceCard[]
  incomingRequests: IncomingReferenceRequest[]
  givenReferences: GivenReference[]
  acceptedCount: number
  maxReferences: number
  canAddMore: boolean
  requestReference: (payload: { referenceId: string; relationshipType: string; requestNote?: string | null }) => Promise<boolean>
  respondToRequest: (payload: { referenceId: string; accept: boolean; endorsement?: string | null }) => Promise<boolean>
  removeReference: (referenceId: string) => Promise<boolean>
  withdrawReference: (referenceId: string) => Promise<boolean>
  refresh: () => Promise<void>
  editEndorsement: (referenceId: string, endorsement: string | null) => Promise<boolean>
  isMutating: (type: 'request' | 'respond' | 'remove' | 'withdraw' | 'edit', targetId?: string) => boolean
}

const createHookState = (overrides: Partial<HookState> = {}): HookState => {
  const value: HookState = {
    loading: false,
    isOwner: true,
    acceptedReferences: [],
    pendingReferences: [],
    incomingRequests: [],
    givenReferences: [],
    acceptedCount: 0,
    maxReferences: 5,
    canAddMore: true,
    requestReference: vi.fn().mockResolvedValue(true),
    respondToRequest: vi.fn().mockResolvedValue(true),
    removeReference: vi.fn().mockResolvedValue(true),
    withdrawReference: vi.fn().mockResolvedValue(true),
    editEndorsement: vi.fn().mockResolvedValue(true),
    refresh: vi.fn().mockResolvedValue(undefined),
    isMutating: vi.fn().mockReturnValue(false)
  }
  return { ...value, ...overrides }
}

const defaultFriends = [
  {
    id: 'friend-1',
    fullName: 'Jamie Keeper',
    username: 'jamie',
    avatarUrl: null,
    role: 'coach',
    baseLocation: 'London',
    currentClub: 'HOCKIA FC'
  },
  {
    id: 'friend-2',
    fullName: 'Riley Captain',
    username: 'riley',
    avatarUrl: null,
    role: 'player',
    baseLocation: 'Paris',
    currentClub: 'Legends United'
  }
]

const user = userEvent.setup()

describe('Trusted references flow', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('lets a player send a trusted reference request', async () => {
    const requestReference = vi.fn().mockResolvedValue(true)
    mockUseTrustedReferences.mockReturnValue(
      createHookState({ requestReference, acceptedCount: 0, acceptedReferences: [] })
    )

    renderSection('player')

    await user.click(screen.getByRole('button', { name: /add reference/i }))

    // Open the searchable dropdown and select a friend
    await user.click(screen.getByText('Search connections...'))
    await user.click(screen.getByText('Riley Captain'))

    // Select relationship type (no longer pre-selected)
    await user.selectOptions(screen.getByRole('combobox'), 'Teammate')

    await user.click(screen.getByRole('button', { name: /send request/i }))

    await waitFor(() => {
      expect(requestReference).toHaveBeenCalledWith({
        referenceId: 'friend-2',
        relationshipType: 'Teammate',
        requestNote: null
      })
    })
  })

  it('enables owners to approve or decline incoming requests', async () => {
    const respondToRequest = vi.fn().mockResolvedValue(true)
    const incoming: IncomingReferenceRequest = {
      id: 'req-1',
      relationshipType: 'Head Coach',
      requestNote: 'Can you vouch for me?',
      createdAt: new Date('2024-05-01').toISOString(),
      requesterProfile: {
        id: 'friend-3',
        fullName: 'Morgan Midfielder',
        role: 'player',
        username: 'mid',
        avatarUrl: null,
        baseLocation: null,
        position: null,
        currentClub: null,
        nationalityCountryId: null,
        nationality2CountryId: null
      }
    }

    mockUseTrustedReferences.mockReturnValue(
      createHookState({ incomingRequests: [incoming], respondToRequest })
    )

    renderSection('player')

    await user.click(screen.getByRole('button', { name: /accept & endorse/i }))
    await user.click(screen.getByText('Confirm endorsement'))

    await waitFor(() => {
      expect(respondToRequest).toHaveBeenCalledWith({
        referenceId: 'req-1',
        accept: true,
        endorsement: 'Rock solid leader'
      })
    })

    await user.click(screen.getByRole('button', { name: /decline/i }))
    await waitFor(() => {
      expect(respondToRequest).toHaveBeenCalledWith({
        referenceId: 'req-1',
        accept: false
      })
    })
  })

  it('shows accepted references to public viewers', () => {
    const acceptedReference: ReferenceCard = {
      id: 'ref-9',
      relationshipType: 'Assistant Coach',
      requestNote: null,
      endorsementText: 'Elite mentality',
      status: 'accepted',
      createdAt: new Date('2024-04-01').toISOString(),
      respondedAt: new Date('2024-04-03').toISOString(),
      acceptedAt: new Date('2024-04-03').toISOString(),
      profile: {
        id: 'friend-4',
        fullName: 'Taylor Wing',
        role: 'coach',
        username: 'wingy',
        avatarUrl: null,
        baseLocation: 'Rome',
        position: null,
        currentClub: 'Roma United',
        nationalityCountryId: null,
        nationality2CountryId: null
      }
    }

    mockUseTrustedReferences.mockReturnValue(
      createHookState({
        isOwner: false,
        canAddMore: false,
        acceptedReferences: [acceptedReference],
        acceptedCount: 1
      })
    )

    renderSection('player', [])

    expect(screen.getByText(/key people who vouch for this profile/i)).toBeInTheDocument()
    expect(screen.getByText('Taylor Wing')).toBeInTheDocument()
    const messageButtons = screen.getAllByRole('button', { name: /^message$/i })
    expect(messageButtons.length).toBeGreaterThan(0)
  })
})
