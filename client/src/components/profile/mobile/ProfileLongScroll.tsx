import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, ChevronRight, ExternalLink, Flag, Heart, Lock, Play, Plus, X } from 'lucide-react'
import { useProfileScrollData, type ScrollCareerEntry, type ScrollFullGameLink, type ScrollVideo } from '@/hooks/useProfileScrollData'
import { useSignedVideoThumbnail } from '@/hooks/useSignedVideoThumbnail'
import { useTrustedReferences, type PublicReferenceCard } from '@/hooks/useTrustedReferences'
import { useCountries } from '@/hooks/useCountries'
import NativeVideoPlayer from '@/components/media/NativeVideoPlayer'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { PostComposerModal } from '@/components/home/PostComposerModal'
import { getImageUrl } from '@/lib/imageUrl'
import { humanizeToken, identityLine } from '@/lib/identity'
import { categoryToDisplay } from '@/lib/hockeyCategories'
import { DURATION_LABEL, RELOCATION_LABEL } from '@/lib/candidateIntent'
import { careerSpan, isCurrentEntry } from '@/lib/careerCopy'
import { nationalityLine } from '@/lib/nationalityLine'
import { cn } from '@/lib/utils'
import type { PlayerProfileShape } from '@/pages/PlayerDashboard'
import type { UserPostFeedItem } from '@/types/homeFeed'

/**
 * Phone profile long scroll (Figma 03 Player › Profile own / public):
 * Profile strength (owner) · Video · References · Career · Photos · Posts ·
 * About, under the identity block. Every section is a preview; the number
 * in the stats strip and the section links open the complete collection.
 * Header actions follow the stats-strip rule — "See all N" in both modes;
 * owner verbs (Ask for a reference, Add photos, New post) are the empty-state
 * rows only, and the tools live inside the leaf screens. Video keeps Manage
 * for the owner. Public mode is read-only and viewer-relative (RLS already
 * fences recruiters-only rows).
 */
interface ProfileLongScrollProps {
  profile: PlayerProfileShape
  readOnly: boolean
  onEdit: () => void
  onOpenVideos: () => void
  onOpenReferences: () => void
  /** A reference card opens that reference's detail. */
  onOpenReference: (referenceId: string) => void
  onOpenCareer: () => void
  onOpenPhotos: () => void
  onOpenPosts: () => void
  /** Highlights + full matches + reels — the number the stats strip shows. */
  onVideoCount?: (count: number) => void
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

function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setInView(true); return }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setInView(true); io.disconnect() } }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return { ref, inView }
}

