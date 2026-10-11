import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Briefcase, ChevronRight, Copy, Play } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { getImageUrl, getLqipUrl } from '@/lib/imageUrl'
import { formatActivityAge } from '@/lib/inboxTime'
import { initialsOf } from '@/lib/communityCard'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { BlurImage } from '@/components/home/v1/BlurImage'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import { cn } from '@/lib/utils'
import { roleTitle } from '@/lib/homeEngagement'
import { genderPill } from '@/lib/opportunityCopy'
import { roleStatusLine } from '@/lib/profileV2'
import type { ClubOpenRole } from '@/hooks/useClubProfileScrollData'

const CommentsTab = lazy(() => import('@/components/CommentsTab'))

/**
 * Profile v2 building blocks (Figma PR1 97:4): section shell with a 20 pt
 * title + "See all N", fact tiles, chips, the unified Posts & photos grid and
 * the Comments preview.
 */
export function Section({ id, title, action, onAction, children, className }: {
  id: string
  title: string
  action?: string | null
  onAction?: () => void
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('scroll-mt-[120px] pt-6', className)} data-testid={`profile-section-${id}`}>
      <div className="mb-3 flex items-center px-4">
        <h2 className="min-w-0 flex-1 truncate text-[20px] font-semibold leading-6 tracking-[-0.08px] text-ink-1">{title}</h2>
        {action && onAction && (
          <button type="button" onClick={onAction} className="-my-2 flex min-h-[44px] items-center pl-3 text-secondary font-semibold text-hockia-primary">{action}</button>
        )}
      </div>
      {children}
    </section>
  )
}

/** Fact tile (radius 12, surface/subtle): MICRO label, 16 semibold value, 13 detail. */
export function FactTile({ label, value, detail, tone, leading, onClick, full = false }: {
  label: string
  value: string
  detail?: string | null
  tone?: 'positive' | 'muted'
  leading?: ReactNode
  onClick?: () => void
  full?: boolean
}) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-micro font-semibold uppercase text-ink-3">{label}</span>
        <span className={cn('block truncate text-[16px] font-semibold leading-[21px]', tone === 'positive' ? 'text-[#15803d]' : tone === 'muted' ? 'text-ink-3' : 'text-ink-1')}>{value}</span>
        {detail && <span className="block truncate text-secondary text-ink-2">{detail}</span>}
      </span>
      {onClick && <ChevronRight className="h-[18px] w-[18px] shrink-0 text-ink-4" strokeWidth={2} />}
    </>
  )
  const cls = cn('flex items-center gap-3 rounded-[12px] bg-surface-subtle px-3.5 py-3 text-left', full ? 'w-full' : 'min-w-0 flex-1')
  return onClick ? <button type="button" onClick={onClick} className={cls}>{inner}</button> : <div className={cls}>{inner}</div>
}

export function Chip({ children, outline = false }: { children: ReactNode; outline?: boolean }) {
  return (
    <span className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full text-secondary font-semibold text-ink-1', outline ? 'border border-line bg-white pl-1 pr-3' : 'bg-surface-muted px-3')}>
      {children}
    </span>
  )
}

