import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { MoreHorizontal, Pencil, Trash2, Flag } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import { PostComposerModal } from '../PostComposerModal'
import ReportUserModal from '@/components/ReportUserModal'
import type { UserPostFeedItem } from '@/types/homeFeed'

interface UserPostCardProps {
  item: UserPostFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
}

export function UserPostCard({ item, onLikeUpdate, onDelete }: UserPostCardProps) {
  const { user } = useAuthStore()
  const { toggleLike } = usePostInteractions()
  const { deletePost } = useUserPosts()

  const [showComments, setShowComments] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [showReport, setShowReport] = useState(false)

  const timeAgo = getTimeAgo(item.created_at, true)
  const isOwner = user?.id === item.author_id

  const profilePath = item.author_role === 'club'
    ? `/clubs/id/${item.author_id}?ref=feed`
    : item.author_role === 'brand'
      ? `/brands/${item.author_id}?ref=feed`
      : `/players/id/${item.author_id}?ref=feed`

  const sortedImages = useMemo(
    () => item.images ? [...item.images].sort((a, b) => a.order - b.order) : [],
    [item.images]
  )

  const handleMediaClick = useCallback((gridIndex: number) => {
    if (gridIndex >= 0 && gridIndex < sortedImages.length) {
      setLightboxIndex(gridIndex)
      setLightboxOpen(true)
    }
  }, [sortedImages.length])

  // Content truncation (show more/less)
  const isLongContent = item.content.length > 300
  const displayContent = isLongContent && !isExpanded
    ? item.content.slice(0, 300) + '...'
    : item.content

  const handleToggleLike = useCallback(async () => {
    const newLiked = !item.has_liked
    const newCount = newLiked ? item.like_count + 1 : item.like_count - 1

    // Optimistic update
    onLikeUpdate?.(item.post_id, newLiked, newCount)

    const result = await toggleLike(item.post_id)
    if (result.success && result.liked !== undefined && result.like_count !== undefined) {
      // Correct with server state
      onLikeUpdate?.(item.post_id, result.liked, result.like_count)
    } else if (!result.success) {
      // Rollback optimistic update on failure
      onLikeUpdate?.(item.post_id, item.has_liked, item.like_count)
    }
  }, [item.has_liked, item.like_count, item.post_id, onLikeUpdate, toggleLike])

  const handleDelete = useCallback(async () => {
    if (!confirm('Are you sure you want to delete this post?')) return
    setShowMenu(false)

    const result = await deletePost(item.post_id)
    if (result.success) {
      onDelete?.(item.feed_item_id)
    }
  }, [item.post_id, item.feed_item_id, deletePost, onDelete])

  const handleCommentCountChange = useCallback((newCount: number) => {
    setLocalCommentCount(newCount)
  }, [])

  return (
    <>
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 pb-2">
          <Link to={profilePath} className="flex-shrink-0">
            <Avatar
              src={item.author_avatar}
              initials={item.author_name?.slice(0, 2) || '?'}
              size="md"
            />
          </Link>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link
                to={profilePath}
                className="font-semibold text-gray-900 truncate hover:text-indigo-600 transition-colors text-sm"
              >
                {item.author_name || 'Unknown'}
              </Link>
              <RoleBadge role={item.author_role} />
            </div>
            <p className="text-xs text-gray-500">{timeAgo}</p>
          </div>

          {/* Post menu — owners: edit/delete, others: report */}
          {user && (
            <div className="relative">
              <button
                type="button"
                aria-label="Post options"
                onClick={() => setShowMenu(!showMenu)}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {showMenu && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-36">
                    {isOwner ? (
                      <>
                        <button
                          type="button"
                          onClick={() => { setShowMenu(false); setIsEditing(true) }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit post
                        </button>
                        <button
                          type="button"
                          onClick={handleDelete}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete post
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setShowMenu(false); setShowReport(true) }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        <Flag className="w-3.5 h-3.5" />
                        Report post
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-4 pb-3">
          <p className="text-gray-800 whitespace-pre-wrap text-sm leading-relaxed">
            {displayContent}
          </p>
          {isLongContent && !isExpanded && (
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="text-sm font-medium text-gray-500 hover:text-gray-700 mt-1"
            >
              ...see more
            </button>
          )}
        </div>

        {/* Media grid */}
        {sortedImages.length > 0 && (
          <div className="px-4 pb-2">
            <FeedMediaGrid media={sortedImages} onImageClick={handleMediaClick} />
          </div>
        )}

        {/* Interaction bar */}
        <PostInteractionBar
          postId={item.post_id}
          likeCount={item.like_count}
          commentCount={localCommentCount}
          hasLiked={item.has_liked}
          onToggleLike={handleToggleLike}
          onToggleComments={() => setShowComments(!showComments)}
          showComments={showComments}
          authorId={item.author_id}
          authorName={item.author_name}
          authorAvatar={item.author_avatar}
          authorRole={item.author_role}
          content={item.content}
          thumbnailUrl={sortedImages[0]?.thumb_url || sortedImages[0]?.url || null}
        />

        {/* Comments section */}
        {showComments && (
          <PostCommentsSection
            postId={item.post_id}
            commentCount={localCommentCount}
            onCommentCountChange={handleCommentCountChange}
          />
        )}
      </div>

      {/* Edit modal */}
      {isEditing && (
        <PostComposerModal
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          onPostCreated={() => {
            // Refetch will handle the update
            setIsEditing(false)
          }}
          editingPost={{
            id: item.post_id,
            content: item.content,
            images: item.images,
          }}
        />
      )}

      {/* Media lightbox */}
      {lightboxOpen && sortedImages.length > 0 && (
        <MediaLightbox
          images={sortedImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Report modal */}
      {showReport && (
        <ReportUserModal
          targetId={item.author_id}
          targetName={item.author_name || 'Unknown'}
          contentType="post"
          contentId={item.post_id}
          onClose={() => setShowReport(false)}
        />
      )}
    </>
  )
}
