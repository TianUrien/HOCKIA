import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, afterEach, beforeEach } from 'vitest'
import RequestFeedbackModal from '@/components/RequestFeedbackModal'

const PROFILE_URL = 'https://inhockia.com/players/alex'
const OWNER_NAME = 'Alex Morgan'

describe('RequestFeedbackModal', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders nothing when closed', () => {
    render(
      <RequestFeedbackModal
        isOpen={false}
        onClose={vi.fn()}
        profileUrl={PROFILE_URL}
        ownerName={OWNER_NAME}
      />
    )
    expect(screen.queryByText(/Ask for feedback/i)).not.toBeInTheDocument()
  })

  it('renders title, context blurb, textarea, and the three action buttons when open', () => {
    render(
      <RequestFeedbackModal
        isOpen
        onClose={vi.fn()}
        profileUrl={PROFILE_URL}
        ownerName={OWNER_NAME}
      />
    )

    expect(screen.getByRole('heading', { name: /ask for feedback/i })).toBeInTheDocument()
    expect(screen.getByText(/send this to a teammate/i)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /message template/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy message/i })).toBeInTheDocument()
    // Share button label varies by navigator.share support — check both spellings.
    expect(
      screen.getByRole('button', { name: /share/i })
    ).toBeInTheDocument()
  })

  it('pre-populates the message with the first name from ownerName and includes the profile URL', () => {
    render(
      <RequestFeedbackModal
        isOpen
        onClose={vi.fn()}
        profileUrl={PROFILE_URL}
        ownerName={OWNER_NAME}
      />
    )

    const textarea = screen.getByRole('textbox', { name: /message template/i }) as HTMLTextAreaElement
    expect(textarea.value).toContain('Alex here')
    expect(textarea.value).toContain(PROFILE_URL)
  })

  it('falls back to a generic greeting when ownerName is missing', () => {
    render(
      <RequestFeedbackModal
        isOpen
        onClose={vi.fn()}
        profileUrl={PROFILE_URL}
      />
    )

    const textarea = screen.getByRole('textbox', { name: /message template/i }) as HTMLTextAreaElement
    expect(textarea.value.startsWith('Hey! I')).toBe(true)
    expect(textarea.value).not.toContain('here.')
  })

  it('allows the owner to edit the message', () => {
    render(
      <RequestFeedbackModal
        isOpen
        onClose={vi.fn()}
        profileUrl={PROFILE_URL}
        ownerName={OWNER_NAME}
      />
    )

    const textarea = screen.getByRole('textbox', { name: /message template/i }) as HTMLTextAreaElement
    fireEvent.change(textarea, { target: { value: 'Custom message with link' } })
    expect(textarea.value).toBe('Custom message with link')
  })

  it('calls onClose when Cancel is clicked', () => {
    const onClose = vi.fn()
    render(
      <RequestFeedbackModal
        isOpen
        onClose={onClose}
        profileUrl={PROFILE_URL}
        ownerName={OWNER_NAME}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  describe('copy behaviour', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)

    beforeEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      })
      writeText.mockClear()
    })

    it('copies the current textarea content to the clipboard', async () => {
      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      const textarea = screen.getByRole('textbox', { name: /message template/i }) as HTMLTextAreaElement
      const original = textarea.value

      fireEvent.click(screen.getByRole('button', { name: /copy message/i }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(original))
    })

    it('shows a "Copied" confirmation after a successful copy', async () => {
      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /copy message/i }))
      // findBy auto-waits for the post-setState re-render without the flakiness
      // of a raw waitFor + getBy assertion.
      expect(
        await screen.findByRole('button', { name: /^copied$/i })
      ).toBeInTheDocument()
    })

    it('silently swallows a clipboard failure without throwing', async () => {
      const failingWrite = vi.fn().mockRejectedValue(new Error('denied'))
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: failingWrite },
      })

      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      const copyButton = screen.getByRole('button', { name: /copy message/i })
      expect(() => fireEvent.click(copyButton)).not.toThrow()
      await waitFor(() => expect(failingWrite).toHaveBeenCalled())
      // "Copied" state should NOT appear because writeText rejected.
      expect(screen.queryByRole('button', { name: /^copied$/i })).not.toBeInTheDocument()
    })
  })

  describe('share behaviour', () => {
    it('calls navigator.share with title / text / url when the native share API is available', async () => {
      const share = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: share,
      })

      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /^share$/i }))
      await waitFor(() =>
        expect(share).toHaveBeenCalledWith(
          expect.objectContaining({
            title: 'Comment on my Hockia profile',
            url: PROFILE_URL,
            text: expect.stringContaining(PROFILE_URL),
          })
        )
      )

      // Cleanup so other tests aren't affected.
      // @ts-expect-error - resetting a configurable property on navigator
      delete navigator.share
    })

    it('falls back to copying the message when navigator.share is not available', async () => {
      // Ensure navigator.share is undefined.
      if ('share' in navigator) {
        // @ts-expect-error - navigator.share is a declared-but-optional member
        delete navigator.share
      }
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      })

      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      fireEvent.click(screen.getByRole('button', { name: /share \(copy\)/i }))
      await waitFor(() => expect(writeText).toHaveBeenCalled())
    })

    it('does not throw when the user cancels the native share sheet', async () => {
      const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: share,
      })

      render(
        <RequestFeedbackModal
          isOpen
          onClose={vi.fn()}
          profileUrl={PROFILE_URL}
          ownerName={OWNER_NAME}
        />
      )

      const shareButton = screen.getByRole('button', { name: /^share$/i })
      expect(() => fireEvent.click(shareButton)).not.toThrow()
      await waitFor(() => expect(share).toHaveBeenCalled())

      // @ts-expect-error - resetting configurable navigator member
      delete navigator.share
    })
  })
})