/** Overlapping faces (28 pt, overlap 10) + a line, e.g. "25 friends · 3 in common with you". */
export function FacesRow({ people, text, onClick }: {
  people: Array<{ id: string; full_name: string | null; avatar_url: string | null; role?: string | null }>
  text: string
  onClick?: () => void
}) {
  const faces = people.slice(0, 3)
  const inner = (
    <>
      {faces.length > 0 && (
        <span className="relative h-7 shrink-0" style={{ width: 28 + (faces.length - 1) * 18 }} aria-hidden="true">
          {faces.map((p, i) => (
            <span key={p.id} className="absolute top-0" style={{ left: i * 18 }}>
              <FaceCircle url={p.avatar_url} name={p.full_name} role={p.role} size="avatar-sm" initialsClassName="text-[10px]" className="h-7 w-7 ring-2 ring-white" />
            </span>
          ))}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-secondary text-ink-2">{text}</span>
      {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={2} />}
    </>
  )
  const cls = 'flex min-h-[44px] w-full items-center gap-2.5 text-left'
  return onClick ? <button type="button" onClick={onClick} className={cls} data-testid="profile-friends-row">{inner}</button> : <div className={cls}>{inner}</div>
}

export type GridTile =
  | { kind: 'photo'; id: string; url: string; at: string; onOpen: () => void }
  | { kind: 'post'; id: string; url: string | null; text: string; multi: boolean; video: boolean; at: string; onOpen: () => void }
  | { kind: 'reel'; id: string; poster: string | null; at: string; onOpen: () => void }

/** Posts & photos — one 3-column grid, newest first; multi / video icons; text-post tiles (PR1 103:29). */
export function PostsPhotosGrid({ tiles }: { tiles: GridTile[] }) {
  const shown = tiles.slice(0, 6)
  const rows = Math.ceil(shown.length / 3)
  const radius = (i: number) => {
    const r = Math.floor(i / 3)
    const c = i % 3
    const last = rows - 1
    return cn(
      'rounded-[4px]',
      r === 0 && c === 0 && 'rounded-tl-[14px]',
      r === 0 && c === 2 && 'rounded-tr-[14px]',
      r === last && c === 0 && 'rounded-bl-[14px]',
      r === last && i === shown.length - 1 && 'rounded-br-[14px]',
    )
  }
  return (
    <div className="grid grid-cols-3 gap-1 px-4">
      {shown.map((t, i) => (
        <button key={`${t.kind}-${t.id}`} type="button" onClick={t.onOpen} className={cn('relative h-[117px] overflow-hidden border-[0.5px] border-[rgba(15,15,20,0.06)]', radius(i), t.kind === 'post' && !t.url && 'bg-hockia-soft')}>
          {t.kind === 'photo' && <BlurImage src={getImageUrl(t.url, 'gallery') ?? t.url} lqip={getLqipUrl(t.url)} className="h-full w-full" />}
          {t.kind === 'post' && t.url && <BlurImage src={getImageUrl(t.url, 'gallery') ?? t.url} lqip={getLqipUrl(t.url)} className="h-full w-full" />}
          {t.kind === 'post' && !t.url && (
            <span className="flex h-full w-full items-center p-2.5 text-left">
              <span className="line-clamp-4 overflow-hidden text-secondary font-semibold text-hockia-primary [overflow-wrap:anywhere]">“{t.text}”</span>
            </span>
          )}
          {t.kind === 'reel' && (t.poster ? <BlurImage src={t.poster} className="h-full w-full" /> : <span className="block h-full w-full bg-gradient-to-br from-ink-1 to-ink-2" />)}
          {((t.kind === 'post' && t.multi && t.url) || (t.kind === 'post' && t.video) || t.kind === 'reel') && (
            <span className="absolute right-1.5 top-1.5 text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.5)]" aria-hidden="true">
              {t.kind === 'reel' || (t.kind === 'post' && t.video) ? <Play className="h-[18px] w-[18px] fill-white" strokeWidth={1.5} /> : <Copy className="h-[18px] w-[18px]" strokeWidth={2} />}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

interface CommentRow { id: string; content: string; created_at: string; author: { id: string; full_name: string | null; avatar_url: string | null; role: string | null } | null }

/**
 * Comments (ruling 11 Oct: kept, near About, on profile_comments with the
 * same moderation): the two newest + "Write a comment…". The field and
 * "See all" open the existing comments panel in a sheet, which keeps every
 * rule (friends comment, one per person, report, owner moderation).
 */
export function CommentsPreview({ profileId, profileRole, owner }: { profileId: string; profileRole?: string | null; owner: boolean }) {
  const viewer = useAuthStore((s) => s.profile)
  const [rows, setRows] = useState<CommentRow[]>([])
  const [count, setCount] = useState(0)
  const [open, setOpen] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    void supabase
      .from('profile_comments')
      .select('id, content, created_at, author:profiles!profile_comments_author_profile_id_fkey (id, full_name, avatar_url, role)', { count: 'exact' })
      .eq('profile_id', profileId)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })
      .limit(2)
      .then(({ data, count: n }) => {
        if (cancelled) return
        setRows((data ?? []) as unknown as CommentRow[])
        setCount(n ?? 0)
      })
    return () => { cancelled = true }
  }, [profileId, nonce])

  if (owner && count === 0) return null

  return (
    <Section id="comments" title={count > 0 ? `Comments · ${count}` : 'Comments'} action={count > 0 ? 'See all' : null} onAction={() => setOpen(true)}>
      <div className="flex flex-col gap-3.5 px-4">
        {rows.map((c) => (
          <div key={c.id} className="flex items-start gap-2.5">
            <FaceCircle url={c.author?.avatar_url} name={c.author?.full_name} role={c.author?.role} size="avatar-sm" initialsClassName="text-[11px]" className="h-8 w-8" />
            <div className="min-w-0 flex-1">
              <p className="text-secondary"><span className="font-semibold text-ink-1">{c.author?.full_name ?? 'Member'}</span> <span className="text-ink-3">{formatActivityAge(c.created_at)}</span></p>
              <p className="whitespace-pre-line break-words text-[14px] leading-[19px] text-ink-1">{c.content}</p>
            </div>
          </div>
        ))}
        {!owner && count === 0 && <p className="text-secondary text-ink-3">No comments yet</p>}
        {!owner && (
          <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-2.5 text-left" data-testid="profile-write-comment">
            <FaceCircle url={viewer?.avatar_url} name={viewer?.full_name ?? initialsOf(null)} role={viewer?.role} size="avatar-sm" initialsClassName="text-[11px]" className="h-8 w-8" />
            <span className="flex min-h-[40px] flex-1 items-center rounded-[20px] bg-surface-muted px-3.5 text-[15px] text-ink-3">Write a comment…</span>
          </button>
        )}
      </div>
      <BottomSheet open={open} onClose={() => { setOpen(false); setNonce((n) => n + 1) }} ariaLabel="Comments" className="min-h-[55dvh]">
        <div className="px-4 pb-4">
          <Suspense fallback={<div className="h-40" />}>
            <CommentsTab profileId={profileId} profileRole={profileRole as never} />
          </Suspense>
        </div>
      </BottomSheet>
    </Section>
  )
}

/** Open-role row (PR6 / PR8): briefcase tile, role, team, status line, Apply / Manage. */
export function RoleRow({ role, cta, onOpen }: { role: ClubOpenRole; cta: string; onOpen: () => void }) {
  const title = roleTitle(role.position, null, role.title)
  const team = genderPill(role.gender)?.label ?? null
  const status = roleStatusLine(role.deadline, role.createdAt)
  return (
    <div className="flex w-full items-center gap-3 rounded-[20px] bg-surface-subtle py-3 pl-3.5 pr-3" data-testid="club-role-row">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-hockia-soft text-hockia-primary"><Briefcase className="h-[22px] w-[22px]" strokeWidth={1.8} /></span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{title}</span>
          {team && <span className="block truncate text-secondary text-ink-2">{team}</span>}
          {status && <span className="block truncate text-caption text-hockia-primary">{status}</span>}
        </span>
      </button>
      <button type="button" onClick={onOpen} className="flex h-11 shrink-0 items-center rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-ink-1">{cta}</button>
    </div>
  )
}
