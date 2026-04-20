import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X, Upload, Loader2, Trophy, MapPin } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'
import { Button, Input, CountrySelect, StorageImage, LocationAutocomplete } from '@/components'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { logger } from '@/lib/logger'
import { optimizeAvatarImage, validateImage } from '@/lib/imageOptimization'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useCountries } from '@/hooks/useCountries'
import { invalidateProfile } from '@/lib/profile'
import { useToastStore } from '@/lib/toast'
import { deleteStorageObject } from '@/lib/storage'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { toSentryError } from '@/lib/sentryHelpers'
import { clearProfileDraft, loadProfileDraft, saveProfileDraft } from '@/lib/profileDrafts'
import { trackDbEvent } from '@/lib/trackDbEvent'
import SocialLinksInput from './SocialLinksInput'
import WorldClubSearch from './WorldClubSearch'
import { type SocialLinks, cleanSocialLinks, validateSocialLinks } from '@/lib/socialLinks'
import { COACH_SPECIALIZATIONS, type CoachSpecialization } from '@/lib/coachSpecializations'

interface EditProfileModalProps {
  isOpen: boolean
  onClose: () => void
  role: 'player' | 'coach' | 'club'
}

type ProfileFormData = {
  full_name: string
  base_location: string
  base_city: string
  base_country_id: number | null
  location_selected: boolean
  nationality: string
  nationality_country_id: number | null
  nationality2_country_id: number | null
  date_of_birth: string
  position: string
  secondary_position: string
  gender: string
  current_club: string
  current_world_club_id: string | null
  year_founded: string
  womens_league_division: string
  mens_league_division: string
  womens_league_id: number | null
  mens_league_id: number | null
  world_region_id: number | null
  website: string
  contact_email: string
  contact_email_public: boolean
  club_bio: string
  club_history: string
  bio: string
  avatar_url: string
  social_links: SocialLinks
  open_to_play: boolean
  open_to_coach: boolean
  open_to_opportunities: boolean
  brand_representation: string
  coach_specialization: CoachSpecialization | ''
  coach_specialization_custom: string
}

interface WorldRegion {
  id: number
  name: string
  slug: string
}

interface WorldLeague {
  id: number
  name: string
  province_id: number
  tier: number | null
}

interface WorldClubClaim {
  id: string
  province_id: number | null
  country_id: number
}

const getInitialContactEmail = (profile?: Profile | null): string => profile?.contact_email || ''

/**
 * Validates form data before submission.
 * Returns an error message string if invalid, or null if valid.
 */
function validateFormData(formData: ProfileFormData, role: string): string | null {
  // Universal required field
  if (!formData.full_name.trim()) {
    return 'Full name is required.'
  }

  // Role-specific validation
  if (role === 'player' && formData.secondary_position && formData.secondary_position === formData.position) {
    return 'Primary and secondary positions must be different.'
  }

  if ((role === 'player' || role === 'coach') && !formData.base_location.trim()) {
    return 'Location is required.'
  }

  if (role === 'club' && !formData.base_location.trim()) {
    return 'Club location is required.'
  }

  const cleanedSocialLinks = cleanSocialLinks(formData.social_links)
  const socialLinksValidation = validateSocialLinks(cleanedSocialLinks)
  if (!socialLinksValidation.valid) {
    return socialLinksValidation.error || 'Invalid social media links'
  }

  return null
}

