import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ExternalLink, Flag, Heart, Lock, Plus, Target } from 'lucide-react'
import { useProfileScrollData, type ScrollCareerEntry, type ScrollFullGameLink, type ScrollVideo } from '@/hooks/useProfileScrollData'
import { LockedVideoTile, ProfileVideoTile } from './ProfileVideoTile'
import { VideoAccessSheets, type VideoBlock } from './VideoAccessSheets'
import { useAuthStore } from '@/lib/auth'
import { isRecruiterProfile, fullMatchVisibilityOf } from '@/lib/recruiter'
import { useVideoAccessSummary } from '@/hooks/useVideoAccessSummary'
import { useTrustedReferences, type PublicReferenceCard } from '@/hooks/useTrustedReferences'
import { useCountries } from '@/hooks/useCountries'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { PostComposerModal } from '@/components/home/PostComposerModal'
import { getImageUrl, getImageSrcSet } from '@/lib/imageUrl'
import { SmoothImage } from '@/components/ui/SmoothImage'
import { humanizeToken, identityLine } from '@/lib/identity'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { RELOCATION_LABEL } from '@/lib/candidateIntent'
import { careerSpan, isCurrentEntry } from '@/lib/careerCopy'
import { cn } from '@/lib/utils'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'
import type { UserPostFeedItem } from '@/types/homeFeed'

/**
 * Phone profile long scroll under the identity block and the six key facts
 * (Figma D2.1 club view / D2.2 owner): Videos · Career · Specialist skills ·
 * References · Friends · Photos · Posts · About (founder ruling 2026-09-26 —
 * no Profile-strength card, no stats strip; Friends is a row; About drops the
 * rows the key facts already show). Every section is a preview; "See all N"
 * opens the complete collection. Owner verbs (Ask for a reference, Add photos,
 * New post) are the empty-state rows only, and the tools live inside the leaf
 * screens. Public mode is read-only and viewer-relative (RLS already fences
 * recruiters-only rows). Club-only cards come in through the slots.
 */
interface ProfileLongScrollProps {
  profile: PlayerProfileShape
  readOnly: boolean
  onEdit: () => void
  onOpenVideos: () => void
  /** Owner's Video › Manage → Manage media. */
  onManageVideos: () => void
  onOpenReferences: () => void
  /** A reference card opens that reference's detail. */
  onOpenReference: (referenceId: string) => void
  onOpenCareer: () => void
  onOpenPhotos: () => void
  onOpenPosts: () => void
  /** Friends row → the Friends leaf. */
  onOpenFriends: () => void
  /** Owner: Specialist skills empty row → the skills editor. */
  onEditSkills?: () => void
  /** Video counts once loaded — the Video key fact reads them. */
  onVideoCounts?: (counts: { total: number; highlights: number; fullMatches: number }) => void
  /** Club view: "Applied to …" sits above Videos. */
  topSlot?: ReactNode
  /** Club view: "Fit for this role" sits between Videos and Career (Figma D2.1). */
  afterVideosSlot?: ReactNode
}

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthYear(iso: string | null | undefined): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `${MONTH[d.getMonth()]} ${d.getFullYear()}`
}
function duration(s: number | null | undefined): string | null {
  if (!s || s <= 0) return null
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}

function SectionHeader({ title, count, action, onAction }: { title: string; count?: number | null; action?: string | null; onAction?: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-[20px] font-bold leading-6 text-ink-1">
        {title}
        {typeof count === 'number' && <span className="font-semibold text-ink-3"> · {count}</span>}
      </h2>
      {action && (
        <button type="button" onClick={onAction} className="flex items-center gap-0.5 text-row font-semibold text-hockia-primary">
          {action}
          {action.startsWith('See all') && <ChevronRight className="h-4 w-4" strokeWidth={2} />}
        </button>
      )}
    </div>
  )
}

function LinkTile({ link }: { link: ScrollFullGameLink }) {
  const title = link.match_title?.trim() || (link.opponent_team ? `vs ${link.opponent_team}` : 'Full match')
  return (
    <a
      href={link.video_url}
      target="_blank"
      rel="noopener noreferrer"
      className="relative flex h-[126px] w-[224px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-card bg-gradient-to-br from-ink-1 to-ink-2 p-2.5 text-left"
    >
      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
      {link.visibility === 'recruiters' && (
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><Lock className="h-3 w-3" strokeWidth={2.2} /></span>
      )}
      <span className="truncate text-secondary font-semibold text-white">{title}</span>
      {link.match_date && <span className="text-caption text-white/75">{monthYear(link.match_date)}</span>}
    </a>
  )
}

