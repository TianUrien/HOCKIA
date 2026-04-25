/**
 * VerifyProfileDialog
 *
 * Admin-facing grant/revoke dialog for the profile verified badge.
 *
 * Research memo framing: verification is admin-checked against a federation's
 * public panel listing. This dialog captures that provenance — the source URL
 * the admin checked and optional notes — so the audit trail three months later
 * still explains WHY a profile was verified, not just that it was.
 *
 * Distinct from the generic ConfirmDialog because verify is a form, not a
 * confirm: source URL is required when granting the badge.
 */

import { useEffect, useState } from 'react'
import { BadgeCheck, ShieldOff, X } from 'lucide-react'
import { logger } from '@/lib/logger'

export interface VerifyMetadata {
  sourceUrl: string | null
  notes: string | null
}

interface VerifyProfileDialogProps {
  isOpen: boolean
  mode: 'verify' | 'unverify'
  profileName: string
  onClose: () => void
  onConfirm: (meta: VerifyMetadata) => void | Promise<void>
}

const isLikelyUrl = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    const u = new URL(trimmed)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function VerifyProfileDialog({
  isOpen,
  mode,
  profileName,
  onClose,
  onConfirm,
}: VerifyProfileDialogProps) {
  const [sourceUrl, setSourceUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset form whenever the dialog re-opens — avoids leaking state across
  // different profiles the admin acts on in the same session.
  useEffect(() => {
    if (isOpen) {
      setSourceUrl('')
      setNotes('')
      setIsSubmitting(false)
    }
  }, [isOpen])

  if (!isOpen) return null

  const isVerify = mode === 'verify'
  const requiresSource = isVerify
  const sourceUrlValid = !requiresSource || isLikelyUrl(sourceUrl)
  const isConfirmDisabled = isSubmitting || !sourceUrlValid

  const handleConfirm = async () => {
    if (isConfirmDisabled) return
    setIsSubmitting(true)
    try {
      await onConfirm({
        sourceUrl: sourceUrl.trim() || null,
        notes: notes.trim() || null,
      })
      onClose()
    } catch (error) {
      logger.error('[VerifyProfileDialog] confirm failed:', error)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleClose = () => {
    if (!isSubmitting) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full p-6">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={isSubmitting}
            aria-label="Close dialog"
            title="Close"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          <div className="flex justify-center mb-4">
            <div
              className={`p-3 rounded-full ${isVerify ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}
            >
              {isVerify ? <BadgeCheck className="w-6 h-6" /> : <ShieldOff className="w-6 h-6" />}
            </div>
          </div>

          <h3 className="text-lg font-semibold text-gray-900 text-center mb-1">
            {isVerify ? 'Grant Verified badge' : 'Remove Verified badge'}
          </h3>
          <p className="text-sm text-gray-600 text-center mb-5">
            <span className="font-medium text-gray-900">{profileName}</span>
          </p>

          {isVerify && (
            <div className="mb-4">
              <label htmlFor="verify-source-url" className="block text-sm font-medium text-gray-700 mb-1">
                Source URL <span className="text-red-500">*</span>
              </label>
              <input
                id="verify-source-url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="https://federation.example/panels/umpires"
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={isSubmitting}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-1">
                Link to the federation panel, credential, or record you checked.
              </p>
            </div>
          )}

          <div className="mb-6">
            <label htmlFor="verify-notes" className="block text-sm font-medium text-gray-700 mb-1">
              Notes <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="verify-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isVerify
                  ? 'Anything worth recording — e.g., verified level matches FIH Panel listing.'
                  : 'Why is this verification being revoked? (helpful for future admins)'
              }
              rows={3}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
              disabled={isSubmitting}
            />
          </div>

          <p className="text-xs text-gray-500 mb-4 text-center">
            Action is written to admin_audit_logs with the details above.
          </p>

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
              className={`flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                isVerify
                  ? 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                  : 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500'
              }`}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Processing...
                </span>
              ) : isVerify ? (
                'Grant Verified'
              ) : (
                'Remove Verification'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
