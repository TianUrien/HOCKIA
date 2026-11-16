import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { trackSignupWallAction } from '@/lib/analytics'
import { trackDbEvent, markWallIntent } from '@/lib/trackDbEvent'
import { useAuthT } from '@/i18n/ns/auth'

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

/** "Sign in to apply" → "Join Hockia to apply" — one sheet, the trigger in the title.
 *  No title (or the old "Sign in to continue") is the plain "Join Hockia". */
function joinTitle(title: string | undefined, t: ReturnType<typeof useAuthT>): string {
  if (title === undefined || /^sign in to continue$/i.test(title.trim())) return t('joinSheet.title')
  const m = /^(?:sign in|log in) to (.+)$/i.exec(title.trim())
  if (m) return t('joinSheet.titleTo', { action: m[1] })
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
  title,
  message,
  action,
}: SignInPromptModalProps) {
  const navigate = useNavigate()
  const t = useAuthT()
  const sheetTitle = joinTitle(title, t)
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
    <BottomSheet open={isOpen} onClose={onClose} ariaLabel={sheetTitle}>
      <div className="flex flex-col gap-4 px-5 pb-3 pt-1">
        <div>
          <h2 className="text-title text-ink-1">{sheetTitle}</h2>
          <p className="mt-1.5 text-row text-ink-2">{message ?? t('joinSheet.message')}</p>
        </div>
        <button
          type="button"
          onClick={handleSignUp}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white"
        >
          {t('joinSheet.createProfile')}
        </button>
        <button
          type="button"
          onClick={handleSignIn}
          className="flex h-[52px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1"
        >
          {t('joinSheet.logIn')}
        </button>
        <p className="text-center text-secondary text-ink-3">{t('joinSheet.note')}</p>
      </div>
    </BottomSheet>
  )
}
