import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { BlurImage } from '../BlurImage'
import { cn } from '@/lib/utils'
import { SectionHeader } from '../primitives'
import { useHomeV1 } from '../homeV1Context'
import { trackCardClick } from '@/lib/homeInstrumentation'
import type { MembersDigestFeedItem, OpenToPlayWeekFeedItem } from '@/types/homeFeed'
import RolePlaceholder from '@/components/RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'
import { useHomeT } from '@/i18n/ns/home'

interface MosaicMember { id: string; full_name: string | null; avatar_url: string | null; role: string }

/**
 * "N …" and a 3×2 photo mosaic (tiles 16 r); the 6th tile is the next face
 * blurred under a 42 % veil with "+N". Tap → the Community deck with those
 * members. Shared by the weekly new-members digest and the "open to play"
 * card. No author → no comments, no ⋯ (spec rulings 11 Oct).
 */
function MemberMosaicCard({ feedItemId, itemType, title, deckLabel, faceAria, moreAria, members, memberCount, testId }: {
  feedItemId: string
  itemType: string
  title: string
  /** Title of the deck the mosaic opens. */
  deckLabel: string
  /** Accessible name of one face tile, given the member's name. */
  faceAria: (name: string) => string
  /** Accessible name of the "+N" tile, given how many more there are. */
  moreAria: (extra: number) => string
  members: MosaicMember[]
  memberCount: number
  testId: string
}) {
  const t = useHomeT()
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
      <SectionHeader title={title} action={t('digest.swipeThrough')} onAction={() => open(0)} />
      <div className="grid grid-cols-3 gap-2 px-4">
        {faces.map((m, i) => {
          const more = showMore && i === 5
          const src = m.avatar_url ? getImageUrl(m.avatar_url, 'feed-thumb') : null
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => open(i)}
              aria-label={more ? moreAria(extra) : faceAria(m.full_name ?? t('digest.unnamedMember'))}
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
  const t = useHomeT()
  const title = t('digest.joined.title', { count: item.member_count })
  return (
    <MemberMosaicCard
      feedItemId={item.feed_item_id}
      itemType={item.item_type}
      title={title}
      deckLabel={title}
      faceAria={(name) => t('digest.joined.faceAria', { name })}
      moreAria={(extra) => t('digest.joined.moreAria', { count: extra })}
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
  const t = useHomeT()
  const title = t('digest.openToPlay.title', { count: item.member_count })
  return (
    <MemberMosaicCard
      feedItemId={item.feed_item_id}
      itemType={item.item_type}
      title={title}
      deckLabel={title}
      faceAria={(name) => t('digest.openToPlay.faceAria', { name })}
      moreAria={(extra) => t('digest.openToPlay.moreAria', { count: extra })}
      members={item.members}
      memberCount={item.member_count}
      testId="home-open-to-play-card"
    />
  )
}
