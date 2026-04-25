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
import UmpireAppointmentEditor from './UmpireAppointmentEditor'

const JOURNEY_BUCKET = 'journey'

interface UmpireAppointmentsSectionProps {
  userId: string
  readOnly?: boolean
  /** True when the viewer is the profile owner seeing their own public/network
   * view in readOnly mode. Swaps the empty-state copy from a neutral
   * "this umpire hasn't logged anything" to a self-directed nudge. */
  isOwnProfile?: boolean
}

const MATCH_FORMAT_LABELS: Record<string, string> = {
  outdoor_11v11: 'Outdoor 11v11',
  indoor_5v5: 'Indoor 5v5',
  other: 'Other format',
}

type EntryTypeKey = 'appointment' | 'milestone' | 'certification' | 'panel'

interface EntryTypeVisual {
  label: string
  Icon: LucideIcon
  badgeClass: string
  borderClass: string
}

const ENTRY_TYPE_VISUALS: Record<EntryTypeKey, EntryTypeVisual> = {
  appointment: {
    label: 'Appointment',
    Icon: CalendarIcon,
    badgeClass: 'bg-emerald-50 text-emerald-800',
    borderClass: 'border-l-emerald-400',
  },
  milestone: {
    label: 'Milestone',
    Icon: Trophy,
    badgeClass: 'bg-purple-50 text-[#8026FA]',
    borderClass: 'border-l-[#8026FA]',
  },
  certification: {
    label: 'Certification',
    Icon: Shield,
    badgeClass: 'bg-amber-50 text-amber-800',
    borderClass: 'border-l-amber-400',
  },
  panel: {
    label: 'Panel',
    Icon: Users,
    badgeClass: 'bg-blue-50 text-blue-800',
    borderClass: 'border-l-blue-400',
  },
}

const visualFor = (raw: string | null | undefined): EntryTypeVisual => {
  if (raw && raw in ENTRY_TYPE_VISUALS) {
    return ENTRY_TYPE_VISUALS[raw as EntryTypeKey]
  }
  return ENTRY_TYPE_VISUALS.appointment
}

function formatDate(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value + 'T00:00:00Z')
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function formatDateRange(start: string | null, end: string | null): string | null {
  const s = formatDate(start)
  const e = formatDate(end)
  if (s && e && start !== end) return `${s} — ${e}`
  if (s) return s
  if (e) return e
  return null
}

function formatLocation(city: string | null, country: string | null): string | null {
  const parts = [city?.trim(), country?.trim()].filter((v): v is string => Boolean(v))
  return parts.length ? parts.join(', ') : null
}

export default function UmpireAppointmentsSection({
  userId,
  readOnly = false,
  isOwnProfile = false,
}: UmpireAppointmentsSectionProps) {
  const navigate = useNavigate()
  const { appointments, loading, error, create, update, remove } = useUmpireAppointments({
    userId,
  })
  const [editorOpen, setEditorOpen] = useState(false)
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
          <Award className="w-6 h-6 text-amber-700" />
          Officiating Journey
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
            Add
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : error ? (
        <div className="text-sm text-red-600">{error}</div>
      ) : appointments.length === 0 ? (
        readOnly ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-6 text-center">
            <Award className="w-10 h-10 text-gray-300 mx-auto mb-3" />
            <p className="text-base font-semibold text-gray-900 mb-1">
              {isOwnProfile ? 'No journey entries yet' : 'No journey entries shared yet'}
            </p>
            <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
              {isOwnProfile
                ? 'Appointments, milestones, certifications, and panel inductions live here. Add your first one from your dashboard.'
                : 'When this umpire logs appointments, milestones, certifications, or panel inductions, they will appear here.'}
            </p>
            {isOwnProfile && (
              <button
                type="button"
                onClick={() => navigate('/dashboard/profile?tab=officiating')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-3.5 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                <Plus className="w-3.5 h-3.5" />
                Add your first entry
              </button>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 p-5 text-center">
            <p className="text-sm font-medium text-gray-900 mb-1">Start your journey</p>
            <p className="text-sm text-gray-500 mb-3">
              Log appointments, milestones, certifications, and panel inductions
              to tell the story of your officiating career.
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Plus className="w-3.5 h-3.5" />
              Add your first entry
            </button>
          </div>
        )
      ) : (
        <ul className="space-y-3">
          {appointments.map((a) => {
            const visual = visualFor(a.entry_type)
            const { Icon } = visual
            const isAppointment = a.entry_type === 'appointment' || !a.entry_type
            const dateRange = formatDateRange(a.start_date, a.end_date)
            const location = formatLocation(a.location_city, a.location_country)
            const formatLabel =
              isAppointment && a.match_format ? MATCH_FORMAT_LABELS[a.match_format] : null
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
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
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
                          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
                          aria-label="Edit entry"
                          title="Edit"
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
                          aria-label={isPendingDelete ? 'Cancel delete' : 'Delete entry'}
                          title={isPendingDelete ? 'Cancel' : 'Delete'}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>

                  {!readOnly && isPendingDelete && (
                    <div className="mt-3 flex items-center justify-between gap-3 rounded-lg bg-red-50 border border-red-100 px-3 py-2">
                      <span className="text-xs font-medium text-red-800">
                        Delete this entry? This can't be undone.
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-gray-700 bg-white border border-gray-200 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteConfirm(a.id)}
                          className="px-2.5 py-1 rounded-md text-xs font-medium text-white bg-red-600 hover:bg-red-700"
                        >
                          Delete
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
