/**
 * ConfirmDialog Component
 * 
 * Modal dialog for confirming destructive actions.
 */

import { useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { logger } from '@/lib/logger'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  message: string
  confirmLabel?: string
  confirmText?: string // Text user must type to confirm (for destructive actions)
  variant?: 'danger' | 'warning' | 'default'
  loading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  confirmText,
  variant = 'default',
  loading = false,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleConfirm = async () => {
    if (confirmText && inputValue !== confirmText) return

    setIsSubmitting(true)
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      logger.error('Confirm action failed:', error)
    } finally {
      setIsSubmitting(false)
      setInputValue('')
    }
  }

  const handleClose = () => {
    if (!isSubmitting) {
      setInputValue('')
      onClose()
    }
  }

  if (!isOpen) return null

  const isConfirmDisabled =
    loading || isSubmitting || (confirmText ? inputValue !== confirmText : false)

  const buttonColors = {
    danger: 'bg-red-600 hover:bg-red-700 focus-visible:ring-red-500',
    warning: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500',
    default: 'bg-purple-600 hover:bg-purple-700 focus-visible:ring-purple-500',
  }

  const iconColors = {
    danger: 'text-red-600 bg-red-50',
    warning: 'text-amber-600 bg-amber-50',
    default: 'text-purple-600 bg-purple-50',
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      />

      {/* Dialog */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          {/* Close button */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={isSubmitting}
            aria-label="Close dialog"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          {/* Icon */}
          <div className="flex justify-center mb-4">
            <div className={`p-3 rounded-full ${iconColors[variant]}`}>
              <AlertTriangle className="w-6 h-6" />
            </div>
          </div>

          {/* Content */}
          <h3 className="text-lg font-semibold text-gray-900 text-center mb-2">
            {title}
          </h3>
          <p className="text-sm text-gray-600 text-center mb-6">{message}</p>

          {/* Confirmation input */}
          {confirmText && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Type <span className="font-mono bg-gray-100 px-1 rounded">{confirmText}</span> to
                confirm
              </label>
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                placeholder={confirmText}
                disabled={isSubmitting}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={isConfirmDisabled}
              className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${buttonColors[variant]}`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </span>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
