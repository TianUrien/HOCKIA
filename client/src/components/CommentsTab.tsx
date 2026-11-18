import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Flag, MessageSquare, MessageSquarePlus, ShieldAlert, UserCheck, Share2 } from 'lucide-react'
import * as Sentry from '@sentry/react'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import type { Database } from '@/lib/database.types'
import type { Profile } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import Avatar from './Avatar'
import RoleBadge from './RoleBadge'
import { cn, getInitials } from '@/lib/utils'
import ConfirmActionModal from './ConfirmActionModal'
import { reportSupabaseError } from '@/lib/sentryHelpers'
import { checkContent } from '@/lib/contentFilter'
import InfoTooltip from './InfoTooltip'
import ReportUserModal from './ReportUserModal'
import RequestFeedbackModal from './RequestFeedbackModal'
import { useProfileT } from '@/i18n/ns/profile'
import { getDateFnsLocale } from '@/i18n/format'

interface CommentsTabProps {
  profileId: string
  highlightedCommentIds?: Set<string>
  /** Profile role being viewed — drives tone of composer placeholder
   * and empty-state copy. Optional; defaults to generic wording. */
  profileRole?: Profile['role'] | null
  /** When true, force the visitor-mode UX even if the auth'd user owns
   * this profile. Used by the "view as visitor" public-profile preview
   * so the owner sees what other members actually see — the auth'd
   * user's own profile id matches but they want the visitor experience.
   * Defaults to false (auto-detect ownership). */
  forceVisitorMode?: boolean
}

type ProfileT = ReturnType<typeof useProfileT>

/** Role-aware composer placeholder — keeps tone appropriate to the
 * profile being commented on. */
function composerPlaceholderFor(t: ProfileT, role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') return t('commentsTab.placeholder.umpire')
  if (role === 'coach') return t('commentsTab.placeholder.coach')
  if (role === 'club') return t('commentsTab.placeholder.club')
  return t('commentsTab.placeholder.default')
}

/** Role-aware empty-state body copy.
 *  When the viewer is the owner the "be the first to share" framing is
 *  wrong — owners can't comment on their own profile (the alert above this
 *  state explicitly tells them so). Owner-mode copy nudges them to ask
 *  someone in their network instead. */
function emptyStateCopyFor(
  t: ProfileT,
  role: Profile['role'] | null | undefined,
  isOwner: boolean,
): string {
  if (isOwner) return t('commentsTab.empty.owner')
  if (role === 'umpire') return t('commentsTab.empty.umpire')
  if (role === 'club') return t('commentsTab.empty.club')
  if (role === 'brand') return t('commentsTab.empty.brand')
  return t('commentsTab.empty.default')
}

/** Role-aware section header subtitle for the Comments tab. */
function commentsSubtitleFor(t: ProfileT, role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') {
    // Avoid the word "References" — that's the dedicated profile_references
    // system on its own UI surface. Calling comments "References" on umpire
    // profiles makes both surfaces ambiguous.
    return t('commentsTab.subtitle.umpire')
  }
  if (role === 'club') return t('commentsTab.subtitle.club')
  if (role === 'brand') return t('commentsTab.subtitle.brand')
  return t('commentsTab.subtitle.default')
}

/** Role-aware copy shown on the owner's own Comments tab when they cannot
 * comment on themselves — guides them on whom to ask. */
function ownerInviteHintFor(t: ProfileT, role: Profile['role'] | null | undefined): string {
  if (role === 'umpire') return t('commentsTab.ownerHint.umpire')
  if (role === 'club') return t('commentsTab.ownerHint.club')
  if (role === 'brand') return t('commentsTab.ownerHint.brand')
  return t('commentsTab.ownerHint.default')
}

type CommentRating = Database['public']['Enums']['comment_rating']
type CommentRow = Database['public']['Tables']['profile_comments']['Row']

type CommentWithAuthor = CommentRow & {
  author: Pick<Profile, 'id' | 'full_name' | 'avatar_url' | 'role' | 'username'> | null
}

const MAX_LENGTH = 1000
const MIN_LENGTH = 10

