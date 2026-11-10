import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { format, isToday, isYesterday } from 'date-fns'
import { clockTime, dayFirst } from '@/lib/dayFirst'

/** "Today" · "Yesterday" · "Monday, 12 Sep" — the day label above a group (day first, lib/dayFirst). */
function dayLabel(d: Date): string {
  if (isToday(d)) return 'Today'
  if (isYesterday(d)) return 'Yesterday'
  return `${format(d, 'EEEE')}, ${dayFirst(d)}`
}
import { AlertCircle, Ban, Check, CheckCheck, Copy, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { ChatMessage, MessageDeliveryStatus } from '@/types/chat'
import { cn } from '@/lib/utils'
import { firstNameOf } from '@/lib/invites'
import { recruitingEventLine } from '@/lib/signing'
import { SharedPostCard } from './SharedPostCard'
import { ActionSheet, type ActionSheetItem } from '@/components/ui/ActionSheet'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { useLongPress } from '@/hooks/useLongPress'
import { hapticLight } from '@/lib/haptics'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'

// D3.3 invite card: its own chunk, loaded only when a thread has one.
const InviteCard = lazy(() => import('./InviteCard'))
// D4.3 offer card and the D4.5 "Confirm signing" link: own chunks, loaded only when a thread has one.
const OfferCard = lazy(() => import('./OfferCard'))
const SigningPrompt = lazy(() => import('./SigningPrompt'))

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
  /** Soft-delete the message for everyone (author only). Resolves true on success. */
  onDelete: (id: string) => Promise<boolean>
  /** "Delete for me": hide the message for this member only. Resolves true on success. */
  onHideForMe?: (id: string) => Promise<boolean>
  /** Club v2 chat (DEV NOTE 355:919): no read receipts — sending / failed still show. */
  hideReceipts?: boolean
  /** The other side's name: a server-posted step line is reworded for its viewer (lib/signing recruitingEventLine). */
  otherParticipantName?: string | null
}

const MAX_LENGTH = 1000

type MenuPos = { top?: number; bottom?: number; right: number }

