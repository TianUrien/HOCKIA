import { useNavigate, useLocation } from 'react-router-dom'
import { LogIn, UserPlus } from 'lucide-react'
import Modal from './Modal'
import Button from './Button'

interface SignInPromptModalProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  message?: string
}

/**
 * Modal prompting unauthenticated users to sign in or sign up.
 * Stores the current URL so they can return after authentication.
 */
export default function SignInPromptModal({
  isOpen,
  onClose,
  title = 'Sign in to continue',
  message = 'Sign in or create a free HOCKIA account to apply to this opportunity.',
}: SignInPromptModalProps) {
  const navigate = useNavigate()
  const location = useLocation()

  const handleSignIn = () => {
    // Navigate to landing with return URL stored in state
    navigate('/', { state: { from: location.pathname } })
    onClose()
  }

  const handleSignUp = () => {
    // Navigate to signup with return URL stored in state
    navigate('/signup', { state: { from: location.pathname } })
    onClose()
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <div className="p-6 text-center">
        {/* Icon */}
        <div className="w-16 h-16 bg-gradient-to-br from-[#8026FA] to-[#924CEC] rounded-full flex items-center justify-center mx-auto mb-4">
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
            className="w-full bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 flex items-center justify-center gap-2"
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
