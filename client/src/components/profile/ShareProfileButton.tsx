import { useState } from 'react'
import { Share2, Link as LinkIcon, Mail, MessageCircle, Smartphone } from 'lucide-react'
import Modal from '@/components/Modal'
import { useToastStore } from '@/lib/toast'
import {
  buildProfileUrl,
  shareMessage,
  whatsappShareUrl,
  mailtoShareUrl,
  type ShareableProfile,
} from '@/lib/profileShare'
import {
  trackProfileShareInitiated,
  trackProfileShareCompleted,
} from '@/lib/analytics'

interface ShareProfileButtonProps {
  profile: ShareableProfile
  /**
   * Visual variant. `compact` is for crowded headers; `full` is for
   * the canonical "Share profile" button next to other primary actions.
   */
  variant?: 'full' | 'compact'
}

/**
 * Owner-only "Share profile" affordance. Mounted in role dashboards
 * when the viewer is looking at their own profile. Opens a modal with
 * 4 channels: copy link, native share (when available), WhatsApp, email.
 */
export default function ShareProfileButton({ profile, variant = 'full' }: ShareProfileButtonProps) {
  const [open, setOpen] = useState(false)
  const addToast = useToastStore((s) => s.addToast)

  const url = typeof window !== 'undefined'
    ? buildProfileUrl(profile, window.location.origin)
    : ''
  const supportsNativeShare = typeof navigator !== 'undefined'
    && typeof navigator.share === 'function'

  const handleOpen = () => {
    trackProfileShareInitiated(profile.role)
    setOpen(true)
  }

  const handleCopy = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
      } else {
        // Fallback for older browsers / Capacitor WKWebView edge cases.
        const ta = document.createElement('textarea')
        ta.value = url
        ta.setAttribute('readonly', '')
        ta.style.position = 'absolute'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      addToast('Profile link copied', 'success')
      trackProfileShareCompleted(profile.role, 'copy_link')
      setOpen(false)
    } catch {
      addToast('Could not copy link. Try selecting it manually.', 'error')
    }
  }

  const handleNativeShare = async () => {
    try {
      await navigator.share({
        title: 'HOCKIA profile',
        text: shareMessage(profile.role, url),
        url,
      })
      trackProfileShareCompleted(profile.role, 'native_share')
      setOpen(false)
    } catch (err) {
      // User dismissed the native sheet — silent. Real errors get a toast.
      const isAbort = err instanceof Error && err.name === 'AbortError'
      if (!isAbort) addToast('Share failed. Try copy link instead.', 'error')
    }
  }

  const handleWhatsapp = () => {
    window.open(whatsappShareUrl(profile.role, url), '_blank', 'noopener,noreferrer')
    trackProfileShareCompleted(profile.role, 'whatsapp')
    setOpen(false)
  }

  const handleEmail = () => {
    // mailto: opens in same window — keeps OS handler routing predictable.
    window.location.href = mailtoShareUrl(profile.role, url)
    trackProfileShareCompleted(profile.role, 'email')
    setOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        data-testid="share-profile-button"
        className={
          variant === 'compact'
            ? 'inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-700 hover:border-[#8026FA] hover:text-[#8026FA]'
            : 'inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:border-[#8026FA] hover:text-[#8026FA] sm:text-sm'
        }
        aria-label="Share profile"
      >
        <Share2 className="h-4 w-4" />
        {variant === 'full' && <span>Share profile</span>}
      </button>

      <Modal isOpen={open} onClose={() => setOpen(false)} className="max-w-sm">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-gray-900">Share your HOCKIA profile</h2>
          <p className="mt-1 text-sm text-gray-500">
            Send your public profile link via any of the options below. The recipient
            won’t need a HOCKIA account to view it.
          </p>

          <div className="mt-5 space-y-2">
            <ShareRow
              icon={<LinkIcon className="h-5 w-5 text-gray-700" />}
              label="Copy link"
              hint={url}
              onClick={handleCopy}
              testId="share-channel-copy"
            />
            {supportsNativeShare && (
              <ShareRow
                icon={<Smartphone className="h-5 w-5 text-gray-700" />}
                label="Share via device"
                hint="Use your device’s share sheet"
                onClick={handleNativeShare}
                testId="share-channel-native"
              />
            )}
            <ShareRow
              icon={<MessageCircle className="h-5 w-5 text-emerald-600" />}
              label="WhatsApp"
              hint="Open WhatsApp with a prefilled message"
              onClick={handleWhatsapp}
              testId="share-channel-whatsapp"
            />
            <ShareRow
              icon={<Mail className="h-5 w-5 text-blue-600" />}
              label="Email"
              hint="Open your email app with a prefilled message"
              onClick={handleEmail}
              testId="share-channel-email"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}

interface ShareRowProps {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  testId: string
}

function ShareRow({ icon, label, hint, onClick, testId }: ShareRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="flex w-full items-center gap-3 rounded-xl border border-gray-200 px-3 py-3 text-left transition-colors hover:border-[#8026FA] hover:bg-purple-50/40"
    >
      <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-gray-900">{label}</span>
        <span className="block truncate text-xs text-gray-500">{hint}</span>
      </span>
    </button>
  )
}
