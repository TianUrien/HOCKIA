import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MoreHorizontal, Trash2, Shield } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { Avatar } from '@/components'
import { getImageUrl } from '@/lib/imageUrl'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import { FeedCard, FeedCardBody, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
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

  // Sync local state to prop on parent refetch (cross-cache invalidation).
  // See UserPostCard for the full rationale.
  useEffect(() => {
    setLocalCommentCount(item.comment_count)
  }, [item.comment_count])

  const isOwner = user?.id === item.author_id

  const profilePath = profilePathForRole(item.author_role, item.author_id)

  // The destination club is a profile only when the transfer was made to a
  // claimed HOCKIA club; a world-club / free-text destination stays unlinked.
  const clubPath = meta.club_profile_id ? profilePathForRole('club', meta.club_profile_id) : null

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

  const menu = isOwner ? (
    <div className="relative">
      <button
        type="button"
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={showMenu}
        onClick={() => setShowMenu(!showMenu)}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
              Delete post
            </button>
          </div>
        </>
      )}
    </div>
  ) : null

  const clubAvatar = (
    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-gray-100 ring-1 ring-gray-200">
      {meta.club_avatar_url ? (
        <img src={getImageUrl(meta.club_avatar_url, 'avatar-md') ?? undefined} alt={meta.club_name} className="h-full w-full object-cover" decoding="async" />
      ) : (
        <Shield className="h-7 w-7 text-gray-400" />
      )}
    </div>
  )
  const clubName = (
    <p className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">{meta.club_name}</p>
  )

  return (
    <FeedCard testId="transfer-announcement-card">
      <FeedCardHeader
        authorId={item.author_id}
        name={item.author_name}
        avatarUrl={item.author_avatar}
        role={item.author_role}
        createdAt={item.created_at}
        profilePath={profilePath}
        right={menu}
      />
      <FeedCardCaption icon={<ArrowRight />}>Transfer announcement</FeedCardCaption>

      {/* Transfer visual: Player → Club */}
      <div className="px-4 pb-3 pt-1">
        <div className="flex items-start justify-center gap-3 sm:gap-6">
          {/* Player */}
          <div className="w-[130px] flex-shrink-0 text-center">
            <Link to={profilePath} className="mx-auto inline-block">
              <Avatar
                src={item.author_avatar}
                initials={item.author_name?.slice(0, 2) || '?'}
                size="lg"
                role={item.author_role}
              />
            </Link>
            <div className="mt-2 flex min-h-[40px] items-start justify-center">
              <Link to={profilePath}>
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">
                  {item.author_name || 'Unknown'}
                </p>
              </Link>
            </div>
          </div>

          {/* Arrow — vertically centered with avatars */}
          <div className="flex flex-shrink-0 items-center justify-center pt-5">
            <ArrowRight className="h-6 w-6 text-[#c2410c]" />
          </div>

          {/* Club */}
          <div className="w-[130px] flex-shrink-0 text-center">
            {clubPath ? (
              <Link to={clubPath} className="mx-auto inline-block">{clubAvatar}</Link>
            ) : (
              <div className="mx-auto inline-block">{clubAvatar}</div>
            )}
            {/* Name — same row height as player name */}
            <div className="mt-2 flex min-h-[40px] items-start justify-center">
              {clubPath ? <Link to={clubPath}>{clubName}</Link> : clubName}
            </div>
          </div>
        </div>
      </div>

      {hasCustomMessage && (
        <FeedCardBody>
          <p className="whitespace-pre-wrap">{item.content}</p>
        </FeedCardBody>
      )}

      {sortedImages.length > 0 && (
        <FeedCardMedia>
          <FeedMediaGrid
            media={sortedImages}
            altPrefix={item.author_name ? `Transfer announcement by ${item.author_name}` : 'Transfer announcement'}
            onImageClick={handleImageClick}
          />
        </FeedCardMedia>
      )}

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

      {showComments && (
        <PostCommentsSection
          postId={item.post_id}
          commentCount={localCommentCount}
          onCommentCountChange={handleCommentCountChange}
        />
      )}

      {lightboxOpen && lightboxImages.length > 0 && (
        <MediaLightbox
          images={lightboxImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
        />
      )}
    </FeedCard>
  )
}
