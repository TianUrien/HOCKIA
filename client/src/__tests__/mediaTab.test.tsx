import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import MediaTab from '@/components/MediaTab'

const user = userEvent.setup()

const addToast = vi.fn()
vi.mock('@/lib/toast', () => ({
  useToastStore: () => ({ addToast }),
}))

const profileMocks = vi.hoisted(() => ({
  invalidateProfile: vi.fn(),
}))

vi.mock('@/lib/profile', () => profileMocks)

type AuthStoreState = {
  user: { id: string } | null
  profile: {
    id: string
    role: string
    highlight_video_url: string | null
  } | null
}

const authState: AuthStoreState = {
  user: { id: 'user-1' },
  profile: {
    id: 'user-1',
    role: 'player',
    highlight_video_url: 'https://youtu.be/abc123',
  },
}

const setAuthState = (overrides: Partial<AuthStoreState>) => {
  Object.assign(authState, overrides)
}

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

const galleryManagerProps: Array<Record<string, unknown>> = []
vi.mock('@/components/GalleryManager', () => ({
  default: (props: Record<string, unknown>) => {
    galleryManagerProps.push(props)
    return <div data-testid="gallery-manager" />
  },
}))

vi.mock('@/components/AddVideoLinkModal', () => ({
  default: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="video-modal">Modal</div> : null),
}))

vi.mock('@/components/ConfirmActionModal', () => ({
  default: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => (
    isOpen ? (
      <div data-testid="confirm-modal">
        <button type="button" onClick={onConfirm}>
          Confirm
        </button>
      </div>
    ) : null
  ),
}))

vi.mock('@/components/Skeleton', () => ({
  default: () => <div data-testid="skeleton" />,
}))

const supabaseMocks = vi.hoisted(() => {
  const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
  const mockUpdate = vi.fn(() => ({ eq: mockUpdateEq }))

  return { mockUpdate, mockUpdateEq }
})

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn(),
      update: supabaseMocks.mockUpdate,
    })),
  },
}))

describe('MediaTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    galleryManagerProps.length = 0
    profileMocks.invalidateProfile.mockReset()
    supabaseMocks.mockUpdate.mockReset()
    supabaseMocks.mockUpdateEq.mockReset()
    supabaseMocks.mockUpdateEq.mockResolvedValue({ error: null })
    setAuthState({
      user: { id: 'user-1' },
      profile: {
        id: 'user-1',
        role: 'player',
        highlight_video_url: 'https://youtu.be/abc123',
      },
    })
  })

  it('renders the highlight video and exposes manage controls', async () => {
    const headerRender = vi.fn(() => <div data-testid="header-render" />)

    render(<MediaTab renderHeader={headerRender} />)

    await waitFor(() => {
      expect(headerRender).toHaveBeenCalled()
    })

    // YouTube + Drive now use a click-to-load façade: at rest the video
    // surface is a play button ("Play highlight video"), and the iframe
    // mounts only after the user clicks. So the at-rest assertion targets
    // the façade button rather than the (deferred) iframe title.
    expect(screen.getByLabelText('Play highlight video')).toBeInTheDocument()
    expect(headerRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ canManageVideo: true, openManageModal: expect.any(Function) })
    )
    expect(screen.getByTestId('gallery-manager')).toBeInTheDocument()
  })

  it('shows the add video call-to-action when no highlight exists', async () => {
    setAuthState({
      profile: {
        id: 'user-1',
        role: 'player',
        highlight_video_url: null,
      },
    })

    render(<MediaTab />)

    expect(await screen.findByText('No Highlight Video Yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add video link/i })).toBeInTheDocument()
  })

  it('removes the highlight video when confirmed', async () => {
    render(<MediaTab />)

    const removeButton = await screen.findByRole('button', { name: 'Remove video' })
    await user.click(removeButton)

    const confirmButton = await screen.findByText('Confirm')
    await user.click(confirmButton)

    await waitFor(() => {
      expect(supabaseMocks.mockUpdate).toHaveBeenCalled()
      expect(supabaseMocks.mockUpdateEq).toHaveBeenCalledWith('id', 'user-1')
      expect(profileMocks.invalidateProfile).toHaveBeenCalledWith({ userId: 'user-1', reason: 'highlight-video-removed' })
    })
    expect(addToast).toHaveBeenCalledWith('Highlight video removed.', 'success')
  })
})

