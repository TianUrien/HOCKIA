import { useState } from 'react'
import {
  MapPin, Calendar, Edit2, Eye, MessageCircle, Trophy, Mail,
  Users, UsersRound, ChevronRight, ChevronDown, ChevronUp, Camera, Check, Circle,
} from 'lucide-react'
import {
  Avatar,
  CountryDisplay,
  FriendshipButton,
  LastActivePill,
  RoleBadge,
  SocialLinksDisplay,
  TierBadge,
  VerifiedBadge,
} from '@/components'
import Button from '@/components/Button'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import ShareProfileButton from '@/components/profile/ShareProfileButton'
import CompletionArc from './CompletionArc'
import { getInitials, cn } from '@/lib/utils'
import { calculateTier } from '@/lib/profileTier'
import { derivePublicContactEmail } from '@/lib/profile'
import type { Profile } from '@/lib/supabase'
import type { SocialLinks } from '@/lib/socialLinks'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'

/**
 * ClubHeroCard — the Club dashboard's identity hero. Mirrors the
 * player/coach HeroIdentityCard's visual language (avatar + name,
 * inline credibility stats, CTA row, meta block, completion arc +
 * collapsible checklist) but carries org-level content: a club logo,
 * year founded, league divisions, and a Members stat in place of the
 * References stat.
 *
 * It's a separate component rather than a `role==='club'` branch in
 * HeroIdentityCard so the freshly-shipped player/coach hero stays
 * untouched — a club is an organisation, not an individual, and almost
 * every row differs.
 */
type ClubHeroShape = Pick<
  Profile,
  | 'id'
  | 'full_name'
  | 'avatar_url'
  | 'username'
  | 'nationality'
  | 'nationality_country_id'
  | 'base_location'
  | 'year_founded'
  | 'accepted_friend_count'
  | 'social_links'
  | 'contact_email'
  | 'contact_email_public'
  | 'email'
> & {
  womens_league_division?: string | null
  mens_league_division?: string | null
}

interface ClubHeroCardProps {
  profile: ClubHeroShape
  readOnly: boolean
  isOwnProfile: boolean
  /** Roster size — drives the Members credibility stat. */
  memberCount?: number | null
  completionPercentage?: number
  completionLoading?: boolean
  completionBuckets?: ProfileStrengthBucket[]
  onBucketAction?: (bucket: ProfileStrengthBucket) => void
  /** Owner CTAs. */
  onEdit?: () => void
  onViewPublic?: () => void
  /** Visitor CTAs (readOnly only). */
  onMessage?: () => void
  sendingMessage?: boolean
  /** Credibility-stat taps. */
  onConnectionsClick?: () => void
  onMembersClick?: () => void
  /** Hide message button for brand viewers, per parent logic. */
  authProfileRole?: string | null
}

// Action-button verb per club bucket id. Defaults to "Add".
const BUCKET_ACTION_LABEL: Record<string, string> = {
  basic: 'Complete',
  logo: 'Add',
  about: 'Add',
  gallery: 'Add',
}

