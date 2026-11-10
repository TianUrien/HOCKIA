import { useCallback, useEffect, useRef } from 'react'
import { Mail, MailOpen, Trash2 } from 'lucide-react'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { formatInboxTime } from '@/lib/inboxTime'
import { cn } from '@/lib/utils'
import type { RoleLike } from '@/lib/identity'
import { SPRING, animateSpring, springValue, stopSpring, type SpringValue } from '@/lib/spring'
import { hapticSelection } from '@/lib/haptics'
import { useLongPress } from '@/hooks/useLongPress'

/**
 * List item / Conversation (Figma 494:2377), the one conversation row for the
 * phone Inbox and the desktop master-detail inbox (design audit 2026-10-21,
 * B4): avatar 52 (people round, clubs and brands rounded square), name + one
 * time format (lib/inboxTime), the role or applicant context line, the last
 * message, and one unread treatment: a dot (never a number) and the time in
 * violet (rebrand page 19). Amber only when a
 * club owes a first reply; brand violet while unread.
 *
 * Actions (founder 2026-11-10), when the caller passes them: swipe left to
 * reveal Unread/Read and Delete (springs, Motion spec), press and hold or
 * right-click for the same menu (`onLongPress`).
 */
export interface ConversationRowProps {
  name: string
  avatarUrl: string | null
  role: RoleLike
  /** Last activity, ISO. */
  at: string | null
  /** "Player · Midfielder · Applied" (club) or the role ("Coach"). */
  contextLine: string | null
  /** Already prefixed ("You: …") by the caller. */
  preview: string
  unread: boolean
  /** A club owes this person a first reply (amber dot). */
  waiting?: boolean
  /** Desktop: the thread open on the right. */
  selected?: boolean
  onSelect: () => void
  testId?: string
  conversationId?: string
  onToggleUnread?: () => void
  onDelete?: () => void
  onLongPress?: () => void
}

const ACTION_WIDTH = 80
const OPEN_OFFSET = -ACTION_WIDTH * 2
const AXIS_LOCK = 8

// One row open at a time, like Mail: opening a row closes the previous one.
let closeOpenRow: (() => void) | null = null

