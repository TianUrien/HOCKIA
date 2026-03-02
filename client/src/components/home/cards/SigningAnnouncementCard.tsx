import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MoreHorizontal, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import type { UserPostFeedItem, SigningMetadata } from '@/types/homeFeed'

interface SigningAnnouncementCardProps {
  item: UserPostFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
}

export function SigningAnnouncementCard({ item, onLikeUpdate, onDelete }: SigningAnnouncementCardProps) {
  const { user } = useAuthStore()
  const { toggleLike } = usePostInteractions()
  const { deletePost } = useUserPosts()
  const meta = item.metadata as SigningMetadata

  const [showComments, setShowComments] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const timeAgo = getTimeAgo(item.created_at, true)
  const isOwner = user?.id === item.author_id

  // Club (author) path
  const clubPath = `/clubs/id/${item.author_id}`
  // Signed person path
  const personPath = meta.person_role === 'coach'
    ? `/coaches/id/${meta.person_profile_id}`
    : `/players/id/${meta.person_profile_id}`

  const sortedImages = useMemo(
    () => item.images ? [...item.images].sort((a, b) => a.order - b.order) : [],
    [item.images]
  )

  const lightboxImages = useMemo(
    () => sortedImages.filter((m) => (m.media_type ?? 'image') === 'image'),
    [sortedImages]
  )

  const handleImageClick = useCallback((gridIndex: number) => {
    const clickedItem = sortedImages[gridIndex]
    if (!clickedItem || (clickedItem.media_type ?? 'image') !== 'image') return
    const idx = lightboxImages.findIndex((img) => img.url === clickedItem.url)
    if (idx >= 0) {
      setLightboxIndex(idx)
      setLightboxOpen(true)
    }
  }, [sortedImages, lightboxImages])

  // Check if content is the auto-generated default
  const defaultContent = `Welcome ${meta.person_name} to ${item.author_name}!`
  const hasCustomMessage = item.content && item.content !== defaultContent

  const handleToggleLike = useCallback(async () => {
    const newLiked = !item.has_liked
    const newCount = newLiked ? item.like_count + 1 : item.like_count - 1
    onLikeUpdate?.(item.post_id, newLiked, newCount)

    const result = await toggleLike(item.post_id)
    if (result.success && result.liked !== undefined && result.like_count !== undefined) {
      onLikeUpdate?.(item.post_id, result.liked, result.like_count)
    } else if (!result.success) {
      onLikeUpdate?.(item.post_id, item.has_liked, item.like_count)
    }
  }, [item.has_liked, item.like_count, item.post_id, onLikeUpdate, toggleLike])

  const handleDelete = useCallback(async () => {
    if (!confirm('Are you sure you want to delete this announcement?')) return
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
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
      {/* Branded header — club orange */}
      <div className="bg-gradient-to-r from-[#EA580C] to-[#F97316] px-4 py-2.5 flex items-center gap-2">
        <ArrowRight className="w-4 h-4 text-white" />
        <span className="text-sm font-medium text-white">New Signing</span>
        <span className="ml-auto text-xs text-white/70">{timeAgo}</span>

        {/* Owner menu */}
        {isOwner && (
          <div className="relative ml-1">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 text-white/70 hover:text-white rounded transition-colors"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-36">
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Signing visual: Person → Club */}
      <div className="px-4 py-6">
        <div className="flex items-start justify-center gap-3 sm:gap-6">
          {/* Signed person */}
          <div className="text-center flex-shrink-0 w-[130px]">
            <Link to={personPath} className="inline-block mx-auto">
              <Avatar
                src={meta.person_avatar_url}
                initials={meta.person_name?.slice(0, 2) || '?'}
                size="lg"
              />
            </Link>
            <div className="mt-2 min-h-[40px] flex items-start justify-center">
              <Link to={personPath}>
                <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-5">
                  {meta.person_name}
                </p>
              </Link>
            </div>
            <div className="mt-1 h-6 flex items-center justify-center">
              <RoleBadge role={meta.person_role} />
            </div>
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center flex-shrink-0 pt-5">
            <ArrowRight className="w-6 h-6 text-[#EA580C]" />
          </div>

          {/* Club (author) */}
          <div className="text-center flex-shrink-0 w-[130px]">
            <Link to={clubPath} className="inline-block mx-auto">
              <Avatar
                src={item.author_avatar}
                initials={item.author_name?.slice(0, 2) || '?'}
                size="lg"
              />
            </Link>
            <div className="mt-2 min-h-[40px] flex items-start justify-center">
              <Link to={clubPath}>
                <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-5">
                  {item.author_name || 'Unknown'}
                </p>
              </Link>
            </div>
            <div className="mt-1 h-6 flex items-center justify-center">
              <RoleBadge role="club" />
            </div>
          </div>
        </div>

        {/* Custom message */}
        {hasCustomMessage && (
          <p className="mt-5 text-gray-700 text-sm text-center leading-relaxed whitespace-pre-wrap">
            {item.content}
          </p>
        )}
      </div>

      {/* Media grid */}
      {sortedImages.length > 0 && (
        <div className="px-4 pb-2">
          <FeedMediaGrid media={sortedImages} onImageClick={handleImageClick} />
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
      />

      {/* Comments section */}
      {showComments && (
        <PostCommentsSection
          postId={item.post_id}
          commentCount={localCommentCount}
          onCommentCountChange={handleCommentCountChange}
        />
      )}

      {/* Media lightbox */}
      {lightboxOpen && lightboxImages.length > 0 && (
        <MediaLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </div>
  )
}
