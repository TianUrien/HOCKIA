import { useCallback, useEffect, useId, useRef } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import Button from './Button'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { Trans } from 'react-i18next'
import { useClubT } from '@/i18n/ns/club'

interface DeleteVacancyModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  vacancyTitle: string
  isLoading: boolean
  isDraft?: boolean
}

export default function DeleteVacancyModal({
  isOpen,
  onClose,
  onConfirm,
  vacancyTitle,
  isLoading,
  isDraft = false,
}: DeleteVacancyModalProps) {
  const t = useClubT()
  const dialogRef = useRef<HTMLDivElement>(null)
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const handleClose = useCallback(() => {
    if (isLoading) {
      return
    }
    onClose()
  }, [isLoading, onClose])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen, initialFocusRef: confirmButtonRef })

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

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl max-w-md w-full focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-6 h-6 text-red-600" />
            </div>
            <div className="flex-1">
              <h2 id={titleId} className="text-xl font-bold text-gray-900 mb-1">
                {isDraft ? t('deleteOpportunity.titleDraft') : t('deleteOpportunity.title')}
              </h2>
              <p id={descriptionId} className="text-sm text-gray-600">
                {t('deleteOpportunity.subtitle')}
              </p>
            </div>
            <button
              onClick={handleClose}
              disabled={isLoading}
              className="p-1 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
              aria-label={t('deleteOpportunity.closeAria')}
            >
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {isDraft ? (
            <p className="text-sm text-gray-600">
              <Trans t={t} i18nKey="deleteOpportunity.draftBody" values={{ title: vacancyTitle }} components={{ strong: <strong /> }} />
            </p>
          ) : (
            <>
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <p className="text-sm text-red-800 font-medium">
                  {t('deleteOpportunity.warning')}
                </p>
                <ul className="mt-2 text-sm text-red-700 space-y-1 ml-4 list-disc">
                  <li><Trans t={t} i18nKey="deleteOpportunity.listOpportunity" values={{ title: vacancyTitle }} components={{ strong: <strong /> }} /></li>
                  <li>{t('deleteOpportunity.listApplications')}</li>
                  <li>{t('deleteOpportunity.listMedia')}</li>
                </ul>
              </div>

              <p className="text-sm text-gray-600">
                {t('deleteOpportunity.confirmBody')}
              </p>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="p-6 border-t border-gray-200 flex items-center gap-3">
          <Button
            onClick={handleClose}
            disabled={isLoading}
            className="flex-1 bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            {t('deleteOpportunity.cancel')}
          </Button>
          <Button
            ref={confirmButtonRef}
            onClick={onConfirm}
            disabled={isLoading}
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
          >
            {isLoading ? t('deleteOpportunity.deleting') : isDraft ? t('deleteOpportunity.titleDraft') : t('deleteOpportunity.confirm')}
          </Button>
        </div>
      </div>
    </div>
  )
}
