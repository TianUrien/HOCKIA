import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Lock } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { fieldErrorRing, fieldErrorText, fieldInput, fieldLabel, fieldLabelText, fieldReadOnly, fieldSelect } from '@/components/ui/fieldClasses'
import CountrySelect from '@/components/CountrySelect'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'
import LocationAutocomplete, { type LocationSelection } from '@/components/LocationAutocomplete'
import WorldClubSearch from '@/components/WorldClubSearch'
import { SettingsRow, SettingsSwitch } from '@/components/settings/settingsUi'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { getImageUrl } from '@/lib/imageUrl'
import { logger } from '@/lib/logger'
import { toSentryError } from '@/lib/sentryHelpers'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { COACH_SPECIALIZATIONS } from '@/lib/coachSpecializations'
import { ANY_CATEGORY, CATEGORY_LABELS, COACH_UMPIRE_CATEGORIES, isValidCategoryArray } from '@/lib/hockeyCategories'
import { cn } from '@/lib/utils'
import { SetupSignOut } from './SetupSignOut'
import {
  COACH_CATEGORIES_HINT,
  COACH_PHOTO_HELPER,
  COACH_RECRUIT_HINT,
  COACH_RECRUIT_OPTIONS,
  COACH_RECRUIT_QUESTION,
  COACH_STEP2_SUBTITLE,
  OPEN_TO_COACH_HELPER,
  coachAboutYouErrors,
  coachCoachingErrors,
  coachDraftKey,
  legacyWizardDraftKey,
  offersOpenToPlay,
  parseCoachDraft,
  sentenceCaseLabel,
  serializeCoachDraft,
  toggleCoachCategory,
  type CoachAboutYouField,
  type CoachCoachingField,
  type CoachSetupDraft,
} from '@/lib/onboardingV2'

/**
 * Coach set-up (Figma New-Hockia D6: 586:806 "About you", 586:849 "Your
 * coaching", 587:911 missing answers, dev note 587:1030). Replaces the
 * 3-step coach wizard that lived in CompleteProfile; same columns, same RPCs,
 * same funnel events (wizard_step 1–2 instead of 1–3).
 *
 * Step 1 of 2: photo, full name, date of birth (through
 * declare_date_of_birth, the one-shot age gate: under 18 freezes the account
 * server-side and AgeGate's goodbye screen takes over), nationality, second
 * nationality, base location — saved on Continue.
 *
 * Step 2 of 2: specialization (Other → role title), coaching categories
 * (≥ 1, "Any category" exclusive), current club, the recruit question
 * (required, nothing preselected — founder ruling; "unanswered" is
 * client-only, coach_recruits_for_team stays boolean) and Open to coach.
 * Finish saves everything and onboarding_completed. Skip saves
 * onboarding_completed with coach_recruits_for_team false and Open to coach
 * ON (adults), like the player Skip.
 *
 * The caller does the refresh, analytics and navigation (onFinished).
 */
interface CoachSetupFlowProps {
  /** Runs once onboarding_completed is saved: refresh, analytics, navigate. */
  onFinished: () => Promise<void> | void
}

type Step = 1 | 2

const CATEGORY_CHIPS = COACH_UMPIRE_CATEGORIES

