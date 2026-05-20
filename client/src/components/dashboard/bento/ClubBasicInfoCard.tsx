import { IdCard } from 'lucide-react'
import { CountryDisplay } from '@/components'
import DashboardCard from './DashboardCard'
import { derivePublicContactEmail } from '@/lib/profile'
import type { Profile } from '@/lib/supabase'

/**
 * ClubBasicInfoCard — Club-only Bento card. Mirrors the player/coach
 * BasicInfoCard visually (icon tile, 2-col fact grid, About subsection,
 * shared Edit CTA) but surfaces the org-level facts a club carries:
 * country, location, year founded, league divisions, website. The
 * About subsection shows the club bio; club history sits below it.
 *
 * A separate component (rather than a `role==='club'` branch inside
 * BasicInfoCard) keeps the freshly-shipped player/coach card untouched
 * — clubs are organisations, not individuals, so almost every row
 * differs.
 */
type ClubBasicInfoShape = Pick<
  Profile,
  | 'nationality'
  | 'nationality_country_id'
  | 'base_location'
  | 'year_founded'
  | 'website'
  | 'club_bio'
  | 'club_history'
  | 'contact_email'
  | 'contact_email_public'
  | 'email'
> & {
  womens_league_division?: string | null
  mens_league_division?: string | null
}

interface ClubBasicInfoCardProps {
  profile: ClubBasicInfoShape
  readOnly: boolean
  onEdit?: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[11px] uppercase tracking-wide text-gray-500 font-medium">
        {label}
      </span>
      <div className="text-sm text-gray-900 min-w-0">{children}</div>
    </div>
  )
}

const Empty = () => <span className="text-gray-400 italic text-xs">—</span>

export default function ClubBasicInfoCard({ profile, readOnly, onEdit }: ClubBasicInfoCardProps) {
  const bio = profile.club_bio?.trim()
  const history = profile.club_history?.trim()
  const hasBio = Boolean(bio)
  const hasHistory = Boolean(history)
  const publicContact = derivePublicContactEmail(profile)

  const leagues: string[] = []
  if (profile.womens_league_division) leagues.push(`Women: ${profile.womens_league_division}`)
  if (profile.mens_league_division) leagues.push(`Men: ${profile.mens_league_division}`)

  return (
    <DashboardCard
      icon={IdCard}
      title="Club information"
      subtitle="The facts players and coaches filter by"
      ctaLabel={!readOnly ? 'Edit' : undefined}
      onCtaClick={!readOnly ? onEdit : undefined}
      testId="club-basic-info-card"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Row label="Country">
          {profile.nationality_country_id || profile.nationality ? (
            <CountryDisplay
              countryId={profile.nationality_country_id}
              fallbackText={profile.nationality}
              className="text-gray-900"
            />
          ) : (
            <Empty />
          )}
        </Row>

        <Row label="Base location">
          {profile.base_location ? <span>{profile.base_location}</span> : <Empty />}
        </Row>

        <Row label="Year founded">
          {profile.year_founded ? <span>{profile.year_founded}</span> : <Empty />}
        </Row>

        <Row label="Website">
          {profile.website ? (
            <a
              href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-[#8026FA] hover:text-[#6B20D4] underline"
              title={profile.website}
            >
              {profile.website}
            </a>
          ) : (
            <Empty />
          )}
        </Row>

        <Row label="Leagues">
          {leagues.length > 0 ? (
            <div className="space-y-0.5">
              {leagues.map((l) => (
                <div key={l}>{l}</div>
              ))}
            </div>
          ) : (
            <Empty />
          )}
        </Row>

        <Row label="Contact email">
          {publicContact.shouldShow && publicContact.displayEmail ? (
            <a
              href={`mailto:${publicContact.displayEmail}`}
              className="block truncate text-[#8026FA] hover:text-[#6B20D4] underline"
              title={publicContact.displayEmail}
            >
              {publicContact.displayEmail}
            </a>
          ) : (
            <Empty />
          )}
        </Row>
      </div>

      {/* About the Club + Club History — merged in so owners see the
          facts and the club narrative in one place. The shared Edit CTA
          opens EditProfileModal which covers club_bio + club_history. */}
      {(hasBio || !readOnly) && (
        <div className="mt-5 pt-5 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            About the club
          </p>
          {hasBio ? (
            <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
              {bio}
            </p>
          ) : (
            <p className="text-sm text-gray-400 italic">
              Describe your club — its identity, ambitions, and what playing here is like.
            </p>
          )}
        </div>
      )}

      {hasHistory && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="text-[11px] uppercase tracking-wide text-gray-500 font-medium mb-2">
            Club history
          </p>
          <p className="text-sm text-gray-700 leading-relaxed line-clamp-4 whitespace-pre-line">
            {history}
          </p>
        </div>
      )}
    </DashboardCard>
  )
}
