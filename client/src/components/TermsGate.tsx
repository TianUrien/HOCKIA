import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'

const CURRENT_TERMS_VERSION = '1.0'

/**
 * Terms acceptance gate — shown once to authenticated users
 * before they can access user-generated content.
 * Required by Apple Guideline 1.2 (Safety - User-Generated Content).
 */
export default function TermsGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const [accepted, setAccepted] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!user) {
      setAccepted(true) // Not logged in — don't gate public pages
      return
    }

    // Check localStorage first for fast path
    const localKey = `hockia-terms-${CURRENT_TERMS_VERSION}`
    if (localStorage.getItem(localKey) === 'accepted') {
      setAccepted(true)
      return
    }

    // Check database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any).rpc('has_accepted_terms', { p_version: CURRENT_TERMS_VERSION })
      .then(({ data }: { data: boolean }) => {
        if (data) {
          localStorage.setItem(localKey, 'accepted')
        }
        setAccepted(data ?? false)
      })
      .catch(() => {
        setAccepted(true) // Fail open — don't block users on DB errors
      })
  }, [user])

  const handleAccept = async () => {
    setLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).rpc('accept_terms', { p_version: CURRENT_TERMS_VERSION })
      localStorage.setItem(`hockia-terms-${CURRENT_TERMS_VERSION}`, 'accepted')
      setAccepted(true)
    } catch (err) {
      logger.error('Failed to accept terms:', err)
      // Accept locally even if DB fails
      localStorage.setItem(`hockia-terms-${CURRENT_TERMS_VERSION}`, 'accepted')
      setAccepted(true)
    } finally {
      setLoading(false)
    }
  }

  // Still checking
  if (accepted === null) return null

  // Already accepted
  if (accepted) return <>{children}</>

  // Show terms acceptance screen
  return (
    <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-2">
            <img src="/WhiteLogo.svg" alt="HOCKIA" className="h-6 invert" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">Terms of Use</h2>
          <p className="text-sm text-gray-600 mt-1">
            Please review and accept our terms before continuing
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-sm text-gray-700 space-y-4">
          <p>
            By using HOCKIA, you agree to our{' '}
            <button onClick={() => navigate('/terms')} className="text-[#8026FA] underline font-medium">
              Terms & Conditions
            </button>{' '}
            and{' '}
            <button onClick={() => navigate('/privacy-policy')} className="text-[#8026FA] underline font-medium">
              Privacy Policy
            </button>.
          </p>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <p className="font-semibold text-gray-900">Community Guidelines</p>
            <p>HOCKIA has zero tolerance for objectionable content or abusive behavior. By continuing, you agree to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Not post harassment, hate speech, threats, or inappropriate content</li>
              <li>Not send spam or unsolicited messages</li>
              <li>Not impersonate others or create misleading profiles</li>
              <li>Report any objectionable content you encounter</li>
              <li>Respect other users and the field hockey community</li>
            </ul>
            <p className="text-xs text-gray-500 mt-2">
              Violations may result in content removal and account suspension.
              HOCKIA reviews all reports within 24 hours.
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100">
          <button
            onClick={handleAccept}
            disabled={loading}
            className="w-full py-3 bg-[#8026FA] text-white font-semibold rounded-xl hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
          >
            {loading ? 'Accepting...' : 'I Agree — Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
