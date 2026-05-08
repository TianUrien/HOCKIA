import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import CommentsTab from '@/components/CommentsTab'

const user = userEvent.setup()
const baseProfileId = 'profile-123'

const toastMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}))

vi.mock('@/lib/toast', () => ({
  useToastStore: () => toastMocks,
}))

const authState = vi.hoisted(() => ({
  profile: { id: 'viewer-42', full_name: 'Alex Viewer', username: 'alex' },
  user: { id: 'viewer-42' },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: () => authState,
}))

vi.mock('@/components/Avatar', () => ({
  default: ({ initials }: { initials?: string }) => <span>{initials ?? 'AU'}</span>,
}))

vi.mock('@/components/RoleBadge', () => ({
  default: ({ role }: { role?: string | null }) => (role ? <span>{role}</span> : null),
}))

vi.mock('@/components/ConfirmActionModal', () => ({
  default: ({ isOpen, onConfirm, onClose, confirmLabel }: { isOpen: boolean; onConfirm: () => void; onClose: () => void; confirmLabel?: string }) => {
    if (!isOpen) return null
    return (
      <div data-testid="confirm-modal">
        <button type="button" onClick={onConfirm}>
          {confirmLabel ?? 'Confirm'}
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    )
  },
}))

type CommentRecord = {
  id: string
  profile_id: string
  author_profile_id: string | null
  content: string
  rating: 'positive' | 'neutral' | 'negative' | null
  status: string
  created_at: string
  updated_at: string
  author: {
    id: string
    full_name: string | null
    username: string | null
    avatar_url: string | null
    role: string | null
  } | null
}

const supabaseState = vi.hoisted(() => ({
  commentsFetchResult: { data: [] as CommentRecord[], error: null as Error | null },
  friendEdgesResult: { data: [] as Array<{ friend_id: string | null }>, error: null as Error | null },
  insertResult: { data: null as CommentRecord | null, error: null as Error | null },
  updateResult: { data: null as CommentRecord | null, error: null as Error | null },
  deleteResult: { data: null as { id: string } | null, error: null as Error | null },
  lastInsertPayload: null as Record<string, unknown> | null,
  lastUpdatePayload: null as Record<string, unknown> | null,
  updateEqArgs: null as [string, unknown] | null,
  deleteEqArgs: null as [string, unknown] | null,
}))

vi.mock('@/lib/supabase', () => {
  const createSelectBuilder = <T,>(resultFactory: () => { data: T; error: Error | null }) => {
    const resultPromise = Promise.resolve(resultFactory())
    const builder: Record<string, unknown> = {}
    builder.eq = () => builder
    builder.order = () => builder
    builder.then = (onFulfilled: (value: { data: T; error: Error | null }) => unknown, onRejected?: (reason: unknown) => unknown) =>
      resultPromise.then(onFulfilled, onRejected)
    builder.catch = (onRejected: (reason: unknown) => unknown) => resultPromise.catch(onRejected)
    builder.finally = (onFinally: () => void) => resultPromise.finally(onFinally)
    return builder
  }

  const profileCommentsTable = {
    select: () => createSelectBuilder(() => supabaseState.commentsFetchResult),
    insert: (payload: Record<string, unknown>) => {
      supabaseState.lastInsertPayload = payload
      return {
        select: () => ({
          single: () => Promise.resolve(supabaseState.insertResult),
        }),
      }
    },
    update: (payload: Record<string, unknown>) => {
      supabaseState.lastUpdatePayload = payload
      return {
        eq: (column: string, value: unknown) => {
          supabaseState.updateEqArgs = [column, value]
          return {
            select: () => ({
              single: () => Promise.resolve(supabaseState.updateResult),
            }),
          }
        },
      }
    },
    delete: () => ({
      eq: (column: string, value: unknown) => {
        supabaseState.deleteEqArgs = [column, value]
        return {
          select: () => ({
            maybeSingle: () => Promise.resolve(supabaseState.deleteResult),
          }),
        }
      },
    }),
  }

  const profileFriendEdgesTable = {
    select: () => createSelectBuilder(() => supabaseState.friendEdgesResult),
  }

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'profile_comments') return profileCommentsTable
        if (table === 'profile_friend_edges') return profileFriendEdgesTable
        return profileCommentsTable
      },
    },
  }
})

const buildComment = (overrides: Partial<CommentRecord> = {}): CommentRecord => {
  const base: CommentRecord = {
    id: 'comment-1',
    profile_id: baseProfileId,
    author_profile_id: 'viewer-42',
    content: 'Dependable teammate with great vision.',
    rating: 'positive',
    status: 'visible',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    author: {
      id: 'viewer-42',
      full_name: 'Alex Viewer',
      username: 'alex',
      avatar_url: null,
      role: 'player',
    },
  }

  return {
    ...base,
    ...overrides,
    author: overrides.author === undefined ? base.author : overrides.author,
  }
}

const renderCommentsTab = (props: Partial<React.ComponentProps<typeof CommentsTab>> = {}) =>
  render(<CommentsTab profileId={baseProfileId} {...props} />)

