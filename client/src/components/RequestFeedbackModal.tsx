import { useEffect, useMemo, useState } from 'react'
import { Copy, Share2, Check, MessageSquareQuote } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
import type { Profile } from '@/lib/supabase'

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
  if (role === 'umpire') {
    return 'Send this to a colleague, umpire manager, coach, or club representative who can vouch for your officiating.'
  }
  if (role === 'club') {
    return 'Send this to a player, coach, or visitor who knows your club. Comments help prospects evaluate culture, facilities, and professionalism.'
  }
  if (role === 'brand') {
    return 'Send this to an ambassador, partner, or customer who knows your brand. Comments help the community evaluate trust and product fit.'
  }
  return 'Send this to a teammate, coach, or former club. Comments help clubs and coaches get a fuller picture of who you are on and off the pitch.'
}

function messageTemplateFor(
  role: Profile['role'] | null | undefined,
  ownerName: string | null | undefined,
  profileUrl: string,
): string {
  const intro = ownerName ? `Hey! ${ownerName.split(' ')[0]} here. ` : 'Hey! '
  if (role === 'umpire') {
    return (
      `${intro}I'm building out my HOCKIA officiating profile and would love a short note from you ` +
      `about working with me on the pitch — even a couple of sentences helps tournaments and clubs get a fuller picture. ` +
      `It takes 30 seconds:\n\n${profileUrl}`
    )
  }
  if (role === 'club') {
    return (
      `${intro}We're building out our HOCKIA club page and would love a short comment from you ` +
      `about your experience with us — even a couple of sentences helps prospects get a fuller picture of our culture and setup. ` +
      `It takes 30 seconds:\n\n${profileUrl}`
    )
  }
  if (role === 'brand') {
    return (
      `${intro}We're building out our HOCKIA brand page and would love a short comment from you ` +
      `about working with us — even a couple of sentences helps the community get a fuller picture of who we are. ` +
      `It takes 30 seconds:\n\n${profileUrl}`
    )
  }
  return (
    `${intro}I'm building out my HOCKIA profile and would love a short comment from you ` +
    `about playing with me — even a couple of sentences helps clubs and coaches get a fuller picture. ` +
    `It takes 30 seconds:\n\n${profileUrl}`
  )
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
        title: 'Comment on my HOCKIA profile',
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
        <h2 className="text-lg font-semibold text-gray-900 pr-8">Ask for feedback</h2>

        <div className="flex items-start gap-3 rounded-xl bg-[#8026FA]/5 border border-[#8026FA]/15 p-3">
          <MessageSquareQuote className="w-5 h-5 text-[#8026FA] flex-shrink-0 mt-0.5" />
          <p className="text-sm text-gray-700 leading-relaxed">
            {helperCopyFor(profileRole)}
          </p>
        </div>

        <label className="block">
          <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1.5">
            Your message
          </span>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#8026FA] focus:border-transparent resize-y"
            aria-label="Message template"
          />
        </label>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-2"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                Copy message
              </>
            )}
          </Button>
          <Button
            variant="primary"
            onClick={handleShare}
            className="inline-flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" />
            {canNativeShare ? 'Share' : 'Share (copy)'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
