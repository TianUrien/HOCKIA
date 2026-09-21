import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { trackSignupWallAction } from '@/lib/analytics'
import { trackDbEvent, markWallIntent } from '@/lib/trackDbEvent'

interface SignInPromptModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message?: string
  /** The gated action that triggered this wall (apply/message/connect/…),
   *  for funnel attribution. Defaults to 'unknown' so wall impressions are
   *  always counted even where the caller hasn't specified one yet. */
  action?: string
}

/** "Sign in to apply" → "Join Hockia to apply" — one sheet, the trigger in the title. */
function joinTitle(title: string): string {
  const m = /^(?:sign in|log in) to (.+)$/i.exec(title.trim())
  if (m) return `Join Hockia to ${m[1]}`
  if (/^sign in to continue$/i.test(title.trim())) return 'Join Hockia'
  return title
}

/**
 * The guest Join sheet (founder ruling 2026-09-20): every gated action —
 * Apply, Add friend, Message, View profile — lands on this one sheet with
 * the trigger named in the title. Create a profile first, Log in second.
 *
 * This is the single chokepoint for the login-wall funnel: it fires
 * `login_wall_shown` on open and marks a wall intent when the visitor chooses
 * to authenticate, so a subsequent registration is attributed to the wall.
 */
export default function SignInPromptModal({
  isOpen,
  onClose,
  title = 'Sign in to continue',
  message = 'Create a free HOCKIA profile — clubs, coaches and players are already here.',
  action,
}: SignInPromptModalProps) {
  const navigate = useNavigate()
  const location = useLocation()

  // Fire once per open (false→true transition), not on every re-render.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (isOpen && !wasOpen.current) {
      trackDbEvent('login_wall_shown', undefined, undefined, { action: action ?? 'unknown' })
    }
    wasOpen.current = isOpen
  }, [isOpen, action])

  const handleSignIn = () => {
    trackSignupWallAction('sign_in')
    markWallIntent(action ?? 'unknown')
    navigate('/signin', { state: { from: location.pathname } })
    onClose()
  }

  const handleSignUp = () => {
    trackSignupWallAction('sign_up')
    markWallIntent(action ?? 'unknown')
    navigate('/signup', { state: { from: location.pathname } })
    onClose()
  }

  return (
    <BottomSheet open={isOpen} onClose={onClose} ariaLabel={joinTitle(title)}>
      <div className="flex flex-col gap-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-title text-ink-1">{joinTitle(title)}</h2>
          <p className="mt-1.5 text-row text-ink-2">{message}</p>
        </div>
        <button
          type="button"
          onClick={handleSignUp}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white"
        >
          Create a profile
        </button>
        <button
          type="button"
          onClick={handleSignIn}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1"
        >
          Log in
        </button>
        <p className="text-center text-secondary text-ink-4">Free. It takes a minute.</p>
      </div>
    </BottomSheet>
  )
}
