import { useState, useCallback, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Flag, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import ReportUserModal from '@/components/ReportUserModal'
import { MENU_ICON_CLASS, REPORT_MENU_LABEL } from '@/lib/report'
import { MoreMenu, type MoreMenuItem } from '@/components/safety/MoreMenu'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { Avatar } from '@/components'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import { FeedCard, FeedCardBody, FeedCardCaption, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
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
  const [showReport, setShowReport] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)

  // Sync local state to prop on parent refetch (cross-cache invalidation).
  // See UserPostCard for the full rationale.
  useEffect(() => {
    setLocalCommentCount(item.comment_count)
  }, [item.comment_count])

  const isOwner = user?.id === item.author_id

  // Club (author) path
  const clubPath = profilePathForRole(item.author_role, item.author_id)
  // Signed person path — routed by their role (player or coach).
  const personPath = profilePathForRole(meta.person_role, meta.person_profile_id)

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

    const result = await deletePost(item.post_id)
    if (result.success) {
      onDelete?.(item.feed_item_id)
    }
  }, [item.post_id, item.feed_item_id, deletePost, onDelete])

  const handleCommentCountChange = useCallback((newCount: number) => {
    setLocalCommentCount(newCount)
  }, [])

  const menuItems: MoreMenuItem[] = isOwner
    ? [{ key: 'delete', label: 'Delete post', icon: <Trash2 className={MENU_ICON_CLASS} strokeWidth={1.8} />, destructive: true, onSelect: () => void handleDelete() }]
    : [{ key: 'report', label: REPORT_MENU_LABEL, icon: <Flag className={MENU_ICON_CLASS} strokeWidth={1.8} />, onSelect: () => setShowReport(true) }]
  const menu = user ? (
    <MoreMenu items={menuItems} label="Post options" title={item.author_name ?? undefined} triggerClassName="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900" testId="post-more-menu" />
  ) : null

  return (
    <FeedCard testId="signing-announcement-card">
      <FeedCardHeader
        authorId={item.author_id}
        name={item.author_name}
        avatarUrl={item.author_avatar}
        role={item.author_role}
        createdAt={item.created_at}
        profilePath={clubPath}
        right={menu}
      />
      <FeedCardCaption icon={<ArrowRight />}>New signing</FeedCardCaption>

      {/* Signing visual: Person → Club */}
      <div className="px-4 pb-3 pt-1">
        <div className="flex items-start justify-center gap-3 sm:gap-6">
          {/* Signed person */}
          <div className="w-[130px] flex-shrink-0 text-center">
            <Link to={personPath} className="mx-auto inline-block">
              <Avatar
                src={meta.person_avatar_url}
                initials={meta.person_name?.slice(0, 2) || '?'}
                size="lg"
                role={meta.person_role}
              />
            </Link>
            <div className="mt-2 flex min-h-[40px] items-start justify-center">
              <Link to={personPath}>
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">
                  {meta.person_name}
                </p>
              </Link>
            </div>
          </div>

          {/* Arrow — vertically centered with avatars */}
          <div className="flex flex-shrink-0 items-center justify-center pt-5">
            <ArrowRight className="h-6 w-6 text-[#c2410c]" />
          </div>

          {/* Club (author) */}
          <div className="w-[130px] flex-shrink-0 text-center">
            <Link to={clubPath} className="mx-auto inline-block">
              <Avatar
                src={item.author_avatar}
                initials={item.author_name?.slice(0, 2) || '?'}
                size="lg"
                role={item.author_role}
              />
            </Link>
            <div className="mt-2 flex min-h-[40px] items-start justify-center">
              <Link to={clubPath}>
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-gray-900">
                  {item.author_name || 'Unknown'}
                </p>
              </Link>
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
            altPrefix={item.author_name ? `Signing announcement by ${item.author_name}` : 'Signing announcement'}
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
      {showReport && (
        <ReportUserModal targetId={item.author_id} contentType="post" contentId={item.post_id} onClose={() => setShowReport(false)} />
      )}
    </FeedCard>
  )
}
