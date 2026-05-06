import { useState, useEffect, useCallback, useRef, type ComponentType } from 'react'
import {
  Building2,
  Calendar,
  Edit2,
  Flag,
  Globe2,
  GraduationCap,
  Image as ImageIcon,
  Loader2,
  Plus,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Upload,
  X,
} from 'lucide-react'
import { differenceInMonths, format } from 'date-fns'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { optimizeImage, generateThumbnail, validateImage } from '@/lib/imageOptimization'
import type { CareerHistory } from '@/lib/supabase'
import { deleteStorageObject, extractStoragePath } from '@/lib/storage'
import { logger } from '@/lib/logger'
import Button from './Button'
import Skeleton from './Skeleton'
import StorageImage from './StorageImage'
import WorldClubSearch, { type WorldClubSearchResult } from './WorldClubSearch'

type EditableJourneyEntry = Omit<
  CareerHistory,
  'highlights' | 'start_date' | 'end_date' | 'entry_type' | 'badge_label'
> & {
  highlights: string[]
  start_date: string | null
  end_date: string | null
  entry_type: JourneyType | null
  isCurrent?: boolean
  startMonthDraft?: string
  startYearDraft?: string
  endMonthDraft?: string
  endYearDraft?: string
}

type JourneyType = CareerHistory['entry_type']

type EntryTypeMeta = {
  label: string
  dotClass: string
  badgeClass: string
  icon: ComponentType<{ className?: string }>
}

type JourneyDraftContext = { type: 'new' } | { type: 'edit'; entryId: string }

const getJourneyDraftContextKey = (userId: string) => `journeyDraft:context:${userId}`
const getJourneyDraftKey = (context: JourneyDraftContext, userId: string) =>
  context.type === 'new' ? `journeyDraft:new:${userId}` : `journeyDraft:edit:${context.entryId}`

const entryTypeMeta: Record<JourneyType, EntryTypeMeta> = {
  club: {
    label: 'Club',
    dotClass: 'bg-blue-500/95 text-white',
    badgeClass: 'bg-blue-50 text-blue-700',
    icon: Building2,
  },
  national_team: {
    label: 'Representative Team',
    dotClass: 'bg-emerald-500/95 text-white',
    badgeClass: 'bg-emerald-50 text-emerald-700',
    icon: Globe2,
  },
  achievement: {
    label: 'Achievement / Award',
    dotClass: 'bg-amber-500/95 text-white',
    badgeClass: 'bg-amber-50 text-amber-700',
    icon: Trophy,
  },
  tournament: {
    label: 'Tournament',
    dotClass: 'bg-indigo-500/95 text-white',
    badgeClass: 'bg-indigo-50 text-indigo-700',
    icon: Flag,
  },
  milestone: {
    label: 'Milestone',
    dotClass: 'bg-pink-500/95 text-white',
    badgeClass: 'bg-pink-50 text-pink-700',
    icon: Star,
  },
  academy: {
    label: 'Academy',
    dotClass: 'bg-sky-500/95 text-white',
    badgeClass: 'bg-sky-50 text-sky-700',
    icon: GraduationCap,
  },
  other: {
    label: 'Journey',
    dotClass: 'bg-slate-500/95 text-white',
    badgeClass: 'bg-gray-100 text-gray-700',
    icon: Sparkles,
  },
}

const ENTRY_TYPES: { id: JourneyType; label: string }[] = [
  { id: 'club', label: entryTypeMeta.club.label },
  { id: 'national_team', label: entryTypeMeta.national_team.label },
  { id: 'achievement', label: entryTypeMeta.achievement.label },
]

const MONTH_OPTIONS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
].map((label, index) => ({ label, value: String(index) }))

const CURRENT_YEAR = new Date().getUTCFullYear()
const YEAR_OPTIONS = Array.from({ length: 70 }, (_, index) => CURRENT_YEAR + 5 - index).map(year => String(year))
const JOURNEY_BUCKET = 'journey'

/** Derive the thumbnail URL from a full image URL using naming convention: foo.jpg → foo_thumb.jpg */
const deriveThumbUrl = (imageUrl: string): string => {
  const lastDot = imageUrl.lastIndexOf('.')
  if (lastDot === -1) return imageUrl
  return `${imageUrl.slice(0, lastDot)}_thumb${imageUrl.slice(lastDot)}`
}

const createEmptyJourneyEntry = (userId: string): EditableJourneyEntry => ({
  id: `temp-${Date.now()}`,
  user_id: userId,
  entry_type: null,
  club_name: '',
  position_role: '',
  years: '',
  division_league: '',
  highlights: [],
  location_city: '',
  location_country: '',
  start_date: null,
  end_date: null,
  description: '',
  image_url: null,
  world_club_id: null,
  display_order: 0,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  isCurrent: false,
  startMonthDraft: '',
  startYearDraft: '',
  endMonthDraft: '',
  endYearDraft: '',
})

interface JourneyTabProps {
  profileId?: string
  readOnly?: boolean
  /**
   * Visual variant.
   * - `tab` (default): full tab UI with description line + form panel (when
   *   not readOnly) + empty state placeholder.
   * - `inline`: stripped-down render for embedding in a public profile page
   *   (between About Me and MediaTab). Drops the description line. Hides
   *   the timeline entirely when there are no entries (instead of showing
   *   the "no entries yet" placeholder) so anonymous viewers don't see an
   *   empty section. Form panel is already gated by readOnly so it stays
   *   hidden either way.
   */
  variant?: 'tab' | 'inline'
  /**
   * Heading shown above the timeline. Defaults to "Journey". Used by
   * CoachDashboard to render "Coaching Journey" inline.
   */
  title?: string
}

