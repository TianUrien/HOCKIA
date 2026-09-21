import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Check, ChevronLeft, MapPin, MessageCircle, Settings, Share, Shield, Sparkles, Target, UserPlus } from 'lucide-react'
import { Avatar, DualNationalityDisplay, LastActivePill, VerifiedBadge } from '@/components'
import ProfileActionMenu from '@/components/ProfileActionMenu'
import SettingsSheet from '@/components/SettingsSheet'
import SignInPromptModal from '@/components/SignInPromptModal'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useFriendship } from '@/hooks/useFriendship'
import { useCoverPhoto } from '@/hooks/useCoverPhoto'
import { getInitials } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'
import { categoriesToDisplay, categoryToDisplay } from '@/lib/hockeyCategories'
import { getSpecializationLabel } from '@/lib/coachSpecializations'
import type { CoachSpecialization } from '@/lib/coachSpecializations'
import { publicProfileShareUrl } from '@/lib/profileShare'
import { SOCIAL_PLATFORMS, type SocialLinks, type SocialPlatform } from '@/lib/socialLinks'
import { humanizeToken, roleLabel } from '@/lib/identity'
import { logger } from '@/lib/logger'
import type { Profile } from '@/lib/supabase'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'

interface HeroIdentityCardProps {
  profile: PlayerProfileShape
  readOnly: boolean
  isOwnProfile: boolean
  /** Owner CTAs. */
  onEdit?: () => void
  onViewPublic?: () => void
  /** Visitor CTAs (readOnly only). */
  onMessage?: () => void
  sendingMessage?: boolean
  /** Stats strip — each number opens the complete collection. */
  onFriendsClick?: () => void
  onReferencesClick?: () => void
  onCareerClick?: () => void
  onVideosClick?: () => void
  /** Highlights + full matches + reels, once the long scroll has counted them. */
  videoTotal?: number | null
  /** Optional logo for the current club, looked up by parent. */
  currentClubLogo?: string | null
  /** Hide brand badge for brand viewers per existing parent logic. */
  authProfileRole?: string | null
}

const SOCIAL_COLORS: Record<SocialPlatform, string> = {
  instagram: 'text-[#e1306c]',
  tiktok: 'text-ink-1',
  facebook: 'text-[#1877f2]',
  linkedin: 'text-[#0a66c2]',
  twitter: 'text-ink-1',
}

const GLASS = 'flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink-1 shadow-sm backdrop-blur'

/**
 * Identity block at the top of the Profile screen (Figma Profile v2 owner /
 * v3 public — one screen, two modes). Cover photo with glass buttons
 * (owner: camera · share · gear; visitor: back · share), the avatar ring
 * overlapping the cover with the "Open to play" pill beside it, name,
 * "Player · Midfielder, Defender" with coloured social glyphs, nationality ·
 * base, tags (club, specialist skills, brand), Edit profile / Public view or
 * Add friend / Message, then the four-cell stats strip whose numbers open
 * the complete collections. No Level, no @handle, no Save.
 */
