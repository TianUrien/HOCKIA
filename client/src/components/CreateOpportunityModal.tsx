import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { X, Plus, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, CreditCard, Trophy, Flag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { useAuthStore } from '../lib/auth'
import type { Vacancy } from '../lib/supabase'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import LocationAutocomplete from './LocationAutocomplete'
import type { LocationSelection } from './LocationAutocomplete'
import { useCountries } from '@/hooks/useCountries'
import { useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackVacancyCreate } from '@/lib/analytics'
import SpecialistSkillsSelect from '@/components/SpecialistSkillsSelect'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'
import { LEVEL_SOUGHT_OPTIONS, COMPENSATION_OPTIONS, RECRUITMENT_PROBLEM_OPTIONS, levelSoughtFromBand } from '@/lib/opportunityIntent'
import { getClubLevelBand, prefetchWorldClubLogos } from '@/hooks/useWorldClubLogo'
import { assessPostingQuality } from '@/lib/opportunityQuality'

interface CreateVacancyModalProps {
  isOpen: boolean
  onClose: () => void
  /** Fired after a successful save. `status` is the resolved status of
   *  the saved opportunity ('draft' | 'open') so the caller can sync
   *  its list filter — without it a just-published opportunity is
   *  hidden behind a stale 'draft' filter. */
  onSuccess: (status?: 'draft' | 'open') => void
  editingVacancy?: Vacancy | null
  /** Initial opportunity_type when creating a new opportunity. Lets
   *  the coach dashboard launch the modal pre-set to 'coach' so users
   *  don't land on a "Player Position" form. Ignored when editing. */
  initialOpportunityType?: 'player' | 'coach'
}

// Field limits — also enforced as `maxLength` on the inputs so the
// counter and the hard cap never disagree.
const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

const BENEFIT_OPTIONS = [
  { id: 'housing', label: 'Housing', icon: Home },
  { id: 'car', label: 'Car', icon: Car },
  { id: 'visa', label: 'Visa', icon: GlobeIcon },
  { id: 'flights', label: 'Flights', icon: Plane },
  { id: 'meals', label: 'Meals', icon: Utensils },
  { id: 'job', label: 'Job', icon: Briefcase },
  { id: 'insurance', label: 'Insurance', icon: Shield },
  { id: 'education', label: 'Education', icon: GraduationCap },
  { id: 'bonuses', label: 'Bonuses', icon: CreditCard },
  { id: 'equipment', label: 'Equipment', icon: Trophy },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildInitialFormData = (vacancy?: Vacancy | null, initialOpportunityType?: 'player' | 'coach'): Record<string, any> => ({
  opportunity_type: vacancy?.opportunity_type || initialOpportunityType || 'player',
  title: vacancy?.title || '',
  position: vacancy?.position || undefined,
  gender: vacancy?.gender || undefined,
  description: vacancy?.description || '',
  location_city: vacancy?.location_city || '',
  location_country: vacancy?.location_country || '',
  start_date: vacancy?.start_date || null,
  duration_text: vacancy?.duration_text || '',
  requirements: vacancy?.requirements || [],
  // Matching Increment #3 — specialist skills this opportunity seeks.
  specialist_skills_wanted: vacancy?.specialist_skills_wanted || [],
  // Matching Increment #4 — recruiter intent (level / compensation / problem).
  level_sought: vacancy?.level_sought || '',
  compensation: vacancy?.compensation || '',
  recruitment_problem: vacancy?.recruitment_problem || '',
  benefits: vacancy?.benefits || [],
  custom_benefits: vacancy?.custom_benefits || [],
  priority: vacancy?.priority || 'medium',
  status: vacancy?.status || 'draft',
  application_deadline: vacancy?.application_deadline || null,
  contact_email: vacancy?.contact_email || '',
  contact_phone: vacancy?.contact_phone || '',
  organization_name: vacancy?.organization_name || '',
  eu_passport_required: (vacancy as Record<string, unknown>)?.eu_passport_required === true,
  // Phase 3c — per-criterion MUST-HAVE hardness. Seeded off the editing row
  // so an edit round-trips its toggles (and drafts restore them, since the
  // whole formData is serialized). Default false → "nice to have" = today's
  // soft behavior, matching the migration's DEFAULT FALSE.
  position_required: (vacancy as Record<string, unknown>)?.position_required === true,
  level_required: (vacancy as Record<string, unknown>)?.level_required === true,
  compensation_required: (vacancy as Record<string, unknown>)?.compensation_required === true,
  location_required: (vacancy as Record<string, unknown>)?.location_required === true,
  availability_required: (vacancy as Record<string, unknown>)?.availability_required === true,
  specialists_required: (vacancy as Record<string, unknown>)?.specialists_required === true,
})

const getVacancyDraftKey = (profileId: string) => `vacancyDraft:new:${profileId}`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpportunityFormData = Record<string, any>

type VacancyDraftStorage = {
  formData: OpportunityFormData
  newRequirement: string
  newCustomBenefit: string
}

// Phase 3c — a must-have validation error ("pick a level before marking it
// must-have") is keyed by the *_required flag. This maps each underlying
// criterion field to its flag's error key so that filling the field clears
// the paired error (position/location are always-required, so they have no
// separate must-have error and aren't listed here).
const MUST_HAVE_ERROR_BY_FIELD: Record<string, string> = {
  level_sought: 'level_required',
  compensation: 'compensation_required',
  start_date: 'availability_required',
  specialist_skills_wanted: 'specialists_required',
}
const MUST_HAVE_ERROR_KEYS = Object.values(MUST_HAVE_ERROR_BY_FIELD)

/**
 * Phase 3c — per-criterion MUST-HAVE / NICE-TO-HAVE toggle. A compact,
 * accessible switch that sits beside an opportunity criterion. "Must have"
 * (on) persists the criterion's `*_required` flag, which the recruiter
 * verdict turns into a hard "Out of scope" cap on an explicit mismatch
 * (Phase 3b); "Nice to have" (off, the default) keeps today's soft
 * weighting. Proper `role="switch"` + `aria-checked` (the existing
 * EU-passport toggle is a plain <button> missing both — deliberately NOT
 * copied here) and a ≥44pt touch target (Apple HIG).
 */
function MustNiceToggle({
  checked,
  onChange,
  criterionLabel,
  error,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Lower-case noun used in the screen-reader label, e.g. "position". */
  criterionLabel: string
  error?: string
}) {
  const errorId = useId()
  return (
    <div className="mt-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked ? 'true' : 'false'}
        aria-label={`Mark ${criterionLabel} as a must-have`}
        aria-describedby={error ? errorId : undefined}
        onClick={() => onChange(!checked)}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1.5 text-xs font-medium transition-colors ${
          checked ? 'text-emerald-700' : 'text-gray-500'
        }`}
      >
        <span
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
            checked ? 'bg-emerald-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </span>
        <span>{checked ? 'Must have' : 'Nice to have'}</span>
      </button>
      {error && (
        <p id={errorId} className="mt-0.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}

export default function CreateVacancyModal({ isOpen, onClose, onSuccess, editingVacancy, initialOpportunityType }: CreateVacancyModalProps) {
  const { user, profile } = useAuthStore()
  const [isLoading, setIsLoading] = useState(false)
  // Tracks whether the user has changed anything this session, so closing
  // the modal can warn before discarding unsaved work.
  const [isDirty, setIsDirty] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  /** Inline submit-error banner. The toast container lives in the
   *  top-right corner of the viewport, which scrolls out of view once
   *  the modal content is scrolled. The inline banner anchors the
   *  error to where the user is actually looking. */
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { addToast } = useToastStore()

  const [formData, setFormData] = useState<OpportunityFormData>(buildInitialFormData(editingVacancy, initialOpportunityType))

  // Live posting-strength assessment (Market Phase 3) — recomputes as the
  // club fills the form; nudge only, never blocks publishing.
  const postingQuality = useMemo(() => assessPostingQuality({
    compensation: formData.compensation,
    benefits: formData.benefits,
    custom_benefits: formData.custom_benefits,
    description: formData.description,
    start_date: formData.start_date,
    level_sought: formData.level_sought,
    application_deadline: formData.application_deadline,
    club_has_logo: Boolean(profile?.avatar_url),
  }), [formData, profile?.avatar_url])
  const { getCountryById } = useCountries()

  // Location autocomplete state
  const [locationText, setLocationText] = useState(() => {
    const city = editingVacancy?.location_city || ''
    const country = editingVacancy?.location_country || ''
    return city && country ? `${city}, ${country}` : city || ''
  })
  const [locationSelected, setLocationSelected] = useState(() => !!(editingVacancy?.location_city && editingVacancy?.location_country))

  const [newRequirement, setNewRequirement] = useState('')
  const [newCustomBenefit, setNewCustomBenefit] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  /** Ref to the modal's scrollable content area. Used to scroll the
   *  inline submit-error banner into view when a save fails — without
   *  this, errors land at the top of the modal while the user is
   *  still scrolled near the Submit button at the bottom. */
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const opportunityTypeRef = useRef<HTMLSelectElement | null>(null)
  const titleId = useId()
  const subtitleId = useId()
  const opportunityTypeFieldId = useId()
  const priorityFieldId = useId()
  const opportunityTitleFieldId = useId()
  const descriptionFieldId = useId()

  const startDateFieldId = useId()
  const durationFieldId = useId()
  const applicationDeadlineFieldId = useId()
  const contactEmailFieldId = useId()
  const contactPhoneFieldId = useId()
  const newRequirementFieldId = useId()
  const newCustomBenefitFieldId = useId()
  const organizationNameFieldId = useId()
  const vacancyDraftSaveTimeoutRef = useRef<number | null>(null)
  const vacancyDraftRestoringRef = useRef(false)

  const clearVacancyDraft = useCallback(() => {
    if (typeof window === 'undefined' || !user) return
    const draftKey = getVacancyDraftKey(user.id)
    window.localStorage.removeItem(draftKey)
  }, [user])

  // Actually dismiss the modal. On a fresh create, clear the autosaved
  // draft so it doesn't resurrect on the next open.
  const performClose = useCallback(() => {
    if (!editingVacancy) {
      clearVacancyDraft()
    }
    onClose()
  }, [clearVacancyDraft, editingVacancy, onClose])

  const handleClose = useCallback(() => {
    if (isLoading) {
      return
    }
    // Unsaved work — confirm before discarding, via the in-app dialog
    // (not the off-brand native window.confirm).
    if (isDirty) {
      setShowDiscardConfirm(true)
      return
    }
    performClose()
  }, [isLoading, isDirty, performClose])

  // Hand focus to the discard-confirm dialog while it's open.
  useFocusTrap({ containerRef: dialogRef, isActive: isOpen && !showDiscardConfirm, initialFocusRef: opportunityTypeRef })

  // Increment #4 — pre-fill level_sought from the creating club's league
  // band for a NEW opportunity (recruiter can override). Best-effort: warm
  // the band cache then read it; leaves the field blank if unseeded.
  useEffect(() => {
    if (!isOpen || editingVacancy) return
    const clubId = profile?.current_world_club_id
    if (!clubId) return
    let cancelled = false
    void (async () => {
      await prefetchWorldClubLogos([clubId])
      if (cancelled) return
      const tier = levelSoughtFromBand(getClubLevelBand(clubId, null))
      if (tier) setFormData((prev) => (prev.level_sought ? prev : { ...prev, level_sought: tier }))
    })()
    return () => { cancelled = true }
  }, [isOpen, editingVacancy, profile?.current_world_club_id])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    setErrors({})
    setSubmitError(null)
    setNewRequirement('')
    setNewCustomBenefit('')

    if (!editingVacancy && user && typeof window !== 'undefined') {
      const draftKey = getVacancyDraftKey(user.id)
      const rawDraft = window.localStorage.getItem(draftKey)
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as VacancyDraftStorage
          const base = buildInitialFormData(null, initialOpportunityType)
          const restored = { ...base, ...(parsed.formData || {}) }
          setFormData(restored)
          setNewRequirement(parsed.newRequirement ?? '')
          setNewCustomBenefit(parsed.newCustomBenefit ?? '')
          // Restore location autocomplete state from draft
          if (restored.location_city && restored.location_country) {
            setLocationText(`${restored.location_city}, ${restored.location_country}`)
            setLocationSelected(true)
          }
          vacancyDraftRestoringRef.current = true
          addToast('Opportunity draft restored.', 'info')
          return
        } catch (error) {
          logger.error('Failed to restore vacancy draft', error)
          window.localStorage.removeItem(draftKey)
        }
      }
    }

    const initial = buildInitialFormData(editingVacancy, initialOpportunityType)
    // Pre-fill organization name from coach's current club for new opportunities
    if (!editingVacancy && profile?.role === 'coach' && profile.current_club && !initial.organization_name) {
      initial.organization_name = profile.current_club
    }
    setFormData(initial)
  }, [addToast, editingVacancy, initialOpportunityType, isOpen, profile, user])

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      // While the discard-confirm dialog is open, it owns Escape.
      if (event.key === 'Escape' && !showDiscardConfirm) {
        event.preventDefault()
        handleClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleClose, isOpen, showDiscardConfirm])

  useEffect(() => {
    if (!isOpen || editingVacancy || !user) {
      if (vacancyDraftSaveTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
        vacancyDraftSaveTimeoutRef.current = null
      }
      return
    }

    if (typeof window === 'undefined') {
      return
    }

    if (vacancyDraftRestoringRef.current) {
      vacancyDraftRestoringRef.current = false
      return
    }

    if (vacancyDraftSaveTimeoutRef.current) {
      window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
      vacancyDraftSaveTimeoutRef.current = null
    }

    vacancyDraftSaveTimeoutRef.current = window.setTimeout(() => {
      try {
        const payload: VacancyDraftStorage = {
          formData,
          newRequirement,
          newCustomBenefit,
        }
        window.localStorage.setItem(getVacancyDraftKey(user.id), JSON.stringify(payload))
      } catch (error) {
        logger.error('Failed to persist vacancy draft', error)
      } finally {
        vacancyDraftSaveTimeoutRef.current = null
      }
    }, 600)
  }, [editingVacancy, formData, isOpen, newCustomBenefit, newRequirement, user])

  useEffect(() => {
    return () => {
      if (vacancyDraftSaveTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(vacancyDraftSaveTimeoutRef.current)
        vacancyDraftSaveTimeoutRef.current = null
      }
    }
  }, [])

  // When a submit error appears, scroll the modal back to the top so
  // the inline banner is visible. Without this, the banner renders at
  // the top of a long form while the user is still focused on the
  // Submit button at the bottom — they'd only see the toast.
  useEffect(() => {
    if (submitError && scrollContentRef.current) {
      scrollContentRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [submitError])

  if (!isOpen) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleInputChange = (field: string, value: any) => {
    setIsDirty(true)
    setFormData(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'opportunity_type' && value === 'coach') {
        next.position = undefined  // reset — coach has different position options
        next.gender = undefined
        next.specialist_skills_wanted = []  // coach opps have no specialist tags
        // Phase 3c — the must-have toggles are a player-opportunity feature;
        // clear every hardness flag so a stale must-have can't persist on a
        // criterion that no longer renders (the payload also zeroes these).
        next.position_required = false
        next.level_required = false
        next.compensation_required = false
        next.location_required = false
        next.availability_required = false
        next.specialists_required = false
      }
      // Increment #3 — drop GK-only tags (Sweeper Keeper) when the position
      // moves away from goalkeeper, so a gated tag can't leak via stale state.
      if (field === 'position') {
        next.specialist_skills_wanted = pruneSpecialistSkillsForPosition(prev.specialist_skills_wanted, value)
      }
      return next
    })

    setErrors(prevErrors => {
      if (field === 'opportunity_type' && value === 'coach') {
        const updated = { ...prevErrors }
        delete updated.position
        delete updated.gender
        delete updated[field]
        // Clear any must-have validation errors — the toggles are hidden for
        // coach opps (Phase 3c).
        for (const k of MUST_HAVE_ERROR_KEYS) delete updated[k]
        return updated
      }

      // A must-have validation error is keyed by the *_required flag; clear
      // it when EITHER the flag toggles (field === the flag) or its
      // underlying field is filled in (field === the paired criterion).
      const pairedError = MUST_HAVE_ERROR_BY_FIELD[field]
      if (prevErrors[field] || (pairedError && prevErrors[pairedError])) {
        const updated = { ...prevErrors }
        delete updated[field]
        if (pairedError) delete updated[pairedError]
        return updated
      }

      return prevErrors
    })
  }

  const toggleBenefit = (benefitId: string) => {
    const currentBenefits = formData.benefits || []
    const newBenefits = currentBenefits.includes(benefitId)
      ? currentBenefits.filter((b: string) => b !== benefitId)
      : [...currentBenefits, benefitId]
    handleInputChange('benefits', newBenefits)
  }

  const addRequirement = () => {
    if (newRequirement.trim()) {
      handleInputChange('requirements', [...(formData.requirements || []), newRequirement.trim()])
      setNewRequirement('')
    }
  }

  const removeRequirement = (index: number) => {
    handleInputChange('requirements', (formData.requirements || []).filter((_: string, i: number) => i !== index))
  }

  const addCustomBenefit = () => {
    if (newCustomBenefit.trim()) {
      handleInputChange('custom_benefits', [...(formData.custom_benefits || []), newCustomBenefit.trim()])
      setNewCustomBenefit('')
    }
  }

  const removeCustomBenefit = (index: number) => {
    handleInputChange('custom_benefits', (formData.custom_benefits || []).filter((_: string, i: number) => i !== index))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formData.title?.trim()) newErrors.title = 'Title is required'
    // Only validate position and category for player opportunities
    if (formData.opportunity_type === 'player') {
      if (!formData.position) newErrors.position = 'Position is required'
      if (!formData.gender) newErrors.gender = 'Category is required'
    }
    if (!formData.location_city?.trim()) newErrors.location_city = 'City is required'
    if (!formData.location_country?.trim()) newErrors.location_country = 'Country is required'

    // Phase 3c — a MUST-HAVE on an unset OPTIONAL criterion is unsatisfiable
    // (it would silently zero the candidate pool). Position + location are
    // already required above, so only the optional criteria need this guard.
    // Player opps only (the toggles don't render for coach opps).
    if (formData.opportunity_type === 'player') {
      if (formData.level_required && !formData.level_sought)
        newErrors.level_required = 'Pick a level before marking it must-have.'
      if (formData.compensation_required && !formData.compensation)
        newErrors.compensation_required = 'Pick a compensation before marking it must-have.'
      if (formData.availability_required && !formData.start_date)
        newErrors.availability_required = 'Set a start date before marking it must-have.'
      if (formData.specialists_required && !(formData.specialist_skills_wanted?.length))
        newErrors.specialists_required = 'Add a specialist skill before marking it must-have.'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  // QA-flagged: a single "Create Opportunity" button silently saved as
  // a draft, so users who expected to publish hit a confusing dead-end.
  // Split into two CTAs — "Save as draft" and "Publish now" — and let
  // each one set the intended status explicitly. `targetStatus` is
  // optional to preserve the editing-existing-row path (which keeps
  // whatever status was set inside the form, e.g. via the status
  // select inside the modal).
  const handleSave = async (targetStatus?: 'draft' | 'open') => {
    // Errors surface via the inline submitError banner only — it's
    // anchored to where the user is in the modal. A parallel error toast
    // would just repeat the same message at the top of the viewport.
    setSubmitError(null)
    if (!user) {
      setSubmitError('You need to be signed in to manage opportunities.')
      return
    }

    if (!validate()) {
      setSubmitError('Please fix the highlighted fields before saving.')
      return
    }

    setIsLoading(true)
    try {
      // For new opportunities the caller picks the target status via
      // which button they pressed; for edits we keep the form's own
      // status field intact so toggling fields in an edit doesn't
      // accidentally re-publish.
      const resolvedStatus = targetStatus ?? formData.status ?? 'draft'
      const isPlayerOpp = formData.opportunity_type === 'player'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vacancyData: Record<string, any> = {
        club_id: user.id,
        opportunity_type: formData.opportunity_type || 'player',
        title: formData.title!,
        position: formData.position || null,
        gender: formData.opportunity_type === 'player' ? formData.gender! : null,
        description: formData.description || null,
        location_city: formData.location_city!,
        location_country: formData.location_country!,
        start_date: formData.start_date || null,
        duration_text: formData.duration_text || null,
        requirements: formData.requirements || [],
        // Increment #3 — player opps only; cleared for coach opps.
        specialist_skills_wanted: formData.opportunity_type === 'player'
          ? pruneSpecialistSkillsForPosition(formData.specialist_skills_wanted, formData.position)
          : [],
        // Increment #4 — recruiter intent (empty string → null).
        level_sought: formData.level_sought || null,
        compensation: formData.compensation || null,
        recruitment_problem: formData.recruitment_problem || null,
        benefits: formData.benefits || [],
        custom_benefits: formData.custom_benefits || [],
        priority: formData.priority || 'medium',
        status: resolvedStatus,
        application_deadline: formData.application_deadline || null,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        organization_name: formData.organization_name?.trim() || null,
        world_club_id: profile?.role === 'coach' ? profile.current_world_club_id ?? null : null,
        eu_passport_required: formData.eu_passport_required || false,
        // Phase 3c — per-criterion MUST-HAVE hardness. Player opps only; a
        // coach opp sends every flag false (the toggles never render there),
        // so a hardness flag can't persist on a criterion that isn't shown.
        position_required: isPlayerOpp && (formData.position_required || false),
        level_required: isPlayerOpp && (formData.level_required || false),
        compensation_required: isPlayerOpp && (formData.compensation_required || false),
        location_required: isPlayerOpp && (formData.location_required || false),
        availability_required: isPlayerOpp && (formData.availability_required || false),
        specialists_required: isPlayerOpp && (formData.specialists_required || false),
      }
      // published_at is set on the row when the opportunity first goes
      // open — preserves the existing publish-from-draft analytics
      // signal.
      if (resolvedStatus === 'open' && !editingVacancy?.published_at) {
        vacancyData.published_at = new Date().toISOString()
      }

      if (editingVacancy) {
        // Update existing opportunity
        const { error } = await supabase
          .from('opportunities')
          .update(vacancyData as never)
          .eq('id', editingVacancy.id)

        if (error) throw error
        const isStillDraft = resolvedStatus === 'draft'
        if (isStillDraft) {
          addToast('Draft updated — publish when you\'re ready to go live.', 'info')
        } else {
          addToast('Opportunity updated successfully.', 'success')
        }
      } else {
        // Create new opportunity
        const { error } = await supabase
          .from('opportunities')
          .insert(vacancyData as never)

        if (error) throw error
        trackDbEvent('opportunity_create', 'vacancy', undefined, { type: vacancyData.opportunity_type })
        trackVacancyCreate(vacancyData.position || vacancyData.opportunity_type || 'unknown')
        if (resolvedStatus === 'open') {
          addToast('Opportunity published — candidates can apply now.', 'success')
        } else {
          addToast('Draft saved — publish when you\'re ready to go live.', 'info')
        }
        clearVacancyDraft()
      }

      onSuccess(resolvedStatus === 'open' ? 'open' : 'draft')
      onClose()
    } catch (error) {
      logger.error('Error saving vacancy:', error)
      const message = error instanceof Error && error.message
        ? `Failed to save opportunity: ${error.message}`
        : 'Failed to save opportunity. Please try again.'
      setSubmitError(message)
    } finally {
      setIsLoading(false)
    }
  }

  const benefitsCount = (formData.benefits || []).length
  const titleErrorId = errors.title ? `${opportunityTitleFieldId}-error` : undefined
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4" role="presentation">
      <div
        ref={dialogRef}
        className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col focus:outline-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-gray-700" />
            </div>
            <div>
              <h2 id={titleId} className="text-xl font-bold text-gray-900">
                {editingVacancy ? 'Edit Opportunity' : 'Create New Opportunity'}
              </h2>
              <p id={subtitleId} className="text-sm text-gray-600">
                {editingVacancy 
                  ? 'Update your opportunity details' 
                  : formData.opportunity_type === 'player'
                    ? 'Create a new player position opportunity'
                    : 'Create a new coaching position opportunity'
                }
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div ref={scrollContentRef} className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6">
          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}
          {/* Basic Information */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5 text-gray-700" />
              <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Opportunity Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={opportunityTypeFieldId}>
                    Opportunity Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    id={opportunityTypeFieldId}
                    ref={opportunityTypeRef}
                    value={formData.opportunity_type}
                    onChange={(e) => handleInputChange('opportunity_type', e.target.value as 'player' | 'coach')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                    title="Opportunity type"
                  >
                    <option value="player">Player Position</option>
                    <option value="coach">Coach Position</option>
                  </select>
                </div>

                {/* Priority Level */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={priorityFieldId}>
                    Priority Level
                  </label>
                  <select
                    id={priorityFieldId}
                    value={formData.priority || ''}
                    onChange={(e) => handleInputChange('priority', e.target.value as 'low' | 'medium' | 'high')}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                    title="Priority level"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              {/* Opportunity Title */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={opportunityTitleFieldId}>
                  Opportunity Title <span className="text-red-500">*</span>
                </label>
                <input
                  id={opportunityTitleFieldId}
                  type="text"
                  required
                  aria-required="true"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  maxLength={TITLE_MAX}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent ${
                    errors.title ? 'border-red-500' : 'border-gray-300'
                  }`}
                  placeholder={
                    formData.opportunity_type === 'player'
                      ? "e.g., Senior Women's First XI Opportunity"
                      : "e.g., Head Coach - Youth Development"
                  }
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={titleErrorId}
                  autoCapitalize="words"
                  inputMode="text"
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                  {errors.title
                    ? <p id={titleErrorId} className="text-sm text-red-600">{errors.title}</p>
                    : <span />}
                  <span className="flex-shrink-0 text-xs text-gray-400">
                    {(formData.title || '').length}/{TITLE_MAX}
                  </span>
                </div>
              </div>

              {/* Organization Name - shown for coaches, optional for clubs */}
              {profile?.role === 'coach' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={organizationNameFieldId}>
                  Organization / On behalf of
                </label>
                <input
                  id={organizationNameFieldId}
                  type="text"
                  value={formData.organization_name ?? ''}
                  onChange={(e) => handleInputChange('organization_name', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="e.g., Melbourne Hockey Club, Youth Academy"
                  autoCapitalize="words"
                  inputMode="text"
                />
                <p className="mt-1 text-xs text-gray-500">
                  The club, academy, or organization this opportunity is for. Shown on the card so applicants know who is hiring.
                </p>
              </div>
              )}

              {/* Position and Gender */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
                {/* Position */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Position {formData.opportunity_type === 'player' && <span className="text-red-500">*</span>}
                  </label>
                  <select
                    value={formData.position || ''}
                    onChange={(e) => handleInputChange('position', e.target.value || undefined)}
                    aria-required={formData.opportunity_type === 'player' ? 'true' : undefined}
                    aria-invalid={errors.position ? true : undefined}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white ${
                      errors.position ? 'border-red-500' : 'border-gray-300'
                    }`}
                    title="Position"
                  >
                    <option value="">Select position</option>
                    {formData.opportunity_type === 'player' ? (
                      <>
                        <option value="goalkeeper">Goalkeeper</option>
                        <option value="defender">Defender</option>
                        <option value="midfielder">Midfielder</option>
                        <option value="forward">Forward</option>
                      </>
                    ) : (
                      <>
                        <option value="head_coach">Head Coach</option>
                        <option value="assistant_coach">Assistant Coach</option>
                        <option value="youth_coach">Youth Coach</option>
                      </>
                    )}
                  </select>
                  {errors.position && <p className="mt-1 text-sm text-red-600">{errors.position}</p>}
                  {formData.opportunity_type === 'player' && (
                    <MustNiceToggle
                      criterionLabel="position"
                      checked={!!formData.position_required}
                      onChange={(v) => handleInputChange('position_required', v)}
                    />
                  )}
                </div>

                {/* Gender - Only for player opportunities */}
                {formData.opportunity_type === 'player' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.gender || ''}
                    onChange={(e) =>
                      handleInputChange('gender', e.target.value as 'Men' | 'Women' | 'Girls' | 'Boys' | 'Mixed')
                    }
                    aria-required="true"
                    aria-invalid={errors.gender ? true : undefined}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white ${
                      errors.gender ? 'border-red-500' : 'border-gray-300'
                    }`}
                    title="Category"
                  >
                    <option value="">Select category</option>
                    {/* Display labels are the new Phase 3 vocabulary; stored
                        values stay as the legacy enum for back-compat. New
                        Girls / Boys / Mixed values were added in 3d. */}
                    <option value="Men">Adult Men</option>
                    <option value="Women">Adult Women</option>
                    <option value="Girls">Girls</option>
                    <option value="Boys">Boys</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                  {errors.gender && <p className="mt-1 text-sm text-red-600">{errors.gender}</p>}
                </div>
                )}
              </div>

              {/* Specialist skills wanted (Matching Increment #3) — player
                  opportunities only; optional. */}
              {formData.opportunity_type === 'player' && (
                <div>
                  <SpecialistSkillsSelect
                    label="Specialist skills wanted"
                    hint="Optional — the specialism you most need. We'll surface players who match."
                    value={formData.specialist_skills_wanted || []}
                    onChange={(next) => handleInputChange('specialist_skills_wanted', next)}
                    position={formData.position}
                  />
                  <MustNiceToggle
                    criterionLabel="specialist skills"
                    checked={!!formData.specialists_required}
                    onChange={(v) => handleInputChange('specialists_required', v)}
                    error={errors.specialists_required}
                  />
                </div>
              )}

              {/* Recruiter intent (Matching Increment #4) — player opps only.
                  Kept simple: clarify intent, not fill an HR form. */}
              {formData.opportunity_type === 'player' && (
                <div className="space-y-4 rounded-lg border border-gray-200 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">What you're looking for</p>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">What are you solving this season?</label>
                    <select
                      value={formData.recruitment_problem || ''}
                      onChange={(e) => handleInputChange('recruitment_problem', e.target.value || undefined)}
                      aria-label="Recruitment problem"
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                    >
                      <option value="">Optional</option>
                      {RECRUITMENT_PROBLEM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Level sought</label>
                      <select
                        value={formData.level_sought || ''}
                        onChange={(e) => handleInputChange('level_sought', e.target.value || undefined)}
                        aria-label="Level sought"
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                      >
                        <option value="">Select</option>
                        {LEVEL_SOUGHT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <MustNiceToggle
                        criterionLabel="level"
                        checked={!!formData.level_required}
                        onChange={(v) => handleInputChange('level_required', v)}
                        error={errors.level_required}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Compensation</label>
                      <select
                        value={formData.compensation || ''}
                        onChange={(e) => handleInputChange('compensation', e.target.value || undefined)}
                        aria-label="Compensation"
                        className="w-full px-3 py-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#10b981] focus:border-transparent bg-white"
                      >
                        <option value="">Select</option>
                        {COMPENSATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <MustNiceToggle
                        criterionLabel="compensation"
                        checked={!!formData.compensation_required}
                        onChange={(v) => handleInputChange('compensation_required', v)}
                        error={errors.compensation_required}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400">Level pre-fills from your club's level — change it if you're recruiting above or below. Mark any criterion "Must have" to require it — players who miss it read as "Out of scope".</p>
                </div>
              )}

              {/* Description */}
              <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={descriptionFieldId}>
                  Description
                </label>
                <textarea
                  id={descriptionFieldId}
                  value={formData.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent resize-none"
                  placeholder={
                    formData.opportunity_type === 'player'
                      ? "Describe the player opportunity, training environment, and development pathway..."
                      : "Describe the coaching role, responsibilities, and team environment..."
                  }
                />
                <div className="mt-1 text-right text-xs text-gray-400">
                  {(formData.description || '').length}/{DESCRIPTION_MAX}
                </div>
              </div>
            </div>
          </section>

          {/* Location & Timeline */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <GlobeIcon className="w-5 h-5 text-gray-700" />
              <h3 className="text-lg font-semibold text-gray-900">Location & Timeline</h3>
            </div>

            <div className="space-y-4">
              {/* Location */}
              <div>
                <LocationAutocomplete
                  label="Location"
                  value={locationText}
                  onChange={setLocationText}
                  onLocationSelect={(loc: LocationSelection) => {
                    const country = loc.countryId ? getCountryById(loc.countryId) : null
                    handleInputChange('location_city', loc.city)
                    handleInputChange('location_country', country?.name || '')
                    setLocationSelected(true)
                  }}
                  onLocationClear={() => {
                    handleInputChange('location_city', '')
                    handleInputChange('location_country', '')
                    setLocationSelected(false)
                  }}
                  isSelected={locationSelected}
                  placeholder="Search for a city..."
                  required
                  error={errors.location_city || errors.location_country ? 'Location is required' : undefined}
                />
                {formData.opportunity_type === 'player' && (
                  <MustNiceToggle
                    criterionLabel="location"
                    checked={!!formData.location_required}
                    onChange={(v) => handleInputChange('location_required', v)}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={startDateFieldId}>
                    Start Date
                  </label>
                  <input
                    id={startDateFieldId}
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => handleInputChange('start_date', e.target.value || null)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  />
                  {formData.opportunity_type === 'player' && (
                    <MustNiceToggle
                      criterionLabel="start date"
                      checked={!!formData.availability_required}
                      onChange={(v) => handleInputChange('availability_required', v)}
                      error={errors.availability_required}
                    />
                  )}
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={durationFieldId}>
                    Duration
                  </label>
                  <input
                    id={durationFieldId}
                    type="text"
                    value={formData.duration_text || ''}
                    onChange={(e) => handleInputChange('duration_text', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="e.g., 12 months"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Requirements */}
          <section className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Requirements</h3>

            {/* EU Passport toggle */}
            <button
              type="button"
              onClick={() => handleInputChange('eu_passport_required', !formData.eu_passport_required)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors mb-4 ${
                formData.eu_passport_required
                  ? 'bg-blue-50 border-blue-300 text-blue-800'
                  : 'bg-gray-50 border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              <Flag className={`w-5 h-5 flex-shrink-0 ${formData.eu_passport_required ? 'text-blue-600' : 'text-gray-400'}`} />
              <span className="flex-1 text-left text-sm font-medium">EU Passport Required</span>
              <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${formData.eu_passport_required ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${formData.eu_passport_required ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </div>
            </button>

            <div className="space-y-3">
              {(formData.requirements || []).map((req: string, index: number) => (
                <div key={index} className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg">
                  <span className="flex-1 text-sm text-gray-700">{req}</span>
                  <button
                    type="button"
                    onClick={() => removeRequirement(index)}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-400 hover:text-red-600 transition-colors"
                    aria-label="Remove requirement"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              {(!formData.requirements || formData.requirements.length === 0) && (
                <p className="text-sm text-gray-500 italic py-2">
                  {formData.opportunity_type === 'player'
                    ? "e.g., Minimum 3 years competitive experience, U18 age group"
                    : "e.g., UEFA B coaching license, 5+ years coaching experience"
                  }
                </p>
              )}

              <div className="flex gap-2">
                <label htmlFor={newRequirementFieldId} className="sr-only">
                  Add requirement
                </label>
                <input
                  id={newRequirementFieldId}
                  type="text"
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addRequirement()}
                  className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="Add a requirement..."
                />
                <button
                  type="button"
                  onClick={addRequirement}
                  className="flex-shrink-0 whitespace-nowrap px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  Add Requirement
                </button>
              </div>
            </div>
          </section>

          {/* Benefits Package */}
          <section className="border-t border-gray-200 pt-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Benefits Package</h3>
            
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
              {BENEFIT_OPTIONS.map((benefit) => {
                const Icon = benefit.icon
                const isSelected = (formData.benefits || []).includes(benefit.id)
                
                return (
                  <button
                    key={benefit.id}
                    type="button"
                    onClick={() => toggleBenefit(benefit.id)}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-[#10b981] bg-green-50'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2 ${
                      isSelected ? 'bg-[#10b981]' : 'bg-gray-200'
                    }`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-gray-500'}`} />
                    </div>
                    <p className="text-sm font-medium text-gray-900 text-center">{benefit.label}</p>
                    <p className={`text-xs mt-1 text-center ${
                      isSelected ? 'text-green-600' : 'text-gray-500'
                    }`}>
                      {isSelected ? '✓ Included' : '✗ Not included'}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* Benefits Summary — a count, not a percentage: there is no
                "required" number of benefits, so a % reads as misleading. */}
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">
                  {benefitsCount} of {BENEFIT_OPTIONS.length} benefits added
                </span>
              </div>
              <progress
                value={benefitsCount}
                max={BENEFIT_OPTIONS.length}
                className="w-full h-2 appearance-none rounded-full bg-gray-200 overflow-hidden [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-gray-200 [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-[#10b981] [&::-moz-progress-bar]:bg-[#10b981]"
                aria-valuetext={`${benefitsCount} of ${BENEFIT_OPTIONS.length} benefits added`}
              />
            </div>
          </section>

          {/* Additional Custom Benefits */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">💡</span>
              <h3 className="text-lg font-semibold text-gray-900">Additional Custom Benefits</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(formData.custom_benefits || []).map((benefit: string, index: number) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm"
                  >
                    {benefit}
                    <button
                      type="button"
                      onClick={() => removeCustomBenefit(index)}
                      className="hover:text-purple-900 min-w-[44px] min-h-[44px] inline-flex items-center justify-center -m-2"
                      aria-label="Remove benefit"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <label htmlFor={newCustomBenefitFieldId} className="sr-only">
                  Add custom benefit
                </label>
                <input
                  id={newCustomBenefitFieldId}
                  type="text"
                  value={newCustomBenefit}
                  onChange={(e) => setNewCustomBenefit(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomBenefit()}
                  className="flex-1 min-w-0 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                  placeholder="e.g., Professional coaching and skill development"
                />
                <button
                  type="button"
                  onClick={addCustomBenefit}
                  className="flex-shrink-0 whitespace-nowrap px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  Add Custom Benefit
                </button>
              </div>
            </div>
          </section>

          {/* Application Details */}
          <section className="border-t border-gray-200 pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📅</span>
              <h3 className="text-lg font-semibold text-gray-900">Application Details</h3>
            </div>

            <div className="space-y-4">
              {/* Application Deadline */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={applicationDeadlineFieldId}>
                  Application Deadline
                </label>
                <input
                  id={applicationDeadlineFieldId}
                  type="date"
                  value={formData.application_deadline || ''}
                  onChange={(e) => handleInputChange('application_deadline', e.target.value || null)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={contactEmailFieldId}>
                    Contact Email
                  </label>
                  <input
                    id={contactEmailFieldId}
                    type="email"
                    value={formData.contact_email || ''}
                    onChange={(e) => handleInputChange('contact_email', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="info@elitehockeyacademy.com"
                    inputMode="email"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2" htmlFor={contactPhoneFieldId}>
                    Contact Phone
                  </label>
                  <input
                    id={contactPhoneFieldId}
                    type="tel"
                    value={formData.contact_phone || ''}
                    onChange={(e) => handleInputChange('contact_phone', e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#10b981] focus:border-transparent"
                    placeholder="+31 20 123 4567"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Posting strength — live quality nudge (Market Phase 3). Same
              8-point checklist the admin Market tab scores postings with;
              a NUDGE only, never a gate: publishing stays zero-friction. */}
          <section className="bg-gray-50 border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-900">Posting strength</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${
                postingQuality.score >= 75 ? 'bg-green-100 text-green-700'
                : postingQuality.score >= 50 ? 'bg-amber-100 text-amber-700'
                : 'bg-red-100 text-red-700'
              }`}>
                {postingQuality.score}/100
              </span>
            </div>
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${
                  postingQuality.score >= 75 ? 'bg-green-500'
                  : postingQuality.score >= 50 ? 'bg-amber-500'
                  : 'bg-red-400'
                }`}
                style={{ width: `${Math.max(4, postingQuality.score)}%` }}
              />
            </div>
            {postingQuality.missing.length === 0 ? (
              <p className="text-sm text-green-700">
                Complete posting — this is what strong vacancies look like.
              </p>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-2">
                  Complete postings attract more applicants. Consider adding:
                </p>
                <ul className="space-y-1">
                  {postingQuality.missing.map((c) => (
                    <li key={c.key} className="text-xs text-gray-600">
                      <span className="font-medium text-gray-800">{c.label}</span>
                      <span className="text-gray-400"> — {c.hint}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>

        {/* Footer.
            For new opportunities, two explicit CTAs: "Save as draft"
            and "Publish now". The single button used to save silently
            as a draft, which read as "Create" to most users and was
            QA-flagged as a confusing dead-end. Editing an existing row
            keeps the single update CTA — the form's status select
            inside the modal controls the destination state there. */}
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="w-full sm:w-auto whitespace-nowrap px-6 py-3 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors font-medium disabled:opacity-50"
            type="button"
          >
            Cancel
          </button>
          {editingVacancy ? (
            <Button
              onClick={() => handleSave()}
              disabled={isLoading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap bg-[#10b981] hover:bg-[#059669]"
            >
              {isLoading ? 'Saving…' : 'Update Opportunity'}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleSave('draft')}
                disabled={isLoading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isLoading ? 'Saving…' : 'Save as draft'}
              </Button>
              <Button
                onClick={() => handleSave('open')}
                disabled={isLoading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap bg-[#10b981] hover:bg-[#059669]"
              >
                {isLoading ? 'Publishing…' : 'Publish now'}
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => { setShowDiscardConfirm(false); performClose() }}
        title="Discard this opportunity?"
        message="Your unsaved changes will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        variant="danger"
      />
    </div>
  )
}
