import { useImageCrop } from '@/components/media/ImageCropProvider'
import type { TablesUpdate } from '@/lib/database.types'
import { useEffect, useRef, useState } from 'react'
import { Lock, Plus } from 'lucide-react'
import { AuthShell, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ProfileIcon } from '@/components/icons/HockiaIcons'
import { fieldInput, fieldLabel, fieldReadOnly } from '@/components/ui/fieldClasses'
import CountrySelect from '@/components/CountrySelect'
import DateOfBirthPicker from '@/components/DateOfBirthPicker'
import LocationAutocomplete, { type LocationSelection } from '@/components/LocationAutocomplete'
import WorldClubSearch from '@/components/WorldClubSearch'
import { PlayerLeagueField } from '@/components/profile/mobile/PlayerLeagueField'
import { SettingsRow, SettingsSwitch } from '@/components/settings/settingsUi'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useCountries } from '@/hooks/useCountries'
import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'
import { validateImage } from '@/lib/imageOptimization'
import { uploadProfilePhoto } from '@/lib/profilePhoto'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { getImageUrl } from '@/lib/imageUrl'
import { logger } from '@/lib/logger'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { setOpenToPlay } from '@/lib/openToPlay'
import { leagueSideFor } from '@/lib/profileD2'
import { CATEGORY_LABELS, PLAYING_CATEGORIES, playingCategoryToLegacyGender, type PlayingCategory } from '@/lib/hockeyCategories'
import { positionLabel } from '@/lib/identity'
import { SetupSignOut } from './SetupSignOut'
import { withoutSensitiveDraftFields } from '@/lib/draftPrivacy'
import { AddPhotoPrompt } from '@/components/profile/AddPhotoPrompt'
import {
  PLAYER_POSITIONS,
  aboutYouProblem,
  offersOpenToPlay,
  setupDraftKey,
  tOnboardingEnglish,
} from '@/lib/onboardingV2'
import { Trans } from 'react-i18next'
import { useOnboardingT } from '@/i18n/ns/onboarding'

/**
 * Player set-up (Figma 04 Player 114:537 "About you" · 114:608 "Where you
 * play"). Step 1 of 2: photo, full name, date of birth, category, position,
 * second position — saved on Continue (the date of birth through
 * declare_date_of_birth, the existing one-shot gate: under 18 freezes the
 * account server-side and AgeGate's goodbye screen takes over; the date is
 * immutable once set). Step 2 of 2, skippable: current club, league, base
 * location, passports (max 2), Open to play. Continue or Skip finish
 * onboarding (onboarding_completed); Skip keeps the Open to play ON default
 * for adults. The caller does the refresh, analytics and navigation.
 *
 * Suggestions to clubs need open_to_play AND 18+ server-side, so the switch
 * is only offered to adults; under-18s see a line that promises nothing.
 *
 * Mounted by CompleteProfile for players who have not finished onboarding;
 * its auth / already-onboarded guards run first. Coaches, umpires, clubs and
 * brands keep their existing flows.
 */
interface PlayerSetupFlowProps {
  /** Runs once onboarding_completed is saved: refresh, analytics, navigate. */
  onFinished: () => Promise<void> | void
}

type Step = 1 | 2

interface Draft {
  fullName: string
  dateOfBirth: string
  playingCategory: PlayingCategory | ''
  position: string
  secondaryPosition: string
  currentClub: string
  currentWorldClubId: string | null
  ownLeagueId: number | null
  ownLeagueName: string | null
  clubLeagueName: string | null
  location: string
  baseCity: string
  baseCountryId: number | null
  locationSelected: boolean
  passport1: number | null
  passport2: number | null
  showSecondPassport: boolean
  openToPlay: boolean
}