export default function HeroIdentityCard({
  profile,
  readOnly,
  isOwnProfile,
  onEdit,
  onViewPublic,
  onMessage,
  sendingMessage = false,
  onFriendsClick,
  onReferencesClick,
  onCareerClick,
  onVideosClick,
  videoTotal,
  currentClubLogo,
  authProfileRole,
}: HeroIdentityCardProps) {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const coverPhoto = useCoverPhoto(profile.id)
  const friendship = useFriendship(profile.id)
  const [signIn, setSignIn] = useState<'connect' | null>(null)

  const isVisitorView = readOnly && !isOwnProfile
  const isOwnerView = !readOnly
  const role = (profile.role ?? 'player') as 'player' | 'coach' | 'club' | 'umpire' | 'brand'
  const isCoach = role === 'coach'
  const full = profile as Partial<Profile>

  const positions = [profile.position, profile.secondary_position]
    .filter((v, i, self): v is string => Boolean(v) && self.indexOf(v) === i)
    .map((p) => humanizeToken(p) ?? p)
  const specializationLabel = isCoach
    ? getSpecializationLabel((profile.coach_specialization ?? null) as CoachSpecialization | null, profile.coach_specialization_custom ?? null)
    : null
  const coachingCategoriesLabel = isCoach ? categoriesToDisplay(profile.coaching_categories ?? null) : null
  const detail = isCoach
    ? [specializationLabel, coachingCategoriesLabel].filter(Boolean).join(' · ')
    : [positions.join(', '), profile.playing_category ? categoryToDisplay(profile.playing_category) : null].filter(Boolean).join(' · ')
  const roleLine = detail ? `${roleLabel(role)} · ${detail}` : roleLabel(role)

  const isAvailable = isCoach ? profile.open_to_coach === true : profile.open_to_play === true
  const availabilityLabel = isCoach ? 'Open to coach' : 'Open to play'
  const isRecruiterMode = isCoach && profile.coach_recruits_for_team === true

  const socials = (full.social_links ?? null) as SocialLinks | null
  const socialEntries = SOCIAL_PLATFORMS.filter((p) => socials?.[p.key]?.trim())
  const specialistSkills = (full.specialist_skills ?? []).slice(0, 3)
  const brandRepresentation = full.brand_representation?.trim() || null
  const worldClubId = full.current_world_club_id ?? null

  const friendCount = profile.accepted_friend_count ?? 0
  const referenceCount = profile.accepted_reference_count ?? 0
  const careerCount = full.career_entry_count ?? 0
  const videoCount = videoTotal ?? (full.highlight_video_url ? 1 : 0) + (full.full_game_video_count ?? 0)

  const share = async () => {
    const url = publicProfileShareUrl(profile.role, profile.id, profile.username)
    if (!url) return
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: profile.full_name ?? 'HOCKIA profile', url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) logger.warn('[HeroIdentityCard] share failed', err)
    }
  }

  const addFriend = () => {
    if (!user) { setSignIn('connect'); return }
    if (friendship.isIncomingRequest) void friendship.acceptRequest()
    else if (!friendship.isFriend && !friendship.isOutgoingRequest) void friendship.sendRequest()
  }
  const friendButton = (() => {
    if (!isVisitorView) return null
    if (friendship.isFriend) return { label: 'Friends', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-positive-soft text-positive', disabled: true }
    if (friendship.isOutgoingRequest) return { label: 'Requested', icon: <Check className="h-[18px] w-[18px]" strokeWidth={2.5} />, cls: 'bg-surface-grouped text-ink-2', disabled: true }
    if (friendship.isIncomingRequest) return { label: 'Accept', icon: <UserPlus className="h-[18px] w-[18px]" strokeWidth={2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
    return { label: 'Add friend', icon: <UserPlus className="h-[18px] w-[18px]" strokeWidth={2} />, cls: 'bg-hockia-primary text-white', disabled: friendship.mutating }
  })()

  const stat = (value: number, label: string, onClick?: () => void) => (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="flex flex-1 flex-col items-center gap-0.5 py-3 text-center active:bg-gray-200/60 first:rounded-l-card last:rounded-r-card"
      aria-label={`${value} ${label}`}
    >
      <span className="text-[20px] font-semibold leading-6 text-ink-1 tabular-nums">{value}</span>
      <span className="text-caption text-ink-2">{label}</span>
    </button>
  )

  const coverUrl = coverPhoto ? getImageUrl(coverPhoto, 'lightbox') ?? coverPhoto : null

  return (
    <section data-testid="hero-identity-card" className="-mx-4 md:mx-0 md:overflow-hidden md:rounded-2xl md:border md:border-gray-200/80 md:bg-white md:shadow-sm">
      {/* Cover */}
      <div className="relative h-[236px] w-full overflow-hidden bg-gradient-to-b from-hockia-soft to-white">
        {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" decoding="async" />}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/35 to-transparent" aria-hidden="true" />
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-[max(env(safe-area-inset-top),0.75rem)] lg:pt-3">
          {isOwnerView ? (
            <button type="button" onClick={onEdit} aria-label="Change cover photo" className={GLASS}>
              <Camera className="h-[18px] w-[18px]" strokeWidth={1.6} />
            </button>
          ) : (
            <button type="button" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/community'))} aria-label="Back" className={GLASS}>
              <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
            </button>
          )}
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void share()} aria-label="Share profile" className={GLASS}>
              <Share className="h-[18px] w-[18px]" strokeWidth={1.6} />
            </button>
            {isOwnerView && (
              <>
                {/* Phone: the gear opens the Settings hub. Desktop keeps the sheet. */}
                <button type="button" onClick={() => navigate('/settings')} aria-label="Settings" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink-1 shadow-sm backdrop-blur lg:hidden">
                  <Settings className="h-[18px] w-[18px]" strokeWidth={1.6} />
                </button>
                <span className="hidden lg:inline-flex"><SettingsSheet className="!h-9 !w-9 !min-h-0 !min-w-0 !rounded-full !bg-white/90 !text-ink-1 shadow-sm backdrop-blur" /></span>
              </>
            )}
            {isVisitorView && <ProfileActionMenu targetId={profile.id} targetName={profile.full_name ?? 'this user'} />}
          </div>
        </div>
      </div>

      {/* Identity */}
      <div className="px-5">
        <div className="-mt-[52px] flex items-end gap-3">
          <div className="relative flex h-[104px] w-[104px] shrink-0 items-center justify-center rounded-full bg-white">
            <Avatar
              src={profile.avatar_url}
              initials={getInitials(profile.full_name)}
              size="xl"
              className="!h-24 !w-24 !text-3xl"
              alt={profile.full_name ?? undefined}
              loading="eager"
              fetchPriority="high"
              enablePreview
              previewTitle={profile.full_name ?? undefined}
              role="player"
            />
            {isOwnerView && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label="Change profile photo"
                className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-hockia-primary text-white ring-2 ring-white"
              >
                <Camera className="h-4 w-4" strokeWidth={1.6} />
              </button>
            )}
          </div>
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
            {(isAvailable || isRecruiterMode) && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-positive-soft px-3 py-[7px] text-secondary font-semibold text-[#1b8a3f]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1b8a3f]" aria-hidden="true" />
                {isRecruiterMode ? 'Recruiting' : availabilityLabel}
              </span>
            )}
            {/* "Active today" — Settings › Privacy › show_last_active drives it (DEV NOTE). */}
            <LastActivePill lastActiveAt={full.last_active_at ?? null} showLastActive={full.show_last_active ?? null} />
          </div>
        </div>

        <h1 className="mt-2 text-[26px] font-bold leading-[31px] text-ink-1">
          {profile.full_name}
          <span className="ml-1.5 inline-block align-middle">
            <VerifiedBadge verified={full.is_verified} verifiedAt={full.verified_at ?? null} />
          </span>
        </h1>

        <div className="mt-1.5 flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-row text-ink-2" data-testid="hero-role-line">{roleLine}</p>
          {socialEntries.length > 0 && (
            <div className="flex shrink-0 items-center gap-1">
              {socialEntries.map((p) => {
                const Icon = p.icon
                const href = socials?.[p.key] as string
                const cls = `flex h-7 w-7 items-center justify-center ${SOCIAL_COLORS[p.key]}`
                return isOwnerView ? (
                  <button key={p.key} type="button" onClick={onEdit} aria-label={`Edit ${p.label}`} className={cls}><Icon className="h-[19px] w-[19px]" /></button>
                ) : (
                  <a key={p.key} href={href} target="_blank" rel="noopener noreferrer" aria-label={p.label} className={cls}><Icon className="h-[19px] w-[19px]" /></a>
                )
              })}
            </div>
          )}
        </div>

        <p className="mt-1.5 flex flex-wrap items-center gap-x-3.5 text-[14px] leading-[18px] text-ink-1">
          <DualNationalityDisplay
            primaryCountryId={profile.nationality_country_id}
            secondaryCountryId={profile.nationality2_country_id}
            fallbackText={profile.nationality}
            mode="line"
          />
          {profile.base_location && (
            <span className="inline-flex min-w-0 items-center gap-1 text-ink-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" strokeWidth={1.6} />
              <span className="truncate">{profile.base_location}</span>
            </span>
          )}
        </p>

        {(profile.current_club || specialistSkills.length > 0 || brandRepresentation) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {profile.current_club && (
              <button
                type="button"
                onClick={worldClubId ? () => navigate(`/world/clubs/${worldClubId}`) : undefined}
                className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-grouped pl-2 pr-3 text-secondary font-semibold text-ink-1"
              >
                {currentClubLogo ? (
                  <img src={getImageUrl(currentClubLogo, 'card-thumb') ?? currentClubLogo} alt="" className="h-[15px] w-[15px] rounded-[3px] object-contain" />
                ) : (
                  <Shield className="h-[15px] w-[15px]" strokeWidth={1.4} />
                )}
                {profile.current_club}
              </button>
            )}
            {specialistSkills.map((skill) => (
              <span key={skill} className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-grouped pl-2 pr-3 text-secondary font-semibold text-ink-1">
                <Target className="h-[15px] w-[15px]" strokeWidth={1.4} />
                {humanizeToken(skill)}
              </span>
            ))}
            {brandRepresentation && authProfileRole !== 'brand' && (
              <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-hockia-soft pl-2 pr-3 text-secondary font-semibold text-hockia-primary">
                <Sparkles className="h-[15px] w-[15px]" strokeWidth={1.4} />
                {brandRepresentation}
              </span>
            )}
          </div>
        )}

        <div className="mt-4 flex items-stretch gap-2.5">
          {isOwnerView ? (
            <>
              <button type="button" onClick={onEdit} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-hockia-primary text-[16px] font-semibold text-white active:opacity-90">
                Edit profile
              </button>
              <button type="button" onClick={onViewPublic} className="flex h-[46px] flex-1 items-center justify-center rounded-full bg-surface-grouped text-[16px] font-semibold text-ink-1 active:bg-gray-200">
                Public view
              </button>
            </>
          ) : isVisitorView ? (
            <>
              {friendButton && (
                <button type="button" onClick={addFriend} disabled={friendButton.disabled} className={`flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-full text-[16px] font-semibold ${friendButton.cls} disabled:opacity-100`}>
                  {friendButton.icon} {friendButton.label}
                </button>
              )}
              {authProfileRole !== 'brand' && onMessage && (
                <button type="button" onClick={onMessage} disabled={sendingMessage} className="flex h-[46px] flex-1 items-center justify-center gap-1.5 rounded-full bg-surface-grouped text-[16px] font-semibold text-ink-1 disabled:opacity-60">
                  <MessageCircle className="h-[18px] w-[18px]" strokeWidth={1.8} /> {sendingMessage ? 'Opening…' : 'Message'}
                </button>
              )}
            </>
          ) : null}
        </div>

        {/* Stats strip — the number opens the complete collection. */}
        <div className="mt-3.5 flex divide-x divide-line rounded-card bg-surface-grouped">
          {stat(friendCount, 'Friends', onFriendsClick)}
          {stat(referenceCount, 'References', onReferencesClick)}
          {stat(careerCount, 'Career', onCareerClick)}
          {stat(videoCount, 'Videos', onVideosClick)}
        </div>
      </div>

      <SignInPromptModal isOpen={signIn !== null} onClose={() => setSignIn(null)} title="Sign in to add friends" action="connect" />
    </section>
  )
}