describe('MediaTab — highlight visibility toggle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    galleryManagerProps.length = 0
    profileMocks.invalidateProfile.mockReset()
    supabaseMocks.mockUpdate.mockReset()
    supabaseMocks.mockUpdateEq.mockReset()
    supabaseMocks.mockUpdateEq.mockResolvedValue({ error: null })
    supabaseMocks.mockUpdate.mockReturnValue({ eq: supabaseMocks.mockUpdateEq })
    setAuthState({
      user: { id: 'user-1' },
      profile: {
        id: 'user-1',
        role: 'player',
        highlight_video_url: 'https://youtu.be/abc123',
      },
    })
  })

  it('shows the visibility toggle when editing own video', async () => {
    render(<MediaTab highlightVisibility="public" />)

    await waitFor(() => {
      expect(screen.getByLabelText('Play highlight video')).toBeInTheDocument()
    })

    expect(screen.getByLabelText(/recruiters only/i)).toBeInTheDocument()
    expect(screen.getByText('Your highlight video is visible to everyone.')).toBeInTheDocument()
  })

  it('hides the visibility toggle in readOnly mode', async () => {
    render(<MediaTab readOnly highlightVisibility="public" viewerRole="player" isOwnProfile />)

    await waitFor(() => {
      expect(screen.getByLabelText('Play highlight video')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText(/recruiters only/i)).not.toBeInTheDocument()
  })

  it('toggles to recruiters and calls Supabase update', async () => {
    render(<MediaTab highlightVisibility="public" />)

    const checkbox = await screen.findByLabelText(/recruiters only/i)
    expect(checkbox).not.toBeChecked()

    await user.click(checkbox)

    await waitFor(() => {
      expect(supabaseMocks.mockUpdate).toHaveBeenCalledWith({ highlight_visibility: 'recruiters' })
      expect(supabaseMocks.mockUpdateEq).toHaveBeenCalledWith('id', 'user-1')
    })
    expect(profileMocks.invalidateProfile).toHaveBeenCalledWith({
      userId: 'user-1',
      reason: 'highlight-visibility-changed',
    })
    expect(addToast).toHaveBeenCalledWith('Highlight video restricted to recruiters.', 'success')
  })

  it('toggles back to public and shows correct toast', async () => {
    render(<MediaTab highlightVisibility="recruiters" />)

    const checkbox = await screen.findByLabelText(/recruiters only/i)
    expect(checkbox).toBeChecked()

    await user.click(checkbox)

    await waitFor(() => {
      expect(supabaseMocks.mockUpdate).toHaveBeenCalledWith({ highlight_visibility: 'public' })
    })
    expect(addToast).toHaveBeenCalledWith('Highlight video visible to everyone.', 'success')
  })

  it('rolls back on Supabase error and shows error toast', async () => {
    supabaseMocks.mockUpdateEq.mockResolvedValueOnce({ error: { message: 'fail' } })

    render(<MediaTab highlightVisibility="public" />)

    const checkbox = await screen.findByLabelText(/recruiters only/i)
    await user.click(checkbox)

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('Failed to update visibility. Please try again.', 'error')
    })

    // Checkbox should revert to unchecked (public)
    expect(checkbox).not.toBeChecked()
  })

  it('shows restricted state when video is hidden from another player', async () => {
    render(
      <MemoryRouter>
        <MediaTab
          readOnly
          highlightVisibility="recruiters"
          viewerRole="player"
          isOwnProfile={false}
          showGallery={false}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Highlight Video Restricted')).toBeInTheDocument()
    })

    expect(screen.getByText(/only visible to clubs and coaches/i)).toBeInTheDocument()
    // No sign-in prompt since viewer is authenticated
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
  })

  it('shows sign-in prompt for unauthenticated viewers', async () => {
    render(
      <MemoryRouter>
        <MediaTab
          readOnly
          highlightVisibility="recruiters"
          viewerRole={null}
          isOwnProfile={false}
          showGallery={false}
        />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByText('Highlight Video Restricted')).toBeInTheDocument()
    })

    expect(screen.getByText(/sign in/i)).toBeInTheDocument()
  })

  it('shows video to clubs even when restricted', async () => {
    render(
      <MediaTab
        readOnly
        highlightVisibility="recruiters"
        viewerRole="club"
        isOwnProfile={false}
        showGallery={false}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Play highlight video')).toBeInTheDocument()
    })

    expect(screen.queryByText('Highlight Video Restricted')).not.toBeInTheDocument()
  })

  it('shows video to coaches even when restricted', async () => {
    render(
      <MediaTab
        readOnly
        highlightVisibility="recruiters"
        viewerRole="coach"
        isOwnProfile={false}
        showGallery={false}
      />
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Play highlight video')).toBeInTheDocument()
    })

    expect(screen.queryByText('Highlight Video Restricted')).not.toBeInTheDocument()
  })

  it('Network View honours the privacy toggle for the owner — restricted shows when recruiters-only is set', async () => {
    // Behaviour change 2026-05-08: Network View (readOnly && isOwnProfile)
    // used to short-circuit the canViewVideo gate via `if (isOwnProfile)
    // return true`, which meant the owner always saw their own video even
    // when they had set "Recruiters only". That defeated Network View's
    // purpose (preview what a non-recruiter visitor sees) and read as a
    // privacy regression to anyone testing the toggle.
    //
    // Now: Network View falls through to the visibility check. A non-
    // recruiter viewerRole ('player' here) sees the restricted state.
    render(
      <MediaTab
        readOnly
        highlightVisibility="recruiters"
        viewerRole="player"
        isOwnProfile
        showGallery={false}
      />
    )

    await waitFor(() => {
      expect(screen.getByText('Highlight Video Restricted')).toBeInTheDocument()
    })

    expect(screen.queryByTitle('Highlight video player')).not.toBeInTheDocument()
  })
})
