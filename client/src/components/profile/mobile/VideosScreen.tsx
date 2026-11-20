import { safeVideoHref, videoLinkSite } from '@/lib/videoUrlValidator'
import { useState } from 'react'
import { ExternalLink, Lock } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { useAuthStore } from '@/lib/auth'
import { useProfileVideos, type ProfileFullGameLink, type ProfileVideo } from '@/hooks/useProfileVideos'
import { VideoAccessSheets, type VideoBlock } from './VideoAccessSheets'
import { LockedVideoTile, ProfileVideoTile } from './ProfileVideoTile'
import { isRecruiterProfile, fullMatchVisibilityOf, canViewLinkedHighlight } from '@/lib/recruiter'
import { useVideoAccessSummary } from '@/hooks/useVideoAccessSummary'
import { formatVideoDuration } from '@/lib/videoCopy'
import { getImageUrl } from '@/lib/imageUrl'
import { profilePath } from '@/lib/profileNavigation'
import { VideoLockBadge } from './VideoLockBadge'
import { tMedia, useMediaT } from '@/i18n/ns/media'

/**
 * Videos — all (Figma 153:581): where "N Videos" and "See all N" land — the
 * same three groups as the profile, as a grid. Videos a viewer cannot watch
 * show as locked tiles ("Clubs & recruiting coaches only") so a player understands why
 * they cannot press play; a club, a recruiting coach or the owner sees the
 * same screen unlocked. A tile opens the Video player
 * (Figma 188:582 — the app's one media viewer): full-screen, author and
 * View profile over the video, X to go back.
 */
interface VideosScreenProps {
  profile: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; role?: string | null; highlight_video_url?: string | null; highlight_visibility?: string | null; full_match_visibility?: string | null }
  mode: 'own' | 'public'
  onBack: () => void
  /** Owner only — Manage media. */
  onManage?: () => void
}

/** The player's chip for each kind of video, in the interface language. */
function kindLabel(kind: ProfileVideo['kind']): string {
  if (kind === 'highlight') return tMedia('videosScreen.kind.highlight')
  if (kind === 'full_match') return tMedia('videosScreen.kind.fullMatch')
  return tMedia('videosScreen.kind.reel')
}

function LinkTile({ title, href, date, locked }: { title: string; href: string; date?: string | null; locked?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="relative flex aspect-[16/9] w-full flex-col justify-end overflow-hidden rounded-card bg-gradient-to-br from-ink-1 to-ink-2 p-2.5">
      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
      {locked && <VideoLockBadge />}
      <span className="truncate text-caption font-semibold text-white">{title}</span>
      <span className="truncate text-[11px] text-white/75">{[date ? date.slice(0, 7) : null, videoLinkSite(href)].filter(Boolean).join(', ')}</span>
    </a>
  )
}

function Group({ title, count, lockLabel, children }: { title: string; count: number; lockLabel?: string | null; children: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-2 pb-2.5">
        <h2 className="text-body font-semibold text-ink-1">{title}</h2>
        <span className="text-body text-ink-3">{count}</span>
        {lockLabel && <span className="inline-flex h-[22px] items-center gap-1 rounded-full bg-surface-grouped px-2 text-[11px] font-semibold text-ink-2"><Lock className="h-3 w-3" strokeWidth={2.2} /> {lockLabel}</span>}
      </div>
      {children}
    </section>
  )
}

const linkTitle = (l: ProfileFullGameLink) => l.match_title?.trim() || (l.opponent_team ? tMedia('videosScreen.versus', { opponent: l.opponent_team }) : tMedia('videosScreen.fullMatchFallback'))

