import { cn } from '@/lib/utils'
import { OrgLogo } from '@/components/ui/OrgLogo'
import { useImageCrop } from '@/components/media/ImageCropProvider'
import { imageKindForRole, uploadIdentityImage } from '@/lib/identityImage'
import type { TablesUpdate } from '@/lib/database.types'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { X, Upload, Loader2, Trophy, MapPin } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'
import { Button, Input, CountrySelect, StorageImage, LocationAutocomplete, PlayingCategorySelector, MultiCategorySelector, DateOfBirthPicker } from '@/components'
import CountryMultiSelect from '@/components/CountryMultiSelect'
import SpecialistSkillsSelect from '@/components/SpecialistSkillsSelect'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'
import type { LocationSelection } from '@/components/LocationAutocomplete'
import { logger } from '@/lib/logger'
import { validateImage } from '@/lib/imageOptimization'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useCountries } from '@/hooks/useCountries'
import { invalidateProfile } from '@/lib/profile'
import { useToastStore } from '@/lib/toast'
import { usePendingStorageCleanup } from '@/hooks/usePendingStorageCleanup'
import { isNativePlatform, pickImageNative } from '@/lib/nativeImagePicker'
import { toSentryError } from '@/lib/sentryHelpers'
import { clearProfileDraft, loadProfileDraft, saveProfileDraft } from '@/lib/profileDrafts'
import { trackDbEvent } from '@/lib/trackDbEvent'
import SocialLinksInput from './SocialLinksInput'
import WorldClubSearch from './WorldClubSearch'
import { type SocialLinks, cleanSocialLinks, validateSocialLinks } from '@/lib/socialLinks'
import { COACH_SPECIALIZATIONS, type CoachSpecialization } from '@/lib/coachSpecializations'
import { UMPIRE_LEVEL_SUGGESTIONS } from '@/lib/umpireLevels'
import {
  type PlayingCategory,
  type CoachUmpireCategory,
  playingCategoryToLegacyGender,
  isValidPlayingCategory,
  isValidCategoryArray,
} from '@/lib/hockeyCategories'
import { FEDERATION_SUGGESTIONS } from '@/lib/umpireFederations'
import { LANGUAGE_SUGGESTIONS } from '@/lib/languages'
import { X as XIcon } from 'lucide-react'
import { tProfileEdit, useProfileEditT } from '@/i18n/ns/profileEdit'
import { useEnumsT } from '@/i18n/ns/enums'
import { intlLocale, isEnglish } from '@/i18n/format'

type UmpireSpec = 'outdoor' | 'indoor' | 'both' | ''

interface EditProfileModalProps {
  isOpen: boolean
  onClose: () => void
  role: 'player' | 'coach' | 'club' | 'umpire'
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
  // Phase 3 hockey categories. Player single-select; coach + umpire multi.
  playing_category: PlayingCategory | ''
  coaching_categories: CoachUmpireCategory[]
  umpiring_categories: CoachUmpireCategory[]
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
  avatar_full_url: string | null
  social_links: SocialLinks
  open_to_play: boolean
  open_to_coach: boolean
  open_to_opportunities: boolean
  // Matching Increment #3 — player specialist skill tags.
  specialist_skills: string[]
  // Matching Increment #2 — candidate intent ("Interested" lens). Stored
  // as '' when unset (mapped to null on save); arrays of countries.id.
  relocation_willingness: string
  relocation_countries_open: number[]
  relocation_countries_excluded: number[]
  level_target: string
  opportunity_preference: string
  available_from: string
  availability_duration: string
  brand_representation: string
  coach_specialization: CoachSpecialization | ''
  coach_specialization_custom: string
  /** D2 key fact "Current role" ("Head coach, U21 women"), max 60. */
  coach_current_role: string
  // Phase 1A.4 (v5 plan): coach dual-mode flag. Toggled here for existing
  // coaches; new coaches set it on onboarding step 3.
  coach_recruits_for_team: boolean
  // Umpire-specific (only surfaced when role='umpire')
  umpire_level: string
  federation: string
  umpire_since: string
  officiating_specialization: UmpireSpec
  languages: string[]
  // Controlled value for the language chip input — see handleSubmit flush
  // in CompleteProfile.tsx for the blur-vs-submit race this avoids.
  pending_language: string
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
// Length limits — chosen to keep hero/header layouts from breaking and
// to discourage a Bio that's so long it overwhelms profile completeness
// signals. QA found a 526-char Full Name overflowed the hero card and a
// 10,000-char Bio still counted toward profile completeness without any
// warning.
const FULL_NAME_MAX_LENGTH = 80
/** profiles_coach_current_role_length CHECK (20260928250000). */
const COACH_CURRENT_ROLE_MAX = 60
const BIO_MAX_LENGTH = 1500
// Year-founded bounds for clubs. 1850 predates organised field hockey
// clubs comfortably; the upper bound is the current year (no future
// founding dates). QA found "99999" saved + rendered as "Founded 99999".
const CLUB_YEAR_MIN = 1850

/**
 * Lenient website validator. Users routinely omit the scheme
 * ("example.com"), so we prepend https:// before parsing. `new URL`
 * alone is too permissive — "https://not-a-url" parses fine with host
 * "not-a-url" — so we additionally require a dotted hostname (a TLD).
 */
function isValidWebsite(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true // empty is allowed — the field is optional
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.hostname.includes('.') && !url.hostname.startsWith('.') && !url.hostname.endsWith('.')
  } catch {
    return false
  }
}

