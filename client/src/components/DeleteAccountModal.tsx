import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X, AlertTriangle, Loader2 } from 'lucide-react'
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../lib/supabase'
import { logger } from '../lib/logger'
import { useAuthStore } from '../lib/auth'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { clearAllProfileDraftsForUser } from '@/lib/profileDrafts'
import { Trans } from 'react-i18next'
import { useSettingsT } from '@/i18n/ns/settings'

interface DeleteAccountModalProps {
  isOpen: boolean
  onClose: () => void
  userEmail: string
}

export default function DeleteAccountModal({ isOpen, onClose, userEmail }: DeleteAccountModalProps) {
  const t = useSettingsT()
  const { signOut, profile } = useAuthStore()
  const [confirmText, setConfirmText] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()
  const confirmationFieldId = useId()

  const handleClose = useCallback(() => {
    if (isDeleting) {
      return
    }
    setConfirmText('')
    setError(null)
    onClose()
  }, [isDeleting, onClose])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: inputRef })

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (event.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, isOpen])

  if (!isOpen) return null

  // The word to type is in the catalog ("DELETE" in English).
  const confirmWord = t('deleteAccount.confirmWord')
  const isConfirmed = confirmText.toUpperCase() === confirmWord.toUpperCase()

  const handleDelete = async () => {
    if (!isConfirmed) return

    setIsDeleting(true)
    setError(null)

    try {
      // Refresh session to get a fresh access token
      const { data: { session }, error: refreshError } = await supabase.auth.refreshSession()

      if (refreshError || !session) {
        throw new Error(t('deleteAccount.errors.noSession'))
      }

      // Call the delete-account edge function with fresh token
      // apikey header is required by the Supabase gateway to identify the project
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/delete-account`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
            'apikey': SUPABASE_ANON_KEY,
          },
        }
      )

      let result: Record<string, unknown>
      try {
        result = await response.json()
      } catch {
        throw new Error(t('deleteAccount.errors.server', { status: response.status }))
      }

      logger.debug('Delete account response:', { status: response.status, result })

      if (!response.ok) {
        const errorMsg = result.error || result.message || result.msg || t('deleteAccount.errors.failedStatus', { status: response.status })
        throw new Error(String(errorMsg))
      }

      // The edge fn returns success:true once the account is actually deleted
      // (both 'complete' and 'partial' — storage-only leftovers are re-queued
      // for async cleanup). Only a genuine failure returns success:false, so
      // trust that field directly. (Do NOT let `status` override it — an error
      // response carrying a status must not read as success.)
      if (result && !result.success) {
        throw new Error(String(result.error || t('deleteAccount.errors.failed')))
      }

      if (profile?.id) {
        clearAllProfileDraftsForUser(profile.id)
      }

      // The account is already deleted server-side. A global sign-out revokes
      // sessions for the now-nonexistent user and can return an error → auth
      // store's signOut throws. That must NOT resurrect a "deletion failed"
      // banner on a successful delete, so swallow it (signOut has already
      // cleared the local session and reported to Sentry) and still redirect.
      try {
        await signOut()
      } catch (signOutError) {
        logger.debug('signOut after account deletion errored (expected for a deleted user)', signOutError)
      }
      
      // Show success message
      const successToast = document.createElement('div')
      successToast.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50'
      successToast.textContent = t('deleteAccount.deleted')
      document.body.appendChild(successToast)
      
      setTimeout(() => {
        successToast.remove()
      }, 3000)

      // Redirect to home
      window.location.href = '/'
      
    } catch (err) {
      logger.error('Error deleting account:', err)
      setError(err instanceof Error ? err.message : t('deleteAccount.errors.failedRetry'))
      setIsDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-xl max-w-md w-full p-6 relative focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {/* Close button */}
        {!isDeleting && (
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label={t('deleteAccount.close')}
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Icon */}
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-6 h-6 text-red-600" />
        </div>

        {/* Title */}
        <h2 id={titleId} className="text-2xl font-bold text-gray-900 text-center mb-2">
          {t('deleteAccount.title')}
        </h2>

        {/* Description */}
        <p id={descriptionId} className="text-gray-600 text-center mb-6">
          <Trans t={t} i18nKey="deleteAccount.body" components={{ strong: <strong /> }} />
        </p>

        {/* Warning box */}
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-sm text-red-800 font-medium mb-2">
            {t('deleteAccount.loseAccess')}
          </p>
          <ul className="text-sm text-red-700 space-y-1 ml-4">
            <li>{t('deleteAccount.loseProfile')}</li>
            <li>{t('deleteAccount.loseMessages')}</li>
            <li>{t('deleteAccount.loseMedia')}</li>
            <li>{t('deleteAccount.loseApplications')}</li>
            <li>{t('deleteAccount.loseCareer')}</li>
          </ul>
        </div>

        {/* Confirmation input */}
        <div className="mb-6">
          <label htmlFor={confirmationFieldId} className="block text-sm font-medium text-gray-700 mb-2">
            <Trans t={t} i18nKey="deleteAccount.typeToConfirm" values={{ word: confirmWord }} components={{ word: <span className="font-bold text-red-600" /> }} />
          </label>
          <input
            ref={inputRef}
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={t('deleteAccount.placeholder', { word: confirmWord })}
            disabled={isDeleting}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-red-500 focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            autoComplete="off"
            id={confirmationFieldId}
          />
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('deleteAccount.cancel')}
          </button>
          <button
            onClick={handleDelete}
            disabled={!isConfirmed || isDeleting}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {t('deleteAccount.deleting')}
              </>
            ) : (
              t('deleteAccount.confirm')
            )}
          </button>
        </div>

        {/* Additional info */}
        <p className="text-xs text-gray-500 text-center mt-4">
          <Trans t={t} i18nKey="deleteAccount.signedInAs" values={{ email: userEmail }} components={{ email: <span className="font-medium" /> }} />
        </p>
      </div>
    </div>
  )
}
