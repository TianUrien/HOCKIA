import { useState } from 'react'
import {
  MapPin, Calendar, Edit2, Eye, MessageCircle, Landmark, Mail, Award,
  Users, Shield, ChevronRight, ChevronDown, ChevronUp, Camera, Check, Circle,
  Bookmark, BookmarkCheck,
} from 'lucide-react'
import { useIsProfileSaved } from '@/hooks/useSavedProfiles'
import {
  Avatar,
  DualNationalityDisplay,
  FriendshipButton,
  LastActivePill,
  RoleBadge,
  SocialLinksDisplay,
  TierBadge,
  VerifiedBadge,
  AvailabilityPill,
} from '@/components'
import Button from '@/components/Button'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import ShareProfileButton from '@/components/profile/ShareProfileButton'
import CompletionArc from './CompletionArc'
import { calculateAge, getInitials } from '@/lib/utils'
import { calculateTier } from '@/lib/profileTier'
import { categoriesToDisplay, categoryToDisplay } from '@/lib/hockeyCategories'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import type { CoachSpecialization } from '@/lib/coachSpecializations'
import { derivePublicContactEmail } from '@/lib/profile'
import { cn } from '@/lib/utils'
import type { Profile } from '@/lib/supabase'
import type { SocialLinks } from '@/lib/socialLinks'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'
import type { ProfileStrengthBucket } from '@/hooks/useProfileStrength'

interface HeroIdentityCardProps {
  profile: PlayerProfileShape
  readOnly: boolean
  isOwnProfile: boolean
  /** Required when readOnly=false. Owner-side completion arc reads this. */
  completionPercentage?: number
  completionLoading?: boolean
  /** Profile-strength buckets — owner only. Powers the expandable
   *  "Full checklist" inside the progress section. */
  completionBuckets?: ProfileStrengthBucket[]
  /** Bucket-action handler — owner only. Triggered when a checklist
   *  item's action button is clicked. */
  onBucketAction?: (bucket: ProfileStrengthBucket) => void
  /** Owner CTAs. */
  onEdit?: () => void
  onViewPublic?: () => void
  /** Visitor CTAs (readOnly only). */
  onMessage?: () => void
  sendingMessage?: boolean
  /** Friends + References tile taps — always provided. References tap
   *  doubles as the trust-badge analytics trigger (the parent's handler
   *  fires `trackReferenceBadgeClick` before navigating). */
  onFriendsClick?: () => void
  onReferencesClick?: () => void
  /** Optional logo for the current club, looked up by parent. */
  currentClubLogo?: string | null
  /** Hide brand badge for brand viewers per existing parent logic. */
  authProfileRole?: string | null
}

