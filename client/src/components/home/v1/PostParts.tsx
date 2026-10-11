import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, Share } from 'lucide-react'
import { Avatar } from '@/components'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { hapticLight } from '@/lib/haptics'
import { toggleCongrats, compactCount, type EngageTarget } from '@/lib/homeEngagement'
import { initialsOf } from '@/lib/communityCard'
import { cn } from '@/lib/utils'

/**
 * Post header (Figma "post header"): 36 pt avatar (32 on the signing card),
 * name 14 semibold, a 12 pt line under it ("Highlight · 2h"), ⋯ in a 44 box.
 */
export function PostHeader({ authorId, name, avatarUrl, role, subtitle, profilePath, small = false, menu }: {
  authorId: string
  name: string | null
  avatarUrl: string | null
  role?: string | null
  subtitle: ReactNode
  profilePath: string | null
  small?: boolean
  menu?: ReactNode
}) {
  const display = name || (role === 'club' ? 'A club' : 'A member')
  const identity = (
    <>
      <Avatar src={avatarUrl} initials={initialsOf(name)} size="sm" role={(role ?? undefined) as never} className={cn('shrink-0', !small && '!h-9 !w-9')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold leading-[19px] text-ink-1">{display}</span>
        <span className="block truncate text-caption text-ink-3">{subtitle}</span>
      </span>
    </>
  )
  return (
    <div className="flex items-center gap-2.5 pb-2.5 pl-4 pr-2" data-author={authorId}>
      {profilePath ? (
        <Link to={profilePath} className="flex min-w-0 flex-1 items-center gap-2.5" aria-label={`${display} — view profile`}>{identity}</Link>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
      )}
      {menu}
    </div>
  )
}

const ICON_BTN = 'inline-flex min-h-[44px] items-center gap-[5px] text-secondary font-semibold tabular-nums text-ink-1'

export function LikeButton({ liked, count, onToggle }: { liked: boolean; count: number; onToggle: () => void }) {
  const user = useAuthStore((s) => s.user)
  return (
    <button
      type="button"
      disabled={!user}
      onClick={() => { void hapticLight(); onToggle() }}
      aria-pressed={liked}
      aria-label={`${liked ? 'Unlike' : 'Like'}${count ? `, ${count}` : ''}`}
      className={cn(ICON_BTN, liked && 'text-hockia-primary')}
    >
      <Heart className={cn('h-6 w-6', liked && 'fill-hockia-primary')} strokeWidth={1.7} />
      {count > 0 && <span>{compactCount(count)}</span>}
    </button>
  )
}

export function CommentButton({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} aria-label={`Comments${count ? `, ${count}` : ''}`} className={ICON_BTN}>
      <MessageCircle className="h-[22px] w-[22px]" strokeWidth={1.7} />
      {count > 0 && <span>{compactCount(count)}</span>}
    </button>
  )
}

export function ShareButton({ onShare }: { onShare: () => void }) {
  return (
    <button type="button" onClick={onShare} aria-label="Share" className="-mr-2.5 flex h-11 w-11 items-center justify-center text-ink-1">
      <Share className="h-[22px] w-[22px]" strokeWidth={1.7} />
    </button>
  )
}

/**
 * "👏 Congrats" one-tap pill (Figma 60:257 / 60:376 / H12c): one per viewer
 * per item, tap again to undo. Tapped = filled "👏 You + N". The count is
 * public (founder ruling 11 Oct). `tone="gold"` on the Reference card.
 */
export function CongratsPill({ target, has, count, onChange, label = 'Congrats', tone = 'brand' }: {
  target: EngageTarget
  has: boolean
  count: number
  onChange: (has: boolean, count: number) => void
  label?: string
  tone?: 'brand' | 'gold'
}) {
  const user = useAuthStore((s) => s.user)
  const addToast = useToastStore((s) => s.addToast)
  const [busy, setBusy] = useState(false)

  const toggle = async () => {
    if (!user || busy) return
    void hapticLight()
    const prev = { has, count }
    const next = { has: !has, count: Math.max(0, count + (has ? -1 : 1)) }
    onChange(next.has, next.count)
    setBusy(true)
    const res = await toggleCongrats(target)
    setBusy(false)
    if (!res.success) {
      onChange(prev.has, prev.count)
      addToast(res.error ?? 'Could not send congrats', 'error')
      return
    }
    if (typeof res.has_congrats === 'boolean' && typeof res.count === 'number') onChange(res.has_congrats, res.count)
  }

  const others = Math.max(0, count - 1)
  const text = has ? (others > 0 ? `You + ${compactCount(others)}` : 'You') : label
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={!user}
      aria-pressed={has}
      aria-label={has ? `Congrats sent${others ? `, with ${others} others` : ''}. Tap to undo.` : `${label}${count ? `, ${count} congrats` : ''}`}
      // 32 visual, 44 hit (spec: pills 32 with 44 hit).
      className="relative inline-flex h-11 shrink-0 items-center"
    >
      <span
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full px-3 text-secondary font-semibold tabular-nums transition-transform duration-300 ease-[cubic-bezier(0.34,1.36,0.64,1)] active:scale-[0.97]',
          tone === 'gold'
            ? has ? 'bg-gold-line text-white' : 'bg-gold-soft text-ink-1'
            : has ? 'bg-hockia-primary text-white' : 'bg-hockia-soft text-hockia-primary',
        )}
      >
        <span aria-hidden="true">👏</span> {text}
      </span>
    </button>
  )
}
