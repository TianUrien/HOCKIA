import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { X, Plus, Home, Car, Globe as GlobeIcon, Plane, Utensils, Briefcase, Shield, GraduationCap, CreditCard, Trophy, Flag } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { logger } from '../lib/logger'
import { postAgainSeed } from '../lib/postAgain'
import { useAuthStore } from '../lib/auth'
import type { Vacancy } from '../lib/supabase'
import Button from './Button'
import ConfirmDialog from './ConfirmDialog'
import LocationAutocomplete from './LocationAutocomplete'
import type { LocationSelection } from './LocationAutocomplete'
import { useCountries } from '@/hooks/useCountries'
import { isTopFocusTrap, useFocusTrap } from '@/hooks/useFocusTrap'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { useToastStore } from '@/lib/toast'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { trackVacancyCreate } from '@/lib/analytics'
import SpecialistSkillsSelect from '@/components/SpecialistSkillsSelect'
import { pruneSpecialistSkillsForPosition } from '@/lib/specialistSkills'
import { coachTeamHint, isYouthGender, playerRoleGender, youthPlayerRoleMessage } from '@/lib/youthRoles'
import { LEVEL_SOUGHT_OPTIONS, COMPENSATION_OPTIONS, RECRUITMENT_PROBLEM_OPTIONS, levelSoughtFromBand } from '@/lib/opportunityIntent'
import { getClubLevelBand, prefetchWorldClubLogos } from '@/hooks/useWorldClubLogo'
import { assessPostingQuality } from '@/lib/opportunityQuality'
import { deadlineBounds, deadlineError } from '@/lib/roleLifecycle'
import { requestPushAsk } from '@/lib/pushAsk'
import { withoutRoleCategory } from '@/lib/draftPrivacy'
import { switchTrackClass } from '@/components/ui/switchClasses'
import { tClub, useClubT } from '@/i18n/ns/club'
import { useEnumsT } from '@/i18n/ns/enums'

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
   *  don't land on a "Player position" form. Ignored when editing. */
  initialOpportunityType?: 'player' | 'coach'
  /** Club speed CS3 · Post again: a closed role whose details seed a NEW
   *  role. Start date and deadline start empty; it saves as a new row. */
  templateVacancy?: Vacancy | null
}

// Field limits — also enforced as `maxLength` on the inputs so the
// counter and the hard cap never disagree.
const TITLE_MAX = 120
const DESCRIPTION_MAX = 2000

