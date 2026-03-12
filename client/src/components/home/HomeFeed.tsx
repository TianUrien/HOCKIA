import { Component, useCallback, useEffect, useRef } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, Loader2, Rss, Search, Globe, Briefcase, MessageSquare } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { useHomeFeed } from '@/hooks/useHomeFeed'
import { HomeFeedItemCard } from './HomeFeedItemCard'
import { FeedSkeleton } from './FeedSkeleton'
import ProfileCompletionCard from './ProfileCompletionCard'
import type { HomeFeedItem } from '@/types/homeFeed'

/**
 * Lightweight error boundary for individual feed items.
 * If one card crashes (e.g. Chrome auto-translate corrupting the DOM),
 * only that card is hidden — the rest of the feed stays alive.
 */
class FeedItemErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack, context: 'FeedItemErrorBoundary' },
    })
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

interface HomeFeedProps {
  prependItemRef?: React.RefObject<((item: HomeFeedItem) => void) | null>
}

export function HomeFeed({ prependItemRef }: HomeFeedProps) {
  const { items, isLoading, isFetchingNextPage, error, refetch, hasMore, loadMore, updateItemLike, removeItem, prependItem, newCount, showNewItems } = useHomeFeed()
  const sentinelRef = useRef<HTMLDivElement>(null)
  const feedTopRef = useRef<HTMLDivElement>(null)

  // Expose prependItem to parent so PostComposer can live in the sticky header
  useEffect(() => {
    if (prependItemRef) {
      prependItemRef.current = prependItem
    }
  }, [prependItem, prependItemRef])

  const handleShowNewItems = useCallback(async () => {
    await showNewItems()
    feedTopRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [showNewItems])

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isFetchingNextPage) {
          void loadMore()
        }
      },
      { rootMargin: '200px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isFetchingNextPage, loadMore])

  return (
    <div>
      {/* Profile completion nudge */}
      <ProfileCompletionCard />

      {/* Scroll anchor for new posts */}
      <div ref={feedTopRef} />

      {/* New posts banner */}
      {newCount > 0 && (
        <div className="flex justify-center mb-4">
          <button
            type="button"
            onClick={() => void handleShowNewItems()}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#8026FA] text-white text-sm font-medium rounded-full shadow-lg hover:bg-[#6B1FD4] active:scale-95 transition-all duration-200 animate-slideDown"
          >
            <ArrowUp className="w-4 h-4" />
            {newCount === 1
              ? '1 new post'
              : `${newCount > 99 ? '99+' : newCount} new posts`}
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && items.length === 0 && (
        <div className="space-y-6">
          {[1, 2, 3].map(i => (
            <FeedSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4 mb-6 bg-red-50 border border-red-200 rounded-lg text-red-600">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-2 px-4 py-1.5 text-sm bg-red-100 hover:bg-red-200 text-red-700 rounded-md transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state — cold start guidance */}
      {!isLoading && !error && items.length === 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8">
          <div className="text-center mb-6">
            <Rss className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Welcome to your feed
            </h3>
            <p className="text-sm text-gray-500">
              Your feed fills up as the community grows. In the meantime, start exploring:
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Link
              to="/opportunities"
              className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:bg-purple-50 hover:border-purple-200"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                <Briefcase className="h-5 w-5 text-[#8026FA]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Browse Opportunities</p>
                <p className="text-xs text-gray-500">Find your next move</p>
              </div>
            </Link>
            <Link
              to="/community"
              className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:bg-purple-50 hover:border-purple-200"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                <MessageSquare className="h-5 w-5 text-[#8026FA]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Join the Community</p>
                <p className="text-xs text-gray-500">Ask questions, share knowledge</p>
              </div>
            </Link>
            <Link
              to="/world"
              className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:bg-purple-50 hover:border-purple-200"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                <Globe className="h-5 w-5 text-[#8026FA]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Explore World</p>
                <p className="text-xs text-gray-500">Discover clubs across 8 countries</p>
              </div>
            </Link>
            <Link
              to="/community?tab=people"
              className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors hover:bg-purple-50 hover:border-purple-200"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-100">
                <Search className="h-5 w-5 text-[#8026FA]" />
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Find People</p>
                <p className="text-xs text-gray-500">Connect with players and coaches</p>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Feed items */}
      {items.length > 0 && (
        <div className="space-y-6">
          {items.map(item => (
            <FeedItemErrorBoundary key={item.feed_item_id}>
              <HomeFeedItemCard
                item={item}
                onLikeUpdate={updateItemLike}
                onDelete={removeItem}
              />
            </FeedItemErrorBoundary>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} />}

      {/* Pagination loading */}
      {isFetchingNextPage && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 text-[#8026FA] animate-spin" />
        </div>
      )}
    </div>
  )
}