export default function PlayerSetupFlow({ onFinished }: PlayerSetupFlowProps) {
  const t = useOnboardingT()
  const { user, profile, fetchProfile } = useAuthStore()
  const { getCountryById } = useCountries()
  const pendingCleanup = usePendingStorageCleanup()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const requestCrop = useImageCrop()
  const draftKey = user ? setupDraftKey(user.id) : null

  const [step, setStep] = useState<Step>(() => {
    // Resume at step 2 when step 1 is already saved (reload mid set-up).
    if (profile?.full_name && profile.date_of_birth && profile.position && profile.playing_category) return 2
    return 1
  })
  const [draft, setDraft] = useState<Draft>(() => {
    const base: Draft = {
      fullName: profile?.full_name ?? '',
      // Saved profile DOB → the DOB a legacy sign-up left in auth metadata → empty.
      dateOfBirth: profile?.date_of_birth ?? ((user?.user_metadata?.dob as string | undefined) || ''),
      playingCategory: (profile?.playing_category as PlayingCategory | null) ?? '',
      position: profile?.position ?? '',
      secondaryPosition: profile?.secondary_position ?? '',
      currentClub: profile?.current_club ?? '',
      currentWorldClubId: profile?.current_world_club_id ?? null,
      ownLeagueId: null,
      ownLeagueName: null,
      clubLeagueName: null,
      location: profile?.base_location ?? '',
      baseCity: profile?.base_city ?? '',
      baseCountryId: profile?.base_country_id ?? null,
      locationSelected: Boolean(profile?.base_location),
      passport1: profile?.nationality_country_id ?? null,
      passport2: profile?.nationality2_country_id ?? null,
      showSecondPassport: Boolean(profile?.nationality2_country_id),
      openToPlay: true,
    }
    if (draftKey) {
      try {
        const raw = localStorage.getItem(draftKey)
        if (raw) {
          const parsed = JSON.parse(raw) as { draft?: Partial<Draft>; savedAt?: string }
          const ageDays = parsed.savedAt ? (Date.now() - Date.parse(parsed.savedAt)) / 86_400_000 : 0
          if (Number.isFinite(ageDays) && ageDays <= 7 && parsed.draft) {
            // Date of birth and passports are not in drafts: they come from the profile or are asked again.
            return { ...base, ...withoutSensitiveDraftFields(parsed.draft) }
          }
        }
      } catch {
        /* storage blocked — server prefill is the fallback */
      }
    }
    return base
  })
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url ?? '')
  // The same photo in its own shape, for full-screen views (saved with avatar_url).
  const [avatarFullUrl, setAvatarFullUrl] = useState<string | null>(profile?.avatar_full_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [photoPromptDismissed, setPhotoPromptDismissed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewedRef = useRef<Set<Step>>(new Set())

  const set = (patch: Partial<Draft>) => setDraft((prev) => ({ ...prev, ...patch }))

  useEffect(() => {
    if (!draftKey) return
    try {
      localStorage.setItem(draftKey, JSON.stringify({ draft: withoutSensitiveDraftFields(draft), savedAt: new Date().toISOString() }))
    } catch {
      /* quota / blocked — no-op */
    }
  }, [draft, draftKey])

  // `wizard_step_viewed` once per step (same DB funnel step names as the
  // legacy wizard; wizard_step 1–2 instead of 1–3).
  useEffect(() => {
    if (!user?.id || viewedRef.current.has(step)) return
    viewedRef.current.add(step)
    trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_viewed', role: 'player', wizard_step: step })
    if (typeof window.scrollTo === 'function') {
      try { window.scrollTo(0, 0) } catch { /* jsdom */ }
    }
  }, [step, user?.id])

  if (!user) return null

  const dobLocked = Boolean(profile?.date_of_birth)
  const adult = offersOpenToPlay(profile?.date_of_birth ?? draft.dateOfBirth)

  // ── Photo ──
  const uploadPhoto = async (file: File | undefined) => {
    if (!file) return
    const check = validateImage(file, { maxFileSizeMB: 5 })
    if (!check.valid) { setError(check.error ?? t('player.photo.invalid')); return }
    const square = await requestCrop(file, 'person')
    if (!square) return
    setUploading(true)
    setError(null)
    try {
      const { avatarUrl: publicUrl, avatarFullUrl: fullUrl } = await uploadProfilePhoto(user.id, file, { square })
      const previous = avatarUrl || profile?.avatar_url || null
      const previousFull = avatarFullUrl
      setAvatarUrl(publicUrl)
      setAvatarFullUrl(fullUrl)
      if (previousFull && previousFull !== fullUrl) pendingCleanup.queue({ bucket: 'avatars', publicUrl: previousFull, context: 'player-setup:replace-avatar-full' })
      if (fullUrl) pendingCleanup.unqueue(fullUrl)
      // Replaced files go only after the row points at the new one (incident 2026-07-30).
      if (previous && previous !== publicUrl) pendingCleanup.queue({ bucket: 'avatars', publicUrl: previous, context: 'player-setup:replace-avatar' })
      pendingCleanup.unqueue(publicUrl)
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'avatar_uploaded', role: 'player' })
    } catch (err) {
      logger.error('[PlayerSetup] photo upload failed', err)
      setError(t('player.photo.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }
  const pickPhoto = async () => {
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt', { crop: false })
        if (result) await uploadPhoto(result.file)
      } catch (err) {
        logger.error('[PlayerSetup] native picker failed', err)
        setError(t('player.photo.pickerFailed'))
      }
      return
    }
    fileRef.current?.click()
  }

  /** The row must exist before UPDATE (safety net shared with CompleteProfile). */
  const ensureRow = async () => {
    const { data: existing } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()
    if (existing) return
    const { error: createError } = await supabase.rpc('create_profile_for_new_user', { user_id: user.id, user_email: user.email || '', user_role: 'player' })
    if (createError) throw createError
  }

  // ── Step 1 → save About you ──
  const saveAboutYou = async () => {
    if (saving) return
    const problem = aboutYouProblem(draft, t)
    if (problem) {
      setError(problem)
      // The funnel keeps the English reason whatever the interface language.
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_validation_failed', role: 'player', wizard_step: 1, reason: aboutYouProblem(draft, tOnboardingEnglish) })
      return
    }
    setSaving(true)
    setError(null)
    try {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) logger.warn('[PlayerSetup] session refresh failed', refreshError)
      await ensureRow()
      // Date of birth: written only through the one-shot gate. 'frozen' ends
      // set-up here — the refreshed profile flips AgeGate to its goodbye screen.
      if (!dobLocked) {
        const { data, error: dobError } = await supabase.rpc('declare_date_of_birth', { p_dob: draft.dateOfBirth })
        if (dobError) throw new Error(t('player.errors.dobSave'))
        const outcome = (data as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') throw new Error(t('player.errors.dobInvalid'))
        if (outcome === 'frozen') {
          await fetchProfile(user.id, { force: true })
          return
        }
      }
      const category = draft.playingCategory || null
      const { error: updateError } = await supabase.from('profiles').update({
        role: 'player',
        full_name: draft.fullName.trim(),
        playing_category: category,
        // Legacy dual-write kept from the previous wizard (Discovery still reads gender).
        gender: playingCategoryToLegacyGender(category),
        category_confirmation_needed: false,
        position: draft.position,
        secondary_position: draft.secondaryPosition || null,
        avatar_url: avatarUrl || null,
        // Only when the photo changed here: never overwrite a full photo this screen didn't load.
        ...(avatarUrl !== (profile?.avatar_url ?? '') ? { avatar_full_url: avatarUrl ? avatarFullUrl : null } : {}),
      }).eq('id', user.id)
      if (updateError) throw updateError
      await pendingCleanup.flush()
      await fetchProfile(user.id, { force: true })
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'wizard_step_completed', role: 'player', wizard_step: 1 })
      setStep(2)
    } catch (err) {
      logger.error('[PlayerSetup] step 1 save failed', err)
      setError(err instanceof Error ? err.message : t('player.errors.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  // ── Step 2 → save Where you play (or skip) and finish ──
  const finish = async (mode: 'save' | 'skip') => {
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) logger.warn('[PlayerSetup] session refresh failed', refreshError)
      await ensureRow()
      let patch: TablesUpdate<'profiles'> = { onboarding_completed: true }
      if (mode === 'save') {
        const first = draft.passport1 ? getCountryById(draft.passport1) : undefined
        patch = {
          ...patch,
          current_club: draft.currentClub.trim() || null,
          current_world_club_id: draft.currentWorldClubId,
          base_location: draft.location.trim() || null,
          base_city: draft.baseCity || null,
          base_country_id: draft.baseCountryId,
          nationality_country_id: draft.passport1,
          nationality2_country_id: draft.showSecondPassport ? draft.passport2 : null,
          // Players store the demonym here (CompleteProfile's rule).
          nationality: first?.nationality_name ?? '',
        }
        // The player's own league only when the club has none on Hockia —
        // shown as self-reported, never counted for level (ruling 2026-09-26).
        if (!draft.clubLeagueName) {
          const side = leagueSideFor(draft.playingCategory || null)
          patch[side] = draft.ownLeagueId
          patch[side === 'mens_league_id' ? 'mens_league_division' : 'womens_league_division'] = draft.ownLeagueName
        }
      }
      const { error: updateError } = await supabase.from('profiles').update(patch).eq('id', user.id)
      if (updateError) throw updateError
      // Open to play: Continue saves the switch; Skip saves its ON default
      // (founder ruling 2026-10-03) — adults only, through the RPC so
      // availability_confirmed_at is stamped. Refused outcomes (under_18,
      // dob_required) are not errors for the set-up. Under 18: nothing saved.
      if (adult && (mode === 'skip' || draft.openToPlay)) {
        const result = await setOpenToPlay({ open: true })
        if (!result.ok) logger.debug('[PlayerSetup] open to play not saved', result.outcome)
      }
      trackDbEvent('onboarding_step', 'profile', user.id, {
        step: mode === 'save' ? 'wizard_step_completed' : 'wizard_step_skipped',
        role: 'player',
        wizard_step: 2,
      })
      if (draftKey) {
        try { localStorage.removeItem(draftKey) } catch { /* no-op */ }
      }
      await onFinished()
    } catch (err) {
      logger.error('[PlayerSetup] step 2 save failed', err)
      setError(err instanceof Error ? err.message : t('player.errors.saveFailed'))
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
          <h1 className="text-title text-ink-1">{t('player.about.title')}</h1>

          {/* Rebrand page 26 · Set up 1: 88 photo picker + "Add a photo" link. */}
          <div className="mt-5 flex items-center gap-4">
            <button
              type="button"
              onClick={() => void pickPhoto()}
              disabled={uploading}
              aria-label={avatar ? t('player.photo.changeAria') : t('player.photo.addAria')}
              className="flex h-[88px] w-[88px] shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-muted text-ink-3 ring-1 ring-inset ring-line disabled:opacity-60"
            >
              {avatar ? <img src={avatar} alt="" className="h-full w-full object-cover" /> : <ProfileIcon className="h-8 w-8" />}
            </button>
            <div className="min-w-0 flex-1">
              <button type="button" onClick={() => void pickPhoto()} disabled={uploading} className="h-11 text-[15px] font-semibold text-brand-text disabled:opacity-60" data-testid="setup-photo-link">
                {uploading ? t('player.photo.uploading') : avatar ? t('player.photo.change') : t('player.photo.add')}
              </button>
              <p className="text-caption text-ink-3">{t('player.photo.helper')}</p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
              className="hidden"
              aria-label={t('player.photo.inputLabel')}
            />
          </div>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="setup-name" className={fieldLabel}>{t('player.about.fullName')}</label>
              <input
                id="setup-name"
                type="text"
                value={draft.fullName}
                onChange={(e) => set({ fullName: e.target.value })}
                className={fieldInput}
                autoComplete="name"
                autoCapitalize="words"
                maxLength={80}
                required
              />
            </div>

            {dobLocked ? (
              <div>
                <span className={fieldLabel}>{t('player.about.dateOfBirth')}</span>
                <p className={`${fieldReadOnly} justify-between`}>
                  {draft.dateOfBirth}
                  <Lock className="h-4 w-4 text-ink-4" aria-hidden="true" />
                </p>
                <p className="mt-1.5 text-caption text-ink-3">{t('player.about.dobLocked')}</p>
              </div>
            ) : (
              <div>
                <DateOfBirthPicker appearance="field" label={t('player.about.dateOfBirth')} value={draft.dateOfBirth} onChange={(next) => set({ dateOfBirth: next })} required />
                <p className="mt-1.5 text-caption text-ink-3">{t('player.about.dobHint')}</p>
              </div>
            )}

            {/* Category and positions as selectable chips (rebrand page 26). */}
            <ChoiceChips
              id="setup-category"
              label={t('player.about.category')}
              options={PLAYING_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))}
              value={draft.playingCategory}
              onChange={(v) => set({ playingCategory: v as PlayingCategory })}
            />
            <ChoiceChips
              id="setup-position"
              label={t('player.about.position')}
              options={PLAYER_POSITIONS.map((p) => ({ value: p, label: positionLabel(p) ?? p }))}
              value={draft.position}
              onChange={(v) => set({ position: v, secondaryPosition: draft.secondaryPosition === v ? '' : draft.secondaryPosition })}
            />
            <ChoiceChips
              id="setup-second-position-optional-"
              label={t('player.about.secondPosition')}
              options={PLAYER_POSITIONS.filter((p) => p !== draft.position).map((p) => ({ value: p, label: positionLabel(p) ?? p }))}
              value={draft.secondaryPosition}
              onChange={(v) => set({ secondaryPosition: draft.secondaryPosition === v ? '' : v })}
            />

            <FormError>{error}</FormError>
          </div>

          <div className="mt-auto pt-8">
            <Button type="submit" block loading={saving}>{t('player.about.continue')}</Button>
          </div>
        </form>
      </AuthShell>
    )
  }

  const fallbackCountryId = draft.baseCountryId ?? draft.passport1

  return (
    <AuthShell
      step={{ current: 2, total: 2 }}
      back={{ parent: t('player.where.back'), onBack: () => { setError(null); setStep(1) } }}
      trailing={(
        <button type="button" onClick={() => void finish('skip')} disabled={saving} className="h-11 px-2 text-body text-hockia-primary disabled:opacity-40">
          {t('player.where.skip')}
        </button>
      )}
    >
      <form
        onSubmit={(e) => { e.preventDefault(); void finish('save') }}
        noValidate
        className="flex flex-1 flex-col pt-4"
      >
        <h1 className="text-title text-ink-1">{t('player.where.title')}</h1>
        <p className="mt-1.5 text-row text-ink-2">{t('player.where.subtitle')}</p>

        {/* End of onboarding (founder 2026-10-26): no photo yet → the Add a
            photo prompt; dismissible, never blocks Finish. */}
        {!avatar && !photoPromptDismissed && (
          <>
            <AddPhotoPrompt className="mt-5" role="player" secondary busy={uploading} onAdd={() => void pickPhoto()} onDismiss={() => setPhotoPromptDismissed(true)} />
            <input
              ref={fileRef}
              type="file"
              accept=".jpg,.jpeg,.png,image/jpeg,image/png"
              onChange={(e) => void uploadPhoto(e.target.files?.[0])}
              className="hidden"
              aria-label={t('player.photo.inputLabel')}
            />
          </>
        )}

        <div className="mt-6 space-y-4">
          <WorldClubSearch
            appearance="field"
            label={t('player.where.club')}
            placeholder={t('player.where.clubPlaceholder')}
            value={draft.currentClub}
            onChange={(v) => set({ currentClub: v })}
            onClubSelect={(club) => set({ currentClub: club.club_name, currentWorldClubId: club.id, ownLeagueId: null, ownLeagueName: null })}
            onClubClear={() => set({ currentWorldClubId: null, ownLeagueId: null, ownLeagueName: null })}
            selectedClubId={draft.currentWorldClubId}
          />

          <PlayerLeagueField
            worldClubId={draft.currentWorldClubId}
            fallbackCountryId={fallbackCountryId}
            playingCategory={draft.playingCategory || null}
            value={draft.ownLeagueId}
            onChange={(id, name) => set({ ownLeagueId: id, ownLeagueName: name })}
            onClubLeague={(name) => set({ clubLeagueName: name })}
          />

          <LocationAutocomplete
            appearance="field"
            label={t('player.where.location')}
            placeholder={t('player.where.locationPlaceholder')}
            value={draft.location}
            onChange={(v) => set({ location: v, baseCity: '', baseCountryId: null, locationSelected: false })}
            onLocationSelect={(loc: LocationSelection) => set({ location: loc.displayName, baseCity: loc.city, baseCountryId: loc.countryId, locationSelected: true })}
            onLocationClear={() => set({ location: '', baseCity: '', baseCountryId: null, locationSelected: false })}
            isSelected={draft.locationSelected}
          />

          <div className="space-y-3">
            <CountrySelect
              appearance="field"
              label={t('player.where.passport')}
              showNationality
              value={draft.passport1}
              onChange={(id) => set({ passport1: id })}
              placeholder={t('player.where.countryPlaceholder')}
            />
            {draft.showSecondPassport ? (
              <CountrySelect
                appearance="field"
                label={t('player.where.secondPassport')}
                showNationality
                value={draft.passport2}
                onChange={(id) => set({ passport2: id })}
                placeholder={t('player.where.countryPlaceholder')}
              />
            ) : (
              <Button variant="link" size="small" icon={<Plus className="h-4 w-4" />} onClick={() => set({ showSecondPassport: true })} className="-ml-3.5">
                {t('player.where.addSecond')}
              </Button>
            )}
          </div>

          {/* List item / Switch (Figma 472:186): the grouped row Settings and
              Confirm signing use — muted card, SettingsRow + SettingsSwitch. */}
          {adult ? (
            <div className="overflow-hidden rounded-card bg-surface-muted" data-testid="open-to-play-row">
              <SettingsRow
                title={t('player.where.openToPlay')}
                subtitle={t('player.where.openToPlayHelper')}
                trailing={<SettingsSwitch checked={draft.openToPlay} onChange={() => set({ openToPlay: !draft.openToPlay })} label={t('player.where.openToPlay')} />}
              />
            </div>
          ) : (
            <div className="rounded-card bg-surface-muted px-4 py-3" data-testid="open-to-play-row">
              {(profile?.date_of_birth ?? draft.dateOfBirth) ? (
                <p className="text-secondary text-ink-2">
                  <Trans
                    t={t}
                    i18nKey="player.where.under18"
                    components={{ waitlistLink: <a href="/juniors-waitlist" className="font-semibold text-brand-primary" data-testid="juniors-waitlist-link" /> }}
                  />
                </p>
              ) : (
                <p className="text-secondary text-ink-2">{t('player.where.needsDob')}</p>
              )}
            </div>
          )}

          <FormError>{error}</FormError>
        </div>

        <div className="mt-auto pt-8">
          <Button type="submit" block loading={saving}>{t('player.where.continue')}</Button>
          <SetupSignOut placement="footer" />
        </div>
      </form>
    </AuthShell>
  )
}

/** Single-choice chip group (Chip / Selectable, rebrand page 26). Tapping the
 *  chosen chip again only clears optional groups (handled by the caller). */
function ChoiceChips({ id, label, options, value, onChange }: { id: string; label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <span id={id} className={fieldLabel}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => (
          <Chip key={o.value} label={o.label} selected={value === o.value} role="radio" aria-checked={value === o.value} aria-pressed={undefined} onClick={() => onChange(o.value)} />
        ))}
      </div>
    </div>
  )
}
