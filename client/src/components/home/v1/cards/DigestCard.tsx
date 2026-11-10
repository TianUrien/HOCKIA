import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from '../BlurImage'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../primitives'
import { useHomeV1 } from '../homeV1Context'
import { trackCardClick } from '@/lib/homeInstrumentation'
import type { MembersDigestFeedItem, OpenToPlayWeekFeedItem } from '@/types/homeFeed'
import RolePlaceholder from '@/components/RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'

interface MosaicMember { id: string; full_name: string | null; avatar_url: string | null; role: string }

/**
 * "N …" and a 3×2 photo mosaic (tiles 16 r); the 6th tile is the next face
 * blurred under a 42 % veil with "+N". Tap → the Community deck with those
 * members. Shared by the weekly new-members digest and the "open to play"
 * card. No author → no comments, no ⋯ (spec rulings 11 Oct).
 */
function MemberMosaicCard({ feedItemId, itemType, title, deckLabel, faceLabel, moreLabel, members, memberCount, testId }: {
  feedItemId: string
  itemType: string
  title: string
  /** Title of the deck the mosaic opens. */
  deckLabel: string
  /** aria suffix for one face: "new member", "open to play". */
  faceLabel: string
  /** aria label of the "+N" tile, after the number. */
  moreLabel: string
  members: MosaicMember[]
  memberCount: number
  testId: string
}) {
  const { openDeckByIds } = useHomeV1()
  const faces = members.slice(0, 6)
  const extra = Math.max(0, memberCount - 5)
  const showMore = extra > 0 && faces.length === 6
  const ids = members.map((m) => m.id)
  const open = (i: number) => {
    trackCardClick(feedItemId, itemType, 'member_deck')
    openDeckByIds(ids, i, deckLabel)
  }

  return (
    <article className="flex flex-col gap-2 py-4" data-testid={testId}>
      <SectionHeader title={title} action="Swipe through" onAction={() => open(0)} />
      <div className="grid grid-cols-3 gap-2 px-4">
        {faces.map((m, i) => {
          const more = showMore && i === 5
          const src = m.avatar_url ? getImageUrl(m.avatar_url, 'feed-thumb') : null
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => open(i)}
              aria-label={more ? `${extra} ${moreLabel}` : `${m.full_name ?? 'Member'}, ${faceLabel}`}
              className="relative aspect-[115/116] overflow-hidden rounded-2xl bg-surface-muted transition-transform duration-300 active:scale-[0.97]"
            >
              {src ? (
                <BlurImage src={src} lqip={getLqipUrl(m.avatar_url)} className="h-full w-full" imgClassName={cn(more && 'scale-110 blur-[5px]')} />
              ) : (
                <RolePlaceholder role={isRoleAvatarRole(m.role) ? m.role : 'player'} label="" />
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

/**
 * Digest — new members (Figma 60:316): "N joined this week".
 * Server-side: only weeks with ≥4 visible members (hidden + blocked excluded).
 */
export function DigestCard({ item }: { item: MembersDigestFeedItem }) {
  const title = `${item.member_count} joined this week`
  return (
    <MemberMosaicCard
      feedItemId={item.feed_item_id}
      itemType={item.item_type}
      title={title}
      deckLabel={title}
      faceLabel="new member"
      moreLabel="more new members"
      members={item.members}
      memberCount={item.member_count}
      testId="home-digest-card"
    />
  )
}

/**
 * Open to play (founder 2026-11-10): the players who confirmed in the last 7
 * days that they are available and still are — a fact a club would act on,
 * where single per-player cards were never shown on Home. One rolling card:
 * server-side from 3 visible players up, and it moves up as players confirm.
 */
export function OpenToPlayWeekCard({ item }: { item: OpenToPlayWeekFeedItem }) {
  const title = `${item.member_count} players are open to play`
  return (
    <MemberMosaicCard
      feedItemId={item.feed_item_id}
      itemType={item.item_type}
      title={title}
      deckLabel={title}
      faceLabel="open to play"
      moreLabel="more players open to play"
      members={item.members}
      memberCount={item.member_count}
      testId="home-open-to-play-card"
    />
  )
}
