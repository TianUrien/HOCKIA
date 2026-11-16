import type { TablesUpdate } from '@/lib/database.types'
import { lazy, Suspense, useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, MapPin, Calendar, Building2, Camera, X, Check } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { Input, Button, CountrySelect, LocationAutocomplete, MultiCategorySelector, DateOfBirthPicker } from '@/components'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { useCountries } from '@/hooks/useCountries'
import ClubClaimStep, { type ClubClaimResult } from '@/components/ClubClaimStep'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { validateImage } from '@/lib/imageOptimization'
import { uploadProfilePhoto } from '@/lib/profilePhoto'
import { getImageUrl } from '@/lib/imageUrl'
import { invalidateProfile } from '@/lib/profile'
import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { toSentryError } from '@/lib/sentryHelpers'
import { trackOnboardingComplete, trackOnboardingStart, trackRoleSelected } from '@/lib/analytics'
import { trackDbEvent, consumeWallIntent } from '@/lib/trackDbEvent'
import { consumeCarriedRedirect } from '@/lib/redirectIntentCarry'
import { getAttributionState, submitSignupAttribution } from '@/lib/attribution'
import { validateOnboardingStep, type WizardStep } from '@/lib/onboardingValidation'
import { UMPIRE_LEVEL_SUGGESTIONS } from '@/lib/umpireLevels'
import { FEDERATION_SUGGESTIONS } from '@/lib/umpireFederations'
import { LANGUAGE_SUGGESTIONS } from '@/lib/languages'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { showsClubSetup } from '@/lib/clubSetup'
import { markOnboardingCompletedOnDevice } from '@/lib/overlaySequence'
import { legacyWizardDraftKey, parseWizardDraft, serializeWizardDraft, tOnboardingEnglish } from '@/lib/onboardingV2'
import { Trans } from 'react-i18next'
import { useOnboardingT } from '@/i18n/ns/onboarding'
import ChooseRoleScreen from '@/components/onboarding/ChooseRoleScreen'
import { SetupSignOut } from '@/components/onboarding/SetupSignOut'
import { Button as UiButton } from '@/components/ui/Button'
import {
  type PlayingCategory,
  type CoachUmpireCategory,
  playingCategoryToLegacyGender,
  isValidPlayingCategory,
  isValidCategoryArray,
} from '@/lib/hockeyCategories'

// Club set-up (Figma 04 Club D1.24): phone clubs only, in its own chunk.
const ClubSetupFlow = lazy(() => import('@/components/club/ClubSetupFlow'))
// Player set-up (Figma 04 Player 114:537 / 114:608): own chunk.
const PlayerSetupFlow = lazy(() => import('@/components/onboarding/PlayerSetupFlow'))
// Coach set-up (Figma New-Hockia D6.5 586:806 / D6.6 586:849): own chunk.
const CoachSetupFlow = lazy(() => import('@/components/onboarding/CoachSetupFlow'))

type UserRole = 'player' | 'coach' | 'club' | 'brand' | 'umpire'

type OfficiatingSpecialization = 'outdoor' | 'indoor' | 'both' | ''

/**
 * CompleteProfile - Step 2 of signup (POST email verification)
 * 
 * SIMPLIFIED APPROACH:
 * - Uses global auth store (useAuthStore) for user and profile data
 * - No duplicate profile fetching (auth store handles it)
 * - No complex profile creation logic (DB trigger handles it)
 * - Focus on form submission and data update only
 * 
 * Flow:
 * 1. User has verified email and active session (from AuthCallback)
 * 2. Auth store has fetched profile (from initializeAuth)
 * 3. User fills form with complete details
 * 4. Update profile row with full data + onboarding_completed flag
 * 5. Refresh auth store and navigate to dashboard
 */