const buildInitialFormData = (profile?: Profile | null): ProfileFormData => ({
  full_name: profile?.full_name || '',
  base_location: profile?.base_location || '',
  base_city: profile?.base_city || '',
  base_country_id: profile?.base_country_id ?? null,
  location_selected: !!(profile?.base_city && profile?.base_country_id),
  nationality: profile?.nationality || '',
  nationality_country_id: profile?.nationality_country_id ?? null,
  nationality2_country_id: profile?.nationality2_country_id ?? null,
  date_of_birth: profile?.date_of_birth || '',
  position: profile?.position || '',
  secondary_position: profile?.secondary_position || '',
  gender: profile?.gender || '',
  current_club: profile?.current_club || '',
  current_world_club_id: profile?.current_world_club_id ?? null,
  year_founded: profile?.year_founded?.toString() || '',
  womens_league_division: profile?.womens_league_division || '',
  mens_league_division: profile?.mens_league_division || '',
  womens_league_id: profile?.womens_league_id ?? null,
  mens_league_id: profile?.mens_league_id ?? null,
  world_region_id: profile?.world_region_id ?? null,
  website: profile?.website || '',
  contact_email: getInitialContactEmail(profile),
  contact_email_public: Boolean(profile?.contact_email_public),
  club_bio: profile?.club_bio || '',
  club_history: profile?.club_history || '',
  bio: profile?.bio || '',
  avatar_url: profile?.avatar_url || '',
  social_links: (profile?.social_links as SocialLinks) || {},
  open_to_play: Boolean(profile?.open_to_play),
  open_to_coach: Boolean(profile?.open_to_coach),
  open_to_opportunities: Boolean(profile?.open_to_opportunities),
  brand_representation: profile?.brand_representation || '',
  coach_specialization: (profile?.coach_specialization as CoachSpecialization) || '',
  coach_specialization_custom: profile?.coach_specialization_custom || '',
})

