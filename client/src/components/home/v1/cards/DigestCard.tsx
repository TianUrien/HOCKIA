import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from '../BlurImage'
import { initialsOf, roleGradient, type CommunityRole } from '@/lib/communityCard'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../primitives'
import { useHomeV1 } from '../homeV1Context'
import type { MembersDigestFeedItem } from '@/types/homeFeed'

/**
 * Digest — new members (Figma 60:316): "N joined this week" and a 3×2 photo
 * mosaic (tiles 16 r); the 6th tile is the next face blurred under a 42 %
 * veil with "+N". Tap → the Community deck with that week's members.
 * Server-side: only weeks with ≥4 visible members (hidden + blocked excluded).
 * No author → no comments, no ⋯ (spec rulings 11 Oct).
 */
export function DigestCard({ item }: { item: MembersDigestFeedItem }) {
  const { openDeckByIds } = useHomeV1()
  const faces = item.members.slice(0, 6)
  const extra = Math.max(0, item.member_count - 5)
  const showMore = extra > 0 && faces.length === 6
  const ids = item.members.map((m) => m.id)
  const open = (i: number) => openDeckByIds(ids, i, `${item.member_count} joined this week`)

  return (
    <article className="flex flex-col gap-2 py-4" data-testid="home-digest-card">
      <SectionHeader title={`${item.member_count} joined this week`} action="Swipe through" onAction={() => open(0)} />
      <div className="grid grid-cols-3 gap-2 px-4">
        {faces.map((m, i) => {
          const more = showMore && i === 5
          const src = m.avatar_url ? getImageUrl(m.avatar_url, 'feed-thumb') : null
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => open(i)}
              aria-label={more ? `${extra} more new members` : `${m.full_name ?? 'Member'}, new member`}
              className="relative aspect-[115/116] overflow-hidden rounded-2xl bg-surface-muted transition-transform duration-300 active:scale-[0.97]"
            >
              {src ? (
                <BlurImage src={src} lqip={getLqipUrl(m.avatar_url)} className="h-full w-full" imgClassName={cn(more && 'scale-110 blur-[5px]')} />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-[22px] font-semibold text-white" style={{ backgroundImage: roleGradient((m.role as CommunityRole) || 'player') }}>{initialsOf(m.full_name)}</span>
              )}
              {more && (
                <span className="absolute inset-0 flex items-center justify-center bg-[rgba(15,15,20,0.42)] text-title tabular-nums text-white">+{extra}</span>
              )}
            </button>
          )
        })}
      </div>
    </article>
  )
}
