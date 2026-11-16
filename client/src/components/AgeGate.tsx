import { useState } from 'react'
import { Trans } from 'react-i18next'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'
import { useAuthT } from '@/i18n/ns/auth'

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
  const t = useAuthT()
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
          <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" className="h-7 mx-auto mb-6" />
          <h1 className="text-2xl font-bold text-gray-900">{t('ageGate.frozenTitle')}</h1>
          <p className="text-sm text-gray-600 mt-4 leading-relaxed">
            <Trans t={t} i18nKey="ageGate.frozenBody" components={{ strong: <strong /> }} />
          </p>
          <p className="text-sm text-gray-600 mt-3 leading-relaxed">
            <Trans
              t={t}
              i18nKey="ageGate.frozenContact"
              components={{ email: <a href="mailto:team@inhockia.com" className="text-hockia-primary font-medium" /> }}
            />
          </p>
          <button
            type="button"
            onClick={() => useAuthStore.getState().signOut()}
            className="mt-8 w-full py-3 bg-gray-900 text-white font-semibold rounded-xl hover:bg-gray-800 transition-colors"
          >
            {t('ageGate.signOut')}
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
        setError(t('ageGate.dobMissing'))
        return
      }
      setSaving(true)
      setError(null)
      try {
        const { data, error: rpcError } = await supabase.rpc('declare_date_of_birth', { p_dob: dob })
        if (rpcError) throw rpcError
        const outcome = (data as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') {
          setError(t('ageGate.dobInvalid'))
          return
        }
        // 'confirmed' clears the gate; 'frozen' flips this component into
        // the goodbye screen. Either way the fresh profile decides.
        await refreshProfile()
      } catch (err) {
        logger.error('[AgeGate] declare_date_of_birth failed', err)
        setError(t('ageGate.saveFailed'))
      } finally {
        setSaving(false)
      }
    }

    return (
      <div className="fixed inset-0 z-[9999] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6">
          <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" className="h-6 mb-4" />
          <h2 className="text-xl font-bold text-gray-900">{t('ageGate.dobTitle')}</h2>
          <p className="text-sm text-gray-600 mt-1 leading-relaxed">
            {t('ageGate.dobBody')}
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
            {saving ? t('ageGate.saving') : t('ageGate.confirm')}
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
              {t('ageGate.orgStatement')}
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
                {t('ageGate.orgConfirm')}
              </button>
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem('hockia-org-attest-dismissed', '1')
                  setOrgDismissed(true)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700"
              >
                {t('ageGate.orgLater')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
