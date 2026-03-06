import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackApplicationSubmit } from '@/lib/analytics'
import type { Vacancy } from '@/lib/supabase'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { extractErrorMessage } from '@/lib/utils'

interface ApplyToVacancyModalProps {
  isOpen: boolean
  onClose: () => void
  vacancy: Vacancy
  onSuccess: (vacancyId: string) => void
  onError?: (vacancyId: string) => void
}

export default function ApplyToVacancyModal({
  isOpen,
  onClose,
  vacancy,
  onSuccess,
  onError,
}: ApplyToVacancyModalProps) {
  const { user, profile } = useAuthStore()
  const { addToast } = useToastStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  const handleClose = useCallback(() => {
    if (isSubmitting) return
    onClose()
    setError(null)
  }, [isSubmitting, onClose])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen })

  useEffect(() => {
    if (!isOpen) return

    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [handleClose, isOpen])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isSubmitting) return

    if (!user) {
      setError('You must be signed in to apply.')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'vacancies.apply',
        data: { vacancyId: vacancy.id },
        level: 'info'
      })
      const { error: insertError } = await supabase
        .from('opportunity_applications')
        .insert({
          opportunity_id: vacancy.id,
          applicant_id: user.id,
          status: 'pending',
        } as never)

      if (insertError) {
        if (insertError.code === '23505') {
          onSuccess(vacancy.id)
          onClose()
          addToast('You have already applied to this opportunity.', 'info')
        } else if (insertError.code === '42501' || insertError.message?.includes('row-level security')) {
          logger.error('Role mismatch - RLS policy blocked application:', insertError)
          reportSupabaseError('vacancies.apply_rls_block', insertError, {
            vacancyId: vacancy.id,
            viewerRole: profile?.role ?? null
          }, {
            feature: 'vacancies',
            operation: 'apply_vacancy'
          })
          onError?.(vacancy.id)

          if (vacancy.opportunity_type === 'coach') {
            addToast('Only coaches can apply to coach opportunities.', 'error')
          } else if (vacancy.opportunity_type === 'player') {
            addToast('Only players can apply to player opportunities.', 'error')
          } else {
            addToast('You cannot apply to this opportunity due to role restrictions.', 'error')
          }
        } else {
          logger.error('Error applying to vacancy:', insertError)
          reportSupabaseError('vacancies.apply_error', insertError, {
            vacancyId: vacancy.id,
            viewerRole: profile?.role ?? null
          }, {
            feature: 'vacancies',
            operation: 'apply_vacancy'
          })
          onError?.(vacancy.id)
          const msg = extractErrorMessage(insertError, 'Failed to submit application. Please try again.')
          setError(msg)
          addToast(msg, 'error')
        }
      } else {
        trackDbEvent('application_submit', 'vacancy', vacancy.id, { position: vacancy.position ?? undefined })
        trackApplicationSubmit(vacancy.id, vacancy.position ?? undefined)
        onSuccess(vacancy.id)
        onClose()
        addToast('Application submitted successfully!', 'success')
      }
    } catch (err) {
      logger.error('Unexpected error:', err)
      reportSupabaseError('vacancies.apply_exception', err, {
        vacancyId: vacancy.id
      }, {
        feature: 'vacancies',
        operation: 'apply_vacancy'
      })
      onError?.(vacancy.id)
      const msg = extractErrorMessage(err, 'Network error. Please check your connection and try again.')
      setError(msg)
      addToast(msg, 'error')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl max-w-sm w-full focus:outline-none shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex items-start justify-between mb-4">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">Apply to this position?</h2>
            <button
              type="button"
              onClick={handleClose}
              disabled={isSubmitting}
              className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50 -mt-1 -mr-1 p-1 hover:bg-gray-100 rounded-full"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <p id={descriptionId} className="text-sm text-gray-600 mb-6">
            Your profile will be shared with the club for review.
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full px-4 py-3 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {isSubmitting ? 'Submitting...' : 'Submit Application'}
          </button>
        </form>
      </div>
    </div>
  )
}