function VideoRow({ label, count, lockLabel, children }: { label: string; count: number; lockLabel?: string | null; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="text-row font-semibold text-ink-1">{label}</span>
        <span className="text-row text-ink-3">{count}</span>
        {lockLabel && (
          <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-grouped px-2 text-caption font-semibold text-ink-2">
            <Lock className="h-3 w-3" strokeWidth={2.2} /> {lockLabel}
          </span>
        )}
      </div>
      <div className="-mx-5 mt-2.5 flex snap-x scroll-pl-5 gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">{children}</div>
    </div>
  )
}

export function ReferenceCard({ reference, onOpen }: { reference: PublicReferenceCard; onOpen: () => void }) {
  const p = reference.profile
  const name = p?.fullName?.trim() || 'Hockia member'
  const detail = p?.role === 'player' ? p.position : p?.role === 'coach' ? [humanizeToken(reference.relationshipType), p.currentClub].filter(Boolean).join(' · ') : humanizeToken(reference.relationshipType)
  const avatar = p?.avatarUrl ? getImageUrl(p.avatarUrl, 'avatar-md') ?? p.avatarUrl : null
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-card border border-gold-line bg-white p-3.5 text-left">
      <div className="flex items-center gap-3">
        <EntityAvatar src={avatar} name={name} role={p?.role} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-row font-semibold text-ink-1">{name}</p>
          <p className="truncate text-secondary text-ink-2">{identityLine(p?.role, detail)}</p>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />
      </div>
      {reference.endorsementText && <p className="mt-2.5 line-clamp-3 text-row leading-[21px] text-ink-1">“{reference.endorsementText}”</p>}
      <div className="mt-2.5 flex items-center justify-between">
        <span className="flex items-center gap-1 text-caption font-semibold text-gold"><Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Verified · written on Hockia</span>
        {reference.acceptedAt && <span className="text-caption text-ink-3">{monthYear(reference.acceptedAt)}</span>}
      </div>
    </button>
  )
}

export function CareerRow({ entry, last, flag }: { entry: ScrollCareerEntry; last: boolean; flag: string | null }) {
  const isNow = isCurrentEntry(entry)
  const isRep = entry.entryType === 'national_team'
  const span = careerSpan(entry)
  const metaFlag = entry.worldClub?.flag ?? flag
  const metaText = [entry.locationCity?.trim() || entry.locationCountry?.trim() || null, span].filter(Boolean).join(' · ')
  const meta = [metaFlag, metaText].filter(Boolean).join(' ')
  const sub = [entry.positionRole?.trim() ? humanizeToken(entry.positionRole) : null, isRep ? 'representative team' : entry.divisionLeague?.trim() || null].filter(Boolean).join(' · ')
  const crest = entry.worldClub?.avatar_url ? getImageUrl(entry.worldClub.avatar_url, 'avatar-sm') ?? entry.worldClub.avatar_url : null
  return (
    <div className="flex gap-3">
      <div className="flex w-10 shrink-0 flex-col items-center">
        {isRep && !crest ? (
          <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-hockia-soft text-hockia-primary"><Flag className="h-[18px] w-[18px]" strokeWidth={2} /></span>
        ) : (
          <EntityAvatar src={crest} name={entry.clubName} role="club" size={40} />
        )}
        {!last && <span className="mt-1 w-px flex-1 bg-line" />}
      </div>
      <div className={cn('min-w-0 flex-1', !last && 'pb-4')}>
        <div className="flex items-center gap-2">
          <p className="truncate text-row font-semibold text-ink-1">{entry.clubName}</p>
          {isNow && <span className="shrink-0 rounded-full bg-positive-soft px-2 py-0.5 text-caption font-semibold text-positive">Now</span>}
        </div>
        {sub && <p className="truncate text-secondary text-ink-2">{sub}</p>}
        {meta && <p className="truncate text-secondary text-ink-3">{meta}</p>}
      </div>
    </div>
  )
}

