import { useState } from 'react'
import { ExternalLink, Lock } from 'lucide-react'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { MediaLightbox } from '@/components/home/MediaLightbox'
import { useAuthStore } from '@/lib/auth'
import { useProfileVideos, type ProfileFullGameLink, type ProfileVideo } from '@/hooks/useProfileVideos'
import { VideoAccessSheets, type VideoBlock } from './VideoAccessSheets'
import { ProfileVideoTile } from './ProfileVideoTile'
import { formatVideoDuration } from '@/lib/videoCopy'
import { getImageUrl } from '@/lib/imageUrl'
import { profilePath } from '@/lib/profileNavigation'

/**
 * Videos — all (Figma 153:581): where "N Videos" and "See all N" land — the
 * same three groups as the profile, as a grid. Full matches keep the lock so
 * a player understands why they cannot press play; a club, a coach or the
 * owner sees the same screen unlocked. A tile opens the Video player
 * (Figma 188:582 — the app's one media viewer): full-screen, author and
 * View profile over the video, X to go back.
 */
interface VideosScreenProps {
  profile: { id: string; full_name?: string | null; username?: string | null; avatar_url?: string | null; role?: string | null; highlight_video_url?: string | null; highlight_visibility?: string | null }
  mode: 'own' | 'public'
  onBack: () => void
  /** Owner only — Manage media. */
  onManage?: () => void
}

const KIND_LABEL: Record<ProfileVideo['kind'], string> = { highlight: 'Highlight', full_match: 'Full match', reel: 'Reel' }

function LinkTile({ title, href, date, locked }: { title: string; href: string; date?: string | null; locked?: boolean }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="relative flex aspect-[16/9] w-full flex-col justify-end overflow-hidden rounded-card bg-gradient-to-br from-ink-1 to-ink-2 p-2.5">
      <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-white"><ExternalLink className="h-3 w-3" /></span>
      {locked && <span className="absolute left-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-white"><Lock className="h-3 w-3" strokeWidth={2.2} /></span>}
      <span className="truncate text-caption font-semibold text-white">{title}</span>
      {date && <span className="text-[11px] text-white/75">{date.slice(0, 7)}</span>}
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

const linkTitle = (l: ProfileFullGameLink) => l.match_title?.trim() || (l.opponent_team ? `vs ${l.opponent_team}` : 'Full match')

export default function VideosScreen({ profile, mode, onBack, onManage }: VideosScreenProps) {
  const own = mode === 'own'
  const viewerRole = useAuthStore((s) => s.profile?.role ?? null)
  const signedIn = useAuthStore((s) => Boolean(s.user))
  const { videos, links, loading } = useProfileVideos(profile.id)
  const [playing, setPlaying] = useState<ProfileVideo | null>(null)
  const [block, setBlock] = useState<VideoBlock>(null)

  // Recruiters-only videos play for the owner, clubs and coaches — the token
  // function enforces the same rule server-side.
  const canWatchLocked = own || viewerRole === 'club' || viewerRole === 'coach'
  const lockFullMatches = profile.highlight_visibility === 'recruiters'
  const isLocked = (v: ProfileVideo) => v.visibility === 'recruiters' || (v.kind === 'full_match' && lockFullMatches)
  // Guests get the one Join sheet; members who can't watch get the reason.
  const open = (v: ProfileVideo) => {
    if (!signedIn && !own) setBlock('join')
    else if (isLocked(v) && !canWatchLocked) setBlock('locked')
    else setPlaying(v)
  }

  const highlights = videos.filter((v) => v.kind === 'highlight')
  const fullMatches = videos.filter((v) => v.kind === 'full_match')
  const reels = videos.filter((v) => v.kind === 'reel')
  const highlightCount = highlights.length + (profile.highlight_video_url ? 1 : 0)
  const fullCount = fullMatches.length + links.length
  const total = highlightCount + fullCount + reels.length
  const firstName = profile.full_name?.trim().split(/\s+/)[0] || null
  const avatar = profile.avatar_url ? getImageUrl(profile.avatar_url, 'avatar-md') ?? profile.avatar_url : null

  return (
    <div className="min-h-screen bg-white pb-24 lg:hidden" data-testid={own ? 'videos-screen-own' : 'videos-screen-public'}>
      <div className="sticky top-0 z-20 bg-white pt-[env(safe-area-inset-top)]">
        <DetailNavBar
          parent={own ? 'Profile' : firstName ?? 'Profile'}
          title={loading ? 'Videos' : `Videos · ${total}`}
          showParent
          onBack={onBack}
          trailing={own && onManage ? <button type="button" onClick={onManage} className="h-11 px-3 text-row font-semibold text-hockia-primary">Manage</button> : undefined}
        />
      </div>

      <div className="flex flex-col gap-6 px-5 pt-2">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5" aria-busy="true">{Array.from({ length: 4 }, (_, i) => <div key={i} className="aspect-[16/9] animate-pulse rounded-card bg-surface-grouped" />)}</div>
        ) : total === 0 ? (
          <div className="py-12 text-center">
            <p className="text-row font-semibold text-ink-1">{own ? 'No videos yet' : 'No videos to show'}</p>
            {own && onManage && <button type="button" onClick={onManage} className="mt-3 text-row font-semibold text-hockia-primary">Add your first highlight</button>}
          </div>
        ) : (
          <>
            {highlightCount > 0 && (
              <Group title="Highlights" count={highlightCount}>
                <div className="grid grid-cols-2 gap-2.5">
                  {highlights.map((v) => <ProfileVideoTile key={v.id} video={v} locked={isLocked(v)} canWatch={canWatchLocked} onOpen={() => open(v)} className="aspect-[16/9] w-full" />)}
                  {profile.highlight_video_url && <LinkTile title="Linked highlight" href={profile.highlight_video_url} />}
                </div>
              </Group>
            )}
            {fullCount > 0 && (
              <Group title="Full matches" count={fullCount} lockLabel={lockFullMatches || fullMatches.some(isLocked) || links.some((l) => l.visibility === 'recruiters') ? 'Clubs & coaches' : null}>
                <div className="grid grid-cols-2 gap-2.5">
                  {fullMatches.map((v) => <ProfileVideoTile key={v.id} video={v} locked={isLocked(v)} canWatch={canWatchLocked} onOpen={() => open(v)} className="aspect-[16/9] w-full" />)}
                  {links.map((l) => <LinkTile key={l.id} title={linkTitle(l)} href={l.video_url} date={l.match_date} locked={l.visibility === 'recruiters'} />)}
                </div>
              </Group>
            )}
            {reels.length > 0 && (
              <Group title="Reels" count={reels.length}>
                <div className="grid grid-cols-3 gap-2.5">
                  {reels.map((v) => <ProfileVideoTile key={v.id} video={v} portrait locked={isLocked(v)} canWatch={canWatchLocked} onOpen={() => open(v)} className="aspect-[3/4] w-full" />)}
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
          videoLabel={KIND_LABEL[playing.kind]}
          isOwner={own}
          caption={[playing.title, formatVideoDuration(playing.durationSeconds)].filter(Boolean).join(' · ')}
          author={{ id: profile.id, name: profile.full_name ?? null, avatarUrl: avatar, role: profile.role ?? null, profilePath: own ? null : profilePath(profile.role, profile.username, profile.id) }}
        />
      )}

      <VideoAccessSheets block={block} firstName={firstName} onClose={() => setBlock(null)} />
    </div>
  )
}
