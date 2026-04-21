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

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, MapPin, Calendar, Shield, Flag, Edit2, Languages as LanguagesIcon } from 'lucide-react'
import Header from '@/components/Header'
import { Avatar, EditProfileModal, RoleBadge, TierBadge, VerifiedBadge, DualNationalityDisplay } from '@/components'
import { useAuthStore } from '@/lib/auth'
import type { Profile } from '@/lib/supabase'
import { calculateAge, formatDateOfBirth } from '@/lib/utils'
import { calculateTier, estimateMemberStrength } from '@/lib/profileTier'
import type { CommunityMemberFields } from '@/lib/profileCompletion'

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

// The five umpire-specific columns don't live on the generated Profile
// type yet (types regen is a separate chore). Narrow cast at one spot.
type UmpireFields = {
  umpire_level?: string | null
  federation?: string | null
  umpire_since?: number | null
  officiating_specialization?: 'outdoor' | 'indoor' | 'both' | null
  languages?: string[] | null
  is_verified?: boolean | null
  verified_at?: string | null
}

function specializationLabel(value: UmpireFields['officiating_specialization']): string | null {
  if (!value) return null
  if (value === 'both') return 'Outdoor & Indoor'
  return value.charAt(0).toUpperCase() + value.slice(1)
}

export default function UmpireDashboard({ profileData, readOnly = false }: UmpireDashboardProps) {
  const { profile: authProfile } = useAuthStore()
  const profile = (profileData ?? authProfile) as UmpireProfileShape | null
  const navigate = useNavigate()
  const [showEditModal, setShowEditModal] = useState(false)

  const umpireFields = useMemo<UmpireFields>(
    () => (profile ? (profile as unknown as UmpireFields) : {}),
    [profile]
  )

  // Tier comes from the shared per-role estimator so the badge here matches
  // what community-grid cards render. Once `useUmpireProfileStrength` exists
  // (Phase B2), owner-view can upgrade to the precise percentage.
  const tier = useMemo(() => {
    if (!profile) return null
    const asMember = profile as unknown as CommunityMemberFields
    return calculateTier(estimateMemberStrength(asMember))
  }, [profile])

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
  const specLabel = specializationLabel(umpireFields.officiating_specialization)
  const hasCertification =
    umpireFields.umpire_level || umpireFields.federation || umpireFields.umpire_since || specLabel
  const hasLanguages = umpireFields.languages && umpireFields.languages.length > 0
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
                    verified={umpireFields.is_verified}
                    verifiedAt={umpireFields.verified_at ?? null}
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
                {umpireFields.umpire_level && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
                    <Shield className="w-3 h-3" />
                    {umpireFields.umpire_level}
                  </span>
                )}
                {umpireFields.federation && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                    <Flag className="w-3 h-3" />
                    {umpireFields.federation}
                  </span>
                )}
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

        {/* ── Certification & Level (hero) ── */}
        {hasCertification && (
          <section className="mt-6 bg-white rounded-2xl shadow-sm p-5 md:p-7 animate-slide-in-up">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-amber-700 mb-4 inline-flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Certification &amp; Level
            </h2>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {umpireFields.umpire_level && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Level</dt>
                  <dd className="text-base font-semibold text-gray-900">{umpireFields.umpire_level}</dd>
                </div>
              )}
              {umpireFields.federation && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Federation</dt>
                  <dd className="text-base font-semibold text-gray-900">{umpireFields.federation}</dd>
                </div>
              )}
              {umpireFields.umpire_since && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-gray-400 mb-1">Umpiring since</dt>
                  <dd className="text-base font-semibold text-gray-900">{umpireFields.umpire_since}</dd>
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
              {umpireFields.languages!.map((lang) => (
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

        {/* Phase B adds the edit surface via EditProfileModal (above).
            Posts / Friends / Comments tabs + Journey remain deferred to Phase C. */}
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
