/**
 * EditUserModal Component
 * 
 * Modal for admins to manually edit user profile data.
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Save, Loader2 } from 'lucide-react'
import { CountrySelect } from '@/components'
import WorldClubSearch from '@/components/WorldClubSearch'
import type { WorldClubSearchResult } from '@/components/WorldClubSearch'
import { useCountries } from '@/hooks/useCountries'
import type { AdminProfileDetails } from '../types'
import { COACH_SPECIALIZATIONS, type CoachSpecialization } from '@/lib/coachSpecializations'

interface EditUserModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (updates: Record<string, unknown>, reason?: string) => Promise<void>
  profile: AdminProfileDetails['profile'] | null
}

export function EditUserModal({
  isOpen,
  onClose,
  onSave,
  profile,
}: EditUserModalProps) {
  const { getCountryById } = useCountries()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  // Form state
  const [formData, setFormData] = useState({
    full_name: '',
    base_location: '',
    nationality: '',
    nationality_country_id: null as number | null,
    nationality2_country_id: null as number | null,
    position: '',
    secondary_position: '',
    gender: '',
    current_club: '',
    current_world_club_id: null as string | null,
    coach_specialization: '' as CoachSpecialization | '',
    coach_specialization_custom: '',
    // Umpire-specific (Phase F4 — admin edit surface)
    umpire_level: '',
    federation: '',
    umpire_since: '',
    officiating_specialization: '' as '' | 'outdoor' | 'indoor' | 'both',
    languages: '',
  })

  // Initialize form when profile changes
  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        base_location: profile.base_location || '',
        nationality: profile.nationality || '',
        nationality_country_id: profile.nationality_country_id ?? null,
        nationality2_country_id: profile.nationality2_country_id ?? null,
        position: profile.position || '',
        secondary_position: profile.secondary_position || '',
        gender: profile.gender || '',
        current_club: profile.current_club || '',
        current_world_club_id: profile.current_world_club_id ?? null,
        coach_specialization: (profile.coach_specialization as CoachSpecialization) || '',
        coach_specialization_custom: profile.coach_specialization_custom || '',
        umpire_level: profile.umpire_level || '',
        federation: profile.federation || '',
        umpire_since: profile.umpire_since != null ? String(profile.umpire_since) : '',
        officiating_specialization:
          (profile.officiating_specialization as 'outdoor' | 'indoor' | 'both' | null) ?? '',
        languages: (profile.languages ?? []).join(', '),
      })
      setReason('')
      setError(null)
    }
  }, [profile])

  const handleClubSelect = useCallback((club: WorldClubSearchResult) => {
    setFormData(prev => ({
      ...prev,
      current_club: club.club_name,
      current_world_club_id: club.id,
    }))
  }, [])

  const handleClubClear = useCallback(() => {
    setFormData(prev => ({
      ...prev,
      current_world_club_id: null,
    }))
  }, [])

  if (!isOpen || !profile) return null

  const handleNationalityChange = (countryId: number | null) => {
    const country = countryId ? getCountryById(countryId) : null
    setFormData(prev => ({
      ...prev,
      nationality_country_id: countryId,
      nationality: country?.name || prev.nationality,
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      // Build updates object with only changed fields
      const updates: Record<string, unknown> = {}
      
      if (formData.full_name !== (profile.full_name || '')) {
        updates.full_name = formData.full_name || null
      }
      if (formData.base_location !== (profile.base_location || '')) {
        updates.base_location = formData.base_location || null
      }
      if (formData.nationality !== (profile.nationality || '')) {
        updates.nationality = formData.nationality || null
      }
      if (formData.nationality_country_id !== (profile.nationality_country_id ?? null)) {
        updates.nationality_country_id = formData.nationality_country_id
      }
      if (formData.nationality2_country_id !== (profile.nationality2_country_id ?? null)) {
        updates.nationality2_country_id = formData.nationality2_country_id
      }
      if (formData.position !== (profile.position || '')) {
        updates.position = formData.position || null
      }
      if (formData.secondary_position !== (profile.secondary_position || '')) {
        updates.secondary_position = formData.secondary_position || null
      }
      if (formData.gender !== (profile.gender || '')) {
        updates.gender = formData.gender || null
      }
      if (formData.current_club !== (profile.current_club || '')) {
        updates.current_club = formData.current_club || null
      }
      if (formData.current_world_club_id !== (profile.current_world_club_id ?? null)) {
        updates.current_world_club_id = formData.current_world_club_id
      }
      if (formData.coach_specialization !== (profile.coach_specialization || '')) {
        updates.coach_specialization = formData.coach_specialization || null
      }
      if (formData.coach_specialization_custom !== (profile.coach_specialization_custom || '')) {
        updates.coach_specialization_custom = formData.coach_specialization === 'other'
          ? formData.coach_specialization_custom.trim() || null
          : null
      }

      // ── Umpire-specific fields ─────────────────────────────────────────
      // Only diff these when the profile is actually an umpire. Sending
      // umpire fields for a non-umpire would violate chk_umpire_fields_role
      // at the DB layer and bounce the whole update.
      if (profile.role === 'umpire') {
        if (formData.umpire_level !== (profile.umpire_level || '')) {
          updates.umpire_level = formData.umpire_level.trim() || null
        }
        if (formData.federation !== (profile.federation || '')) {
          updates.federation = formData.federation.trim() || null
        }
        const currentYear = profile.umpire_since != null ? String(profile.umpire_since) : ''
        if (formData.umpire_since !== currentYear) {
          const parsed = formData.umpire_since.trim() === ''
            ? null
            : parseInt(formData.umpire_since, 10)
          if (parsed !== null && (Number.isNaN(parsed) || parsed < 1950 || parsed > new Date().getFullYear())) {
            setError(`Umpiring since must be a year between 1950 and ${new Date().getFullYear()}.`)
            setIsSubmitting(false)
            return
          }
          updates.umpire_since = parsed
        }
        const currentSpec = profile.officiating_specialization || ''
        if (formData.officiating_specialization !== currentSpec) {
          updates.officiating_specialization = formData.officiating_specialization || null
        }
        const currentLangs = (profile.languages ?? []).join(', ')
        if (formData.languages !== currentLangs) {
          const parsed = formData.languages
            .split(',')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
          updates.languages = parsed.length > 0 ? parsed : null
        }
      }

      if (Object.keys(updates).length === 0) {
        setError('No changes to save')
        setIsSubmitting(false)
        return
      }

      await onSave(updates, reason || undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update profile')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg bg-white shadow-xl z-50 overflow-y-auto">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Edit User Profile</h2>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-6">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* User Info Header */}
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500">Editing profile for:</p>
              <p className="font-medium text-gray-900">{profile.email}</p>
              <p className="text-sm text-gray-600">Role: {profile.role}</p>
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              {/* Full Name */}
              <div>
                <label htmlFor="admin-edit-full-name" className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  id="admin-edit-full-name"
                  type="text"
                  value={formData.full_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, full_name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  aria-label="Full name"
                />
              </div>

              {/* Base Location */}
              <div>
                <label htmlFor="admin-edit-base-location" className="block text-sm font-medium text-gray-700 mb-1">
                  Base Location (City)
                </label>
                <input
                  id="admin-edit-base-location"
                  type="text"
                  value={formData.base_location}
                  onChange={(e) => setFormData(prev => ({ ...prev, base_location: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  aria-label="Base location"
                />
              </div>

              {/* Nationality (Country Select) */}
              <CountrySelect
                label="Nationality"
                value={formData.nationality_country_id}
                onChange={handleNationalityChange}
                placeholder="Select nationality"
              />

              {/* Secondary Nationality (for dual nationality) */}
              <CountrySelect
                label="Secondary Nationality (Optional)"
                value={formData.nationality2_country_id}
                onChange={(id) => setFormData(prev => ({ ...prev, nationality2_country_id: id }))}
                placeholder="Select secondary nationality"
              />

              {/* Position (for players) */}
              {profile.role === 'player' && (
                <>
                  <div>
                    <label htmlFor="admin-edit-position" className="block text-sm font-medium text-gray-700 mb-1">
                      Position
                    </label>
                    <select
                      id="admin-edit-position"
                      value={formData.position}
                      onChange={(e) => setFormData(prev => ({ ...prev, position: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      aria-label="Position"
                    >
                      <option value="">Select position</option>
                      <option value="goalkeeper">Goalkeeper</option>
                      <option value="defender">Defender</option>
                      <option value="midfielder">Midfielder</option>
                      <option value="forward">Forward</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="admin-edit-secondary-position" className="block text-sm font-medium text-gray-700 mb-1">
                      Secondary Position (Optional)
                    </label>
                    <select
                      id="admin-edit-secondary-position"
                      value={formData.secondary_position}
                      onChange={(e) => setFormData(prev => ({ ...prev, secondary_position: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      aria-label="Secondary position"
                    >
                      <option value="">None</option>
                      <option value="goalkeeper">Goalkeeper</option>
                      <option value="defender">Defender</option>
                      <option value="midfielder">Midfielder</option>
                      <option value="forward">Forward</option>
                    </select>
                  </div>

                </>
              )}

              {/* Current Club (all roles) */}
              <WorldClubSearch
                  label="Current Club"
                  value={formData.current_club}
                  onChange={(value) => setFormData(prev => ({ ...prev, current_club: value }))}
                  onClubSelect={handleClubSelect}
                  onClubClear={handleClubClear}
                  selectedClubId={formData.current_world_club_id}
                  placeholder="Search World clubs..."
                  id="admin-edit-current-club"
                />

              {/* Gender */}
              {(profile.role === 'player' || profile.role === 'coach') && (
                <div>
                  <label htmlFor="admin-edit-gender" className="block text-sm font-medium text-gray-700 mb-1">
                    Gender
                  </label>
                  <select
                    id="admin-edit-gender"
                    value={formData.gender}
                    onChange={(e) => setFormData(prev => ({ ...prev, gender: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    aria-label="Gender"
                  >
                    <option value="">Select gender</option>
                    <option value="Men">Men</option>
                    <option value="Women">Women</option>
                  </select>
                </div>
              )}

              {/* Coach Specialization (for coaches) */}
              {profile.role === 'coach' && (
                <>
                  <div>
                    <label htmlFor="admin-edit-specialization" className="block text-sm font-medium text-gray-700 mb-1">
                      Specialization
                    </label>
                    <select
                      id="admin-edit-specialization"
                      value={formData.coach_specialization}
                      onChange={(e) => setFormData(prev => ({ ...prev, coach_specialization: e.target.value as CoachSpecialization | '' }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      aria-label="Coach specialization"
                    >
                      <option value="">No specialization</option>
                      {COACH_SPECIALIZATIONS.map((spec) => (
                        <option key={spec.value} value={spec.value}>{spec.label}</option>
                      ))}
                    </select>
                  </div>

                  {formData.coach_specialization === 'other' && (
                    <div>
                      <label htmlFor="admin-edit-specialization-custom" className="block text-sm font-medium text-gray-700 mb-1">
                        Custom Role Title
                      </label>
                      <input
                        id="admin-edit-specialization-custom"
                        type="text"
                        value={formData.coach_specialization_custom}
                        onChange={(e) => setFormData(prev => ({ ...prev, coach_specialization_custom: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        placeholder="e.g., Team Manager"
                        aria-label="Custom specialization title"
                      />
                    </div>
                  )}
                </>
              )}

              {/* Umpire-specific fields (Phase F4 — admin edit surface).
                  admin_update_profile now allowlists these columns, so
                  admins can remediate umpire credentials directly.
                  chk_umpire_fields_role at the DB layer means these are
                  only editable when role='umpire'. */}
              {profile.role === 'umpire' && (
                <div className="pt-4 border-t border-gray-200 space-y-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                    Umpire credentials
                  </p>

                  <div>
                    <label htmlFor="admin-edit-umpire-level" className="block text-sm font-medium text-gray-700 mb-1">
                      Umpire level
                    </label>
                    <input
                      id="admin-edit-umpire-level"
                      type="text"
                      value={formData.umpire_level}
                      onChange={(e) => setFormData((prev) => ({ ...prev, umpire_level: e.target.value }))}
                      placeholder="e.g., FIH International, National, Regional"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      maxLength={120}
                      aria-label="Umpire level"
                    />
                  </div>

                  <div>
                    <label htmlFor="admin-edit-federation" className="block text-sm font-medium text-gray-700 mb-1">
                      Federation
                    </label>
                    <input
                      id="admin-edit-federation"
                      type="text"
                      value={formData.federation}
                      onChange={(e) => setFormData((prev) => ({ ...prev, federation: e.target.value }))}
                      placeholder="e.g., FIH, England Hockey, USA Field Hockey"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      maxLength={120}
                      aria-label="Federation"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="admin-edit-umpire-since" className="block text-sm font-medium text-gray-700 mb-1">
                        Umpiring since (year)
                      </label>
                      <input
                        id="admin-edit-umpire-since"
                        type="number"
                        inputMode="numeric"
                        min={1950}
                        max={new Date().getFullYear()}
                        value={formData.umpire_since}
                        onChange={(e) => setFormData((prev) => ({ ...prev, umpire_since: e.target.value }))}
                        placeholder="e.g., 2018"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        aria-label="Umpiring since year"
                      />
                    </div>
                    <div>
                      <label htmlFor="admin-edit-officiating-specialization" className="block text-sm font-medium text-gray-700 mb-1">
                        Specialization
                      </label>
                      <select
                        id="admin-edit-officiating-specialization"
                        value={formData.officiating_specialization}
                        onChange={(e) =>
                          setFormData((prev) => ({
                            ...prev,
                            officiating_specialization: e.target.value as '' | 'outdoor' | 'indoor' | 'both',
                          }))
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                        aria-label="Officiating specialization"
                      >
                        <option value="">Not specified</option>
                        <option value="outdoor">Outdoor</option>
                        <option value="indoor">Indoor</option>
                        <option value="both">Outdoor &amp; Indoor</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="admin-edit-umpire-languages" className="block text-sm font-medium text-gray-700 mb-1">
                      Languages
                    </label>
                    <input
                      id="admin-edit-umpire-languages"
                      type="text"
                      value={formData.languages}
                      onChange={(e) => setFormData((prev) => ({ ...prev, languages: e.target.value }))}
                      placeholder="English, Spanish, Dutch"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      aria-label="Languages (comma separated)"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Comma-separated. Leave empty to clear.
                    </p>
                  </div>
                </div>
              )}

              {/* Reason for edit */}
              <div className="pt-4 border-t border-gray-200">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for edit (optional, for audit log)
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g., User requested correction of nationality"
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Changes
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
