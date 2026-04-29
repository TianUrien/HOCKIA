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
import { Calendar as CalendarIcon, ImagePlus, Loader2, Shield, Trophy, Users, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { logger } from '@/lib/logger'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { optimizeImage, validateImage } from '@/lib/imageOptimization'
import { deleteStorageObject } from '@/lib/storage'
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
}

const ENTRY_TYPES: EntryTypeMeta[] = [
  {
    value: 'appointment',
    label: 'Appointment',
    icon: CalendarIcon,
    hint: 'A match, tournament, or event you officiated.',
    fields: {
      event_name: 'Event name',
      organizer: 'Organizer',
      start_date: 'Start date',
      end_date: 'End date',
    },
    showEndDate: true,
    showMatchDetails: true,
    showLocation: true,
    addTitle: 'Add an appointment',
    editTitle: 'Edit appointment',
  },
  {
    value: 'milestone',
    label: 'Milestone',
    icon: Trophy,
    hint: 'A career milestone — first international, 100th match, award.',
    fields: {
      event_name: 'Title',
      organizer: 'Sanctioning body',
      start_date: 'Date',
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: true,
    addTitle: 'Add a milestone',
    editTitle: 'Edit milestone',
  },
  {
    value: 'certification',
    label: 'Certification',
    icon: Shield,
    hint: 'A credential you earned or renewed.',
    fields: {
      event_name: 'Certification',
      organizer: 'Issuing body',
      start_date: 'Earned on',
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: false,
    addTitle: 'Add a certification',
    editTitle: 'Edit certification',
  },
  {
    value: 'panel',
    label: 'Panel',
    icon: Users,
    hint: 'A panel or official board you joined.',
    fields: {
      event_name: 'Panel name',
      organizer: 'Federation',
      start_date: 'Inducted on',
    },
    showEndDate: false,
    showMatchDetails: false,
    showLocation: false,
    addTitle: 'Add a panel entry',
    editTitle: 'Edit panel entry',
  },
]

const metaFor = (type: EntryType): EntryTypeMeta =>
  ENTRY_TYPES.find((m) => m.value === type) ?? ENTRY_TYPES[0]

const MATCH_FORMATS: Array<{ value: '' | 'outdoor_11v11' | 'indoor_5v5' | 'hockey5s' | 'other'; label: string }> = [
  { value: '', label: 'Not specified' },
  { value: 'outdoor_11v11', label: 'Outdoor 11v11' },
  { value: 'hockey5s', label: 'Hockey5s' },
  { value: 'indoor_5v5', label: 'Indoor' },
  { value: 'other', label: 'Other' },
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
  match_format: '' | 'outdoor_11v11' | 'indoor_5v5' | 'hockey5s' | 'other'
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

  const meta = metaFor(form.entry_type)

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file || !userId) return

    setImageError(null)
    const validation = validateImage(file, { maxFileSizeMB: 5 })
    if (!validation.valid) {
      setImageError(validation.error ?? 'Invalid image')
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
      setImageError('Upload failed. Please try another image.')
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
        setError('Could not save. Please try again.')
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
      setError(err instanceof Error ? err.message : 'Could not save entry')
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
            aria-label="Close editor"
            title="Close"
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
              Entry type
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {ENTRY_TYPES.map((t) => {
                const Icon = t.icon
                const active = form.entry_type === t.value
                const locked = Boolean(appointment) && !active
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => !locked && setForm({ ...form, entry_type: t.value })}
                    disabled={locked || submitting}
                    className={`flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-xs font-medium transition-colors ${
                      active
                        ? 'border-[#8026FA] bg-[#8026FA]/5 text-[#8026FA]'
                        : locked
                          ? 'border-gray-100 bg-gray-50 text-gray-300 cursor-not-allowed'
                          : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
                    }`}
                    title={locked ? 'Create a new entry to change its type' : t.label}
                  >
                    <Icon className="w-4 h-4" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Photo <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                disabled={uploading || submitting}
                aria-label="Upload entry photo"
              />
              {imageUrl ? (
                <div className="relative group">
                  <img
                    src={imageUrl}
                    alt="Entry"
                    className="w-full h-40 object-cover rounded-lg border border-gray-200"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-xs font-medium text-gray-600 hover:text-gray-900 underline"
                      disabled={uploading || submitting}
                    >
                      Replace
                    </button>
                    <span className="text-gray-300">·</span>
                    <button
                      type="button"
                      onClick={handleRemoveImage}
                      className="text-xs font-medium text-red-600 hover:text-red-700 underline"
                      disabled={uploading || submitting}
                    >
                      Remove
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
                      Uploading…
                    </>
                  ) : (
                    <>
                      <ImagePlus className="w-4 h-4" />
                      Add a photo
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
                placeholder={
                  meta.value === 'appointment' ? 'EuroHockey Junior Championship 2026' :
                  meta.value === 'milestone' ? 'First international appointment' :
                  meta.value === 'certification' ? 'FIH Level 2' :
                  'FIH World Panel'
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={submitting}
                autoFocus
                maxLength={160}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {meta.fields.organizer} <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.organizer}
                onChange={(e) => setForm({ ...form, organizer: e.target.value })}
                placeholder={
                  meta.value === 'appointment' ? 'EuroHockey · FIH · England Hockey' :
                  'FIH · USA Field Hockey · EuroHockey'
                }
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                disabled={submitting}
                maxLength={120}
              />
            </div>

            {meta.showMatchDetails && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Match level <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.match_level}
                    onChange={(e) => setForm({ ...form, match_level: e.target.value })}
                    placeholder="U21 International · National League"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Format
                  </label>
                  <select
                    value={form.match_format}
                    onChange={(e) =>
                      setForm({ ...form, match_format: e.target.value as FormState['match_format'] })
                    }
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                    disabled={submitting}
                    aria-label="Match format"
                  >
                    {MATCH_FORMATS.map((o) => (
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
                    City, State/Province <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.location_city}
                    onChange={(e) => setForm({ ...form, location_city: e.target.value })}
                    placeholder="e.g., Port Jervis, NY"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    maxLength={80}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Country <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={form.location_country}
                    onChange={(e) => setForm({ ...form, location_country: e.target.value })}
                    placeholder="Netherlands"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
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
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={submitting}
                    aria-label={meta.fields.end_date ?? 'End date'}
                  />
                </div>
              )}
            </div>
            {meta.showEndDate && !dateOrderOk && (
              <p className="text-xs text-red-600">End date can't be before start date.</p>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder={
                  meta.value === 'appointment'
                    ? "What did you officiate — final, pool stage, specific matches?"
                    : meta.value === 'milestone'
                      ? 'What made this milestone memorable?'
                      : meta.value === 'certification'
                        ? 'Anything worth noting — exam details, assessors, score?'
                        : 'Panel duties, tenure, role on the board?'
                }
                rows={3}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
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
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 px-4 py-2 text-sm font-medium text-white rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Saving...
                </span>
              ) : appointment ? (
                'Save changes'
              ) : (
                'Add entry'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
