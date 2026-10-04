import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Camera, Check, ChevronDown } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import CountrySelect from '@/components/CountrySelect'
import LocationAutocomplete, { type LocationSelection } from '@/components/LocationAutocomplete'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { useCountries } from '@/hooks/useCountries'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { deleteStorageObject } from '@/lib/storage'
import { getImageUrl } from '@/lib/imageUrl'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { cn } from '@/lib/utils'
import { CLUB_NAME_MAX, foundedYears } from '@/lib/clubEdit'
import { clubSetupReady, type ClubSetupDraft } from '@/lib/clubSetup'

const LinkClubScreen = lazy(() => import('@/components/profile/mobile/LinkClubScreen'))

/**
 * Club set-up — the club part of onboarding (Figma 04 Club D1.24, DEV NOTE
 * 368:1088). Step 1 "About your club": only what players see next to every
 * role — crest (avatar_url), name (full_name), country, city, year founded
 * (optional) — plus the required 18+ box, which stamps org_attested_18plus_at
 * through attest_org_operator_adult (the column is not client-writable).
 * Step 2 is Link your club (338:495) in onboarding mode. Link or Skip for now
 * both finish onboarding (onboarding_completed → the DB trigger stamps
 * onboarding_completed_at); the caller then lands the club on Opportunities.
 *
 * Mounted by CompleteProfile for phone clubs that have not finished
 * onboarding — its auth / brand / already-onboarded guards run first.
 * Founder rulings: no back button on step 1; no contact email at set-up.
 */
interface ClubSetupFlowProps {
  /** Runs once onboarding_completed is saved: refresh, analytics, navigate. */
  onFinished: () => Promise<void> | void
}

const field = 'flex h-[50px] w-full items-center rounded-[12px] bg-surface-grouped px-3.5 text-left text-body text-ink-1'
const label = 'mb-1.5 block text-secondary font-semibold text-ink-2'