function VideoTile({ video, portrait, locked, onOpen }: { video: ScrollVideo; portrait?: boolean; locked?: boolean; onOpen: () => void }) {
  const { ref, inView } = useInView<HTMLButtonElement>()
  const { thumb, onThumbError, onThumbLoad } = useSignedVideoThumbnail(video.id, inView)
  const dur = duration(video.durationSeconds)
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      aria-label={`Play ${video.title}`}
      className={cn('relative shrink-0 snap-start overflow-hidden rounded-card bg-ink-1 text-left', portrait ? 'h-[164px] w-[124px]' : 'h-[126px] w-[224px]')}
    >
      {thumb && <img src={thumb} alt="" onError={onThumbError} onLoad={onThumbLoad} className="absolute inset-0 h-full w-full object-cover" />}
      <span className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/70 to-transparent" />
      <span className="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-ink-1">
        <Play className="ml-0.5 h-4 w-4 fill-current" />
      </span>
      {locked && (
        <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white">
          <Lock className="h-3 w-3" strokeWidth={2.2} />
        </span>
      )}
      {!portrait && <span className="absolute bottom-2 left-2.5 max-w-[150px] truncate text-secondary font-semibold text-white">{video.title}</span>}
      {dur && <span className={cn('absolute bottom-2 text-secondary font-semibold text-white', portrait ? 'left-1/2 -translate-x-1/2' : 'right-2.5')}>{dur}</span>}
    </button>
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

function ReferenceCard({ reference, onOpen }: { reference: PublicReferenceCard; onOpen: () => void }) {
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

function CareerRow({ entry, last, flag }: { entry: ScrollCareerEntry; last: boolean; flag: string | null }) {
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

function PostTile({ post, onOpen }: { post: UserPostFeedItem; onOpen: () => void }) {
  const first = post.images?.find((m) => m.url || m.thumb_url)
  const src = first ? (first.media_type === 'video' ? first.thumb_url ?? null : getImageUrl(first.url ?? null, 'feed-thumb') ?? first.url ?? null) : null
  return (
    <button type="button" onClick={onOpen} className="w-[168px] shrink-0 snap-start text-left">
      <div className="flex h-[124px] w-full items-end overflow-hidden rounded-card bg-surface-grouped">
        {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <p className="line-clamp-4 p-3 text-secondary text-ink-2">{post.content}</p>}
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

export default function ProfileLongScroll({ profile, readOnly, onEdit, onOpenVideos, onOpenReferences, onOpenReference, onOpenCareer, onOpenPhotos, onOpenPosts, onVideoCount }: ProfileLongScrollProps) {
  const navigate = useNavigate()
  const owner = !readOnly
  const profileId = profile.id ?? null
  const data = useProfileScrollData(profileId)
  const { acceptedReferences, loading: refsLoading } = useTrustedReferences(profileId ?? '')
  const { countries } = useCountries()
  const [player, setPlayer] = useState<ScrollVideo | null>(null)
  const [photoIndex, setPhotoIndex] = useState<number | null>(null)
  const [composer, setComposer] = useState(false)

  const lockFullMatches = profile.highlight_visibility === 'recruiters'
  const highlightCount = data.highlights.length + (profile.highlight_video_url ? 1 : 0)
  const fullMatchCount = data.fullMatches.length + data.fullGameLinks.length
  const videoTotal = highlightCount + fullMatchCount + data.reels.length
  useEffect(() => {
    if (!data.loading) onVideoCount?.(videoTotal)
  }, [data.loading, videoTotal, onVideoCount])
  const referenceCount = profile.accepted_reference_count ?? acceptedReferences.length
  const careerCount = profile.career_entry_count ?? data.career.length

  // Profile strength — the same five recruiter signals the desktop
  // checklist (RecruitmentVisibilityWidget) counts, as a compact card.
  const strength = useMemo(() => {
    if (!owner) return null
    const items: { label: string; done: boolean; open: () => void }[] = [
      { label: 'highlight video', done: highlightCount > 0, open: onOpenVideos },
      { label: 'full match', done: fullMatchCount > 0 || (profile.full_game_video_count ?? 0) > 0, open: onOpenVideos },
      { label: 'current club', done: Boolean(profile.current_world_club_id), open: onEdit },
      { label: 'reference', done: referenceCount > 0, open: onOpenReferences },
      { label: 'representative team', done: data.career.some((c) => c.entryType === 'national_team'), open: onOpenCareer },
    ]
    const done = items.filter((i) => i.done).length
    const next = items.find((i) => !i.done) ?? null
    return { done, total: items.length, next }
  }, [owner, highlightCount, fullMatchCount, referenceCount, profile.full_game_video_count, profile.current_world_club_id, data.career, onOpenVideos, onEdit, onOpenReferences, onOpenCareer])

  const passports = useMemo(() => {
    const ids = [profile.nationality_country_id, profile.nationality2_country_id].filter((id): id is number => typeof id === 'number')
    const found = ids.map((id) => countries.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c))
    return nationalityLine(found) ?? (profile.nationality?.trim() || null)
  }, [countries, profile.nationality_country_id, profile.nationality2_country_id, profile.nationality])

  const age = profile.server_age ?? (profile.date_of_birth ? Math.floor((Date.now() - new Date(profile.date_of_birth).getTime()) / 31_557_600_000) : null)
  const category = [categoryToDisplay(profile.playing_category) || null, age ? String(age) : null].filter(Boolean).join(' · ') || null
  const available = profile.available_from
    ? [`From ${monthYear(profile.available_from)}`, profile.availability_duration ? DURATION_LABEL[profile.availability_duration] ?? null : null].filter(Boolean).join(' · ')
    : profile.availability_duration ? DURATION_LABEL[profile.availability_duration] ?? null : null
  const relocation = profile.relocation_willingness ? RELOCATION_LABEL[profile.relocation_willingness] ?? null : null
  const bio = profile.bio?.trim() || null
  const hasAbout = Boolean(bio || passports || category || available || relocation)

  const showVideo = owner || videoTotal > 0
  const showReferences = owner || referenceCount > 0
  const showCareer = owner || careerCount > 0
  const showPhotos = owner || data.photos.length > 0
  const showPosts = owner || data.posts.length > 0

  const empty = (text: string, onClick: () => void) => (
    <button type="button" onClick={onClick} className="flex h-[52px] w-full items-center justify-between rounded-card bg-surface-grouped px-4 text-row text-ink-2">
      {text} <Plus className="h-4 w-4 text-hockia-primary" strokeWidth={2.2} />
    </button>
  )

  return (
    <div className="flex flex-col gap-7 px-5 pb-6 pt-1" data-testid="profile-long-scroll">
      {strength && (
        <button
          type="button"
          onClick={() => (strength.next ? strength.next.open() : onOpenVideos())}
          className="rounded-card border border-line bg-white p-4 text-left"
          data-testid="profile-strength-card"
        >
          <div className="flex items-center justify-between">
            <span className="text-row font-semibold text-ink-1">Profile strength</span>
            <span className="text-row font-semibold text-positive">{strength.done} of {strength.total}</span>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-grouped">
            <div className="h-full rounded-full bg-positive" style={{ width: `${(strength.done / strength.total) * 100}%` }} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <p className="text-secondary text-ink-2">
              {strength.next
                ? `${strength.done} of ${strength.total} added. Next: add a ${strength.next.label}.`
                : lockFullMatches ? 'Complete. Full matches are visible to clubs & coaches only.' : 'Complete. Every signal recruiters look for is on your profile.'}
            </p>
            <span className="shrink-0 text-secondary font-semibold text-hockia-primary">{strength.next ? 'Add' : 'Who can see'}</span>
          </div>
        </button>
      )}

      {showVideo && (
        <section className="flex flex-col gap-4" data-testid="profile-video-section">
          <SectionHeader title="Video" action={owner ? 'Manage' : videoTotal > 0 ? `See all ${videoTotal}` : null} onAction={onOpenVideos} />
          {videoTotal === 0 && !data.loading && empty('Add your first highlight', onOpenVideos)}
          {(data.highlights.length > 0 || profile.highlight_video_url) && (
            <VideoRow label="Highlights" count={highlightCount}>
              {data.highlights.map((v) => <VideoTile key={v.id} video={v} locked={v.visibility === 'recruiters'} onOpen={() => setPlayer(v)} />)}
              {profile.highlight_video_url && (
                <a href={profile.highlight_video_url} target="_blank" rel="noopener noreferrer" className="relative flex h-[126px] w-[224px] shrink-0 snap-start flex-col justify-end rounded-card bg-gradient-to-br from-ink-1 to-ink-2 p-2.5">
                  <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
                  <span className="text-secondary font-semibold text-white">Linked highlight</span>
                </a>
              )}
            </VideoRow>
          )}
          {fullMatchCount > 0 && (
            <VideoRow label="Full matches" count={fullMatchCount} lockLabel={lockFullMatches ? 'Clubs & coaches' : null}>
              {data.fullMatches.map((v) => <VideoTile key={v.id} video={v} locked={lockFullMatches || v.visibility === 'recruiters'} onOpen={() => setPlayer(v)} />)}
              {data.fullGameLinks.map((l) => <LinkTile key={l.id} link={l} />)}
            </VideoRow>
          )}
          {data.reels.length > 0 && (
            <VideoRow label="Reels" count={data.reels.length}>
              {data.reels.map((v) => <VideoTile key={v.id} video={v} portrait onOpen={() => setPlayer(v)} />)}
            </VideoRow>
          )}
        </section>
      )}

      {showReferences && (
        <section className="flex flex-col gap-3" data-testid="profile-references-section">
          <SectionHeader title="References" count={referenceCount} action={referenceCount > 0 ? `See all ${referenceCount}` : null} onAction={onOpenReferences} />
          {referenceCount === 0 && !refsLoading && empty('Ask for a reference', onOpenReferences)}
          {acceptedReferences.slice(0, 2).map((r) => <ReferenceCard key={r.id} reference={r} onOpen={() => onOpenReference(r.id)} />)}
          {referenceCount > 2 && (
            <button type="button" onClick={onOpenReferences} className="flex h-[46px] items-center justify-center gap-1 rounded-full bg-hockia-soft text-row font-semibold text-hockia-primary">
              See all {referenceCount} references <ChevronRight className="h-4 w-4" strokeWidth={2} />
            </button>
          )}
        </section>
      )}

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

      {showPhotos && (
        <section className="flex flex-col gap-3" data-testid="profile-photos-section">
          <SectionHeader title="Photos" action={data.photoCount > 0 ? `See all ${data.photoCount}` : null} onAction={onOpenPhotos} />
          {data.photos.length === 0 && !data.loading && empty('Add photos', onOpenPhotos)}
          {data.photos.length > 0 && (
            <div className="grid h-[248px] grid-cols-2 grid-rows-2 gap-1.5">
              {data.photos.map((p, i) => (
                <button key={p.id} type="button" onClick={() => setPhotoIndex(i)} aria-label={p.caption || `Photo ${i + 1}`} className={cn('overflow-hidden rounded-card bg-surface-grouped', i === 0 && 'row-span-2')}>
                  <img src={getImageUrl(p.url, 'gallery') ?? p.url} alt="" className="h-full w-full object-cover" />
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
            <FactRow label="Passports" value={passports} />
            <FactRow label="Category" value={category} />
            <FactRow label="Available" value={available} />
            <FactRow label="Relocation" value={relocation} />
          </div>
        </section>
      )}

      {player && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black" role="dialog" aria-label={player.title}>
          <div className="flex items-center gap-3 px-3 pb-2 pt-[max(12px,env(safe-area-inset-top))] text-white">
            <button type="button" onClick={() => setPlayer(null)} aria-label="Close video" className="flex h-10 w-10 items-center justify-center rounded-full bg-white/15"><X className="h-5 w-5" /></button>
            <p className="min-w-0 flex-1 truncate text-row font-semibold">{player.title}</p>
          </div>
          <div className="flex flex-1 items-center">
            <div className="w-full">
              <NativeVideoPlayer videoId={player.id} title={player.title} durationSeconds={player.durationSeconds} isOwner={owner} />
            </div>
          </div>
        </div>
      )}

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
