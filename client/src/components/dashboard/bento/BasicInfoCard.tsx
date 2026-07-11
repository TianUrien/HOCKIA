import { IdCard } from 'lucide-react'
import {
  DualNationalityDisplay,
} from '@/components'
import DashboardCard from './DashboardCard'
import { useCountries } from '@/hooks/useCountries'
import { summarizeCandidateIntent } from '@/lib/candidateIntent'
import { specialistSkillLabels } from '@/lib/specialistSkills'
import { calculateAge, formatDateOfBirth } from '@/lib/utils'
import { categoriesToDisplay, categoryToDisplay } from '@/lib/hockeyCategories'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import type { CoachSpecialization } from '@/lib/coachSpecializations'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

interface BasicInfoCardProps {
  profile: PlayerProfileShape
  readOnly: boolean
  onEdit?: () => void
}

interface RowProps {
  label: string
  children: React.ReactNode
}

function Row({ label, children }: RowProps) {
  // `min-w-0` on the wrapper lets `truncate` actually shrink within a
  // CSS grid cell. Without it the cell expands to its content width and
  // overflows the card (the "Bayside Powerhouse Saints Hockey Club"
  // horizontal-scroll bug).
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        {label}
      </span>
      <div className="text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  )
}

export default function BasicInfoCard({ profile, readOnly, onEdit }: BasicInfoCardProps) {
  // Visitors get server-computed age (raw DOB is owner-only post age-gate).
  const age = profile.server_age ?? calculateAge(profile.date_of_birth)
  const positions = [profile.position, profile.secondary_position].filter(
    (value, index, self): value is string => {
      if (!value) return false
      return self.findIndex((item) => item === value) === index
    },
  )
  const bio = profile.bio?.trim()
  const hasBio = Boolean(bio)

  // Role-aware Basic Info — Player and Coach share the same card shape,
  // but the Category + Position rows become Coaching categories +
  // Specialization for coaches. The rest (nationality, age, location,
  // current club, bio) is identical across both roles.
  const isCoach = profile.role === 'coach'
  const coachingCategoriesLabel = isCoach
    ? categoriesToDisplay(profile.coaching_categories ?? null)
    : null
  const specializationLabel = isCoach
    ? getSpecializationLabel(
        (profile.coach_specialization ?? null) as CoachSpecialization | null,
        profile.coach_specialization_custom ?? null,
      )
    : null

  // Matching Increment #2 — recruitment preferences (read-only). Player +
  // coach only; the whole subsection hides when nothing is set.
  const { getCountryById } = useCountries()
  const isCandidate = profile.role === 'player' || profile.role === 'coach'
  const intent = summarizeCandidateIntent(profile, (id) => getCountryById(id)?.name)
  const hasPrefs = isCandidate && intent.hasAny
  // Matching Increment #3 — player specialist tags (read-only chips).
  const playerSkills = profile.role === 'player' ? specialistSkillLabels(profile.specialist_skills) : []

  return (
    <DashboardCard
      icon={IdCard}
      title="Basic information"
      subtitle={isCoach ? 'The facts clubs and players filter by' : 'The facts clubs filter by'}
      ctaLabel={!readOnly ? 'Edit' : undefined}
      onCtaClick={!readOnly ? onEdit : undefined}
      testId="basic-info-card"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Nationality">
          <DualNationalityDisplay
            primaryCountryId={profile.nationality_country_id}
            secondaryCountryId={profile.nationality2_country_id}
            fallbackText={profile.nationality}
            mode="compact"
            className="text-gray-900"
          />
        </Row>

        <Row label="Age">
          {profile.date_of_birth ? (
            <span>
              {age != null ? `${age} years` : formatDateOfBirth(profile.date_of_birth)}
            </span>
          ) : (
            <span className="text-gray-400 italic text-xs">—</span>
          )}
        </Row>

        <Row label="Base location">
          {profile.base_location ? (
            <span>{profile.base_location}</span>
          ) : (
            <span className="text-gray-400 italic text-xs">—</span>
          )}
        </Row>

        <Row label={isCoach ? 'Coaching categories' : 'Category'}>
          {isCoach ? (
            coachingCategoriesLabel ? (
              <span>{coachingCategoriesLabel}</span>
            ) : (
              <span className="text-gray-400 italic text-xs">—</span>
            )
          ) : profile.playing_category ? (
            <span>{categoryToDisplay(profile.playing_category)}</span>
          ) : (
            <span className="text-gray-400 italic text-xs">—</span>
          )}
        </Row>

        <Row label={isCoach ? 'Specialization' : 'Position'}>
          {isCoach ? (
            specializationLabel ? (
              <span>{specializationLabel}</span>
            ) : (
              <span className="text-gray-400 italic text-xs">—</span>
            )
          ) : positions.length > 0 ? (
            <span className="capitalize">{positions.join(' • ')}</span>
          ) : (
            <span className="text-gray-400 italic text-xs">—</span>
          )}
        </Row>

        <Row label="Current club">
          {profile.current_club ? (
            <span className="block truncate" title={profile.current_club}>
              {profile.current_club}
            </span>
          ) : (
            <span className="text-gray-400 italic text-xs">—</span>
          )}
        </Row>
      </div>

      {/* Specialist skills (Matching Increment #3 — read-only chips,
          players only, hidden when none set). */}
      {playerSkills.length > 0 && (
        <div className="mt-5 pt-5 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            Specialist skills
          </p>
          <div className="flex flex-wrap gap-1.5">
            {playerSkills.map((s) => (
              <span key={s} className="rounded-full bg-hockia-primary/10 text-[#5b16b8] text-xs font-medium px-2 py-0.5">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Recruitment preferences (Matching Increment #2 — read-only).
          Hidden entirely when the candidate hasn't set any. */}
      {hasPrefs && (
        <div className="mt-5 pt-5 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            Recruitment preferences
          </p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {intent.rows.map((r) => (
              <Row key={r.key} label={r.label}>
                <span className="block truncate" title={r.value}>{r.value}</span>
              </Row>
            ))}
          </div>
        </div>
      )}

      {/* About me subsection — merged in from the previous standalone
          AboutMeCard so owners see facts + bio in one place. The card's
          shared Edit CTA opens EditProfileModal which already covers all
          the fields here including the bio textarea. Subsection is
          hidden entirely for visitors with an empty bio so no awkward
          placeholder line appears on a sparse profile. */}
      {(hasBio || !readOnly) && (
        <div className="mt-5 pt-5 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            About me
          </p>
          {hasBio ? (
            <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
              {bio}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">
              {isCoach
                ? 'Share your coaching philosophy, achievements, and what kind of role you’re looking for.'
                : 'Share your playing style, ambitions, and what you’re looking for in a club.'}
            </p>
          )}
        </div>
      )}
    </DashboardCard>
  )
}
