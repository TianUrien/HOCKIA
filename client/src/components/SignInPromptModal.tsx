import { useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { LogIn, UserPlus } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'
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

/**
 * Modal prompting unauthenticated users to sign in or sign up.
 * Stores the current URL so they can return after authentication.
 *
 * This is the single chokepoint for the login-wall funnel: it fires
 * `login_wall_shown` on open and marks a wall intent when the visitor chooses
 * to authenticate, so a subsequent registration is attributed to the wall.
 */
export default function SignInPromptModal({
  isOpen,
  onClose,
  title = 'Sign in to continue',
  message = 'Sign in or create a free HOCKIA account to apply to this opportunity.',
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
    // Navigate to landing with return URL stored in state
    navigate('/', { state: { from: location.pathname } })
    onClose()
  }

  const handleSignUp = () => {
    trackSignupWallAction('sign_up')
    markWallIntent(action ?? 'unknown')
    // Navigate to signup with return URL stored in state
    navigate('/signup', { state: { from: location.pathname } })
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 text-center">
        {/* Icon */}
        <div className="w-16 h-16 bg-gradient-to-br from-hockia-primary to-hockia-secondary rounded-full flex items-center justify-center mx-auto mb-4">
          <LogIn className="w-8 h-8 text-white" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-gray-900 mb-2">{title}</h2>

        {/* Message */}
        <p className="text-gray-600 mb-6">{message}</p>

        {/* Actions */}
        <div className="space-y-3">
          <Button
            onClick={handleSignIn}
            className="w-full bg-gradient-to-r from-hockia-primary to-hockia-secondary hover:opacity-90 flex items-center justify-center gap-2"
          >
            <LogIn className="w-4 h-4" />
            Sign In
          </Button>
          <Button
            onClick={handleSignUp}
            variant="outline"
            className="w-full flex items-center justify-center gap-2"
          >
            <UserPlus className="w-4 h-4" />
            Create Free Account
          </Button>
        </div>

        {/* Footer note */}
        <p className="text-xs text-gray-500 mt-4">
          It only takes a minute to join HOCKIA and start connecting with clubs worldwide.
        </p>
      </div>
    </Modal>
  )
}
