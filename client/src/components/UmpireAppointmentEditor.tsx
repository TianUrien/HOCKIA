/**
 * UmpireAppointmentEditor
 *
 * Add / edit modal for an umpire_appointments row. Phase F2 expanded the
 * table from match-only appointments to a richer officiating journey that
 * mixes appointments, milestones, certifications, and panel inductions —
 * the editor now switches field visibility + labels based on entry_type.
 *
 * Owner-only: RLS rejects the mutation if auth.uid() ≠ user_id.
 */

import { useEffect, useRef, useState } from 'react'
import { Trans } from 'react-i18next'
import { Calendar as CalendarIcon, ImagePlus, Loader2, Shield, Trophy, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
import { useProfileEditT } from '@/i18n/ns/profileEdit'

// Proper names of hockey bodies, the same in every language.
const ORGANIZER_EXAMPLE_APPOINTMENT = 'EuroHockey · FIH · England Hockey'
const ORGANIZER_EXAMPLE_OTHER = 'FIH · USA Field Hockey · EuroHockey'
import type {
  UmpireAppointment,
  UmpireAppointmentInput,
} from '@/hooks/useUmpireAppointments'

const JOURNEY_BUCKET = 'journey'
const UMPIRE_PATH_PREFIX = 'umpire'

type EntryType = 'appointment' | 'milestone' | 'certification' | 'panel'

interface EntryTypeMeta {
  value: EntryType
  label: string
  icon: LucideIcon
  hint: string
  fields: {
    event_name: string
    organizer: string
    start_date: string
    /** Only rendered when `showEndDate` is true (appointments only). */
    end_date?: string
  }
  showEndDate: boolean
  showMatchDetails: boolean
  showLocation: boolean
  addTitle: string
  editTitle: string
  namePlaceholder: string
  notesPlaceholder: string
}

type ProfileEditT = ReturnType<typeof useProfileEditT>

/** Built at render time so the copy follows the interface language. */
const getEntryTypes = (t: ProfileEditT): EntryTypeMeta[] => [
  {
    value: 'appointment',
    label: t('umpireEntryTypes.appointmentLabel'),
    icon: CalendarIcon,
    hint: t('umpireEntryTypes.appointmentHint'),
    fields: {
      event_name: t('umpireEntryTypes.appointmentEventName'),
      organizer: t('umpireEntryTypes.appointmentOrganizer'),
      start_date: t('umpireEntryTypes.appointmentStartDate'),
      end_date: t('umpireEntryTypes.appointmentEndDate'),
    },
    showEndDate: true,
    showMatchDetails: true,
    showLocation: true,
    addTitle: t('umpireEntryTypes.appointmentAdd'),
    editTitle: t('umpireEntryTypes.appointmentEdit'),
    // Event name: a proper noun, not translated.
    namePlaceholder: 'EuroHockey Junior Championship 2026',
    notesPlaceholder: t('umpireEntryTypes.appointmentNotesPlaceholder'),
  },
  {
    value: 'milestone',
    label: t('umpireEntryTypes.milestoneLabel'),
    icon: Trophy,
    hint: t('umpireEntryTypes.milestoneHint'),
    fields: {
      event_name: t('umpireEntryTypes.milestoneEventName'),
      organizer: t('umpireEntryTypes.milestoneOrganizer'),
      start_date: t('umpireEntryTypes.milestoneStartDate'),
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: true,
    addTitle: t('umpireEntryTypes.milestoneAdd'),
    editTitle: t('umpireEntryTypes.milestoneEdit'),
    namePlaceholder: t('umpireEntryTypes.milestoneNamePlaceholder'),
    notesPlaceholder: t('umpireEntryTypes.milestoneNotesPlaceholder'),
  },
  {
    value: 'certification',
    label: t('umpireEntryTypes.certificationLabel'),
    icon: Shield,
    hint: t('umpireEntryTypes.certificationHint'),
    fields: {
      event_name: t('umpireEntryTypes.certificationEventName'),
      organizer: t('umpireEntryTypes.certificationOrganizer'),
      start_date: t('umpireEntryTypes.certificationStartDate'),
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: false,
    addTitle: t('umpireEntryTypes.certificationAdd'),
    editTitle: t('umpireEntryTypes.certificationEdit'),
    namePlaceholder: t('umpireEntryTypes.certificationNamePlaceholder'),
    notesPlaceholder: t('umpireEntryTypes.certificationNotesPlaceholder'),
  },
  {
    value: 'panel',
    label: t('umpireEntryTypes.panelLabel'),
    icon: Users,
    hint: t('umpireEntryTypes.panelHint'),
    fields: {
      event_name: t('umpireEntryTypes.panelEventName'),
      organizer: t('umpireEntryTypes.panelOrganizer'),
      start_date: t('umpireEntryTypes.panelStartDate'),
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: false,
    addTitle: t('umpireEntryTypes.panelAdd'),
    editTitle: t('umpireEntryTypes.panelEdit'),
    // Panel name: a proper noun, not translated.
    namePlaceholder: 'FIH World Panel',
    notesPlaceholder: t('umpireEntryTypes.panelNotesPlaceholder'),
  },
]

type MatchFormat = '' | 'outdoor_11v11' | 'indoor_5v5' | 'hockey5s' | 'other'

const getMatchFormats = (t: ProfileEditT): Array<{ value: MatchFormat; label: string }> => [
  { value: '', label: t('umpireMatchFormats.notSpecified') },
  { value: 'outdoor_11v11', label: t('umpireMatchFormats.outdoor') },
  { value: 'hockey5s', label: 'Hockey5s' },
  { value: 'indoor_5v5', label: t('umpireMatchFormats.indoor') },
  { value: 'other', label: t('umpireMatchFormats.other') },
]

interface UmpireAppointmentEditorProps {
  isOpen: boolean
  appointment: UmpireAppointment | null
  onClose: () => void
  onSave: (input: UmpireAppointmentInput, id?: string) => Promise<unknown>
}

interface FormState {
  entry_type: EntryType
  event_name: string
  organizer: string
  match_level: string
  match_format: MatchFormat
  location_city: string
  location_country: string
  start_date: string
  end_date: string
  description: string
}

const emptyForm = (): FormState => ({
  entry_type: 'appointment',
  event_name: '',
  organizer: '',
  match_level: '',
  match_format: '',
  location_city: '',
  location_country: '',
  start_date: '',
  end_date: '',
  description: '',
})

const seedForm = (appointment: UmpireAppointment | null): FormState => {
  if (!appointment) return emptyForm()
  return {
    entry_type: (appointment.entry_type as EntryType) ?? 'appointment',
    event_name: appointment.event_name ?? '',
    organizer: appointment.organizer ?? '',
    match_level: appointment.match_level ?? '',
    match_format: (appointment.match_format as FormState['match_format']) ?? '',
    location_city: appointment.location_city ?? '',
    location_country: appointment.location_country ?? '',
    start_date: appointment.start_date ?? '',
    end_date: appointment.end_date ?? '',
    description: appointment.description ?? '',
  }
}

export default function UmpireAppointmentEditor({
  isOpen,
  appointment,
  onClose,
  onSave,
}: UmpireAppointmentEditorProps) {
  const t = useProfileEditT()
  const userId = useAuthStore((state) => state.user?.id ?? null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(appointment?.image_url ?? null)
  const [uploading, setUploading] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(seedForm(appointment))
      setImageUrl(appointment?.image_url ?? null)
      setError(null)
      setImageError(null)
      setSubmitting(false)
      setUploading(false)
    }
  }, [isOpen, appointment])

  if (!isOpen) return null

  const entryTypes = getEntryTypes(t)
  const meta = entryTypes.find((m) => m.value === form.entry_type) ?? entryTypes[0]
  const optional = (label: string) => (
    <Trans t={t} i18nKey="umpireEditor.optionalField" values={{ label }} components={{ muted: <span className="text-gray-400 font-normal" /> }} />
  )

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file || !userId) return

    setImageError(null)
    const validation = validateImage(file, { maxFileSizeMB: 5 })
    if (!validation.valid) {
      setImageError(validation.error ?? t('umpireEditor.invalidImage'))
      return
    }

    setUploading(true)
    try {
      const optimized = await optimizeImage(file, {
        maxWidth: 1600,
        maxHeight: 1200,
        maxSizeMB: 1,
      })
      const ts = Date.now()
      const rand = Math.random().toString(36).slice(2, 10)
      const ext = (optimized.name.split('.').pop() || 'jpg').toLowerCase()
      const path = `${userId}/${UMPIRE_PATH_PREFIX}/${ts}_${rand}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(JOURNEY_BUCKET)
        .upload(path, optimized, { cacheControl: '31536000', upsert: false })

      if (uploadError) throw uploadError

      const { data } = supabase.storage.from(JOURNEY_BUCKET).getPublicUrl(path)
      setImageUrl(data.publicUrl)
    } catch (err) {
      logger.error('[UmpireAppointmentEditor] image upload failed:', err)
      setImageError(t('umpireEditor.uploadFailed'))
    } finally {
      setUploading(false)
    }
  }

  const handleRemoveImage = () => {
    setImageUrl(null)
  }

  const trimmed = {
    ...form,
    event_name: form.event_name.trim(),
    organizer: form.organizer.trim(),
    match_level: form.match_level.trim(),
    location_city: form.location_city.trim(),
    location_country: form.location_country.trim(),
    description: form.description.trim(),
  }

  const dateOrderOk =
    !meta.showEndDate ||
    !trimmed.start_date ||
    !trimmed.end_date ||
    trimmed.end_date >= trimmed.start_date

  const canSubmit = !submitting && !uploading && trimmed.event_name.length > 0 && dateOrderOk

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const input: UmpireAppointmentInput = {
        entry_type: form.entry_type,
        event_name: trimmed.event_name,
        organizer: trimmed.organizer || null,
        // Match-only fields: only send when actually relevant to the entry
        // type. Milestones / certifications / panels clear these columns so
        // they don't carry stale values from a previous edit as appointment.
        match_level: meta.showMatchDetails ? trimmed.match_level || null : null,
        match_format: meta.showMatchDetails ? trimmed.match_format || null : null,
        location_city: meta.showLocation ? trimmed.location_city || null : null,
        location_country: meta.showLocation ? trimmed.location_country || null : null,
        start_date: trimmed.start_date || null,
        end_date: meta.showEndDate ? trimmed.end_date || null : null,
        description: trimmed.description || null,
        image_url: imageUrl,
      }
      const result = await onSave(input, appointment?.id)
      if (result === null) {
        setError(t('umpireEditor.saveFailed'))
        setSubmitting(false)
        return
      }

      // Best-effort orphan cleanup when the saved image replaced an old one.
      const originalUrl = appointment?.image_url ?? null
      if (originalUrl && originalUrl !== imageUrl) {
        void deleteStorageObject({
          bucket: JOURNEY_BUCKET,
          publicUrl: originalUrl,
          context: 'umpire-appointment-replace',
        })
      }

      onClose()
    } catch (err) {
      logger.error('[UmpireAppointmentEditor] save failed:', err)
      setError(err instanceof Error ? err.message : t('umpireEditor.saveEntryFailed'))
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting || uploading) return

    // Clean up an unsaved uploaded image if the user is cancelling.
    const originalUrl = appointment?.image_url ?? null
    if (imageUrl && imageUrl !== originalUrl) {
      void deleteStorageObject({
        bucket: JOURNEY_BUCKET,
        publicUrl: imageUrl,
        context: 'umpire-appointment-cancel',
      })
    }

    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={handleClose}
      />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 p-1 rounded-lg hover:bg-gray-100 transition-colors"
            disabled={submitting}
            aria-label={t('umpireEditor.closeLabel')}
            title={t('umpireEditor.closeTitle')}
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>

          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            {appointment ? meta.editTitle : meta.addTitle}
          </h2>
          <p className="text-sm text-gray-500 mb-5">{meta.hint}</p>

          {/* Entry-type selector — disabled during edit to avoid schema
              churn on a row that's already persisted with specific fields. */}
          <div className="mb-5">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {t('umpireEditor.entryType')}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {entryTypes.map((type) => {
                const Icon = type.icon
                const active = form.entry_type === type.value
                const locked = Boolean(appointment) && !active
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => !locked && setForm({ ...form, entry_type: type.value })}
                    disabled={locked || submitting}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                      active
                        ? 'border-hockia-primary bg-hockia-primary/5 text-hockia-primary'
                        : locked
                          ? 'border-gray-100 bg-gray-50 text-gray-500 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                    title={locked ? t('umpireEditor.lockedType') : type.label}
                  >
                    <Icon className="w-4 h-4" />
                    {type.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {optional(t('umpireEditor.photo'))}
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                disabled={uploading || submitting}
                aria-label={t('umpireEditor.uploadPhotoLabel')}
              />
              {imageUrl ? (
                <div className="relative group">
                  <img
                    src={imageUrl}
                    alt={t('umpireEditor.photoAlt')}
                    className="w-full h-40 object-cover rounded-lg border border-gray-200"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
                      disabled={uploading || submitting}
                    >
                      {t('umpireEditor.replacePhoto')}
                    </button>
                    <span className="text-gray-500">·</span>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="text-xs font-medium text-red-600 hover:text-red-700 underline"
                      disabled={uploading || submitting}
                    >
                      {t('umpireEditor.removePhoto')}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || submitting || !userId}
                  className="w-full flex items-center justify-center gap-2 px-3 py-6 text-sm font-medium text-gray-600 border-2 border-dashed border-gray-200 rounded-lg hover:border-purple-300 hover:bg-purple-50/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('umpireEditor.uploading')}
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4" />
                      {t('umpireEditor.addPhoto')}
                    </>
                  )}
                </button>
              )}
              {imageError && <p className="text-xs text-red-600 mt-2">{imageError}</p>}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {meta.fields.event_name} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.event_name}
                onChange={(e) => setForm({ ...form, event_name: e.target.value })}
                placeholder={meta.namePlaceholder}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                disabled={submitting}
                autoFocus
                maxLength={160}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {optional(meta.fields.organizer)}
              </label>
              <input
                type="text"
                value={form.organizer}
                onChange={(e) => setForm({ ...form, organizer: e.target.value })}
                placeholder={meta.value === 'appointment' ? ORGANIZER_EXAMPLE_APPOINTMENT : ORGANIZER_EXAMPLE_OTHER}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                disabled={submitting}
                maxLength={120}
              />
            </div>

            {meta.showMatchDetails && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {optional(t('umpireEditor.matchLevel'))}
                  </label>
                  <input
                    type="text"
                    value={form.match_level}
                    onChange={(e) => setForm({ ...form, match_level: e.target.value })}
                    placeholder={t('umpireEditor.matchLevelPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t('umpireEditor.format')}
                  </label>
                  <select
                    value={form.match_format}
                    onChange={(e) =>
                      setForm({ ...form, match_format: e.target.value as MatchFormat })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent bg-white"
                    disabled={submitting}
                    aria-label={t('umpireEditor.formatLabel')}
                  >
                    {getMatchFormats(t).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {meta.showLocation && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {optional(t('umpireEditor.city'))}
                  </label>
                  <input
                    type="text"
                    value={form.location_city}
                    onChange={(e) => setForm({ ...form, location_city: e.target.value })}
                    placeholder={t('umpireEditor.cityPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {optional(t('umpireEditor.country'))}
                  </label>
                  <input
                    type="text"
                    value={form.location_country}
                    onChange={(e) => setForm({ ...form, location_country: e.target.value })}
                    placeholder={t('umpireEditor.countryPlaceholder')}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    maxLength={80}
                  />
                </div>
              </div>
            )}

            <div className={`grid grid-cols-1 ${meta.showEndDate ? 'sm:grid-cols-2' : ''} gap-3`}>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {meta.fields.start_date}
                </label>
                <input
                  type="date"
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                  disabled={submitting}
                  aria-label={meta.fields.start_date}
                />
              </div>
              {meta.showEndDate && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {meta.fields.end_date}
                  </label>
                  <input
                    type="date"
                    value={form.end_date}
                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    aria-label={meta.fields.end_date ?? t('umpireEditor.endDateFallback')}
                  />
                </div>
              )}
            </div>
            {meta.showEndDate && !dateOrderOk && (
              <p className="text-xs text-red-600">{t('umpireEditor.dateOrder')}</p>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {optional(t('umpireEditor.notes'))}
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={meta.notesPlaceholder}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus-visible:ring-2 focus-visible:ring-purple-500 focus:border-transparent resize-none"
                disabled={submitting}
                maxLength={600}
              />
            </div>
          </div>

          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          <div className="flex gap-3 mt-6">
            <button
              onClick={handleClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={submitting}
            >
              {t('umpireEditor.cancel')}
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {t('umpireEditor.saving')}
                </span>
              ) : appointment ? (
                t('umpireEditor.saveChanges')
              ) : (
                t('umpireEditor.addEntry')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
