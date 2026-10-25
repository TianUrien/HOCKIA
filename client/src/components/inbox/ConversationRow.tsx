import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { formatInboxTime } from '@/lib/inboxTime'
import { cn } from '@/lib/utils'
import type { RoleLike } from '@/lib/identity'

/**
 * List item / Conversation (Figma 494:2377), the one conversation row for the
 * phone Inbox and the desktop master-detail inbox (design audit 2026-10-21,
 * B4): avatar 52 (people round, clubs and brands rounded square), name + one
 * time format (lib/inboxTime), the role or applicant context line, the last
 * message, and one unread treatment: a dot (never a number) and the time in
 * violet (rebrand page 19). Amber only when a
 * club owes a first reply; brand violet while unread.
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
}

export function ConversationRow({ name, avatarUrl, role, at, contextLine, preview, unread, waiting = false, selected = false, onSelect, testId = 'conversation-row', conversationId }: ConversationRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex w-full items-center gap-3 pl-4 text-left transition-colors active:bg-surface-muted',
        selected ? 'bg-brand-soft' : 'lg:hover:bg-surface-subtle',
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
}
