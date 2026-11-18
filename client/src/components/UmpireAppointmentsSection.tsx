/**
 * UmpireAppointmentsSection — Officiating Journey
 *
 * Phase F2: the section now renders a journey that mixes match-level
 * appointments with career narrative (milestones, certifications earned,
 * panel inductions). Each card is color-coded by entry_type so the
 * timeline reads as "what this umpire has done and where they stand".
 *
 * Owner sees an "Add" button (opens the type-aware editor) plus edit /
 * delete controls per card. Public viewers see a read-only list; when
 * the list is empty we render a tab-appropriate empty state (this lives
 * inside a tab panel — returning null would leave a blank white card
 * and make the whole tab look broken).
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Award,
  Building2,
  Calendar as CalendarIcon,
  Edit2,
  MapPin,
  Plus,
  Shield,
  Trash2,
  Trophy,
  Users,
} from 'lucide-react'
import {
  useUmpireAppointments,
  type UmpireAppointment,
  type UmpireAppointmentInput,
} from '@/hooks/useUmpireAppointments'
import { deleteStorageObject } from '@/lib/storage'
import { dayFirst } from '@/lib/dayFirst'
import { useProfileEditT } from '@/i18n/ns/profileEdit'
import UmpireAppointmentEditor from './UmpireAppointmentEditor'
import { countryLabel } from '@/i18n/countryNames'

const JOURNEY_BUCKET = 'journey'

interface UmpireAppointmentsSectionProps {
  userId: string
  readOnly?: boolean
  /** True when the viewer is the profile owner seeing their own public/network
   * view in readOnly mode. Swaps the empty-state copy from a neutral
   * "this umpire hasn't logged anything" to a self-directed nudge. */
  isOwnProfile?: boolean
  /** Open the "Add" editor on arrival (Hockia AI "Add my latest match"). Owner only. */
  startAdding?: boolean
}

type ProfileEditT = ReturnType<typeof useProfileEditT>

/** Built at render time so the copy follows the interface language. */
const getMatchFormatLabels = (t: ProfileEditT): Record<string, string> => ({
  outdoor_11v11: t('umpireSection.formatOutdoor'),
  hockey5s: 'Hockey5s',
  indoor_5v5: t('umpireSection.formatIndoor'),
  other: t('umpireSection.formatOther'),
})

type EntryTypeKey = 'appointment' | 'milestone' | 'certification' | 'panel'

interface EntryTypeVisual {
  label: string
  Icon: LucideIcon
  badgeClass: string
  borderClass: string
}

const getEntryTypeVisuals = (t: ProfileEditT): Record<EntryTypeKey, EntryTypeVisual> => ({
  appointment: {
    label: t('umpireSection.typeAppointment'),
    Icon: CalendarIcon,
    badgeClass: 'bg-emerald-50 text-emerald-800',
    borderClass: 'border-l-emerald-400',
  },
  milestone: {
    label: t('umpireSection.typeMilestone'),
    Icon: Trophy,
    badgeClass: 'bg-purple-50 text-hockia-primary',
    borderClass: 'border-l-hockia-primary',
  },
  certification: {
    label: t('umpireSection.typeCertification'),
    Icon: Shield,
    badgeClass: 'bg-surface-grouped text-ink-2',
    borderClass: 'border-l-ink-4',
  },
  panel: {
    label: t('umpireSection.typePanel'),
    Icon: Users,
    badgeClass: 'bg-surface-muted text-ink-2',
    borderClass: 'border-l-line-strong',
  },
})

const visualFor = (
  visuals: Record<EntryTypeKey, EntryTypeVisual>,
  raw: string | null | undefined,
): EntryTypeVisual => {
  if (raw && raw in visuals) {
    return visuals[raw as EntryTypeKey]
  }
  return visuals.appointment
}

/** "3 Oct 2026" — day first (lib/dayFirst); a date-only value is read as a local calendar day. */
function formatDate(value: string | null): string | null {
  return dayFirst(value, { year: 'always' })
}

function formatDateRange(start: string | null, end: string | null): string | null {
  const s = formatDate(start)
  const e = formatDate(end)
  if (s && e && start !== end) return `${s} · ${e}`
  if (s) return s
  if (e) return e
  return null
}

function formatLocation(city: string | null, country: string | null): string | null {
  const parts = [city?.trim(), countryLabel(country?.trim())].filter((v): v is string => Boolean(v))
  return parts.length ? parts.join(', ') : null
}

