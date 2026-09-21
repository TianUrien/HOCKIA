/**
 * FeedCard — the ONE visual shell every Home feed card uses (Figma 03 Player,
 * Home v2 "post/…" and "event/…" frames). On the phone the feed is white with
 * hairline separators between cards (no card chrome); from md up the cards
 * sit on a muted page as rounded white surfaces. The header row reads exactly
 * the same on every card type:
 *
 *   [avatar]  Name                                        [right slot]
 *             Player · Old Lions · 2h
 *
 * Name → author profile. "Roles are never implicit" (00 Architecture): the
 * second line always opens with the role, then the club (from
 * FeedAuthorContext — one batched read per page), then the time. Activity
 * cards put their label in a FeedCardCaption inside the body, so the header
 * stays identical across the feed.
 */
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '@/components'
import { formatActivityAge } from '@/lib/inboxTime'
import { useAuthorContext } from '@/hooks/useFeedAuthorContext'
import { roleLabel } from '@/lib/identity'
import { profilePathForRole, type FeedAuthorRole as Role } from '@/lib/feedPaths'

// Re-exported for the cards' convenience; the implementation lives in
// lib/feedPaths so this file stays fast-refresh clean.
// eslint-disable-next-line react-refresh/only-export-components
export { profilePathForRole }

export function FeedCard({ children, className = '', testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <article
      data-testid={testId}
      className={`bg-white md:rounded-2xl md:shadow-[0_1px_2px_rgba(20,20,28,0.04)] ${className}`}
    >
      {children}
    </article>
  )
}

interface FeedCardHeaderProps {
  authorId: string
  name: string | null | undefined
  avatarUrl: string | null | undefined
  role: Role
  createdAt: string
  /** Override the profile link (null = not linkable, e.g. brand authors). */
  profilePath?: string | null
  /** Replaces the role · club line (e.g. an opportunity's location). */
  subtitle?: string | null
  /** Small text after the time, e.g. "Official". */
  right?: ReactNode
}

export function FeedCardHeader({ authorId, name, avatarUrl, role, createdAt, profilePath, subtitle, right }: FeedCardHeaderProps) {
  const ctx = useAuthorContext(authorId)
  // Figma: "Player · Old Lions · 2h" — the club (city only when no club is set).
  const place = role === 'club' ? ctx?.city : ctx?.club ?? ctx?.city
  const context = subtitle ?? [roleLabel(role), place].filter(Boolean).join(' · ')
  const timeAgo = formatActivityAge(createdAt)
  const path = profilePath === undefined ? profilePathForRole(role, authorId) : profilePath
  const displayName = name || (role === 'club' ? 'A club' : 'A member')
  const initials = (name ?? '').trim().split(/\s+/).filter(Boolean).map((p) => p[0]).join('').slice(0, 2).toUpperCase() || '?'

  const identity = (
    <>
      <Avatar src={avatarUrl} initials={initials} size="md" role={role ?? undefined} className="flex-shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-row font-semibold text-ink-1">{displayName}</p>
        <p className="truncate text-secondary text-ink-2">
          {context ? <>{context} <span aria-hidden="true">·</span> </> : null}
          <time dateTime={createdAt}>{timeAgo}</time>
        </p>
      </div>
    </>
  )

  return (
    <div className="flex items-center gap-2.5 px-5 pb-2.5 pt-3.5">
      {path ? (
        <Link to={path} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`${displayName} — view profile`}>
          {identity}
        </Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
      )}
      {right}
    </div>
  )
}

/** Activity label inside the body: "Added 11 new photos", "New highlight". */
export function FeedCardCaption({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-5 pb-2.5 text-[14px] leading-5 text-ink-1">
      {icon ? <span className="flex h-4 w-4 items-center justify-center text-hockia-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
      <span className="min-w-0">{children}</span>
    </p>
  )
}

/** Body text (post caption). Figma: 16/22 on the phone. */
export function FeedCardBody({ children }: { children: ReactNode }) {
  return <div className="px-5 pb-2.5 text-[16px] leading-[22px] text-ink-1">{children}</div>
}

/** Media well: inset, 14px radius, dark ground so letterboxed video reads clean. */
export function FeedCardMedia({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`px-5 pb-2.5 ${className}`}><div className="overflow-hidden rounded-card bg-gray-100">{children}</div></div>
}

/** Duration pill for video media ("0:42"). */
export function DurationBadge({ seconds }: { seconds: number | null | undefined }) {
  if (!seconds || seconds <= 0) return null
  const total = Math.floor(seconds)
  const m = Math.floor(total / 60)
  const s = (total % 60).toString().padStart(2, '0')
  return (
    <span className="pointer-events-none absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-lg bg-black/55 px-2 py-0.5 text-[12px] font-semibold tabular-nums text-white">
      <span aria-hidden="true" className="text-[9px]">▶</span> {m}:{s}
    </span>
  )
}

/** Quiet secondary action ("View profile", "See opportunity"). */
export function FeedCardAction({ to, onClick, children }: { to?: string; onClick?: () => void; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-1.5 rounded-full bg-surface-grouped px-4 py-2 text-[13px] font-semibold text-ink-1 transition-colors hover:bg-gray-200 active:bg-gray-200'
  if (to) return <Link to={to} className={cls}>{children}</Link>
  return <button type="button" onClick={onClick} className={cls}>{children}</button>
}

/** Primary action ("Apply"). */
export function FeedCardPrimaryAction({ onClick, to, children }: { onClick?: () => void; to?: string; children: ReactNode }) {
  const cls = 'inline-flex items-center gap-1.5 rounded-full bg-hockia-primary px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90 active:opacity-80'
  if (to) return <Link to={to} className={cls}>{children}</Link>
  return <button type="button" onClick={onClick} className={cls}>{children}</button>
}

/** Row of actions at the bottom of an activity card. */
export function FeedCardFooter({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 px-5 pb-3.5">{children}</div>
}
