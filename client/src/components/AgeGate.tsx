import { useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'

/**
 * Age gate (P3, 18+ policy) — one gate, three states, mounted inside
 * TermsGate so it inherits the same "authenticated interstitial" position:
 *
 * 1. FROZEN (frozen_minor_at set): full-screen goodbye. Warm, blame-free,
 *    data-preserved framing; sign-out is the only action. No auto-signout —
 *    the account is inert server-side (RLS + triggers + RPC fences), and
 *    the screen must stay readable.
 * 2. DOB CONFIRM (person role, DOB missing, dob_required_since set): a
 *    blocking modal, one field one tap. dob_required_since is the ARMING
 *    key — it is set per-profile when the enforcement email goes out, so
 *    shipping this component changes nothing until arming.
 * 3. ORG ATTESTATION (club/brand, not yet attested): soft, dismissible,
 *    never blocking (organizations are never DOB-gated — scope rule).
 *
 * SCOPE RULE: states 1–2 can only ever apply to player/coach/umpire; the
 * server-side predicates enforce the same, this is just the UI mirror.
 */

const PERSON_ROLES = ['player', 'coach', 'umpire']
const ORG_ROLES = ['club', 'brand']

export default function AgeGate({ children }: { children: React.ReactNode }) {
  const { user, profile, refreshProfile } = useAuthStore()
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [orgDismissed, setOrgDismissed] = useState(
    () => sessionStorage.getItem('hockia-org-attest-dismissed') === '1',
  )

  if (!user || !profile) return <>{children}</>

  // ── 1. Frozen minor: warm goodbye, nothing else renders ──
  if (profile.frozen_minor_at) {
    return (
      <div className="fixed inset-0 z-[9999] bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <img src="/WhiteLogo.svg" alt="HOCKIA" className="h-7 invert mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-gray-900">HOCKIA is 18+ for now</h1>
          <p className="text-sm text-gray-600 mt-4 leading-relaxed">
            Your profile is <strong>saved, not deleted</strong>. We&apos;re building
            HOCKIA Juniors — a version with protections designed for young players —
            and you&apos;ll be the first to know when it opens. Everything you built
            here will be waiting for you.
          </p>
          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            Questions, or want your data removed? Write to{' '}
            <a href="mailto:team@inhockia.com" className="text-hockia-primary font-medium">
              team@inhockia.com
            </a>{' '}
            — we answer every message.
          </p>
          <button
            type="button"
            onClick={() => useAuthStore.getState().signOut()}
            className="mt-8 w-full py-3 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  const role = profile.role ?? ''
  const isPerson = PERSON_ROLES.includes(role)
  const isOrg = ORG_ROLES.includes(role)

  // ── 2. DOB confirmation (armed accounts only) ──
  const needsDob =
    isPerson &&
    Boolean(profile.onboarding_completed) &&
    !profile.date_of_birth &&
    Boolean(profile.dob_required_since)

  if (needsDob) {
    const handleConfirm = async () => {
      if (!dob) {
        setError('Please select your date of birth.')
        return
      }
      setSaving(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('declare_date_of_birth', { p_dob: dob })
        if (rpcError) throw rpcError
        const outcome = (data as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') {
          setError('That date doesn’t look right — please check it.')
          return
        }
        // 'confirmed' clears the gate; 'frozen' flips this component into
        // the goodbye screen. Either way the fresh profile decides.
        await refreshProfile()
      } catch (err) {
        logger.error('[AgeGate] declare_date_of_birth failed', err)
        setError('Could not save. Please try again.')
      } finally {
        setSaving(false)
      }
    }

    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
          <img src="/WhiteLogo.svg" alt="HOCKIA" className="h-6 invert mb-4" />
          <h2 className="text-xl font-bold text-gray-900">Confirm your date of birth</h2>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">
            HOCKIA is an 18+ platform. Confirm your date of birth to keep your
            full profile active — it stays private and is never shown to other
            members (only your age is).
          </p>
          <div className="mt-5">
            <DateOfBirthPicker value={dob} onChange={setDob} required error={error ?? undefined} />
          </div>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving}
            className="mt-5 w-full py-3 bg-hockia-primary text-white font-semibold rounded-xl hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  // ── 3. Org operator attestation: soft, dismissible, never blocking ──
  const needsOrgAttestation =
    isOrg && Boolean(profile.onboarding_completed) && !profile.org_attested_18plus_at && !orgDismissed

  return (
    <>
      {children}
      {needsOrgAttestation && (
        <div className="fixed bottom-20 inset-x-0 z-[60] px-4 pointer-events-none">
          <div className="pointer-events-auto max-w-md mx-auto bg-white border border-gray-200 shadow-lg rounded-2xl p-4">
            <p className="text-sm text-gray-700 leading-relaxed">
              Quick confirmation: I&apos;m 18 or older and authorized to represent
              this organization on HOCKIA.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await supabase.rpc('attest_org_operator_adult')
                    await refreshProfile()
                  } catch (err) {
                    logger.error('[AgeGate] attestation failed', err)
                  }
                }}
                className="flex-1 py-2 bg-hockia-primary text-white text-sm font-semibold rounded-xl hover:bg-[#6b1fd4] transition-colors"
              >
                I confirm
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('hockia-org-attest-dismissed', '1')
                  setOrgDismissed(true)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                Later
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