const ratingOptions: { value: CommentRating; key: 'positive' | 'neutral' | 'negative'; badgeClass: string }[] = [
  { value: 'positive', key: 'positive', badgeClass: 'bg-green-100 text-green-700 border-green-200' },
  { value: 'neutral', key: 'neutral', badgeClass: 'bg-gray-100 text-gray-700 border-gray-200' },
  { value: 'negative', key: 'negative', badgeClass: 'bg-red-100 text-red-700 border-red-200' },
]

function CommentsHeaderInfo() {
  const t = useProfileT()
  return (
    <div className="space-y-2 text-sm text-gray-100">
      <p className="font-semibold text-white">{t('commentsTab.headerInfo.title')}</p>
      <ul className="list-disc space-y-1 pl-4 text-gray-200">
        <li>{t('commentsTab.headerInfo.visible')}</li>
        <li>{t('commentsTab.headerInfo.language')}</li>
        <li>{t('commentsTab.headerInfo.rating')}</li>
      </ul>
    </div>
  )
}

function CommentComposerInfo() {
  const t = useProfileT()
  return (
    <div className="space-y-2 text-sm text-gray-100">
      <p className="font-semibold text-white">{t('commentsTab.composerInfo.title')}</p>
      <ul className="list-disc space-y-1 pl-4 text-gray-200">
        <li>{t('commentsTab.composerInfo.constructive')}</li>
        <li>{t('commentsTab.composerInfo.specific')}</li>
        <li>{t('commentsTab.composerInfo.minimum')}</li>
      </ul>
    </div>
  )
}

