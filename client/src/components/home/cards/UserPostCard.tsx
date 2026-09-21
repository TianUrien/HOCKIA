import { useState, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { MoreHorizontal, Pencil, Trash2, Flag, CircleHelp } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { useUserPosts } from '@/hooks/useUserPosts'
import { useTopAnswer, clearTopAnswerCache } from '@/hooks/useTopAnswer'
import { FeedMediaGrid } from '../FeedMediaGrid'
import { MediaLightbox } from '../MediaLightbox'
import { PostInteractionBar } from '../PostInteractionBar'
import { PostCommentsSection } from '../PostCommentsSection'
import { PostComposerModal } from '../PostComposerModal'
import { FeedCard, FeedCardBody, FeedCardHeader, FeedCardMedia, profilePathForRole } from '../FeedCard'
import { Avatar } from '@/components'
import ReportUserModal from '@/components/ReportUserModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import { identityLine } from '@/lib/identity'
import { getShareOrigin } from '@/lib/profileShare'
import { useToastStore } from '@/lib/toast'
import type { UserPostFeedItem } from '@/types/homeFeed'

// Signed Cloudflare player (mints a playback token from video_id). Lazy so its
// HLS path stays off the entry bundle.
const NativeVideoPlayer = lazy(() => import('@/components/media/NativeVideoPlayer'))

interface UserPostCardProps {
  item: UserPostFeedItem
  onLikeUpdate?: (postId: string, liked: boolean, likeCount: number) => void
  onDelete?: (feedItemId: string) => void
  /** Post detail page: comments/answers open by default and never navigate away. */
  detail?: boolean
}

/**
 * A member's post in the feed (Figma Home v2 "post/…"), and — when
 * post_type is 'question' — the question card: purple "Question" pill above
 * the text, the top answer previewed in a grey block, "N answers" and an
 * Answer pill. Tapping a question anywhere opens Post detail, where the
 * comments are labelled "Answers".
 */
export function UserPostCard({ item, onLikeUpdate, onDelete, detail = false }: UserPostCardProps) {
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const { toggleLike } = usePostInteractions()
  const { deletePost } = useUserPosts()

  const isQuestion = item.post_type === 'question'
  const [showComments, setShowComments] = useState(detail)
  const [showMenu, setShowMenu] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [localCommentCount, setLocalCommentCount] = useState(item.comment_count)
  const [lightboxOpen, setLightboxOpen] = useState(false)
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [showReport, setShowReport] = useState(false)

  // Sync local state to prop when the parent refetches and `item.comment_count`
  // updates (e.g. after cross-cache invalidation triggers a feed refetch that
  // picks up another user's comment).
  useEffect(() => {
    setLocalCommentCount(item.comment_count)
  }, [item.comment_count])

  const isOwner = user?.id === item.author_id
  const topAnswer = useTopAnswer(item.post_id, isQuestion && !detail && item.comment_count > 0)

  // Brand profile routes are slug-based and the user_post payload carries no
  // slug — brand-authored posts stay unlinked (their content path is BrandPostCard).
  const profilePath = item.author_role === 'brand' ? null : profilePathForRole(item.author_role, item.author_id)
  const detailPath = `/post/${item.post_id}`

  const sortedImages = useMemo(
    () => item.images ? [...item.images].sort((a, b) => a.order - b.order) : [],
    [item.images]
  )

  // A post whose ONLY media item is a Cloudflare reel plays inline (one tap).
  const soloCloudflareVideo = useMemo(() => {
    if (sortedImages.length !== 1) return null
    const only = sortedImages[0]
    return only.media_type === 'video' && only.video_id ? only : null
  }, [sortedImages])

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
      onLikeUpdate?.(item.post_id, result.liked, result.like_count)
    } else if (!result.success) {
      onLikeUpdate?.(item.post_id, item.has_liked, item.like_count)
    }
  }, [item.has_liked, item.like_count, item.post_id, onLikeUpdate, toggleLike])

  // window.confirm gets suppressed inside iOS PWAs / mobile-emulated Chrome,
  // so deletion goes through ConfirmDialog.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const handleDeleteClick = useCallback(() => {
    setShowMenu(false)
    setShowDeleteConfirm(true)
  }, [])
  const handleDelete = useCallback(async () => {
    const result = await deletePost(item.post_id)
    if (result.success) {
      onDelete?.(item.feed_item_id)
    }
  }, [item.post_id, item.feed_item_id, deletePost, onDelete])

  const handleCommentCountChange = useCallback((newCount: number) => {
    setLocalCommentCount(newCount)
    clearTopAnswerCache(item.post_id)
  }, [item.post_id])

  // Questions are consumed on their own screen (Home v2 DEV NOTE: "Tap
  // anywhere → Post detail"); posts expand their comments in place.
  const openConversation = useCallback(() => {
    if (isQuestion && !detail) navigate(detailPath)
    else setShowComments((v) => !v)
  }, [isQuestion, detail, navigate, detailPath])

  const handleShareFromViewer = useCallback(async () => {
    const url = `${getShareOrigin()}${detailPath}`
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: item.author_name ?? 'HOCKIA', url })
        return
      }
      await navigator.clipboard.writeText(url)
      addToast('Link copied to clipboard', 'success')
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError')) addToast('Could not share this post', 'error')
    }
  }, [detailPath, item.author_name, addToast])

  const menu = user ? (
    <div className="relative">
      <button
        type="button"
        aria-label="Post options"
        aria-haspopup="menu"
        aria-expanded={showMenu}
        onClick={() => setShowMenu(!showMenu)}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-full text-ink-4 transition-colors hover:bg-surface-muted hover:text-ink-1"
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
          <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-40 rounded-card border border-line bg-white py-1 shadow-lg">
            {isOwner ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setShowMenu(false); setIsEditing(true) }}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50"
                >
                  <Pencil className="h-4 w-4" />
                  {isQuestion ? 'Edit question' : 'Edit post'}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDeleteClick}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  {isQuestion ? 'Delete question' : 'Delete post'}
                </button>
              </>
            ) : (
              <button
                type="button"
                role="menuitem"
                onClick={() => { setShowMenu(false); setShowReport(true) }}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-sm text-gray-800 hover:bg-gray-50"
              >
                <Flag className="h-4 w-4" />
                {isQuestion ? 'Report question' : 'Report post'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  ) : null

  const body = item.content.trim() ? (
    <FeedCardBody>
      <p className="whitespace-pre-wrap">{displayContent}</p>
      {isLongContent && !isExpanded && !isQuestion && (
        <button
          type="button"
          onClick={() => setIsExpanded(true)}
          className="mt-1 text-[14px] font-medium text-ink-2 hover:text-ink-1"
        >
          See more
        </button>
      )}
    </FeedCardBody>
  ) : null

  return (
    <>
      <FeedCard testId={isQuestion ? 'question-card' : 'user-post-card'}>
        <FeedCardHeader
          authorId={item.author_id}
          name={item.author_name}
          avatarUrl={item.author_avatar}
          role={item.author_role}
          createdAt={item.created_at}
          profilePath={profilePath}
          right={menu}
        />

        {isQuestion && (
          <div className="px-5 pb-2.5">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-hockia-soft px-2.5 py-[3px] text-caption font-semibold text-hockia-primary">
              <CircleHelp className="h-[13px] w-[13px]" strokeWidth={2} />
              Question
            </span>
          </div>
        )}

        {isQuestion && !detail ? (
          <button type="button" onClick={openConversation} className="block w-full text-left" aria-label="Open question">
            {body}
          </button>
        ) : (
          body
        )}

        {/* A single Cloudflare reel plays INLINE (one tap) via the signed player —
            no lightbox detour. Mixed media / legacy MP4s keep the grid. */}
        {soloCloudflareVideo ? (
          <FeedCardMedia>
            <Suspense fallback={<div className="aspect-video w-full animate-pulse bg-gray-100" />}>
              <NativeVideoPlayer
                videoId={soloCloudflareVideo.video_id!}
                durationSeconds={soloCloudflareVideo.duration ?? null}
              />
            </Suspense>
          </FeedCardMedia>
        ) : sortedImages.length > 0 ? (
          <FeedCardMedia>
            <FeedMediaGrid
              media={sortedImages}
              altPrefix={item.author_name ? `Post by ${item.author_name}` : 'Post image'}
              onImageClick={handleMediaClick}
            />
          </FeedCardMedia>
        ) : null}

        {isQuestion && !detail && topAnswer && (
          <div className="px-5 pb-2.5">
            <button
              type="button"
              onClick={openConversation}
              className="block w-full rounded-[10px] bg-surface-grouped px-3 py-2 text-left"
              aria-label="See all answers"
            >
              <span className="flex items-center gap-1.5 text-secondary">
                <Avatar
                  src={topAnswer.author_avatar}
                  initials={topAnswer.author_name?.slice(0, 2) || '?'}
                  size="sm"
                  className="!h-5 !w-5"
                  role={topAnswer.author_role}
                />
                <span className="truncate font-semibold text-ink-1">{topAnswer.author_name || 'Member'}</span>
                <span className="shrink-0 text-ink-2">· {identityLine(topAnswer.author_role)} · Top answer</span>
              </span>
              <span className="mt-1 line-clamp-3 block text-[14px] leading-[19px] text-ink-1">{topAnswer.content}</span>
            </button>
          </div>
        )}

        <PostInteractionBar
          postId={item.post_id}
          likeCount={item.like_count}
          commentCount={localCommentCount}
          hasLiked={item.has_liked}
          onToggleLike={handleToggleLike}
          onToggleComments={openConversation}
          showComments={showComments}
          authorId={item.author_id}
          authorName={item.author_name}
          authorAvatar={item.author_avatar}
          authorRole={item.author_role}
          content={item.content}
          thumbnailUrl={sortedImages[0]?.thumb_url || sortedImages[0]?.url || null}
          variant={isQuestion ? 'question' : 'post'}
          onAnswer={openConversation}
        />

        {showComments && (
          <PostCommentsSection
            postId={item.post_id}
            commentCount={localCommentCount}
            onCommentCountChange={handleCommentCountChange}
            variant={isQuestion ? 'answers' : 'comments'}
            autoFocus={!detail}
          />
        )}
      </FeedCard>

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

      {lightboxOpen && sortedImages.length > 0 && (
        <MediaLightbox
          images={sortedImages}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxOpen(false)}
          author={{
            id: item.author_id,
            name: item.author_name,
            avatarUrl: item.author_avatar,
            role: item.author_role,
            profilePath,
          }}
          caption={item.content}
          stats={{
            likeCount: item.like_count,
            commentCount: localCommentCount,
            hasLiked: item.has_liked,
            onToggleLike: user ? () => void handleToggleLike() : undefined,
            onComment: () => { setLightboxOpen(false); if (isQuestion && !detail) navigate(detailPath); else setShowComments(true) },
          }}
          onShare={() => void handleShareFromViewer()}
        />
      )}

      {showReport && (
        <ReportUserModal
          targetId={item.author_id}
          targetName={item.author_name || 'Unknown'}
          contentType="post"
          contentId={item.post_id}
          onClose={() => setShowReport(false)}
        />
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={handleDelete}
        title={isQuestion ? 'Delete this question?' : 'Delete this post?'}
        message={isQuestion ? 'The question and its answers will be removed permanently. This can\'t be undone.' : 'The post and its comments and likes will be removed permanently. This can\'t be undone.'}
        confirmLabel={isQuestion ? 'Delete question' : 'Delete post'}
        variant="danger"
        testId="user-post-delete-confirm"
      />
    </>
  )
}