const BENEFIT_OPTIONS: Array<{ id: string; labelKey: 'housing' | 'car' | 'visa' | 'flights' | 'meals' | 'job' | 'insurance' | 'education' | 'bonuses' | 'equipment'; icon: typeof Home }> = [
  { id: 'housing', labelKey: 'housing', icon: Home },
  { id: 'car', labelKey: 'car', icon: Car },
  { id: 'visa', labelKey: 'visa', icon: GlobeIcon },
  { id: 'flights', labelKey: 'flights', icon: Plane },
  { id: 'meals', labelKey: 'meals', icon: Utensils },
  { id: 'job', labelKey: 'job', icon: Briefcase },
  { id: 'insurance', labelKey: 'insurance', icon: Shield },
  { id: 'education', labelKey: 'education', icon: GraduationCap },
  { id: 'bonuses', labelKey: 'bonuses', icon: CreditCard },
  { id: 'equipment', labelKey: 'equipment', icon: Trophy },
]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const buildInitialFormData = (vacancy?: Vacancy | null, initialOpportunityType?: 'player' | 'coach'): Record<string, any> => ({
  opportunity_type: vacancy?.opportunity_type || initialOpportunityType || 'player',
  title: vacancy?.title || '',
  position: vacancy?.position || undefined,
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

/**
 * The role's category (gender), kept in its own state rather than formData so
 * the autosaved draft never holds it (see draftPrivacy; CodeQL
 * js/clear-text-storage-of-sensitive-data #32). A restored draft asks again.
 * A legacy youth PLAYER role opens with no category (under-18s are never
 * recruitable), so saving asks for an adult one. Coach roles keep theirs
 * (Boys/Girls included); a legacy coach role with none is asked for one.
 */
const buildInitialRoleCategory = (vacancy?: Vacancy | null, initialOpportunityType?: 'player' | 'coach'): string | undefined =>
  ((vacancy?.opportunity_type || initialOpportunityType || 'player') === 'player'
    ? playerRoleGender(vacancy?.gender)
    : vacancy?.gender) || undefined

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
  ariaLabel,
  error,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  /** Screen-reader label, e.g. "Mark position as a must-have". */
  ariaLabel: string
  error?: string
}) {
  const t = useClubT()
  const errorId = useId()
  return (
    <div className="mt-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked ? 'true' : 'false'}
        aria-label={ariaLabel}
        aria-describedby={error ? errorId : undefined}
        onClick={() => onChange(!checked)}
        className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-1.5 text-xs font-medium transition-colors ${
          checked ? 'text-ink-1' : 'text-ink-3'
        }`}
      >
        <span
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${switchTrackClass(checked)}`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
            }`}
          />
        </span>
        <span>{checked ? t('createOpportunity.mustHave.on') : t('createOpportunity.mustHave.off')}</span>
      </button>
      {error && (
        <p id={errorId} className="mt-0.5 text-xs text-status-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export default function CreateVacancyModal({ isOpen, onClose, onSuccess, editingVacancy, initialOpportunityType, templateVacancy }: CreateVacancyModalProps) {
  const t = useClubT()
  const tEnums = useEnumsT()
  const { user, profile } = useAuthStore()
  const seedVacancy = useMemo(() => (editingVacancy ? editingVacancy : templateVacancy ? postAgainSeed(templateVacancy) : null), [editingVacancy, templateVacancy])
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

  const [formData, setFormData] = useState<OpportunityFormData>(buildInitialFormData(seedVacancy, initialOpportunityType))
  const [roleCategory, setRoleCategory] = useState<string | undefined>(buildInitialRoleCategory(seedVacancy, initialOpportunityType))

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
    const city = seedVacancy?.location_city || ''
    const country = seedVacancy?.location_country || ''
    return city && country ? `${city}, ${country}` : city || ''
  })
  const [locationSelected, setLocationSelected] = useState(() => !!(seedVacancy?.location_city && seedVacancy?.location_country))

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

    if (!editingVacancy && !templateVacancy && user && typeof window !== 'undefined') {
      const draftKey = getVacancyDraftKey(user.id)
      const rawDraft = window.localStorage.getItem(draftKey)
      if (rawDraft) {
        try {
          const parsed = JSON.parse(rawDraft) as VacancyDraftStorage
          const base = buildInitialFormData(null, initialOpportunityType)
          const restored = { ...base, ...withoutRoleCategory(parsed.formData || {}) }
          setFormData(restored)
          setRoleCategory(undefined)
          setNewRequirement(parsed.newRequirement ?? '')
          setNewCustomBenefit(parsed.newCustomBenefit ?? '')
          // Restore location autocomplete state from draft
          if (restored.location_city && restored.location_country) {
            setLocationText(`${restored.location_city}, ${restored.location_country}`)
            setLocationSelected(true)
          }
          vacancyDraftRestoringRef.current = true
          addToast(tClub('createOpportunity.toasts.draftRestored'), 'info')
          return
        } catch (error) {
          logger.error('Failed to restore vacancy draft', error)
          window.localStorage.removeItem(draftKey)
        }
      }
    }

    const initial = buildInitialFormData(seedVacancy, initialOpportunityType)
    // Pre-fill organization name from coach's current club for new opportunities
    if (!editingVacancy && profile?.role === 'coach' && profile.current_club && !initial.organization_name) {
      initial.organization_name = profile.current_club
    }
    setFormData(initial)
    setRoleCategory(buildInitialRoleCategory(seedVacancy, initialOpportunityType))
  }, [addToast, editingVacancy, templateVacancy, seedVacancy, initialOpportunityType, isOpen, profile, user])

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      // Another trapped overlay is on top: its Escape closes it, not this one.
      if (event.key === 'Escape' && !isTopFocusTrap(dialogRef.current)) return
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
    // Post again never writes the local new-role draft (it would reopen as "restored" next time).
    if (!isOpen || editingVacancy || templateVacancy || !user) {
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
  }, [editingVacancy, templateVacancy, formData, isOpen, newCustomBenefit, newRequirement, user])

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
    if (field === 'gender') setRoleCategory(value)
    // Back to a player role: a youth team isn't valid there (DB CHECK
    // opportunities_player_role_not_youth), so it clears; adult teams stay.
    if (field === 'opportunity_type' && value === 'player') setRoleCategory((prev) => playerRoleGender(prev) || undefined)
    if (field !== 'gender') setFormData(prev => {
      const next = { ...prev, [field]: value }
      if (field === 'opportunity_type' && value === 'coach') {
        next.position = undefined  // reset — coach has different position options
        // The team stays: coach roles use the same categories (plus Boys/Girls).
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

    if (!formData.title?.trim()) newErrors.title = t('createOpportunity.errors.title')
    // Position is required for player opportunities; the category for every
    // role (founder ruling 2026-09-26), adult-only for player roles.
    if (formData.opportunity_type === 'player') {
      if (!formData.position) newErrors.position = t('createOpportunity.errors.position')
      if (!roleCategory) newErrors.gender = t('createOpportunity.errors.category')
      else if (isYouthGender(roleCategory)) newErrors.gender = youthPlayerRoleMessage()
    } else if (!roleCategory) {
      newErrors.gender = t('createOpportunity.errors.category')
    }
    if (!formData.location_city?.trim()) newErrors.location_city = t('createOpportunity.errors.city')
    if (!formData.location_country?.trim()) newErrors.location_country = t('createOpportunity.errors.country')

    // Phase 3c — a MUST-HAVE on an unset OPTIONAL criterion is unsatisfiable
    // (it would silently zero the candidate pool). Position + location are
    // already required above, so only the optional criteria need this guard.
    // Player opps only (the toggles don't render for coach opps).
    if (formData.opportunity_type === 'player') {
      if (formData.level_required && !formData.level_sought)
        newErrors.level_required = t('createOpportunity.errors.levelMustHave')
      if (formData.compensation_required && !formData.compensation)
        newErrors.compensation_required = t('createOpportunity.errors.compensationMustHave')
      if (formData.availability_required && !formData.start_date)
        newErrors.availability_required = t('createOpportunity.errors.startDateMustHave')
      if (formData.specialists_required && !(formData.specialist_skills_wanted?.length))
        newErrors.specialists_required = t('createOpportunity.errors.specialistsMustHave')
    }

    // Deadline: only when the club set or changed it (an old role keeps its
    // past date on edits; the database enforces the rule for open roles).
    if (formData.application_deadline && formData.application_deadline !== (editingVacancy?.application_deadline ?? null)) {
      const deadlineMsg = deadlineError(formData.application_deadline)
      if (deadlineMsg) newErrors.application_deadline = deadlineMsg
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
      setSubmitError(t('createOpportunity.errors.signedOut'))
      return
    }

    if (!validate()) {
      setSubmitError(t('createOpportunity.errors.fixFields'))
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
        gender: roleCategory || null,
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
          addToast(t('createOpportunity.toasts.draftUpdated'), 'info')
        } else {
          addToast(t('createOpportunity.toasts.updated'), 'success')
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
          addToast(t('createOpportunity.toasts.published'), 'success')
          // Posting a role is a moment of intent: the one-time notification ask (audit A1).
          requestPushAsk('role_posted')
        } else {
          addToast(t('createOpportunity.toasts.draftSaved'), 'info')
        }
        clearVacancyDraft()
      }

      onSuccess(resolvedStatus === 'open' ? 'open' : 'draft')
      onClose()
    } catch (error) {
      logger.error('Error saving vacancy:', error)
      const message = error instanceof Error && error.message
        ? t('createOpportunity.errors.saveFailedDetail', { detail: error.message })
        : t('createOpportunity.errors.saveFailed')
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
        <div className="flex items-center justify-between p-6 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-surface-muted rounded-lg flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-ink-2" />
            </div>
            <div>
              <h2 id={titleId} className="text-xl font-bold text-ink-1">
                {editingVacancy ? t('createOpportunity.header.edit') : templateVacancy ? t('createOpportunity.header.postAgain') : t('createOpportunity.header.create')}
              </h2>
              <p id={subtitleId} className="text-sm text-ink-2">
                {editingVacancy
                  ? t('createOpportunity.header.editSubtitle')
                  : templateVacancy
                    ? t('createOpportunity.header.postAgainSubtitle')
                  : formData.opportunity_type === 'player'
                    ? t('createOpportunity.header.createPlayerSubtitle')
                    : t('createOpportunity.header.createCoachSubtitle')
                }
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={handleClose}
            disabled={isLoading}
            className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center hover:bg-surface-muted rounded-lg transition-colors disabled:opacity-50"
            aria-label={t('createOpportunity.closeAria')}
          >
            <X className="w-5 h-5 text-ink-3" />
          </button>
        </div>

        {/* Content - Scrollable */}
        <div ref={scrollContentRef} className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6">
          {submitError && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-lg border border-status-danger/30 bg-status-danger-soft p-3 text-sm text-status-danger"
            >
              <X className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-danger" aria-hidden="true" />
              <span>{submitError}</span>
            </div>
          )}
          {/* Basic Information */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Briefcase className="w-5 h-5 text-ink-2" />
              <h3 className="text-lg font-semibold text-ink-1">{t('createOpportunity.basic.heading')}</h3>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Opportunity Type */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={opportunityTypeFieldId}>
                    {t('createOpportunity.basic.type')} <span className="text-status-danger">*</span>
                  </label>
                  <select
                    id={opportunityTypeFieldId}
                    ref={opportunityTypeRef}
                    value={formData.opportunity_type}
                    onChange={(e) => handleInputChange('opportunity_type', e.target.value as 'player' | 'coach')}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white"
                    title={t('createOpportunity.basic.type')}
                  >
                    <option value="player">{t('createOpportunity.basic.typePlayer')}</option>
                    <option value="coach">{t('createOpportunity.basic.typeCoach')}</option>
                  </select>
                </div>

                {/* Priority Level */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={priorityFieldId}>
                    {t('createOpportunity.basic.priority')}
                  </label>
                  <select
                    id={priorityFieldId}
                    value={formData.priority || ''}
                    onChange={(e) => handleInputChange('priority', e.target.value as 'low' | 'medium' | 'high')}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white"
                    title={t('createOpportunity.basic.priority')}
                  >
                    <option value="low">{t('createOpportunity.basic.priorityLow')}</option>
                    <option value="medium">{t('createOpportunity.basic.priorityMedium')}</option>
                    <option value="high">{t('createOpportunity.basic.priorityHigh')}</option>
                  </select>
                </div>
              </div>

              {/* Opportunity Title */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={opportunityTitleFieldId}>
                  {t('createOpportunity.basic.title')} <span className="text-status-danger">*</span>
                </label>
                <input
                  id={opportunityTitleFieldId}
                  type="text"
                  required
                  aria-required="true"
                  value={formData.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  maxLength={TITLE_MAX}
                  className={`w-full px-4 py-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent ${
                    errors.title ? 'border-status-danger' : 'border-line'
                  }`}
                  placeholder={
                    formData.opportunity_type === 'player'
                      ? t('createOpportunity.basic.titlePlaceholderPlayer')
                      : t('createOpportunity.basic.titlePlaceholderCoach')
                  }
                  aria-invalid={errors.title ? true : undefined}
                  aria-describedby={titleErrorId}
                  autoCapitalize="words"
                  inputMode="text"
                />
                <div className="mt-1 flex items-start justify-between gap-3">
                  {errors.title
                    ? <p id={titleErrorId} className="text-sm text-status-danger">{errors.title}</p>
                    : <span />}
                  <span className="flex-shrink-0 text-xs text-ink-4">
                    {(formData.title || '').length}/{TITLE_MAX}
                  </span>
                </div>
              </div>

              {/* Organization Name - shown for coaches, optional for clubs */}
              {profile?.role === 'coach' && (
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={organizationNameFieldId}>
                  {t('createOpportunity.basic.organization')}
                </label>
                <input
                  id={organizationNameFieldId}
                  type="text"
                  value={formData.organization_name ?? ''}
                  onChange={(e) => handleInputChange('organization_name', e.target.value)}
                  className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                  placeholder={t('createOpportunity.basic.organizationPlaceholder')}
                  autoCapitalize="words"
                  inputMode="text"
                />
                <p className="mt-1 text-xs text-ink-3">
                  {t('createOpportunity.basic.organizationHint')}
                </p>
              </div>
              )}

              {/* Position and Gender */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
                {/* Position */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    {t('createOpportunity.basic.position')} {formData.opportunity_type === 'player' && <span className="text-status-danger">*</span>}
                  </label>
                  <select
                    value={formData.position || ''}
                    onChange={(e) => handleInputChange('position', e.target.value || undefined)}
                    aria-required={formData.opportunity_type === 'player' ? 'true' : undefined}
                    aria-invalid={errors.position ? true : undefined}
                    className={`w-full px-4 py-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white ${
                      errors.position ? 'border-status-danger' : 'border-line'
                    }`}
                    title={t('createOpportunity.basic.position')}
                  >
                    <option value="">{t('createOpportunity.basic.positionSelect')}</option>
                    {formData.opportunity_type === 'player' ? (
                      <>
                        <option value="goalkeeper">{tEnums('position.goalkeeper')}</option>
                        <option value="defender">{tEnums('position.defender')}</option>
                        <option value="midfielder">{tEnums('position.midfielder')}</option>
                        <option value="forward">{tEnums('position.forward')}</option>
                      </>
                    ) : (
                      <>
                        <option value="head_coach">{tEnums('coachSpecialization.head_coach')}</option>
                        <option value="assistant_coach">{t('createOpportunity.basic.assistantCoach')}</option>
                        <option value="youth_coach">{t('createOpportunity.basic.youthCoach')}</option>
                      </>
                    )}
                  </select>
                  {errors.position && <p className="mt-1 text-sm text-status-danger">{errors.position}</p>}
                  {formData.opportunity_type === 'player' && (
                    <MustNiceToggle
                      ariaLabel={t('createOpportunity.mustHave.positionAria')}
                      checked={!!formData.position_required}
                      onChange={(v) => handleInputChange('position_required', v)}
                    />
                  )}
                </div>

                {/* Category (team) — every role; Boys/Girls on coach roles only */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">
                    {t('createOpportunity.basic.category')} <span className="text-status-danger">*</span>
                  </label>
                  <select
                    value={roleCategory || ''}
                    onChange={(e) =>
                      handleInputChange('gender', e.target.value || undefined)
                    }
                    aria-required="true"
                    aria-invalid={errors.gender ? true : undefined}
                    className={`w-full px-4 py-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white ${
                      errors.gender ? 'border-status-danger' : 'border-line'
                    }`}
                    title={t('createOpportunity.basic.category')}
                  >
                    <option value="">{t('createOpportunity.basic.categorySelect')}</option>
                    {/* Display labels are the new Phase 3 vocabulary; stored
                        values stay as the legacy enum for back-compat. Girls /
                        Boys on coach roles only: player roles are adult-only (founder
                        ruling 2026-09-25; the DB rejects them). */}
                    <option value="Men">{tEnums('category.adult_men')}</option>
                    <option value="Women">{tEnums('category.adult_women')}</option>
                    <option value="Mixed">{tEnums('category.mixed')}</option>
                    {formData.opportunity_type !== 'player' && (
                      <>
                        <option value="Boys">{tEnums('category.boys')}</option>
                        <option value="Girls">{tEnums('category.girls')}</option>
                      </>
                    )}
                  </select>
                  {errors.gender && <p className="mt-1 text-sm text-status-danger">{errors.gender}</p>}
                  {formData.opportunity_type !== 'player' && !errors.gender && (
                    <p className="mt-1 text-xs text-ink-3">{coachTeamHint()}</p>
                  )}
                </div>
              </div>

              {/* Specialist skills wanted (Matching Increment #3) — player
                  opportunities only; optional. */}
              {formData.opportunity_type === 'player' && (
                <div>
                  <SpecialistSkillsSelect
                    label={t('createOpportunity.basic.specialists')}
                    hint={t('createOpportunity.basic.specialistsHint')}
                    value={formData.specialist_skills_wanted || []}
                    onChange={(next) => handleInputChange('specialist_skills_wanted', next)}
                    position={formData.position}
                  />
                  <MustNiceToggle
                    ariaLabel={t('createOpportunity.mustHave.specialistsAria')}
                    checked={!!formData.specialists_required}
                    onChange={(v) => handleInputChange('specialists_required', v)}
                    error={errors.specialists_required}
                  />
                </div>
              )}

              {/* Recruiter intent (Matching Increment #4) — player opps only.
                  Kept simple: clarify intent, not fill an HR form. */}
              {formData.opportunity_type === 'player' && (
                <div className="space-y-4 rounded-lg border border-line p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-4">{t('createOpportunity.intent.heading')}</p>
                  <div>
                    <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('createOpportunity.intent.problem')}</label>
                    <select
                      value={formData.recruitment_problem || ''}
                      onChange={(e) => handleInputChange('recruitment_problem', e.target.value || undefined)}
                      aria-label={t('createOpportunity.intent.problemAria')}
                      className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white"
                    >
                      <option value="">{t('createOpportunity.intent.optional')}</option>
                      {RECRUITMENT_PROBLEM_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('createOpportunity.intent.level')}</label>
                      <select
                        value={formData.level_sought || ''}
                        onChange={(e) => handleInputChange('level_sought', e.target.value || undefined)}
                        aria-label={t('createOpportunity.intent.level')}
                        className="w-full px-3 py-3 border border-line rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white"
                      >
                        <option value="">{t('createOpportunity.intent.selectPlaceholder')}</option>
                        {LEVEL_SOUGHT_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <MustNiceToggle
                        ariaLabel={t('createOpportunity.mustHave.levelAria')}
                        checked={!!formData.level_required}
                        onChange={(v) => handleInputChange('level_required', v)}
                        error={errors.level_required}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-ink-2 mb-1.5">{t('createOpportunity.intent.compensation')}</label>
                      <select
                        value={formData.compensation || ''}
                        onChange={(e) => handleInputChange('compensation', e.target.value || undefined)}
                        aria-label={t('createOpportunity.intent.compensation')}
                        className="w-full px-3 py-3 border border-line rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent bg-white"
                      >
                        <option value="">{t('createOpportunity.intent.selectPlaceholder')}</option>
                        {COMPENSATION_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <MustNiceToggle
                        ariaLabel={t('createOpportunity.mustHave.compensationAria')}
                        checked={!!formData.compensation_required}
                        onChange={(v) => handleInputChange('compensation_required', v)}
                        error={errors.compensation_required}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-ink-4">{t('createOpportunity.intent.footnote')}</p>
                </div>
              )}

              {/* Description */}
              <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={descriptionFieldId}>
                  {t('createOpportunity.basic.description')}
                </label>
                <textarea
                  id={descriptionFieldId}
                  value={formData.description || ''}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  rows={4}
                  maxLength={DESCRIPTION_MAX}
                  className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent resize-none"
                  placeholder={
                    formData.opportunity_type === 'player'
                      ? t('createOpportunity.basic.descriptionPlaceholderPlayer')
                      : t('createOpportunity.basic.descriptionPlaceholderCoach')
                  }
                />
                <div className="mt-1 text-right text-xs text-ink-4">
                  {(formData.description || '').length}/{DESCRIPTION_MAX}
                </div>
              </div>
            </div>
          </section>

          {/* Location & Timeline */}
          <section className="border-t border-line pt-6">
            <div className="flex items-center gap-2 mb-4">
              <GlobeIcon className="w-5 h-5 text-ink-2" />
              <h3 className="text-lg font-semibold text-ink-1">{t('createOpportunity.location.heading')}</h3>
            </div>

            <div className="space-y-4">
              {/* Location */}
              <div>
                <LocationAutocomplete
                  label={t('createOpportunity.location.label')}
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
                  placeholder={t('createOpportunity.location.placeholder')}
                  required
                  error={errors.location_city || errors.location_country ? t('createOpportunity.errors.location') : undefined}
                />
                {formData.opportunity_type === 'player' && (
                  <MustNiceToggle
                    ariaLabel={t('createOpportunity.mustHave.locationAria')}
                    checked={!!formData.location_required}
                    onChange={(v) => handleInputChange('location_required', v)}
                  />
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Start Date */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={startDateFieldId}>
                    {t('createOpportunity.location.startDate')}
                  </label>
                  <input
                    id={startDateFieldId}
                    type="date"
                    value={formData.start_date || ''}
                    onChange={(e) => handleInputChange('start_date', e.target.value || null)}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                  />
                  {formData.opportunity_type === 'player' && (
                    <MustNiceToggle
                      ariaLabel={t('createOpportunity.mustHave.startDateAria')}
                      checked={!!formData.availability_required}
                      onChange={(v) => handleInputChange('availability_required', v)}
                      error={errors.availability_required}
                    />
                  )}
                </div>

                {/* Duration */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={durationFieldId}>
                    {t('createOpportunity.location.duration')}
                  </label>
                  <input
                    id={durationFieldId}
                    type="text"
                    value={formData.duration_text || ''}
                    onChange={(e) => handleInputChange('duration_text', e.target.value)}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                    placeholder={t('createOpportunity.location.durationPlaceholder')}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Requirements */}
          <section className="border-t border-line pt-6">
            <h3 className="text-lg font-semibold text-ink-1 mb-4">{t('createOpportunity.requirements.heading')}</h3>

            {/* EU Passport toggle */}
            <button
              type="button"
              onClick={() => handleInputChange('eu_passport_required', !formData.eu_passport_required)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors mb-4 ${
                formData.eu_passport_required
                  ? 'bg-hockia-soft border-brand-primary text-brand-text'
                  : 'bg-surface-subtle border-line text-ink-3 hover:border-line'
              }`}
            >
              <Flag className={`w-5 h-5 flex-shrink-0 ${formData.eu_passport_required ? 'text-brand-primary' : 'text-ink-4'}`} />
              <span className="flex-1 text-left text-sm font-medium">{t('createOpportunity.requirements.euPassport')}</span>
              <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${switchTrackClass(formData.eu_passport_required)}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${formData.eu_passport_required ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </div>
            </button>

            <div className="space-y-3">
              {(formData.requirements || []).map((req: string, index: number) => (
                <div key={index} className="flex items-center gap-2 p-3 bg-surface-subtle rounded-lg">
                  <span className="flex-1 text-sm text-ink-2">{req}</span>
                  <button
                    type="button"
                    onClick={() => removeRequirement(index)}
                    className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-ink-4 hover:text-status-danger transition-colors"
                    aria-label={t('createOpportunity.requirements.removeAria')}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              {(!formData.requirements || formData.requirements.length === 0) && (
                <p className="text-sm text-ink-3 italic py-2">
                  {formData.opportunity_type === 'player'
                    ? t('createOpportunity.requirements.examplePlayer')
                    : t('createOpportunity.requirements.exampleCoach')
                  }
                </p>
              )}

              <div className="flex gap-2">
                <label htmlFor={newRequirementFieldId} className="sr-only">
                  {t('createOpportunity.requirements.addLabel')}
                </label>
                <input
                  id={newRequirementFieldId}
                  type="text"
                  value={newRequirement}
                  onChange={(e) => setNewRequirement(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addRequirement()}
                  className="flex-1 min-w-0 px-4 py-2 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                  placeholder={t('createOpportunity.requirements.placeholder')}
                />
                <button
                  type="button"
                  onClick={addRequirement}
                  className="flex-shrink-0 whitespace-nowrap px-4 py-2 border border-line rounded-lg hover:bg-surface-subtle transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  {t('createOpportunity.requirements.addButton')}
                </button>
              </div>
            </div>
          </section>

          {/* Benefits Package */}
          <section className="border-t border-line pt-6">
            <h3 className="text-lg font-semibold text-ink-1 mb-4">{t('createOpportunity.benefits.heading')}</h3>
            
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
                        ? 'border-brand-primary bg-hockia-soft'
                        : 'border-line bg-white hover:border-line'
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-2 ${
                      isSelected ? 'bg-brand-primary' : 'bg-surface-muted'
                    }`}>
                      <Icon className={`w-5 h-5 ${isSelected ? 'text-white' : 'text-ink-3'}`} />
                    </div>
                    <p className="text-sm font-medium text-ink-1 text-center">{t(`createOpportunity.benefits.${benefit.labelKey}`)}</p>
                    <p className={`text-xs mt-1 text-center ${
                      isSelected ? 'text-brand-text' : 'text-ink-3'
                    }`}>
                      {isSelected ? t('createOpportunity.benefits.included') : t('createOpportunity.benefits.notIncluded')}
                    </p>
                  </button>
                )
              })}
            </div>

            {/* Benefits Summary — a count, not a percentage: there is no
                "required" number of benefits, so a % reads as misleading. */}
            <div className="bg-surface-subtle rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-ink-2">
                  {t('createOpportunity.benefits.count', { count: benefitsCount, total: BENEFIT_OPTIONS.length })}
                </span>
              </div>
              <progress
                value={benefitsCount}
                max={BENEFIT_OPTIONS.length}
                className="w-full h-2 appearance-none rounded-full bg-line overflow-hidden [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-brand-primary [&::-moz-progress-bar]:bg-brand-primary"
                aria-valuetext={t('createOpportunity.benefits.count', { count: benefitsCount, total: BENEFIT_OPTIONS.length })}
              />
            </div>
          </section>

          {/* Additional Custom Benefits */}
          <section className="border-t border-line pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">💡</span>
              <h3 className="text-lg font-semibold text-ink-1">{t('createOpportunity.customBenefits.heading')}</h3>
            </div>
            
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(formData.custom_benefits || []).map((benefit: string, index: number) => (
                  <span
                    key={index}
                    className="inline-flex items-center gap-2 px-3 py-1 bg-hockia-soft text-brand-text rounded-full text-sm"
                  >
                    {benefit}
                    <button
                      type="button"
                      onClick={() => removeCustomBenefit(index)}
                      className="hover:text-ink-1 min-w-[44px] min-h-[44px] inline-flex items-center justify-center -m-2"
                      aria-label={t('createOpportunity.customBenefits.removeAria')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>

              <div className="flex gap-2">
                <label htmlFor={newCustomBenefitFieldId} className="sr-only">
                  {t('createOpportunity.customBenefits.addLabel')}
                </label>
                <input
                  id={newCustomBenefitFieldId}
                  type="text"
                  value={newCustomBenefit}
                  onChange={(e) => setNewCustomBenefit(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addCustomBenefit()}
                  className="flex-1 min-w-0 px-4 py-2 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                  placeholder={t('createOpportunity.customBenefits.placeholder')}
                />
                <button
                  type="button"
                  onClick={addCustomBenefit}
                  className="flex-shrink-0 whitespace-nowrap px-4 py-2 border border-line rounded-lg hover:bg-surface-subtle transition-colors flex items-center gap-2 min-h-[44px]"
                >
                  <Plus className="w-4 h-4" />
                  {t('createOpportunity.customBenefits.addButton')}
                </button>
              </div>
            </div>
          </section>

          {/* Application Details */}
          <section className="border-t border-line pt-6">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-lg">📅</span>
              <h3 className="text-lg font-semibold text-ink-1">{t('createOpportunity.application.heading')}</h3>
            </div>

            <div className="space-y-4">
              {/* Application Deadline */}
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={applicationDeadlineFieldId}>
                  {t('createOpportunity.application.deadline')}
                </label>
                <input
                  id={applicationDeadlineFieldId}
                  type="date"
                  min={deadlineBounds().min}
                  max={deadlineBounds().max}
                  value={formData.application_deadline || ''}
                  onChange={(e) => handleInputChange('application_deadline', e.target.value || null)}
                  aria-invalid={errors.application_deadline ? true : undefined}
                  aria-describedby={errors.application_deadline ? `${applicationDeadlineFieldId}-error` : undefined}
                  className={`w-full px-4 py-3 border rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent ${
                    errors.application_deadline ? 'border-status-danger' : 'border-line'
                  }`}
                />
                {errors.application_deadline && (
                  <p id={`${applicationDeadlineFieldId}-error`} className="mt-1 text-sm text-status-danger">{errors.application_deadline}</p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={contactEmailFieldId}>
                    {t('createOpportunity.application.email')}
                  </label>
                  <input
                    id={contactEmailFieldId}
                    type="email"
                    value={formData.contact_email || ''}
                    onChange={(e) => handleInputChange('contact_email', e.target.value)}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
                    placeholder="info@elitehockeyacademy.com"
                    inputMode="email"
                    autoCapitalize="none"
                    autoComplete="email"
                  />
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2" htmlFor={contactPhoneFieldId}>
                    {t('createOpportunity.application.phone')}
                  </label>
                  <input
                    id={contactPhoneFieldId}
                    type="tel"
                    value={formData.contact_phone || ''}
                    onChange={(e) => handleInputChange('contact_phone', e.target.value)}
                    className="w-full px-4 py-3 border border-line rounded-lg focus-visible:ring-2 focus-visible:ring-brand-primary focus:border-transparent"
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
          <section className="bg-surface-subtle border border-line rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-ink-1">{t('createOpportunity.strength.heading')}</h3>
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold tabular-nums ${
                // A nudge, never a gate: green only once the posting is complete;
                // otherwise neutral (the recruiter isn't required to act, so no amber or red).
                postingQuality.missing.length === 0 ? 'bg-positive-soft text-positive' : 'bg-surface-muted text-ink-2'
              }`}>
                {postingQuality.score}/100
              </span>
            </div>
            <div className="h-1.5 bg-line rounded-full overflow-hidden mb-3">
              <div
                className={`h-full rounded-full transition-all ${
                  postingQuality.missing.length === 0 ? 'bg-positive' : 'bg-brand-primary'
                }`}
                style={{ width: `${Math.max(4, postingQuality.score)}%` }}
              />
            </div>
            {postingQuality.missing.length === 0 ? (
              <p className="text-sm text-positive">
                {t('createOpportunity.strength.complete')}
              </p>
            ) : (
              <>
                <p className="text-xs text-ink-3 mb-2">
                  {t('createOpportunity.strength.consider')}
                </p>
                <ul className="space-y-1">
                  {postingQuality.missing.map((c) => (
                    <li key={c.key} className="text-xs text-ink-2">
                      <span className="font-medium text-ink-1">{c.label}</span>
                      <span className="text-ink-4">: {c.hint}</span>
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
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 p-6 border-t border-line bg-surface-subtle">
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="w-full sm:w-auto whitespace-nowrap px-6 py-3 text-ink-2 hover:bg-surface-muted rounded-lg transition-colors font-medium disabled:opacity-50"
            type="button"
          >
            {t('createOpportunity.footer.cancel')}
          </button>
          {editingVacancy ? (
            <Button
              onClick={() => handleSave()}
              disabled={isLoading}
              className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap"
            >
              {isLoading ? t('createOpportunity.footer.saving') : t('createOpportunity.footer.update')}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => handleSave('draft')}
                disabled={isLoading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isLoading ? t('createOpportunity.footer.saving') : t('createOpportunity.footer.saveDraft')}
              </Button>
              <Button
                onClick={() => handleSave('open')}
                disabled={isLoading}
                className="w-full sm:w-auto flex items-center justify-center gap-2 whitespace-nowrap"
              >
                {isLoading ? t('createOpportunity.footer.publishing') : t('createOpportunity.footer.publish')}
              </Button>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={() => { setShowDiscardConfirm(false); performClose() }}
        title={t('createOpportunity.discard.title')}
        message={t('createOpportunity.discard.message')}
        confirmLabel={t('createOpportunity.discard.confirm')}
        cancelLabel={t('createOpportunity.discard.cancel')}
        variant="danger"
      />
    </div>
  )
}
