import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, Loader2 } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { ReportSheet } from '@/components/safety/ReportSheet'
import { Avatar } from '@/components'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { useBlockedUsers } from '@/hooks/useBlockedUsers'
import { formatActivityAge } from '@/lib/inboxTime'
import { profilePathForRole } from '@/lib/feedPaths'
import { initialsOf } from '@/lib/communityCard'
import { createComment, deleteComment, fetchComments, setCommentsEnabled, type FeedComment } from '@/lib/homeEngagement'
import { cn } from '@/lib/utils'
import type { CommentsRequest } from './homeV1Context'

const MAX = 500
const LONG_PRESS_MS = 450

/**
 * Comments (Figma H9 71:365 / H17 88:3991): a sheet, newest last, Reply,
 * the composer pinned at the bottom. Long-press (or right-click) a comment:
 * Reply · Report comment · Delete comment (yours, or any on your post) ·
 * Turn off comments for this post (the post's author). Turned off = the
 * composer goes, existing comments stay readable. Hidden and blocked members'
 * comments never show (server + the local block list).
 */
export function CommentsSheet({ request, onClose, onCount, onEnabled }: {
  request: CommentsRequest
  onClose: () => void
  onCount: (count: number) => void
  onEnabled: (enabled: boolean) => void
}) {
  const viewer = useAuthStore((s) => s.profile)
  const addToast = useToastStore((s) => s.addToast)
  const { blockedIds } = useBlockedUsers()
  const [comments, setComments] = useState<FeedComment[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [enabled, setEnabled] = useState(request.enabled)
  const [actionsFor, setActionsFor] = useState<FeedComment | null>(null)
  const [reporting, setReporting] = useState<FeedComment | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const pressTimer = useRef<number | null>(null)
  const isOwner = Boolean(viewer && request.ownerId === viewer.id)
  const commentSubject = request.target.type === 'post' ? 'comment' : 'feed_item_comment'

  useEffect(() => {
    let cancelled = false
    fetchComments(request.target)
      .then((r) => { if (!cancelled) setComments(r.comments) })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [request.target])

  const visible = useMemo(
    // Oldest first, newest last (H9).
    () => (comments ?? []).filter((c) => !blockedIds.has(c.author_id)).sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [comments, blockedIds],
  )

  useEffect(() => {
    if (comments) listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [comments])

  const send = async () => {
    const body = text.trim()
    if (!body || sending || !viewer) return
    setSending(true)
    const res = await createComment(request.target, body)
    setSending(false)
    if (!res.success) { addToast(res.error ?? 'Could not post your comment', 'error'); return }
    const mine: FeedComment = {
      id: res.comment_id ?? `local-${Date.now()}`,
      post_id: request.target.id,
      target_id: request.target.id,
      author_id: viewer.id,
      author_name: viewer.full_name,
      author_avatar: viewer.avatar_url,
      author_role: viewer.role,
      content: body,
      created_at: new Date().toISOString(),
    }
    setComments((prev) => [...(prev ?? []), mine])
    setText('')
    onCount((comments?.length ?? 0) + 1)
  }

  const remove = async (c: FeedComment) => {
    setActionsFor(null)
    const res = await deleteComment(request.target, c.id)
    if (!res.success) { addToast(res.error ?? 'Could not delete the comment', 'error'); return }
    setComments((prev) => (prev ?? []).filter((x) => x.id !== c.id))
    onCount(Math.max(0, (comments?.length ?? 1) - 1))
  }

  const toggleEnabled = async () => {
    setActionsFor(null)
    const next = !enabled
    const res = await setCommentsEnabled(request.target, next)
    if (!res.success) { addToast(res.error ?? 'Could not change comments', 'error'); return }
    setEnabled(next)
    onEnabled(next)
    addToast(next ? 'Comments turned on' : 'Comments turned off', 'success')
  }

  const reply = (c: FeedComment) => {
    setActionsFor(null)
    const first = (c.author_name ?? '').trim().split(/\s+/)[0]
    setText((t) => (first ? `@${first} ${t}` : t))
    inputRef.current?.focus()
  }

  const startPress = (c: FeedComment) => {
    pressTimer.current = window.setTimeout(() => setActionsFor(c), LONG_PRESS_MS)
  }
  const endPress = () => {
    if (pressTimer.current) window.clearTimeout(pressTimer.current)
    pressTimer.current = null
  }

  const total = comments ? visible.length : request.count

  return (
    <>
      <BottomSheet open onClose={onClose} ariaLabel="Comments" className="h-[88dvh]">
        <div className="flex min-h-0 flex-1 flex-col">
          <h2 className="px-4 pb-2 pt-1 text-body font-semibold tabular-nums text-ink-1">
            {total === 1 ? '1 comment' : `${total} comments`}
          </h2>
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-3">
            {comments === null && !failed && (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-ink-4" aria-label="Loading comments" /></div>
            )}
            {failed && <p className="py-10 text-center text-secondary text-ink-2">Couldn’t load comments.</p>}
            {comments !== null && visible.length === 0 && (
              <p className="py-10 text-center text-secondary text-ink-2">{enabled ? 'No comments yet. Say something nice.' : 'No comments.'}</p>
            )}
            <ul className="flex flex-col gap-5">
              {visible.map((c) => {
                const path = profilePathForRole(c.author_role as never, c.author_id)
                return (
                  <li
                    key={c.id}
                    className={cn('flex gap-2.5 rounded-2xl transition-colors', actionsFor?.id === c.id && 'bg-surface-muted')}
                    onTouchStart={() => startPress(c)}
                    onTouchEnd={endPress}
                    onTouchMove={endPress}
                    onContextMenu={(e) => { e.preventDefault(); setActionsFor(c) }}
                  >
                    <Link to={path ?? '#'} className="shrink-0" aria-label={`${c.author_name ?? 'Member'} — view profile`}>
                      <Avatar src={c.author_avatar} initials={initialsOf(c.author_name)} size="sm" />
                    </Link>
                    <div className="min-w-0 flex-1 select-none">
                      <p className="text-secondary text-ink-1">
                        <span className="font-semibold">{c.author_name ?? 'Member'}</span>
                        <span className="ml-1.5 text-ink-3">{formatActivityAge(c.created_at)}</span>
                      </p>
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-5 text-ink-1">{c.content}</p>
                      <button type="button" onClick={() => (enabled ? reply(c) : setActionsFor(c))} className="-ml-1 min-h-[32px] px-1 text-caption font-semibold text-ink-3">
                        {enabled ? 'Reply' : 'More'}
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {enabled ? (
            <div className="flex items-end gap-2.5 border-t border-line px-4 pb-2 pt-2.5">
              <Avatar src={viewer?.avatar_url} initials={initialsOf(viewer?.full_name)} size="sm" className="mb-1.5 shrink-0" />
              <div className="flex min-h-[44px] flex-1 items-end rounded-[22px] bg-surface-muted pl-4 pr-1">
                <textarea
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value.slice(0, MAX))}
                  rows={1}
                  placeholder="Add a comment…"
                  aria-label="Add a comment"
                  className="max-h-28 min-h-[44px] flex-1 resize-none bg-transparent py-3 text-[15px] leading-5 text-ink-1 placeholder:text-ink-4 focus:outline-none"
                />
                {text.trim() && (
                  <button type="button" onClick={() => void send()} disabled={sending} aria-label="Post comment" className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-hockia-primary text-white disabled:opacity-50">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <p className="text-secondary text-ink-2">Comments are turned off for this post.</p>
              {isOwner && <button type="button" onClick={() => void toggleEnabled()} className="min-h-[44px] text-secondary font-semibold text-hockia-primary">Turn on</button>}
            </div>
          )}
        </div>
      </BottomSheet>

      <BottomSheet open={Boolean(actionsFor)} onClose={() => setActionsFor(null)} ariaLabel="Comment actions">
        {actionsFor && (
          <div className="px-5 pb-4 pt-1">
            <div className="divide-y divide-line overflow-hidden rounded-card bg-surface-grouped">
              {enabled && <ActionRow label="Reply" onClick={() => reply(actionsFor)} />}
              {viewer && actionsFor.author_id !== viewer.id && (
                <ActionRow label="Report comment" destructive onClick={() => { setReporting(actionsFor); setActionsFor(null) }} />
              )}
              {viewer && (actionsFor.author_id === viewer.id || isOwner) && (
                <ActionRow label="Delete comment" destructive onClick={() => void remove(actionsFor)} />
              )}
              {isOwner && <ActionRow label={enabled ? 'Turn off comments for this post' : 'Turn on comments for this post'} onClick={() => void toggleEnabled()} />}
            </div>
            <button type="button" onClick={() => setActionsFor(null)} className="mt-2.5 flex h-11 w-full items-center justify-center text-body text-ink-2">Cancel</button>
          </div>
        )}
      </BottomSheet>

      {reporting && (
        <ReportSheet open onClose={() => setReporting(null)} targetId={reporting.author_id} subject={commentSubject} contentId={reporting.id} />
      )}
    </>
  )
}

function ActionRow({ label, onClick, destructive = false }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex h-[52px] w-full items-center px-4 text-left text-body', destructive ? 'text-hockia-danger' : 'text-ink-1')}>
      {label}
    </button>
  )
}