function validateFormData(formData: ProfileFormData, role: string): string | null {
  // Universal required field. The name input is labelled "Club Name"
  // for clubs, so the error wording follows the role.
  if (!formData.full_name.trim()) {
    return role === 'club' ? tProfileEdit('modalValidation.clubNameRequired') : tProfileEdit('modalValidation.fullNameRequired')
  }
  if (formData.full_name.length > FULL_NAME_MAX_LENGTH) {
    return role === 'club'
      ? tProfileEdit('modalValidation.clubNameTooLong', { max: FULL_NAME_MAX_LENGTH })
      : tProfileEdit('modalValidation.fullNameTooLong', { max: FULL_NAME_MAX_LENGTH })
  }
  if (formData.bio && formData.bio.length > BIO_MAX_LENGTH) {
    return tProfileEdit('modalValidation.bioTooLong', { max: BIO_MAX_LENGTH })
  }

  // Role-specific validation
  if (role === 'player' && formData.secondary_position && formData.secondary_position === formData.position) {
    return tProfileEdit('modalValidation.samePositions')
  }

  if ((role === 'player' || role === 'coach' || role === 'umpire') && !formData.base_location.trim()) {
    return tProfileEdit('modalValidation.locationRequired')
  }

  if (role === 'club' && !formData.base_location.trim()) {
    return tProfileEdit('modalValidation.clubLocationRequired')
  }

  if (role === 'club') {
    // Year founded — optional, but if present must be a plausible year.
    const yearText = formData.year_founded.trim()
    if (yearText) {
      const currentYear = new Date().getFullYear()
      const year = Number(yearText)
      if (!Number.isInteger(year) || year < CLUB_YEAR_MIN || year > currentYear) {
        return tProfileEdit('modalValidation.yearFounded', { min: CLUB_YEAR_MIN, max: currentYear })
      }
    }
    if (!isValidWebsite(formData.website)) {
      return tProfileEdit('modalValidation.website')
    }
    if (formData.club_bio && formData.club_bio.length > BIO_MAX_LENGTH) {
      return tProfileEdit('modalValidation.clubBioTooLong', { max: BIO_MAX_LENGTH })
    }
    if (formData.club_history && formData.club_history.length > BIO_MAX_LENGTH) {
      return tProfileEdit('modalValidation.clubHistoryTooLong', { max: BIO_MAX_LENGTH })
    }
  }

  if (role === 'umpire') {
    if (!formData.umpire_level.trim()) return tProfileEdit('modalValidation.umpireLevelRequired')
    if (!formData.federation.trim()) return tProfileEdit('modalValidation.federationRequired')
    if (!formData.officiating_specialization) return tProfileEdit('modalValidation.specializationRequired')
    if (!formData.languages || formData.languages.length === 0) {
      return tProfileEdit('modalValidation.languageRequired')
    }
  }

  const cleanedSocialLinks = cleanSocialLinks(formData.social_links)
  const socialLinksValidation = validateSocialLinks(cleanedSocialLinks)
  if (!socialLinksValidation.valid) {
    return socialLinksValidation.error || tProfileEdit('modalValidation.socialInvalid')
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
  playing_category: isValidPlayingCategory(profile?.playing_category) ? profile.playing_category : '',
  coaching_categories: isValidCategoryArray(profile?.coaching_categories)
    ? ((profile?.coaching_categories ?? []) as CoachUmpireCategory[])
    : [],
  umpiring_categories: isValidCategoryArray(profile?.umpiring_categories)
    ? ((profile?.umpiring_categories ?? []) as CoachUmpireCategory[])
    : [],
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
  avatar_full_url: profile?.avatar_full_url ?? null,
  social_links: (profile?.social_links as SocialLinks) || {},
  open_to_play: Boolean(profile?.open_to_play),
  open_to_coach: Boolean(profile?.open_to_coach),
  open_to_opportunities: Boolean(profile?.open_to_opportunities),
  specialist_skills: profile?.specialist_skills ?? [],
  relocation_willingness: profile?.relocation_willingness ?? '',
  relocation_countries_open: profile?.relocation_countries_open ?? [],
  relocation_countries_excluded: profile?.relocation_countries_excluded ?? [],
  level_target: profile?.level_target ?? '',
  opportunity_preference: profile?.opportunity_preference ?? '',
  available_from: profile?.available_from ?? '',
  availability_duration: profile?.availability_duration ?? '',
  brand_representation: profile?.brand_representation || '',
  coach_specialization: (profile?.coach_specialization as CoachSpecialization) || '',
  coach_specialization_custom: profile?.coach_specialization_custom || '',
  coach_current_role: profile?.coach_current_role ?? '',
  coach_recruits_for_team: Boolean(profile?.coach_recruits_for_team),
  umpire_level: profile?.umpire_level ?? '',
  federation: profile?.federation ?? '',
  umpire_since: profile?.umpire_since?.toString() ?? '',
  officiating_specialization: (profile?.officiating_specialization as UmpireSpec) ?? '',
  languages: profile?.languages ?? [],
  pending_language: '',
})

// Candidate-intent option sets (Matching Increment #2 — Interested lens).
// Labels live in the profileEdit catalog (modalIntent.*), read at render.
const RELOCATION_OPTIONS = [
  { value: 'relocate' },
  { value: 'home_only' },
  { value: 'open_to_discuss' },
] as const
const LEVEL_TARGET_OPTIONS = [
  { value: 'top' },
  { value: 'competitive' },
  { value: 'development' },
  { value: 'any' },
] as const
const OPPORTUNITY_PREF_OPTIONS = [
  { value: 'paid' },
  { value: 'development' },
  { value: 'either' },
] as const
const AVAILABILITY_DURATION_OPTIONS = [
  { value: 'full_season' },
  { value: 'half_season' },
  { value: 'short_term' },
  { value: 'flexible' },
] as const

/** Pill-button styling for the single-choice candidate-intent rows. */
/** DOB is IMMUTABLE once declared (age-gate decision, 2026-07-11): the server
 *  refuses changes ('already_set'), so once set the field renders read-only
 *  with the support path spelled out instead of a picker that silently no-ops. */
function LockedDobField({ dob }: { dob: string }) {
  const t = useProfileEditT()
  // English keeps the browser's own locale (unchanged output); other languages use the interface language.
  const dateLocale = isEnglish() ? undefined : intlLocale()
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-2">{t('modal.dobLabel')}</label>
      <p className="text-sm text-gray-900">
        {new Date(dob + 'T00:00:00').toLocaleDateString(dateLocale, { day: 'numeric', month: 'long', year: 'numeric' })}
      </p>
      <p className="mt-1 text-xs text-gray-500">
        {t('modal.dobLocked')}
      </p>
    </div>
  )
}

const segmentedClass = (active: boolean) =>
  `px-3 py-1.5 rounded-full text-sm border transition-colors ${
    active
      ? 'border-hockia-primary bg-hockia-primary/10 text-[#5b16b8] font-medium'
      : 'border-gray-300 text-gray-600 hover:border-gray-400'
  }`

/** Candidate-intent fields (Matching Increment #2) shared by player +
 *  coach saves. Empty strings map to null; country arrays pass through. */
function candidateIntentUpdate(formData: ProfileFormData): TablesUpdate<'profiles'> {
  return {
    relocation_willingness: formData.relocation_willingness || null,
    relocation_countries_open: formData.relocation_countries_open,
    relocation_countries_excluded: formData.relocation_countries_excluded,
    level_target: formData.level_target || null,
    opportunity_preference: formData.opportunity_preference || null,
    available_from: formData.available_from || null,
    availability_duration: formData.availability_duration || null,
  }
}

