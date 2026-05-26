import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { logger } from '@/lib/logger'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'

/**
 * In-app confirmation dialog for destructive actions. Replaces the
 * ad-hoc `window.confirm` calls scattered across JourneyTab, UserPostCard,
 * OpportunitiesTab (Close), etc. — `window.confirm` is unreliable inside
 * iOS PWAs and some Chrome mobile-emulation contexts, and the styling
 * gives no signal about what's being deleted. This dialog renders in
 * the React tree, traps focus, dims the background, and stays consistent
 * with the rest of the app's modal language.
 *
 * Use the admin `features/admin/components/ConfirmDialog` instead when
 * you need the "type X to confirm" pattern for irreversible admin
 * actions — that variant is heavier and not appropriate for user-side
 * deletes.
 */
interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  /** Body copy. Plain string only — keep it short, this is a dialog. */
  message: string
  /** Label for the destructive action. Defaults to "Confirm". */
  confirmLabel?: string
  cancelLabel?: string
  /** 'danger' is the right default for delete/close — red CTA, alert
   *  icon. 'default' uses the purple accent for non-destructive
   *  confirmations. */
  variant?: 'danger' | 'default'
  testId?: string
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  testId,
}: ConfirmDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen, isSubmitting, onClose])

  if (!isOpen) return null

  const handleConfirm = async () => {
    setIsSubmitting(true)
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      logger.error('ConfirmDialog action failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const buttonColors =
    variant === 'danger'
      ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
      : 'bg-[#8026FA] hover:bg-[#6B20D4] focus:ring-[#8026FA]'
  const iconColors =
    variant === 'danger'
      ? 'text-red-600 bg-red-50'
      : 'text-[#8026FA] bg-[#8026FA]/10'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose()
      }}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-white rounded-2xl shadow-xl max-w-sm w-full p-6"
        data-testid={testId}
      >
        <button
          onClick={onClose}
          disabled={isSubmitting}
          className="absolute top-3 right-3 p-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          aria-label="Close dialog"
          type="button"
        >
          <X className="w-5 h-5 text-gray-500" />
        </button>

        <div className="flex justify-center mb-4">
          <div className={`p-3 rounded-full ${iconColors}`}>
            <AlertTriangle className="w-6 h-6" />
          </div>
        </div>

        <h3
          id="confirm-dialog-title"
          className="text-lg font-semibold text-gray-900 text-center mb-2"
        >
          {title}
        </h3>
        <p className="text-sm text-gray-600 text-center mb-6 leading-relaxed">
          {message}
        </p>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isSubmitting}
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-white rounded-lg transition-colors focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${buttonColors}`}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Working…
              </span>
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
