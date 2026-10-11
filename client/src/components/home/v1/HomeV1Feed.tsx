import { Component, Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { ArrowUp, Loader2 } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { useHomeFeed } from '@/hooks/useHomeFeed'
import { useMemberAges } from '@/hooks/useMemberAges'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { FeedAuthorContext, useFeedAuthorContext } from '@/hooks/useFeedAuthorContext'
import { HomeFeedItemCard } from '@/components/home/HomeFeedItemCard'
import { UserPostCard } from '@/components/home/cards'
import type { Profile } from '@/components/community/PeopleListView'
import type { HomeFeedItem, SigningMetadata } from '@/types/homeFeed'
import { HomeV1Context, type CommentsRequest, type HomeV1ContextValue } from './homeV1Context'
import { fetchProfilesByIds } from './useHomePeople'
import { FeedBand } from './primitives'
import { SigningCard } from './cards/SigningCard'
import { VideoCard } from './cards/VideoCards'
import { PhotosCard } from './cards/PhotosCard'
import { ReferenceCard } from './cards/ReferenceCard'
import { OpportunityCard } from './cards/OpportunityCard'
import { DigestCard } from './cards/DigestCard'
import { RolesRail } from './RolesRail'
import { EndOfFeed } from './EndOfFeed'
import { CommentsSheet } from './CommentsSheet'

const MemberFullPreview = lazy(() => import('@/components/community/photo/MemberFullPreview'))

/** One card crashing (e.g. auto-translate corrupting the DOM) hides only that card. */
class ItemBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, { extra: { componentStack: info.componentStack, context: 'HomeV1ItemBoundary' } })
  }
  render() { return this.state.failed ? null : this.props.children }
}

/** The rail goes after the 2nd feed item (spec 65:329). */
const RAIL_AFTER = 2

/**
 * The Home v1 feed (Figma t24oVt… H1 / H2): get_home_feed_v2, newest first,
 * the new card set, "Roles for you" after the 2nd item, "You're all caught up"
 * at the end (H13). Owns the one comments sheet and the one Community deck.
 */