export function ConversationRow({ name, avatarUrl, role, at, contextLine, preview, unread, waiting = false, selected = false, onSelect, testId = 'conversation-row', conversationId, onToggleUnread, onDelete, onLongPress }: ConversationRowProps) {
  const swipeable = Boolean(onToggleUnread && onDelete)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const faceRef = useRef<HTMLButtonElement>(null)
  const spring = useRef<SpringValue | null>(null)
  const offset = useRef(0)
  const isOpen = useRef(false)
  const longPress = useLongPress(onLongPress ?? null)

  const getSpring = useCallback(() => {
    if (!spring.current) {
      spring.current = springValue(0, (x) => {
        offset.current = x
        if (faceRef.current) faceRef.current.style.transform = x === 0 ? '' : `translate3d(${x}px,0,0)`
      })
    }
    return spring.current
  }, [])

  // This row's own close function, stable for its lifetime (the "one open
  // row" registry compares identities).
  const closeRef = useRef<() => void>(() => {})

  const settle = useCallback((open: boolean, v?: number) => {
    isOpen.current = open
    animateSpring(getSpring(), open ? OPEN_OFFSET : 0, { ...(open ? SPRING.sheetOpen : SPRING.sheetClose), v })
    const mine = closeRef.current
    if (open) {
      if (closeOpenRow && closeOpenRow !== mine) closeOpenRow()
      closeOpenRow = mine
    } else if (closeOpenRow === mine) {
      closeOpenRow = null
    }
  }, [getSpring])

  const close = useCallback(() => settle(false), [settle])
  closeRef.current = close

  useEffect(() => () => {
    if (spring.current) stopSpring(spring.current)
    if (closeOpenRow === closeRef.current) closeOpenRow = null
  }, [])

  // Touch swipe. touchmove must be non-passive to stop the list scrolling
  // once the gesture is horizontal, so it's bound by hand.
  useEffect(() => {
    const el = wrapperRef.current
    if (!el || !swipeable) return
    let startX = 0
    let startY = 0
    let base = 0
    let axis: 'x' | 'y' | null = null
    let lastX = 0
    let lastT = 0
    let velocity = 0
    let crossed = false

    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      startX = lastX = t.clientX
      startY = t.clientY
      lastT = performance.now()
      base = offset.current
      axis = null
      velocity = 0
      crossed = isOpen.current
    }
    const onMove = (e: TouchEvent) => {
      const t = e.touches[0]
      const dx = t.clientX - startX
      const dy = t.clientY - startY
      if (!axis) {
        if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis === 'x' && spring.current) stopSpring(spring.current)
      }
      if (axis !== 'x') return
      e.preventDefault()
      const now = performance.now()
      velocity = (t.clientX - lastX) / Math.max(1, now - lastT) * 1000
      lastX = t.clientX
      lastT = now
      let next = base + dx
      // Rubber band past the actions and to the right of closed.
      if (next < OPEN_OFFSET) next = OPEN_OFFSET + (next - OPEN_OFFSET) * 0.3
      if (next > 0) next = next * 0.3
      getSpring().x = next
      getSpring().onUpdate(next)
      if (!crossed && next < OPEN_OFFSET / 2) { crossed = true; void hapticSelection() }
      if (crossed && next > OPEN_OFFSET / 2) crossed = false
    }
    const onEnd = () => {
      if (axis !== 'x') return
      const open = velocity < -500 ? true : velocity > 500 ? false : offset.current < OPEN_OFFSET / 2
      settle(open, velocity)
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [getSpring, settle, swipeable])

  const handleSelect = () => {
    // A tap on an open row closes it (Mail), it doesn't open the thread.
    if (isOpen.current || Math.abs(offset.current) > 2) {
      close()
      return
    }
    onSelect()
  }

  const runAction = (action?: () => void) => {
    close()
    action?.()
  }

  const face = (
    <button
      ref={faceRef}
      type="button"
      onClick={handleSelect}
      {...(onLongPress ? longPress : {})}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'relative flex w-full items-center gap-3 pl-4 text-left transition-colors active:bg-surface-muted [-webkit-touch-callout:none] select-none',
        selected ? 'bg-brand-soft' : 'bg-white lg:hover:bg-surface-subtle',
      )}
      data-testid={testId}
      data-conversation-id={conversationId}
    >
      <EntityAvatar src={avatarUrl} name={name} role={role} size={52} />
      <span className={cn('min-w-0 flex-1 border-b py-3 pr-4 group-last:border-b-0', selected ? 'border-transparent' : 'border-line')}>
        <span className="flex items-baseline justify-between gap-2">
          <span className={cn('truncate text-[16px] leading-[21px] text-ink-1', unread ? 'font-semibold' : 'font-medium')}>{name}</span>
          <span className={cn('shrink-0 text-secondary', unread && !waiting ? 'font-semibold text-brand-text' : 'text-ink-3')} data-testid="conversation-date">{formatInboxTime(at)}</span>
        </span>
        {contextLine && <span className="block truncate text-secondary text-ink-2">{contextLine}</span>}
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn('min-w-0 flex-1 truncate text-[14px] leading-[19px]', unread ? 'font-medium text-ink-1' : 'text-ink-2')}>{preview}</span>
          {waiting ? (
            <span aria-label="Waiting for your first reply" className="h-2 w-2 shrink-0 rounded-full bg-status-warning" data-testid="inbox-waiting-dot" />
          ) : unread ? (
            <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-hockia-primary" data-testid="inbox-unread-dot" />
          ) : null}
        </span>
      </span>
    </button>
  )

  if (!swipeable) return face

  return (
    <div ref={wrapperRef} className="relative overflow-hidden" data-testid={`${testId}-swipe`}>
      {/* Revealed behind the row by a left swipe; hidden from assistive tech
          (the same actions are in the press-and-hold menu). */}
      <div className="absolute inset-y-0 right-0 flex" aria-hidden="true">
        <button
          type="button"
          tabIndex={-1}
          onClick={() => runAction(onToggleUnread)}
          className="flex w-20 flex-col items-center justify-center gap-1 bg-hockia-primary text-[13px] font-semibold text-white"
          data-testid="conversation-swipe-unread"
        >
          {unread ? <MailOpen className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
          {unread ? 'Read' : 'Unread'}
        </button>
        <button
          type="button"
          tabIndex={-1}
          onClick={() => runAction(onDelete)}
          className="flex w-20 flex-col items-center justify-center gap-1 bg-status-danger text-[13px] font-semibold text-white"
          data-testid="conversation-swipe-delete"
        >
          <Trash2 className="h-5 w-5" />
          Delete
        </button>
      </div>
      {face}
    </div>
  )
}