export default function EditProfileModal({ isOpen, onClose, role }: EditProfileModalProps) {
  const { profile, setProfile } = useAuthStore()
  const { addToast } = useToastStore()
  const { getCountryById } = useCountries()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const modalOpenRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const titleId = useId()
  const activeProfileId = profile?.id ?? null

  const [formData, setFormData] = useState<ProfileFormData>(() => buildInitialFormData(profile))

  // World directory state for claimed clubs
  const [worldClaim, setWorldClaim] = useState<WorldClubClaim | null>(null)
  const [worldRegions, setWorldRegions] = useState<WorldRegion[]>([])
  const [worldLeagues, setWorldLeagues] = useState<WorldLeague[]>([])
  const [loadingWorld, setLoadingWorld] = useState(false)
  const [countryHasRegions, setCountryHasRegions] = useState(false)

  // Fetch world claim data for clubs
  useEffect(() => {
    if (!isOpen || role !== 'club' || !profile?.id) return

    const fetchWorldClaim = async () => {
      setLoadingWorld(true)
      try {
        // Check if this club is claimed in world_clubs
        const { data: claimData } = await supabase
          .from('world_clubs')
          .select('id, province_id, country_id')
          .eq('claimed_profile_id', profile.id)
          .eq('is_claimed', true)
          .single()

        if (claimData) {
          setWorldClaim(claimData)

          // Check if country has regions using the view
          const { data: countryInfo } = await supabase
            .from('world_countries_with_directory')
            .select('has_regions')
            .eq('country_id', claimData.country_id)
            .single()

          const hasRegions = countryInfo?.has_regions ?? false
          setCountryHasRegions(hasRegions)

          if (hasRegions) {
            // Fetch regions for this country
            const { data: regions } = await supabase
              .from('world_provinces')
              .select('id, name, slug')
              .eq('country_id', claimData.country_id)
              .order('display_order')

            setWorldRegions(regions || [])
          }

          // Fetch leagues using the RPC function (works for both region-based and country-only)
           
          const { data: leagues } = await supabase.rpc('get_leagues_for_location', {
            p_country_id: claimData.country_id,
            p_region_id: claimData.province_id ?? undefined
          }) as { data: { id: number; name: string; tier: number | null; logical_id: string | null }[] | null; error: Error | null }

          // Map to the expected format
          setWorldLeagues((leagues || []).map(l => ({
            id: l.id,
            name: l.name,
            province_id: claimData.province_id ?? 0,
            tier: l.tier
          })))
        } else {
          setWorldClaim(null)
          setWorldRegions([])
          setWorldLeagues([])
          setCountryHasRegions(false)
        }
      } catch (err) {
        logger.error('[EditProfileModal] Failed to fetch world claim:', err)
      } finally {
        setLoadingWorld(false)
      }
    }

    fetchWorldClaim()
  }, [isOpen, role, profile?.id])

  // For countries with regions, filter leagues by selected region
  // For countries without regions, show all leagues (already filtered by country)
  const filteredLeagues = countryHasRegions
    ? worldLeagues.filter(l => l.province_id === formData.world_region_id)
    : worldLeagues

  // Handler to update both nationality_country_id and the legacy nationality string
  const handleNationalityChange = useCallback((countryId: number | null) => {
    const country = countryId ? getCountryById(countryId) : null
    setFormData(prev => ({
      ...prev,
      nationality_country_id: countryId,
      nationality: country?.nationality_name || '', // Use demonym for nationality text
    }))
  }, [getCountryById])

  // Location autocomplete handlers
  const handleLocationChange = useCallback((value: string) => {
    setFormData(prev => ({
      ...prev,
      base_location: value,
      base_city: '',
      base_country_id: null,
      location_selected: false,
    }))
  }, [])

  const handleLocationSelect = useCallback((location: LocationSelection) => {
    setFormData(prev => ({
      ...prev,
      base_location: location.displayName,
      base_city: location.city,
      base_country_id: location.countryId,
      location_selected: true,
    }))
  }, [])

  const handleLocationClear = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      base_location: '',
      base_city: '',
      base_country_id: null,
      location_selected: false,
    }))
  }, [])

  const captureOnboardingError = (error: unknown, payload: Record<string, unknown>, sourceComponent: string) => {
    Sentry.captureException(toSentryError(error), {
      tags: { feature: 'onboarding_profile' },
      extra: {
        userId: profile?.id ?? null,
        payload,
        sourceComponent,
      },
    })
  }

  const isDirty = useCallback(() => {
    if (!profile) return false
    const initial = buildInitialFormData(profile)
    return JSON.stringify(formData) !== JSON.stringify(initial)
  }, [formData, profile])

  const handleDismiss = useCallback(() => {
    if (loading) {
      return
    }
    if (isDirty() && !window.confirm('You have unsaved changes. Discard them?')) {
      return
    }
    onClose()
  }, [loading, onClose, isDirty])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen && Boolean(profile), initialFocusRef: closeButtonRef })

  useEffect(() => {
    if (!isOpen || !profile) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        handleDismiss()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleDismiss, isOpen, profile])

  useEffect(() => {
    if (!profile) return

    const justOpened = isOpen && !modalOpenRef.current
    modalOpenRef.current = isOpen
    if (!justOpened) return

    const baseState = buildInitialFormData(profile)
    const draft = loadProfileDraft<ProfileFormData>(profile.id, role)

    if (draft) {
      setFormData({ ...baseState, ...draft })
    } else {
      setFormData(baseState)
    }
  }, [isOpen, profile, role])

  useEffect(() => {
    if (!isOpen || !activeProfileId) return

    const timeoutId = typeof window === 'undefined'
      ? null
      : window.setTimeout(() => {
          saveProfileDraft(activeProfileId, role, formData)
        }, 400)

    if (timeoutId === null && typeof window === 'undefined') {
      saveProfileDraft(activeProfileId, role, formData)
    }

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [activeProfileId, formData, isOpen, role])

  if (!isOpen || !profile) return null

  /** Upload a File to Supabase avatars bucket and update form state. */
  const uploadAvatarFile = async (file: File) => {
    if (!profile) return

    try {
      const validation = validateImage(file, { maxFileSizeMB: 5 })
      if (!validation.valid) {
        setError(validation.error || 'Invalid image')
        return
      }

      logger.debug('Optimizing avatar image...')
      const optimizedFile = await optimizeAvatarImage(file)

      const fileExt = optimizedFile.name.split('.').pop() || 'jpg'
      const filePath = `${profile.id}/avatar_${Date.now()}.${fileExt}`

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, optimizedFile, { upsert: true, cacheControl: '31536000' })

      if (uploadError) {
        captureOnboardingError(uploadError, {
          profileId: profile.id,
          fileSizeBytes: optimizedFile.size,
        }, 'EditProfileModal.handleAvatarUpload.upload')
        throw uploadError
      }

      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      const previousUrl = formData.avatar_url || profile.avatar_url || null
      setFormData(prev => ({ ...prev, avatar_url: publicUrl }))
      if (previousUrl && previousUrl !== publicUrl) {
        await deleteStorageObject({ bucket: 'avatars', publicUrl: previousUrl, context: 'edit-profile:replace-avatar' })
      }
      logger.info('Avatar uploaded successfully')
    } catch (error) {
      captureOnboardingError(error, {
        profileId: profile.id,
        stage: 'avatarUploadCatch',
      }, 'EditProfileModal.handleAvatarUpload.catch')
      logger.error('Error uploading avatar:', error)
      setError('We couldn\'t upload this image. Please use PNG or JPG up to 5MB.')
    }
  }

  const handleImageClick = async () => {
    // On native platforms, use Capacitor Camera plugin (handles permissions + camera properly)
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
    // On web, fall back to standard file input
    fileInputRef.current?.click()
  }

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file || !profile) return
    await uploadAvatarFile(file)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const validationError = validateFormData(formData, role)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    const cleanedSocialLinks = cleanSocialLinks(formData.social_links)

    const trimmedContactEmail = formData.contact_email.trim()
    const normalizedContactEmail = trimmedContactEmail ? trimmedContactEmail : null

    // Create optimistic update object
    const optimisticUpdate: Record<string, unknown> = {
      full_name: formData.full_name,
      base_location: formData.base_location,
      base_city: formData.base_city || null,
      base_country_id: formData.base_country_id || null,
      avatar_url: formData.avatar_url || null,
      contact_email: normalizedContactEmail,
      contact_email_public: formData.contact_email_public,
      social_links: Object.keys(cleanedSocialLinks).length > 0 ? cleanedSocialLinks : {},
    }

    if (role === 'player') {
      optimisticUpdate.nationality = formData.nationality
      optimisticUpdate.nationality_country_id = formData.nationality_country_id
      optimisticUpdate.nationality2_country_id = formData.nationality2_country_id
      optimisticUpdate.position = formData.position || null
      optimisticUpdate.secondary_position = formData.secondary_position || null
      optimisticUpdate.gender = formData.gender || null
      optimisticUpdate.date_of_birth = formData.date_of_birth || null
      optimisticUpdate.current_club = formData.current_club || null
      optimisticUpdate.current_world_club_id = formData.current_world_club_id
      optimisticUpdate.bio = formData.bio || null
      optimisticUpdate.open_to_play = formData.open_to_play
      optimisticUpdate.open_to_opportunities = formData.open_to_opportunities
      optimisticUpdate.brand_representation = formData.brand_representation || null
    } else if (role === 'coach') {
      optimisticUpdate.nationality = formData.nationality
      optimisticUpdate.nationality_country_id = formData.nationality_country_id
      optimisticUpdate.nationality2_country_id = formData.nationality2_country_id
      optimisticUpdate.gender = formData.gender || null
      optimisticUpdate.date_of_birth = formData.date_of_birth || null
      optimisticUpdate.current_club = formData.current_club || null
      optimisticUpdate.current_world_club_id = formData.current_world_club_id
      optimisticUpdate.bio = formData.bio || null
      optimisticUpdate.open_to_coach = formData.open_to_coach
      optimisticUpdate.open_to_opportunities = formData.open_to_opportunities
      optimisticUpdate.coach_specialization = formData.coach_specialization || null
      optimisticUpdate.coach_specialization_custom = formData.coach_specialization === 'other'
        ? formData.coach_specialization_custom.trim() || null
        : null
    } else if (role === 'club') {
      optimisticUpdate.nationality = formData.nationality
      optimisticUpdate.nationality_country_id = formData.nationality_country_id
      optimisticUpdate.nationality2_country_id = null
      optimisticUpdate.year_founded = formData.year_founded ? parseInt(formData.year_founded) : null
      optimisticUpdate.website = formData.website || null
      optimisticUpdate.club_bio = formData.club_bio || null
      optimisticUpdate.club_history = formData.club_history || null

      // For claimed clubs with World directory support, use league IDs
      // The trigger will sync to world_clubs and update text fields
      if (worldClaim) {
        optimisticUpdate.mens_league_id = formData.mens_league_id
        optimisticUpdate.womens_league_id = formData.womens_league_id
        optimisticUpdate.world_region_id = countryHasRegions ? formData.world_region_id : null
        // Text fields will be set by the DB trigger, but set optimistically here
        const menLeague = worldLeagues.find(l => l.id === formData.mens_league_id)
        const womenLeague = worldLeagues.find(l => l.id === formData.womens_league_id)
        optimisticUpdate.mens_league_division = menLeague?.name || null
        optimisticUpdate.womens_league_division = womenLeague?.name || null
      } else {
        // Non-claimed clubs: use free text fields
        optimisticUpdate.womens_league_division = formData.womens_league_division || null
        optimisticUpdate.mens_league_division = formData.mens_league_division || null
      }
    }

    const previousProfile = profile
    const profileId = profile.id
    const optimisticProfile = previousProfile
      ? ({ ...previousProfile, ...optimisticUpdate } as Profile)
      : null

    if (optimisticProfile) {
      setProfile(optimisticProfile)
    }

    // Optimistically close modal so updated values are visible on dashboard right away
    onClose()
    
    const updatedFields = Object.keys(optimisticUpdate)

    try {
      logger.debug('Attempting to update profile with data:', optimisticUpdate)
      logger.debug('Profile ID:', profile.id)
      logger.debug('Role:', role)

      // Update profile in database
      const { data, error: updateError } = await supabase
        .from('profiles')
        .update(optimisticUpdate)
        .eq('id', profileId)
        .select('*')
        .single()

      logger.debug('Update response data:', data)
      logger.debug('Update error:', updateError)

      if (updateError) {
        captureOnboardingError(updateError, {
          profileId,
          updatedFields,
        }, 'EditProfileModal.handleSubmit.updateProfile')
        logger.error('Supabase update error details:', {
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
          code: updateError.code
        })
        throw updateError
      }

      if (data) {
        setProfile(data as Profile)
      }

      // Force refresh from server to pick up computed fields/triggers
      // Wrapped separately so refresh failures don't trigger a false save error
      try {
        await invalidateProfile({ userId: profileId, reason: 'profile-updated' })
      } catch {
        // Refresh failed but save succeeded — ignore silently
      }
      trackDbEvent('profile_edit', 'profile', profileId, { fields: updatedFields, role })
      clearProfileDraft(profileId, role)
    } catch (err) {
      captureOnboardingError(err, {
        profileId,
        updatedFields,
        stage: 'handleSubmitCatch',
      }, 'EditProfileModal.handleSubmit.catch')
      logger.error('Profile update error:', err)
      logger.error('Error type:', typeof err)
      logger.error('Error object:', JSON.stringify(err, null, 2))
      if (previousProfile) {
        setProfile(previousProfile)
      }
      await invalidateProfile({ userId: profileId, reason: 'profile-update-retry' })
      // Show error but don't reopen modal - user already sees their changes
      addToast('Some profile changes may not have saved. Please refresh the page.', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 id={titleId} className="text-2xl font-bold text-gray-900">
            Edit {role === 'club' ? 'Club' : role === 'coach' ? 'Coach' : 'Player'} Profile
          </h2>
          <button
            ref={closeButtonRef}
            onClick={handleDismiss}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close modal"
            title="Close"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="space-y-4">
            {/* Avatar Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {role === 'club' ? 'Club Logo' : 'Profile Picture'}
              </label>
              <div className="flex items-center gap-4">
                <div 
                  onClick={handleImageClick}
                  className="w-24 h-24 rounded-full bg-gray-100 flex items-center justify-center cursor-pointer hover:bg-gray-200 transition-colors overflow-hidden"
                >
                  {formData.avatar_url ? (
                    <StorageImage
                      src={formData.avatar_url}
                      alt="Preview"
                      className="w-full h-full object-cover"
                      containerClassName="w-full h-full"
                      fallbackClassName="w-full h-full"
                      fallback={<Upload className="w-8 h-8 text-gray-400" />}
                    />
                  ) : (
                    <Upload className="w-8 h-8 text-gray-400" />
                  )}
                </div>
                <div>
                  <button
                    type="button"
                    onClick={handleImageClick}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors text-sm font-medium"
                  >
                    {formData.avatar_url ? 'Change Image' : 'Upload Image'}
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
                aria-label="Profile picture upload"
              />
            </div>

            {/* Common Fields */}
            <Input
              label={role === 'club' ? 'Club Name' : 'Full Name'}
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
            />

            <LocationAutocomplete
              label="Base Location (City)"
              icon={<MapPin className="w-5 h-5" />}
              placeholder="Where are you currently based?"
              value={formData.base_location}
              onChange={handleLocationChange}
              onLocationSelect={handleLocationSelect}
              onLocationClear={handleLocationClear}
              isSelected={formData.location_selected}
              required
            />

            <CountrySelect
              label={role === 'club' ? 'Country' : 'Nationality'}
              value={formData.nationality_country_id}
              onChange={handleNationalityChange}
              placeholder={role === 'club' ? 'Select your club country' : 'Select your nationality'}
              required
            />

            {role !== 'club' && (
              <CountrySelect
                label="Secondary Nationality (Optional)"
                value={formData.nationality2_country_id}
                onChange={(id) => setFormData({ ...formData, nationality2_country_id: id })}
                placeholder="Select secondary nationality"
              />
            )}

            {/* ── Contact Information ── */}
            <div className="pt-3 mt-1 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Contact</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Account Email</label>
              <div className="px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700">
                {profile.email}
              </div>
              <p className="text-xs text-gray-500 mt-1">Only visible to you and used for login.</p>
            </div>

            <div>
              <Input
                label="Contact Email (for networking)"
                type="email"
                placeholder="contact@example.com"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">
                So clubs can reach you directly when they are interested. Your login email is never shown.
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-[#8026FA] focus:ring-[#8026FA]"
                checked={formData.contact_email_public}
                onChange={(e) => setFormData({ ...formData, contact_email_public: e.target.checked })}
              />
              <span>
                Share my contact email with other HOCKIA members
                <span className="block text-xs text-gray-500 mt-1">
                  Tick this so coaches and clubs can contact you after viewing your profile.
                </span>
              </span>
            </label>

            {/* Player-specific fields */}
            {role === 'player' && (
              <>
                {/* ── Hockey Details ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Hockey Details</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-position">
                    Position
                  </label>
                  <select
                    id="player-position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                    required
                    aria-label="Select position"
                  >
                    <option value="">Select position</option>
                    <option value="goalkeeper">Goalkeeper</option>
                    <option value="defender">Defender</option>
                    <option value="midfielder">Midfielder</option>
                    <option value="forward">Forward</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-secondary-position">
                    Second Position (Optional)
                  </label>
                  <select
                    id="player-secondary-position"
                    value={formData.secondary_position}
                    onChange={(e) => setFormData({ ...formData, secondary_position: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                    aria-label="Select secondary position"
                  >
                    <option value="">No secondary position</option>
                    {['goalkeeper', 'defender', 'midfielder', 'forward'].map((option) => (
                      <option key={option} value={option} disabled={option === formData.position}>
                        {option.charAt(0).toUpperCase() + option.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-gender">
                    Gender
                  </label>
                  <select
                    id="player-gender"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                    required
                    aria-label="Select gender"
                  >
                    <option value="">Select gender</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                  </select>
                </div>

                {/* ── Personal ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Personal</p>
                </div>

                <Input
                  label="Date of Birth (Optional)"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                />

                <WorldClubSearch
                  value={formData.current_club}
                  onChange={(v) => setFormData({ ...formData, current_club: v })}
                  onClubSelect={(club) => setFormData({
                    ...formData,
                    current_club: club.club_name,
                    current_world_club_id: club.id,
                  })}
                  onClubClear={() => setFormData({ ...formData, current_world_club_id: null })}
                  selectedClubId={formData.current_world_club_id}
                  label="Current Club (Optional)"
                  placeholder="e.g., Holcombe Hockey Club"
                />

                <Input
                  label="Brand Representation (Optional)"
                  type="text"
                  value={formData.brand_representation}
                  onChange={(e) => setFormData({ ...formData, brand_representation: e.target.value.slice(0, 60) })}
                  placeholder="e.g., Grays Player"
                  maxLength={60}
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-bio">
                    About Me (Optional)
                  </label>
                  <textarea
                    id="player-bio"
                    value={formData.bio || ''}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent resize-none"
                    placeholder="Share your playing background, strengths, and goals"
                    aria-label="About me"
                  />
                </div>

                {/* Availability Status */}
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-500 focus:ring-emerald-500"
                      checked={formData.open_to_play}
                      onChange={(e) => setFormData({ ...formData, open_to_play: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">Open to Play</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        Looking to join a team or club to play regular matches. A badge appears on your profile in the Community.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                      checked={formData.open_to_opportunities}
                      onChange={(e) => setFormData({ ...formData, open_to_opportunities: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">Open to Opportunities</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        Broader than playing — trials, transfers, sponsorships, or other offers related to hockey. Clubs and brands use this to filter who is actively seeking.
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {/* Coach-specific fields */}
            {role === 'coach' && (
              <>
                {/* ── Coaching Details ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Coaching Details</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Specialization
                  </label>
                  <select
                    value={formData.coach_specialization}
                    onChange={(e) => setFormData({ ...formData, coach_specialization: e.target.value as CoachSpecialization | '' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                    aria-label="Select coaching specialization"
                  >
                    <option value="">Select specialization</option>
                    {COACH_SPECIALIZATIONS.map((spec) => (
                      <option key={spec.value} value={spec.value}>{spec.label}</option>
                    ))}
                  </select>
                </div>

                {formData.coach_specialization === 'other' && (
                  <Input
                    label="Your Role Title"
                    placeholder="e.g., Team Manager, Umpire Coach"
                    value={formData.coach_specialization_custom}
                    onChange={(e) => setFormData({ ...formData, coach_specialization_custom: e.target.value })}
                  />
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="coach-gender-edit">
                    Gender
                  </label>
                  <select
                    id="coach-gender-edit"
                    value={formData.gender}
                    onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                  >
                    <option value="">Select gender</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                  </select>
                </div>

                <Input
                  label="Date of Birth (Optional)"
                  type="date"
                  value={formData.date_of_birth}
                  onChange={(e) => setFormData({ ...formData, date_of_birth: e.target.value })}
                />

                <WorldClubSearch
                  value={formData.current_club}
                  onChange={(v) => setFormData({ ...formData, current_club: v })}
                  onClubSelect={(club) => setFormData({
                    ...formData,
                    current_club: club.club_name,
                    current_world_club_id: club.id,
                  })}
                  onClubClear={() => setFormData({ ...formData, current_world_club_id: null })}
                  selectedClubId={formData.current_world_club_id}
                  label="Current Club (Optional)"
                  placeholder="e.g., Holcombe Hockey Club"
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Bio (Optional)
                  </label>
                  <textarea
                    value={formData.bio || ''}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent resize-none"
                    placeholder="Tell us about your coaching experience..."
                  />
                </div>

                {/* Availability Status */}
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-purple-500 focus:ring-purple-500"
                      checked={formData.open_to_coach}
                      onChange={(e) => setFormData({ ...formData, open_to_coach: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">Open to Coach</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        Looking for a head, assistant, or youth coaching role. A badge appears on your profile in the Community.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
                      checked={formData.open_to_opportunities}
                      onChange={(e) => setFormData({ ...formData, open_to_opportunities: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">Open to Opportunities</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        Broader than coaching — consulting, clinics, sponsorships, or other offers related to hockey. Clubs and brands use this to filter who is actively seeking.
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {/* Club-specific fields */}
            {role === 'club' && (
              <>
                {/* ── Organization ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Organization</p>
                </div>

                <Input
                  label="Year Founded (Optional)"
                  type="number"
                  value={formData.year_founded}
                  onChange={(e) => setFormData({ ...formData, year_founded: e.target.value })}
                />

                {/* League fields: Dropdowns for claimed clubs, free text otherwise */}
                {worldClaim ? (
                  <>
                    {/* Region dropdown - only show for countries with regions */}
                    {countryHasRegions && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          <MapPin className="w-4 h-4 inline mr-1" />
                          Region
                        </label>
                        <select
                          aria-label="Region"
                          value={formData.world_region_id ?? ''}
                          onChange={(e) => {
                            const regionId = e.target.value ? parseInt(e.target.value) : null
                            setFormData({
                              ...formData,
                              world_region_id: regionId,
                              mens_league_id: null,
                              womens_league_id: null,
                            })
                          }}
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                          disabled={loadingWorld}
                        >
                          <option value="">Select region...</option>
                          {worldRegions.map(region => (
                            <option key={region.id} value={region.id}>{region.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Women's League dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Trophy className="w-4 h-4 inline mr-1" />
                        Women's League
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">Main women's team. You'll be able to add more teams later.</p>
                      <select
                        aria-label="Women's League"
                        value={formData.womens_league_id ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          womens_league_id: e.target.value ? parseInt(e.target.value) : null,
                        })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                        disabled={(countryHasRegions && !formData.world_region_id) || loadingWorld}
                      >
                        <option value="">None / Not applicable</option>
                        {filteredLeagues.map(league => (
                          <option key={league.id} value={league.id}>
                            {league.name}
                            {league.tier && ` (Tier ${league.tier})`}
                          </option>
                        ))}
                      </select>
                      {countryHasRegions && !formData.world_region_id && (
                        <p className="text-xs text-gray-500 mt-1">Select a region first</p>
                      )}
                    </div>

                    {/* Men's League dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Trophy className="w-4 h-4 inline mr-1" />
                        Men's League
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">Main men's team. You'll be able to add more teams later.</p>
                      <select
                        aria-label="Men's League"
                        value={formData.mens_league_id ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          mens_league_id: e.target.value ? parseInt(e.target.value) : null,
                        })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent"
                        disabled={(countryHasRegions && !formData.world_region_id) || loadingWorld}
                      >
                        <option value="">None / Not applicable</option>
                        {filteredLeagues.map(league => (
                          <option key={league.id} value={league.id}>
                            {league.name}
                            {league.tier && ` (Tier ${league.tier})`}
                          </option>
                        ))}
                      </select>
                      {countryHasRegions && !formData.world_region_id && (
                        <p className="text-xs text-gray-500 mt-1">Select a region first</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Input
                      label="Women's League (Optional)"
                      placeholder="e.g. Serie A1"
                      value={formData.womens_league_division}
                      onChange={(e) => setFormData({ ...formData, womens_league_division: e.target.value })}
                    />

                    <Input
                      label="Men's League (Optional)"
                      placeholder="e.g. Elite Division"
                      value={formData.mens_league_division}
                      onChange={(e) => setFormData({ ...formData, mens_league_division: e.target.value })}
                    />
                  </>
                )}

                {/* ── Web & About ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Web & About</p>
                </div>

                <Input
                  label="Website (Optional)"
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="club-bio">
                    Bio
                  </label>
                  <textarea
                    id="club-bio"
                    value={formData.club_bio || ''}
                    onChange={(e) => setFormData({ ...formData, club_bio: e.target.value })}
                    rows={4}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#8026FA] focus:border-transparent resize-none"
                    placeholder="Tell us about your club..."
                    aria-label="Club bio"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="club-history">
                    Club History (Optional)
                  </label>
                  <textarea
                    id="club-history"
                    value={formData.club_history}
                    onChange={(e) => setFormData({ ...formData, club_history: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#924CEC] focus:border-transparent"
                    rows={3}
                    placeholder="Tell us about your club's history..."
                    aria-label="Club history"
                  />
                </div>
              </>
            )}

            {/* Social Media Links - Available for all roles */}
            <div className="pt-4 border-t border-gray-200">
              <SocialLinksInput
                value={formData.social_links}
                onChange={(links) => setFormData({ ...formData, social_links: links })}
              />
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors font-medium"
          >
            Cancel
          </button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-3 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