export default function VideosScreen({ profile, mode, onBack, onManage }: VideosScreenProps) {
  const t = useMediaT()
  const own = mode === 'own'
  const viewer = useAuthStore((s) => s.profile)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const { videos, links, loading } = useProfileVideos(profile.id)
  const [playing, setPlaying] = useState<ProfileVideo | null>(null)
  const [block, setBlock] = useState<VideoBlock>(null)

  // Recruiters-only videos play for the owner, clubs and coaches who recruit
  // — RLS and the token function enforce the same rule (SQL is_recruiter).
  const canWatchLocked = own || isRecruiterProfile(viewer)
  const access = useVideoAccessSummary(profile.id, { enabled: !own })
  const lockedFull = own ? 0 : access.lockedFullMatches
  const lockedHighlights = own ? 0 : access.lockedHighlights
  const isLocked = (v: ProfileVideo) => v.visibility === 'recruiters'
  const showLocked = () => setBlock(signedIn ? 'locked' : 'join')
  // Guests get the one Join sheet; members who can't watch get the reason.
  const open = (v: ProfileVideo) => {
    if (!signedIn && !own) setBlock('join')
    else if (isLocked(v) && !canWatchLocked) setBlock('locked')
    else setPlaying(v)
  }

  const highlights = videos.filter((v) => v.kind === 'highlight')
  const fullMatches = videos.filter((v) => v.kind === 'full_match')
  const reels = videos.filter((v) => v.kind === 'reel')
  // The legacy linked highlight honours "Recruiters only" (desktop MediaTab rule).
  // Only an https link is ever opened (members write these; CodeQL 2026-10-23).
  const linkedHighlight = safeVideoHref(profile.highlight_video_url)
  const canOpenLinkedHighlight = canViewLinkedHighlight({ owner: own, profile, viewer })
  const highlightCount = highlights.length + (linkedHighlight ? 1 : 0) + lockedHighlights
  const fullCount = fullMatches.length + links.length + lockedFull
  const lockFullMatches = own
    ? fullMatchVisibilityOf(profile) === 'recruiters'
    : lockedFull > 0 || fullMatches.some(isLocked) || links.some((l) => l.visibility === 'recruiters')
  const total = highlightCount + fullCount + reels.length
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || null
  const avatar = profile.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null

  return (
    <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid={own ? 'videos-screen-own' : 'videos-screen-public'}>
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar
          parent={own ? t('videosScreen.parent') : firstName ?? t('videosScreen.parent')}
          title={loading ? t('videosScreen.title') : t('videosScreen.titleCount', { count: total, total })}
          showParent
          onBack={onBack}
          trailing={own && onManage ? <button type="button" onClick={onManage} className="h-11 px-3 text-row font-semibold text-hockia-primary">{t('videosScreen.manage')}</button> : undefined}
        />
      </div>

      <div className="flex flex-col gap-6 px-5 pt-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-[16/9] animate-pulse rounded-card bg-surface-grouped" />)}</div>
        ) : total === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? t('videosScreen.emptyOwn') : t('videosScreen.emptyPublic')}</p>
            {own && onManage && <button type="button" onClick={onManage} className="mt-3 text-row font-semibold text-hockia-primary">{t('videosScreen.addFirst')}</button>}
          </div>
        ) : (
          <>
            {highlightCount > 0 && (
              <Group title={t('videosScreen.highlights')} count={highlightCount}>
                <div className="grid grid-cols-2 gap-2.5">
                  {highlights.map((v, i) => <ProfileVideoTile key={v.id} video={v} locked={isLocked(v)} canWatch={canWatchLocked} eager={i < 4} priority={i === 0} size={{ width: 180, height: 101 }} onOpen={() => open(v)} className="aspect-[16/9] w-full" />)}
                  {linkedHighlight && canOpenLinkedHighlight && <LinkTile title={t('videosScreen.linkedHighlight')} href={linkedHighlight} />}
                  {linkedHighlight && !canOpenLinkedHighlight && <LockedVideoTile label={t('videosScreen.lockedLinkedHighlight')} onOpen={showLocked} className="aspect-[16/9] w-full" />}
                  {Array.from({ length: lockedHighlights }, (_, i) => <LockedVideoTile key={`locked-h-${i}`} label={t('videosScreen.lockedHighlight')} onOpen={showLocked} className="aspect-[16/9] w-full" />)}
                </div>
              </Group>
            )}
            {fullCount > 0 && (
              <Group title={t('videosScreen.fullMatches')} count={fullCount} lockLabel={lockFullMatches ? t('videosScreen.recruitersOnly') : null}>
                <div className="grid grid-cols-2 gap-2.5">
                  {fullMatches.map((v, i) => <ProfileVideoTile key={v.id} video={v} locked={isLocked(v)} canWatch={canWatchLocked} eager={i < 4} size={{ width: 180, height: 101 }} onOpen={() => open(v)} className="aspect-[16/9] w-full" />)}
                  {links.flatMap((l) => { const href = safeVideoHref(l.video_url); return href ? [<LinkTile key={l.id} title={linkTitle(l)} href={href} date={l.match_date} locked={l.visibility === 'recruiters'} />] : [] })}
                  {Array.from({ length: lockedFull }, (_, i) => <LockedVideoTile key={`locked-f-${i}`} onOpen={showLocked} className="aspect-[16/9] w-full" />)}
                </div>
              </Group>
            )}
            {reels.length > 0 && (
              <Group title={t('videosScreen.reels')} count={reels.length}>
                <div className="grid grid-cols-3 gap-2.5">
                  {reels.map((v, i) => <ProfileVideoTile key={v.id} video={v} portrait locked={isLocked(v)} canWatch={canWatchLocked} eager={i < 6} size={{ width: 116, height: 155 }} onOpen={() => open(v)} className="aspect-[3/4] w-full" />)}
                </div>
              </Group>
            )}
          </>
        )}
      </div>

      {playing && (
        <MediaLightbox
          images={[{ video_id: playing.id, media_type: 'video', duration: playing.durationSeconds, order: 0 }]}
          initialIndex={0}
          onClose={() => setPlaying(null)}
          videoLabel={kindLabel(playing.kind)}
          isOwner={own}
          caption={[playing.title, formatVideoDuration(playing.durationSeconds)].filter(Boolean).join(', ')}
          author={{ id: profile.id, name: profile.full_name ?? null, avatarUrl: avatar, role: profile.role ?? null, profilePath: own ? null : profilePath(profile.role, profile.username, profile.id) }}
        />
      )}

      <VideoAccessSheets block={block} firstName={firstName} onClose={() => setBlock(null)} />
    </div>
  )
}
