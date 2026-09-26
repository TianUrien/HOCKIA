/**
 * One Escape closes exactly one overlay layer. Every trapped overlay checks
 * isTopFocusTrap() before acting on Escape, so a dialog opened over another
 * dialog closes alone (follow-up to Sentry JAVASCRIPT-REACT-9B).
 */
import { useState } from 'react'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Modal from '@/components/Modal'
import ConfirmDialog from '@/components/ConfirmDialog'
import ImagePreviewModal from '@/components/ImagePreviewModal'

beforeEach(() => {
  // jsdom has no layout; make buttons count as visible for the trap.
  vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockReturnValue(document.body)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function ModalWithConfirm({ onModalClose, onConfirmClose }: { onModalClose: () => void; onConfirmClose: () => void }) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  return (
    <>
      <Modal isOpen onClose={onModalClose}>
        <button type="button" onClick={() => setConfirmOpen(true)}>
          Delete
        </button>
      </Modal>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => {
          onConfirmClose()
          setConfirmOpen(false)
        }}
        onConfirm={() => {}}
        title="Delete it?"
        message="This cannot be undone."
      />
    </>
  )
}

describe('Escape closes one layer', () => {
  it('ConfirmDialog over a Modal: first Escape closes the confirm, second the modal', () => {
    const onModalClose = vi.fn()
    const onConfirmClose = vi.fn()
    render(<ModalWithConfirm onModalClose={onModalClose} onConfirmClose={onConfirmClose} />)

    const trigger = screen.getByText('Delete') as HTMLButtonElement
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByText('Delete it?')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onConfirmClose).toHaveBeenCalledTimes(1)
    expect(onModalClose).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete it?')).toBeNull()
    // Focus is back on the trigger inside the modal.
    expect(document.activeElement).toBe(screen.getByText('Delete'))

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onModalClose).toHaveBeenCalledTimes(1)
    expect(onConfirmClose).toHaveBeenCalledTimes(1)
  })

  it('ImagePreviewModal over a ConfirmDialog: Escape closes only the image preview', () => {
    const onConfirmClose = vi.fn()
    const onPreviewClose = vi.fn()
    const { rerender } = render(
      <>
        <ConfirmDialog isOpen onClose={onConfirmClose} onConfirm={() => {}} title="Use this photo?" message="m" />
        <ImagePreviewModal isOpen={false} onClose={onPreviewClose} src="https://example.com/a.jpg" />
      </>,
    )
    rerender(
      <>
        <ConfirmDialog isOpen onClose={onConfirmClose} onConfirm={() => {}} title="Use this photo?" message="m" />
        <ImagePreviewModal isOpen onClose={onPreviewClose} src="https://example.com/a.jpg" />
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onPreviewClose).toHaveBeenCalledTimes(1)
    expect(onConfirmClose).not.toHaveBeenCalled()
  })
})