export default function HeroIdentityCard({
  profile,
  readOnly,
  isOwnProfile,
  completionPercentage = 0,
  completionLoading = false,
  completionBuckets,
  onBucketAction,
  onEdit,
  onViewPublic,
  onMessage,
  sendingMessage = false,
  onFriendsClick,
  onReferencesClick,
  currentClubLogo,
  authProfileRole,
}: HeroIdentityCardProps) {
  const [checklistOpen, setChecklistOpen] = useState(false)
  const friendCount = profile.accepted_friend_count ?? 0
  const referenceCount = profile.accepted_reference_count ?? 0
  // When another user is viewing this profile, the ScoutingCard (rendered
  // by Player/CoachDashboard above the Hero in the readOnly && !isOwn
  // case) becomes the primary surface for availability + Save + Message.
  // Hide the duplicated chips and recruitment actions from the Hero in
  // that case so the visitor sees ONE source of truth. The owner viewing
  // their own public preview keeps the chips so they can verify what
  // visitors see (no ScoutingCard renders in that case either).
  const isVisitorView = readOnly && !isOwnProfile
  // Save action — only meaningful on the public/visitor view of someone
  // else's profile. Owner sees their own dashboard and brands don't save.
  const savedState = useIsProfileSaved(profile.id)
  const showSaveButton = readOnly && savedState.isAuthenticated && !savedState.isOwnProfile && !isVisitorView
  const age = calculateAge(profile.date_of_birth)
  const positions = [profile.position, profile.secondary_position].filter(
    (value, index, self): value is string => {
      if (!value) return false
      return self.findIndex((item) => item === value) === index
    },
  )
  const publicContact = derivePublicContactEmail(profile)

  // Role-aware Hero — same component renders for player and coach; the
  // meta rows + pills swap per role so a coach sees coaching categories
  // + specialization where a player sees playing category + position.
  const role = (profile.role ?? 'player') as 'player' | 'coach' | 'club' | 'umpire' | 'brand'
  const isCoach = role === 'coach'
  const specializationLabel = isCoach
    ? getSpecializationLabel(
        (profile.coach_specialization ?? null) as CoachSpecialization | null,
        profile.coach_specialization_custom ?? null,
      )
    : null
  const coachingCategoriesLabel = isCoach
    ? categoriesToDisplay(profile.coaching_categories ?? null)
    : null
  const isAvailable = isCoach
    ? profile.open_to_coach === true
    : profile.open_to_play === true
  const isRecruiterMode = isCoach && profile.coach_recruits_for_team === true

  return (
    <section
      data-testid="hero-identity-card"
      className="md:col-span-2 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 md:p-8 overflow-visible"
    >
      {/* TOP ZONE — Identity row only (avatar + name). The Friends /
          References stats live BELOW this row as their own full-width
          line so neither the name nor the stat labels get truncated by
          a narrow right column on mobile. */}
      <div className="flex items-center gap-4">
        <div className="relative flex-shrink-0">
          <Avatar
            src={profile.avatar_url}
            initials={getInitials(profile.full_name)}
            size="lg"
            // 80/96px — small enough on mobile to leave the full name
            // breathing room on the right. `!` wins over the size-prop
            // classes inside Avatar; aspect/rounded base stays.
            className="!w-20 !h-20 md:!w-24 md:!h-24 !text-2xl"
            alt={profile.full_name ?? undefined}
            enablePreview
            previewTitle={profile.full_name ?? undefined}
            role="player"
          />
          {/* Owner-only camera edit affordance. Hidden for visitors. */}
          {!readOnly && onEdit && (
            <button
              type="button"
              onClick={onEdit}
              aria-label="Change profile photo"
              className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-md ring-1 ring-gray-200 text-[#8026FA] hover:bg-gray-50 transition-colors"
            >
              <Camera className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name = primary visual anchor. NO `truncate` — full name must
              always render. If the name happens to be very long it wraps
              naturally to a second line and the badge flows with the last
              word (inline-block on the badge keeps it attached). */}
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 leading-tight">
            {profile.full_name}
            <span className="ml-2 inline-block align-middle">
              <VerifiedBadge
                verified={
                  (profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)
                    ?.is_verified
                }
                verifiedAt={
                  (profile as unknown as { is_verified?: boolean; verified_at?: string | null } | null)
                    ?.verified_at ?? null
                }
              />
            </span>
          </h1>
        </div>
      </div>

      {/* STAT ROW — Connections + References, lightweight inline pattern.
          Renders as a single horizontal row with whitespace-nowrap per
          stat so labels never get clipped on narrow widths. Wraps to a
          second line on very small screens instead of truncating. Both
          pills route to the unified Community hub (May 2026 redesign);
          each one scrolls to the relevant section on arrival via the
          ?section= query param the hub reads on mount. */}
      <div
        className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2"
        data-testid="hero-credibility-tiles"
      >
        <CredibilityStat
          icon={Users}
          label="Connections"
          count={friendCount}
          onClick={onFriendsClick}
          testId="hero-friends-tile"
        />
        <CredibilityStat
          icon={Shield}
          label="References"
          count={referenceCount}
          onClick={onReferencesClick}
          testId="hero-references-tile"
        />
      </div>

      {/* CTA ROW — full-width below the identity zone. Visitor sees
          Message + Connect + Report; owner sees Share + View + Edit.
          Comfortable margin separates it from the identity block. */}
      <div className="mt-6 flex flex-wrap items-center gap-2">
        {readOnly ? (
          <>
            <FriendshipButton profileId={profile.id} />
            {/* Message moved to ScoutingCard for recruiter-context
                viewers. Kept on the own-profile-preview view so the
                owner can still see what visitors normally see. */}
            {!isOwnProfile && !isVisitorView && authProfileRole !== 'brand' && onMessage && (
              <button
                type="button"
                onClick={onMessage}
                disabled={sendingMessage}
                className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
              >
                {sendingMessage ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <MessageCircle className="w-4 h-4" />
                    Message
                  </>
                )}
              </button>
            )}
            {showSaveButton && (
              <button
                type="button"
                onClick={() => void savedState.toggle()}
                disabled={savedState.mutating}
                className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 hover:text-[#8026FA] disabled:opacity-50"
                title={savedState.isSaved ? 'Saved — tap to remove' : 'Save for later'}
              >
                {savedState.isSaved ? (
                  <>
                    <BookmarkCheck className="w-4 h-4 fill-[#8026FA] text-[#8026FA]" />
                    Saved
                  </>
                ) : (
                  <>
                    <Bookmark className="w-4 h-4" />
                    Save
                  </>
                )}
              </button>
            )}
            {isOwnProfile && (
              <ShareProfileButton
                profile={{ role: profile.role as 'player' | 'coach', username: profile.username, id: profile.id }}
              />
            )}
            {!isOwnProfile && (
              <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this user'} />
            )}
          </>
        ) : (
          <>
            <ShareProfileButton
              profile={{ role: profile.role as 'player' | 'coach', username: profile.username, id: profile.id }}
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

      {/* META BLOCK — full-width, separated from the identity zone by a
          soft divider. Metadata rows have generous vertical rhythm so
          the section breathes instead of stacking densely. */}
      <div className="mt-6 pt-6 border-t border-gray-100">
        <div className="space-y-5">
          {/* Identity meta rows. Each line uses the same `MetaRow` shape
              (icon + content, leading-aligned) so icons line up vertically
              across rows. Multi-item lines use a subtle bullet between
              groups. */}
          <div className="flex flex-col gap-2.5 text-sm text-gray-700">
            <MetaRow>
              <DualNationalityDisplay
                primaryCountryId={profile.nationality_country_id}
                secondaryCountryId={profile.nationality2_country_id}
                fallbackText={profile.nationality}
                mode="compact"
              />
            </MetaRow>

            <MetaRow>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-gray-400" />
                <span>{profile.base_location}</span>
              </span>
              {age && (
                <>
                  <MetaBullet />
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-gray-400" />
                    <span>{age} years old</span>
                  </span>
                </>
              )}
            </MetaRow>

            {isCoach
              ? (coachingCategoriesLabel || specializationLabel) && (
                  <MetaRow>
                    {coachingCategoriesLabel && (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span>{coachingCategoriesLabel}</span>
                      </span>
                    )}
                    {coachingCategoriesLabel && specializationLabel && <MetaBullet />}
                    {specializationLabel && (
                      <span className="inline-flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-gray-400" />
                        <span>{specializationLabel}</span>
                      </span>
                    )}
                  </MetaRow>
                )
              : (profile.playing_category || positions.length > 0) && (
                  <MetaRow>
                    {profile.playing_category && (
                      <span className="inline-flex items-center gap-1.5">
                        <Users className="w-4 h-4 text-gray-400" />
                        <span>{categoryToDisplay(profile.playing_category)}</span>
                      </span>
                    )}
                    {profile.playing_category && positions.length > 0 && <MetaBullet />}
                    {positions.length > 0 && (
                      <span className="inline-flex items-center gap-1.5">
                        <span aria-hidden="true">🏑</span>
                        <span className="capitalize">{positions.join(' • ')}</span>
                      </span>
                    )}
                  </MetaRow>
                )}

            {profile.current_club && (
              <MetaRow>
                <span className="inline-flex items-center gap-1.5 min-w-0">
                  {currentClubLogo ? (
                    <img
                      src={currentClubLogo}
                      alt=""
                      className="w-4 h-4 rounded-full object-cover flex-shrink-0"
                    />
                  ) : (
                    <Landmark className="w-4 h-4 text-gray-400 flex-shrink-0" />
                  )}
                  <span className="truncate">{profile.current_club}</span>
                </span>
              </MetaRow>
            )}

            {profile.brand_representation && (
              <MetaRow>
                <span className="inline-flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-gray-400" />
                  <span>{profile.brand_representation}</span>
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

          {/* Pills row — role-aware. RoleBadge follows profile.role so
              coach profiles show "Coach"; AvailabilityPill swaps to the
              "coach" variant when the user is open_to_coach.
              Recruiter mode adds a small badge so clubs/players can
              instantly see this coach actively recruits. */}
          <div className="flex flex-wrap items-center gap-2.5">
            <RoleBadge role={role} />
            {!readOnly && !completionLoading && (
              <TierBadge tier={calculateTier(completionPercentage)} />
            )}
            {/* Activity + availability pills hidden in the visitor view
                — ScoutingCard's Zone 1 (rendered above by Player/Coach
                Dashboard) is the single prominent status surface for
                recruiters. Kept on owner + own-profile-preview views. */}
            {!isVisitorView && (
              <>
                <LastActivePill
                  lastActiveAt={(profile as Partial<Profile> | null)?.last_active_at ?? null}
                  showLastActive={
                    (profile as { show_last_active?: boolean | null } | null)?.show_last_active ?? null
                  }
                />
                {isAvailable && (
                  <AvailabilityPill variant={isCoach ? 'coach' : 'play'} />
                )}
              </>
            )}
            {isRecruiterMode && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#8026FA]/10 px-2.5 py-1 text-[11px] font-semibold text-[#8026FA]">
                <Users className="h-3 w-3" />
                Recruiting players
              </span>
            )}
            <SocialLinksDisplay
              links={profile.social_links as SocialLinks | null | undefined}
              iconSize="sm"
            />
          </div>
        </div>
      </div>

      {/* PROGRESS BLOCK — owner only. Sits at the very bottom of the Hero
          card, separated from the metadata block by a soft divider.
          Layout: arc on the left, heading + tagline on the right.
          Below: a collapsed "Full checklist" toggle that expands the
          per-bucket progress list inline. Replaces the standalone
          NextStepCard so the dashboard stays compact. */}
      {!readOnly && !completionLoading && (
        <div className="mt-6 pt-6 border-t border-gray-100">
          <div className="flex items-center gap-5">
            <CompletionArc percentage={completionPercentage} />
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-gray-900 leading-tight">
                Profile complete
              </h3>
              <p className="mt-1.5 text-sm text-gray-500 leading-relaxed">
                {completionPercentage >= 100
                  ? 'Your profile is fully built — clubs see updated profiles first.'
                  : 'Keep it up! A complete profile helps you get more visibility.'}
              </p>
            </div>
          </div>

          {/* Full checklist accordion — collapsed by default so the Hero
              stays light. Tap to expand the per-bucket list with
              completed / action states. */}
          {completionBuckets && completionBuckets.length > 0 && (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setChecklistOpen((o) => !o)}
                aria-expanded={checklistOpen ? 'true' : 'false'}
                aria-controls="hero-profile-checklist"
                className="flex w-full items-center justify-center gap-1 text-sm font-medium text-[#8026FA] hover:text-[#6B20D4] transition-colors py-1"
                data-testid="hero-checklist-toggle"
              >
                Full checklist
                {checklistOpen ? (
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {checklistOpen && (
                <ul
                  id="hero-profile-checklist"
                  className="mt-4 space-y-3"
                  data-testid="hero-checklist"
                >
                  {completionBuckets.map((bucket) => (
                    <ChecklistRow
                      key={bucket.id}
                      bucket={bucket}
                      onAction={onBucketAction}
                    />
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

// Per-bucket action label mapping for the checklist. Defaults to "Add"
// when a bucket id isn't listed. Kept close to the UI since these are
// verb choices for buttons, not data semantics.
const BUCKET_ACTION_LABEL: Record<string, string> = {
  'basic-info': 'Complete',
  'profile-photo': 'Add',
  'highlight-video': 'Add',
  'full-match-footage': 'Upload',
  'journey': 'Add',
  'media-gallery': 'Add',
  'friends': 'Connect',
  'references': 'Request',
  'availability': 'Update',
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
        <Circle
          className="h-5 w-5 flex-shrink-0 text-gray-300"
          aria-hidden="true"
        />
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

/** Single metadata row — icon + content, flex-wraps on narrow widths. */
function MetaRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {children}
    </div>
  )
}

/** Subtle dot separator between groups on the same metadata row. */
function MetaBullet() {
  return <span className="text-gray-300" aria-hidden="true">·</span>
}

interface CredibilityStatProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  count: number
  onClick?: () => void
  testId?: string
}

/**
 * Lightweight inline credibility stat (Instagram-style row). Icon, label,
 * count + small chevron on one line. No background, no border, no boxed
 * container — the whole element is the tap target. Reads as a subtle
 * indicator that never competes with the name above it.
 *
 * whitespace-nowrap keeps "Friends 10" together as one wrap unit; the
 * parent's gap-x lets two stats sit side-by-side and drop to a second
 * line only when the viewport is genuinely too narrow.
 */
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