export default function CoachSetupFlow({ onFinished }: CoachSetupFlowProps) {
  const { user, profile, fetchProfile } = useAuthStore()
  const { getCountryById } = useCountries()
  const pendingCleanup = usePendingStorageCleanup()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const draftKey = user ? coachDraftKey(user.id) : null

  const [step, setStep] = useState<Step>(() => {
    // Resume at step 2 when step 1 is already saved (reload mid set-up).
    if (profile?.full_name && profile.date_of_birth && profile.nationality_country_id && profile.base_location) return 2
    return 1
  })
  const [draft, setDraft] = useState<CoachSetupDraft>(() => {
    const savedCategories = isValidCategoryArray(profile?.coaching_categories) ? [...(profile?.coaching_categories ?? [])] : []
    const base: CoachSetupDraft = {
      fullName: profile?.full_name ?? '',
      // Saved profile DOB → the DOB a legacy sign-up left in auth metadata → empty.
      dateOfBirth: profile?.date_of_birth ?? ((user?.user_metadata?.dob as string | undefined) || ''),
      nationalityCountryId: profile?.nationality_country_id ?? null,
      nationality2CountryId: profile?.nationality2_country_id ?? null,
      location: profile?.base_location ?? '',
      baseCity: profile?.base_city ?? '',
      baseCountryId: profile?.base_country_id ?? null,
      locationSelected: Boolean(profile?.base_location),
      specialization: profile?.coach_specialization ?? '',
      specializationCustom: profile?.coach_specialization_custom ?? '',
      categories: savedCategories,
      currentClub: profile?.current_club ?? '',
      currentWorldClubId: profile?.current_world_club_id ?? null,
      // Nothing preselected: the column defaults to false, which is not an answer.
      recruitsForTeam: null,
      openToCoach: true,
    }
    if (!user) return base
    try {
      let raw = localStorage.getItem(coachDraftKey(user.id))
      if (!raw) {
        // One-time migration from the 3-step wizard's key.
        const legacyKey = legacyWizardDraftKey('coach', user.id)
        raw = localStorage.getItem(legacyKey)
        if (raw) localStorage.removeItem(legacyKey)
      }
      const saved = parseCoachDraft(raw)
      if (saved) {
        // The saved date of birth always wins over a typed one (immutable).
        return { ...base, ...saved, dateOfBirth: profile?.date_of_birth ?? saved.dateOfBirth ?? base.dateOfBirth }
      }
    } catch {
      /* storage blocked — server prefill is the fallback */
    }
    return base
  })
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url ?? '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aboutErrors, setAboutErrors] = useState<Partial<Record<CoachAboutYouField, string>>>({})
  const [coachingErrors, setCoachingErrors] = useState<Partial<Record<CoachCoachingField, string>>>({})
  const viewedRef = useRef<Set<Step>>(new Set())

  const set = (patch: Partial<CoachSetupDraft>) => setDraft((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    if (!draftKey) return
    try {
      localStorage.setItem(draftKey, serializeCoachDraft(draft))
    } catch {
      /* quota / blocked — no-op */
    }
  }, [draft, draftKey])

  // `wizard_step_viewed` once per step (same DB funnel step names as the
  // legacy wizard; wizard_step 1–2 instead of 1–3).
  useEffect(() => {
    if (!user?.id || viewedRef.current.has(step)) return
    viewedRef.current.add(step)
    trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_viewed', role: 'coach', wizard_step: step })
    if (typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0) } catch { /* jsdom */ }
    }
  }, [step, user?.id])

  if (!user) return null

  const dobLocked = Boolean(profile?.date_of_birth)

  const captureError = (err: unknown, stage: string) => {
    Sentry.captureException(toSentryError(err), {
      tags: { feature: 'onboarding_profile', onboarding_role: 'coach', onboarding_stage: stage },
      extra: { userId: user.id, sourceComponent: 'CoachSetupFlow' },
    })
  }

  // ── Photo ──
  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { setError(check.error ?? 'Invalid image'); return }
    setUploading(true)
    setError(null)
    try {
      const optimized = await optimizeAvatarImage(file)
      const ext = optimized.name.split('.').pop() || 'jpg'
      const path = `${user.id}/avatar_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, optimized, { upsert: true, cacheControl: '31536000' })
      if (uploadError) throw uploadError
      const publicUrl = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      const previous = avatarUrl || profile?.avatar_url || null
      setAvatarUrl(publicUrl)
      // Replaced files go only after the row points at the new one (incident 2026-07-30).
      if (previous && previous !== publicUrl) pendingCleanup.queue({ bucket: 'avatars', publicUrl: previous, context: 'coach-setup:replace-avatar' })
      pendingCleanup.unqueue(publicUrl)
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'avatar_uploaded', role: 'coach' })
    } catch (err) {
      logger.error('[CoachSetup] photo upload failed', err)
      setError('We couldn’t upload this image. Please use PNG or JPG up to 5MB.')
    } finally {
      setUploading(false)
    }
  }
  const pickPhoto = async () => {
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt')
        if (result) await uploadPhoto(result.file)
      } catch (err) {
        logger.error('[CoachSetup] native picker failed', err)
        setError('Could not access camera or photos. Please check app permissions.')
      }
      return
    }
    fileRef.current?.click()
  }

  /** The row must exist before UPDATE (safety net shared with CompleteProfile). */
  const ensureRow = async () => {
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (existing) return
    const { error: createError } = await supabase.rpc('create_profile_for_new_user', { user_id: user.id, user_email: user.email || '', user_role: 'coach' })
    if (createError) {
      captureError(createError, 'ensureProfileExistsBeforeSubmit')
      throw new Error('Could not create your profile. Please try signing out and back in.')
    }
  }

  // ── Step 1 → save About you ──
  const saveAboutYou = async () => {
    if (saving) return
    const problems = coachAboutYouErrors(draft)
    setAboutErrors(problems)
    const first = Object.values(problems)[0]
    if (first) {
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_validation_failed', role: 'coach', wizard_step: 1, reason: first })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) logger.warn('[CoachSetup] session refresh failed', refreshError)
      await ensureRow()
      // Date of birth: written only through the one-shot gate. 'frozen' ends
      // set-up here — the refreshed profile flips AgeGate to its goodbye screen.
      if (!dobLocked) {
        const { data, error: dobError } = await supabase.rpc('declare_date_of_birth', { p_dob: draft.dateOfBirth })
        if (dobError) throw new Error('Could not save your date of birth. Please try again.')
        const outcome = (data as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') throw new Error('That date of birth doesn’t look right — please check it.')
        if (outcome === 'frozen') {
          await fetchProfile(user.id, { force: true })
          return
        }
      }
      const nationality = draft.nationalityCountryId ? getCountryById(draft.nationalityCountryId) : undefined
      const { error: updateError } = await supabase.from('profiles').update({
        role: 'coach',
        full_name: draft.fullName.trim(),
        // Coaches store the demonym here (CompleteProfile's rule).
        nationality: nationality?.nationality_name ?? '',
        nationality_country_id: draft.nationalityCountryId,
        nationality2_country_id: draft.nationality2CountryId,
        base_location: draft.location.trim(),
        base_city: draft.baseCity || null,
        base_country_id: draft.baseCountryId,
        avatar_url: avatarUrl || null,
      }).eq('id', user.id)
      if (updateError) {
        captureError(updateError, 'saveAboutYou')
        throw new Error('Could not save. Please try again.')
      }
      await pendingCleanup.flush()
      await fetchProfile(user.id, { force: true })
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_completed', role: 'coach', wizard_step: 1 })
      setStep(2)
    } catch (err) {
      logger.error('[CoachSetup] step 1 save failed', err)
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2 → save Your coaching (or skip) and finish ──
  const finish = async (mode: 'save' | 'skip') => {
    if (saving) return
    if (mode === 'save') {
      const problems = coachCoachingErrors(draft)
      setCoachingErrors(problems)
      const first = Object.values(problems)[0]
      if (first) {
        trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_validation_failed', role: 'coach', wizard_step: 2, reason: first })
        return
      }
    } else {
      setCoachingErrors({})
    }
    setSaving(true)
    setError(null)
    trackDbEvent('onboarding_step', 'profile', user.id, { step: 'form_submitted', role: 'coach' })
    try {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) logger.warn('[CoachSetup] session refresh failed', refreshError)
      await ensureRow()
      const adult = offersOpenToPlay(profile?.date_of_birth ?? draft.dateOfBirth)
      let patch: Record<string, unknown>
      if (mode === 'save') {
        patch = {
          onboarding_completed: true,
          // Same columns the 3-step wizard wrote on its final step.
          position: null,
          // Phase 3: gender is no longer authoritative for coaches.
          gender: null,
          coaching_categories: draft.categories.length > 0 ? draft.categories : null,
          category_confirmation_needed: false,
          current_club: draft.currentClub.trim() || null,
          current_world_club_id: draft.currentWorldClubId,
          coach_specialization: draft.specialization || null,
          coach_specialization_custom: draft.specialization === 'other' ? draft.specializationCustom.trim() : null,
          open_to_coach: adult && draft.openToCoach,
          coach_recruits_for_team: draft.recruitsForTeam === true,
        }
      } else {
        // Skip: step 1 is already saved; the recruit answer stays false and
        // Open to coach keeps its ON default for adults (player Skip ruling).
        patch = {
          onboarding_completed: true,
          coach_recruits_for_team: false,
          open_to_coach: adult,
        }
      }
      const { error: updateError } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (updateError) {
        captureError(updateError, mode === 'save' ? 'finishSave' : 'finishSkip')
        throw new Error('Could not save. Please try again.')
      }
      trackDbEvent('onboarding_step', 'profile', user.id, {
        step: mode === 'save' ? 'wizard_step_completed' : 'wizard_step_skipped',
        role: 'coach',
        wizard_step: 2,
      })
      if (draftKey) {
        try { localStorage.removeItem(draftKey) } catch { /* no-op */ }
      }
      await onFinished()
    } catch (err) {
      logger.error('[CoachSetup] step 2 save failed', err)
      setError(err instanceof Error ? err.message : 'Could not save. Please try again.')
      setSaving(false)
    }
  }

  const avatar = avatarUrl ? getImageUrl(avatarUrl, 'avatar-lg') ?? avatarUrl : null

  if (step === 1) {
    return (
      <AuthShell step={{ current: 1, total: 2 }} trailing={<SetupSignOut />}>
        <form
          onSubmit={(e) => { e.preventDefault(); void saveAboutYou() }}
          noValidate
          className="flex flex-1 flex-col pt-4"
        >
          <h1 className="text-title text-ink-1">About you</h1>

          <div className="mt-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void pickPhoto()}
              disabled={uploading}
              aria-label={avatar ? 'Change photo' : 'Add photo'}
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-grouped text-ink-3 disabled:opacity-60"
            >
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <Camera className="h-7 w-7" strokeWidth={1.75} />}
            </button>
            <div className="min-w-0 flex-1">
              <Button variant="tonal" size="small" loading={uploading} onClick={() => void pickPhoto()}>
                {avatar ? 'Change photo' : 'Add photo'}
              </Button>
              <p className="mt-1.5 text-caption text-ink-3">{COACH_PHOTO_HELPER}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
              className="hidden"
              aria-label="Upload profile photo"
            />
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="coach-setup-name" className={fieldLabel}>Full name</label>
              <input
                id="coach-setup-name"
                type="text"
                value={draft.fullName}
                onChange={(e) => set({ fullName: e.target.value })}
                className={cn(fieldInput, aboutErrors.fullName && fieldErrorRing)}
                autoComplete="name"
                autoCapitalize="words"
                maxLength={80}
                aria-invalid={Boolean(aboutErrors.fullName)}
                required
              />
              {aboutErrors.fullName && <p className={fieldErrorText}>{aboutErrors.fullName}</p>}
            </div>

            {dobLocked ? (
              <div>
                <span className={fieldLabel}>Date of birth</span>
                <p className={`${fieldReadOnly} justify-between`}>
                  {draft.dateOfBirth}
                  <Lock className="h-4 w-4 text-ink-4" aria-hidden="true" />
                </p>
                <p className="mt-1.5 text-caption text-ink-3">Locked after registration.</p>
              </div>
            ) : (
              <div>
                <DateOfBirthPicker
                  appearance="field"
                  label="Date of birth"
                  value={draft.dateOfBirth}
                  onChange={(next) => set({ dateOfBirth: next })}
                  error={aboutErrors.dateOfBirth}
                  required
                />
                <p className="mt-1.5 text-caption text-ink-3">Can’t be changed later. Never shown on your profile — only your age is.</p>
              </div>
            )}

            <CountrySelect
              appearance="field"
              label="Nationality"
              showNationality
              value={draft.nationalityCountryId}
              onChange={(id) => set({ nationalityCountryId: id })}
              placeholder="Choose a country"
              error={aboutErrors.nationality}
            />

            <CountrySelect
              appearance="field"
              label="Second nationality"
              optional
              showNationality
              value={draft.nationality2CountryId}
              onChange={(id) => set({ nationality2CountryId: id })}
              placeholder="Add a second nationality"
            />

            <LocationAutocomplete
              appearance="field"
              label="Base location"
              placeholder="City you’re based in"
              value={draft.location}
              onChange={(v) => set({ location: v, baseCity: '', baseCountryId: null, locationSelected: false })}
              onLocationSelect={(loc: LocationSelection) => set({ location: loc.displayName, baseCity: loc.city, baseCountryId: loc.countryId, locationSelected: true })}
              onLocationClear={() => set({ location: '', baseCity: '', baseCountryId: null, locationSelected: false })}
              isSelected={draft.locationSelected}
              error={aboutErrors.location}
            />

            <FormError>{error}</FormError>
          </div>

          <div className="mt-auto pt-8">
            <Button type="submit" block loading={saving}>Continue</Button>
          </div>
        </form>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      step={{ current: 2, total: 2 }}
      back={{ parent: 'About you', onBack: () => { setError(null); setCoachingErrors({}); setStep(1) } }}
      trailing={(
        <button type="button" onClick={() => void finish('skip')} disabled={saving} className="h-11 min-w-[44px] px-2 text-body text-hockia-primary disabled:opacity-40">
          Skip
        </button>
      )}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); void finish('save') }}
        noValidate
        className="flex flex-1 flex-col pt-4"
      >
        <h1 className="text-title text-ink-1">Your coaching</h1>
        <p className="mt-1.5 text-row text-ink-2">{COACH_STEP2_SUBTITLE}</p>

        <div className="mt-6 space-y-5">
          <div>
            <label htmlFor="coach-setup-specialization" className={fieldLabel}>Specialization</label>
            <select
              id="coach-setup-specialization"
              value={draft.specialization}
              onChange={(e) => set({ specialization: e.target.value })}
              className={cn(fieldSelect, coachingErrors.specialization && !(draft.specialization === 'other') && fieldErrorRing)}
              aria-invalid={Boolean(coachingErrors.specialization)}
              required
            >
              <option value="">Choose your specialization</option>
              {COACH_SPECIALIZATIONS.map((s) => <option key={s.value} value={s.value}>{sentenceCaseLabel(s.label)}</option>)}
            </select>
            {draft.specialization === 'other' && (
              <div className="mt-3">
                <label htmlFor="coach-setup-role-title" className={fieldLabel}>Role title</label>
                <input
                  id="coach-setup-role-title"
                  type="text"
                  value={draft.specializationCustom}
                  onChange={(e) => set({ specializationCustom: e.target.value })}
                  placeholder="e.g. Team manager"
                  className={cn(fieldInput, coachingErrors.specialization && fieldErrorRing)}
                  autoCapitalize="sentences"
                  maxLength={80}
                  aria-invalid={Boolean(coachingErrors.specialization)}
                  required
                />
              </div>
            )}
            {coachingErrors.specialization && <p className={fieldErrorText}>{coachingErrors.specialization}</p>}
          </div>

          <div role="group" aria-labelledby="coach-setup-categories-label">
            <p id="coach-setup-categories-label" className={fieldLabelText}>Coaching categories</p>
            <p className="mt-1 text-secondary text-ink-2">{COACH_CATEGORIES_HINT}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {CATEGORY_CHIPS.map((c) => (
                <Chip
                  key={c}
                  label={CATEGORY_LABELS[c]}
                  selected={draft.categories.includes(c)}
                  onClick={() => set({ categories: toggleCoachCategory(draft.categories, c, ANY_CATEGORY) })}
                />
              ))}
            </div>
            {coachingErrors.categories && <p className={fieldErrorText}>{coachingErrors.categories}</p>}
          </div>

          <WorldClubSearch
            appearance="field"
            label="Current club"
            optional
            placeholder="Search your club"
            value={draft.currentClub}
            onChange={(v) => set({ currentClub: v })}
            onClubSelect={(club) => set({ currentClub: club.club_name, currentWorldClubId: club.id })}
            onClubClear={() => set({ currentWorldClubId: null })}
            selectedClubId={draft.currentWorldClubId}
          />

          <div role="radiogroup" aria-labelledby="coach-setup-recruit-label">
            <p id="coach-setup-recruit-label" className={fieldLabelText}>{COACH_RECRUIT_QUESTION}</p>
            <p className="mt-1 text-secondary text-ink-2">{COACH_RECRUIT_HINT}</p>
            <div className="mt-2 space-y-2">
              {COACH_RECRUIT_OPTIONS.map((option) => {
                const selected = draft.recruitsForTeam === option.value
                return (
                  <button
                    key={String(option.value)}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => set({ recruitsForTeam: option.value })}
                    className={cn(
                      'flex min-h-[64px] w-full items-center gap-3 rounded-[12px] px-4 py-3 text-left transition-colors',
                      selected ? 'bg-hockia-soft ring-2 ring-inset ring-hockia-primary' : 'bg-white ring-1 ring-inset ring-line active:bg-surface-muted',
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-body font-semibold text-ink-1">{option.title}</span>
                      <span className="block text-secondary text-ink-2">{option.detail}</span>
                    </span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-hockia-primary" strokeWidth={2.5} aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
            {coachingErrors.recruits && <p className={fieldErrorText}>{coachingErrors.recruits}</p>}
          </div>

          {/* List item / Switch (Figma 472:186): muted card, SettingsRow + SettingsSwitch. */}
          <div className="overflow-hidden rounded-card bg-surface-muted" data-testid="open-to-coach-row">
            <SettingsRow
              title="Open to coach"
              subtitle={OPEN_TO_COACH_HELPER}
              trailing={<SettingsSwitch checked={draft.openToCoach} onChange={() => set({ openToCoach: !draft.openToCoach })} label="Open to coach" />}
            />
          </div>

          <FormError>{error}</FormError>
        </div>

        <div className="mt-auto pt-8">
          <Button type="submit" block loading={saving}>Finish</Button>
          <SetupSignOut placement="footer" />
        </div>
      </form>
    </AuthShell>
  )
}
