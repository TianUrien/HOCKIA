import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import PublicReferencesSection from '@/components/PublicReferencesSection'

const user = userEvent.setup()

const navigateMock = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}))

const toastMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => toastMocks,
}))

const authState = vi.hoisted(() => ({
  user: { id: 'viewer-1' } as { id: string } | null,
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

const trustedReferencesState = vi.hoisted(() => ({
  value: {
    acceptedReferences: [] as Array<{
      id: string
      relationshipType: string
      endorsementText: string | null
      profile: {
        id: string | null
        fullName: string | null
        role: string | null
        avatarUrl: string | null
      } | null
    }>,
    loading: false,
  },
}))

vi.mock('@/hooks/useTrustedReferences', () => ({
  useTrustedReferences: () => trustedReferencesState.value,
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => <span>{initials ?? 'PR'}</span>,
}))

vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role?: string | null }) => (role ? <span>{role}</span> : null),
}))

const supabaseState = vi.hoisted(() => ({
  maybeSingleResult: { data: null as { id: string } | null, error: null as Error | null },
  lastTable: '',
  lastOrClause: '',
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      supabaseState.lastTable = table
      if (table !== 'conversations') {
        return { select: () => ({}) }
      }

      return {
        select: () => ({
          or: (clause: string) => {
            supabaseState.lastOrClause = clause
            return {
              maybeSingle: () => Promise.resolve(supabaseState.maybeSingleResult),
            }
          },
        }),
      }
    },
  },
}))

const baseReference = {
  id: 'reference-1',
  relationshipType: 'Coach',
  endorsementText: 'High work ethic.',
  profile: {
    id: 'coach-9',
    fullName: 'Coach Carla',
    role: 'coach',
    avatarUrl: null,
  },
}

const renderSection = (props: Partial<React.ComponentProps<typeof PublicReferencesSection>> = {}) =>
  render(<PublicReferencesSection profileId="profile-1" profileName="Jamie Lee" {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  navigateMock.mockReset()
  toastMocks.addToast.mockReset()
  authState.user = { id: 'viewer-1' }
  trustedReferencesState.value = { acceptedReferences: [], loading: false }
  supabaseState.maybeSingleResult = { data: null, error: null }
  supabaseState.lastOrClause = ''
  supabaseState.lastTable = ''
})

describe('PublicReferencesSection', () => {
  it('shows the empty state when there are no references', () => {
    renderSection()

    // Phase 4 References UX Plan #2.2 — empty-state rewrite. Header line
    // is "No vouches yet" + an educational subline that teaches what
    // trust references are on HOCKIA. Visitor walks away with a clearer
    // mental model even when the profile has no references.
    expect(screen.getByText('No vouches yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Jamie hasn't received any trusted references yet/),
    ).toBeInTheDocument()
  })

  it('requires sign-in before messaging a reference', async () => {
    trustedReferencesState.value = {
      acceptedReferences: [baseReference],
      loading: false,
    }
    authState.user = null

    renderSection()

    expect(await screen.findByText(/High work ethic/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /message/i }))

    await waitFor(() => {
        expect(toastMocks.addToast).toHaveBeenCalledWith('Sign in to message HOCKIA members.', 'info')
        expect(navigateMock).toHaveBeenCalledWith('/')
    })
    expect(supabaseState.lastTable).toBe('')
  })

  it('navigates to an existing conversation when a reference has prior messages', async () => {
    trustedReferencesState.value = {
      acceptedReferences: [baseReference],
      loading: false,
    }
    supabaseState.maybeSingleResult = { data: { id: 'conversation-7' }, error: null }

    renderSection()
    await user.click(await screen.findByRole('button', { name: /message/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/messages?conversation=conversation-7')
    })
    expect(supabaseState.lastTable).toBe('conversations')
    expect(supabaseState.lastOrClause).toContain('participant_one_id.eq.viewer-1')
    expect(supabaseState.lastOrClause).toContain('participant_two_id.eq.coach-9')
  })

  it('starts a new conversation when none exists', async () => {
    trustedReferencesState.value = {
      acceptedReferences: [baseReference],
      loading: false,
    }
    supabaseState.maybeSingleResult = { data: null, error: null }

    renderSection()
    await user.click(await screen.findByRole('button', { name: /message/i }))

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith('/messages?new=coach-9')
    })
  })
})
