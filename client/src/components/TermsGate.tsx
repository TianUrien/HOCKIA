import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Trans } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { useBottomPrompt } from '@/lib/bottomPrompt'
import { TERMS_GATE_OVERLAY } from '@/lib/overlaySequence'
import { useAuthT } from '@/i18n/ns/auth'

const CURRENT_TERMS_VERSION = '1.0'

/**
 * Never gated: the transient auth callback, the onboarding screens (see
 * effect) and the two legal pages. The modal's own "Terms & Conditions" /
 * "Privacy Policy" links navigate there; without this exemption the gate
 * re-rendered on top of the legal page, so tapping a link did nothing
 * visible (release audit 2026-10-05). Both pages are static, non-UGC
 * content, so showing them before acceptance is exactly what Apple 1.2 wants.
 */
const UNGATED_PREFIXES = ['/auth/callback', '/complete-profile', '/brands/onboarding', '/terms', '/privacy-policy']

/**
 * Terms acceptance gate — shown once to authenticated users
 * before they can access user-generated content.
 * Required by Apple Guideline 1.2 (Safety - User-Generated Content).
 */
export default function TermsGate({ children }: { children: React.ReactNode }) {
  const t = useAuthT()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  // First frame decided SYNCHRONOUSLY (2026-08-17 launch-flicker fix):
  // starting at null blanked the ENTIRE app (this gate wraps every route)
  // for React's first commit, until the effect below flushed — a guaranteed
  // blank frame on every cold start. At mount the auth store has no user yet
  // (logged out, or still hydrating — ProtectedRoute owns that waiting
  // state), so there is nothing to gate and children may render immediately.
  // If a user is already known (remount), localStorage answers synchronously.
  // The effect re-checks against the DB once the user resolves — enforcement
  // is unchanged, only the blank frame is gone.
  const [accepted, setAccepted] = useState<boolean | null>(() => {
    const u = useAuthStore.getState().user
    if (!u) return true
    try {
      return localStorage.getItem(`hockia-terms-${u.id}-${CURRENT_TERMS_VERSION}`) === 'accepted' ? true : null
    } catch {
      return null
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Overlay sequencing (founder rulings 2026-10-04): while the gate is up — or
  // still deciding for a signed-in user — the cookie banner, install card and
  // push card wait. They read this through the bottom-prompt coordinator.
  // `checking` covers the DB round-trip after sign-in, when `accepted` may
  // still hold the logged-out `true` from mount.
  const [checking, setChecking] = useState(false)
  useBottomPrompt(TERMS_GATE_OVERLAY, Boolean(user) && (accepted !== true || checking))

  useEffect(() => {
    if (!user) {
      setAccepted(true) // Not logged in — don't gate public pages
      setChecking(false)
      return
    }
    // /auth/callback is a TRANSIENT routing page — it exchanges the OAuth or
    // magic-link code, resolves the profile, and navigates on. Gating it
    // parked first-time users behind a full-screen Terms modal on a page
    // that says nothing, while the callback's own navigation was blocked
    // underneath. Found in the pre-release QA of 2026-08-17: 2 of 8 Google
    // signups in the prior 14 days had a confirmed account, no profile, and
    // zero page views — they quit at exactly this wall (one came back two
    // days later and hit it again). Let the callback finish.
    //
    // Account-first onboarding (founder rulings 2026-10-03): the first real
    // screen after an OAuth return is now "Choose your role" on
    // /complete-profile, and nothing may cover it. Onboarding has no
    // user-generated content, so the gate (Apple 1.2: accept before UGC) is
    // deferred to the first route after onboarding — still required there,
    // before anything else.
    if (UNGATED_PREFIXES.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'))) {
      setAccepted(true)
      setChecking(false)
      return
    }

    // Check localStorage first for fast path (key includes user ID to prevent cross-user contamination)
    const localKey = `hockia-terms-${user.id}-${CURRENT_TERMS_VERSION}`
    if (localStorage.getItem(localKey) === 'accepted') {
      setAccepted(true)
      setChecking(false)
      return
    }

    setChecking(true)
    // Check database
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(supabase as any).rpc('has_accepted_terms', { p_version: CURRENT_TERMS_VERSION })
      .then(({ data }: { data: boolean }) => {
        if (data) {
          localStorage.setItem(localKey, 'accepted')
        }
        setAccepted(data ?? false)
      })
      .catch(() => {
        setAccepted(false) // Fail closed — require acceptance on DB errors
      })
      .finally(() => setChecking(false))
  }, [user, location.pathname])

  const handleAccept = async () => {
    if (!user) return
    setLoading(true)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any).rpc('accept_terms', { p_version: CURRENT_TERMS_VERSION })
      if (error) throw error
      localStorage.setItem(`hockia-terms-${user.id}-${CURRENT_TERMS_VERSION}`, 'accepted')
      setAccepted(true)
    } catch (err) {
      logger.error('Failed to accept terms:', err)
      // Retry once — if still fails, let user try again
      setError(t('termsGate.saveFailed'))
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
            <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" className="h-6" />
          </div>
          <h2 className="text-xl font-bold text-gray-900">{t('termsGate.title')}</h2>
          <p className="text-sm text-gray-600 mt-1">
            {t('termsGate.subtitle')}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-sm text-gray-700 space-y-4">
          <p>
            <Trans
              t={t}
              i18nKey="termsGate.agreement"
              components={{
                terms: <button onClick={() => navigate('/terms')} className="text-hockia-primary underline font-medium" />,
                privacy: <button onClick={() => navigate('/privacy-policy')} className="text-hockia-primary underline font-medium" />,
              }}
            />
          </p>

          <div className="bg-gray-50 rounded-lg p-4 space-y-2">
            <p className="font-semibold text-gray-900">{t('termsGate.guidelinesTitle')}</p>
            <p>{t('termsGate.guidelinesIntro')}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>{t('termsGate.rules.noHarassment')}</li>
              <li>{t('termsGate.rules.noSpam')}</li>
              <li>{t('termsGate.rules.noImpersonation')}</li>
              <li>{t('termsGate.rules.report')}</li>
              <li>{t('termsGate.rules.respect')}</li>
            </ul>
            <p className="text-xs text-gray-500 mt-2">
              {t('termsGate.violations')}
            </p>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100">
          {error && (
            <p className="text-sm text-red-600 mb-3 text-center">{error}</p>
          )}
          <button
            onClick={handleAccept}
            disabled={loading}
            className="w-full py-3 bg-hockia-primary text-white font-semibold rounded-xl hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
          >
            {loading ? t('termsGate.accepting') : t('termsGate.accept')}
          </button>
        </div>
      </div>
    </div>
  )
}
