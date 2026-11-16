import { useEffect, useMemo, useState } from 'react'
import { Copy, Share2, Check, MessageSquareQuote } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import type { Profile } from '@/lib/supabase'
import { tMedia, useMediaT } from '@/i18n/ns/media'

interface RequestFeedbackModalProps {
  isOpen: boolean
  onClose: () => void
  /** Profile URL to share (usually the owner's public profile). */
  profileUrl: string
  /** Owner's display name, used to compose a natural-sounding request. */
  ownerName?: string | null
  /** Owner's role — drives role-appropriate share copy. Optional; defaults to generic player wording. */
  profileRole?: Profile['role'] | null
}

function helperCopyFor(role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') return tMedia('feedbackRequest.helper.umpire')
  if (role === 'club') return tMedia('feedbackRequest.helper.club')
  if (role === 'brand') return tMedia('feedbackRequest.helper.brand')
  return tMedia('feedbackRequest.helper.player')
}

function messageTemplateFor(
  role: Profile['role'] | null | undefined,
  ownerName: string | null | undefined,
  profileUrl: string,
): string {
  const firstName = ownerName ? ownerName.split(' ')[0] : null
  const vars = { firstName, url: profileUrl }
  if (role === 'umpire') return firstName ? tMedia('feedbackRequest.message.umpireNamed', vars) : tMedia('feedbackRequest.message.umpire', vars)
  if (role === 'club') return firstName ? tMedia('feedbackRequest.message.clubNamed', vars) : tMedia('feedbackRequest.message.club', vars)
  if (role === 'brand') return firstName ? tMedia('feedbackRequest.message.brandNamed', vars) : tMedia('feedbackRequest.message.brand', vars)
  return firstName ? tMedia('feedbackRequest.message.playerNamed', vars) : tMedia('feedbackRequest.message.player', vars)
}

/**
 * RequestFeedbackModal — shown from CommentsTab when the profile owner
 * wants to proactively ask a teammate/coach/club to leave a comment.
 *
 * Intentionally minimal for PR 4 v1: the owner edits a pre-seeded message,
 * then copies it or fires a native share sheet. No friend-picker, no DB
 * writes, no in-app DM wiring yet — the lowest-risk way to ship the loop
 * and see whether owners actually use it.
 */
export default function RequestFeedbackModal({
  isOpen,
  onClose,
  profileUrl,
  ownerName,
  profileRole,
}: RequestFeedbackModalProps) {
  const t = useMediaT()
  const defaultMessage = useMemo(
    () => messageTemplateFor(profileRole, ownerName, profileUrl),
    [profileRole, ownerName, profileUrl],
  )

  const [message, setMessage] = useState(defaultMessage)
  const [copied, setCopied] = useState(false)
  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  // Reset the textarea each time the modal re-opens so the fresh template is
  // shown (in case ownerName or profileUrl changed between opens).
  useEffect(() => {
    if (isOpen) {
      setMessage(defaultMessage)
      setCopied(false)
    }
  }, [isOpen, defaultMessage])

  const handleCopy = async () => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        return
      }
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard may be blocked (insecure context, permissions) — the
      // textarea stays visible so the owner can select + copy manually.
    }
  }

  const handleShare = async () => {
    if (!canNativeShare) {
      void handleCopy()
      return
    }
    try {
      await navigator.share({
        title: t('feedbackRequest.shareTitle'),
        text: message,
        url: profileUrl,
      })
    } catch {
      // User cancelled the native share sheet, or the browser rejected it
      // (e.g. non-user-gesture). Fall through silently — nothing to retry.
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 pr-8">{t('feedbackRequest.title')}</h2>

        <div className="flex items-start gap-3 rounded-xl bg-hockia-primary/5 border border-hockia-primary/15 p-3">
          <MessageSquareQuote className="w-5 h-5 text-hockia-primary flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700 leading-relaxed">
            {helperCopyFor(profileRole)}
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">
            {t('feedbackRequest.messageLabel')}
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent resize-y"
            aria-label={t('feedbackRequest.messageAria')}
          />
        </label>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('feedbackRequest.cancel')}
          </Button>
          <Button
            variant="outline"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                {t('feedbackRequest.copied')}
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                {t('feedbackRequest.copy')}
              </>
            )}
          </Button>
          <Button
            variant="primary"
            onClick={handleShare}
            className="inline-flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            {canNativeShare ? t('feedbackRequest.share') : t('feedbackRequest.shareCopy')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