export default function JourneyTab({
  profileId,
  readOnly = false,
  variant = 'tab',
  title = 'Journey',
}: JourneyTabProps) {
  const { user } = useAuthStore()
  const { addToast } = useToastStore()
  const targetUserId = profileId || user?.id

  const [journey, setJourney] = useState<EditableJourneyEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [activeFormType, setActiveFormType] = useState<'new' | string | null>(null)
  const [activeEntryDraft, setActiveEntryDraft] = useState<EditableJourneyEntry | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [savingEntryId, setSavingEntryId] = useState<string | 'new-entry' | null>(null)
  const [uploadingImageId, setUploadingImageId] = useState<string | null>(null)
  const [activeDraftContext, setActiveDraftContext] = useState<JourneyDraftContext | null>(null)
  const journeyDraftSaveTimeoutRef = useRef<number | null>(null)
  const journeyDraftRestoredRef = useRef(false)

  const canManage = Boolean(!readOnly && user && targetUserId === user.id)

  const persistJourneyDraft = useCallback(
    (draft: EditableJourneyEntry, context: JourneyDraftContext) => {
      if (typeof window === 'undefined' || !user) return
      try {
        const draftKey = getJourneyDraftKey(context, user.id)
        window.localStorage.setItem(draftKey, JSON.stringify(draft))
        window.localStorage.setItem(getJourneyDraftContextKey(user.id), JSON.stringify(context))
      } catch (error) {
        logger.error('Failed to persist journey draft', error)
      }
    },
    [user]
  )

  const clearJourneyDraftStorage = useCallback(
    (contextOverride?: JourneyDraftContext | null) => {
      if (typeof window === 'undefined' || !user) return

      const contextKey = getJourneyDraftContextKey(user.id)
      let storedContext: JourneyDraftContext | null = null
      const rawContext = window.localStorage.getItem(contextKey)
      if (rawContext) {
        try {
          storedContext = JSON.parse(rawContext) as JourneyDraftContext
        } catch {
          storedContext = null
        }
      }

      const targetContext = contextOverride ?? activeDraftContext ?? storedContext
      if (!targetContext) {
        if (!contextOverride && !activeDraftContext) {
          window.localStorage.removeItem(contextKey)
        }
        return
      }

      const draftKey = getJourneyDraftKey(targetContext, user.id)
      window.localStorage.removeItem(draftKey)

      const contextsMatch =
        storedContext?.type === targetContext.type &&
        (targetContext.type === 'new' || (storedContext?.type === 'edit' && storedContext.entryId === targetContext.entryId))

      if (!contextOverride || contextsMatch) {
        window.localStorage.removeItem(contextKey)
      }
    },
    [activeDraftContext, user]
  )

  const resetFormState = (options?: { preserveDraft?: boolean }) => {
    if (!options?.preserveDraft) {
      clearJourneyDraftStorage()
    }
    setActiveFormType(null)
    setActiveEntryDraft(null)
    setActiveDraftContext(null)
    setFormErrors({})
    setUploadingImageId(null)
  }

  const normalizeDate = (value: string | null) => {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.valueOf())) return null
    return parsed.toISOString().split('T')[0]
  }

  const seedDrafts = (dateValue: string | null) => {
    if (!dateValue) return { month: '', year: '' }
    const parsed = new Date(dateValue)
    if (Number.isNaN(parsed.valueOf())) return { month: '', year: '' }
    return {
      month: String(parsed.getUTCMonth()),
      year: String(parsed.getUTCFullYear()),
    }
  }

  const fetchJourney = useCallback(async () => {
    if (!targetUserId) return

    setIsLoading(true)
    try {
      const { data, error } = await supabase
        .from('career_history')
        .select(`
          *,
          world_club:world_clubs!career_history_world_club_id_fkey(
            id, club_name, avatar_url, country_id,
            country:countries(name, flag_emoji),
            men_league:world_leagues!world_clubs_men_league_id_fkey(name, tier),
            women_league:world_leagues!world_clubs_women_league_id_fkey(name, tier)
          )
        `)
        .eq('user_id', targetUserId)
        .order('start_date', { ascending: false, nullsFirst: false })
        .order('display_order', { ascending: false })

      if (error) throw error

      const normalized = (data || []).map(entry => {
        const { badge_label: _unusedBadge, ...rest } = entry
        void _unusedBadge
        const start = normalizeDate(entry.start_date)
        const end = normalizeDate(entry.end_date)
        const startDraft = seedDrafts(start)
        const endDraft = seedDrafts(end)

        return {
          ...rest,
          highlights: entry.highlights ?? [],
          start_date: start,
          end_date: end,
          startMonthDraft: startDraft.month,
          startYearDraft: startDraft.year,
          endMonthDraft: endDraft.month,
          endYearDraft: endDraft.year,
        }
      })

      setJourney(normalized)
    } catch (error) {
      logger.error('Error fetching journey entries:', error)
      addToast('Failed to load Journey timeline.', 'error')
    } finally {
      setIsLoading(false)
    }
  }, [targetUserId, addToast])

  useEffect(() => {
    if (targetUserId) {
      fetchJourney()
    }
  }, [targetUserId, fetchJourney])

  useEffect(() => {
    if (!canManage || !user) return
    if (typeof window === 'undefined') return
    if (journeyDraftRestoredRef.current) return
    if (activeEntryDraft || activeFormType) return

    const contextKey = getJourneyDraftContextKey(user.id)
    const rawContext = window.localStorage.getItem(contextKey)
    if (!rawContext) return

    try {
      const parsedContext = JSON.parse(rawContext) as JourneyDraftContext
      const draftKey = getJourneyDraftKey(parsedContext, user.id)
      const rawDraft = window.localStorage.getItem(draftKey)
      if (!rawDraft) {
        window.localStorage.removeItem(contextKey)
        return
      }

      const parsedDraft = JSON.parse(rawDraft) as EditableJourneyEntry
      setActiveFormType(parsedContext.type === 'new' ? 'new' : parsedContext.entryId)
      setActiveEntryDraft(parsedDraft)
      setActiveDraftContext(parsedContext)
      journeyDraftRestoredRef.current = true
      addToast('Journey draft restored.', 'info')
    } catch (error) {
      logger.error('Failed to restore journey draft', error)
      window.localStorage.removeItem(contextKey)
    }
  }, [activeEntryDraft, activeFormType, addToast, canManage, user])

  useEffect(() => {
    if (!canManage || !user) return
    if (!activeEntryDraft || !activeDraftContext) return
    if (typeof window === 'undefined') return

    if (journeyDraftSaveTimeoutRef.current) {
      window.clearTimeout(journeyDraftSaveTimeoutRef.current)
      journeyDraftSaveTimeoutRef.current = null
    }

    journeyDraftSaveTimeoutRef.current = window.setTimeout(() => {
      persistJourneyDraft(activeEntryDraft, activeDraftContext)
      journeyDraftSaveTimeoutRef.current = null
    }, 600)
  }, [activeDraftContext, activeEntryDraft, canManage, persistJourneyDraft, user])

  useEffect(() => {
    return () => {
      if (journeyDraftSaveTimeoutRef.current && typeof window !== 'undefined') {
        window.clearTimeout(journeyDraftSaveTimeoutRef.current)
        journeyDraftSaveTimeoutRef.current = null
      }
    }
  }, [])

  const startNewEntryForm = () => {
    if (!canManage || !user) {
      addToast('Please sign in to manage your Journey.', 'info')
      return
    }

    setActiveFormType('new')
    setActiveEntryDraft(createEmptyJourneyEntry(user.id))
    setActiveDraftContext({ type: 'new' })
    setFormErrors({})
  }

  const startEditEntry = (entry: EditableJourneyEntry) => {
    if (!canManage || !user) return
    const startDraft = seedDrafts(entry.start_date)
    const endDraft = seedDrafts(entry.end_date)

    let nextDraft: EditableJourneyEntry = {
      ...entry,
      highlights: [...(entry.highlights ?? [])],
      startMonthDraft: startDraft.month,
      startYearDraft: startDraft.year,
      endMonthDraft: endDraft.month,
      endYearDraft: endDraft.year,
      isCurrent: entry.end_date === null,
    }

    if (typeof window !== 'undefined') {
      try {
        const storedDraftKey = getJourneyDraftKey({ type: 'edit', entryId: entry.id }, user.id)
        const storedDraft = window.localStorage.getItem(storedDraftKey)
        if (storedDraft) {
          nextDraft = JSON.parse(storedDraft) as EditableJourneyEntry
        }
      } catch (error) {
        logger.error('Failed to load saved journey draft', error)
      }
    }

    setActiveFormType(entry.id)
    setActiveEntryDraft(nextDraft)
    setActiveDraftContext({ type: 'edit', entryId: entry.id })
    setFormErrors({})
  }

  const mutateActiveDraft = (updater: (entry: EditableJourneyEntry) => EditableJourneyEntry) => {
    setActiveEntryDraft(prev => {
      if (!prev) return prev
      return updater(prev)
    })
  }

  const clearFieldError = (field: string) => {
    if (!formErrors[field]) return
    const next = { ...formErrors }
    delete next[field]
    setFormErrors(next)
  }

  const updateField = <K extends keyof EditableJourneyEntry>(field: K, value: EditableJourneyEntry[K]) => {
    mutateActiveDraft(entry => ({ ...entry, [field]: value }))
    clearFieldError(String(field))
  }

  const updateDraftDate = (kind: 'start' | 'end', part: 'month' | 'year', value: string) => {
    mutateActiveDraft(entry => {
      const monthKey = kind === 'start' ? 'startMonthDraft' : 'endMonthDraft'
      const yearKey = kind === 'start' ? 'startYearDraft' : 'endYearDraft'
      const dateKey = kind === 'start' ? 'start_date' : 'end_date'

      const updated: EditableJourneyEntry = {
        ...entry,
        [monthKey]: part === 'month' ? value : entry[monthKey],
        [yearKey]: part === 'year' ? value : entry[yearKey],
      }

      const month = updated[monthKey]
      const year = updated[yearKey]

      if (month && year) {
        const iso = new Date(Date.UTC(Number(year), Number(month), 1)).toISOString().split('T')[0]
        return { ...updated, [dateKey]: iso }
      }

      return { ...updated, [dateKey]: null }
    })

    if (kind === 'start') {
      clearFieldError('start_date')
    }
  }

  const handleHighlightChange = (highlightIndex: number, text: string) => {
    mutateActiveDraft(entry => {
      const highlights = [...entry.highlights]
      highlights[highlightIndex] = text
      return { ...entry, highlights }
    })
  }

  const addHighlight = () => {
    mutateActiveDraft(entry => ({ ...entry, highlights: [...entry.highlights, ''] }))
  }

  const removeHighlight = (highlightIndex: number) => {
    mutateActiveDraft(entry => ({
      ...entry,
      highlights: entry.highlights.filter((_, idx) => idx !== highlightIndex),
    }))
  }

  const togglePresent = (isPresent: boolean) => {
    mutateActiveDraft(entry => ({
      ...entry,
      isCurrent: isPresent,
      end_date: isPresent ? null : entry.end_date,
      endMonthDraft: isPresent ? '' : entry.endMonthDraft,
      endYearDraft: isPresent ? '' : entry.endYearDraft,
    }))
  }

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) {
      addToast('Please sign in to upload images.', 'info')
      return
    }
    if (!activeEntryDraft) return

    const input = event.target
    const files = input.files
    if (!files?.length) {
      return
    }

    const file = files[0]
    const validation = validateImage(file, { maxFileSizeMB: 5 })
    if (!validation.valid) {
      addToast(validation.error ?? 'Invalid image file.', 'error')
      input.value = ''
      return
    }

    setUploadingImageId(activeEntryDraft.id)

    try {
      const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const optimizedFile = await optimizeImage(file, {
        maxWidth: 800,
        maxHeight: 800,
        maxSizeMB: 1,
        mimeType,
      })

      const extension = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
      const baseName = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const fileName = `${user.id}/journey/${baseName}.${extension}`
      const thumbName = `${user.id}/journey/${baseName}_thumb.${extension}`

      // Upload full image with long-lived cache header
      const { error: uploadError } = await supabase.storage
        .from(JOURNEY_BUCKET)
        .upload(fileName, optimizedFile, { upsert: true, cacheControl: '31536000' })

      if (uploadError) throw uploadError

      // Generate and upload 128px thumbnail (best-effort, non-blocking for save)
      generateThumbnail(file, { size: 128, quality: 0.7, mimeType }).then(async (thumbFile) => {
        const { error: thumbError } = await supabase.storage
          .from(JOURNEY_BUCKET)
          .upload(thumbName, thumbFile, { upsert: true, cacheControl: '31536000' })
        if (thumbError) logger.error('Thumbnail upload failed (non-critical):', thumbError)
      }).catch((err) => logger.error('Thumbnail generation failed (non-critical):', err))

      const { data } = supabase.storage.from(JOURNEY_BUCKET).getPublicUrl(fileName)

      const previousUrl = activeEntryDraft.image_url
      updateField('image_url', data.publicUrl as EditableJourneyEntry['image_url'])

      if (previousUrl && previousUrl !== data.publicUrl) {
        // Clean up old full image + old thumbnail
        await deleteStorageObject({ bucket: JOURNEY_BUCKET, publicUrl: previousUrl, context: 'journey:replace-image' })
        const oldThumbUrl = deriveThumbUrl(previousUrl)
        if (oldThumbUrl !== previousUrl) {
          deleteStorageObject({ bucket: JOURNEY_BUCKET, publicUrl: oldThumbUrl, context: 'journey:replace-thumb' })
        }
      }

      addToast('Image uploaded successfully.', 'success')
    } catch (error) {
      logger.error('Error uploading journey image:', error)
      addToast('We couldn’t upload this image. Please use PNG or JPG up to 5MB.', 'error')
    } finally {
      setUploadingImageId(null)
      input.value = ''
    }
  }

  const handleRemoveImage = async () => {
    if (!activeEntryDraft) return

    if (!activeEntryDraft.image_url) {
      updateField('image_url', null as EditableJourneyEntry['image_url'])
      return
    }

    setUploadingImageId(activeEntryDraft.id)

    try {
      if (activeEntryDraft.image_url) {
        await deleteStorageObject({ bucket: JOURNEY_BUCKET, publicUrl: activeEntryDraft.image_url, context: 'journey:remove-image' })
        // Best-effort thumbnail cleanup
        const thumbUrl = deriveThumbUrl(activeEntryDraft.image_url)
        if (thumbUrl !== activeEntryDraft.image_url) {
          deleteStorageObject({ bucket: JOURNEY_BUCKET, publicUrl: thumbUrl, context: 'journey:remove-thumb' })
        }
      }

      updateField('image_url', null as EditableJourneyEntry['image_url'])
      addToast('Image removed.', 'success')
    } catch (error) {
      logger.error('Error removing journey image:', error)
      addToast('Failed to remove image. Please try again.', 'error')
    } finally {
      setUploadingImageId(null)
    }
  }

  const validateEntry = (entry: EditableJourneyEntry) => {
    const nextErrors: Record<string, string> = {}

    if (!entry.club_name.trim()) {
      nextErrors.club_name = 'Title is required'
    }
    if (!entry.start_date) {
      nextErrors.start_date = 'Start month and year are required'
    }
    if (!entry.entry_type) {
      nextErrors.entry_type = 'Category is required'
    }

    setFormErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const computeDisplayOrder = () => {
    if (!journey.length) return 1
    const maxOrder = Math.max(...journey.map(entry => entry.display_order ?? 0))
    return maxOrder + 1
  }

  const handleSaveActiveEntry = async () => {
    if (!user || !activeEntryDraft || !activeFormType) return
    if (!validateEntry(activeEntryDraft)) return

    const isCreating = activeFormType === 'new'

    const startDate = activeEntryDraft.start_date
    const endDate = activeEntryDraft.isCurrent ? null : activeEntryDraft.end_date
    const entryType = activeEntryDraft.entry_type
    if (!entryType) return

    const yearsText = startDate
      ? `${format(new Date(startDate), 'MMM yyyy')} - ${endDate ? format(new Date(endDate), 'MMM yyyy') : 'Present'}`
      : activeEntryDraft.years

    const payload = {
      user_id: user.id,
      club_name: activeEntryDraft.club_name,
      position_role: activeEntryDraft.position_role,
      division_league: activeEntryDraft.division_league,
      years: yearsText || activeEntryDraft.years,
      highlights: activeEntryDraft.highlights.filter(highlight => highlight.trim() !== ''),
      entry_type: entryType,
      location_city: activeEntryDraft.location_city,
      location_country: activeEntryDraft.location_country,
      start_date: startDate,
      end_date: endDate,
      description: activeEntryDraft.description,
      image_url: activeEntryDraft.image_url,
      world_club_id: entryType === 'club' ? (activeEntryDraft.world_club_id ?? null) : null,
      display_order: isCreating ? computeDisplayOrder() : activeEntryDraft.display_order,
    }

    setSavingEntryId(isCreating ? 'new-entry' : activeEntryDraft.id)

    try {
      if (isCreating) {
        const { error } = await supabase.from('career_history').insert(payload)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('career_history')
          .update(payload)
          .eq('id', activeEntryDraft.id)
        if (error) throw error
      }

      await fetchJourney()
      resetFormState()
      addToast('Journey entry saved.', 'success')
    } catch (error) {
      logger.error('Error saving journey entry:', error)
      addToast('Failed to save journey. Please try again.', 'error')
    } finally {
      setSavingEntryId(null)
    }
  }

  const handleDeleteEntry = async (entryId: string) => {
    if (!canManage || !entryId) return
    if (typeof window !== 'undefined') {
      const confirmDelete = window.confirm('Delete this Journey entry?')
      if (!confirmDelete) {
        return
      }
    }

    const entryToDelete = journey.find(entry => entry.id === entryId)
    const entryImagePath = entryToDelete?.image_url ? extractStoragePath(entryToDelete.image_url, JOURNEY_BUCKET) : null

    setSavingEntryId(entryId)
    try {
      const { error } = await supabase.from('career_history').delete().eq('id', entryId)
      if (error) throw error

      if (entryImagePath) {
        await deleteStorageObject({ bucket: JOURNEY_BUCKET, path: entryImagePath, context: 'journey:delete-entry' })
      }

      clearJourneyDraftStorage({ type: 'edit', entryId })
      await fetchJourney()
      resetFormState()
      addToast('Journey entry removed.', 'success')
    } catch (error) {
      logger.error('Error deleting journey entry:', error)
      addToast('Failed to delete journey entry. Please try again.', 'error')
    } finally {
      setSavingEntryId(null)
    }
  }

  const formatMonthLabel = (value: string | null) => {
    if (!value) return null
    const parsed = new Date(value)
    if (Number.isNaN(parsed.valueOf())) return null
    return format(parsed, 'MMM yyyy')
  }

  const formatDuration = (start: string | null, end: string | null) => {
    if (!start) return null
    const startDate = new Date(start)
    const endDate = end ? new Date(end) : new Date()
    if (Number.isNaN(startDate.valueOf()) || Number.isNaN(endDate.valueOf())) return null
    const totalMonths = differenceInMonths(endDate, startDate)
    if (totalMonths < 0) return null
    const years = Math.floor(totalMonths / 12)
    const months = totalMonths % 12
    const parts: string[] = []
    if (years > 0) {
      parts.push(years > 1 ? `${years} years` : '1 year')
    }
    if (months > 0) {
      parts.push(`${months}m`)
    }
    return parts.length ? parts.join(' ') : 'Less than a month'
  }

  const renderEntryForm = (entry: EditableJourneyEntry, mode: 'new' | 'edit') => {
    const isSaving = savingEntryId === (mode === 'new' ? 'new-entry' : entry.id)

    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            {entry.entry_type === 'club' ? (
              <WorldClubSearch
                id={`journey-title-${entry.id}`}
                value={entry.club_name}
                onChange={v => updateField('club_name', v)}
                onClubSelect={(club: WorldClubSearchResult) => {
                  updateField('club_name', club.club_name)
                  updateField('world_club_id', club.id)
                  if (club.country_name && !entry.location_country)
                    updateField('location_country', club.country_name)
                  const league = club.men_league_name || club.women_league_name
                  if (league && !entry.division_league)
                    updateField('division_league', league)
                }}
                onClubClear={() => updateField('world_club_id', null as unknown as EditableJourneyEntry['world_club_id'])}
                selectedClubId={entry.world_club_id ?? null}
                label="Club Name"
                required
                error={formErrors.club_name}
                placeholder="Amsterdam Hockey Club"
              />
            ) : (
              <>
                <label htmlFor={`journey-title-${entry.id}`} className="text-sm font-medium text-gray-700">
                  Title<span className="text-red-500">*</span>
                </label>
                <input
                  id={`journey-title-${entry.id}`}
                  type="text"
                  value={entry.club_name}
                  onChange={event => updateField('club_name', event.target.value)}
                  className={`mt-1 w-full rounded-lg border px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500 ${formErrors.club_name ? 'border-red-400' : 'border-gray-300'}`}
                  placeholder="Amsterdam Hockey Club"
                />
                {formErrors.club_name && <p className="mt-1 text-sm text-red-600">{formErrors.club_name}</p>}
              </>
            )}
          </div>

          <div>
            <label htmlFor={`journey-category-${entry.id}`} className="text-sm font-medium text-gray-700">
              Category<span className="text-red-500">*</span>
            </label>
            <select
              id={`journey-category-${entry.id}`}
              value={entry.entry_type ?? ''}
              onChange={event => updateField('entry_type', event.target.value ? (event.target.value as JourneyType) : null)}
              className={`mt-1 w-full rounded-lg border bg-white px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500 ${formErrors.entry_type ? 'border-red-400' : 'border-gray-300'}`}
            >
              <option value="" disabled>
                Select category...
              </option>
              {ENTRY_TYPES.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            {formErrors.entry_type && <p className="mt-1 text-sm text-red-600">{formErrors.entry_type}</p>}
          </div>

          <div>
            <label htmlFor={`journey-role-${entry.id}`} className="text-sm font-medium text-gray-700">
              Role
            </label>
            <input
              id={`journey-role-${entry.id}`}
              type="text"
              value={entry.position_role}
              onChange={event => updateField('position_role', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              placeholder="Team captain"
            />
          </div>

          <div>
            <label htmlFor={`journey-context-${entry.id}`} className="text-sm font-medium text-gray-700">
              Competition / Context
            </label>
            <input
              id={`journey-context-${entry.id}`}
              type="text"
              value={entry.division_league}
              onChange={event => updateField('division_league', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              placeholder="Hoofdklasse"
            />
          </div>

          <div>
            <label htmlFor={`journey-city-${entry.id}`} className="text-sm font-medium text-gray-700">
              City
            </label>
            <input
              id={`journey-city-${entry.id}`}
              type="text"
              value={entry.location_city || ''}
              onChange={event => updateField('location_city', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              placeholder="Amsterdam"
            />
          </div>

          <div>
            <label htmlFor={`journey-country-${entry.id}`} className="text-sm font-medium text-gray-700">
              Country
            </label>
            <input
              id={`journey-country-${entry.id}`}
              type="text"
              value={entry.location_country || ''}
              onChange={event => updateField('location_country', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              placeholder="Netherlands"
            />
          </div>

          <div>
            <span className="text-sm font-medium text-gray-700">Start date<span className="text-red-500">*</span></span>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select
                aria-label="Start month"
                value={entry.startMonthDraft ?? ''}
                onChange={event => updateDraftDate('start', 'month', event.target.value)}
                className={`rounded-lg border px-3 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500 ${formErrors.start_date ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Month</option>
                {MONTH_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Start year"
                value={entry.startYearDraft ?? ''}
                onChange={event => updateDraftDate('start', 'year', event.target.value)}
                className={`rounded-lg border px-3 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500 ${formErrors.start_date ? 'border-red-400' : 'border-gray-300'}`}
              >
                <option value="">Year</option>
                {YEAR_OPTIONS.map(year => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            {formErrors.start_date && <p className="mt-1 text-sm text-red-600">{formErrors.start_date}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between text-sm font-medium text-gray-700">
              <span>End date</span>
              <label className="inline-flex items-center gap-2 text-xs font-medium text-gray-500">
                <input
                  type="checkbox"
                  checked={Boolean(entry.isCurrent)}
                  onChange={event => togglePresent(event.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                />
                Present
              </label>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select
                aria-label="End month"
                value={entry.endMonthDraft ?? ''}
                onChange={event => updateDraftDate('end', 'month', event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                disabled={entry.isCurrent}
              >
                <option value="">Month</option>
                {MONTH_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                aria-label="End year"
                value={entry.endYearDraft ?? ''}
                onChange={event => updateDraftDate('end', 'year', event.target.value)}
                className="rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                disabled={entry.isCurrent}
              >
                <option value="">Year</option>
                {YEAR_OPTIONS.map(year => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            {!entry.isCurrent && <p className="mt-1 text-xs text-gray-500">Leave empty to keep it marked as Present.</p>}
          </div>

          <div className="md:col-span-2">
            <label htmlFor={`journey-description-${entry.id}`} className="text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              id={`journey-description-${entry.id}`}
              value={entry.description || ''}
              onChange={event => updateField('description', event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
              rows={3}
              placeholder="Professional player in the Hoofdklasse"
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-sm font-medium text-gray-700">Logo / Image</label>
            <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-start">
              <StorageImage
                src={entry.image_url}
                alt="Journey logo preview"
                className="h-full w-full object-cover"
                containerClassName="h-20 w-20 rounded-xl"
                fallbackClassName="h-20 w-20 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50"
                fallback={<ImageIcon className="h-6 w-6" />}
              />

              <div className="flex flex-col gap-2">
                <label
                  className={`inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition ${uploadingImageId === entry.id ? 'cursor-not-allowed opacity-70' : 'cursor-pointer hover:border-indigo-400 hover:text-indigo-600'}`}
                >
                  {uploadingImageId === entry.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4" />
                      {entry.image_url ? 'Replace image' : 'Upload image'}
                    </>
                  )}
                  <input
                    type="file"
                    accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                    className="sr-only"
                    onChange={handleImageUpload}
                    disabled={uploadingImageId === entry.id}
                  />
                </label>
                {entry.image_url && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="inline-flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-500"
                    disabled={uploadingImageId === entry.id}
                  >
                    <X className="h-4 w-4" />
                    Remove image
                  </button>
                )}
                <p className="text-xs text-gray-500">PNG or JPG, up to 5MB.</p>
              </div>
            </div>
          </div>
        </div>

        <div>
          <label className="text-sm font-medium text-gray-700">Highlights</label>
          <div className="mt-2 space-y-2">
            {entry.highlights.map((highlight, highlightIdx) => (
              <div key={highlightIdx} className="flex gap-2">
                <input
                  type="text"
                  value={highlight}
                  onChange={event => handleHighlightChange(highlightIdx, event.target.value)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  placeholder="Top scorer 2023 season"
                />
                <button
                  type="button"
                  onClick={() => removeHighlight(highlightIdx)}
                  className="rounded-lg border border-gray-200 px-3 text-gray-500 hover:bg-gray-50"
                  aria-label="Remove highlight"
                  title="Remove highlight"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addHighlight}
              className="inline-flex items-center gap-2 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            >
              <Plus className="h-4 w-4" />
              Add highlight
            </button>
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 border-top border-gray-100 pt-4">
          <button
            type="button"
            onClick={() => resetFormState()}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <Button onClick={handleSaveActiveEntry} disabled={isSaving} className="inline-flex items-center gap-2">
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Edit2 className="h-4 w-4" />}
            {isSaving ? 'Saving…' : mode === 'new' ? 'Save Entry' : 'Save Changes'}
          </Button>
        </div>
      </div>
    )
  }

  const renderTimeline = () => {
    if (isLoading) {
      return (
        <div className="space-y-6">
          {Array.from({ length: 3 }).map((_, idx) => (
            <div key={idx} className="flex gap-3 md:gap-4">
              <div className="flex flex-col items-center">
                <div className="h-10 w-10 rounded-full bg-gray-200" />
                <div className="w-px flex-1 bg-gray-200" />
              </div>
              <div className="flex-1 space-y-4 rounded-2xl border border-gray-100 bg-white p-3 sm:p-6">
                <Skeleton height={24} width="55%" />
                <Skeleton height={16} width="35%" />
                <Skeleton height={80} width="100%" />
              </div>
            </div>
          ))}
        </div>
      )
    }

    const ordered = [...journey].sort((a, b) => {
      const aTime = a.start_date ? new Date(a.start_date).valueOf() : 0
      const bTime = b.start_date ? new Date(b.start_date).valueOf() : 0
      if (aTime === bTime) {
        return (b.display_order ?? 0) - (a.display_order ?? 0)
      }
      return bTime - aTime
    })

    const showEmptyState = ordered.length === 0 && activeFormType !== 'new'
    const isEditingExistingEntry = Boolean(activeFormType && activeFormType !== 'new')

    return (
      <div className="space-y-6">
        {!readOnly && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            {activeFormType === 'new' && activeEntryDraft ? (
              <div className="space-y-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-indigo-600">New journey entry</p>
                    <h3 className="text-xl font-semibold text-gray-900">Share a new milestone</h3>
                    <p className="text-sm text-gray-500">Fill out the form below to add it to your journey.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetFormState()}
                    className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    <X className="h-4 w-4" />
                    Cancel
                  </button>
                </div>
                {renderEntryForm(activeEntryDraft, 'new')}
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-indigo-600">Journey timeline</p>
                    <h3 className="text-xl font-semibold text-gray-900">Add a new entry</h3>
                    <p className="text-sm text-gray-500">Highlight a club, tournament, camp, or other milestone.</p>
                  </div>
                  <Button
                    onClick={startNewEntryForm}
                    disabled={isEditingExistingEntry}
                    className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Plus className="h-4 w-4" />
                    Add Journey Entry
                  </Button>
                </div>
                {isEditingExistingEntry && (
                  <p className="mt-2 text-xs text-gray-500">Finish editing your current entry to add another.</p>
                )}
              </>
            )}
          </div>
        )}

        {showEmptyState ? (
          <div className="rounded-2xl border-2 border-dashed border-gray-200 p-10 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Sparkles className="h-7 w-7" />
            </div>
            <h3 className="mb-2 text-xl font-semibold text-gray-900">No Journey entries yet</h3>
            <p className="mb-6 text-gray-600">
              {readOnly
                ? 'This profile has not shared any Journey milestones yet.'
                : 'Capture your biggest milestones so clubs and coaches can understand your path.'}
            </p>
            {!readOnly && (
              <Button onClick={startNewEntryForm} className="inline-flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Add Journey Entry
              </Button>
            )}
          </div>
        ) : (
          <div className="relative">
            {/* Continuous vertical timeline line */}
            <div className="pointer-events-none absolute left-5 top-5 bottom-5 w-0.5 bg-gradient-to-b from-indigo-200 via-gray-200 to-gray-100 md:left-6" />
            
            <div className="space-y-6">
              {ordered.map((entry, entryIndex) => {
                const meta = entry.entry_type ? entryTypeMeta[entry.entry_type] : entryTypeMeta.club
                const Icon = meta.icon
                const startLabel = formatMonthLabel(entry.start_date)
                const endLabel = entry.end_date ? formatMonthLabel(entry.end_date) : 'Present'
                const durationLabel = formatDuration(entry.start_date, entry.end_date)
                // world_club comes from the Supabase join and isn't in the base type
                const worldClub = (entry as Record<string, unknown>).world_club as { avatar_url?: string | null } | null | undefined
                const location = [entry.location_city, entry.location_country]
                  .filter(Boolean)
                  .join(', ')
                const isEditingEntry = activeFormType === entry.id && Boolean(activeEntryDraft)

                return (
                  <div key={entry.id} className="relative flex gap-3 md:gap-5">
                    {/* Timeline anchor icon */}
                    <div className="relative z-10 flex-shrink-0">
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-full shadow-sm ring-4 ring-white ${meta.dotClass} md:h-12 md:w-12`}
                      >
                        <Icon className="h-4 w-4 md:h-5 md:w-5" />
                      </div>
                    </div>

                    {/* Entry card */}
                    <div className="flex-1 min-w-0 pb-2">
                      {isEditingEntry && activeEntryDraft ? (
                        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm sm:p-4">
                          {renderEntryForm(activeEntryDraft, 'edit')}
                        </div>
                      ) : (
                        <div className="group relative rounded-xl border border-gray-100 bg-white p-3 transition-shadow hover:shadow-md sm:p-4">
                          {/* Action icons — absolutely positioned so they don't consume text width */}
                          {!readOnly && (
                            <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-lg bg-white/90 opacity-0 shadow-sm backdrop-blur-sm transition-opacity group-hover:opacity-100">
                              <button
                                type="button"
                                onClick={() => startEditEntry(entry)}
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                                title="Edit entry"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteEntry(entry.id)}
                                className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-500"
                                title="Delete entry"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          )}

                          {/* Header row: Logo + Title */}
                          <div className="flex items-start gap-2.5 sm:gap-3">
                            {/* Club/Event logo — prefer world club avatar when linked */}
                            <StorageImage
                              src={
                                worldClub?.avatar_url
                                  ? worldClub.avatar_url
                                  : entry.image_url
                                    ? deriveThumbUrl(entry.image_url)
                                    : null
                              }
                              fallbackSrc={entry.image_url}
                              alt="Journey logo"
                              className="h-full w-full object-cover rounded-xl"
                              containerClassName="h-10 w-10 min-w-[2.5rem] rounded-xl sm:h-12 sm:w-12 sm:min-w-[3rem]"
                              fallbackClassName="h-10 w-10 rounded-xl bg-gray-50 sm:h-12 sm:w-12"
                              fallback={<ImageIcon className="h-4 w-4 text-gray-300" />}
                              fetchPriority={entryIndex < 3 ? 'high' : undefined}
                            />

                            {/* Title & context */}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold leading-snug text-gray-900">{entry.club_name}</h3>
                              {location && (
                                <p className="mt-0.5 text-sm leading-normal text-gray-500">{location}</p>
                              )}
                              {(entry.position_role || entry.division_league) && (
                                <p className="text-sm leading-normal text-gray-500">
                                  {[entry.position_role, entry.division_league].filter(Boolean).join(' · ')}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Meta row: Badge + Dates + Duration */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-gray-500 sm:mt-3 sm:gap-2">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${meta.badgeClass}`}>
                              {meta.label}
                            </span>
                            {(startLabel || entry.years) && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3 w-3" />
                                  {startLabel || entry.years}
                                  {startLabel && ` – ${endLabel}`}
                                </span>
                              </>
                            )}
                            {durationLabel && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span>{durationLabel}</span>
                              </>
                            )}
                            {worldClub && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                                  <Globe2 className="h-3 w-3" />
                                  Directory
                                </span>
                              </>
                            )}
                          </div>

                          {/* Description */}
                          {entry.description?.trim() && (
                            <p className="mt-3 text-sm leading-relaxed text-gray-600">{entry.description}</p>
                          )}

                          {/* Highlights */}
                          {entry.highlights.length > 0 && (
                            <ul className="mt-3 space-y-1">
                              {entry.highlights.map((highlight, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                                  <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-gray-300" />
                                  <span>{highlight}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!readOnly && ordered.length > 0 && activeFormType !== 'new' && (
          <div className="pt-2 text-center">
            <Button
              onClick={startNewEntryForm}
              disabled={Boolean(activeFormType)}
              className="inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="h-4 w-4" />
              Add Journey Entry
            </Button>
          </div>
        )}
      </div>
    )
  }


  // Inline variant on a public profile with no entries: render nothing
  // so anonymous viewers don't see an "empty Journey" placeholder.
  // Owner viewing their own profile (`!readOnly`) still gets the empty
  // state with the Add CTA via the tab variant — they see this in the
  // Journey tab on their dashboard.
  if (variant === 'inline' && readOnly && !isLoading && journey.length === 0) {
    return null
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
          {variant === 'tab' && (
            <p className="text-sm text-gray-600">Showcase the clubs, teams, and milestones that shaped your path.</p>
          )}
        </div>
        {!readOnly && (
          <p className="text-sm text-gray-500">Updates save automatically.</p>
        )}
      </div>

      {renderTimeline()}
    </div>
  )
}
