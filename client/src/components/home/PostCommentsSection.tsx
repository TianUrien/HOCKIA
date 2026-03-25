import { useState, useEffect, useCallback, useRef } from 'react'
import { Flag, Loader2, Send, Trash2 } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { usePostInteractions } from '@/hooks/usePostInteractions'
import { Avatar } from '@/components'
import ReportUserModal from '@/components/ReportUserModal'
import { getTimeAgo } from '@/lib/utils'
import { checkContent } from '@/lib/contentFilter'
import type { PostComment } from '@/types/homeFeed'

interface PostCommentsSectionProps {
  postId: string
  commentCount: number
  onCommentCountChange: (newCount: number) => void
}

const INITIAL_LIMIT = 3

export function PostCommentsSection({
  postId,
  commentCount,
  onCommentCountChange,
}: PostCommentsSectionProps) {
  const { user, profile } = useAuthStore()
  const { fetchComments, createComment, deleteComment } = usePostInteractions()

  const [comments, setComments] = useState<PostComment[]>([])
  const [total, setTotal] = useState(commentCount)
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [reportingComment, setReportingComment] = useState<{ id: string; authorId: string; authorName: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load initial comments
  useEffect(() => {
    let cancelled = false

    async function load() {
      setIsLoading(true)
      const result = await fetchComments(postId, INITIAL_LIMIT, 0)
      if (!cancelled) {
        setComments(result.comments)
        setTotal(result.total)
        setIsLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [postId, fetchComments])

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100)
  }, [])

  const handleLoadAll = useCallback(async () => {
    setIsLoading(true)
    const result = await fetchComments(postId, 100, 0)
    setComments(result.comments)
    setTotal(result.total)
    setShowAll(true)
    setIsLoading(false)
  }, [postId, fetchComments])

  const handleSubmit = useCallback(async () => {
    const trimmed = newComment.trim()
    if (!trimmed || !user || isSubmitting) return

    const filterResult = checkContent(trimmed)
    if (!filterResult.allowed) {
      alert(filterResult.reason || 'Content violates community guidelines.')
      return
    }

    setIsSubmitting(true)
    const result = await createComment(postId, trimmed)

    if (result.success && result.comment_id && profile) {
      // Optimistic add
      const newCommentObj: PostComment = {
        id: result.comment_id,
        post_id: postId,
        author_id: profile.id,
        author_name: profile.full_name,
        author_avatar: profile.avatar_url,
        author_role: profile.role,
        content: trimmed,
        created_at: new Date().toISOString(),
      }
      setComments(prev => [...prev, newCommentObj])
      setTotal(prev => prev + 1)
      onCommentCountChange(total + 1)
      setNewComment('')
    }

    setIsSubmitting(false)
  }, [newComment, user, isSubmitting, postId, profile, createComment, onCommentCountChange, total])

  const handleDelete = useCallback(async (commentId: string) => {
    const result = await deleteComment(commentId)
    if (result.success) {
      setComments(prev => prev.filter(c => c.id !== commentId))
      setTotal(prev => prev - 1)
      onCommentCountChange(Math.max(0, total - 1))
    }
  }, [deleteComment, onCommentCountChange, total])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  return (
    <div className="border-t border-gray-100 px-4 py-3 space-y-3">
      {/* Loading state */}
      {isLoading && comments.length === 0 && (
        <div className="flex justify-center py-2">
          <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
        </div>
      )}

      {/* Comments list */}
      {comments.map(comment => (
        <div key={comment.id} className="flex gap-2.5">
          <Avatar
            src={comment.author_avatar}
            initials={comment.author_name?.slice(0, 2) || '?'}
            size="sm"
            className="flex-shrink-0 mt-0.5"
          />
          <div className="flex-1 min-w-0">
            <div className="bg-gray-50 rounded-lg px-3 py-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-gray-900">
                  {comment.author_name || 'Unknown'}
                </span>
                <span className="text-xs text-gray-400">
                  {getTimeAgo(comment.created_at, true)}
                </span>
              </div>
              <p className="text-sm text-gray-700 mt-0.5">{comment.content}</p>
            </div>
            {/* Delete button for own comments, Report for others */}
            {user && comment.author_id === user.id ? (
              <button
                type="button"
                onClick={() => handleDelete(comment.id)}
                className="mt-1 ml-1 text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            ) : user ? (
              <button
                type="button"
                onClick={() => setReportingComment({
                  id: comment.id,
                  authorId: comment.author_id,
                  authorName: comment.author_name || 'Unknown',
                })}
                className="mt-1 ml-1 text-xs text-gray-400 hover:text-red-500 flex items-center gap-1 transition-colors"
              >
                <Flag className="w-3 h-3" />
                Report
              </button>
            ) : null}
          </div>
        </div>
      ))}

      {/* Load all comments */}
      {!showAll && total > INITIAL_LIMIT && comments.length < total && (
        <button
          type="button"
          onClick={handleLoadAll}
          disabled={isLoading}
          className="text-sm text-gray-500 hover:text-gray-700 font-medium"
        >
          {isLoading ? 'Loading...' : `View all ${total} comments`}
        </button>
      )}

      {/* Comment input */}
      {user && (
        <div className="flex items-center gap-2.5 pt-1">
          <Avatar
            src={profile?.avatar_url}
            initials={profile?.full_name?.slice(0, 2) || '?'}
            size="sm"
            className="flex-shrink-0"
          />
          <div className="flex-1 flex items-center gap-2 bg-gray-50 rounded-full px-3 py-1.5">
            <input
              ref={inputRef}
              type="text"
              value={newComment}
              onChange={e => setNewComment(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write a comment..."
              maxLength={500}
              enterKeyHint="send"
              autoCapitalize="sentences"
              className="flex-1 bg-transparent text-sm text-gray-900 placeholder-gray-400 border-0 focus:outline-none focus:ring-0"
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!newComment.trim() || isSubmitting}
              className="p-1 text-gray-400 hover:text-[#8026FA] disabled:opacity-30 transition-colors"
            >
              {isSubmitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {reportingComment && (
        <ReportUserModal
          targetId={reportingComment.authorId}
          targetName={reportingComment.authorName}
          contentType="comment"
          contentId={reportingComment.id}
          onClose={() => setReportingComment(null)}
        />
      )}
    </div>
  )
}