export default function ClubSetupFlow({ onFinished }: ClubSetupFlowProps) {
  const { user, profile, fetchProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const { getCountryById } = useCountries()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [step, setStep] = useState<1 | 2>(1)
  const [draft, setDraft] = useState<ClubSetupDraft>(() => ({
    name: profile?.full_name ?? '',
    countryId: profile?.nationality_country_id ?? null,
    location: profile?.base_location ?? '',
    city: profile?.base_city ?? '',
    baseCountryId: profile?.base_country_id ?? null,
    locationSelected: Boolean(profile?.base_location),
    yearFounded: profile?.year_founded ? String(profile.year_founded) : '',
    attested: Boolean(profile?.org_attested_18plus_at),
  }))
  const [sheet, setSheet] = useState<'country' | 'city' | null>(null)
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<ClubSetupDraft>) => setDraft((prev) => ({ ...prev, ...patch }))

  useEffect(() => { if (typeof window.scrollTo === 'function') { try { window.scrollTo(0, 0) } catch { /* jsdom */ } } }, [step])

  if (!user) return null
  const country = draft.countryId ? getCountryById(draft.countryId) : undefined
  const countryLabel = country ? [country.flag_emoji, country.common_name || country.name].filter(Boolean).join(' ') : null
  const cityLabel = draft.city || draft.location || null
  const ready = clubSetupReady(draft)
  const crest = profile?.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-lg') ?? profile.avatar_url : null

  const uploadCrest = async (file: File | undefined) => {
    if (!file) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { addToast(check.error ?? 'Invalid image', 'error'); return }
    setUploading(true)
    try {
      const optimized = await optimizeAvatarImage(file)
      const ext = optimized.name.split('.').pop() || 'jpg'
      const path = `${user.id}/avatar_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, optimized, { upsert: true, cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const previous = profile?.avatar_url ?? null
      const { error: updateError } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', user.id)
      if (updateError) throw updateError
      // The old file goes only once the row points at the new one (incident 2026-07-30).
      if (previous && previous !== publicUrl) void deleteStorageObject({ bucket: 'avatars', publicUrl: previous, context: 'club-setup:replace-crest' })
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'avatar_uploaded', role: 'club' })
      await fetchProfile(user.id, { force: true })
    } catch (err) {
      logger.error('[ClubSetup] crest upload failed', err)
      addToast('We couldn’t upload this image. Please use PNG or JPG up to 5MB.', 'error')
    } finally {
      setUploading(false)
    }
  }
  const pickCrest = async () => {
    if (isNativePlatform()) {
      try { const result = await pickImageNative('prompt'); if (result) await uploadCrest(result.file) } catch (err) { logger.error('[ClubSetup] native picker failed', err); addToast('Could not access camera or photos. Please check app permissions.', 'error') }
      return
    }
    fileRef.current?.click()
  }

  // Step 1 → save the club's basics, then the 18+ attestation, then Link.
  const saveAbout = async () => {
    if (!ready || saving) return
    setSaving(true)
    setError(null)
    try {
      // Long forms in iOS WebViews can outlive the token (same as CompleteProfile).
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) logger.warn('[ClubSetup] session refresh failed', refreshError)
      // Safety net shared with CompleteProfile: the row must exist before UPDATE.
      const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
      if (!existing) {
        const { error: createError } = await supabase.rpc('create_profile_for_new_user', { user_id: user.id, user_email: user.email || '', user_role: 'club' })
        if (createError) throw createError
      }
      const { error: updateError } = await supabase.from('profiles').update({
        role: 'club',
        full_name: draft.name.trim(),
        nationality_country_id: draft.countryId,
        // Clubs store the country name here (CompleteProfile's rule).
        nationality: country?.name ?? '',
        base_location: draft.location.trim(),
        base_city: draft.city || null,
        base_country_id: draft.baseCountryId ?? draft.countryId,
        year_founded: draft.yearFounded ? Number(draft.yearFounded) : null,
        // New clubs start "recruiting", as in CompleteProfile.
        open_to_opportunities: true,
      }).eq('id', user.id)
      if (updateError) throw updateError
      const { data: attest, error: attestError } = await supabase.rpc('attest_org_operator_adult')
      const outcome = (attest as { outcome?: string } | null)?.outcome
      if (attestError || outcome !== 'attested') throw attestError ?? new Error(`attestation: ${outcome ?? 'no outcome'}`)
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'form_submitted', role: 'club' })
      await fetchProfile(user.id, { force: true })
      setStep(2)
    } catch (err) {
      logger.error('[ClubSetup] save failed', err)
      setError('Could not save your club. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Link your club → Link or Skip for now: finish onboarding.
  const finish = async () => {
    if (finishing) return
    setFinishing(true)
    try {
      const { error: doneError } = await supabase.from('profiles').update({ onboarding_completed: true }).eq('id', user.id)
      if (doneError) throw doneError
      await onFinished()
    } catch (err) {
      logger.error('[ClubSetup] finish failed', err)
      addToast('Could not finish setting up. Please try again.', 'error')
      setFinishing(false)
    }
  }

  if (step === 2 && profile) {
    return (
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <LinkClubScreen profile={profile as Profile} mode="onboarding" onCancel={() => setStep(1)} onLinked={() => void finish()} onSkip={() => void finish()} finishing={finishing} />
      </Suspense>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-white lg:hidden" data-testid="club-setup-screen">
      <div className="flex h-11 items-center justify-center px-2 pt-[env(safe-area-inset-top)]">
        <img src="/brand/wordmark/hockia-wordmark-black.svg" alt="HOCKIA" className="h-[22px]" />
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-32 pt-6">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.28px] text-ink-1">About your club</h1>
        <p className="mt-1.5 text-[15px] leading-[21px] text-ink-2">Step 1 of 2 · what players see next to every role.</p>

        <div className="mt-5 flex items-center gap-3.5">
          <button type="button" onClick={() => void pickCrest()} disabled={uploading} aria-label={crest ? 'Change crest' : 'Add your crest'} className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-grouped text-ink-2">
            {uploading ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" /> : crest ? <img src={crest} alt="" className="h-full w-full object-cover" /> : <Camera className="h-6 w-6" strokeWidth={1.8} />}
          </button>
          <div className="min-w-0">
            <button type="button" onClick={() => void pickCrest()} disabled={uploading} className="text-row font-semibold text-hockia-primary">{crest ? 'Change crest' : 'Add your crest'}</button>
            <p className="text-secondary text-ink-2">A square crest reads best at small sizes.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="hidden" data-testid="club-setup-crest-input" onChange={(e) => { void uploadCrest(e.target.files?.[0]); e.target.value = '' }} />
        </div>

        <div className="mt-5">
          <label htmlFor="club-setup-name" className={label}>Club name</label>
          <input id="club-setup-name" value={draft.name} maxLength={CLUB_NAME_MAX} onChange={(e) => set({ name: e.target.value })} placeholder="Your club’s name" className={cn(field, 'placeholder:text-ink-3 focus:outline-none focus:ring-2 focus:ring-hockia-primary/30')} />
        </div>

        <div className="mt-5 flex gap-3">
          <div className="min-w-0 flex-1">
            <span className={label}>Country</span>
            <button type="button" onClick={() => setSheet('country')} aria-label={`Country: ${countryLabel ?? 'choose'}`} className={field}>
              <span className={cn('min-w-0 flex-1 truncate', !countryLabel && 'text-ink-3')}>{countryLabel ?? 'Choose'}</span>
              <ChevronDown className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={2} />
            </button>
          </div>
          <div className="min-w-0 flex-1">
            <span className={label}>City</span>
            <button type="button" onClick={() => setSheet('city')} aria-label={`City: ${cityLabel ?? 'choose'}`} className={field}>
              <span className={cn('min-w-0 flex-1 truncate', !cityLabel && 'text-ink-3')}>{cityLabel ?? 'Choose'}</span>
              <ChevronDown className="h-[18px] w-[18px] shrink-0 text-ink-3" strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="mt-5">
          <label htmlFor="club-setup-year" className={label}>Year founded · optional</label>
          <div className="relative">
            <select id="club-setup-year" value={draft.yearFounded} onChange={(e) => set({ yearFounded: e.target.value })} className={cn(field, 'appearance-none pr-10', !draft.yearFounded && 'text-ink-3')}>
              <option value="">Not set</option>
              {foundedYears().map((y) => <option key={y} value={String(y)}>{y}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-ink-3" strokeWidth={2} />
          </div>
        </div>

        <button type="button" role="checkbox" aria-checked={draft.attested} onClick={() => set({ attested: !draft.attested })} className="mt-5 flex items-start gap-3 text-left" data-testid="club-setup-attest">
          <span className={cn('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]', draft.attested ? 'bg-hockia-primary text-white' : 'border-[1.5px] border-ink-4')}>
            {draft.attested && <Check className="h-4 w-4" strokeWidth={3} />}
          </span>
          <span className="text-[15px] leading-5 text-ink-2">I’m 18 or over and I’m allowed to recruit for this club.</span>
        </button>

        {error && <p role="alert" className="mt-4 text-secondary text-red-600">{error}</p>}
      </div>

      <div className="fixed inset-x-0 bottom-0 bg-white px-6 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <button type="button" onClick={() => void saveAbout()} disabled={!ready || saving} className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Continue'}
        </button>
      </div>

      {/* Tall sheet (onboarding QA 2026-10-04): the picker used to be a
          dropdown inside a ~144 px sheet, so its list opened below the screen
          edge. Now the search is pinned and the list scrolls in the sheet. */}
      <BottomSheet open={sheet === 'country'} onClose={() => setSheet(null)} ariaLabel="Country" className="h-[85dvh]">
        <div className="px-5 pb-6 pt-2">
          <h2 className="mb-1 text-[20px] font-bold leading-[25px] text-ink-1">Country</h2>
          <CountrySelect presentation="list" appearance="field" value={draft.countryId} onChange={(id) => { set({ countryId: id }); setSheet(null) }} />
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === 'city'} onClose={() => setSheet(null)} ariaLabel="City">
        <div className="px-5 pb-6 pt-2">
          <h2 className="mb-3 text-[20px] font-bold leading-[25px] text-ink-1">City</h2>
          <LocationAutocomplete
            value={draft.location}
            isSelected={draft.locationSelected}
            placeholder="Where the club plays"
            // In the flow, not floating: the sheet's scroll container clipped
            // the floating list after the second result (QA 2026-10-04).
            suggestionsPlacement="inline"
            onChange={(value) => set({ location: value, city: '', baseCountryId: null, locationSelected: false })}
            onLocationSelect={(loc: LocationSelection) => {
              // A picked city fills the country when it is still empty.
              set({ location: loc.displayName, city: loc.city, baseCountryId: loc.countryId, locationSelected: true, ...(draft.countryId ? {} : { countryId: loc.countryId }) })
              setSheet(null)
            }}
            onLocationClear={() => set({ location: '', city: '', baseCountryId: null, locationSelected: false })}
          />
          <button type="button" onClick={() => setSheet(null)} className="mt-4 flex h-[50px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1">Done</button>
        </div>
      </BottomSheet>
    </div>
  )
}