beforeEach(() => {
  vi.clearAllMocks()
  toastMocks.addToast.mockReset()
  authState.profile = { id: 'viewer-42', full_name: 'Alex Viewer', username: 'alex' }
  authState.user = { id: 'viewer-42' }
  supabaseState.commentsFetchResult = { data: [], error: null }
  supabaseState.friendEdgesResult = { data: [], error: null }
  supabaseState.insertResult = { data: null, error: null }
  supabaseState.updateResult = { data: null, error: null }
  supabaseState.deleteResult = { data: null, error: null }
  supabaseState.lastInsertPayload = null
  supabaseState.lastUpdatePayload = null
  supabaseState.updateEqArgs = null
  supabaseState.deleteEqArgs = null
})

describe('CommentsTab', () => {
  it('allows visitors to post a new comment', async () => {
    const createdComment = buildComment({
      id: 'comment-new',
      content: 'Great teammate and communicator.',
    })

    supabaseState.insertResult = { data: createdComment, error: null }

    renderCommentsTab()

    const textarea = await screen.findByLabelText('Comment')
    await user.type(textarea, 'Great teammate and communicator.')
    await user.click(screen.getByRole('radio', { name: /positive/i }))
    await user.click(screen.getByRole('button', { name: /post comment/i }))

    await waitFor(() => {
      expect(toastMocks.addToast).toHaveBeenCalledWith('Thanks for sharing feedback!', 'success')
    })

    expect(await screen.findByText('Great teammate and communicator.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post comment/i })).not.toBeInTheDocument()
    expect(supabaseState.lastInsertPayload).toMatchObject({
      profile_id: baseProfileId,
      author_profile_id: 'viewer-42',
      rating: 'positive',
    })
  })

  it('prevents users from commenting on their own profile', async () => {
    authState.profile = { id: baseProfileId, full_name: 'Self User', username: 'self' }
    authState.user = { id: baseProfileId }

    renderCommentsTab()

    expect(
      await screen.findByText(/You can't leave a comment on your own profile, but other members can/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post comment/i })).not.toBeInTheDocument()
  })

  // ── Viewer-state contract for the Network View v0 visitor scroll ─
  // The Comments section is now rendered inline at the bottom of every
  // visitor's player profile (no longer behind a tab). Locking down the
  // three viewer states so a future PR can't leak owner-only copy to
  // recruiter-side viewers (the case Batch 9 staging QA flagged).

  it('shows the comment composer to an authenticated visitor (NOT the owner copy)', async () => {
    // Different account viewing baseProfileId — the most common visitor
    // case (recruiter viewing a player profile).
    authState.profile = { id: 'visitor-99', full_name: 'Recruiter', username: 'recruiter' }
    authState.user = { id: 'visitor-99' }

    renderCommentsTab()

    // Composer renders.
    expect(await screen.findByRole('button', { name: /post comment/i })).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/./)).toBeInTheDocument() // any composer placeholder
    // Owner-only copy must NOT appear.
    expect(screen.queryByText(/You can't leave a comment on your own/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /ask for feedback/i })).not.toBeInTheDocument()
    // Anonymous-visitor sign-in prompt must NOT appear either.
    expect(screen.queryByText(/Sign in with a HOCKIA profile/i)).not.toBeInTheDocument()
  })

  it('shows the sign-in prompt to an anonymous visitor (no auth)', async () => {
    authState.profile = null as unknown as typeof authState.profile
    authState.user = null as unknown as typeof authState.user

    renderCommentsTab()

    // Anonymous visitor sees the sign-in prompt, not the composer or owner copy.
    expect(
      await screen.findByText(/Sign in with a HOCKIA profile to leave a public, attributed comment/i)
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /post comment/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/You can't leave a comment on your own/i)).not.toBeInTheDocument()
  })

  it('saves edits to an existing comment', async () => {
    const existingComment = buildComment()
    supabaseState.commentsFetchResult = { data: [existingComment], error: null }
    supabaseState.updateResult = {
      data: { ...existingComment, content: 'Updated view on leadership.', rating: 'neutral' },
      error: null,
    }

    renderCommentsTab()

    expect(await screen.findByText(existingComment.content)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /edit/i }))

    const editField = await screen.findByLabelText(/edit comment/i)
    await user.clear(editField)
    await user.type(editField, 'Updated view on leadership.')
    await user.click(screen.getByRole('radio', { name: /neutral/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(toastMocks.addToast).toHaveBeenCalledWith('Your comment was updated.', 'success')
    })

    expect(supabaseState.lastUpdatePayload).toEqual(
      expect.objectContaining({ content: 'Updated view on leadership.', rating: 'neutral', status: 'visible' })
    )
    expect(supabaseState.updateEqArgs).toEqual(['id', existingComment.id])
    expect(await screen.findByText('Updated view on leadership.')).toBeInTheDocument()
  })

  it('deletes the current comment after confirmation', async () => {
    const existingComment = buildComment()
    supabaseState.commentsFetchResult = { data: [existingComment], error: null }
    supabaseState.deleteResult = { data: { id: existingComment.id }, error: null }

    renderCommentsTab()

    await screen.findByText(existingComment.content)
    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    const confirmModal = await screen.findByTestId('confirm-modal')
    await user.click(within(confirmModal).getByRole('button', { name: /delete/i }))

    await waitFor(() => {
      expect(toastMocks.addToast).toHaveBeenCalledWith('Comment deleted.', 'success')
    })

    await waitFor(() => {
      expect(screen.getByText('No comments yet')).toBeInTheDocument()
    })

    expect(supabaseState.deleteEqArgs).toEqual(['id', existingComment.id])
  })
})
