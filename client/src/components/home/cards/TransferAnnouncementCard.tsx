import { useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MoreHorizontal, Trash2, Shield } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { Avatar, RoleBadge } from '@/components'
import { getTimeAgo } from '@/lib/utils'
import { getImageUrl } from '@/lib/imageUrl'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import type { UserPostFeedItem, TransferMetadata } from '@/types/homeFeed'

interface TransferAnnouncementCardProps {
  item: UserPostFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
}

export function TransferAnnouncementCard({ item, onLikeUpdate, onDelete }: TransferAnnouncementCardProps) {
  const { user } = useAuthStore()
  const { toggleLike } = usePostInteractions()
  const { deletePost } = useUserPosts()
  const meta = item.metadata as TransferMetadata

  const [showComments, setShowComments] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  const timeAgo = getTimeAgo(item.created_at, true)
  const isOwner = user?.id === item.author_id

  const profilePath = item.author_role === 'club'
    ? `/clubs/id/${item.author_id}`
    : `/players/id/${item.author_id}`

  const clubPath = meta.club_profile_id ? `/clubs/id/${meta.club_profile_id}` : null

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
  const defaultContent = `Joined ${meta.club_name}!`
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
      {/* Branded header */}
      <div className="bg-gradient-to-r from-[#8026FA] to-[#924CEC] px-4 py-2.5 flex items-center gap-2">
        <ArrowRight className="w-4 h-4 text-white" />
        <span className="text-sm font-medium text-white">Transfer Announcement</span>
        <span className="ml-auto text-xs text-white/70">{timeAgo}</span>

        {/* Owner menu */}
        {isOwner && (
          <div className="relative ml-1">
            <button
              type="button"
              aria-label="Post options"
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

      {/* Transfer visual: Player → Club */}
      <div className="px-4 py-6">
        <div className="flex items-start justify-center gap-3 sm:gap-6">
          {/* Player */}
          <div className="text-center flex-shrink-0 w-[130px]">
            <Link to={profilePath} className="inline-block mx-auto">
              <Avatar
                src={item.author_avatar}
                initials={item.author_name?.slice(0, 2) || '?'}
                size="lg"
              />
            </Link>
            <div className="mt-2 min-h-[40px] flex items-start justify-center">
              <Link to={profilePath}>
                <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-5">
                  {item.author_name || 'Unknown'}
                </p>
              </Link>
            </div>
            <div className="mt-1 h-6 flex items-center justify-center">
              <RoleBadge role={item.author_role} />
            </div>
          </div>

          {/* Arrow — vertically centered with avatars */}
          <div className="flex items-center justify-center flex-shrink-0 pt-5">
            <ArrowRight className="w-6 h-6 text-[#8026FA]" />
          </div>

          {/* Club */}
          <div className="text-center flex-shrink-0 w-[130px]">
            {/* Avatar — same w-16 h-16 as player */}
            {clubPath ? (
              <Link to={clubPath} className="inline-block mx-auto">
                <div className="w-16 h-16 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center overflow-hidden">
                  {meta.club_avatar_url ? (
                    <img src={getImageUrl(meta.club_avatar_url, 'avatar-md') ?? undefined} alt={meta.club_name} className="w-full h-full object-cover" decoding="async" />
                  ) : (
                    <Shield className="w-7 h-7 text-gray-400" />
                  )}
                </div>
              </Link>
            ) : (
              <div className="w-16 h-16 rounded-full bg-gray-100 border-2 border-gray-200 flex items-center justify-center mx-auto overflow-hidden">
                {meta.club_avatar_url ? (
                  <img src={getImageUrl(meta.club_avatar_url, 'avatar-md') ?? undefined} alt={meta.club_name} className="w-full h-full object-cover" decoding="async" />
                ) : (
                  <Shield className="w-7 h-7 text-gray-400" />
                )}
              </div>
            )}
            {/* Name — same row height as player name */}
            <div className="mt-2 min-h-[40px] flex items-start justify-center">
              {clubPath ? (
                <Link to={clubPath}>
                  <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-5">
                    {meta.club_name}
                  </p>
                </Link>
              ) : (
                <p className="text-sm font-semibold text-gray-900 line-clamp-2 leading-5">
                  {meta.club_name}
                </p>
              )}
            </div>
            {/* Tag row — same h-6 as player's RoleBadge row */}
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
        authorId={item.author_id}
        authorName={item.author_name}
        authorAvatar={item.author_avatar}
        authorRole={item.author_role}
        content={item.content || ''}
        thumbnailUrl={item.images?.[0]?.url ?? null}
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
