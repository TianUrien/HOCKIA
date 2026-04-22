/**
 * UmpireDashboard — Phase A
 *
 * Shallow, read-only dashboard for profiles with role='umpire'. Phase A
 * goals:
 *   - Admin flips a test profile to role='umpire' via SQL and can see the
 *     five new columns (umpire_level / federation / umpire_since /
 *     officiating_specialization / languages) rendered sensibly.
 *   - No self-service onboarding (role tile is deferred to Phase B).
 *   - No edit modal, no tabs, no Journey — all Phase B+.
 *
 * Scaffold deliberately does NOT clone CoachDashboard. The hero of an
 * umpire profile is their certification, not their bio — so the
 * Certification & Level card sits first. Everything else is supporting
 * context for now.
 *
 * Aesthetic is intentionally close to the other dashboards (same
 * Avatar, RoleBadge, VerifiedBadge, Header) so nothing feels off when
 * an admin toggles between views.
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Shield, Flag, Edit2, Languages as LanguagesIcon, Activity } from 'lucide-react'
import Header from '@/components/Header'
import { Avatar, EditProfileModal, RoleBadge, TierBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import UmpireAppointmentsSection from '@/components/UmpireAppointmentsSection'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'
import { calculateAge, formatDateOfBirth } from '@/lib/utils'
import { calculateTier } from '@/lib/profileTier'
import { useUmpireProfileStrength } from '@/hooks/useUmpireProfileStrength'
import { getUmpireActivity } from '@/lib/umpireActivity'

export type UmpireProfileShape =
  Partial<Profile> &
  Pick<
    Profile,
    | 'id'
    | 'role'
    | 'full_name'
    | 'avatar_url'
    | 'base_location'
    | 'nationality'
    | 'nationality_country_id'
    | 'nationality2_country_id'
    | 'gender'
    | 'date_of_birth'
    | 'bio'
  >

interface UmpireDashboardProps {
  profileData?: UmpireProfileShape
  readOnly?: boolean
}

function specializationLabel(value: string | null | undefined): string | null {
  if (!value) return null
  if (value === 'both') return 'Outdoor & Indoor'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function UmpireDashboard({ profileData, readOnly = false }: UmpireDashboardProps) {
  const { profile: authProfile } = useAuthStore()
  const profile = (profileData ?? authProfile) as UmpireProfileShape | null
  const navigate = useNavigate()
  const [showEditModal, setShowEditModal] = useState(false)

  // Owner-view tier uses the precise credentials-weighted strength hook so the
  // badge is exact (not estimated from community-grid fallbacks). Weights match
  // `estimateMemberStrength(umpire)`, so community cards and dashboard agree.
  const { percentage } = useUmpireProfileStrength({ profile })
  const tier = profile ? calculateTier(percentage) : null

  useEffect(() => {
    document.title = profile?.full_name
      ? `${profile.full_name} — Umpire | HOCKIA`
      : 'Umpire | HOCKIA'
  }, [profile?.full_name])

  if (!profile) return null

  const initials = profile.full_name
    ? profile.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)
    : '?'

  const age = profile.date_of_birth ? calculateAge(profile.date_of_birth) : null
  const dobDisplay = profile.date_of_birth ? formatDateOfBirth(profile.date_of_birth) : null
  const specLabel = specializationLabel(profile.officiating_specialization)
  const hasCertification =
    profile.umpire_level || profile.federation || profile.umpire_since || specLabel
  const hasLanguages = profile.languages && profile.languages.length > 0
  const hasBio = Boolean(profile.bio?.trim())

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 md:py-10">
        {readOnly && (
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 text-sm font-medium text-gray-600 hover:text-gray-900 mb-6"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        {/* ── Header row ── */}
        <div className="bg-white rounded-2xl shadow-sm p-5 md:p-8 animate-slide-in-up">
          <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
            <Avatar
              src={profile.avatar_url}
              alt={profile.full_name ?? 'Umpire'}
              initials={initials}
              size="xl"
              enablePreview
              previewTitle={profile.full_name ?? undefined}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
                  <span>{profile.full_name}</span>
                  <VerifiedBadge
                    verified={profile.is_verified}
                    verifiedAt={profile.verified_at ?? null}
                  />
                </h1>
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setShowEditModal(true)}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    Edit
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <RoleBadge role="umpire" />
                {!readOnly && tier && <TierBadge tier={tier} />}
                {profile.umpire_level && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <Shield className="w-3 h-3" />
                    {profile.umpire_level}
                  </span>
                )}
                {profile.federation && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                    <Flag className="w-3 h-3" />
                    {profile.federation}
                  </span>
                )}
                {(() => {
                  const activity = getUmpireActivity(profile.last_officiated_at)
                  if (!activity) return null
                  const colorClass =
                    activity.state === 'active'
                      ? 'bg-emerald-50 text-emerald-800'
                      : activity.state === 'recent'
                        ? 'bg-gray-100 text-gray-700'
                        : 'bg-gray-50 text-gray-500'
                  return (
                    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}>
                      <Activity className="w-3 h-3" />
                      {activity.label}
                    </span>
                  )
                })()}
              </div>

              <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-gray-600">
                {profile.base_location && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-4 h-4 text-gray-400" />
                    {profile.base_location}
                  </span>
                )}
                {(profile.nationality_country_id || profile.nationality) && (
                  <span className="inline-flex items-center gap-1.5">
                    <DualNationalityDisplay
                      primaryCountryId={profile.nationality_country_id}
                      secondaryCountryId={profile.nationality2_country_id}
                      fallbackText={profile.nationality}
                      className="text-gray-600"
                    />
                  </span>
                )}
                {dobDisplay && (
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    {dobDisplay}
                    {age !== null && <span className="text-gray-400">· {age}y</span>}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Empty-state CTA for owners who haven't completed credentials ── */}
        {!readOnly && !hasCertification && (
          <section className="mt-6 bg-gradient-to-br from-amber-50 to-yellow-50 border border-amber-200 rounded-2xl p-5 md:p-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
                <Shield className="w-5 h-5 text-amber-700" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900 mb-1">
                  Add your officiating credentials
                </h3>
                <p className="text-sm text-gray-700 mb-3">
                  Your level and federation are what clubs and fellow umpires look for first.
                  Take a minute now — you can always refine it later.
                </p>
                <button
                  type="button"
                  onClick={() => setShowEditModal(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-700 text-white text-sm font-medium hover:bg-amber-800 transition-colors"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Add credentials
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ── Certification & Level (hero) ── */}
        {hasCertification && (
          <section className="mt-6 bg-white rounded-2xl shadow-sm p-5 md:p-7 animate-slide-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-4 inline-flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Certification &amp; Level
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {profile.umpire_level && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Level</dt>
                  <dd className="text-base font-semibold text-gray-900">{profile.umpire_level}</dd>
                </div>
              )}
              {profile.federation && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Federation</dt>
                  <dd className="text-base font-semibold text-gray-900">{profile.federation}</dd>
                </div>
              )}
              {profile.umpire_since && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Umpiring since</dt>
                  <dd className="text-base font-semibold text-gray-900">{profile.umpire_since}</dd>
                </div>
              )}
              {specLabel && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Specialization</dt>
                  <dd className="text-base font-semibold text-gray-900">{specLabel}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* ── Officiating History (Phase C) ── */}
        {profile.id && (
          <UmpireAppointmentsSection userId={profile.id} readOnly={readOnly} />
        )}

        {/* ── Bio ── */}
        {hasBio && (
          <section className="mt-6 bg-white rounded-2xl shadow-sm p-5 md:p-7 animate-slide-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3">About</h2>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{profile.bio}</p>
          </section>
        )}

        {/* ── Languages ── */}
        {hasLanguages && (
          <section className="mt-6 bg-white rounded-2xl shadow-sm p-5 md:p-7 animate-slide-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-3 inline-flex items-center gap-2">
              <LanguagesIcon className="w-4 h-4" />
              Languages
            </h2>
            <div className="flex flex-wrap gap-2">
              {profile.languages!.map((lang) => (
                <span
                  key={lang}
                  className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700"
                >
                  {lang}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Phase C adds UmpireAppointmentsSection above. Posts / Friends /
            Comments tabs remain deferred to a later phase. */}
      </div>

      {!readOnly && (
        <EditProfileModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          role="umpire"
        />
      )}
    </div>
  )
}
