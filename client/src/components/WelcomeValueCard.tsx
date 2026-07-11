import { useState } from 'react'
import { X, Sparkles } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'

const STORAGE_KEY_PREFIX = 'hockia-welcome-card-dismissed-v1'

/**
 * One-line dashboard value-prop card. Renders for owners who haven't
 * dismissed it. Persists the dismissal via localStorage so it stays out
 * of the way once a user has seen it. Versioned key (`-v1`) lets us
 * re-introduce the card with new copy by bumping the version without
 * surfacing it again to users who already saw the previous version.
 *
 * Storage key is scoped by user id — without that, a dismissal in one
 * account would carry over when a different account signs in on the
 * same browser (shared family devices, public computers, account
 * switching). Renders nothing until we know who the viewer is so we
 * never apply the wrong user's dismissal state on first paint.
 *
 * Copy comes directly from the product brief — single-sentence value
 * prop without a CTA, so it feels like a tagline, not another nudge in
 * a stack of nudges.
 */
export default function WelcomeValueCard() {
  const userId = useAuthStore((s) => s.user?.id)
  const storageKey = userId ? `${STORAGE_KEY_PREFIX}:${userId}` : null

  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined' || !storageKey) return true
    return window.localStorage.getItem(storageKey) === 'true'
  })

  // Don't render until we know the user id — avoids a flash of "welcome"
  // before the store hydrates, and avoids using the wrong user's key.
  if (!storageKey || dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    try {
      window.localStorage.setItem(storageKey, 'true')
    } catch {
      // localStorage can throw in private mode / quota — silent fallback.
    }
  }

  return (
    <div
      className="relative flex items-start gap-3 rounded-2xl border border-hockia-primary/15 bg-gradient-to-br from-hockia-primary/5 via-white to-hockia-secondary/5 px-4 py-3 sm:px-5 sm:py-4"
      role="region"
      aria-label="Welcome to HOCKIA"
    >
      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-hockia-primary/10 text-hockia-primary">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1 pr-6">
        <p className="text-sm font-semibold text-gray-900">Welcome to HOCKIA</p>
        <p className="mt-0.5 text-sm text-gray-600">
          Build your hockey profile, get discovered by clubs and coaches, and share your profile externally.
        </p>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss welcome message"
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-hockia-primary/40"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )
}