export default function CommentsTab({ profileId, highlightedCommentIds, profileRole, forceVisitorMode = false }: CommentsTabProps) {
  const t = useProfileT()
  const { profile: authProfile, user } = useAuthStore()
  const { addToast } = useToastStore()

  const [comments, setComments] = useState<CommentWithAuthor[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [composerContent, setComposerContent] = useState('')
  const [composerRating, setComposerRating] = useState<CommentRating | ''>('')
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [editRating, setEditRating] = useState<CommentRating | ''>('')
  const [editing, setEditing] = useState(false)
  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [friendIds, setFriendIds] = useState<Set<string>>(new Set())
  const [reportingComment, setReportingComment] = useState<{ id: string; authorId: string; authorName: string } | null>(null)
  const [showRequestFeedback, setShowRequestFeedback] = useState(false)

  // Auto-detect ownership unless the parent forces visitor mode (used by
  // the "view as visitor" public-profile preview so the owner can see
  // exactly what other members see — auth id matches profileId but the
  // owner-only CTAs must NOT appear).
  const isOwner = !forceVisitorMode && authProfile?.id === profileId

  // Compute the owner's public profile URL for the "Ask for feedback" share link.
  const ownerProfileUrl = useMemo(() => {
    if (!isOwner || !authProfile) return ''
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const slug = authProfile.username || `id/${authProfile.id}`
    const basePath =
      authProfile.role === 'club'
        ? '/clubs'
        : authProfile.role === 'umpire'
          ? '/umpires'
          : '/players'
    return `${origin}${basePath}/${slug}`
  }, [isOwner, authProfile])

  const canComment = Boolean(user && authProfile && authProfile.id !== profileId)

  const fetchComments = useCallback(async () => {
    setLoading(true)

    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'comments.fetch_visible',
      data: { profileId },
      level: 'info'
    })
    const { data, error } = await supabase
      .from('profile_comments')
      .select(`
        id,
        profile_id,
        author_profile_id,
        content,
        rating,
        status,
        created_at,
        updated_at,
        author:profiles!profile_comments_author_profile_id_fkey (
          id,
          full_name,
          avatar_url,
          role,
          username
        )
      `)
      .eq('profile_id', profileId)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })

    if (error) {
      logger.error('Error loading comments', error)
      reportSupabaseError('comments.fetch_visible', error, { profileId }, {
        feature: 'comments',
        operation: 'fetch_comments'
      })
      addToast(t('commentsTab.toasts.loadFailed'), 'error')
    } else {
      setComments((data as CommentWithAuthor[]) ?? [])
    }

    setLoading(false)
  }, [addToast, profileId, t])

  const fetchFriendIds = useCallback(async () => {
    Sentry.addBreadcrumb({
      category: 'supabase',
      message: 'comments.fetch_friend_edges',
      data: { profileId },
      level: 'info'
    })
    const { data, error } = await supabase
      .from('profile_friend_edges')
      .select('friend_id')
      .eq('profile_id', profileId)
      .eq('status', 'accepted')

    if (error) {
      logger.error('Error loading friend relationships', error)
      reportSupabaseError('comments.fetch_friend_edges', error, { profileId }, {
        feature: 'friends',
        operation: 'fetch_friend_edges'
      })
      return
    }

    const ids = new Set((data ?? []).map((row) => row.friend_id).filter((id): id is string => Boolean(id)))
    setFriendIds(ids)
  }, [profileId])

  useEffect(() => {
    void fetchComments()
  }, [fetchComments])

  useEffect(() => {
    void fetchFriendIds()
  }, [fetchFriendIds])

  const existingComment = useMemo(() => {
    if (!authProfile) return null
    return comments.find((comment) => comment.author_profile_id === authProfile.id) ?? null
  }, [comments, authProfile])

  useEffect(() => {
    if (!existingComment) {
      setEditContent('')
      setEditRating('')
      setIsEditing(false)
      return
    }

    setEditContent(existingComment.content)
    setEditRating(existingComment.rating ?? '')
  }, [existingComment])

  const upsertComment = useCallback((next: CommentWithAuthor) => {
    setComments((prev) => {
      const others = prev.filter((comment) => comment.id !== next.id)
      return [next, ...others]
    })
  }, [])

  const handleCreateComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canComment || !authProfile) {
      addToast(t('commentsTab.toasts.signInRequired'), 'error')
      return
    }

    const trimmed = composerContent.trim()
    if (trimmed.length < MIN_LENGTH) {
      addToast(t('commentsTab.toasts.tooShort', { count: MIN_LENGTH }), 'error')
      return
    }

    if (!composerRating) {
      addToast(t('commentsTab.toasts.sentimentToPost'), 'error')
      return
    }

    const filterResult = checkContent(trimmed)
    if (!filterResult.allowed) {
      addToast(filterResult.reason || t('commentsTab.toasts.contentBlocked'), 'error')
      return
    }

    setCreating(true)
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.insert',
        data: { profileId, authorId: authProfile.id },
        level: 'info'
      })
      const { data, error } = await supabase
        .from('profile_comments')
        .insert({
          profile_id: profileId,
          author_profile_id: authProfile.id,
          content: trimmed,
          rating: composerRating,
          status: 'visible' as CommentRow['status'],
        })
        .select(`
          *,
          author:profiles!profile_comments_author_profile_id_fkey (
            id,
            full_name,
            avatar_url,
            role,
            username
          )
        `)
        .single()

      if (error) throw error
      upsertComment(data as CommentWithAuthor)
      setComposerContent('')
      setComposerRating('')
      addToast(t('commentsTab.toasts.posted'), 'success')
    } catch (error) {
      logger.error('Failed to post comment', error)
      reportSupabaseError('comments.insert', error, { profileId, authorId: authProfile?.id }, {
        feature: 'comments',
        operation: 'create_comment'
      })
      addToast(t('commentsTab.toasts.postFailed'), 'error')
    } finally {
      setCreating(false)
    }
  }

  const handleEditComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!existingComment) return

    const trimmed = editContent.trim()
    if (trimmed.length < MIN_LENGTH) {
      addToast(t('commentsTab.toasts.tooShort', { count: MIN_LENGTH }), 'error')
      return
    }

    if (!editRating) {
      addToast(t('commentsTab.toasts.sentimentToSave'), 'error')
      return
    }

    setEditing(true)
    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.update',
        data: { commentId: existingComment.id },
        level: 'info'
      })
      const { data, error } = await supabase
        .from('profile_comments')
        .update({ content: trimmed, rating: editRating, status: 'visible' as CommentRow['status'] })
        .eq('id', existingComment.id)
        .select(`
          *,
          author:profiles!profile_comments_author_profile_id_fkey (
            id,
            full_name,
            avatar_url,
            role,
            username
          )
        `)
        .single()

      if (error) throw error
      upsertComment(data as CommentWithAuthor)
      setIsEditing(false)
      addToast(t('commentsTab.toasts.updated'), 'success')
    } catch (error) {
      logger.error('Failed to update comment', error)
      reportSupabaseError('comments.update', error, { commentId: existingComment?.id }, {
        feature: 'comments',
        operation: 'update_comment'
      })
      addToast(t('commentsTab.toasts.updateFailed'), 'error')
    } finally {
      setEditing(false)
    }
  }

  const handleDeleteComment = async () => {
    if (!existingComment) return
    setDeleteLoading(true)

    try {
      Sentry.addBreadcrumb({
        category: 'supabase',
        message: 'comments.delete',
        data: { commentId: existingComment.id },
        level: 'warning'
      })
      const { error, data } = await supabase
        .from('profile_comments')
        .delete()
        .eq('id', existingComment.id)
        .select('id')
        .maybeSingle()

      if (error || !data) {
        throw error ?? new Error('Comment not found or already removed')
      }

      setComments((prev) => prev.filter((comment) => comment.id !== data.id))
      setDeleteModalOpen(false)
      addToast(t('commentsTab.toasts.deleted'), 'success')
    } catch (error) {
      logger.error('Failed to delete comment', error)
      reportSupabaseError('comments.delete', error, { commentId: existingComment?.id }, {
        feature: 'comments',
        operation: 'delete_comment'
      })
      addToast(t('commentsTab.toasts.deleteFailed'), 'error')
    } finally {
      setDeleteLoading(false)
    }
  }

  const otherComments = useMemo(() => {
    if (!existingComment) return comments
    return comments.filter((comment) => comment.id !== existingComment.id)
  }, [comments, existingComment])


  const renderRatingBadge = (value?: CommentRating | null) => {
    if (!value) return null
    const option = ratingOptions.find((entry) => entry.value === value)
    if (!option) return null
    return (
      <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize', option.badgeClass)}>
        {t(`commentsTab.rating.${option.key}.label`)}
      </span>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-gray-900">{t('commentsTab.title')}</h2>
              <InfoTooltip label={t('commentsTab.howItWorks')} alignment="start">
                <CommentsHeaderInfo />
              </InfoTooltip>
            </div>
            <p className="text-sm text-gray-600">{commentsSubtitleFor(t, profileRole)}</p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700">
            <MessageSquare className="h-4 w-4 text-hockia-primary" />
            {t('commentsTab.count', { count: comments.length })}
          </div>
        </div>
      </section>

      {canComment ? (
        !existingComment && (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-[#f5f3ff] text-hockia-primary rounded-full p-2">
                <MessageSquarePlus className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                  <span>{t('commentsTab.composer.title')}</span>
                  <InfoTooltip label={t('commentsTab.composer.tipsLabel')} alignment="start">
                    <CommentComposerInfo />
                  </InfoTooltip>
                </div>
                <p className="text-xs text-gray-500">{t('commentsTab.composer.subtitle')}</p>
              </div>
            </div>

            <form className="space-y-4" onSubmit={handleCreateComment}>
              <div>
                <label htmlFor="comment-content" className="sr-only">
                  {t('commentsTab.composer.fieldLabel')}
                </label>
                <textarea
                  id="comment-content"
                  value={composerContent}
                  onChange={(event) => setComposerContent(event.target.value.slice(0, MAX_LENGTH))}
                  rows={4}
                  placeholder={composerPlaceholderFor(t, profileRole)}
                  autoCapitalize="sentences"
                  spellCheck
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-hockia-primary focus-visible:ring-hockia-primary"
                />
                <div className="mt-1 flex justify-between text-xs text-gray-500">
                  <span>{t('commentsTab.minLength', { count: MIN_LENGTH })}</span>
                  <span>
                    {composerContent.trim().length}/{MAX_LENGTH}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {ratingOptions.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      'cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-sm transition hover:border-hockia-primary hover:shadow-md',
                      composerRating === option.value ? 'border-hockia-primary bg-[#f5f3ff] text-hockia-primary' : 'border-gray-200 bg-white text-gray-700'
                    )}
                  >
                    <input
                      type="radio"
                      name="comment-rating"
                      value={option.value}
                      className="sr-only"
                      checked={composerRating === option.value}
                      onChange={() => setComposerRating(option.value)}
                    />
                    <p className="font-semibold">{t(`commentsTab.rating.${option.key}.label`)}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{t(`commentsTab.rating.${option.key}.description`)}</p>
                  </label>
                ))}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-gray-500">
                  {t('commentsTab.composer.guidelines')}
                </p>
                <button
                  type="submit"
                  disabled={creating}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-purple-500/25 transition disabled:opacity-60"
                >
                  {creating ? t('commentsTab.composer.posting') : t('commentsTab.composer.post')}
                </button>
              </div>
            </form>
          </section>
        )
      ) : (
        <section className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-5 text-sm text-gray-600">
          {isOwner ? (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="h-5 w-5 text-gray-400 flex-shrink-0 mt-0.5" />
                <p>{ownerInviteHintFor(t, profileRole)}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowRequestFeedback(true)}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white px-4 py-2 text-sm font-semibold shadow-sm hover:opacity-90 transition-opacity whitespace-nowrap flex-shrink-0"
              >
                <Share2 className="h-4 w-4" />
                {t('commentsTab.askForFeedback')}
              </button>
            </div>
          ) : forceVisitorMode && authProfile?.id === profileId ? (
            // Owner is viewing their own public profile as a visitor —
            // suppress both the composer (can't comment on yourself) and
            // the owner-only "Ask for feedback" CTA. Neutral preview copy.
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-gray-400" />
              <p>{t('commentsTab.visitorPreview')}</p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <ShieldAlert className="h-5 w-5 text-gray-400" />
              <p>
                {t('commentsTab.signInToComment')}
              </p>
            </div>
          )}
        </section>
      )}

      {isOwner && (
        <RequestFeedbackModal
          isOpen={showRequestFeedback}
          onClose={() => setShowRequestFeedback(false)}
          profileUrl={ownerProfileUrl}
          ownerName={authProfile?.full_name}
          profileRole={profileRole}
        />
      )}

      <section className="space-y-4">
        {existingComment && (
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('commentsTab.yourComment')}</p>
            <article
              className={cn(
                'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm',
                highlightedCommentIds?.has(existingComment.id) && 'border-hockia-primary/30 shadow-lg shadow-hockia-soft ring-2 ring-hockia-primary/20'
              )}
            >
              <div className="flex items-start gap-3">
                <Avatar
                  src={existingComment.author?.avatar_url}
                  initials={getInitials(existingComment.author?.full_name ?? existingComment.author?.username ?? null)}
                  size="md"
                  alt={existingComment.author?.full_name || existingComment.author?.username || t('commentsTab.memberFallback')}
                  enablePreview
                  previewTitle={existingComment.author?.full_name || existingComment.author?.username || undefined}
                  role={existingComment.author?.role}
                />
                <div className="flex-1 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">
                          {existingComment.author?.full_name || existingComment.author?.username || t('commentsTab.memberFallback')}
                        </p>
                        <RoleBadge role={existingComment.author?.role} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                      <span>{formatDistanceToNow(new Date(existingComment.created_at), { addSuffix: true, locale: getDateFnsLocale() })}</span>
                      {renderRatingBadge(existingComment.rating)}
                    </div>
                  </div>

                  {isEditing ? (
                    <form className="space-y-4" onSubmit={handleEditComment}>
                      <textarea
                        aria-label={t('commentsTab.edit.fieldLabel')}
                        value={editContent}
                        onChange={(event) => setEditContent(event.target.value.slice(0, MAX_LENGTH))}
                        rows={4}
                        autoCapitalize="sentences"
                        spellCheck
                        className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-900 focus:border-hockia-primary focus-visible:ring-hockia-primary"
                      />
                      <div className="flex justify-between text-xs text-gray-500">
                        <span>{t('commentsTab.minLength', { count: MIN_LENGTH })}</span>
                        <span>{editContent.trim().length}/{MAX_LENGTH}</span>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-3">
                        {ratingOptions.map((option) => (
                          <label
                            key={option.value}
                            className={cn(
                              'cursor-pointer rounded-xl border px-4 py-3 text-sm shadow-sm transition hover:border-hockia-primary hover:shadow-md',
                              editRating === option.value ? 'border-hockia-primary bg-[#f5f3ff] text-hockia-primary' : 'border-gray-200 bg-white text-gray-700'
                            )}
                          >
                            <input
                              type="radio"
                              name="edit-comment-rating"
                              value={option.value}
                              className="sr-only"
                              checked={editRating === option.value}
                              onChange={() => setEditRating(option.value)}
                            />
                            <p className="font-semibold">{t(`commentsTab.rating.${option.key}.label`)}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{t(`commentsTab.rating.${option.key}.description`)}</p>
                          </label>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIsEditing(false)}
                          className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          {t('commentsTab.edit.cancel')}
                        </button>
                        <button
                          type="submit"
                          disabled={editing}
                          className="inline-flex items-center justify-center rounded-lg bg-gradient-to-r from-hockia-primary to-hockia-secondary px-4 py-2 text-sm font-semibold text-white shadow disabled:opacity-60"
                        >
                          {editing ? t('commentsTab.edit.saving') : t('commentsTab.edit.save')}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line break-words">
                        {existingComment.content}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setIsEditing(true)}
                          className="inline-flex items-center rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          {t('commentsTab.edit.edit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteModalOpen(true)}
                          className="inline-flex items-center rounded-lg border border-red-200 px-3 py-1.5 text-sm font-semibold text-red-600 hover:bg-red-50"
                        >
                          {t('commentsTab.edit.delete')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </article>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse rounded-2xl border border-gray-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-gray-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-1/3 rounded bg-gray-200" />
                    <div className="h-3 w-1/4 rounded bg-gray-100" />
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <div className="h-3 w-full rounded bg-gray-100" />
                  <div className="h-3 w-2/3 rounded bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-gray-200 bg-white p-10 text-center text-gray-500">
            <p className="text-base font-semibold text-gray-900 mb-2">{t('commentsTab.empty.title')}</p>
            <p className="text-sm">{emptyStateCopyFor(t, profileRole, isOwner)}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {existingComment && otherComments.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t('commentsTab.otherComments')}</p>
            )}
            {otherComments.map((comment) => {
              const authorId = comment.author_profile_id
              const isFriend = Boolean(authorId && friendIds.has(authorId))
              const isHighlighted = Boolean(highlightedCommentIds?.has(comment.id))

              return (
                <article
                  key={comment.id}
                  className={cn(
                    'rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-transform',
                    isHighlighted && 'border-hockia-primary/30 shadow-lg shadow-hockia-soft ring-2 ring-hockia-primary/20'
                  )}
                  data-highlighted={isHighlighted || undefined}
                >
                  <div className="flex items-start gap-3">
                    <Avatar
                      src={comment.author?.avatar_url}
                      initials={getInitials(comment.author?.full_name ?? comment.author?.username ?? null)}
                      size="md"
                      alt={comment.author?.full_name || comment.author?.username || t('commentsTab.formerMember')}
                      enablePreview
                      previewTitle={comment.author?.full_name || comment.author?.username || undefined}
                      role={comment.author?.role}
                    />
                    <div className="flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-gray-900">
                              {comment.author?.full_name || comment.author?.username || t('commentsTab.formerMember')}
                            </p>
                            <RoleBadge role={comment.author?.role} />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                          {isFriend && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">
                              <UserCheck className="h-3.5 w-3.5" />
                              {t('commentsTab.friend')}
                            </span>
                          )}
                          <span>
                            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: getDateFnsLocale() })}
                          </span>
                          {renderRatingBadge(comment.rating)}
                        </div>
                      </div>
                      <p className="mt-3 text-sm leading-relaxed text-gray-700 whitespace-pre-line break-words">
                        {comment.content}
                      </p>
                      {user && authorId !== user.id && (
                        <button
                          type="button"
                          onClick={() => setReportingComment({
                            id: comment.id,
                            authorId: authorId ?? '',
                            authorName: comment.author?.full_name || comment.author?.username || t('commentsTab.unknownAuthor'),
                          })}
                          className="mt-2 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors"
                        >
                          <Flag className="w-3 h-3" />
                          {t('commentsTab.report')}
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <ConfirmActionModal
        isOpen={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteComment}
        title={t('commentsTab.deleteModal.title')}
        description={t('commentsTab.deleteModal.body')}
        confirmLabel={t('commentsTab.deleteModal.confirm')}
        confirmTone="danger"
        confirmLoading={deleteLoading}
        loadingLabel={t('commentsTab.deleteModal.loading')}
      />

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