export default function CompleteProfile() {
  const navigate = useNavigate()
  const t = useOnboardingT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const profilePrefilledRef = useRef(false)
  const contactPrefilledRef = useRef<string | null>(null)
  // Mutex ref to prevent concurrent profile creation attempts (race condition guard)
  const profileCreationMutexRef = useRef(false)
  const { user, profile, loading: authLoading, profileStatus, fetchProfile } = useAuthStore()
  // Club v2 is phone-only: phone clubs get the D1.24 set-up instead of the
  // classic form below; desktop and every other role keep today's flow.
  const isPhone = useMediaQuery('(max-width: 1023px)')
  // Set once a set-up flow (club → Opportunities, player → profile) has
  // finished and is navigating on, so the already-onboarded redirect below
  // doesn't race it. Never set on any other path.
  const setupFinishedRef = useRef(false)
  const { getCountryById } = useCountries()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // The browser lost the session between sign-in and choosing a role (prod 2026-10-17).
  const [sessionExpired, setSessionExpired] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url || '')
  // The same photo in its own shape, for full-screen views (people only; saved with avatar_url).
  const [avatarFullUrl, setAvatarFullUrl] = useState<string | null>(profile?.avatar_full_url ?? null)
  // Replaced avatars are deleted only after the profile row is saved — see
  // the hook's header for the prod incident this prevents.
  const pendingCleanup = usePendingStorageCleanup()
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  // Hydrate from localStorage synchronously on first render. Reading these in
  // a useEffect (as we did before) caused a 1-frame flash of the inline
  // role-picker UI on the path: OAuth signup → /complete-profile mounts with
  // profile=null, user_metadata.role=null, fallbackRole=null → renders the
  // role picker → useEffect fires → fallbackRole='player' → re-renders the
  // real flow. Lazy initializer eliminates the flash. The post-mount useEffect
  // below remains as a safety net for late-arriving stashes (e.g., another
  // tab writing pending_role mid-render).
  const [fallbackRole, setFallbackRole] = useState<UserRole | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      return (window.localStorage.getItem('pending_role') as UserRole | null) ?? null
    } catch {
      return null
    }
  })
  const [fallbackEmail, setFallbackEmail] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    try {
      return window.localStorage.getItem('pending_email') ?? ''
    } catch {
      return ''
    }
  })
  const [creatingProfile, setCreatingProfile] = useState(false)
  
  // Club claim step state (for clubs only)
  const [showClubClaimStep, setShowClubClaimStep] = useState(true)

  // Staged wizard state for the umpire flow — splits the single long form into
  // 3 progressive steps (identity → background → role details). Club and brand
  // keep their existing flows untouched.
  const [currentStep, setCurrentStep] = useState<WizardStep>(1)
  // Guards the step-viewed analytics so we emit once per (step, role) entry,
  // not on every rerender. Drop-off is computed at analysis time from
  // `wizard_step_viewed` vs. `wizard_step_completed` counts per step.
  const viewedStepsRef = useRef<Set<string>>(new Set())

  // Wizard-draft hydration guard. Refs declared up here; the actual
  // wizardDraftKey is computed AFTER userRole is derived (it depends on
  // both user.id and userRole, which need to be in scope first).
  const wizardDraftHydratedRef = useRef(false)
  // Set on the commit that restores a draft, so persistence skips writing the
  // not-yet-restored form over it in that same commit.
  const wizardDraftSkipPersistRef = useRef(false)

  // Form data states
  const [formData, setFormData] = useState({
    fullName: '',
    clubName: '',
    city: '',
    baseCity: '',
    baseCountryId: null as number | null,
    locationSelected: false,
    nationality: '',
    nationalityCountryId: null as number | null,
    nationality2CountryId: null as number | null,
    dateOfBirth: '',
    position: '',
    secondaryPosition: '',
    // Phase 3 hockey categories. Player picks one (single-select); umpires
    // pick many (multi-select with optional [any] sentinel).
    playingCategory: '' as PlayingCategory | '',
    umpiringCategories: [] as CoachUmpireCategory[],
    yearFounded: '',
    womensLeagueDivision: '',
    mensLeagueDivision: '',
    website: '',
    contactEmail: '',
    clubBio: '',
    clubHistory: '',
    currentClub: '',
    currentWorldClubId: null as string | null,
    // Umpire-specific fields (free text for level + federation in v1; see
    // umpireLevels.ts / umpireFederations.ts for the datalist suggestions).
    umpireLevel: '',
    federation: '',
    umpireSince: '',
    officiatingSpecialization: '' as OfficiatingSpecialization,
    languages: [] as string[],
    // Controlled value for the language chip-picker input. Kept in formData
    // so handleNext / handleSubmit can flush uncommitted text into
    // `languages[]` before validating, avoiding a blur-vs-submit race where
    // a user typing "English" then clicking the button saw a "please add a
    // language" error despite the input being populated.
    pendingLanguage: '',
  })

  // Use profile data from auth store - no need to fetch again
  const userRole = (profile?.role as UserRole | null) ?? fallbackRole ?? (user?.user_metadata?.role as UserRole | undefined) ?? null
  const contactEmailFallback = profile?.contact_email ?? profile?.email ?? user?.email ?? fallbackEmail ?? ''

  // Fire onboarding_start once, when the role is known (the wizard begins) —
  // pairs with onboarding_complete to measure the onboarding funnel drop-off.
  const onboardingStartFiredRef = useRef(false)
  useEffect(() => {
    if (onboardingStartFiredRef.current || !userRole) return
    onboardingStartFiredRef.current = true
    trackOnboardingStart(userRole)
    // DB funnel: the "registration started" step (wizard entered).
    trackDbEvent('registration_started', 'profile', user?.id, {
      role: userRole,
      source_path: getAttributionState()?.first?.landing_page ?? null,
    })
  }, [userRole, user?.id])

  // Wizard-draft localStorage key. Scoped by user id AND role so a tester
  // switching between accounts on the same browser doesn't see another
  // user's draft, and a user who switches role mid-flow doesn't see a
  // player draft on a coach mount. null when either is missing — effects
  // gate on this and skip persistence until both resolve. (Players and
  // coaches keep their own drafts in PlayerSetupFlow / CoachSetupFlow.)
  const wizardDraftKey = user?.id && userRole ? legacyWizardDraftKey(userRole, user.id) : null

  // Umpires get the 3-step wizard. Players and coaches have their own two-step
  // set-up flows; club keeps its claim→form flow; brand has its own page.
  const isWizardFlow = userRole === 'umpire'

  const stepLabels: Record<UserRole, Record<WizardStep, string>> = {
    player: {
      1: t('complete.steps.aboutYou'),
      2: t('complete.steps.whereBased'),
      3: t('complete.steps.yourGame'),
    },
    coach: { 1: '', 2: '', 3: '' },
    umpire: {
      1: t('complete.steps.aboutYou'),
      2: t('complete.steps.whereBased'),
      3: t('complete.steps.credentials'),
    },
    club: { 1: '', 2: '', 3: '' },
    brand: { 1: '', 2: '', 3: '' },
  }

  const captureOnboardingError = (error: unknown, payload: Record<string, unknown>, sourceComponent: string) => {
    Sentry.captureException(toSentryError(error), {
      tags: {
        feature: 'onboarding_profile',
        onboarding_role: (payload?.role as string) ?? userRole ?? 'unknown',
        onboarding_stage: (payload?.stage as string) ?? 'unknown',
      },
      extra: {
        userId: user?.id ?? null,
        payload,
        sourceComponent,
      },
    })
  }

  const onboardingBreadcrumb = (message: string, data?: Record<string, unknown>) => {
    Sentry.addBreadcrumb({
      category: 'onboarding',
      level: 'info',
      message,
      data: { userId: user?.id ?? null, role: userRole ?? null, ...data },
    })
  }

  /**
   * Create profile for OAuth users who don't have a profile row yet.
   * Uses the create_profile_for_new_user RPC function.
   * 
   * IMPORTANT: Uses mutex ref to prevent race conditions where multiple
   * clicks or re-renders could trigger concurrent profile creation attempts.
   */
  const handleRoleSelection = async (selectedRole: UserRole) => {
    // Mutex check - prevent concurrent execution
    if (profileCreationMutexRef.current) {
      logger.debug('[COMPLETE_PROFILE] Profile creation already in progress, ignoring duplicate call')
      return
    }

    if (!user) {
      setError(t('complete.errors.noSession'))
      return
    }

    // Acquire mutex BEFORE any async operation
    profileCreationMutexRef.current = true
    trackRoleSelected(selectedRole)
    setCreatingProfile(true)
    setError('')

    try {
      logger.debug('[COMPLETE_PROFILE] Creating profile for OAuth user', { userId: user.id, role: selectedRole })
      onboardingBreadcrumb('role_selected.start', { role: selectedRole })

      const userEmail = user.email || ''

      // The RPC needs the member's session. The page can still hold a user
      // after the client lost its token (prod 2026-10-17: "requires
      // authentication" four times in a row, sign-up lost), so make sure a
      // session exists first and retry once after a refresh.
      let { data: { session } } = await supabase.auth.getSession()
      if (!session) session = (await supabase.auth.refreshSession().catch(() => null))?.data.session ?? null
      if (!session) {
        onboardingBreadcrumb('role_selected.no_session', { role: selectedRole })
        setSessionExpired(true)
        setError(t('complete.errors.signInExpired'))
        profileCreationMutexRef.current = false
        return
      }
      const createProfile = () => supabase.rpc('create_profile_for_new_user', {
        user_id: user.id,
        user_email: userEmail,
        user_role: selectedRole,
      })
      let { data: newProfile, error: rpcError } = await createProfile()
      if (rpcError && /requires authentication/i.test(rpcError.message)) {
        await supabase.auth.refreshSession().catch(() => { /* the retry below reports it */ })
        ;({ data: newProfile, error: rpcError } = await createProfile())
        if (rpcError && /requires authentication/i.test(rpcError.message)) {
          onboardingBreadcrumb('role_selected.no_session', { role: selectedRole, after: 'retry' })
          setSessionExpired(true)
          setError(t('complete.errors.signInExpired'))
          profileCreationMutexRef.current = false
          return
        }
      }

      if (rpcError) {
        captureOnboardingError(rpcError, {
          role: selectedRole,
          stage: 'createProfileForOAuth',
        }, 'CompleteProfile.handleRoleSelection.rpc')
        throw new Error(t('complete.errors.createFailedDetail', { message: rpcError.message }))
      }

      logger.debug('[COMPLETE_PROFILE] Profile created successfully', { profileId: newProfile?.id })

      // Store role in localStorage as backup
      localStorage.setItem('pending_role', selectedRole)
      localStorage.setItem('pending_email', userEmail)

      // Update fallback role immediately for UI
      setFallbackRole(selectedRole)

      // Refresh the profile in auth store
      await fetchProfile(user.id, { force: true })

      logger.debug('[COMPLETE_PROFILE] Profile fetched after creation')
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'role_selected', role: selectedRole })

      onboardingBreadcrumb('role_selected.success', { role: selectedRole })

      // Brands have a separate onboarding flow
      if (selectedRole === 'brand') {
        onboardingBreadcrumb('redirect.brand_onboarding', { role: selectedRole })
        navigate('/brands/onboarding')
        return
      }
    } catch (err) {
      captureOnboardingError(err, {
        stage: 'handleRoleSelectionCatch',
      }, 'CompleteProfile.handleRoleSelection.catch')
      logger.error('[COMPLETE_PROFILE] Error creating profile:', err)
      setError(err instanceof Error ? err.message : t('complete.errors.createFailed'))
      // Release mutex on error so user can retry
      profileCreationMutexRef.current = false
    } finally {
      setCreatingProfile(false)
      // Note: We intentionally do NOT release the mutex on success
      // because the profile was created and we don't want any further attempts
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const storedRole = window.localStorage.getItem('pending_role') as UserRole | null
      const storedEmail = window.localStorage.getItem('pending_email') || ''
      if (storedRole && !fallbackRole) {
        setFallbackRole(storedRole)
      }
      if (storedEmail && !fallbackEmail) {
        setFallbackEmail(storedEmail)
      }
    }
  }, [fallbackRole, fallbackEmail])

  useEffect(() => {
    logger.debug('[COMPLETE_PROFILE]', {
      authLoading,
      hasUser: !!user,
      hasProfile: !!profile,
      role: profile?.role,
      fullName: profile?.full_name,
      profileStatus
    })

    // Wait for auth to load
    if (authLoading || (profileStatus === 'fetching' && !profile)) return

    // No user → redirect to signup
    if (!user) {
      logger.debug('[COMPLETE_PROFILE] No user, redirecting to signup')
      navigate('/signup', { replace: true })
      return
    }

    // Brand users have a separate onboarding flow
    if (profile?.role === 'brand' && !profile?.onboarding_completed) {
      logger.debug('[COMPLETE_PROFILE] Brand user, redirecting to brand onboarding')
      navigate('/brands/onboarding', { replace: true })
      return
    }

    // Already-onboarded users navigating here directly should bounce to
    // their dashboard rather than re-running the wizard. Without this guard
    // a returning user can re-submit the form and overwrite their existing
    // data with whatever the form's pre-filled state happens to contain
    // (which has known gaps for some fields, see the prefill effect).
    if (profile?.onboarding_completed) {
      if (setupFinishedRef.current) return
      logger.debug('[COMPLETE_PROFILE] User already onboarded, redirecting to dashboard')
      navigate('/dashboard/profile', { replace: true })
    }
  }, [user, profile, authLoading, navigate, profileStatus])

  useEffect(() => {
    if (!contactEmailFallback) {
      return
    }

    setFormData(prev => {
      if (prev.contactEmail && prev.contactEmail !== contactPrefilledRef.current) {
        return prev
      }
      contactPrefilledRef.current = contactEmailFallback
      return { ...prev, contactEmail: contactEmailFallback }
    })
  }, [contactEmailFallback])

  useEffect(() => {
    if (!profile || profilePrefilledRef.current) {
      return
    }

    profilePrefilledRef.current = true
    setFormData(prev => {
      const next = { ...prev }
      next.city = profile.base_location ?? prev.city
      next.baseCity = profile.base_city ?? prev.baseCity
      next.baseCountryId = profile.base_country_id ?? prev.baseCountryId
      next.locationSelected = !!(next.baseCity && next.baseCountryId)
      next.nationality = profile.nationality ?? prev.nationality
      // Pre-fill primary AND secondary nationality for ALL roles. Previously
      // only the club branch read these back, so a returning player/coach/
      // umpire who'd already set their nationality(ies) in a partial
      // onboarding would re-submit blank — silently overwriting their data.
      next.nationalityCountryId = profile.nationality_country_id ?? prev.nationalityCountryId
      next.nationality2CountryId = profile.nationality2_country_id ?? prev.nationality2CountryId

      if (profile.role === 'club') {
        next.clubName = profile.full_name ?? prev.clubName
        next.yearFounded = profile.year_founded ? String(profile.year_founded) : prev.yearFounded
        next.womensLeagueDivision = profile.womens_league_division ?? prev.womensLeagueDivision
        next.mensLeagueDivision = profile.mens_league_division ?? prev.mensLeagueDivision
        next.website = profile.website ?? prev.website
        next.contactEmail = profile.contact_email ?? next.contactEmail
        next.clubBio = profile.club_bio ?? prev.clubBio
        next.clubHistory = profile.club_history ?? prev.clubHistory
      } else {
        next.fullName = profile.full_name ?? prev.fullName
        // Prefill priority: saved profile DOB → the DOB provided at signup
        // (rides auth metadata from AuthScreen) → whatever is typed.
        next.dateOfBirth =
          profile.date_of_birth ??
          ((user?.user_metadata?.dob as string | undefined) || prev.dateOfBirth)

        if (profile.role === 'player') {
          next.position = profile.position ?? prev.position
          next.secondaryPosition = profile.secondary_position ?? prev.secondaryPosition
          if (isValidPlayingCategory(profile.playing_category)) {
            next.playingCategory = profile.playing_category
          }
        } else if (profile.role === 'umpire') {
          // Pre-fill ALL umpire-specific fields. Previously only
          // umpiring_categories was read back; a returning umpire would
          // lose their level / federation / specialization / languages
          // / umpire_since on resubmit.
          if (isValidCategoryArray(profile.umpiring_categories)) {
            next.umpiringCategories = (profile.umpiring_categories ?? []) as CoachUmpireCategory[]
          }
          next.umpireLevel = profile.umpire_level ?? prev.umpireLevel
          next.federation = profile.federation ?? prev.federation
          next.umpireSince = profile.umpire_since ? String(profile.umpire_since) : prev.umpireSince
          if (
            profile.officiating_specialization === 'outdoor' ||
            profile.officiating_specialization === 'indoor' ||
            profile.officiating_specialization === 'both'
          ) {
            next.officiatingSpecialization = profile.officiating_specialization
          }
          if (Array.isArray(profile.languages) && profile.languages.length > 0) {
            next.languages = profile.languages.filter((l): l is string => typeof l === 'string')
          }
        }
      }

      return next
    })

    if (profile.contact_email) {
      contactPrefilledRef.current = profile.contact_email
    }

    if (profile.avatar_url) {
      setAvatarUrl(profile.avatar_url)
      setAvatarFullUrl(profile.avatar_full_url ?? null)
    }
    // user_metadata.dob is set once at signup and never changes mid-session;
    // keying on `profile` alone preserves the existing merge semantics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])

  // Wizard draft hydration: once per mount (per user+role), restore the form
  // fields AND the step from a saved draft. Waits for the profile so the
  // server-side prefill (the effect above, same commit, declared first) runs
  // BEFORE it and the user's most recent typed state wins. Without that wait
  // a profile arriving after hydration overwrote the restored draft (e.g. an
  // empty full_name), which read as "the coach form forgot everything".
  useEffect(() => {
    if (!isWizardFlow || !wizardDraftKey || !profile || wizardDraftHydratedRef.current) return
    wizardDraftHydratedRef.current = true
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      const raw = window.localStorage.getItem(wizardDraftKey)
      if (!raw) return
      const draft = parseWizardDraft(raw)
      if (!draft) {
        // Stale or unreadable (7-day guard): drop it.
        window.localStorage.removeItem(wizardDraftKey)
        return
      }
      wizardDraftSkipPersistRef.current = true
      if (draft.formData) {
        const restored = draft.formData
        setFormData(prev => ({ ...prev, ...restored }) as typeof prev)
      }
      if (draft.step) setCurrentStep(draft.step)
    } catch (err) {
      logger.warn('[COMPLETE_PROFILE] Failed to hydrate wizard draft', { error: err })
    }
  }, [isWizardFlow, wizardDraftKey, profile])

  // Wizard draft persistence: save form + step on every change, debounced
  // implicitly by React's batching. Skipped for non-wizard roles (club
  // already has its own draft mechanism via showClubClaimStep state, and
  // brand has a separate persistKey-based BrandForm draft). Starts only after
  // hydration so an empty first render never overwrites a saved draft.
  useEffect(() => {
    if (!isWizardFlow || !wizardDraftKey || !wizardDraftHydratedRef.current) return
    if (wizardDraftSkipPersistRef.current) {
      wizardDraftSkipPersistRef.current = false
      return
    }
    try {
      if (typeof window === 'undefined' || !window.localStorage) return
      window.localStorage.setItem(wizardDraftKey, serializeWizardDraft(currentStep, formData))
    } catch {
      // Quota exceeded or storage blocked — silently no-op. The fallback
      // is the server-side prefill from `profiles` on next mount.
    }
  }, [isWizardFlow, wizardDraftKey, currentStep, formData])

  // Handle club claim step completion
  const handleClubClaimComplete = (result: ClubClaimResult) => {
    logger.debug('[CompleteProfile] Club claim completed:', result)
    setShowClubClaimStep(false)

    // Pre-fill form with claim data (country ID + leagues only). We
    // intentionally do NOT pre-fill `city` from `result.regionName` — the
    // city field is wired to LocationAutocomplete which needs the user to
    // pick a real city so `baseCity` + `baseCountryId` are set in parallel.
    // Stuffing a region name in here leaves locationSelected=false and
    // breaks structured-location filters in Discovery / maps.
    setFormData(prev => ({
      ...prev,
      clubName: result.clubName,
      nationalityCountryId: result.countryId || prev.nationalityCountryId,
      womensLeagueDivision: result.womenLeagueName || '',
      mensLeagueDivision: result.menLeagueName || '',
    }))
  }

  // Handle club claim step skip
  const handleClubClaimSkip = () => {
    logger.debug('[CompleteProfile] Club claim skipped')
    setShowClubClaimStep(false)
  }

  // Location autocomplete handlers
  const handleLocationChange = (value: string) => {
    setFormData(prev => ({
      ...prev,
      city: value,
      baseCity: '',
      baseCountryId: null,
      locationSelected: false,
    }))
  }

  const handleLocationSelect = (location: LocationSelection) => {
    setFormData(prev => ({
      ...prev,
      city: location.displayName,
      baseCity: location.city,
      baseCountryId: location.countryId,
      locationSelected: true,
    }))
  }

  const handleLocationClear = () => {
    setFormData(prev => ({
      ...prev,
      city: '',
      baseCity: '',
      baseCountryId: null,
      locationSelected: false,
    }))
  }

  /** Upload a File to Supabase avatars bucket. */
  const uploadAvatarFile = async (file: File) => {
    if (!user) return

    try {
      setUploadingAvatar(true)
      setError('')

      const validation = validateImage(file, { maxFileSizeMB: 5 })
      if (!validation.valid) {
        setError(validation.error || t('complete.errors.invalidImage'))
        return
      }

      let urls
      try {
        // Clubs and brands upload a crest or logo: the square only.
        urls = await uploadProfilePhoto(user.id, file, { full: userRole !== 'club' && userRole !== 'brand' })
      } catch (uploadError) {
        captureOnboardingError(uploadError, {
          role: userRole,
          hasUser: Boolean(user?.id),
          fileSizeBytes: file.size,
        }, 'CompleteProfile.handleAvatarUpload.upload')
        throw uploadError
      }
      const publicUrl = urls.avatarUrl

      const previousUrl = avatarUrl || profile?.avatar_url || null
      const previousFull = avatarFullUrl
      setAvatarUrl(publicUrl)
      setAvatarFullUrl(urls.avatarFullUrl)
      if (previousFull && previousFull !== urls.avatarFullUrl) {
        pendingCleanup.queue({ bucket: 'avatars', publicUrl: previousFull, context: 'complete-profile:replace-avatar-full' })
      }
      if (urls.avatarFullUrl) pendingCleanup.unqueue(urls.avatarFullUrl)
      // Deferred: onboarding is abandonable at any step, and the profile row
      // still references the old object until the final submit lands.
      if (previousUrl && previousUrl !== publicUrl) {
        pendingCleanup.queue({ bucket: 'avatars', publicUrl: previousUrl, context: 'complete-profile:replace-avatar' })
      }
      pendingCleanup.unqueue(publicUrl)
      logger.info('Avatar uploaded successfully')
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'avatar_uploaded' })
    } catch (err) {
      captureOnboardingError(err, {
        stage: 'avatarUploadCatch',
        role: userRole,
        hasUser: Boolean(user?.id),
      }, 'CompleteProfile.handleAvatarUpload.catch')
      logger.error('Error uploading avatar:', err)
      setError(t('complete.errors.uploadFailed'))
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Handle avatar click — use native picker on Capacitor, file input on web
  const handleAvatarClick = async () => {
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt', { crop: userRole === 'club' || userRole === 'brand' })
        if (result) {
          await uploadAvatarFile(result.file)
        }
      } catch (err) {
        logger.error('Native image picker error:', err)
        setError(t('complete.errors.pickerFailed'))
      }
      return
    }
    fileInputRef.current?.click()
  }

  // Handle file input change (web only)
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    await uploadAvatarFile(file)
  }

  // Per-step validation is delegated to the pure helper in
  // lib/onboardingValidation.ts so the gating logic can be unit-tested
  // without mounting this whole page. The whole-form `validateForm`
  // below is still called on submit as a safety net in case the user
  // navigates back and clears a field.
  // Fire `wizard_step_viewed` once per (step, role) entry. Runs after the
  // user has picked a role (userRole becomes truthy) and whenever they land
  // on a step they haven't seen yet — including back-navigation.
  useEffect(() => {
    if (!isWizardFlow || !user?.id) return
    const key = `${userRole}:${currentStep}`
    if (viewedStepsRef.current.has(key)) return
    viewedStepsRef.current.add(key)
    trackDbEvent('onboarding_step', 'profile', user.id, {
      step: 'wizard_step_viewed',
      role: userRole,
      wizard_step: currentStep,
    })
  }, [currentStep, userRole, isWizardFlow, user?.id])

  const handleNext = () => {
    if (userRole !== 'player' && userRole !== 'umpire') return

    // Flush any uncommitted language chip typing before validating so a user
    // who typed "English" into the input and clicked Continue doesn't get
    // bounced with a "please add a language" error.
    let formForValidation = formData
    if (userRole === 'umpire' && currentStep === 3 && formData.pendingLanguage.trim()) {
      const pending = formData.pendingLanguage.trim()
      const nextLanguages = formData.languages.includes(pending)
        ? formData.languages
        : [...formData.languages, pending]
      formForValidation = { ...formData, languages: nextLanguages, pendingLanguage: '' }
      setFormData(formForValidation)
    }

    const stepError = validateOnboardingStep(currentStep, userRole, formForValidation, t)
    if (stepError) {
      setError(stepError)
      // Emit so we can see which step + which validation rule users get stuck on.
      trackDbEvent('onboarding_step', 'profile', user?.id, {
        step: 'wizard_step_validation_failed',
        role: userRole,
        wizard_step: currentStep,
        // The funnel keeps the English reason whatever the interface language.
        reason: validateOnboardingStep(currentStep, userRole, formForValidation, tOnboardingEnglish),
      })
      return
    }
    setError('')
    trackDbEvent('onboarding_step', 'profile', user?.id, {
      step: 'wizard_step_completed',
      role: userRole,
      wizard_step: currentStep,
    })
    setCurrentStep((prev) => (prev === 3 ? 3 : ((prev + 1) as WizardStep)))
  }

  const handleBack = () => {
    setError('')
    setCurrentStep((prev) => (prev === 1 ? 1 : ((prev - 1) as WizardStep)))
  }

  // Client-side validation. Takes the form explicitly so the caller can
  // pass a flushed snapshot (with any pendingLanguage committed) even if
  // React state hasn't re-rendered yet.
  const validateForm = (form: typeof formData = formData): string | null => {
    if (userRole === 'player') {
      if (!form.fullName.trim()) return t('validation.fullName')
      if (!form.city.trim()) return t('validation.location')
      if (!form.nationalityCountryId) return t('validation.nationality')
      if (!form.position) return t('validation.position')
      if (!form.playingCategory) return t('validation.playingCategory')
      if (form.secondaryPosition && form.secondaryPosition === form.position) {
        return t('validation.positionsDiffer')
      }
    } else if (userRole === 'umpire') {
      if (!form.fullName.trim()) return t('validation.fullName')
      if (!form.city.trim()) return t('validation.location')
      if (!form.nationalityCountryId) return t('validation.nationality')
      // Umpiring categories are optional per Phase 3 product direction.
      if (!form.umpireLevel.trim()) return t('validation.umpireLevel')
      if (!form.federation.trim()) return t('validation.federation')
      if (!form.officiatingSpecialization) return t('validation.officiating')
      if (form.languages.length === 0) {
        return t('validation.languages')
      }
    } else if (userRole === 'club') {
      if (!form.clubName.trim()) return t('validation.clubName')
      if (!form.city.trim()) return t('validation.city')
      if (!form.nationalityCountryId) return t('validation.country')
      if (!form.contactEmail.trim()) return t('validation.contactEmail')
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(form.contactEmail)) {
        return t('validation.emailInvalid')
      }
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Defensive: in the staged wizard, only the final step's "Complete Profile"
    // button should trigger a real submit. If the form receives onSubmit on an
    // earlier step — e.g. via implicit submission (Enter key in a text input
    // on some WebView / mobile browsers) — forward it to the Next flow instead
    // so per-step validation runs and the user doesn't see a whole-form error
    // before they've reached later steps.
    if (isWizardFlow && currentStep < 3) {
      handleNext()
      return
    }

    setError('')

    // Flush any uncommitted language chip text into languages[] before
    // validating + submitting. Avoids the blur-vs-submit race (see
    // formData.pendingLanguage comment). Build a local snapshot used for
    // both validation and the update payload below; also mirror it to
    // state so the UI reflects the change.
    let formSnapshot = formData
    if (userRole === 'umpire' && formData.pendingLanguage.trim()) {
      const pending = formData.pendingLanguage.trim()
      const nextLanguages = formData.languages.includes(pending)
        ? formData.languages
        : [...formData.languages, pending]
      formSnapshot = { ...formData, languages: nextLanguages, pendingLanguage: '' }
      setFormData(formSnapshot)
    }

    // Run client-side validation against the flushed snapshot
    const validationError = validateForm(formSnapshot)
    if (validationError) {
      setError(validationError)
      return
    }
    
    setLoading(true)
    trackDbEvent('onboarding_step', 'profile', user?.id, { step: 'form_submitted', role: userRole })
    let lastUpdatedFields: string[] = []

    try {
      if (!user) {
        throw new Error(t('complete.errors.sessionMissing'))
      }

      if (!userRole) {
        throw new Error(t('complete.errors.roleMissing'))
      }

      // Never write set-up data over a row that was not loaded: with a null
      // profile this submit would overwrite name / position and null the
      // avatar of a member whose fetch merely failed (release audit 2026-10-05).
      if (!profile) {
        throw new Error(t('complete.errors.profileNotLoaded'))
      }

      // Refresh the session before making auth-dependent calls.
      // Users in iOS WebViews or who spent a long time filling the form
      // may have a stale/expired token by the time they hit submit.
      const { error: refreshError } = await supabase.auth.refreshSession()
      if (refreshError) {
        logger.warn('[COMPLETE_PROFILE] Session refresh failed at submit — token may be expired', refreshError)
      }

      // Prepare data based on role
      // Derive nationality text from country ID for consistency
      const selectedCountry = formData.nationalityCountryId
        ? getCountryById(formData.nationalityCountryId)
        : null
      // Clubs store country name (e.g. "Argentina"), players/coaches store demonym (e.g. "Argentine")
      const nationalityText = userRole === 'club'
        ? (selectedCountry?.name || '')
        : (selectedCountry?.nationality_name || '')

      let updateData: TablesUpdate<'profiles'> = {
        role: userRole, // IMPORTANT: Always include role in update
        full_name: formData.fullName || formData.clubName || '',
        base_location: formData.city || '',
        base_city: formData.baseCity || null,
        base_country_id: formData.baseCountryId || null,
        nationality: nationalityText, // Synced from country_id for backward compatibility
        nationality_country_id: formData.nationalityCountryId,
        onboarding_completed: true, // Mark onboarding as complete
        avatar_url: avatarUrl || null, // Include avatar if uploaded
        // Only when the photo changed here: never overwrite a full photo this screen didn't load.
        ...(avatarUrl !== (profile?.avatar_url ?? '') ? { avatar_full_url: avatarUrl ? avatarFullUrl : null } : {}),
      }

      if (userRole === 'player') {
        const playingCategory = formData.playingCategory || null
        updateData = {
          ...updateData,
          nationality2_country_id: formData.nationality2CountryId || null,
          position: formData.position,
          secondary_position: formData.secondaryPosition || null,
          // Phase 3 dual-write: legacy gender stays in sync with category for
          // adult_men/adult_women so AI Discovery (which still reads gender
          // until Phase 3e) keeps working. Girls/Boys/Mixed → null gender.
          gender: playingCategoryToLegacyGender(playingCategory),
          playing_category: playingCategory,
          // User completed the new category UI explicitly — clear any
          // best-effort flag the migration set on existing rows.
          category_confirmation_needed: false,
          current_club: formData.currentClub || null,
          current_world_club_id: formData.currentWorldClubId,
          // Default to "open" so new players show up in availability-filtered
          // Discovery searches immediately. Without this, AI Discovery's
          // `WHERE open_to_play = true` excludes every freshly-onboarded
          // player until they edit their settings — invisible damage.
          // Users can always toggle off later via the AvailabilityToggleStrip.
          open_to_play: true,
        }
      } else if (userRole === 'umpire') {
        // Use the flushed snapshot (see "Flush any uncommitted language chip
        // text" block above) so a just-typed language makes it into the
        // payload even though the setFormData re-render hasn't happened yet.
        const umpireSinceYear = formSnapshot.umpireSince ? parseInt(formSnapshot.umpireSince, 10) : null
        const umpiringCategories = formSnapshot.umpiringCategories.length > 0 ? formSnapshot.umpiringCategories : null
        updateData = {
          ...updateData,
          nationality2_country_id: formSnapshot.nationality2CountryId,
          // Phase 3: gender no longer collected on umpire onboarding.
          gender: null,
          umpiring_categories: umpiringCategories,
          category_confirmation_needed: false,
          umpire_level: formSnapshot.umpireLevel.trim() || null,
          federation: formSnapshot.federation.trim() || null,
          umpire_since:
            umpireSinceYear && !Number.isNaN(umpireSinceYear) ? umpireSinceYear : null,
          officiating_specialization: formSnapshot.officiatingSpecialization || null,
          // languages is a TEXT[] column; empty array would be valid but we
          // require ≥ 1 at validation time so this path always has entries.
          languages: formSnapshot.languages.length > 0 ? formSnapshot.languages : null,
          // Default new umpires to available so they surface in the Community
          // "Available" chip + availability-filtered search immediately
          // (mirrors the player open_to_play / coach open_to_coach default).
          // Toggle off later via the AvailabilityToggleStrip.
          available_for_appointments: true,
        }
      } else if (userRole === 'club') {
        updateData = {
          ...updateData,
          full_name: formData.clubName,
          base_location: formData.city, // City is stored in base_location
          nationality: nationalityText, // Synced from country_id for backward compatibility
          year_founded: formData.yearFounded ? parseInt(formData.yearFounded) : null,
          womens_league_division: formData.womensLeagueDivision || null,
          mens_league_division: formData.mensLeagueDivision || null,
          website: formData.website,
          contact_email: formData.contactEmail,
          club_bio: formData.clubBio,
          club_history: formData.clubHistory,
          // Default new clubs to "recruiting" so they surface in the Community
          // availability chip + recruiter-facing search right away.
          open_to_opportunities: true,
        }
      }

      logger.debug('Updating profile with data:', updateData)
      lastUpdatedFields = Object.keys(updateData)

      // Safety net: ensure the profile row exists before attempting UPDATE.
      // This handles the edge case where the placeholder INSERT in auth.ts
      // failed silently and the user reached the form via user_metadata.role.
      const { data: existingProfile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', user.id)
        .maybeSingle()

      if (!existingProfile) {
        logger.warn('[COMPLETE_PROFILE] Profile row missing at submit time — creating via RPC', { userId: user.id, role: userRole })
        const { error: createError } = await supabase.rpc('create_profile_for_new_user', {
          user_id: user.id,
          user_email: user.email || '',
          user_role: userRole,
        })
        if (createError) {
          captureOnboardingError(createError, {
            role: userRole,
            stage: 'ensureProfileExistsBeforeSubmit',
          }, 'CompleteProfile.handleSubmit.createProfile')
          logger.error('Failed to create missing profile:', createError)
          throw new Error(t('complete.errors.profileCreate'))
        }
      }

      // ── Age gate: DOB is written ONLY via declare_date_of_birth (SECURITY
      // DEFINER — the under-18 branch freezes server-side; direct UPDATE of
      // the column is revoked). Person roles require it; an under-18 answer
      // ends onboarding here and the AgeGate goodbye screen takes over. ──
      const isPersonRole = userRole === 'player' || userRole === 'coach' || userRole === 'umpire'
      if (isPersonRole) {
        const dob = formData.dateOfBirth || formSnapshot.dateOfBirth || ''
        if (!dob) {
          throw new Error(t('complete.errors.dobRequired'))
        }
        const { data: dobResult, error: dobError } = await supabase.rpc('declare_date_of_birth', { p_dob: dob })
        if (dobError) {
          throw new Error(t('complete.errors.dobSave'))
        }
        const outcome = (dobResult as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') {
          throw new Error(t('complete.errors.dobInvalid'))
        }
        if (outcome === 'frozen') {
          // Under 18: account frozen server-side; do NOT complete onboarding.
          await fetchProfile(user.id, { force: true })
          return
        }
      }

      // Update profile. No `.select('*')` returning: RETURNING respects
      // column SELECT grants, which exclude date_of_birth after the
      // age-gate revoke — the verify fetch below (profiles_self) is the
      // read-back instead.
      const { error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)

      if (updateError) {
        captureOnboardingError(updateError, {
          role: userRole,
          updatedFields: lastUpdatedFields,
        }, 'CompleteProfile.handleSubmit.updateProfile')
        logger.error('Error updating profile:', updateError)
        throw new Error(t('complete.errors.updateFailedDetail', { message: updateError.message }))
      }

      logger.debug('Profile updated successfully')

      // Fetch the updated profile to verify (additional safety). Read via
      // the self-only view so the owner's date_of_birth stays readable
      // after the age-gate column revoke.
      const { data: verifiedProfile, error: fetchError } = await supabase
        .from('profiles_self')
        .select('*')
        .eq('id', user.id)
        .single()

      if (fetchError || !verifiedProfile) {
        if (fetchError) {
          captureOnboardingError(fetchError, {
            role: userRole,
            stage: 'verifyProfileAfterUpdate',
          }, 'CompleteProfile.handleSubmit.verifyProfileFetch')
        }
        logger.error('Error fetching updated profile:', fetchError)
        throw new Error(t('complete.errors.verifyFailed'))
      }

      logger.debug('Updated profile verified:', verifiedProfile)

      // CRITICAL: Refresh the auth store so dependent routes pick up the update
      await invalidateProfile({ userId: user.id, reason: 'complete-profile' })

      // Row is saved and verified — safe to drop the objects it replaced.
      await pendingCleanup.flush()

      logger.debug('Auth store refreshed - profile now complete')
      markOnboardingCompletedOnDevice()
      // Clear the wizard-draft persistence — the user finished, the
      // profile row is now authoritative. Without this, a returning user
      // who edits their profile elsewhere then somehow lands back on
      // /complete-profile would see stale draft data.
      if (wizardDraftKey) {
        try { localStorage.removeItem(wizardDraftKey) } catch { /* no-op */ }
      }
      trackOnboardingComplete(userRole ?? 'unknown')
      trackDbEvent('onboarding_completed', 'profile', user?.id, { role: userRole })
      // Identity stitching: link this account to its pre-signup anonymous
      // exploration (first-touch source/UTM + all prior anon events).
      // Fallback write for members whose registration hook didn't fire
      // (idempotent server-side; the first write wins).
      submitSignupAttribution(user?.id)
      // Hypothesis test: was this registration driven by hitting a login wall
      // while exploring? Fires only if a recent wall intent was recorded.
      const wallAction = consumeWallIntent()
      if (wallAction) {
        trackDbEvent('registration_from_wall', 'profile', user?.id, { action: wallAction, role: userRole })
      }
      // A destination picked before sign-up (club invite, the role they
      // tried to apply to) wins over the default landing.
      navigate(consumeCarriedRedirect(user) ?? '/dashboard/profile', { replace: true })

    } catch (err) {
      captureOnboardingError(err, {
        stage: 'handleSubmitCatch',
        role: userRole,
        updatedFields: lastUpdatedFields,
      }, 'CompleteProfile.handleSubmit.catch')
      logger.error('Complete profile error:', err)
      setError(err instanceof Error ? err.message : t('complete.errors.completeFailed'))
    } finally {
      setLoading(false)
    }
  }

  // Show loading while auth is initializing
  if (authLoading || (profileStatus === 'fetching' && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-hockia-primary mb-4"></div>
          <p className="text-gray-600">{t('complete.status.loading')}</p>
        </div>
      </div>
    )
  }

  // Show error if no user or profile role
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('complete.status.noUserTitle')}</h2>
          <p className="text-gray-600 mb-6">
            {t('complete.status.noUserBody')}
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            {t('complete.status.noUserHome')}
          </button>
        </div>
      </div>
    )
  }

  // A failed profile fetch is not "not onboarded" (release audit 2026-10-05).
  // With profile null every `!profile?.onboarding_completed` check below read
  // as true, so a member whose fetch failed (expired token, flaky network,
  // Landing / DashboardRouter both send that case here) was dropped into
  // set-up, and step 1 then overwrote their name and position and nulled
  // their avatar. Offer a retry instead; nothing below mounts without a row.
  if (!profile && profileStatus === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" data-testid="profile-load-error">
        <div className="max-w-md w-full bg-white rounded-xl shadow-lg p-8 text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">{t('complete.status.loadErrorTitle')}</h2>
          <p className="text-gray-600 mb-6">{t('complete.status.loadErrorBody')}</p>
          <button
            type="button"
            onClick={() => void fetchProfile(user.id, { force: true })}
            className="w-full px-6 py-3 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            {t('complete.status.loadErrorRetry')}
          </button>
          <SetupSignOut placement="footer" />
        </div>
      </div>
    )
  }

  if (!profile || !userRole) {
    // Choose your role (Figma 101:892): every new account lands here — the
    // account-first flow collects no role at sign-up (email or OAuth), so the
    // profile row is created now, from the choice, via handleRoleSelection.
    // Also the only screen for a signed-in account with NO row (status
    // 'missing'), whatever a stale pending_role / user_metadata.role says: a
    // set-up flow must never run against a row that does not exist.
    return (
      <ChooseRoleScreen
        onSelect={handleRoleSelection}
        busy={creatingProfile}
        error={error || null}
        onSignInAgain={sessionExpired ? () => { void supabase.auth.signOut().finally(() => navigate('/signin', { replace: true })) } : undefined}
      />
    )
  }

  // Player set-up (Figma 114:537 / 114:608), two steps, step 2 skippable.
  // The guards above (auth, brand, already-onboarded → dashboard) run first.
  if (userRole === 'player' && !profile?.onboarding_completed) {
    const finishPlayerSetup = async () => {
      const current = useAuthStore.getState().profile ?? profile
      markOnboardingCompletedOnDevice()
      trackOnboardingComplete('player')
      trackDbEvent('onboarding_completed', 'profile', user.id, { role: 'player' })
      submitSignupAttribution(user.id)
      const wallAction = consumeWallIntent()
      if (wallAction) trackDbEvent('registration_from_wall', 'profile', user.id, { action: wallAction, role: 'player' })
      // Same race guard as the club set-up: the route gate must see
      // onboarding_completed before the route change, and this page's
      // already-onboarded redirect must not win the race.
      setupFinishedRef.current = true
      if (current) useAuthStore.getState().setProfile({ ...current, onboarding_completed: true })
      navigate(consumeCarriedRedirect(user) ?? '/dashboard/profile', { replace: true })
      void invalidateProfile({ userId: user.id, reason: 'player-setup-complete' })
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <PlayerSetupFlow onFinished={finishPlayerSetup} />
      </Suspense>
    )
  }

  // Coach set-up (Figma D6.5 / D6.6), two steps, step 2 skippable. Replaces
  // the 3-step coach wizard; the guards above run first.
  if (userRole === 'coach' && !profile?.onboarding_completed) {
    const finishCoachSetup = async () => {
      const current = useAuthStore.getState().profile ?? profile
      markOnboardingCompletedOnDevice()
      trackOnboardingComplete('coach')
      trackDbEvent('onboarding_completed', 'profile', user.id, { role: 'coach' })
      // Identity stitching fallback (idempotent server-side; first write wins).
      submitSignupAttribution(user.id)
      const wallAction = consumeWallIntent()
      if (wallAction) trackDbEvent('registration_from_wall', 'profile', user.id, { action: wallAction, role: 'coach' })
      // Same race guard as the player / club set-ups.
      setupFinishedRef.current = true
      if (current) useAuthStore.getState().setProfile({ ...current, onboarding_completed: true })
      navigate(consumeCarriedRedirect(user) ?? '/dashboard/profile', { replace: true })
      void invalidateProfile({ userId: user.id, reason: 'coach-setup-complete' })
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <CoachSetupFlow onFinished={finishCoachSetup} />
      </Suspense>
    )
  }

  // Club set-up (D1.24) for phone clubs that haven't finished onboarding. The
  // guards above (auth, brand, already-onboarded → dashboard) run first.
  if (profile && showsClubSetup(userRole, isPhone, profile.onboarding_completed)) {
    const finishClubSetup = async () => {
      const current = useAuthStore.getState().profile ?? profile
      markOnboardingCompletedOnDevice()
      trackOnboardingComplete('club')
      trackDbEvent('onboarding_completed', 'profile', user.id, { role: 'club' })
      submitSignupAttribution(user.id)
      const wallAction = consumeWallIntent()
      if (wallAction) trackDbEvent('registration_from_wall', 'profile', user.id, { action: wallAction, role: 'club' })
      // The route gate must see onboarding_completed before the route change,
      // and this page's already-onboarded redirect must not win the race to
      // /dashboard/profile. Then refetch for real.
      setupFinishedRef.current = true
      useAuthStore.getState().setProfile({ ...current, onboarding_completed: true })
      navigate(consumeCarriedRedirect(user) ?? '/opportunities', { replace: true })
      void invalidateProfile({ userId: user.id, reason: 'club-setup-complete' })
    }
    return (
      <Suspense fallback={<div className="min-h-screen bg-white" />}>
        <ClubSetupFlow onFinished={finishClubSetup} />
      </Suspense>
    )
  }

  return (
    // overflow-hidden removed + items-start on mobile so a tall onboarding
    // card (Samsung S24, soft-keyboard open, etc.) can grow the wrapper and
    // let the page scroll, instead of clipping the Next button at the bottom
    // and the heading at the top. Background image stays contained because
    // its absolute container fills the wrapper's natural bounds.
    <div className="min-h-screen relative flex items-start md:items-center justify-center p-4">
      <div className="absolute inset-0 overflow-hidden">
        <img
          src="/hero-desktop.webp"
          alt={t('complete.header.heroAlt')}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/70" />
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-hockia-primary to-hockia-secondary">
            <div className="flex items-center justify-between gap-3 mb-2">
              <img
                src="/brand/wordmark/hockia-wordmark-white.svg"
                alt="HOCKIA"
                className="h-8"
              />
              <SetupSignOut className="text-white/80 active:text-white" />
            </div>
            <p className="text-white/90 text-sm">
              {t('complete.header.tagline')}
            </p>
            {userRole === 'club' && (
              <div className="mt-3 flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white rounded-full transition-all duration-300"
                    style={{ width: showClubClaimStep ? '50%' : '100%' }}
                  />
                </div>
                <span className="text-white/80 text-xs font-medium whitespace-nowrap">
                  {t('complete.header.clubStep', { current: showClubClaimStep ? '1' : '2' })}
                </span>
              </div>
            )}
          </div>

          {/* Club Claim Step (shown first for clubs) */}
          {userRole === 'club' && showClubClaimStep && user && (
            <div className="p-8">
              <ClubClaimStep 
                profileId={user.id}
                onComplete={handleClubClaimComplete}
                onSkip={handleClubClaimSkip}
              />
            </div>
          )}

          {/* Main Profile Form (shown after claim step for clubs, or immediately for others) */}
          {(userRole !== 'club' || !showClubClaimStep) && (
          <form onSubmit={handleSubmit} className="p-8 md:max-h-[80vh] md:overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {userRole === 'player' && t('complete.form.titlePlayer')}
              {userRole === 'umpire' && t('complete.form.titleUmpire')}
              {userRole === 'club' && t('complete.form.titleClub')}
            </h3>
            <p className="text-gray-600 mb-6">
              {isWizardFlow ? t('complete.form.wizardStep', { current: currentStep, label: stepLabels[userRole][currentStep] }) : t('complete.form.intro')}
            </p>

            {/* Step indicator — umpire wizard only.
                A11y: the visual circles + connectors are decorative; each step
                is an <li> whose sr-only text announces its number, label, and
                status so screen-reader users get the same information. The
                outer <ol> carries the list semantics (navigation convention
                for wizard/step UIs). */}
            {isWizardFlow && (
              <ol
                className="mb-6 flex items-center gap-2"
                aria-label={t('complete.form.stepsLabel')}
              >
                {([1, 2, 3] as WizardStep[]).map((step, idx) => {
                  const isCompleted = step < currentStep
                  const isActive = step === currentStep
                  const statusKey = isCompleted
                    ? 'complete.steps.statusCompleted'
                    : isActive
                    ? 'complete.steps.statusCurrent'
                    : 'complete.steps.statusNotStarted'
                  return (
                    <li key={step} className="flex items-center flex-1">
                      <div
                        className={
                          isCompleted
                            ? 'flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold bg-emerald-500'
                            : isActive
                            ? 'flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold bg-gradient-to-br from-hockia-primary to-hockia-secondary ring-4 ring-hockia-primary/15'
                            : 'flex items-center justify-center w-7 h-7 rounded-full text-gray-400 text-xs font-semibold border-2 border-gray-200 bg-white'
                        }
                        aria-current={isActive ? 'step' : undefined}
                      >
                        <span aria-hidden="true">
                          {isCompleted ? <Check className="w-3.5 h-3.5" /> : step}
                        </span>
                        <span className="sr-only">
                          {t(statusKey, { step, label: stepLabels[userRole][step] })}
                        </span>
                      </div>
                      {idx < 2 && (
                        <div
                          aria-hidden="true"
                          className={
                            step < currentStep
                              ? 'flex-1 h-0.5 mx-2 bg-emerald-500'
                              : 'flex-1 h-0.5 mx-2 bg-gray-200'
                          }
                        />
                      )}
                    </li>
                  )
                })}
              </ol>
            )}

            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg" role="alert" aria-live="assertive">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Avatar Upload Section - Optional. Club: always visible at top. Player/coach: only step 1. */}
            {(!isWizardFlow || currentStep === 1) && (
            <div className="mb-6 p-4 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl border border-purple-200">
              <label className="block text-sm font-medium text-gray-700 mb-3">
                <Trans t={t} i18nKey="complete.photo.label" components={{ optional: <span className="text-gray-500" /> }} />
              </label>
              <div className="flex items-center gap-4">
                <div
                  onClick={handleAvatarClick}
                  className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center cursor-pointer hover:from-purple-200 hover:to-indigo-200 transition-all overflow-hidden border-2 border-white shadow-md"
                >
                  {avatarUrl ? (
                    <img src={getImageUrl(avatarUrl, 'avatar-md') ?? avatarUrl} alt={t('complete.photo.previewAlt')} className="w-full h-full object-cover" loading="eager" decoding="async" />
                  ) : (
                    <Camera className="w-8 h-8 text-purple-600" />
                  )}
                </div>
                <div className="flex-1">
                  <button
                    type="button"
                    onClick={handleAvatarClick}
                    disabled={uploadingAvatar}
                    className="px-4 py-2 bg-white hover:bg-gray-50 text-gray-700 rounded-lg transition-colors text-sm font-medium border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {uploadingAvatar ? (
                      <span className="flex items-center gap-2">
                        <div className="w-4 h-4 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                        {t('complete.photo.uploading')}
                      </span>
                    ) : avatarUrl ? (
                      t('complete.photo.change')
                    ) : (
                      t('complete.photo.upload')
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-1">{t('complete.photo.hint')}</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={handleAvatarUpload}
                className="hidden"
                disabled={uploadingAvatar}
                aria-label={t('complete.photo.inputLabel')}
              />
            </div>
            )}

            <div className="space-y-4">
              {/* Players use components/onboarding/PlayerSetupFlow (account-first
                  onboarding, 2026-10-03) and coaches components/onboarding/CoachSetupFlow;
                  this form is umpire / club only. */}

              {/* Umpire Form — 3-step wizard. Steps 1–2 share the player/coach
                  identity + location inputs; Step 3 pivots to the credentials
                  that actually matter to umpires: level, federation,
                  specialization, languages. No highlight video / position /
                  current-club fields — those don't map to the umpire world. */}
              {userRole === 'umpire' && (
                <>
                  {currentStep === 1 && (
                    <>
                      <Input
                        label={t('complete.umpire.fullName')}
                        icon={<User className="w-5 h-5" />}
                        placeholder={t('complete.umpire.fullNamePlaceholder')}
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required
                      />

                      <CountrySelect
                        label={t('complete.umpire.nationality')}
                        value={formData.nationalityCountryId}
                        onChange={(id) => setFormData({ ...formData, nationalityCountryId: id })}
                        placeholder={t('complete.umpire.nationalityPlaceholder')}
                        showNationality
                        required
                      />

                      <CountrySelect
                        label={t('complete.umpire.secondNationality')}
                        value={formData.nationality2CountryId}
                        onChange={(id) => setFormData({ ...formData, nationality2CountryId: id })}
                        placeholder={t('complete.umpire.secondNationalityPlaceholder')}
                        showNationality
                      />
                    </>
                  )}

                  {currentStep === 2 && (
                    <>
                      <LocationAutocomplete
                        label={t('complete.umpire.location')}
                        icon={<MapPin className="w-5 h-5" />}
                        placeholder={t('complete.umpire.locationPlaceholder')}
                        value={formData.city}
                        onChange={handleLocationChange}
                        onLocationSelect={handleLocationSelect}
                        onLocationClear={handleLocationClear}
                        isSelected={formData.locationSelected}
                        required
                      />

                      <DateOfBirthPicker
                        label={t('complete.umpire.dateOfBirth')}
                        required
                        icon={<Calendar className="w-5 h-5" />}
                        value={formData.dateOfBirth}
                        onChange={(next) => setFormData({ ...formData, dateOfBirth: next })}
                      />
                    </>
                  )}

                  {currentStep === 3 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">
                        {t('complete.umpire.credentialsHeading')}
                      </p>

                      <div>
                        <label id="umpiring-categories-label" className="block text-sm font-medium text-gray-700 mb-2">
                          <Trans t={t} i18nKey="complete.umpire.categories" components={{ optional: <span className="text-gray-400 font-normal" /> }} />
                        </label>
                        <p className="text-xs text-gray-500 mb-3">{t('complete.umpire.categoriesHint')}</p>
                        <MultiCategorySelector
                          idPrefix="umpiring-categories"
                          value={formData.umpiringCategories.length > 0 ? formData.umpiringCategories : null}
                          onChange={(next) => setFormData({ ...formData, umpiringCategories: next })}
                        />
                      </div>

                      {/* Level + Federation datalists — free text with suggestions */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="umpire-level">
                          {t('complete.umpire.level')} <span className="text-red-500">*</span>
                        </label>
                        <p className="text-xs text-gray-500 mb-2">
                          {t('complete.umpire.levelHint')}
                        </p>
                        <input
                          id="umpire-level"
                          type="text"
                          list="umpire-level-suggestions"
                          value={formData.umpireLevel}
                          onChange={(e) => setFormData({ ...formData, umpireLevel: e.target.value })}
                          placeholder={t('complete.umpire.levelPlaceholder')}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                          required
                          autoComplete="off"
                        />
                        <datalist id="umpire-level-suggestions">
                          {UMPIRE_LEVEL_SUGGESTIONS.map((level) => (
                            <option key={level} value={level} />
                          ))}
                        </datalist>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="umpire-federation">
                          {t('complete.umpire.federation')} <span className="text-red-500">*</span>
                        </label>
                        <p className="text-xs text-gray-500 mb-2">
                          {t('complete.umpire.federationHint')}
                        </p>
                        <input
                          id="umpire-federation"
                          type="text"
                          list="federation-suggestions"
                          value={formData.federation}
                          onChange={(e) => setFormData({ ...formData, federation: e.target.value })}
                          placeholder={t('complete.umpire.federationPlaceholder')}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                          required
                          autoComplete="off"
                        />
                        <datalist id="federation-suggestions">
                          {FEDERATION_SUGGESTIONS.map((fed) => (
                            <option key={fed} value={fed} />
                          ))}
                        </datalist>
                      </div>

                      {/* Umpiring since (year) */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="umpire-since">
                          {t('complete.umpire.since')}
                        </label>
                        <input
                          id="umpire-since"
                          type="number"
                          inputMode="numeric"
                          min={1950}
                          max={new Date().getFullYear()}
                          value={formData.umpireSince}
                          onChange={(e) => setFormData({ ...formData, umpireSince: e.target.value })}
                          placeholder={t('complete.umpire.sincePlaceholder')}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                          autoComplete="off"
                        />
                      </div>

                      {/* Specialization */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('complete.umpire.specialization')} <span className="text-red-500">*</span>
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          {(['outdoor', 'indoor', 'both'] as const).map((value) => {
                            const labels: Record<typeof value, string> = {
                              outdoor: t('complete.umpire.specOutdoor'),
                              indoor: t('complete.umpire.specIndoor'),
                              both: t('complete.umpire.specBoth'),
                            }
                            const active = formData.officiatingSpecialization === value
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => setFormData({ ...formData, officiatingSpecialization: value })}
                                className={`p-3 rounded-lg border-2 text-center transition-all ${
                                  active
                                    ? 'border-hockia-primary bg-purple-50 text-hockia-primary'
                                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-gray-700'
                                }`}
                              >
                                <span className="text-sm font-medium">{labels[value]}</span>
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-3" htmlFor="umpire-languages">
                          {t('complete.umpire.languages')} <span className="text-red-500">*</span>
                        </label>

                        {/* Selected chips */}
                        {formData.languages.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-3">
                            {formData.languages.map((lang) => (
                              <span
                                key={lang}
                                className="inline-flex items-center gap-1.5 rounded-full bg-purple-100 text-hockia-primary px-3 py-1 text-sm font-medium"
                              >
                                {lang}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setFormData({
                                      ...formData,
                                      languages: formData.languages.filter((l) => l !== lang),
                                    })
                                  }
                                  aria-label={t('complete.umpire.removeLanguage', { language: lang })}
                                  className="text-hockia-primary hover:text-[#6B20D4]"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Controlled add-language input — text lives in
                            formData.pendingLanguage so handleNext can flush it
                            before validating. Avoids the blur-vs-submit race. */}
                        <div className="flex gap-2">
                          <input
                            id="umpire-languages"
                            type="text"
                            list="language-suggestions"
                            value={formData.pendingLanguage}
                            onChange={(e) => setFormData({ ...formData, pendingLanguage: e.target.value })}
                            placeholder={t('complete.umpire.languagePlaceholder')}
                            className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                            autoComplete="off"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault()
                                const value = formData.pendingLanguage.trim()
                                if (!value) return
                                setFormData({
                                  ...formData,
                                  languages: formData.languages.includes(value)
                                    ? formData.languages
                                    : [...formData.languages, value],
                                  pendingLanguage: '',
                                })
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const value = formData.pendingLanguage.trim()
                              if (!value) return
                              setFormData({
                                ...formData,
                                languages: formData.languages.includes(value)
                                  ? formData.languages
                                  : [...formData.languages, value],
                                pendingLanguage: '',
                              })
                            }}
                            disabled={!formData.pendingLanguage.trim()}
                            className="px-4 py-3 rounded-lg bg-hockia-primary text-white text-sm font-medium hover:bg-[#6B20D4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          >
                            {t('complete.umpire.addLanguage')}
                          </button>
                        </div>
                        <datalist id="language-suggestions">
                          {LANGUAGE_SUGGESTIONS.map((lang) => (
                            <option key={lang} value={lang} />
                          ))}
                        </datalist>
                        <p className="text-xs text-gray-400 mt-2">{t('complete.umpire.languagesHint')}</p>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Club Form */}
              {userRole === 'club' && (
                <>
                  <Input
                    label={t('complete.club.name')}
                    icon={<Building2 className="w-5 h-5" />}
                    placeholder={t('complete.club.namePlaceholder')}
                    value={formData.clubName}
                    onChange={(e) => setFormData({ ...formData, clubName: e.target.value })}
                    required
                  />

                  <LocationAutocomplete
                    label={t('complete.club.city')}
                    icon={<MapPin className="w-5 h-5" />}
                    placeholder={t('complete.club.cityPlaceholder')}
                    value={formData.city}
                    onChange={handleLocationChange}
                    onLocationSelect={handleLocationSelect}
                    onLocationClear={handleLocationClear}
                    isSelected={formData.locationSelected}
                    required
                  />

                  <CountrySelect
                    label={t('complete.club.country')}
                    value={formData.nationalityCountryId}
                    onChange={(id) => setFormData({ ...formData, nationalityCountryId: id })}
                    placeholder={t('complete.club.countryPlaceholder')}
                    disabled={!showClubClaimStep && !!formData.nationalityCountryId}
                    required
                  />

                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">{t('complete.club.leagueHeading')}</p>

                  <Input
                    label={t('complete.club.yearFounded')}
                    type="number"
                    placeholder={t('complete.club.yearPlaceholder')}
                    value={formData.yearFounded}
                    onChange={(e) => setFormData({ ...formData, yearFounded: e.target.value })}
                  />

                  <Input
                    label={t('complete.club.womensLeague')}
                    placeholder={t('complete.club.womensLeaguePlaceholder')}
                    value={formData.womensLeagueDivision}
                    onChange={(e) => setFormData({ ...formData, womensLeagueDivision: e.target.value })}
                  />

                  <Input
                    label={t('complete.club.mensLeague')}
                    placeholder={t('complete.club.mensLeaguePlaceholder')}
                    value={formData.mensLeagueDivision}
                    onChange={(e) => setFormData({ ...formData, mensLeagueDivision: e.target.value })}
                  />

                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">{t('complete.club.contactHeading')}</p>

                  <Input
                    label={t('complete.club.website')}
                    type="url"
                    placeholder={t('complete.club.websitePlaceholder')}
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  />

                  <Input
                    label={t('complete.club.contactEmail')}
                    type="email"
                    placeholder={t('complete.club.contactEmailPlaceholder')}
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    required
                  />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('complete.club.bio')}
                    </label>
                    <textarea
                      value={formData.clubBio}
                      onChange={(e) => setFormData({ ...formData, clubBio: e.target.value })}
                      placeholder={t('complete.club.bioPlaceholder')}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                      rows={4}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              {userRole === 'club' && (
                <UiButton
                  variant="secondary"
                  onClick={() => setShowClubClaimStep(true)}
                  disabled={loading}
                  className="px-6"
                >
                  {t('complete.form.back')}
                </UiButton>
              )}

              {/* Wizard Back button (umpire, steps 2+) */}
              {isWizardFlow && currentStep > 1 && (
                // Secondary (ui/Button): the legacy Button always carries
                // btn-primary, so the white-outline classes on top gave dark
                // text on the purple gradient (onboarding QA 2026-10-04).
                <UiButton
                  variant="secondary"
                  onClick={handleBack}
                  disabled={loading}
                  className="px-6"
                >
                  {t('complete.form.back')}
                </UiButton>
              )}

              {/* Next (wizard flow, steps 1 and 2) */}
              {isWizardFlow && currentStep < 3 && (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-hockia-primary to-hockia-secondary"
                >
                  {t('complete.form.next')}
                </Button>
              )}

              {/* Complete Profile (final step for wizard, always for club) */}
              {(!isWizardFlow || currentStep === 3) && (
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-hockia-primary to-hockia-secondary"
                >
                  {loading ? t('complete.form.saving') : t('complete.form.submit')}
                </Button>
              )}
            </div>
          </form>
          )}
        </div>
      </div>
    </div>
  )
}
