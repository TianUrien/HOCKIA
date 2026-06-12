import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format } from 'date-fns'
import { AlertCircle, Ban, Check, CheckCheck, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { ChatMessage, MessageDeliveryStatus } from '@/types/chat'
import { cn } from '@/lib/utils'
import ConfirmDialog from '@/components/ConfirmDialog'
import { SharedPostCard } from './SharedPostCard'

interface MessageBubbleProps {
  message: ChatMessage
  isMine: boolean
  status: MessageDeliveryStatus | undefined
  isGroupedWithPrevious: boolean
  showDayDivider: boolean
  showTimestamp: boolean
  isUnreadMarker: boolean
  onRetry: (id: string) => void
  onDeleteFailed: (id: string) => void
  /** Persist an edit. Resolves true on success; the bubble exits edit mode then. */
  onEditSave: (id: string, content: string) => Promise<boolean>
  /** Soft-delete the message. Resolves true on success. */
  onDelete: (id: string) => Promise<boolean>
}

const MAX_LENGTH = 1000

export function MessageBubble({
  message,
  isMine,
  status,
  isGroupedWithPrevious,
  showDayDivider,
  showTimestamp,
  isUnreadMarker,
  onRetry,
  onDeleteFailed,
  onEditSave,
  onDelete
}: MessageBubbleProps) {
  const timestampLabel = format(new Date(message.sent_at), 'h:mm a')

  const isDeleted = Boolean(message.deleted_at)
  const isSharedPost = message.metadata?.type === 'shared_post'
  const isPersisted = status !== 'sending' && status !== 'failed' && !message.id.startsWith('optimistic-')
  // Own, delivered, not-yet-deleted messages can be managed. Shared-post cards
  // can be deleted but not edited (they aren't free text).
  const canManage = isMine && isPersisted && !isDeleted
  const canEdit = canManage && !isSharedPost

  const [showMenu, setShowMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The options menu is rendered in a portal with fixed positioning: the chat
  // bubble wrapper uses `contain: paint`, which would clip an in-flow absolute
  // popover. Position is computed from the trigger's rect, opening upward when
  // there's room (recent messages sit near the bottom / composer).
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  const openMenu = () => {
    const el = triggerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const right = Math.max(8, window.innerWidth - rect.right)
    const MENU_EST_HEIGHT = 96
    if (rect.top > MENU_EST_HEIGHT + 12) {
      setMenuPos({ bottom: window.innerHeight - rect.top + 6, right })
    } else {
      setMenuPos({ top: rect.bottom + 6, right })
    }
    setShowMenu(true)
  }

  // A fixed-position menu would drift from its trigger on scroll/resize — just
  // close it instead.
  useEffect(() => {
    if (!showMenu) return
    const close = () => setShowMenu(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [showMenu])

  // Focus + size the editor when entering edit mode; caret to the end.
  useLayoutEffect(() => {
    if (!isEditing) return
    const el = textareaRef.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [isEditing])

  // If the message changes underneath an open editor (e.g. realtime), keep the
  // draft in sync only while not actively editing.
  useEffect(() => {
    if (!isEditing) setDraft(message.content)
  }, [message.content, isEditing])

  const startEdit = () => {
    setShowMenu(false)
    setDraft(message.content)
    setIsEditing(true)
  }

  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(message.content)
  }

  const saveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || saving) return
    if (trimmed === message.content) {
      setIsEditing(false)
      return
    }
    setSaving(true)
    const ok = await onEditSave(message.id, trimmed)
    setSaving(false)
    if (ok) setIsEditing(false)
  }

  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  const trimmedDraft = draft.trim()
  const canSubmitEdit = trimmedDraft.length > 0 && trimmedDraft.length <= MAX_LENGTH && !saving

  return (
    <div className={cn('space-y-1', isGroupedWithPrevious ? '' : 'mt-2')}>
      {showDayDivider && (
        <div className="flex justify-center py-4">
          <span className="inline-flex items-center rounded-full bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 shadow-sm ring-1 ring-gray-200">
            {format(new Date(message.sent_at), 'EEEE, MMM d')}
          </span>
        </div>
      )}
      {showTimestamp && !showDayDivider && (
        <div className="text-center text-[11px] font-medium text-gray-400 py-2">
          {format(new Date(message.sent_at), 'MMM d, h:mm a')}
        </div>
      )}
      {isUnreadMarker && (
        <div className="flex items-center gap-3 py-3">
          <div className="flex-1 h-px bg-purple-200" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-purple-500">New</span>
          <div className="flex-1 h-px bg-purple-200" />
        </div>
      )}

      {isDeleted ? (
        <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
          <div
            className="inline-flex max-w-[75%] items-center gap-1.5 rounded-2xl px-3.5 py-2 text-[13px] italic text-gray-400 ring-1 ring-gray-200 sm:max-w-[65%]"
            data-testid="message-deleted"
          >
            <Ban className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Message deleted
          </div>
        </div>
      ) : isEditing ? (
        <div className="flex justify-end">
          <div className="w-full max-w-[85%] sm:max-w-[70%]" data-testid="message-edit-editor">
            <textarea
              ref={textareaRef}
              value={draft}
              maxLength={MAX_LENGTH}
              onChange={e => {
                setDraft(e.target.value)
                const el = e.target
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
              onKeyDown={handleEditorKeyDown}
              rows={1}
              className="w-full resize-none rounded-2xl border border-purple-300 bg-white px-3.5 py-2 text-[15px] leading-relaxed text-gray-900 shadow-sm outline-none focus:border-purple-400 focus:ring-2 focus:ring-purple-200"
              aria-label="Edit message"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-full px-3 py-1 text-[13px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!canSubmitEdit}
                data-testid="message-edit-save"
                className="inline-flex items-center gap-1.5 rounded-full bg-purple-600 px-3.5 py-1 text-[13px] font-semibold text-white transition hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={cn('group/msg flex items-center gap-1', isMine ? 'justify-end' : 'justify-start')}>
          {canManage && (
            <button
              ref={triggerRef}
              type="button"
              aria-label="Message options"
              data-testid="message-options-trigger"
              onClick={() => (showMenu ? setShowMenu(false) : openMenu())}
              className={cn(
                'flex-shrink-0 rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-300',
                // Always reachable on touch; hover-revealed on desktop to keep the thread clean.
                'opacity-60 md:opacity-0 md:group-hover/msg:opacity-100 focus-visible:opacity-100',
                showMenu && 'opacity-100'
              )}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {showMenu && menuPos && createPortal(
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setShowMenu(false)} />
              <div
                className="fixed z-[61] w-36 overflow-hidden rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }}
              >
                {canEdit && (
                  <button
                    type="button"
                    onClick={startEdit}
                    data-testid="message-edit-action"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    Edit
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setShowMenu(false)
                    setShowDeleteConfirm(true)
                  }}
                  data-testid="message-delete-action"
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </>,
            document.body
          )}

          <div
            className={cn(
              'max-w-[75%] rounded-2xl px-3.5 py-2 text-[15px] leading-relaxed sm:max-w-[65%]',
              isMine
                ? 'bg-gradient-to-br from-purple-500 to-purple-600 text-white'
                : 'bg-white text-gray-900 ring-1 ring-gray-200',
              isMine
                ? isGroupedWithPrevious ? 'rounded-tr-md' : ''
                : isGroupedWithPrevious ? 'rounded-tl-md' : ''
            )}
          >
            {isSharedPost && message.metadata?.type === 'shared_post' ? (
              <SharedPostCard
                postId={message.metadata.post_id}
                authorName={message.metadata.author_name}
                authorAvatar={message.metadata.author_avatar}
                authorRole={message.metadata.author_role}
                contentPreview={message.metadata.content_preview}
                thumbnailUrl={message.metadata.thumbnail_url}
                isMine={isMine}
              />
            ) : (
              <p className="whitespace-pre-wrap break-words" style={{ overflowWrap: 'anywhere' }}>{message.content}</p>
            )}
            <div className={cn(
              'mt-1 flex items-center gap-1.5 text-[11px]',
              isMine ? 'justify-end' : ''
            )}>
              {message.edited_at && (
                <span className={isMine ? 'text-white/60' : 'text-gray-400'}>edited</span>
              )}
              <span className={isMine ? 'text-white/70' : 'text-gray-400'}>{timestampLabel}</span>
              {isMine && (
                status === 'failed' ? (
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onRetry(message.id)}
                      className="rounded-full p-0.5 text-white/80 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
                      aria-label="Retry sending message"
                    >
                      <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteFailed(message.id)}
                      className="rounded-full p-0.5 text-white/80 transition hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/50"
                      aria-label="Delete failed message"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-0.5 text-white/70">
                    {status === 'sending' ? (
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    ) : message.read_at ? (
                      <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </span>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Portaled to body: the bubble wrapper's `contain: layout paint` would
          otherwise become the containing block for the dialog's fixed overlay
          and clip it inside the bubble. */}
      {createPortal(
        <ConfirmDialog
          isOpen={showDeleteConfirm}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            const ok = await onDelete(message.id)
            // Throw on failure so ConfirmDialog stays open; the hook already
            // surfaced a toast. Success closes the dialog.
            if (!ok) throw new Error('Failed to delete message')
          }}
          title="Delete this message?"
          message="This will remove the message from the conversation. This can't be undone."
          confirmLabel="Delete"
          variant="danger"
          testId="message-delete-confirm"
        />,
        document.body
      )}
    </div>
  )
}
