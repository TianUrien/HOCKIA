import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, Share } from 'lucide-react'
import { Avatar } from '@/components'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { hapticLight, hapticSuccess } from '@/lib/haptics'
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
        <span className="mt-0.5 block truncate text-caption text-ink-3">{subtitle}</span>
      </span>
    </>
  )
  return (
    <div className="flex items-center gap-2.5 pb-2 pl-4 pr-2" data-author={authorId}>
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
  // Motion 95:1012 §4: a burst per tap (never on undo); the key restarts it.
  const [burst, setBurst] = useState(0)

  const toggle = async () => {
    if (!user || busy) return
    if (has) void hapticLight()
    else { void hapticSuccess(); setBurst((b) => b + 1) }
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
      {burst > 0 && <ConfettiBurst key={burst} />}
      <span
        key={burst}
        className={cn(
          'inline-flex h-8 items-center gap-1 rounded-full px-3 text-secondary font-semibold tabular-nums transition-[transform,background-color,color] duration-300 ease-[cubic-bezier(0.34,1.36,0.64,1)] active:scale-[0.97]',
          burst > 0 && has && 'hockia-pop',
          tone === 'gold'
            ? has ? 'bg-gold-line text-white' : 'bg-gold-soft text-ink-1'
            : has ? 'bg-hockia-primary text-white' : 'bg-hockia-soft text-hockia-primary',
        )}
      >
        <span aria-hidden="true">👏</span> <span key={text} className={burst > 0 ? 'hockia-count-roll' : undefined}>{text}</span>
      </span>
    </button>
  )
}

const CONFETTI = ['#6c2bd9', '#a854f7', '#c9a227', '#e8c55a']

/** 12 pieces (purple + gold, 3–6 pt) within a 64 pt radius, ≤ 700 ms, then gone.
 *  Reduce Motion: nothing (the pill's colour change says it). */
function ConfettiBurst() {
  const [done, setDone] = useState(false)
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [pieces] = useState(() =>
    Array.from({ length: 12 }, (_, i) => {
      const angle = (i / 12) * Math.PI * 2 + Math.random() * 0.4
      const r = 34 + Math.random() * 30
      return {
        dx: `${Math.round(Math.cos(angle) * r)}px`,
        dy: `${Math.round(Math.sin(angle) * r)}px`,
        rot: `${Math.round(Math.random() * 360)}deg`,
        size: 3 + Math.round(Math.random() * 3),
        color: CONFETTI[i % CONFETTI.length],
        round: i % 3 === 0,
        delay: Math.round(Math.random() * 60),
      }
    }),
  )
  // One burst, then removed from the DOM.
  useEffect(() => {
    const t = window.setTimeout(() => setDone(true), 720)
    return () => window.clearTimeout(t)
  }, [])
  if (reduce || done) return null
  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-0 w-0">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="absolute"
          style={{
            width: p.size,
            height: p.round ? p.size : p.size * 1.6,
            marginLeft: -p.size / 2,
            marginTop: -p.size / 2,
            borderRadius: p.round ? 999 : 1,
            background: p.color,
            ['--dx' as string]: p.dx,
            ['--dy' as string]: p.dy,
            ['--rot' as string]: p.rot,
            animation: `hockia-confetti 640ms cubic-bezier(.2,0,0,1) ${p.delay}ms both`,
          }}
        />
      ))}
    </span>
  )
}
