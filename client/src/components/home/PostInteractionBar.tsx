import { useCallback, useState } from 'react'
import { Heart, MessageCircle, Share2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { SharePostSheet } from './SharePostSheet'

interface PostInteractionBarProps {
  postId: string
  likeCount: number
  commentCount: number
  hasLiked: boolean
  onToggleLike: () => Promise<void>
  onToggleComments: () => void
  showComments: boolean
  authorId: string
  authorName: string | null
  authorAvatar: string | null
  authorRole: 'player' | 'coach' | 'club' | 'brand' | 'umpire'
  content: string
  thumbnailUrl: string | null
}

export function PostInteractionBar({
  postId,
  likeCount,
  commentCount,
  hasLiked,
  onToggleLike,
  onToggleComments,
  showComments,
  authorId,
  authorName,
  authorAvatar,
  authorRole,
  content,
  thumbnailUrl,
}: PostInteractionBarProps) {
  const { user } = useAuthStore()
  const [isLiking, setIsLiking] = useState(false)
  const [showShareSheet, setShowShareSheet] = useState(false)

  const handleLike = useCallback(async () => {
    if (!user || isLiking) return
    setIsLiking(true)
    try {
      await onToggleLike()
    } finally {
      setIsLiking(false)
    }
  }, [user, isLiking, onToggleLike])

  return (
    <div>
      {/* Counts row — hide each side independently when its count is 0 so
          we never render an unlabeled clickable button (was an a11y bug:
          screen readers announced a nameless button on posts with likes
          but no comments). */}
      {(likeCount > 0 || commentCount > 0) && (
        <div className="flex items-center justify-between px-4 py-1.5 text-xs text-gray-500">
          {likeCount > 0 ? (
            <span>{likeCount} like{likeCount !== 1 ? 's' : ''}</span>
          ) : (
            <span />
          )}
          {commentCount > 0 && (
            <button
              type="button"
              onClick={onToggleComments}
              aria-label={`Show ${commentCount} comment${commentCount !== 1 ? 's' : ''}`}
              className="hover:text-gray-700 hover:underline"
            >
              {commentCount} comment{commentCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
      )}
      {/* §2.6 low-engagement rule: a zero-zero post invites the first like
          instead of an empty band (the average post gets 2-3 likes — design
          for that, not for 128). */}
      {likeCount === 0 && commentCount === 0 && (
        <div className="px-4 py-1.5 text-xs text-gray-400">Be the first to like this</div>
      )}

      {/* Action buttons */}
      <div className="flex items-center border-t border-gray-100">
        <button
          type="button"
          onClick={handleLike}
          disabled={!user || isLiking}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            hasLiked
              ? 'text-hockia-primary'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          } disabled:opacity-50`}
        >
          <Heart
            className={`w-4.5 h-4.5 ${hasLiked ? 'fill-hockia-primary' : ''}`}
          />
          <span>Like</span>
        </button>

        <button
          type="button"
          onClick={onToggleComments}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors ${
            showComments
              ? 'text-hockia-primary'
              : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}
        >
          <MessageCircle className="w-4.5 h-4.5" />
          <span>Comment</span>
        </button>

        <button
          type="button"
          onClick={() => setShowShareSheet(true)}
          className="flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Share2 className="w-4.5 h-4.5" />
          <span>Share</span>
        </button>
      </div>

      {/* Share sheet */}
      <SharePostSheet
        isOpen={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        postId={postId}
        authorId={authorId}
        authorName={authorName}
        authorAvatar={authorAvatar}
        authorRole={authorRole}
        content={content}
        thumbnailUrl={thumbnailUrl}
      />
    </div>
  )
}