export function HomeV1Feed({ prependItemRef, header }: {
  prependItemRef?: React.RefObject<((item: HomeFeedItem) => void) | null>
  /** Next step + people row — kept on screen when the feed fails (H12b). */
  header: ReactNode
}) {
  const feed = useHomeFeed({ v2: true })
  const { items, isLoading, isFetchingNextPage, error, refetch, hasMore, loadMore, updateItemLike, removeItem, prependItem, patchItem, newCount, showNewItems } = feed
  const addToast = useToastStore((s) => s.addToast)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  const [comments, setComments] = useState<CommentsRequest | null>(null)
  const [deck, setDeck] = useState<{ members: Profile[]; start: number; label: string } | null>(null)
  const ages = useMemberAges(useMemo(() => deck?.members.map((m) => m.id) ?? [], [deck]))

  const authorIds = useMemo(() => {
    const ids: string[] = []
    for (const i of items) {
      const r = i as unknown as Record<string, unknown>
      const id = (r.author_id ?? r.uploader_id ?? r.profile_id ?? r.club_id) as string | undefined
      if (id) ids.push(id)
    }
    return ids
  }, [items])
  const lookupAuthor = useFeedAuthorContext(authorIds)

  useEffect(() => {
    if (prependItemRef) prependItemRef.current = prependItem
  }, [prependItem, prependItemRef])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && hasMore && !isFetchingNextPage) void loadMore()
    }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, isFetchingNextPage, loadMore])

  const openDeckByIds = useCallback((ids: string[], start: number, label: string) => {
    fetchProfilesByIds(ids)
      .then((members) => {
        if (members.length === 0) return
        const startId = ids[start]
        setDeck({ members, start: Math.max(0, members.findIndex((m) => m.id === startId)), label })
      })
      .catch((err) => {
        logger.error('[HomeV1Feed] deck profiles failed', err)
        addToast('Could not open these profiles', 'error')
      })
  }, [addToast])

  const ctx = useMemo<HomeV1ContextValue>(() => ({
    patchItem,
    removeItem,
    openComments: setComments,
    openDeck: (members, start, label) => setDeck({ members, start, label }),
    openDeckByIds,
  }), [patchItem, removeItem, openDeckByIds])

  const firstLoad = isLoading && items.length === 0

  return (
    <HomeV1Context.Provider value={ctx}>
      <FeedAuthorContext.Provider value={lookupAuthor}>
        {header}
        <div ref={topRef} />

        {newCount > 0 && (
          <div className="sticky top-[calc(var(--app-header-height,56px)+8px)] z-20 flex justify-center">
            <button
              type="button"
              onClick={() => { void showNewItems().then(() => topRef.current?.scrollIntoView({ behavior: 'smooth' })) }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-hockia-primary px-4 text-secondary font-semibold text-white shadow-lg"
            >
              <ArrowUp className="h-4 w-4" /> {newCount === 1 ? '1 new post' : `${newCount > 99 ? '99+' : newCount} new posts`}
            </button>
          </div>
        )}

        {firstLoad && <FirstPostSkeleton />}

        {error && items.length === 0 && (
          // H12b: the header + Next step + people stay; the feed says so inline.
          <div className="flex flex-col items-center gap-1 px-8 py-12 text-center" role="alert" data-testid="home-feed-error">
            <h2 className="text-body font-semibold text-ink-1">Couldn’t load the feed</h2>
            <p className="text-secondary text-ink-2">Pull down or try again.</p>
            <button type="button" onClick={() => void refetch()} className="mt-4 flex h-11 items-center rounded-full border border-line bg-white px-5 text-[15px] font-semibold text-ink-1 shadow-[0_1px_2px_rgba(15,15,20,0.06)]">
              Try again
            </button>
          </div>
        )}

        {items.map((item, idx) => (
          <Fragment key={item.feed_item_id}>
            {idx > 0 && <FeedBand />}
            <ItemBoundary>
              <FeedItem item={item} onLikeUpdate={updateItemLike} onDelete={removeItem} />
            </ItemBoundary>
            {idx === RAIL_AFTER - 1 && (
              <ItemBoundary>
                <RailSlot />
              </ItemBoundary>
            )}
          </Fragment>
        ))}

        {hasMore && <div ref={sentinelRef} />}
        {isFetchingNextPage && (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-hockia-primary" aria-label="Loading more" /></div>
        )}

        {!firstLoad && !hasMore && !error && (
          <>
            {items.length > 0 && <FeedBand />}
            <EndOfFeed />
          </>
        )}

        {comments && (
          <CommentsSheet
            request={comments}
            onClose={() => setComments(null)}
            onCount={(count) => patchItem(comments.feedItemId, { comment_count: count })}
            onEnabled={(enabled) => patchItem(comments.feedItemId, { comments_enabled: enabled })}
          />
        )}

        {deck && deck.members[deck.start] && (
          <Suspense fallback={null}>
            <MemberFullPreview
              member={deck.members[deck.start]}
              age={ages.get(deck.members[deck.start].id) ?? null}
              deck={{ members: deck.members, startIndex: deck.start, contextLabel: deck.label, ageOf: (id) => ages.get(id) ?? null }}
              onClose={() => setDeck(null)}
            />
          </Suspense>
        )}
      </FeedAuthorContext.Provider>
    </HomeV1Context.Provider>
  )
}

/** The rail slot: a band, then "Roles for you" (renders nothing for clubs). */
function RailSlot() {
  const role = useAuthStore((s) => s.profile?.role ?? null)
  if (role !== 'player' && role !== 'coach') return null
  return (
    <>
      <FeedBand />
      <RolesRail />
    </>
  )
}

function FeedItem({ item, onLikeUpdate, onDelete }: {
  item: HomeFeedItem
  onLikeUpdate: (postId: string, liked: boolean, likeCount: number) => void
  onDelete: (feedItemId: string) => void
}) {
  switch (item.item_type) {
    case 'user_post': {
      const meta = item.metadata as SigningMetadata | null | undefined
      // A signing whose member removed their tag reads as a plain club post (H16);
      // old-app "transfer" posts render as normal posts (ruling 11 Oct).
      if (item.post_type === 'signing' && meta?.person_profile_id) return <SigningCard item={item} />
      return <UserPostCard item={{ ...item, post_type: item.post_type === 'question' ? 'question' : 'text', metadata: null }} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
    }
    case 'video_added':
      return <VideoCard item={item} />
    case 'media_added':
      return <PhotosCard item={item} />
    case 'reference_received':
      return <ReferenceCard item={item} />
    case 'opportunity_posted':
      return <OpportunityCard item={item} />
    case 'members_digest':
      return <DigestCard item={item} />
    default:
      return <HomeFeedItemCard item={item} onLikeUpdate={onLikeUpdate} onDelete={onDelete} />
  }
}

/** H4: the first post's header and media while the feed loads. */
function FirstPostSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex items-center gap-2.5 px-4 pb-2.5 pt-3.5">
        <div className="h-9 w-9 animate-pulse rounded-full bg-surface-muted" />
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-[120px] animate-pulse rounded-full bg-surface-muted" />
          <div className="h-2.5 w-[80px] animate-pulse rounded-full bg-surface-muted" />
        </div>
      </div>
      <div className="aspect-[4/5] w-full animate-pulse bg-surface-muted" />
    </div>
  )
}