export default function ClubHeroCard({
  profile,
  readOnly,
  isOwnProfile,
  memberCount,
  completionPercentage = 0,
  completionLoading = false,
  completionBuckets,
  onBucketAction,
  onEdit,
  onViewPublic,
  onMessage,
  sendingMessage = false,
  onConnectionsClick,
  onMembersClick,
  authProfileRole,
}: ClubHeroCardProps) {
  const [checklistOpen, setChecklistOpen] = useState(false)
  const friendCount = profile.accepted_friend_count ?? 0
  const isVerified = (profile as { is_verified?: boolean }).is_verified
  const verifiedAt = (profile as { verified_at?: string | null }).verified_at ?? null
  const lastActiveAt = (profile as { last_active_at?: string | null }).last_active_at ?? null
  const showLastActive = (profile as { show_last_active?: boolean | null }).show_last_active ?? null
  const publicContact = derivePublicContactEmail(profile)

  const leagues: string[] = []
  if (profile.womens_league_division) leagues.push(`Women: ${profile.womens_league_division}`)
  if (profile.mens_league_division) leagues.push(`Men: ${profile.mens_league_division}`)

  return (
    <section
      data-testid="club-hero-card"
      className="md:col-span-2 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 md:p-8 overflow-visible"
    >
      {/* Identity row — logo + name */}
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <Avatar
            src={profile.avatar_url}
            initials={getInitials(profile.full_name)}
            size="lg"
            className="!w-20 !h-20 md:!w-24 md:!h-24 !text-2xl"
            alt={profile.full_name ?? undefined}
            enablePreview
            previewTitle={profile.full_name ?? undefined}
            role="club"
          />
          {!readOnly && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Change club logo"
              className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-gray-200 text-[#8026FA] hover:bg-gray-50 transition-colors"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
            {profile.full_name}
            <span className="ml-2 inline-block align-middle">
              <VerifiedBadge verified={isVerified} verifiedAt={verifiedAt} />
            </span>
          </h1>
        </div>
      </div>

      {/* Credibility stats — Connections + Members */}
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2" data-testid="club-hero-stats">
        <CredibilityStat
          icon={Users}
          label="Connections"
          count={friendCount}
          onClick={onConnectionsClick}
          testId="club-hero-connections"
        />
        <CredibilityStat
          icon={UsersRound}
          label="Members"
          count={memberCount ?? 0}
          onClick={onMembersClick}
          testId="club-hero-members"
        />
      </div>

      {/* CTA row */}
      <div className="mt-6 flex items-stretch gap-2">
        {readOnly ? (
          <>
            {/* Primaries share the row in a flex-1 container; the ⋮ menu
                is a flex-shrink-0 sibling pinned right (mirrors
                HeroIdentityCard). items-stretch + h-11 on every control
                keeps Friends / Message / ⋮ one even 44px line, and the
                Friends-dropdown state can shrink+truncate instead of
                overflowing into Message. */}
            <div className="flex-1 flex items-stretch gap-2 min-w-0">
              <FriendshipButton profileId={profile.id} className="flex-1 min-w-0 whitespace-nowrap" />
              {!isOwnProfile && authProfileRole !== 'brand' && onMessage && (
                <button
                  type="button"
                  onClick={onMessage}
                  disabled={sendingMessage}
                  className="flex-1 min-w-0 justify-center whitespace-nowrap inline-flex h-11 items-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
                >
                  {sendingMessage ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0" />
                      Sending...
                    </>
                  ) : (
                    <>
                      <MessageCircle className="w-4 h-4 flex-shrink-0" />
                      Message
                    </>
                  )}
                </button>
              )}
              {isOwnProfile && (
                <ShareProfileButton
                  profile={{ role: 'club', username: profile.username, id: profile.id }}
                />
              )}
            </div>
            {!isOwnProfile && (
              <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this club'} />
            )}
          </>
        ) : (
          <>
            <ShareProfileButton
              profile={{ role: 'club', username: profile.username, id: profile.id }}
            />
            {onViewPublic && (
              <Button
                variant="outline"
                size="sm"
                onClick={onViewPublic}
                className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
              >
                <Eye className="w-4 h-4 flex-shrink-0" />
                <span className="hidden xs:inline">View public profile</span>
                <span className="xs:hidden">View</span>
              </Button>
            )}
            {onEdit && (
              <Button
                variant="primary"
                size="sm"
                onClick={onEdit}
                className="gap-1.5 whitespace-nowrap text-xs sm:text-sm px-2.5 sm:px-4"
              >
                <Edit2 className="w-4 h-4 flex-shrink-0" />
                <span className="hidden xs:inline">Edit profile</span>
                <span className="xs:hidden">Edit</span>
              </Button>
            )}
          </>
        )}
      </div>

      {/* Meta block */}
      <div className="mt-6 pt-6 border-t border-gray-100">
        <div className="space-y-5">
          <div className="flex flex-col gap-2.5 text-sm text-gray-700">
            <MetaRow>
              <CountryDisplay
                countryId={profile.nationality_country_id}
                fallbackText={profile.nationality}
              />
            </MetaRow>

            <MetaRow>
              {profile.base_location && (
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  <span>{profile.base_location}</span>
                </span>
              )}
              {profile.base_location && profile.year_founded && <MetaBullet />}
              {profile.year_founded && (
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <span>Founded {profile.year_founded}</span>
                </span>
              )}
            </MetaRow>

            {leagues.length > 0 && (
              <MetaRow>
                <span className="inline-flex items-center gap-1.5">
                  <Trophy className="w-4 h-4 text-gray-400" />
                  <span>{leagues.join(' · ')}</span>
                </span>
              </MetaRow>
            )}

            {publicContact.shouldShow && publicContact.displayEmail && (
              <MetaRow>
                <a
                  href={`mailto:${publicContact.displayEmail}`}
                  className="inline-flex items-center gap-1.5 hover:text-[#8026FA] transition-colors"
                >
                  <Mail className="w-4 h-4 text-gray-400" />
                  <span>{publicContact.displayEmail}</span>
                </a>
              </MetaRow>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <RoleBadge role="club" />
            {!readOnly && (
              completionLoading ? (
                // Reserve the badge's row footprint while strength loads so the
                // meta row doesn't reflow — and so we never flash a tier
                // computed from the still-understated percentage.
                <span
                  className="inline-block h-5 w-20 rounded-full bg-gray-200 animate-pulse"
                  aria-hidden="true"
                />
              ) : (
                <TierBadge tier={calculateTier(completionPercentage)} />
              )
            )}
            <LastActivePill lastActiveAt={lastActiveAt} showLastActive={showLastActive} />
            <SocialLinksDisplay
              links={profile.social_links as SocialLinks | null | undefined}
              iconSize="sm"
            />
          </div>
        </div>
      </div>

      {/* Progress block — owner only. Rendered from first paint (NOT gated on
          completionLoading) so the hero reserves its full height immediately;
          the arc + percentage show a skeleton until the strength fetch lands,
          which prevents the ~1s in-place growth that shoved the cards below
          (RecruitmentSummaryCard et al.) down on initial load. */}
      {!readOnly && (
        <div className="mt-6 pt-6 border-t border-gray-100">
          <div className="flex items-center gap-5">
            <CompletionArc percentage={completionPercentage} loading={completionLoading} />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-gray-900 leading-tight">
                Club profile complete
              </h3>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                {completionPercentage >= 100
                  ? 'Your club profile is fully built — players and coaches see complete clubs first.'
                  : 'Keep going! A complete club profile attracts more players and coaches.'}
              </p>
            </div>
          </div>

          {completionBuckets && completionBuckets.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setChecklistOpen((o) => !o)}
                aria-expanded={checklistOpen ? 'true' : 'false'}
                aria-controls="club-hero-checklist"
                className="flex w-full items-center justify-center gap-1 text-sm font-medium text-[#8026FA] hover:text-[#6B20D4] transition-colors py-1"
                data-testid="club-hero-checklist-toggle"
              >
                Full checklist
                {checklistOpen ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {checklistOpen && (
                <ul id="club-hero-checklist" className="mt-4 space-y-3" data-testid="club-hero-checklist">
                  {completionBuckets.map((bucket) => (
                    <ChecklistRow key={bucket.id} bucket={bucket} onAction={onBucketAction} />
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function MetaRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1">{children}</div>
}

function MetaBullet() {
  return <span className="text-gray-300" aria-hidden="true">·</span>
}

interface ChecklistRowProps {
  bucket: ProfileStrengthBucket
  onAction?: (bucket: ProfileStrengthBucket) => void
}

function ChecklistRow({ bucket, onAction }: ChecklistRowProps) {
  const actionLabel = BUCKET_ACTION_LABEL[bucket.id] ?? 'Add'
  return (
    <li className="flex items-center gap-3">
      {bucket.completed ? (
        <span
          className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
          aria-hidden="true"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Circle className="h-5 w-5 flex-shrink-0 text-gray-300" aria-hidden="true" />
      )}
      <span
        className={cn(
          'flex-1 text-sm min-w-0',
          bucket.completed ? 'text-gray-600' : 'text-gray-800',
        )}
      >
        {bucket.label}
      </span>
      {bucket.completed ? (
        <span className="flex-shrink-0 inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
          Completed
        </span>
      ) : (
        <button
          type="button"
          onClick={() => onAction?.(bucket)}
          disabled={!onAction}
          className="flex-shrink-0 inline-flex items-center rounded-md border border-[#8026FA]/30 bg-white px-2.5 py-1 text-xs font-medium text-[#8026FA] hover:bg-[#8026FA]/5 transition-colors disabled:opacity-50 disabled:hover:bg-white"
        >
          {actionLabel}
        </button>
      )}
    </li>
  )
}

interface CredibilityStatProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  onClick?: () => void
  testId?: string
}

function CredibilityStat({ icon: Icon, label, count, onClick, testId }: CredibilityStatProps) {
  const ariaLabel = onClick
    ? `View ${count} ${label.toLowerCase()}`
    : `${count} ${label.toLowerCase()}`
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={testId}
      aria-label={ariaLabel}
      className={cn(
        'group inline-flex items-center gap-1.5 whitespace-nowrap text-sm transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8026FA]/30 rounded',
        onClick ? 'cursor-pointer' : 'cursor-default',
      )}
    >
      <Icon className="h-4 w-4 text-[#8026FA]" aria-hidden="true" />
      <span className="text-gray-600">{label}</span>
      <span className="font-bold text-gray-900 tabular-nums">{count}</span>
      {onClick && (
        <ChevronRight
          className="h-3.5 w-3.5 text-gray-300 transition-colors group-hover:text-gray-500"
          aria-hidden="true"
        />
      )}
    </button>
  )
}
