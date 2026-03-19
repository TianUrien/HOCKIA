import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import Button from './Button'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface ConfirmActionModalProps {
  isOpen: boolean
  onConfirm: () => void
  onClose: () => void
  title: string
  description?: string
  confirmLabel: string
  confirmTone?: 'primary' | 'danger'
  confirmLoading?: boolean
  loadingLabel?: string
  icon?: ReactNode
  body?: ReactNode
}

export default function ConfirmActionModal({
  isOpen,
  onConfirm,
  onClose,
  title,
  description,
  confirmLabel,
  confirmTone = 'primary',
  confirmLoading = false,
  loadingLabel = 'Processing...',
  icon,
  body,
}: ConfirmActionModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const handleClose = useCallback(() => {
    if (confirmLoading) return
    onClose()
  }, [confirmLoading, onClose])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: confirmButtonRef })

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, isOpen])

  if (!isOpen) return null

  const confirmStyles = confirmTone === 'danger'
    ? 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-600'
    : 'bg-hockia-primary hover:bg-hockia-primary/90 focus-visible:ring-hockia-primary'

  const iconWrapperStyles = confirmTone === 'danger'
    ? 'bg-red-100 text-red-600'
    : 'bg-gray-100 text-gray-700'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" role="presentation">
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-2xl bg-white shadow-2xl focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="flex items-start gap-3 border-b border-gray-200 p-6">
          {icon && (
            <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${iconWrapperStyles}`}>
              {icon}
            </div>
          )}
          <div className="flex-1">
            <h2 id={titleId} className="text-xl font-semibold text-gray-900">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="mt-1 text-sm text-gray-600">
                {description}
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            disabled={confirmLoading}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {body && (
          <div className="space-y-4 p-6 text-sm text-gray-600">
            {body}
          </div>
        )}

        <div className="flex items-center gap-3 border-t border-gray-200 p-6">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={confirmLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            ref={confirmButtonRef}
            onClick={onConfirm}
            disabled={confirmLoading}
            className={`flex-1 text-white focus-visible:ring-2 focus-visible:ring-offset-2 ${confirmStyles}`}
          >
            {confirmLoading ? loadingLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