export default function EditProfileModal({ isOpen, onClose, role }: EditProfileModalProps) {
  const { profile, setProfile } = useAuthStore()
  const t = useProfileEditT()
  const tEnums = useEnumsT()
  // D2: the column arrives with 20260928250000; before that the field is hidden.
  const hasCoachCurrentRole = Boolean(profile && 'coach_current_role' in profile)
  const { addToast } = useToastStore()
  const { getCountryById } = useCountries()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const requestCrop = useImageCrop()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const modalOpenRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Replaced avatar objects are deleted only after the DB write lands — see
  // the hook's header for the prod incident this prevents.
  const pendingCleanup = usePendingStorageCleanup()
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
        // Check if this club is claimed in world_clubs. maybeSingle (not
        // single): a club that hasn't claimed a world club legitimately
        // returns 0 rows — .single() makes PostgREST 406 on that normal case.
        const { data: claimData } = await supabase
          .from('world_clubs')
          .select('id, province_id, country_id')
          .eq('claimed_profile_id', profile.id)
          .eq('is_claimed', true)
          .maybeSingle()

        if (claimData) {
          setWorldClaim(claimData)

          // Region availability comes straight from world_provinces — NOT the
          // leagues-gated world_countries_with_directory view. That view omits
          // countries that have regions but no seeded leagues, so a club that
          // claimed a user-created club in such a country would wrongly lose
          // its region dropdown when editing. Probing the table directly is
          // the same pattern the other World Phase 0 surfaces use.
          const { data: regions } = await supabase
            .from('world_provinces')
            .select('id, name, slug')
            .eq('country_id', claimData.country_id)
            .order('display_order')

          setCountryHasRegions((regions?.length ?? 0) > 0)
          setWorldRegions(regions || [])

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
    if (isDirty() && !window.confirm(t('modal.discardConfirm'))) {
      return
    }
    onClose()
  }, [loading, onClose, isDirty, t])

  useFocusTrap({ containerRef: dialogRef, isActive: isOpen && Boolean(profile), initialFocusRef: closeButtonRef })

  useEffect(() => {
    if (!isOpen || !profile) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (event.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
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
      // Strip empty / null draft fields before merging — older drafts may
      // contain stale or empty values (e.g. an abandoned form where the
      // user typed `base_location: 'Chatham, UK'` then left, while their
      // live profile has been updated elsewhere to a real city), and
      // spreading them blindly would clobber the live profile shown in
      // every other surface. Only restore draft values that the user
      // meaningfully filled in.
      const cleanedDraft = Object.fromEntries(
        Object.entries(draft).filter(([, value]) => {
          if (value === null || value === undefined) return false
          if (typeof value === 'string' && value.trim() === '') return false
          if (Array.isArray(value) && value.length === 0) return false
          return true
        }),
      )
      setFormData({ ...baseState, ...cleanedDraft })
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
  // A crest or logo previews as the organisation rounded square, a photo as a circle.
  const orgPreview = Boolean(formData.avatar_url) && role === 'club'

  /** Upload a File to Supabase avatars bucket and update form state. */
  const uploadAvatarFile = async (file: File) => {
    if (!profile) return

    try {
      const validation = validateImage(file, { maxFileSizeMB: 5 })
      if (!validation.valid) {
        setError(validation.error || t('modal.imageInvalid'))
        return
      }

      const kind = imageKindForRole(profile.role)
      const square = await requestCrop(file, kind)
      if (!square) return

      let urls
      try {
        urls = await uploadIdentityImage(profile.id, kind, file, square)
      } catch (uploadError) {
        captureOnboardingError(uploadError, {
          profileId: profile.id,
          fileSizeBytes: file.size,
        }, 'EditProfileModal.handleAvatarUpload.upload')
        throw uploadError
      }
      const publicUrl = urls.avatarUrl

      const previousUrl = formData.avatar_url || profile.avatar_url || null
      const previousFull = formData.avatar_full_url
      setFormData(prev => ({ ...prev, avatar_url: publicUrl, avatar_full_url: urls.avatarFullUrl }))
      if (previousFull && previousFull !== urls.avatarFullUrl) {
        pendingCleanup.queue({ bucket: 'avatars', publicUrl: previousFull, context: 'edit-profile:replace-avatar-full' })
      }
      if (urls.avatarFullUrl) pendingCleanup.unqueue(urls.avatarFullUrl)
      // Deleting the old object here would break the avatar for anyone who
      // closes this modal without saving — the profile row still points at
      // it until handleSubmit runs. Queue it; flush after the DB write.
      if (previousUrl && previousUrl !== publicUrl) {
        pendingCleanup.queue({ bucket: 'avatars', publicUrl: previousUrl, context: 'edit-profile:replace-avatar' })
      }
      pendingCleanup.unqueue(publicUrl)
      logger.info('Avatar uploaded successfully')
    } catch (error) {
      captureOnboardingError(error, {
        profileId: profile.id,
        stage: 'avatarUploadCatch',
      }, 'EditProfileModal.handleAvatarUpload.catch')
      logger.error('Error uploading avatar:', error)
      setError(t('modal.imageUploadFailed'))
    }
  }

  const handleImageClick = async () => {
    // On native platforms, use Capacitor Camera plugin (handles permissions + camera properly)
    if (isNativePlatform()) {
      try {
        const result = await pickImageNative('prompt', { crop: false })
        if (result) {
          await uploadAvatarFile(result.file)
        }
      } catch (err) {
        logger.error('Native image picker error:', err)
        setError(t('modal.cameraFailed'))
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

    // Flush any uncommitted language chip text before validating. Matches the
    // pattern in CompleteProfile.handleSubmit — avoids a race where a user
    // types "English" and clicks Save without pressing Enter first.
    let formSnapshot = formData
    if (role === 'umpire' && formData.pending_language.trim()) {
      const pending = formData.pending_language.trim()
      const nextLanguages = formData.languages.includes(pending)
        ? formData.languages
        : [...formData.languages, pending]
      formSnapshot = { ...formData, languages: nextLanguages, pending_language: '' }
      setFormData(formSnapshot)
    }

    const validationError = validateFormData(formSnapshot, role)
    if (validationError) {
      setError(validationError)
      return
    }

    setLoading(true)

    const cleanedSocialLinks = cleanSocialLinks(formData.social_links)

    const trimmedContactEmail = formData.contact_email.trim()
    const normalizedContactEmail = trimmedContactEmail ? trimmedContactEmail : null

    // Create optimistic update object
    const optimisticUpdate: TablesUpdate<'profiles'> = {
      full_name: formData.full_name,
      base_location: formData.base_location,
      base_city: formData.base_city || null,
      base_country_id: formData.base_country_id || null,
      avatar_url: formData.avatar_url || null,
      // Only when the photo changed here: never overwrite a full photo this form didn't load.
      ...((formData.avatar_url || null) !== (profile?.avatar_url ?? null) ? { avatar_full_url: formData.avatar_url ? formData.avatar_full_url : null } : {}),
      contact_email: normalizedContactEmail,
      contact_email_public: formData.contact_email_public,
      social_links: Object.keys(cleanedSocialLinks).length > 0 ? cleanedSocialLinks : {},
    }

    if (role === 'player') {
      const playingCategory = formData.playing_category || null
      optimisticUpdate.nationality = formData.nationality
      optimisticUpdate.nationality_country_id = formData.nationality_country_id
      optimisticUpdate.nationality2_country_id = formData.nationality2_country_id
      optimisticUpdate.position = formData.position || null
      optimisticUpdate.secondary_position = formData.secondary_position || null
      // Phase 3 dual-write: legacy gender follows category for adult_men/women.
      optimisticUpdate.gender = playingCategoryToLegacyGender(playingCategory)
      optimisticUpdate.playing_category = playingCategory
      optimisticUpdate.category_confirmation_needed = false
      optimisticUpdate.current_club = formData.current_club || null
      optimisticUpdate.current_world_club_id = formData.current_world_club_id
      optimisticUpdate.bio = formData.bio || null
      optimisticUpdate.open_to_play = formData.open_to_play
      optimisticUpdate.open_to_opportunities = formData.open_to_opportunities
      optimisticUpdate.brand_representation = formData.brand_representation || null
      optimisticUpdate.specialist_skills = pruneSpecialistSkillsForPosition(formData.specialist_skills, formData.position)
      Object.assign(optimisticUpdate, candidateIntentUpdate(formData))
    } else if (role === 'coach') {
      optimisticUpdate.nationality = formData.nationality
      optimisticUpdate.nationality_country_id = formData.nationality_country_id
      optimisticUpdate.nationality2_country_id = formData.nationality2_country_id
      // Phase 3: gender no longer authoritative for coaches; null breaks the
      // (previously partial) AI Discovery seeding for coach→club searches
      // until Phase 3e migrates that path to category.
      optimisticUpdate.gender = null
      optimisticUpdate.coaching_categories = formData.coaching_categories.length > 0
        ? formData.coaching_categories
        : null
      optimisticUpdate.category_confirmation_needed = false
      optimisticUpdate.current_club = formData.current_club || null
      optimisticUpdate.current_world_club_id = formData.current_world_club_id
      optimisticUpdate.bio = formData.bio || null
      optimisticUpdate.open_to_coach = formData.open_to_coach
      optimisticUpdate.open_to_opportunities = formData.open_to_opportunities
      optimisticUpdate.coach_specialization = formData.coach_specialization || null
      optimisticUpdate.coach_specialization_custom = formData.coach_specialization === 'other'
        ? formData.coach_specialization_custom.trim() || null
        : null
      optimisticUpdate.coach_recruits_for_team = formData.coach_recruits_for_team
      // Only where the column exists (profiles_self select * returns it) — an
      // environment without the D2 migration would reject the whole save.
      if (hasCoachCurrentRole) optimisticUpdate.coach_current_role = formData.coach_current_role.trim().slice(0, COACH_CURRENT_ROLE_MAX) || null
      Object.assign(optimisticUpdate, candidateIntentUpdate(formData))
    } else if (role === 'umpire') {
      const umpireSinceYear = formSnapshot.umpire_since ? parseInt(formSnapshot.umpire_since, 10) : null
      optimisticUpdate.nationality = formSnapshot.nationality
      optimisticUpdate.nationality_country_id = formSnapshot.nationality_country_id
      optimisticUpdate.nationality2_country_id = formSnapshot.nationality2_country_id
      optimisticUpdate.gender = null
      optimisticUpdate.umpiring_categories = formSnapshot.umpiring_categories.length > 0
        ? formSnapshot.umpiring_categories
        : null
      optimisticUpdate.category_confirmation_needed = false
      optimisticUpdate.bio = formSnapshot.bio || null
      optimisticUpdate.umpire_level = formSnapshot.umpire_level.trim() || null
      optimisticUpdate.federation = formSnapshot.federation.trim() || null
      optimisticUpdate.umpire_since =
        umpireSinceYear && !Number.isNaN(umpireSinceYear) ? umpireSinceYear : null
      optimisticUpdate.officiating_specialization = formSnapshot.officiating_specialization || null
      optimisticUpdate.languages = formSnapshot.languages.length > 0 ? formSnapshot.languages : null
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

      // ── Age gate: DOB changes go ONLY through declare_date_of_birth
      // (SECURITY DEFINER; direct UPDATE of the column is revoked — the
      // server owns the under-18 freeze decision). Only fires when the
      // person-role user actually changed their DOB. ──
      const isPersonRole = role === 'player' || role === 'coach' || role === 'umpire'
      const editedDob = (role === 'umpire' ? formSnapshot.date_of_birth : formData.date_of_birth) || ''
      if (isPersonRole && editedDob && editedDob !== (profile.date_of_birth ?? '')) {
        const { data: dobResult, error: dobError } = await supabase.rpc('declare_date_of_birth', { p_dob: editedDob })
        if (dobError) throw dobError
        const outcome = (dobResult as { outcome?: string } | null)?.outcome
        if (outcome === 'invalid_dob') {
          throw new Error('That date of birth doesn’t look right. Please check it.')
        }
        if (outcome === 'already_set') {
          // Unreachable through the UI (the field locks once set) — defensive.
          throw new Error('Your date of birth is locked. Contact Hockia support to change it.')
        }
        // 'frozen' needs no special handling here: the profile refresh below
        // re-reads the row and the AgeGate goodbye screen takes over.
      }

      // Update profile in database. No `.select('*')` returning: RETURNING
      // respects column SELECT grants, which exclude date_of_birth after the
      // age-gate revoke — the invalidateProfile refresh below re-reads the
      // authoritative row through the self view instead.
      const { error: updateError } = await supabase
        .from('profiles')
        .update(optimisticUpdate)
        .eq('id', profileId)

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

      // Force refresh from server to pick up computed fields/triggers
      // Wrapped separately so refresh failures don't trigger a false save error
      try {
        await invalidateProfile({ userId: profileId, reason: 'profile-updated' })
      } catch {
        // Refresh failed but save succeeded — ignore silently
      }
      trackDbEvent('profile_edit', 'profile', profileId, { fields: updatedFields, role })
      clearProfileDraft(profileId, role)
      // The row now points at the new avatar — only now is it safe to delete
      // the objects it replaced.
      await pendingCleanup.flush()
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
      addToast(t('modal.saveFailed'), 'error')
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
            {role === 'club' ? t('modal.titleClub') : role === 'coach' ? t('modal.titleCoach') : role === 'umpire' ? t('modal.titleUmpire') : t('modal.titlePlayer')}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={handleDismiss}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label={t('modal.closeLabel')}
            title={t('modal.closeTitle')}
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
                {role === 'club' ? t('modal.logoLabel') : t('modal.photoLabel')}
              </label>
              <div className="flex items-center gap-4">
                <div 
                  onClick={handleImageClick}
                  className={cn('w-24 h-24 flex items-center justify-center cursor-pointer transition-colors', orgPreview ? '' : 'rounded-full bg-gray-100 hover:bg-gray-200 overflow-hidden')}
                >
                  {orgPreview ? (
                    <OrgLogo src={formData.avatar_url} alt={t('modal.previewAlt')} role="club" imageSize="avatar-lg" eager className="h-full w-full" />
                  ) : formData.avatar_url ? (
                    <StorageImage
                      src={formData.avatar_url}
                      imageSize="avatar-lg"
                      alt={t('modal.previewAlt')}
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
                    {formData.avatar_url ? t('modal.changeImage') : t('modal.uploadImage')}
                  </button>
                  <p className="text-xs text-gray-500 mt-1">{t('modal.imageHint')}</p>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={handleAvatarUpload}
                className="hidden"
                aria-label={t('modal.uploadInputLabel')}
              />
            </div>

            {/* Common Fields */}
            <div>
              <Input
                label={role === 'club' ? t('modal.clubName') : t('modal.fullName')}
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value.slice(0, FULL_NAME_MAX_LENGTH) })}
                required
                maxLength={FULL_NAME_MAX_LENGTH}
              />
              {formData.full_name.length > FULL_NAME_MAX_LENGTH * 0.8 && (
                <p
                  className={`mt-1 text-xs text-right ${
                    formData.full_name.length >= FULL_NAME_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  {formData.full_name.length}/{FULL_NAME_MAX_LENGTH}
                </p>
              )}
            </div>

            <LocationAutocomplete
              label={t('modal.locationLabel')}
              icon={<MapPin className="w-5 h-5" />}
              placeholder={t('modal.locationPlaceholder')}
              value={formData.base_location}
              onChange={handleLocationChange}
              onLocationSelect={handleLocationSelect}
              onLocationClear={handleLocationClear}
              isSelected={formData.location_selected}
              required
            />

            <CountrySelect
              label={role === 'club' ? t('modal.countryLabel') : t('modal.nationalityLabel')}
              value={formData.nationality_country_id}
              onChange={handleNationalityChange}
              placeholder={role === 'club' ? t('modal.clubCountryPlaceholder') : t('modal.nationalityPlaceholder')}
              required
            />

            {role !== 'club' && (
              <CountrySelect
                label={t('modal.secondNationalityLabel')}
                value={formData.nationality2_country_id}
                onChange={(id) => setFormData({ ...formData, nationality2_country_id: id })}
                placeholder={t('modal.secondNationalityPlaceholder')}
              />
            )}

            {/* ── Contact Information ── */}
            <div className="pt-3 mt-1 border-t border-gray-100">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modal.contactHeading')}</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('modal.accountEmail')}</label>
              <div className="px-4 py-3 border border-gray-200 rounded-lg bg-gray-50 text-sm text-gray-700">
                {profile.email}
              </div>
              <p className="text-xs text-gray-500 mt-1">{t('modal.accountEmailHint')}</p>
            </div>

            <div>
              <Input
                label={t('modal.contactEmail')}
                type="email"
                placeholder="contact@example.com"
                value={formData.contact_email}
                onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
              />
              <p className="text-xs text-gray-500 mt-1">
                {role === 'club'
                  ? t('modal.contactHintClub')
                  : t('modal.contactHintPerson')}
              </p>
            </div>

            <label className="flex items-start gap-3 text-sm text-gray-700">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-gray-300 text-hockia-primary focus-visible:ring-hockia-primary"
                checked={formData.contact_email_public}
                onChange={(e) => setFormData({ ...formData, contact_email_public: e.target.checked })}
              />
              <span>
                {t('modal.shareContact')}
                <span className="block text-xs text-gray-500 mt-1">
                  {role === 'club'
                    ? t('modal.shareHintClub')
                    : t('modal.shareHintPerson')}
                </span>
              </span>
            </label>

            {/* Player-specific fields */}
            {role === 'player' && (
              <>
                {/* ── Hockey Details ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalPlayer.heading')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-position">
                    {t('modalPlayer.position')}
                  </label>
                  <select
                    id="player-position"
                    value={formData.position}
                    onChange={(e) => setFormData({ ...formData, position: e.target.value, specialist_skills: pruneSpecialistSkillsForPosition(formData.specialist_skills, e.target.value) })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    required
                    aria-label={t('modalPlayer.positionAria')}
                  >
                    <option value="">{t('modalPlayer.positionEmpty')}</option>
                    <option value="goalkeeper">{tEnums('position.goalkeeper')}</option>
                    <option value="defender">{tEnums('position.defender')}</option>
                    <option value="midfielder">{tEnums('position.midfielder')}</option>
                    <option value="forward">{tEnums('position.forward')}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-secondary-position">
                    {t('modalPlayer.secondPosition')}
                  </label>
                  <select
                    id="player-secondary-position"
                    value={formData.secondary_position}
                    onChange={(e) => setFormData({ ...formData, secondary_position: e.target.value })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    aria-label={t('modalPlayer.secondPositionAria')}
                  >
                    <option value="">{t('modalPlayer.secondPositionNone')}</option>
                    {(['goalkeeper', 'defender', 'midfielder', 'forward'] as const).map((option) => (
                      <option key={option} value={option} disabled={option === formData.position}>
                        {tEnums(`position.${option}`)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label id="edit-playing-category-label" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalPlayer.category')} <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">{t('modalPlayer.categoryHint')}</p>
                  <PlayingCategorySelector
                    idPrefix="edit-playing-category"
                    value={formData.playing_category || null}
                    onChange={(next) => setFormData({ ...formData, playing_category: next })}
                  />
                </div>

                {/* Specialist skills (Matching Increment #3) — what the
                    player specialises in, beyond position. Optional. */}
                <SpecialistSkillsSelect
                  label={t('modalPlayer.skills')}
                  hint={t('modalPlayer.skillsHint')}
                  value={formData.specialist_skills}
                  onChange={(next) => setFormData({ ...formData, specialist_skills: next })}
                  position={formData.position}
                />

                {/* ── Personal ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalPlayer.personalHeading')}</p>
                </div>

                {profile?.date_of_birth ? (
                  <LockedDobField dob={profile.date_of_birth} />
                ) : (
                  <DateOfBirthPicker
                    label={t('modalPlayer.dob')}
                    value={formData.date_of_birth}
                    onChange={(next) => setFormData({ ...formData, date_of_birth: next })}
                  />
                )}

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
                  label={t('modalPlayer.club')}
                  placeholder={t('modalPlayer.clubPlaceholder')}
                />

                <Input
                  label={t('modalPlayer.brand')}
                  type="text"
                  value={formData.brand_representation}
                  onChange={(e) => setFormData({ ...formData, brand_representation: e.target.value.slice(0, 60) })}
                  placeholder={t('modalPlayer.brandPlaceholder')}
                  maxLength={60}
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="player-bio">
                    {t('modalPlayer.bio')}
                  </label>
                  <textarea
                    id="player-bio"
                    value={formData.bio || ''}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                    rows={4}
                    maxLength={BIO_MAX_LENGTH}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent resize-none"
                    placeholder={t('modalPlayer.bioPlaceholder')}
                    aria-label={t('modalPlayer.bioAria')}
                  />
                  <p
                    className={`mt-1 text-xs text-right ${
                      (formData.bio?.length ?? 0) >= BIO_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {formData.bio?.length ?? 0}/{BIO_MAX_LENGTH}
                  </p>
                </div>

                {/* Availability Status */}
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-emerald-500 focus-visible:ring-emerald-500"
                      checked={formData.open_to_play}
                      onChange={(e) => setFormData({ ...formData, open_to_play: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">{t('modalPlayer.openToPlay')}</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        {t('modalPlayer.openToPlayHint')}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus-visible:ring-brand-primary"
                      checked={formData.open_to_opportunities}
                      onChange={(e) => setFormData({ ...formData, open_to_opportunities: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">{t('modalPlayer.openToOpps')}</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        {t('modalPlayer.openToOppsHint')}
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalCoach.heading')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalCoach.specialization')}
                  </label>
                  <select
                    value={formData.coach_specialization}
                    onChange={(e) => setFormData({ ...formData, coach_specialization: e.target.value as CoachSpecialization | '' })}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    aria-label={t('modalCoach.specializationAria')}
                  >
                    <option value="">{t('modalCoach.specializationEmpty')}</option>
                    {COACH_SPECIALIZATIONS.map((spec) => (
                      <option key={spec.value} value={spec.value}>{spec.label}</option>
                    ))}
                  </select>
                </div>

                {hasCoachCurrentRole && (
                  <div>
                    <Input
                      label={t('modalCoach.currentRole')}
                      placeholder={t('modalCoach.currentRolePlaceholder')}
                      maxLength={COACH_CURRENT_ROLE_MAX}
                      value={formData.coach_current_role}
                      onChange={(e) => setFormData({ ...formData, coach_current_role: e.target.value })}
                    />
                    <p className="mt-1 text-xs text-gray-500">{t('modalCoach.currentRoleHint')}</p>
                  </div>
                )}

                {formData.coach_specialization === 'other' && (
                  <Input
                    label={t('modalCoach.roleTitle')}
                    placeholder={t('modalCoach.roleTitlePlaceholder')}
                    value={formData.coach_specialization_custom}
                    onChange={(e) => setFormData({ ...formData, coach_specialization_custom: e.target.value })}
                  />
                )}

                <div>
                  <label id="edit-coaching-categories-label" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalCoach.categories')} <span className="text-red-500">*</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">{t('modalCoach.categoriesHint')}</p>
                  <MultiCategorySelector
                    idPrefix="edit-coaching-categories"
                    value={formData.coaching_categories.length > 0 ? formData.coaching_categories : null}
                    onChange={(next) => setFormData({ ...formData, coaching_categories: next })}
                  />
                </div>

                {/* Phase 1A.4 (v5 plan): coach dual-mode flag toggle.
                    Lets existing coaches opt into recruiter UX (dashboard
                    + AI Discovery example ordering). New coaches set this
                    on onboarding step 3. Editable here anytime. */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalCoach.recruits')}
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    {t('modalCoach.recruitsHint')}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, coach_recruits_for_team: true })}
                      className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        formData.coach_recruits_for_team
                          ? 'border-hockia-primary bg-purple-50 text-hockia-primary'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {t('modalCoach.recruitsYes')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, coach_recruits_for_team: false })}
                      className={`p-3 rounded-lg border-2 text-sm font-medium transition-all ${
                        !formData.coach_recruits_for_team
                          ? 'border-hockia-primary bg-purple-50 text-hockia-primary'
                          : 'border-gray-200 hover:border-gray-300 text-gray-700'
                      }`}
                    >
                      {t('modalCoach.recruitsNo')}
                    </button>
                  </div>
                </div>

                {profile?.date_of_birth ? (
                  <LockedDobField dob={profile.date_of_birth} />
                ) : (
                  <DateOfBirthPicker
                    label={t('modalCoach.dob')}
                    value={formData.date_of_birth}
                    onChange={(next) => setFormData({ ...formData, date_of_birth: next })}
                  />
                )}

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
                  label={t('modalCoach.club')}
                  placeholder={t('modalCoach.clubPlaceholder')}
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalCoach.bio')}
                  </label>
                  <textarea
                    value={formData.bio || ''}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                    rows={4}
                    maxLength={BIO_MAX_LENGTH}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent resize-none"
                    placeholder={t('modalCoach.bioPlaceholder')}
                  />
                  <p
                    className={`mt-1 text-xs text-right ${
                      (formData.bio?.length ?? 0) >= BIO_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {formData.bio?.length ?? 0}/{BIO_MAX_LENGTH}
                  </p>
                </div>

                {/* Availability Status */}
                <div className="pt-4 border-t border-gray-200 space-y-3">
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-purple-500 focus-visible:ring-purple-500"
                      checked={formData.open_to_coach}
                      onChange={(e) => setFormData({ ...formData, open_to_coach: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">{t('modalCoach.openToCoach')}</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        {t('modalCoach.openToCoachHint')}
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-3 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-gray-300 text-brand-primary focus-visible:ring-brand-primary"
                      checked={formData.open_to_opportunities}
                      onChange={(e) => setFormData({ ...formData, open_to_opportunities: e.target.checked })}
                    />
                    <span>
                      <span className="font-medium">{t('modalCoach.openToOpps')}</span>
                      <span className="block text-xs text-gray-500 mt-1">
                        {t('modalCoach.openToOppsHint')}
                      </span>
                    </span>
                  </label>
                </div>
              </>
            )}

            {/* Recruitment preferences (Matching Increment #2 — Interested
                lens). Player + coach only; all optional. */}
            {(role === 'player' || role === 'coach') && (
              <div className="pt-4 mt-1 border-t border-gray-200 space-y-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{t('modalIntent.heading')}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {t('modalIntent.intro')}
                  </p>
                </div>

                {/* Relocation willingness */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('modalIntent.relocationLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {RELOCATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, relocation_willingness: formData.relocation_willingness === opt.value ? '' : opt.value })}
                        className={segmentedClass(formData.relocation_willingness === opt.value)}
                      >
                        {t(`modalIntent.relocation.${opt.value}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Countries — collapsed by default to keep friction low */}
                <details className="rounded-lg border border-gray-200 px-3 py-2">
                  <summary className="text-sm text-gray-700 cursor-pointer select-none">{t('modalIntent.countriesToggle')}</summary>
                  <div className="mt-3 space-y-3">
                    <CountryMultiSelect
                      label={t('modalIntent.openCountries')}
                      value={formData.relocation_countries_open}
                      onChange={(ids) => setFormData({ ...formData, relocation_countries_open: ids })}
                      excludeIds={formData.relocation_countries_excluded}
                      placeholder={t('modalIntent.openCountriesPlaceholder')}
                    />
                    <CountryMultiSelect
                      label={t('modalIntent.excludedCountries')}
                      value={formData.relocation_countries_excluded}
                      onChange={(ids) => setFormData({ ...formData, relocation_countries_excluded: ids })}
                      excludeIds={formData.relocation_countries_open}
                      placeholder={t('modalIntent.excludedCountriesPlaceholder')}
                    />
                  </div>
                </details>

                {/* Availability window */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('modalIntent.availableFrom')}</label>
                    <input
                      type="date"
                      value={formData.available_from}
                      onChange={(e) => setFormData({ ...formData, available_from: e.target.value })}
                      aria-label={t('modalIntent.availableFromAria')}
                      // h-10 + bg-white: iOS renders a native date input taller
                      // than the sibling <select>; a fixed height + matching bg
                      // keeps the two columns aligned (and not grey on iOS).
                      className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm bg-white focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('modalIntent.duration')}</label>
                    <select
                      value={formData.availability_duration}
                      onChange={(e) => setFormData({ ...formData, availability_duration: e.target.value })}
                      aria-label={t('modalIntent.durationAria')}
                      className="w-full h-10 px-3 border border-gray-300 rounded-lg text-sm bg-white focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    >
                      <option value="">{t('modalIntent.durationNotSet')}</option>
                      {AVAILABILITY_DURATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{t(`modalIntent.durations.${o.value}`)}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Level target */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('modalIntent.levelLabel')}</label>
                  <div className="flex flex-wrap gap-2">
                    {LEVEL_TARGET_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, level_target: formData.level_target === opt.value ? '' : opt.value })}
                        className={segmentedClass(formData.level_target === opt.value)}
                      >
                        {t(`modalIntent.levels.${opt.value}`)}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Opportunity preference */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('modalIntent.lookingFor')}</label>
                  <div className="flex flex-wrap gap-2">
                    {OPPORTUNITY_PREF_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, opportunity_preference: formData.opportunity_preference === opt.value ? '' : opt.value })}
                        className={segmentedClass(formData.opportunity_preference === opt.value)}
                      >
                        {t(`modalIntent.preferences.${opt.value}`)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Umpire-specific fields — credentials-first layout matches the
                dashboard's hierarchy (Certification & Level is the hero). */}
            {role === 'umpire' && (
              <>
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalUmpire.heading')}</p>
                </div>

                <div>
                  <label id="edit-umpiring-categories-label" className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalUmpire.categories')} <span className="text-gray-400 font-normal">{t('modalUmpire.optional')}</span>
                  </label>
                  <p className="text-xs text-gray-500 mb-3">{t('modalUmpire.categoriesHint')}</p>
                  <MultiCategorySelector
                    idPrefix="edit-umpiring-categories"
                    value={formData.umpiring_categories.length > 0 ? formData.umpiring_categories : null}
                    onChange={(next) => setFormData({ ...formData, umpiring_categories: next })}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="edit-umpire-level">
                    {t('modalUmpire.level')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-umpire-level"
                    type="text"
                    list="edit-umpire-level-suggestions"
                    value={formData.umpire_level}
                    onChange={(e) => setFormData({ ...formData, umpire_level: e.target.value })}
                    placeholder={t('modalUmpire.levelPlaceholder')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    required
                    autoComplete="off"
                  />
                  <datalist id="edit-umpire-level-suggestions">
                    {UMPIRE_LEVEL_SUGGESTIONS.map((level) => (
                      <option key={level} value={level} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="edit-federation">
                    {t('modalUmpire.federation')} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="edit-federation"
                    type="text"
                    list="edit-federation-suggestions"
                    value={formData.federation}
                    onChange={(e) => setFormData({ ...formData, federation: e.target.value })}
                    placeholder={t('modalUmpire.federationPlaceholder')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    required
                    autoComplete="off"
                  />
                  <datalist id="edit-federation-suggestions">
                    {FEDERATION_SUGGESTIONS.map((fed) => (
                      <option key={fed} value={fed} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="edit-umpire-since">
                    {t('modalUmpire.since')}
                  </label>
                  <input
                    id="edit-umpire-since"
                    type="number"
                    inputMode="numeric"
                    min={1950}
                    max={new Date().getFullYear()}
                    value={formData.umpire_since}
                    onChange={(e) => setFormData({ ...formData, umpire_since: e.target.value })}
                    placeholder={t('modalUmpire.sincePlaceholder')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('modalUmpire.specialization')} <span className="text-red-500">*</span>
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['outdoor', 'indoor', 'both'] as const).map((value) => {
                      const labels: Record<typeof value, string> = {
                        outdoor: t('modalUmpire.specOutdoor'),
                        indoor: t('modalUmpire.specIndoor'),
                        both: t('modalUmpire.specBoth'),
                      }
                      const active = formData.officiating_specialization === value
                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() =>
                            setFormData({ ...formData, officiating_specialization: value })
                          }
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
                  <label className="block text-sm font-medium text-gray-700 mb-3" htmlFor="edit-umpire-languages">
                    {t('modalUmpire.languages')} <span className="text-red-500">*</span>
                  </label>
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
                            aria-label={t('modalUmpire.removeLanguage', { language: lang })}
                            className="text-hockia-primary hover:text-[#6B20D4]"
                          >
                            <XIcon className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input
                      id="edit-umpire-languages"
                      type="text"
                      list="edit-language-suggestions"
                      value={formData.pending_language}
                      onChange={(e) => setFormData({ ...formData, pending_language: e.target.value })}
                      placeholder={t('modalUmpire.languagesPlaceholder')}
                      className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                      autoComplete="off"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          const value = formData.pending_language.trim()
                          if (!value) return
                          setFormData({
                            ...formData,
                            languages: formData.languages.includes(value)
                              ? formData.languages
                              : [...formData.languages, value],
                            pending_language: '',
                          })
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const value = formData.pending_language.trim()
                        if (!value) return
                        setFormData({
                          ...formData,
                          languages: formData.languages.includes(value)
                            ? formData.languages
                            : [...formData.languages, value],
                          pending_language: '',
                        })
                      }}
                      disabled={!formData.pending_language.trim()}
                      className="px-4 py-3 rounded-lg bg-hockia-primary text-white text-sm font-medium hover:bg-[#6B20D4] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {t('modalUmpire.addLanguage')}
                    </button>
                  </div>
                  <datalist id="edit-language-suggestions">
                    {LANGUAGE_SUGGESTIONS.map((lang) => (
                      <option key={lang} value={lang} />
                    ))}
                  </datalist>
                  <p className="text-xs text-gray-400 mt-2">{t('modalUmpire.languagesHint')}</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="edit-umpire-bio">
                    {t('modalUmpire.bio')}
                  </label>
                  <textarea
                    id="edit-umpire-bio"
                    value={formData.bio || ''}
                    onChange={(e) => setFormData({ ...formData, bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                    rows={4}
                    maxLength={BIO_MAX_LENGTH}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent resize-none"
                    placeholder={t('modalUmpire.bioPlaceholder')}
                  />
                  <p
                    className={`mt-1 text-xs text-right ${
                      (formData.bio?.length ?? 0) >= BIO_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {formData.bio?.length ?? 0}/{BIO_MAX_LENGTH}
                  </p>
                </div>
              </>
            )}

            {/* Club-specific fields */}
            {role === 'club' && (
              <>
                {/* ── Organization ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalClub.heading')}</p>
                </div>

                <Input
                  label={t('modalClub.yearFounded')}
                  type="number"
                  min={CLUB_YEAR_MIN}
                  max={new Date().getFullYear()}
                  step={1}
                  placeholder={t('modalClub.yearFoundedPlaceholder', { year: new Date().getFullYear() - 20 })}
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
                          {t('modalClub.region')}
                        </label>
                        <select
                          aria-label={t('modalClub.regionAria')}
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
                          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                          disabled={loadingWorld}
                        >
                          <option value="">{t('modalClub.regionEmpty')}</option>
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
                        {t('modalClub.womensLeague')}
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">{t('modalClub.womensHint')}</p>
                      <select
                        aria-label={t('modalClub.womensAria')}
                        value={formData.womens_league_id ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          womens_league_id: e.target.value ? parseInt(e.target.value) : null,
                        })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                        disabled={(countryHasRegions && !formData.world_region_id) || loadingWorld}
                      >
                        <option value="">{t('modalClub.womensNone')}</option>
                        {filteredLeagues.map(league => (
                          <option key={league.id} value={league.id}>
                            {league.name}
                            {league.tier && t('modalClub.womensTier', { tier: league.tier })}
                          </option>
                        ))}
                      </select>
                      {countryHasRegions && !formData.world_region_id && (
                        <p className="text-xs text-gray-500 mt-1">{t('modalClub.womensRegionFirst')}</p>
                      )}
                    </div>

                    {/* Men's League dropdown */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        <Trophy className="w-4 h-4 inline mr-1" />
                        {t('modalClub.mensLeague')}
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">{t('modalClub.mensHint')}</p>
                      <select
                        aria-label={t('modalClub.mensAria')}
                        value={formData.mens_league_id ?? ''}
                        onChange={(e) => setFormData({
                          ...formData,
                          mens_league_id: e.target.value ? parseInt(e.target.value) : null,
                        })}
                        className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent"
                        disabled={(countryHasRegions && !formData.world_region_id) || loadingWorld}
                      >
                        <option value="">{t('modalClub.mensNone')}</option>
                        {filteredLeagues.map(league => (
                          <option key={league.id} value={league.id}>
                            {league.name}
                            {league.tier && t('modalClub.mensTier', { tier: league.tier })}
                          </option>
                        ))}
                      </select>
                      {countryHasRegions && !formData.world_region_id && (
                        <p className="text-xs text-gray-500 mt-1">{t('modalClub.mensRegionFirst')}</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Input
                      label={t('modalClub.womensLeagueOptional')}
                      placeholder={t('modalClub.womensLeaguePlaceholder')}
                      value={formData.womens_league_division}
                      onChange={(e) => setFormData({ ...formData, womens_league_division: e.target.value })}
                    />

                    <Input
                      label={t('modalClub.mensLeagueOptional')}
                      placeholder={t('modalClub.mensLeaguePlaceholder')}
                      value={formData.mens_league_division}
                      onChange={(e) => setFormData({ ...formData, mens_league_division: e.target.value })}
                    />
                  </>
                )}

                {/* ── Web & About ── */}
                <div className="pt-3 mt-1 border-t border-gray-100">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">{t('modalClub.webHeading')}</p>
                </div>

                <Input
                  label={t('modalClub.website')}
                  type="url"
                  placeholder={t('modalClub.websitePlaceholder')}
                  value={formData.website}
                  onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                />

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="club-bio">
                    {t('modalClub.bio')}
                  </label>
                  <textarea
                    id="club-bio"
                    value={formData.club_bio || ''}
                    onChange={(e) => setFormData({ ...formData, club_bio: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                    rows={4}
                    maxLength={BIO_MAX_LENGTH}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-primary focus:border-transparent resize-none"
                    placeholder={t('modalClub.bioPlaceholder')}
                    aria-label={t('modalClub.bioAria')}
                  />
                  <p
                    className={`mt-1 text-xs text-right ${
                      (formData.club_bio?.length ?? 0) >= BIO_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {formData.club_bio?.length ?? 0}/{BIO_MAX_LENGTH}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor="club-history">
                    {t('modalClub.history')}
                  </label>
                  <textarea
                    id="club-history"
                    value={formData.club_history}
                    onChange={(e) => setFormData({ ...formData, club_history: e.target.value.slice(0, BIO_MAX_LENGTH) })}
                    maxLength={BIO_MAX_LENGTH}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-hockia-secondary focus:border-transparent"
                    rows={3}
                    placeholder={t('modalClub.historyPlaceholder')}
                    aria-label={t('modalClub.historyAria')}
                  />
                  <p
                    className={`mt-1 text-xs text-right ${
                      formData.club_history.length >= BIO_MAX_LENGTH ? 'text-red-600' : 'text-gray-500'
                    }`}
                  >
                    {formData.club_history.length}/{BIO_MAX_LENGTH}
                  </p>
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
            {t('modal.cancel')}
          </button>
          <Button
            onClick={handleSubmit}
            disabled={loading}
            className="px-6 py-3 bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white rounded-lg hover:opacity-90 transition-opacity font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin inline" />
                {t('modal.saving')}
              </>
            ) : (
              t('modal.save')
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
