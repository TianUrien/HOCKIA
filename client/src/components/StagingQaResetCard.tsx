import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

/**
 * StagingQaResetCard — single-tap "redo onboarding" for staging testing.
 *
 * Gated three ways:
 *   1. This component returns null unless VITE_ENVIRONMENT === 'staging'
 *   2. The backing RPC errors unless app.environment = 'staging' in PG
 *   3. The RPC operates on auth.uid() — you can only reset yourself
 *
 * Companion to the Gmail-alias pattern (sign up as
 * playrplayer93+test01@gmail.com to test the role-picker flow on a fresh
 * user). This card covers the "same account, different onboarding run" case.
 */
export default function StagingQaResetCard() {
  const isStaging = import.meta.env.VITE_ENVIRONMENT === 'staging'
  const navigate = useNavigate()
  const { signOut } = useAuthStore()
  const { addToast } = useToastStore()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [resetting, setResetting] = useState(false)

  if (!isStaging) return null

  async function handleReset() {
    setResetting(true)
    try {
      const { error } = await supabase.rpc('staging_reset_onboarding')
      if (error) throw error
      addToast('Onboarding reset. Signing you out…', 'success')
      // Sign out so the auth store rehydrates cleanly when you sign back in,
      // and so any in-memory profile snapshot doesn't mask the wiped state.
      await signOut()
      navigate('/', { replace: true })
    } catch (err) {
      logger.error('staging_reset_onboarding failed', err)
      const message = err instanceof Error ? err.message : 'Unknown error'
      addToast(`Reset failed: ${message}`, 'error')
      setResetting(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <div className="bg-yellow-50 border border-yellow-300 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-yellow-700 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-yellow-900">Staging QA tools</h2>
            <p className="text-sm text-yellow-800 mt-1">
              Only visible on the staging environment. Use this to test the onboarding
              flow repeatedly without creating a new account.
            </p>

            <div className="mt-4 bg-white border border-yellow-300 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900">Reset my onboarding</h3>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Clears your name, location, date of birth, avatar, and all role-specific
                fields. Your role, email, friend connections, and notification preferences
                are kept. You'll be signed out so you can sign back in and re-run
                onboarding from scratch.
              </p>
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={resetting}
                className="mt-3 inline-flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                Reset my onboarding
              </button>
            </div>

            <div className="mt-3 bg-white border border-yellow-300 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-gray-900">Test with Gmail aliases</h3>
              <p className="text-xs text-gray-600 mt-1 leading-relaxed">
                Sign up with <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px]">playrplayer93+test01@gmail.com</code>{' '}
                (or any <code className="px-1 py-0.5 bg-gray-100 rounded text-[11px]">+alias</code>) to test the role-picker
                step on a brand-new account. Gmail routes the confirmation email to the
                base inbox.
              </p>
            </div>
          </div>
        </div>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          onClick={() => !resetting && setConfirmOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="staging-reset-confirm-title"
        >
          <div
            className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 id="staging-reset-confirm-title" className="text-lg font-semibold text-gray-900">
                Reset onboarding?
              </h2>
              {!resetting && (
                <button
                  type="button"
                  onClick={() => setConfirmOpen(false)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>
            <p className="text-sm text-gray-600 mt-2 leading-relaxed">
              This clears your onboarding data on staging. You'll be signed out and need
              to sign back in to re-run the flow.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={resetting}
                className="px-4 py-2 text-sm font-medium text-white bg-yellow-600 hover:bg-yellow-700 disabled:opacity-60 rounded-lg"
              >
                {resetting ? 'Resetting…' : 'Yes, reset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
