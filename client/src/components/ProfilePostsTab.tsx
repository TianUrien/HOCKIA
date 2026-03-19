import { Component, useCallback, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { useProfilePosts } from '@/hooks/useProfilePosts'
import { UserPostCard } from '@/components/home/cards/UserPostCard'
import { TransferAnnouncementCard } from '@/components/home/cards/TransferAnnouncementCard'
import { PostComposer } from '@/components/home/PostComposer'
import { PostComposerModal } from '@/components/home/PostComposerModal'
import { FeedSkeleton } from '@/components/home/FeedSkeleton'
import type { HomeFeedItem, UserPostFeedItem } from '@/types/homeFeed'

interface ProfilePostsTabProps {
  profileId: string
  readOnly?: boolean
}

/** Same error boundary used by HomeFeed — isolates crashes to individual cards. */
class PostItemErrorBoundary extends Component<
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
      extra: { componentStack: info.componentStack, context: 'ProfilePostsTab' },
    })
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

export default function ProfilePostsTab({ profileId, readOnly = false }: ProfilePostsTabProps) {
  const { items, isLoading, error, hasMore, loadMore, refetch, updateItemLike, removeItem, prependItem } = useProfilePosts(profileId)
  const [showComposerModal, setShowComposerModal] = useState(false)

  const handleLoadMore = useCallback(() => {
    void loadMore()
  }, [loadMore])

  const handlePostCreated = useCallback((item: HomeFeedItem) => {
    if (item.item_type === 'user_post') {
      prependItem(item as UserPostFeedItem)
    }
  }, [prependItem])

  return (
    <div>
      {/* Post composer — owner only */}
      {!readOnly && (
        <div className="mb-6">
          <PostComposer onPostCreated={handlePostCreated} />
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

      {/* Empty state */}
      {!isLoading && !error && items.length === 0 && (
        <div className="text-center py-12">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          {readOnly ? (
            <p className="text-gray-500">No posts yet.</p>
          ) : (
            <>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No posts yet
              </h3>
              <p className="text-gray-500 mb-4">
                Share your first update with the HOCKIA community.
              </p>
              <button
                type="button"
                onClick={() => setShowComposerModal(true)}
                className="px-5 py-2.5 bg-gradient-to-r from-[#8026FA] to-[#924CEC] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                Create a post
              </button>
            </>
          )}
        </div>
      )}

      {/* Post list */}
      {items.length > 0 && (
        <div className="space-y-6">
          {items.map(item => (
            <PostItemErrorBoundary key={item.feed_item_id}>
              {item.post_type === 'transfer' && item.metadata ? (
                <TransferAnnouncementCard
                  item={item}
                  onLikeUpdate={updateItemLike}
                  onDelete={removeItem}
                />
              ) : (
                <UserPostCard
                  item={item}
                  onLikeUpdate={updateItemLike}
                  onDelete={removeItem}
                />
              )}
            </PostItemErrorBoundary>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !isLoading && (
        <div className="text-center pt-6">
          <button
            type="button"
            onClick={handleLoadMore}
            className="px-6 py-2.5 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            Load more
          </button>
        </div>
      )}

      {/* Pagination loading */}
      {isLoading && items.length > 0 && (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 text-[#8026FA] animate-spin" />
        </div>
      )}

      {/* Composer modal for empty-state CTA */}
      {showComposerModal && (
        <PostComposerModal
          isOpen={showComposerModal}
          onClose={() => setShowComposerModal(false)}
          onPostCreated={handlePostCreated}
        />
      )}
    </div>
  )
}