// Where the menu goes for the trigger's current rect. With `onlyIfVisible`,
// null when the trigger is gone or scrolled out of the visible thread.
function menuPosFor(el: HTMLElement | null, onlyIfVisible = false): MenuPos | null {
  if (!el || !el.isConnected) return null
  const rect = el.getBoundingClientRect()
  if (onlyIfVisible) {
    const scroller = el.closest('.chat-scroll-container')
    const area = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
    if (rect.bottom <= area.top || rect.top >= area.bottom) return null
  }
  // Right-anchor the menu to the trigger, but clamp so it can't overflow the
  // viewport's left edge. For the sender's OWN (right-aligned) bubble the ⋯
  // trigger sits at the LEFT of the bubble, so an unclamped right-anchor
  // pushed the w-36 (144px) menu off-screen left — clipping "Edit"/"Delete".
  const MENU_WIDTH = 144
  const right = Math.min(
    Math.max(8, window.innerWidth - rect.right),
    window.innerWidth - MENU_WIDTH - 8
  )
  const MENU_EST_HEIGHT = 96
  return rect.top > MENU_EST_HEIGHT + 12
    ? { bottom: window.innerHeight - rect.top + 6, right }
    : { top: rect.bottom + 6, right }
}

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
  onDelete,
  onHideForMe,
  hideReceipts = false,
  otherParticipantName = null
}: MessageBubbleProps) {
  // The one clock in the app (lib/dayFirst clockTime); the inbox list reads the same.
  const timestampLabel = clockTime(message.sent_at)

  const isDeleted = Boolean(message.deleted_at)
  const isSharedPost = message.metadata?.type === 'shared_post'
  // Recruiting cards (D3 invite, server-posted steps) are fixed records: never edited or deleted.
  const invite = message.metadata?.type === 'opportunity_invite' ? message.metadata : null
  const offer = message.metadata?.type === 'opportunity_offer' ? message.metadata : null
  const isRecruitingEvent = message.metadata?.type === 'application_event'
  // The line is written for the player; the club reads its own step in its own words.
  const eventLine = message.metadata?.type === 'application_event'
    ? recruitingEventLine(message.metadata.event, message.content, { isMine, otherFirstName: firstNameOf(otherParticipantName, '') })
    : message.content
  // The player's way from "<club> marked you as signed" to Confirm signing (D4.5).
  const signingPromptFor = message.metadata?.type === 'application_event' && message.metadata.event === 'signing_marked' && !isMine
    ? message.metadata.application_id ?? null
    : null
  const isPersisted = status !== 'sending' && status !== 'failed' && !message.id.startsWith('optimistic-')
  // Own, delivered, not-yet-deleted messages can be managed. Shared-post cards
  // can be deleted but not edited (they aren't free text).
  const canManage = isMine && isPersisted && !isDeleted && !invite && !offer && !isRecruitingEvent
  const canEdit = canManage && !isSharedPost
  // "Delete for me" (founder 2026-11-10): any delivered message, either side,
  // tombstones included. Recruiting cards and step lines stay: they are the
  // record of an application.
  const canHide = Boolean(onHideForMe) && isPersisted && !invite && !offer && !isRecruitingEvent
  const canCopy = !isDeleted && !invite && !offer && !isRecruitingEvent && !isSharedPost && message.content.trim().length > 0
  const canDelete = canManage || canHide
  const addToast = useToastStore(state => state.addToast)

  const [showMenu, setShowMenu] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [saving, setSaving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState<'everyone' | 'me' | null>(null)
  // Press and hold (touch) / right-click (desktop): the message menu as a sheet.
  const [showActions, setShowActions] = useState(false)
  const hasActions = canCopy || canEdit || canDelete
  const longPress = useLongPress(hasActions ? () => {
    void hapticLight()
    // With the keyboard up, let it close before the sheet lays out: opening
    // mid-animation left the sheet floating above a grey band on iOS
    // (simulator 2026-11-10). iOS dismisses the keyboard for menus too.
    const active = document.activeElement
    if (active instanceof HTMLElement && active.matches('input, textarea, [contenteditable="true"]')) {
      active.blur()
      window.setTimeout(() => setShowActions(true), 300)
    } else {
      setShowActions(true)
    }
  } : null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The options menu is rendered in a portal with fixed positioning: the chat
  // bubble wrapper uses `contain: paint`, which would clip an in-flow absolute
  // popover. Position is computed from the trigger's rect, opening upward when
  // there's room (recent messages sit near the bottom / composer).
  const [menuPos, setMenuPos] = useState<MenuPos | null>(null)

  const openMenu = () => {
    const pos = menuPosFor(triggerRef.current)
    if (!pos) return
    setMenuPos(pos)
    setShowMenu(true)
  }

  // The thread scrolls on its own while the menu is open: the auto-scroll to
  // the newest message after a send, and cards that finish loading and grow
  // (D3 invite cards). Closing on every scroll event made the menu vanish a
  // frame after it opened, so keep it pinned to its trigger instead and only
  // close once the trigger leaves the visible thread.
  useEffect(() => {
    if (!showMenu) return
    let frame = 0
    const follow = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const pos = menuPosFor(triggerRef.current, true)
        if (pos) setMenuPos(pos)
        else setShowMenu(false)
      })
    }
    window.addEventListener('scroll', follow, true)
    window.addEventListener('resize', follow)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', follow, true)
      window.removeEventListener('resize', follow)
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

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      addToast('Copied', 'success')
    } catch (error) {
      logger.error('Copy message failed:', error)
      addToast('Could not copy the message.', 'error')
    }
  }

  const runDelete = async (scope: 'everyone' | 'me') => {
    setDeleting(scope)
    const ok = scope === 'everyone' ? await onDelete(message.id) : await (onHideForMe?.(message.id) ?? Promise.resolve(false))
    setDeleting(null)
    // On failure the hook already toasted the reason; the sheet stays.
    if (ok) setShowDeleteConfirm(false)
  }

  const actionItems: ActionSheetItem[] = [
    ...(canCopy ? [{ key: 'copy', label: 'Copy', icon: <Copy className="h-5 w-5" />, onSelect: () => void copyMessage(), testId: 'message-copy-action' }] : []),
    ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: <Pencil className="h-5 w-5" />, onSelect: startEdit, testId: 'message-sheet-edit-action' }] : []),
    ...(canDelete ? [{ key: 'delete', label: 'Delete', icon: <Trash2 className="h-5 w-5" />, tone: 'danger' as const, onSelect: () => setShowDeleteConfirm(true), testId: 'message-sheet-delete-action' }] : []),
  ]

  const trimmedDraft = draft.trim()
  const canSubmitEdit = trimmedDraft.length > 0 && trimmedDraft.length <= MAX_LENGTH && !saving

  return (
    <div className={cn('space-y-1', isGroupedWithPrevious ? '' : 'mt-2')}>
      {showDayDivider && (
        <div className="py-3 text-caption font-semibold text-ink-3">
          {dayLabel(new Date(message.sent_at))}
        </div>
      )}
      {showTimestamp && !showDayDivider && (
        <div className="py-2 text-center text-caption text-ink-3">
          {timestampLabel}
        </div>
      )}
      {isUnreadMarker && (
        <div className="flex items-center gap-3 py-3">
          <div className="flex-1 h-px bg-hockia-soft" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-brand-primary">New</span>
          <div className="flex-1 h-px bg-hockia-soft" />
        </div>
      )}

      {isDeleted ? (
        <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
          <div
            {...longPress}
            className="inline-flex max-w-[75%] select-none items-center gap-1.5 rounded-card px-3.5 py-2 text-[13px] italic text-ink-3 ring-1 ring-line [-webkit-touch-callout:none] sm:max-w-[65%] lg:rounded-[18px]"
            data-testid="message-deleted"
          >
            <Ban className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            Message deleted
          </div>
        </div>
      ) : invite ? (
        <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
          <div className="w-full sm:max-w-[70%]">
            <Suspense fallback={<div className="h-[260px] w-full animate-pulse rounded-card bg-surface-grouped" />}>
              <InviteCard inviteId={invite.invite_id} opportunityId={invite.opportunity_id} isMine={isMine} fallbackText={message.content} />
            </Suspense>
          </div>
        </div>
      ) : offer ? (
        <div className={cn('flex', isMine ? 'justify-end' : 'justify-start')}>
          {/* data-offer-card: what "See the offer" scrolls to and rings — the card alone, never the day/time separator above it (QA round 7 re-check). */}
          <div className="w-full sm:max-w-[70%]" data-offer-card="true">
            <Suspense fallback={<div className="h-[230px] w-full animate-pulse rounded-card bg-surface-grouped" />}>
              <OfferCard offerId={offer.offer_id} isMine={isMine} fallbackText={message.content} />
            </Suspense>
          </div>
        </div>
      ) : isRecruitingEvent ? (
        // A recruiting step the server posts ("Facundo passed on Midfielder."): a quiet centred line, not a bubble.
        <div>
          <p className="mx-auto max-w-[85%] text-center text-caption leading-4 text-ink-3" data-testid="recruiting-event-line">{eventLine}</p>
          {signingPromptFor && (
            <Suspense fallback={null}>
              <SigningPrompt applicationId={signingPromptFor} />
            </Suspense>
          )}
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
              className="w-full resize-none rounded-2xl border border-line bg-white px-3.5 py-2 text-[15px] leading-relaxed text-ink-1 shadow-sm outline-none focus:border-brand-primary focus-visible:ring-2 focus-visible:ring-hockia-soft"
              aria-label="Edit message"
            />
            <div className="mt-1.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={cancelEdit}
                disabled={saving}
                className="rounded-full px-3 py-1 text-[13px] font-medium text-ink-2 transition hover:bg-surface-muted hover:text-ink-2 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEdit}
                disabled={!canSubmitEdit}
                data-testid="message-edit-save"
                className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary px-3.5 py-1 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className={cn('group/msg flex items-center gap-1', isMine ? 'justify-end' : 'justify-start')}>
          {canDelete && (
            <button
              ref={triggerRef}
              type="button"
              aria-label="Message options"
              data-testid="message-options-trigger"
              onClick={() => (showMenu ? setShowMenu(false) : openMenu())}
              className={cn(
                'flex-shrink-0 rounded-full p-1 text-ink-4 transition hover:bg-surface-muted hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                // Desktop only, hover-revealed to keep the thread clean. Phones
                // press and hold the bubble instead (founder 2026-11-10: the
                // always-on dots read as clutter).
                'hidden md:flex md:opacity-0 md:group-hover/msg:opacity-100 focus-visible:opacity-100',
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
                className="fixed z-[61] w-36 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-lg"
                style={{ top: menuPos.top, bottom: menuPos.bottom, right: menuPos.right }}
              >
                {canCopy && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowMenu(false)
                      void copyMessage()
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 hover:bg-surface-subtle"
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    Copy
                  </button>
                )}
                {canEdit && (
                  <button
                    type="button"
                    onClick={startEdit}
                    data-testid="message-edit-action"
                    className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink-2 hover:bg-surface-subtle"
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
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-status-danger hover:bg-accent-red-soft"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              </div>
            </>,
            document.body
          )}

          <div
            {...longPress}
            data-testid="message-bubble"
            data-mine={isMine ? 'true' : 'false'}
            data-status={status}
            className={cn(
              // Press and hold opens the menu: no iOS text-selection callout,
              // and a small press-in so the hold feels physical.
              hasActions && 'select-none transition-transform duration-200 [-webkit-touch-callout:none] active:scale-[0.97]',
              // Figma Chat 100:636: radius 16 on phones (decision 2026-10-02),
              // incoming grey left, outgoing SOLID brand right — no gradient.
              // Desktop keeps its 18.
              'max-w-[78%] rounded-card px-3.5 py-2.5 text-[15px] leading-5 sm:max-w-[65%] lg:rounded-[18px]',
              // Rebrand page 22: you = violet, everyone else = a white card.
            isMine ? 'bg-hockia-primary text-white' : 'bg-white text-ink-1 shadow-card',
              isMine
                ? isGroupedWithPrevious ? 'rounded-tr-[6px] lg:rounded-tr-[6px]' : ''
                : isGroupedWithPrevious ? 'rounded-tl-[6px] lg:rounded-tl-[6px]' : ''
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
                <span className={isMine ? 'text-white/60' : 'text-ink-4'}>edited</span>
              )}
              <span className={isMine ? 'text-white/70' : 'text-ink-4'}>{timestampLabel}</span>
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
                    ) : hideReceipts ? null : message.read_at ? (
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

      {/* Both sheets portal to body (BottomSheet): the bubble wrapper's
          `contain: layout paint` would otherwise clip a fixed overlay. */}
      <ActionSheet
        open={showActions}
        onClose={() => setShowActions(false)}
        subtitle={canCopy ? message.content : undefined}
        items={actionItems}
        testId="message-actions"
      />
      <BottomSheet
        open={showDeleteConfirm}
        onClose={() => { if (!deleting) setShowDeleteConfirm(false) }}
        ariaLabel="Delete this message?"
      >
        <div className="px-5 pb-2 pt-2 text-center" data-testid="message-delete-confirm">
          <h2 className="text-title text-ink-1">Delete this message?</h2>
          <p className="mt-2 text-row leading-[21px] text-ink-2">
            {canManage && canHide
              ? '"Delete for everyone" removes it for both of you. "Delete for me" removes it only from your chat.'
              : canManage
                ? 'This removes the message for both of you. This can\'t be undone.'
                : 'This removes the message only from your chat. The other person still has it.'}
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => void runDelete('everyone')}
              disabled={deleting !== null}
              className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-status-danger text-[16px] font-semibold text-white active:bg-status-danger-strong disabled:opacity-60"
              data-testid="message-delete-everyone"
            >
              {deleting === 'everyone' ? 'Deleting…' : canHide ? 'Delete for everyone' : 'Delete'}
            </button>
          )}
          {canHide && (
            <button
              type="button"
              onClick={() => void runDelete('me')}
              disabled={deleting !== null}
              className={cn(
                'flex h-12 w-full items-center justify-center rounded-full text-[16px] font-semibold disabled:opacity-60',
                canManage ? 'mt-2 bg-accent-red-soft text-status-danger' : 'mt-5 bg-status-danger text-white active:bg-status-danger-strong',
              )}
              data-testid="message-delete-me"
            >
              {deleting === 'me' ? 'Deleting…' : 'Delete for me'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            disabled={deleting !== null}
            className="mt-1 flex h-11 w-full items-center justify-center text-[16px] font-semibold text-ink-1 disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </div>
  )
}
