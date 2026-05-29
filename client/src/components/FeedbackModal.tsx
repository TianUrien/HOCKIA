/**
 * FeedbackModal — in-app feedback collection.
 *
 * Bottom sheet on mobile (≤768px), centered modal on desktop. Five-
 * category intent radio + free-text body + optional urgent flag.
 * Auto-captures route/role/device via useFeedback (which calls the
 * submit_user_feedback RPC).
 *
 * Lives in a React portal so it escapes any overflow:hidden parent
 * (matches the SettingsSheet pattern). Tap-outside + Escape close.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Bug, HelpCircle, Sparkles, Heart, MessageSquare, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useFeedback, type FeedbackCategory } from '@/hooks/useFeedback'

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

const CATEGORIES: Array<{
  id: FeedbackCategory
  label: string
  description: string
  icon: typeof Bug
  iconColor: string
}> = [
  { id: 'bug',       label: 'Something is broken',   description: 'A bug or error',           icon: Bug,           iconColor: 'text-rose-600' },
  { id: 'confusing', label: 'Something is confusing', description: 'Unclear UX or copy',      icon: HelpCircle,    iconColor: 'text-amber-600' },
  { id: 'idea',      label: 'Idea or feature request', description: 'Something missing',     icon: Sparkles,      iconColor: 'text-[#8026FA]' },
  { id: 'praise',    label: 'Love it',                description: 'Tell us what works',     icon: Heart,         iconColor: 'text-pink-500' },
  { id: 'other',     label: 'Other',                  description: 'Anything else',          icon: MessageSquare, iconColor: 'text-gray-600' },
]

const MIN_BODY_LENGTH = 50
const MAX_BODY_LENGTH = 2000

export default function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const { status, submitFeedback, reset } = useFeedback()
  const [category, setCategory] = useState<FeedbackCategory | null>(null)
  const [body, setBody] = useState('')
  const [isUrgent, setIsUrgent] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstFocusRef = useRef<HTMLButtonElement>(null)

  // Reset transient state when the modal opens/closes so re-opens
  // start clean.
  useEffect(() => {
    if (!open) {
      // Defer the reset to avoid a flash of "idle" state during the
      // close animation.
      const id = window.setTimeout(() => {
        setCategory(null)
        setBody('')
        setIsUrgent(false)
        reset()
      }, 150)
      return () => window.clearTimeout(id)
    }
    // Focus the first interactive element on open for keyboard users.
    const id = window.setTimeout(() => firstFocusRef.current?.focus(), 50)
    return () => window.clearTimeout(id)
  }, [open, reset])

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Tap-outside to close
  useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node
      if (dialogRef.current && !dialogRef.current.contains(target)) {
        onClose()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, onClose])

  if (!open) return null
  if (typeof document === 'undefined') return null

  const canSubmit =
    category !== null &&
    body.trim().length >= MIN_BODY_LENGTH &&
    body.length <= MAX_BODY_LENGTH &&
    status.kind !== 'submitting'

  const handleSubmit = () => {
    if (!canSubmit || category === null) return
    void submitFeedback({ category, body: body.trim(), isUrgent })
  }

  const handleClose = () => {
    if (status.kind === 'submitting') return // don't close mid-submit
    onClose()
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      className="fixed inset-0 z-[9999] flex items-end justify-center bg-gray-900/40 sm:items-center"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg bg-white shadow-2xl rounded-t-2xl sm:rounded-2xl max-h-[90vh] overflow-y-auto animate-fade-in"
        data-testid="feedback-modal"
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <div>
            <h2 id="feedback-modal-title" className="text-lg font-bold text-gray-900">
              Send feedback
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Help us make HOCKIA better. We read every message.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={status.kind === 'submitting'}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg disabled:opacity-40"
            aria-label="Close feedback"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success state */}
        {status.kind === 'success' ? (
          <div className="p-8 text-center">
            <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50">
              <CheckCircle2 className="h-7 w-7 text-emerald-600" />
            </div>
            <h3 className="text-base font-semibold text-gray-900">Thanks — we got it.</h3>
            <p className="mt-1 text-sm text-gray-500">
              We&apos;ll follow up if we have questions.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-5 inline-flex items-center justify-center min-h-[44px] px-5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold shadow-sm hover:opacity-90"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            {/* Body */}
            <div className="p-5 space-y-5">
              {/* Category */}
              <div>
                <p className="text-sm font-medium text-gray-700 mb-2">What&apos;s this about?</p>
                <div className="space-y-1.5">
                  {CATEGORIES.map((cat, i) => {
                    const Icon = cat.icon
                    const selected = category === cat.id
                    return (
                      <button
                        key={cat.id}
                        ref={i === 0 ? firstFocusRef : undefined}
                        type="button"
                        onClick={() => setCategory(cat.id)}
                        aria-pressed={selected ? 'true' : 'false'}
                        className={[
                          'w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors min-h-[44px]',
                          selected
                            ? 'border-[#8026FA] bg-[#8026FA]/[0.04]'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50',
                        ].join(' ')}
                      >
                        <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${cat.iconColor}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900">{cat.label}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{cat.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Body textarea */}
              <div>
                <label htmlFor="feedback-body" className="text-sm font-medium text-gray-700">
                  Tell us more
                </label>
                <textarea
                  id="feedback-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY_LENGTH))}
                  rows={5}
                  placeholder="What happened, what you expected, anything that would help us understand…"
                  className="mt-1 w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#8026FA] focus:outline-none focus:ring-1 focus:ring-[#8026FA]/40"
                  data-testid="feedback-body"
                />
                <div className="mt-1 flex items-center justify-between text-[11px]">
                  <span
                    className={
                      body.length < MIN_BODY_LENGTH
                        ? 'text-gray-400'
                        : 'text-emerald-600'
                    }
                  >
                    {body.length < MIN_BODY_LENGTH
                      ? `${MIN_BODY_LENGTH - body.length} more characters needed`
                      : `${body.length}/${MAX_BODY_LENGTH}`}
                  </span>
                </div>
              </div>

              {/* Urgent */}
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isUrgent}
                  onChange={(e) => setIsUrgent(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-[#8026FA] focus:ring-[#8026FA]/40"
                />
                <span>
                  <span className="block text-sm font-medium text-gray-900">
                    This is urgent — affecting my work
                  </span>
                  <span className="block text-xs text-gray-500 mt-0.5">
                    Use sparingly so the urgent label keeps its signal.
                  </span>
                </span>
              </label>

              {/* Disclosure */}
              <div className="rounded-lg bg-gray-50 p-3 text-[11px] text-gray-500 leading-snug">
                We&apos;ll include with your message: your role, the page
                you&apos;re on, and the time. We will <strong>not</strong>{' '}
                capture a screenshot or your console.
              </div>

              {/* Error */}
              {status.kind === 'error' && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-900">{status.message}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100 bg-gray-50 sticky bottom-0">
              <button
                type="button"
                onClick={handleClose}
                disabled={status.kind === 'submitting'}
                className="min-h-[44px] px-4 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white text-sm font-semibold shadow-sm hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status.kind === 'submitting' ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send feedback'
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
