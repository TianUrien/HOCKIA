import type { ReactNode } from 'react'
import Avatar from '@/components/Avatar'

/**
 * List item / Comment (Figma "03 · Components" 567:569): avatar 32, the name
 * (15 semibold) and "role · time" (12, ink-2) on ONE line, then the text.
 * `actions` is the quiet row under the text (Delete for the author, Report
 * for everyone else).
 */
interface CommentListItemProps {
  name: string
  avatarUrl: string | null
  role?: string | null
  /** "Player · 2h" */
  meta: string
  text: string
  actions?: ReactNode
}

export function CommentListItem({ name, avatarUrl, role, meta, text, actions }: CommentListItemProps) {
  return (
    <li className="flex gap-2.5 px-5 py-2" data-testid="comment-list-item">
      <Avatar src={avatarUrl} initials={name.slice(0, 2) || '?'} size="sm" className="mt-0.5 flex-shrink-0" role={role} />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className="min-w-0 truncate text-row font-semibold text-ink-1">{name}</span>
          <span className="shrink-0 text-caption text-ink-2 lg:text-secondary" data-testid="comment-meta">{meta}</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-row text-ink-1">{text}</p>
        {actions}
      </div>
    </li>
  )
}
