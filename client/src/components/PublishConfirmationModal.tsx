import { useEffect, useRef, useCallback } from 'react'
import { X, CheckCircle, AlertCircle } from 'lucide-react'
import Button from './Button'
import { useFocusTrap } from '@/hooks/useFocusTrap'

interface PublishConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  vacancyTitle: string
  isLoading?: boolean
}

export default function PublishConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  vacancyTitle,
  isLoading = false,
}: PublishConfirmationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)

  const handleClose = useCallback(() => {
    if (isLoading) {
      return
    }
    onClose()
  }, [isLoading, onClose])

  const handleConfirm = useCallback(() => {
    if (isLoading) {
      return
    }
    onConfirm()
  }, [isLoading, onConfirm])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: confirmButtonRef })

  useEffect(() => {
    if (!isOpen) {
      return
    }

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 animate-fade-in"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="publish-confirmation-title"
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full animate-scale-in"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-6 pb-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div className="flex-1">
              <h2 id="publish-confirmation-title" className="text-xl font-bold text-gray-900 mb-1">
                Ready to Publish?
              </h2>
              <p className="text-sm text-gray-600">
                Make this opportunity visible to candidates
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={handleClose}
            disabled={isLoading}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50 flex-shrink-0"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 pb-2">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 text-sm mb-1">
                  Before you publish:
                </h3>
                <ul className="text-sm text-amber-800 space-y-1">
                  <li>• This opportunity will be visible to candidates globally</li>
                  <li>• Candidates will be able to apply immediately</li>
                  <li>• You can edit or close it anytime after publishing</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <p className="text-sm text-gray-600 mb-1">Publishing opportunity:</p>
            <p className="font-semibold text-gray-900">{vacancyTitle}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3 p-6 pt-4">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="flex-1 px-4 py-3 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <Button
            ref={confirmButtonRef}
            onClick={handleConfirm}
            disabled={isLoading}
            className="flex-1 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold shadow-lg shadow-green-500/30"
          >
            {isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Publishing...
              </span>
            ) : (
              'Publish Now'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