export default function UmpireAppointmentsSection({
  userId,
  readOnly = false,
  isOwnProfile = false,
  startAdding = false,
}: UmpireAppointmentsSectionProps) {
  const t = useProfileEditT()
  const navigate = useNavigate()
  const entryTypeVisuals = getEntryTypeVisuals(t)
  const matchFormatLabels = getMatchFormatLabels(t)
  const { appointments, loading, error, create, update, remove } = useUmpireAppointments({
    userId,
  })
  const [editorOpen, setEditorOpen] = useState(startAdding && !readOnly)
  const [editingAppointment, setEditingAppointment] = useState<UmpireAppointment | null>(null)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const openCreate = () => {
    setEditingAppointment(null)
    setEditorOpen(true)
  }

  const openEdit = (appointment: UmpireAppointment) => {
    setEditingAppointment(appointment)
    setEditorOpen(true)
    setPendingDeleteId(null)
  }

  const handleSave = async (input: UmpireAppointmentInput, id?: string) => {
    return id ? update(id, input) : create(input)
  }

  const handleDeleteRequest = (id: string) => {
    setPendingDeleteId((current) => (current === id ? null : id))
  }

  const handleDeleteConfirm = async (id: string) => {
    const target = appointments.find((a) => a.id === id)
    const ok = await remove(id)
    if (!ok) return
    setPendingDeleteId(null)
    if (target?.image_url) {
      void deleteStorageObject({
        bucket: JOURNEY_BUCKET,
        publicUrl: target.image_url,
        context: 'umpire-journey-entry-delete',
      })
    }
  }

  return (
    <section className="mt-6 bg-white rounded-2xl shadow-sm p-5 md:p-7 animate-slide-in-up">
      <div className="flex items-center justify-between gap-3 mb-5">
        <h2 className="text-2xl font-bold text-gray-900 inline-flex items-center gap-2">
          <Award className="w-6 h-6 text-ink-2" />
          {t('umpireSection.title')}
          {appointments.length > 0 && (
            <span className="text-base font-normal text-gray-400">
              · {appointments.length}
            </span>
          )}
        </h2>
        {!readOnly && (
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('umpireSection.add')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">{t('umpireSection.loading')}</div>
      ) : error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : appointments.length === 0 ? (
        readOnly ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
            <Award className="w-10 h-10 text-gray-500 mx-auto mb-3" />
            <p className="text-base font-semibold text-gray-900 mb-1">
              {isOwnProfile ? t('umpireSection.emptyOwnTitle') : t('umpireSection.emptyOtherTitle')}
            </p>
            <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
              {isOwnProfile
                ? t('umpireSection.emptyOwnBody')
                : t('umpireSection.emptyOtherBody')}
            </p>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => navigate('/dashboard/profile?tab=officiating')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                {t('umpireSection.addFirstPublic')}
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center">
            <p className="text-sm font-medium text-gray-900 mb-1">{t('umpireSection.startTitle')}</p>
            <p className="text-sm text-gray-500 mb-3">
              {t('umpireSection.startBody')}
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              {t('umpireSection.addFirst')}
            </button>
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {appointments.map((a) => {
            const visual = visualFor(entryTypeVisuals, a.entry_type)
            const { Icon } = visual
            const isAppointment = a.entry_type === 'appointment' || !a.entry_type
            const dateRange = formatDateRange(a.start_date, a.end_date)
            const location = formatLocation(a.location_city, a.location_country)
            const formatLabel =
              isAppointment && a.match_format ? matchFormatLabels[a.match_format] : null
            const isPendingDelete = pendingDeleteId === a.id

            return (
              <li
                key={a.id}
                className={`rounded-xl border border-l-4 border-gray-200 ${visual.borderClass} overflow-hidden hover:border-gray-300 transition-colors`}
              >
                {a.image_url && (
                  <img
                    src={a.image_url}
                    alt={a.event_name}
                    loading="lazy"
                    className="w-full h-40 object-cover"
                  />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${visual.badgeClass}`}
                        >
                          <Icon className="w-3 h-3" />
                          {visual.label}
                        </span>
                      </div>
                      <h3 className="text-base font-semibold text-gray-900 break-words">
                        {a.event_name}
                      </h3>

                      {isAppointment && (a.match_level || formatLabel) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {a.match_level && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-surface-grouped px-2 py-0.5 text-xs font-medium text-ink-2">
                              {a.match_level}
                            </span>
                          )}
                          {formatLabel && (
                            <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                              {formatLabel}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                        {a.organizer && (
                          <span className="inline-flex items-center gap-1">
                            <Building2 className="w-3.5 h-3.5 text-gray-400" />
                            {a.organizer}
                          </span>
                        )}
                        {dateRange && (
                          <span className="inline-flex items-center gap-1">
                            <CalendarIcon className="w-3.5 h-3.5 text-gray-400" />
                            {dateRange}
                          </span>
                        )}
                        {location && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                            {location}
                          </span>
                        )}
                      </div>

                      {a.description && (
                        <p className="mt-2 text-sm text-gray-700 leading-relaxed whitespace-pre-line">
                          {a.description}
                        </p>
                      )}
                    </div>

                    {!readOnly && (
                      <div className="flex-shrink-0 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => openEdit(a)}
                          className="p-1.5 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                          aria-label={t('umpireSection.editLabel')}
                          title={t('umpireSection.editTitle')}
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteRequest(a.id)}
                          className={`p-1.5 rounded-lg transition-colors ${
                            isPendingDelete
                              ? 'text-red-600 bg-red-50'
                              : 'text-gray-500 hover:text-red-600 hover:bg-red-50'
                          }`}
                          aria-label={isPendingDelete ? t('umpireSection.cancelDeleteLabel') : t('umpireSection.deleteLabel')}
                          title={isPendingDelete ? t('umpireSection.cancelTitle') : t('umpireSection.deleteTitle')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!readOnly && isPendingDelete && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                      <span className="text-xs font-medium text-red-800">
                        {t('umpireSection.deleteConfirm')}
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
                        >
                          {t('umpireSection.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteConfirm(a.id)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-700"
                        >
                          {t('umpireSection.delete')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {!readOnly && (
        <UmpireAppointmentEditor
          isOpen={editorOpen}
          appointment={editingAppointment}
          onClose={() => {
            setEditorOpen(false)
            setEditingAppointment(null)
          }}
          onSave={handleSave}
        />
      )}
    </section>
  )
}
