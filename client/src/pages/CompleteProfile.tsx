import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, MapPin, Calendar, Building2, Camera, UserRound, Briefcase, Users, Store, ChevronRight, Check } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { Input, Button, CountrySelect, LocationAutocomplete } from '@/components'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { useCountries } from '@/hooks/useCountries'
import ClubClaimStep, { type ClubClaimResult } from '@/components/ClubClaimStep'
import WorldClubSearch from '@/components/WorldClubSearch'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { invalidateProfile } from '@/lib/profile'
import { deleteStorageObject } from '@/lib/storage'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { toSentryError } from '@/lib/sentryHelpers'
import { trackOnboardingComplete } from '@/lib/analytics'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { COACH_SPECIALIZATIONS, type CoachSpecialization } from '@/lib/coachSpecializations'
import { validateOnboardingStep, type WizardStep } from '@/lib/onboardingValidation'

type UserRole = 'player' | 'coach' | 'club' | 'brand'

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
  const fileInputRef = useRef<HTMLInputElement>(null)
  const profilePrefilledRef = useRef(false)
  const contactPrefilledRef = useRef<string | null>(null)
  // Mutex ref to prevent concurrent profile creation attempts (race condition guard)
  const profileCreationMutexRef = useRef(false)
  const { user, profile, loading: authLoading, profileStatus, fetchProfile } = useAuthStore()
  const { getCountryById } = useCountries()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string>(profile?.avatar_url || '')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [fallbackRole, setFallbackRole] = useState<UserRole | null>(null)
  const [fallbackEmail, setFallbackEmail] = useState<string>('')
  const [creatingProfile, setCreatingProfile] = useState(false)
  
  // Club claim step state (for clubs only)
  const [showClubClaimStep, setShowClubClaimStep] = useState(true)

  // Staged wizard state for player/coach flows — splits the single long form into
  // 3 progressive steps (identity → background → role details). Club and brand
  // keep their existing flows untouched.
  const [currentStep, setCurrentStep] = useState<WizardStep>(1)
  // Guards the step-viewed analytics so we emit once per (step, role) entry,
  // not on every rerender. Drop-off is computed at analysis time from
  // `wizard_step_viewed` vs. `wizard_step_completed` counts per step.
  const viewedStepsRef = useRef<Set<string>>(new Set())

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
    gender: '',
    yearFounded: '',
    womensLeagueDivision: '',
    mensLeagueDivision: '',
    website: '',
    contactEmail: '',
    clubBio: '',
    clubHistory: '',
    currentClub: '',
    currentWorldClubId: null as string | null,
    coachSpecialization: '' as CoachSpecialization | '',
    coachSpecializationCustom: '',
  })

  const normalizeGender = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const lower = trimmed.toLowerCase()
    if (lower === 'men' || lower === 'male') return 'Men'
    if (lower === 'women' || lower === 'female') return 'Women'
    return null
  }

  // Use profile data from auth store - no need to fetch again
  const userRole = (profile?.role as UserRole | null) ?? fallbackRole ?? (user?.user_metadata?.role as UserRole | undefined) ?? null
  const contactEmailFallback = profile?.contact_email ?? profile?.email ?? user?.email ?? fallbackEmail ?? ''

  // Player and coach get a 3-step wizard. Club keeps its existing claim→form
  // two-step flow; brand is handled on a separate onboarding page entirely.
  const isWizardFlow = userRole === 'player' || userRole === 'coach'

  const stepLabels: Record<UserRole, Record<WizardStep, string>> = {
    player: {
      1: 'About you',
      2: 'Where you are based',
      3: 'Your game',
    },
    coach: {
      1: 'About you',
      2: 'Where you are based',
      3: 'Your coaching',
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
      setError('No user session found. Please sign in again.')
      return
    }

    // Acquire mutex BEFORE any async operation
    profileCreationMutexRef.current = true
    setCreatingProfile(true)
    setError('')

    try {
      logger.debug('[COMPLETE_PROFILE] Creating profile for OAuth user', { userId: user.id, role: selectedRole })
      onboardingBreadcrumb('role_selected.start', { role: selectedRole })

      const userEmail = user.email || ''

      // Call the RPC function to create the profile row
      const { data: newProfile, error: rpcError } = await supabase.rpc('create_profile_for_new_user', {
        user_id: user.id,
        user_email: userEmail,
        user_role: selectedRole,
      })

      if (rpcError) {
        captureOnboardingError(rpcError, {
          role: selectedRole,
          stage: 'createProfileForOAuth',
        }, 'CompleteProfile.handleRoleSelection.rpc')
        throw new Error(`Failed to create profile: ${rpcError.message}`)
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
      setError(err instanceof Error ? err.message : 'Failed to create profile. Please try again.')
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

      if (profile.role === 'club') {
        next.clubName = profile.full_name ?? prev.clubName
        next.nationalityCountryId = profile.nationality_country_id ?? prev.nationalityCountryId
        next.yearFounded = profile.year_founded ? String(profile.year_founded) : prev.yearFounded
        next.womensLeagueDivision = profile.womens_league_division ?? prev.womensLeagueDivision
        next.mensLeagueDivision = profile.mens_league_division ?? prev.mensLeagueDivision
        next.website = profile.website ?? prev.website
        next.contactEmail = profile.contact_email ?? next.contactEmail
        next.clubBio = profile.club_bio ?? prev.clubBio
        next.clubHistory = profile.club_history ?? prev.clubHistory
      } else {
        next.fullName = profile.full_name ?? prev.fullName
        next.gender = profile.gender ?? prev.gender
        next.dateOfBirth = profile.date_of_birth ?? prev.dateOfBirth

        if (profile.role === 'player') {
          next.position = profile.position ?? prev.position
          next.secondaryPosition = profile.secondary_position ?? prev.secondaryPosition
        } else if (profile.role === 'coach') {
          next.coachSpecialization = (profile.coach_specialization ?? prev.coachSpecialization) as CoachSpecialization | ''
          next.coachSpecializationCustom = profile.coach_specialization_custom ?? prev.coachSpecializationCustom
        }
      }

      return next
    })

    if (profile.contact_email) {
      contactPrefilledRef.current = profile.contact_email
    }

    if (profile.avatar_url) {
      setAvatarUrl(profile.avatar_url)
    }
  }, [profile])

  // Handle club claim step completion
  const handleClubClaimComplete = (result: ClubClaimResult) => {
    logger.debug('[CompleteProfile] Club claim completed:', result)
    setShowClubClaimStep(false)

    // Pre-fill form with claim data (country ID + region from Step 1)
    setFormData(prev => ({
      ...prev,
      clubName: result.clubName,
      nationalityCountryId: result.countryId || prev.nationalityCountryId,
      city: result.regionName || prev.city,
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
        setError(validation.error || 'Invalid image')
        return
      }

      logger.debug('Optimizing avatar image...')
      const optimizedFile = await optimizeAvatarImage(file)

      const fileExt = optimizedFile.name.split('.').pop() || 'jpg'
      const filePath = `${user.id}/avatar_${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, optimizedFile, { upsert: true, cacheControl: '31536000' })

      if (uploadError) {
        captureOnboardingError(uploadError, {
          role: userRole,
          hasUser: Boolean(user?.id),
          fileSizeBytes: optimizedFile.size,
        }, 'CompleteProfile.handleAvatarUpload.upload')
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      const previousUrl = avatarUrl || profile?.avatar_url || null
      setAvatarUrl(publicUrl)
      if (previousUrl && previousUrl !== publicUrl) {
        await deleteStorageObject({ bucket: 'avatars', publicUrl: previousUrl, context: 'complete-profile:replace-avatar' })
      }
      logger.info('Avatar uploaded successfully')
      trackDbEvent('onboarding_step', 'profile', user.id, { step: 'avatar_uploaded' })
    } catch (err) {
      captureOnboardingError(err, {
        stage: 'avatarUploadCatch',
        role: userRole,
        hasUser: Boolean(user?.id),
      }, 'CompleteProfile.handleAvatarUpload.catch')
      logger.error('Error uploading avatar:', err)
      setError('We couldn\'t upload this image. Please use PNG or JPG up to 5MB.')
    } finally {
      setUploadingAvatar(false)
    }
  }

  // Handle avatar click — use native picker on Capacitor, file input on web
  const handleAvatarClick = async () => {
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt')
        if (result) {
          await uploadAvatarFile(result.file)
        }
      } catch (err) {
        logger.error('Native image picker error:', err)
        setError('Could not access camera or photos. Please check app permissions.')
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
    if (userRole !== 'player' && userRole !== 'coach') return
    const stepError = validateOnboardingStep(currentStep, userRole, formData)
    if (stepError) {
      setError(stepError)
      // Emit so we can see which step + which validation rule users get stuck on.
      trackDbEvent('onboarding_step', 'profile', user?.id, {
        step: 'wizard_step_validation_failed',
        role: userRole,
        wizard_step: currentStep,
        reason: stepError,
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

  // Client-side validation
  const validateForm = (): string | null => {
    if (userRole === 'player') {
      if (!formData.fullName.trim()) return 'Full name is required.'
      if (!formData.city.trim()) return 'Base location is required.'
      if (!formData.nationalityCountryId) return 'Nationality is required.'
      if (!formData.position) return 'Position is required.'
      if (!formData.gender) return 'Gender is required.'
      if (formData.secondaryPosition && formData.secondaryPosition === formData.position) {
        return 'Primary and secondary positions must be different.'
      }
    } else if (userRole === 'coach') {
      if (!formData.fullName.trim()) return 'Full name is required.'
      if (!formData.city.trim()) return 'Base location is required.'
      if (!formData.nationalityCountryId) return 'Nationality is required.'
      if (!formData.gender) return 'Gender is required.'
      if (!formData.coachSpecialization) return 'Please select your coaching specialization.'
      if (formData.coachSpecialization === 'other' && !formData.coachSpecializationCustom.trim()) {
        return 'Please enter your role title.'
      }
    } else if (userRole === 'club') {
      if (!formData.clubName.trim()) return 'Club name is required.'
      if (!formData.city.trim()) return 'City is required.'
      if (!formData.nationalityCountryId) return 'Country is required.'
      if (!formData.contactEmail.trim()) return 'Contact email is required.'
      // Basic email validation
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(formData.contactEmail)) {
        return 'Please enter a valid email address.'
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

    // Run client-side validation first
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }
    
    setLoading(true)
    trackDbEvent('onboarding_step', 'profile', user?.id, { step: 'form_submitted', role: userRole })
    let lastUpdatedFields: string[] = []

    try {
      if (!user) {
        throw new Error('Session not found')
      }

      if (!userRole) {
        throw new Error('Profile role not found')
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

      let updateData: Record<string, unknown> = {
        role: userRole, // IMPORTANT: Always include role in update
        full_name: formData.fullName || formData.clubName || '',
        base_location: formData.city || '',
        base_city: formData.baseCity || null,
        base_country_id: formData.baseCountryId || null,
        nationality: nationalityText, // Synced from country_id for backward compatibility
        nationality_country_id: formData.nationalityCountryId,
        onboarding_completed: true, // Mark onboarding as complete
        avatar_url: avatarUrl || null, // Include avatar if uploaded
      }

      if (userRole === 'player') {
        updateData = {
          ...updateData,
          nationality2_country_id: formData.nationality2CountryId || null,
          position: formData.position,
          secondary_position: formData.secondaryPosition || null,
          gender: normalizeGender(formData.gender),
          date_of_birth: formData.dateOfBirth || null,
          current_club: formData.currentClub || null,
          current_world_club_id: formData.currentWorldClubId,
        }
      } else if (userRole === 'coach') {
        updateData = {
          ...updateData,
          nationality2_country_id: formData.nationality2CountryId,
          position: formData.position || null,
          gender: normalizeGender(formData.gender),
          date_of_birth: formData.dateOfBirth || null,
          current_club: formData.currentClub || null,
          current_world_club_id: formData.currentWorldClubId,
          coach_specialization: formData.coachSpecialization || null,
          coach_specialization_custom: formData.coachSpecialization === 'other'
            ? formData.coachSpecializationCustom.trim()
            : null,
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
          throw new Error('Could not create your profile. Please try signing out and back in.')
        }
      }

      // Update profile
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update(updateData)
        .eq('id', user.id)
        .select('*')
        .single()

      if (updateError) {
        captureOnboardingError(updateError, {
          role: userRole,
          updatedFields: lastUpdatedFields,
        }, 'CompleteProfile.handleSubmit.updateProfile')
        logger.error('Error updating profile:', updateError)
        throw new Error(`Failed to update profile: ${updateError.message}`)
      }

      if (!updatedProfile) {
        throw new Error('Profile update did not return data. Please try again.')
      }

      logger.debug('Profile updated successfully')

      // Fetch the updated profile to verify (additional safety)
      const { data: verifiedProfile, error: fetchError } = await supabase
        .from('profiles')
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
        throw new Error('Profile updated but could not verify. Please refresh the page.')
      }

      logger.debug('Updated profile verified:', verifiedProfile)

      // CRITICAL: Refresh the auth store so dependent routes pick up the update
      await invalidateProfile({ userId: user.id, reason: 'complete-profile' })
      
      logger.debug('Auth store refreshed - profile now complete')
      localStorage.setItem('hockia-onboarding-completed', '1')
      trackOnboardingComplete(userRole ?? 'unknown')
      trackDbEvent('onboarding_completed', 'profile', user?.id, { role: userRole })
      navigate('/dashboard/profile', { replace: true })

    } catch (err) {
      captureOnboardingError(err, {
        stage: 'handleSubmitCatch',
        role: userRole,
        updatedFields: lastUpdatedFields,
      }, 'CompleteProfile.handleSubmit.catch')
      logger.error('Complete profile error:', err)
      setError(err instanceof Error ? err.message : 'Failed to complete profile. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Show loading while auth is initializing
  if (authLoading || (profileStatus === 'fetching' && !profile)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-[#8026FA] mb-4"></div>
          <p className="text-gray-600">Loading your profile...</p>
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
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Profile Error</h2>
          <p className="text-gray-600 mb-6">
            {'No session found. Please sign in again.'}
          </p>
          <button
            onClick={() => navigate('/')}
            className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            Back to Home
          </button>
        </div>
      </div>
    )
  }

  if (!userRole) {
    // Show role selection for OAuth users who don't have a role yet
    return (
      <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
        <div className="absolute inset-0">
          <img 
            src="/hero-desktop.webp"
            alt="Field Hockey"
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/70" />
        </div>

        <div className="relative z-10 w-full max-w-2xl">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-[#8026FA] to-[#924CEC]">
              <div className="flex items-center gap-3 mb-2">
                <img
                  src="/WhiteLogo.svg"
                  alt="HOCKIA"
                  className="h-8"
                />
              </div>
              <p className="text-white/90 text-sm">
                Welcome to HOCKIA! Let's get you set up.
              </p>
            </div>

            <div className="p-8">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Choose Your Role</h3>
              <p className="text-gray-600 mb-6">How will you be using HOCKIA?</p>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg" role="alert" aria-live="assertive">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <div className="space-y-4">
                {/* Player Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelection('player')}
                  disabled={creatingProfile}
                  className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-purple-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center group-hover:from-purple-200 group-hover:to-indigo-200 transition-colors">
                      <UserRound className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">I'm a Player</h4>
                      <p className="text-sm text-gray-500">Looking for opportunities and showcasing my skills</p>
                    </div>
                  </div>
                </button>

                {/* Coach Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelection('coach')}
                  disabled={creatingProfile}
                  className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-purple-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center group-hover:from-purple-200 group-hover:to-indigo-200 transition-colors">
                      <Briefcase className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">I'm a Coach</h4>
                      <p className="text-sm text-gray-500">Seeking coaching positions and connecting with clubs</p>
                    </div>
                  </div>
                </button>

                {/* Club Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelection('club')}
                  disabled={creatingProfile}
                  className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-purple-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center group-hover:from-purple-200 group-hover:to-indigo-200 transition-colors">
                      <Users className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">I'm a Club</h4>
                      <p className="text-sm text-gray-500">Recruiting players and coaches for my organization</p>
                    </div>
                  </div>
                </button>

                {/* Brand Option */}
                <button
                  type="button"
                  onClick={() => handleRoleSelection('brand')}
                  disabled={creatingProfile}
                  className="w-full p-4 border-2 border-gray-200 rounded-xl hover:border-[#8026FA] hover:bg-purple-50 transition-all text-left group disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center group-hover:from-purple-200 group-hover:to-indigo-200 transition-colors">
                      <Store className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900">I'm a Brand</h4>
                      <p className="text-sm text-gray-500">Showcasing products and connecting with athletes</p>
                    </div>
                  </div>
                </button>
              </div>

              {creatingProfile && (
                <div className="mt-6 text-center">
                  <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-[#8026FA] mb-2"></div>
                  <p className="text-sm text-gray-500">Setting up your profile...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-4">
      <div className="absolute inset-0">
        <img 
          src="/hero-desktop.webp"
          alt="Field Hockey"
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/70" />
      </div>

      <div className="relative z-10 w-full max-w-2xl">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="p-6 border-b border-gray-200 bg-gradient-to-r from-[#8026FA] to-[#924CEC]">
            <div className="flex items-center gap-3 mb-2">
              <img
                src="/WhiteLogo.svg"
                alt="HOCKIA"
                className="h-8"
              />
            </div>
            <p className="text-white/90 text-sm">
              Complete your profile to get started
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
                  Step {showClubClaimStep ? '1' : '2'} of 2
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
          <form onSubmit={handleSubmit} className="p-8 max-h-[80vh] overflow-y-auto">
            <h3 className="text-2xl font-bold text-gray-900 mb-2">
              {userRole === 'player' && 'Complete Player Profile'}
              {userRole === 'coach' && 'Complete Coach Profile'}
              {userRole === 'club' && 'Complete Club Profile'}
            </h3>
            <p className="text-gray-600 mb-6">
              {isWizardFlow ? `Step ${currentStep} of 3 — ${stepLabels[userRole][currentStep]}` : 'Fill in your details below'}
            </p>

            {/* Step indicator — player/coach only.
                A11y: the visual circles + connectors are decorative; each step
                is an <li> whose sr-only text announces its number, label, and
                status so screen-reader users get the same information. The
                outer <ol> carries the list semantics (navigation convention
                for wizard/step UIs). */}
            {isWizardFlow && (
              <ol
                className="mb-6 flex items-center gap-2"
                aria-label="Profile completion steps"
              >
                {([1, 2, 3] as WizardStep[]).map((step, idx) => {
                  const isCompleted = step < currentStep
                  const isActive = step === currentStep
                  const statusText = isCompleted
                    ? 'completed'
                    : isActive
                    ? 'current step'
                    : 'not started'
                  return (
                    <li key={step} className="flex items-center flex-1">
                      <div
                        className={
                          isCompleted
                            ? 'flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold bg-emerald-500'
                            : isActive
                            ? 'flex items-center justify-center w-7 h-7 rounded-full text-white text-xs font-semibold bg-gradient-to-br from-[#8026FA] to-[#924CEC] ring-4 ring-[#8026FA]/15'
                            : 'flex items-center justify-center w-7 h-7 rounded-full text-gray-400 text-xs font-semibold border-2 border-gray-200 bg-white'
                        }
                        aria-current={isActive ? 'step' : undefined}
                      >
                        <span aria-hidden="true">
                          {isCompleted ? <Check className="w-3.5 h-3.5" /> : step}
                        </span>
                        <span className="sr-only">
                          {`Step ${step} of 3, ${stepLabels[userRole][step]}, ${statusText}`}
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
                Profile Photo <span className="text-gray-500">(Optional)</span>
              </label>
              <div className="flex items-center gap-4">
                <div
                  onClick={handleAvatarClick}
                  className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center cursor-pointer hover:from-purple-200 hover:to-indigo-200 transition-all overflow-hidden border-2 border-white shadow-md"
                >
                  {avatarUrl ? (
                    <img src={avatarUrl} alt="Avatar preview" className="w-full h-full object-cover" />
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
                        Uploading...
                      </span>
                    ) : avatarUrl ? (
                      'Change Photo'
                    ) : (
                      'Upload Photo'
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-1">PNG or JPG, up to 5MB</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={handleAvatarUpload}
                className="hidden"
                disabled={uploadingAvatar}
                aria-label="Upload profile photo"
              />
            </div>
            )}

            <div className="space-y-4">
              {/* Player Form — split across the 3 wizard steps. */}
              {userRole === 'player' && (
                <>
                  {currentStep === 1 && (
                    <>
                      <Input
                        label="Full Name"
                        icon={<User className="w-5 h-5" />}
                        placeholder="Enter your full name"
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required
                      />

                      <CountrySelect
                        label="Nationality"
                        value={formData.nationalityCountryId}
                        onChange={(id) => setFormData({ ...formData, nationalityCountryId: id })}
                        placeholder="Select your nationality"
                        showNationality
                        required
                      />

                      <CountrySelect
                        label="Second Nationality (Optional)"
                        value={formData.nationality2CountryId}
                        onChange={(id) => setFormData({ ...formData, nationality2CountryId: id })}
                        placeholder="Select second nationality"
                        showNationality
                      />
                    </>
                  )}

                  {currentStep === 2 && (
                    <>
                      <LocationAutocomplete
                        label="Base Location (City)"
                        icon={<MapPin className="w-5 h-5" />}
                        placeholder="Where are you currently based?"
                        value={formData.city}
                        onChange={handleLocationChange}
                        onLocationSelect={handleLocationSelect}
                        onLocationClear={handleLocationClear}
                        isSelected={formData.locationSelected}
                        required
                      />

                      <div>
                        <label htmlFor="gender-select" className="block text-sm font-medium text-gray-700 mb-2">
                          Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="gender-select"
                          value={formData.gender}
                          onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                          required
                        >
                          <option value="">Select gender</option>
                          <option value="Men">Men</option>
                          <option value="Women">Women</option>
                        </select>
                      </div>

                      <Input
                        label="Date of Birth (Optional)"
                        type="date"
                        icon={<Calendar className="w-5 h-5" />}
                        value={formData.dateOfBirth}
                        onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                      />
                    </>
                  )}

                  {currentStep === 3 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">Hockey Details</p>

                      <WorldClubSearch
                        value={formData.currentClub}
                        onChange={(v) => setFormData({ ...formData, currentClub: v })}
                        onClubSelect={(club) => setFormData({
                          ...formData,
                          currentClub: club.club_name,
                          currentWorldClubId: club.id,
                        })}
                        onClubClear={() => setFormData({ ...formData, currentWorldClubId: null })}
                        selectedClubId={formData.currentWorldClubId}
                        label="Current Club (Optional)"
                        placeholder="e.g., Holcombe Hockey Club"
                      />

                      <div>
                        <label htmlFor="position-select" className="block text-sm font-medium text-gray-700 mb-2">
                          Position <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="position-select"
                          value={formData.position}
                          onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                          required
                        >
                          <option value="">Select your position</option>
                          <option value="goalkeeper">Goalkeeper</option>
                          <option value="defender">Defender</option>
                          <option value="midfielder">Midfielder</option>
                          <option value="forward">Forward</option>
                        </select>
                      </div>

                      <div>
                        <label htmlFor="secondary-position-select" className="block text-sm font-medium text-gray-700 mb-2">
                          Second Position (Optional)
                        </label>
                        <select
                          id="secondary-position-select"
                          value={formData.secondaryPosition}
                          onChange={(e) => setFormData({ ...formData, secondaryPosition: e.target.value })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                        >
                          <option value="">No secondary position</option>
                          {['goalkeeper', 'defender', 'midfielder', 'forward'].map((option) => (
                            <option key={option} value={option} disabled={option === formData.position}>
                              {option.charAt(0).toUpperCase() + option.slice(1)}
                            </option>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </>
              )}

              {/* Coach Form — split across the 3 wizard steps. */}
              {userRole === 'coach' && (
                <>
                  {currentStep === 1 && (
                    <>
                      <Input
                        label="Full Name"
                        icon={<User className="w-5 h-5" />}
                        placeholder="Enter your full name"
                        value={formData.fullName}
                        onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                        required
                      />

                      <CountrySelect
                        label="Nationality"
                        value={formData.nationalityCountryId}
                        onChange={(id) => setFormData({ ...formData, nationalityCountryId: id })}
                        placeholder="Select your nationality"
                        showNationality
                        required
                      />

                      <CountrySelect
                        label="Secondary Nationality (Optional)"
                        value={formData.nationality2CountryId}
                        onChange={(id) => setFormData({ ...formData, nationality2CountryId: id })}
                        placeholder="Select secondary nationality"
                        showNationality
                      />
                    </>
                  )}

                  {currentStep === 2 && (
                    <>
                      <LocationAutocomplete
                        label="Base Location (City)"
                        icon={<MapPin className="w-5 h-5" />}
                        placeholder="Where are you currently based?"
                        value={formData.city}
                        onChange={handleLocationChange}
                        onLocationSelect={handleLocationSelect}
                        onLocationClear={handleLocationClear}
                        isSelected={formData.locationSelected}
                        required
                      />

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="coach-gender">
                          Gender <span className="text-red-500">*</span>
                        </label>
                        <select
                          id="coach-gender"
                          value={formData.gender}
                          onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                          required
                        >
                          <option value="">Select gender</option>
                          <option value="Men">Men</option>
                          <option value="Women">Women</option>
                        </select>
                      </div>

                      <Input
                        label="Date of Birth"
                        type="date"
                        icon={<Calendar className="w-5 h-5" />}
                        value={formData.dateOfBirth}
                        onChange={(e) => setFormData({ ...formData, dateOfBirth: e.target.value })}
                      />
                    </>
                  )}

                  {currentStep === 3 && (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">Coaching Details</p>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Specialization <span className="text-red-500">*</span>
                        </label>
                        <p className="text-xs text-gray-500 mb-3">What best describes your professional role?</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {COACH_SPECIALIZATIONS.map((spec) => (
                            <button
                              key={spec.value}
                              type="button"
                              onClick={() => setFormData({ ...formData, coachSpecialization: spec.value })}
                              className={`p-3 rounded-lg border-2 text-left transition-all ${
                                formData.coachSpecialization === spec.value
                                  ? 'border-[#8026FA] bg-purple-50'
                                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className={`text-sm font-medium ${
                                  formData.coachSpecialization === spec.value ? 'text-[#8026FA]' : 'text-gray-900'
                                }`}>
                                  {spec.label}
                                </span>
                                {formData.coachSpecialization === spec.value && (
                                  <ChevronRight className="w-4 h-4 text-[#8026FA]" />
                                )}
                              </div>
                              <p className="text-xs text-gray-500 mt-0.5">{spec.description}</p>
                            </button>
                          ))}
                        </div>
                        {formData.coachSpecialization === 'other' && (
                          <div className="mt-3">
                            <Input
                              label="Your Role Title"
                              placeholder="e.g., Team Manager, Umpire Coach"
                              value={formData.coachSpecializationCustom}
                              onChange={(e) => setFormData({ ...formData, coachSpecializationCustom: e.target.value })}
                              required
                            />
                          </div>
                        )}
                      </div>

                      <WorldClubSearch
                        value={formData.currentClub}
                        onChange={(v) => setFormData({ ...formData, currentClub: v })}
                        onClubSelect={(club) => setFormData({
                          ...formData,
                          currentClub: club.club_name,
                          currentWorldClubId: club.id,
                        })}
                        onClubClear={() => setFormData({ ...formData, currentWorldClubId: null })}
                        selectedClubId={formData.currentWorldClubId}
                        label="Current Club (Optional)"
                        placeholder="e.g., Holcombe Hockey Club"
                      />
                    </>
                  )}
                </>
              )}

              {/* Club Form */}
              {userRole === 'club' && (
                <>
                  <Input
                    label="Club Name"
                    icon={<Building2 className="w-5 h-5" />}
                    placeholder="Enter your club name"
                    value={formData.clubName}
                    onChange={(e) => setFormData({ ...formData, clubName: e.target.value })}
                    required
                  />

                  <LocationAutocomplete
                    label="City"
                    icon={<MapPin className="w-5 h-5" />}
                    placeholder="Club location"
                    value={formData.city}
                    onChange={handleLocationChange}
                    onLocationSelect={handleLocationSelect}
                    onLocationClear={handleLocationClear}
                    isSelected={formData.locationSelected}
                    required
                  />

                  <CountrySelect
                    label="Country"
                    value={formData.nationalityCountryId}
                    onChange={(id) => setFormData({ ...formData, nationalityCountryId: id })}
                    placeholder="Select country"
                    disabled={!showClubClaimStep && !!formData.nationalityCountryId}
                    required
                  />

                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">League Information</p>

                  <Input
                    label="Year Founded (Optional)"
                    type="number"
                    placeholder="YYYY"
                    value={formData.yearFounded}
                    onChange={(e) => setFormData({ ...formData, yearFounded: e.target.value })}
                  />

                  <Input
                    label="Women's League (Optional)"
                    placeholder="e.g. Serie A1"
                    value={formData.womensLeagueDivision}
                    onChange={(e) => setFormData({ ...formData, womensLeagueDivision: e.target.value })}
                  />

                  <Input
                    label="Men's League (Optional)"
                    placeholder="e.g. Elite Division"
                    value={formData.mensLeagueDivision}
                    onChange={(e) => setFormData({ ...formData, mensLeagueDivision: e.target.value })}
                  />

                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 pt-2">Contact & About</p>

                  <Input
                    label="Website (Optional)"
                    type="url"
                    placeholder="https://yourclub.com"
                    value={formData.website}
                    onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                  />

                  <Input
                    label="Contact Email"
                    type="email"
                    placeholder="contact@club.com"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    required
                  />

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Club Bio (Optional)
                    </label>
                    <textarea
                      value={formData.clubBio}
                      onChange={(e) => setFormData({ ...formData, clubBio: e.target.value })}
                      placeholder="Tell us about your club..."
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                      rows={4}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              {userRole === 'club' && (
                <Button
                  type="button"
                  onClick={() => setShowClubClaimStep(true)}
                  disabled={loading}
                  className="px-6 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Back
                </Button>
              )}

              {/* Wizard Back button (player/coach, steps 2+) */}
              {isWizardFlow && currentStep > 1 && (
                <Button
                  type="button"
                  onClick={handleBack}
                  disabled={loading}
                  className="px-6 border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                >
                  Back
                </Button>
              )}

              {/* Next (wizard flow, steps 1 and 2) */}
              {isWizardFlow && currentStep < 3 && (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
                >
                  Next
                </Button>
              )}

              {/* Complete Profile (final step for wizard, always for club) */}
              {(!isWizardFlow || currentStep === 3) && (
                <Button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-gradient-to-r from-[#8026FA] to-[#924CEC]"
                >
                  {loading ? 'Saving Profile...' : 'Complete Profile'}
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