export function PostTile({ post, onOpen }: { post: UserPostFeedItem; onOpen: () => void }) {
  const first = post.images?.find((m) => m.url || m.thumb_url)
  const src = first ? (first.media_type === 'video' ? first.thumb_url ?? null : getImageUrl(first.url ?? null, 'feed-thumb') ?? first.url ?? null) : null
  return (
    <button type="button" onClick={onOpen} className="w-[168px] shrink-0 snap-start text-left">
      <div className="flex h-[124px] w-full items-end overflow-hidden rounded-card bg-surface-grouped">
        {src ? <SmoothImage src={src} alt="" eager className="object-cover" /> : <p className="line-clamp-4 p-3 text-secondary text-ink-2">{post.content}</p>}
      </div>
      {src && post.content && <p className="mt-1.5 line-clamp-2 text-secondary leading-[17px] text-ink-1">{post.content}</p>}
      <p className="mt-1 flex items-center gap-1 text-caption text-ink-3"><Heart className="h-3 w-3" /> {post.like_count} · {monthYear(post.created_at)}</p>
    </button>
  )
}

function FactRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-2.5">
      <span className="w-[92px] shrink-0 text-row text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-row text-ink-1">{value}</span>
    </div>
  )
}

export default function ProfileLongScroll({ profile, readOnly, onEdit, onOpenVideos, onManageVideos, onOpenReferences, onOpenReference, onOpenCareer, onOpenPhotos, onOpenPosts, onOpenFriends, onEditSkills, onVideoCounts, topSlot, afterVideosSlot }: ProfileLongScrollProps) {
  const navigate = useNavigate()
  const owner = !readOnly
  const profileId = profile.id ?? null
  const data = useProfileScrollData(profileId)
  const { acceptedReferences, loading: refsLoading } = useTrustedReferences(profileId ?? '')
  const { countries } = useCountries()
  const [player, setPlayer] = useState<ScrollVideo | null>(null)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [composer, setComposer] = useState(false)

  // Full-match privacy (Phase 1 · step 3): the owner's master switch decides
  // the lock label; for everyone else it is what the rows say, plus the
  // rows RLS hid from them (counted by get_video_access_summary).
  const viewer = useAuthStore((st) => st.profile)
  const signedIn = useAuthStore((st) => Boolean(st.user))
  const canWatchLocked = owner || isRecruiterProfile(viewer)
  const access = useVideoAccessSummary(profileId, { enabled: !owner })
  const lockFullMatches = owner
    ? fullMatchVisibilityOf(profile) === 'recruiters'
    : access.lockedFullMatches > 0 || data.fullMatches.some((v) => v.visibility === 'recruiters') || data.fullGameLinks.some((l) => l.visibility === 'recruiters')
  const lockedFull = owner ? 0 : access.lockedFullMatches
  const lockedHighlights = owner ? 0 : access.lockedHighlights
  const [videoBlock, setVideoBlock] = useState<VideoBlock>(null)
  const showLocked = () => setVideoBlock(signedIn ? 'locked' : 'join')
  const openVideo = (v: ScrollVideo, locked: boolean) => {
    if (!signedIn && !owner) setVideoBlock('join')
    else if (locked && !canWatchLocked) setVideoBlock('locked')
    else setPlayer(v)
  }
  const highlightCount = data.highlights.length + (profile.highlight_video_url ? 1 : 0) + lockedHighlights
  const fullMatchCount = data.fullMatches.length + data.fullGameLinks.length + lockedFull
  const videoTotal = highlightCount + fullMatchCount + data.reels.length
  useEffect(() => {
    if (!data.loading) onVideoCounts?.({ total: videoTotal, highlights: highlightCount, fullMatches: fullMatchCount })
  }, [data.loading, videoTotal, highlightCount, fullMatchCount, onVideoCounts])
  const referenceCount = profile.accepted_reference_count ?? acceptedReferences.length
  const careerCount = profile.career_entry_count ?? data.career.length

    // Passports, availability and age are key facts now — About keeps the rest.
  const category = categoryToDisplay(profile.playing_category) || null
  const relocation = profile.relocation_willingness ? RELOCATION_LABEL[profile.relocation_willingness] ?? null : null
  const bio = profile.bio?.trim() || null
  const hasAbout = Boolean(bio || category || relocation)
  const skills = (profile.specialist_skills ?? []).filter(Boolean)
  const friendCount = profile.accepted_friend_count ?? 0

  const showVideo = owner || videoTotal > 0
  // Visitors see an empty References section too (Figma D2.1) — it says where references come from.
  const showReferences = true
  const showCareer = owner || careerCount > 0
  const showSkills = owner || skills.length > 0
  const showFriends = owner || friendCount > 0
  const showPhotos = owner || data.photos.length > 0
  const showPosts = owner || data.posts.length > 0

  const empty = (text: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex h-[52px] w-full items-center justify-between rounded-card bg-surface-grouped px-4 text-row text-ink-2">
      {text} <Plus className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} />
    </button>
  )

  return (
    <div className="flex flex-col gap-7 px-5 pb-6 pt-1" data-testid="profile-long-scroll">
      {topSlot}

      {showVideo && (
        <section className="flex flex-col gap-4" data-testid="profile-video-section">
          <SectionHeader title="Videos" action={videoTotal > 0 ? `See all ${videoTotal}` : owner ? 'Manage' : null} onAction={videoTotal > 0 ? onOpenVideos : onManageVideos} />
          {videoTotal === 0 && !data.loading && empty('Add your first highlight', onManageVideos)}
          {highlightCount > 0 && (
            <VideoRow label="Highlights" count={highlightCount}>
              {data.highlights.map((v, i) => <ProfileVideoTile key={v.id} video={v} locked={v.visibility === 'recruiters'} canWatch={canWatchLocked} eager={i < 2} priority={i === 0} onOpen={() => openVideo(v, v.visibility === 'recruiters')} className="h-[126px] w-[224px] shrink-0 snap-start" />)}
              {profile.highlight_video_url && (
                <a href={profile.highlight_video_url} target="_blank" rel="noopener noreferrer" className="relative flex h-[126px] w-[224px] shrink-0 snap-start flex-col justify-end rounded-card bg-gradient-to-br from-ink-1 to-ink-2 p-2.5">
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
                  <span className="text-secondary font-semibold text-white">Linked highlight</span>
                </a>
              )}
              {Array.from({ length: lockedHighlights }, (_, i) => <LockedVideoTile key={`locked-h-${i}`} label="Highlight" onOpen={showLocked} className="h-[126px] w-[224px] shrink-0 snap-start" />)}
            </VideoRow>
          )}
          {fullMatchCount > 0 && (
            <VideoRow label="Full matches" count={fullMatchCount} lockLabel={lockFullMatches ? 'Clubs & coaches' : null}>
              {data.fullMatches.map((v, i) => <ProfileVideoTile key={v.id} video={v} locked={lockFullMatches || v.visibility === 'recruiters'} canWatch={canWatchLocked} eager={i < 2} onOpen={() => openVideo(v, lockFullMatches || v.visibility === 'recruiters')} className="h-[126px] w-[224px] shrink-0 snap-start" />)}
              {data.fullGameLinks.map((l) => <LinkTile key={l.id} link={l} />)}
              {Array.from({ length: lockedFull }, (_, i) => <LockedVideoTile key={`locked-f-${i}`} onOpen={showLocked} className="h-[126px] w-[224px] shrink-0 snap-start" />)}
            </VideoRow>
          )}
          {data.reels.length > 0 && (
            <VideoRow label="Reels" count={data.reels.length}>
              {data.reels.map((v, i) => <ProfileVideoTile key={v.id} video={v} portrait eager={i < 3} onOpen={() => openVideo(v, false)} className="h-[164px] w-[124px] shrink-0 snap-start" />)}
            </VideoRow>
          )}
        </section>
      )}

      {afterVideosSlot}

      {showCareer && (
        <section className="flex flex-col gap-4" data-testid="profile-career-section">
          <SectionHeader title="Career" action={careerCount > 0 ? `See all ${careerCount}` : null} onAction={onOpenCareer} />
          {careerCount === 0 && !data.loading && empty('Add your first club', onOpenCareer)}
          {data.career.length > 0 && (
            <div className="flex flex-col">
              {data.career.map((entry, i) => <CareerRow key={entry.id} entry={entry} last={i === data.career.length - 1} flag={entry.representedCountryId ? countries.find((c) => c.id === entry.representedCountryId)?.flag_emoji ?? null : null} />)}
            </div>
          )}
        </section>
      )}

      {showSkills && (
        <section className="flex flex-col gap-3" data-testid="profile-skills-section">
          <SectionHeader title="Specialist skills" action={owner && skills.length > 0 ? 'Edit' : null} onAction={onEditSkills} />
          {skills.length === 0 && owner && onEditSkills && empty('Add your specialist skills', onEditSkills)}
          {skills.length > 0 && (
            <div className="flex flex-wrap gap-x-3.5 gap-y-2">
              {skills.map((skill) => (
                <span key={skill} className="inline-flex items-center gap-[7px] text-row text-ink-1">
                  <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[6px] bg-hockia-soft text-hockia-primary"><Target className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
                  {humanizeToken(skill)}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {showReferences && (
        <section className="flex flex-col gap-3" data-testid="profile-references-section">
          <SectionHeader title="References" count={referenceCount > 0 ? referenceCount : null} action={referenceCount > 0 ? `See all ${referenceCount}` : null} onAction={onOpenReferences} />
          {referenceCount === 0 && !refsLoading && (owner
            ? empty('Ask for a reference', onOpenReferences)
            : <p className="text-row leading-[21px] text-ink-2">No references yet. References come from friends on Hockia — coaches and teammates can write one.</p>)}
          {acceptedReferences.slice(0, 2).map((r) => <ReferenceCard key={r.id} reference={r} onOpen={() => onOpenReference(r.id)} />)}
          {referenceCount > 2 && (
            <button type="button" onClick={onOpenReferences} className="flex h-[46px] items-center justify-center gap-1 rounded-full bg-hockia-soft text-row font-semibold text-hockia-primary">
              See all {referenceCount} references <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </section>
      )}

      {showFriends && (
        <button type="button" onClick={onOpenFriends} className="flex h-[52px] w-full items-center gap-3 rounded-card bg-surface-grouped px-4 text-left" data-testid="profile-friends-row">
          <span className="flex-1 text-row font-semibold text-ink-1">Friends</span>
          <span className="text-row text-ink-2 tabular-nums">{friendCount}</span>
          <ChevronRight className="h-4 w-4 text-ink-4" strokeWidth={2} />
        </button>
      )}

      {showPhotos && (
        <section className="flex flex-col gap-3" data-testid="profile-photos-section">
          <SectionHeader title="Photos" action={data.photoCount > 0 ? `See all ${data.photoCount}` : null} onAction={onOpenPhotos} />
          {data.photos.length === 0 && !data.loading && empty('Add photos', owner ? onManageVideos : onOpenPhotos)}
          {data.photos.length > 0 && (
            <div className="grid h-[248px] grid-cols-2 grid-rows-2 gap-1.5">
              {data.photos.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setPhotoIndex(i)} aria-label={p.caption || `Photo ${i + 1}`} className={cn('overflow-hidden rounded-card bg-surface-grouped', i === 0 && 'row-span-2')}>
                  <SmoothImage src={getImageUrl(p.url, 'gallery') ?? p.url} srcSet={getImageSrcSet(p.url, 'gallery') ?? undefined} sizes="50vw" alt="" eager className="object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {showPosts && (
        <section className="flex flex-col gap-3" data-testid="profile-posts-section">
          <SectionHeader title="Posts" action={data.postCount > 0 ? `See all ${data.postCount}` : null} onAction={onOpenPosts} />
          {data.posts.length === 0 && !data.loading && empty('New post', () => setComposer(true))}
          {data.posts.length > 0 && (
            <div className="-mx-5 flex snap-x scroll-pl-5 gap-2.5 overflow-x-auto px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {data.posts.map((p) => <PostTile key={p.post_id} post={p} onOpen={() => navigate(`/post/${p.post_id}`)} />)}
            </div>
          )}
        </section>
      )}

      {(owner || hasAbout) && (
        <section className="flex flex-col gap-2" data-testid="profile-about-section">
          <SectionHeader title="About" action={owner ? 'Edit' : null} onAction={onEdit} />
          {bio ? <p className="whitespace-pre-line text-row leading-[21px] text-ink-1">{bio}</p> : owner && empty('Write a short bio', onEdit)}
          <div className="divide-y divide-line">
            <FactRow label="Category" value={category} />
            <FactRow label="Relocation" value={relocation} />
          </div>
        </section>
      )}

      {player && (
        <MediaLightbox
          images={[{ video_id: player.id, media_type: 'video', duration: player.durationSeconds, order: 0 }]}
          initialIndex={0}
          onClose={() => setPlayer(null)}
          videoLabel={player.kind === 'highlight' ? 'Highlight' : player.kind === 'full_match' ? 'Full match' : 'Reel'}
          isOwner={owner}
          caption={[player.title, duration(player.durationSeconds)].filter(Boolean).join(' · ')}
        />
      )}

      <VideoAccessSheets block={videoBlock} firstName={profile.full_name?.trim().split(/\s+/)[0] || null} onClose={() => setVideoBlock(null)} />

      {photoIndex !== null && (
        <MediaLightbox
          images={data.photos.map((p, i) => ({ url: p.url, media_type: 'image', order: i }))}
          initialIndex={photoIndex}
          onClose={() => setPhotoIndex(null)}
          caption={data.photos[photoIndex]?.caption ?? null}
        />
      )}

      {composer && (
        <PostComposerModal
          isOpen={composer}
          onClose={() => setComposer(false)}
          onPostCreated={() => { setComposer(false); data.refresh() }}
        />
      )}
    </div>
  )
}
