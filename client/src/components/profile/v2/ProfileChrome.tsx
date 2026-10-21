import { useEffect, useRef, useState, type ReactNode } from 'react'
import { chipTone } from '@/components/ui/chipClasses'
import { COMPACT_HEADER_PX, useHeroStatusBar } from './profileChromeHooks'
import { Share } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import { BackGlyph } from '@/components/ui/BackGlyph'

/**
 * Compact header (Figma PR10 / PR11): once the hero has scrolled away, a white
 * bar with back · name · share fades in; the section anchors stick under it.
 */
export function CompactHeader({ name, avatarUrl, role = 'player', visible, owner, onBack, onShare, right }: {
  name: string
  avatarUrl?: string | null
  role?: string
  visible: boolean
  owner: boolean
  onBack?: () => void
  onShare: () => void
  right?: ReactNode
}) {
  // Light status-bar glyphs over the hero, dark once this header shows.
  useHeroStatusBar(visible)
  return (
    <div
      className={cn(
        'fixed inset-x-0 top-0 z-40 border-b border-line bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur-[20px] transition-[opacity,transform] duration-[250ms] ease-[cubic-bezier(.2,0,0,1)] lg:hidden',
        visible ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0',
      )}
      aria-hidden={!visible}
      data-testid="profile-compact-header"
    >
      <div className="flex items-center gap-1 px-2" style={{ height: COMPACT_HEADER_PX }}>
        {!owner ? (
          <button type="button" onClick={onBack} aria-label="Back" tabIndex={visible ? 0 : -1} className="flex h-11 w-11 items-center justify-center text-ink-1"><BackGlyph className="h-6 w-6" strokeWidth={1.8} /></button>
        ) : <span className="w-3" />}
        <FaceCircle url={avatarUrl} name={name} role={role} size="avatar-sm" initialsClassName="text-[11px]" className="mr-1.5 h-[30px] w-[30px] shrink-0" />
        <p className="min-w-0 flex-1 truncate text-body font-semibold text-ink-1">{name}</p>
        <button type="button" onClick={onShare} aria-label="Share profile" tabIndex={visible ? 0 : -1} className="flex h-11 w-11 items-center justify-center text-ink-1"><Share className="h-[22px] w-[22px]" strokeWidth={1.6} /></button>
        {right}
      </div>
    </div>
  )
}

export interface AnchorItem { id: string; label: string }

/**
 * Sticky section anchors (chips 34 visual / 44 hit). The chip for the section
 * under the header is the dark one; tapping scrolls to that section.
 */
export function SectionAnchors({ items, refreshKey }: { items: AnchorItem[]; /** Change it when sections mount late (data loaded) so they get observed. */ refreshKey?: string | number | boolean }) {
  const [active, setActive] = useState(items[0]?.id ?? null)
  const rowRef = useRef<HTMLDivElement>(null)
  const ids = items.map((i) => i.id).join(',')
  // A tapped chip stays the current one while its smooth scroll runs, so
  // sections passing through the band don't steal the highlight (QA F1).
  const pinnedUntil = useRef(0)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    // At the top of the page the first chip is the current one, whatever
    // section briefly sat in the band while the page was still loading.
    if (window.scrollY < 40 && items[0]) setActive(items[0].id)
    const els = items.map((i) => document.getElementById(i.id)).filter((e): e is HTMLElement => Boolean(e))
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (Date.now() < pinnedUntil.current) return
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-120px 0px -55% 0px' },
    )
    els.forEach((el) => io.observe(el))
    // At the very bottom the last section can't reach the band (it's too
    // short to scroll up to the top), so the last chip becomes current.
    const onScroll = () => {
      if (Date.now() < pinnedUntil.current) return
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atBottom && items.length) setActive(items[items.length - 1].id)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => { io.disconnect(); window.removeEventListener('scroll', onScroll) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, refreshKey])

  // Keep the active chip in view in the row.
  useEffect(() => {
    const chip = rowRef.current?.querySelector<HTMLElement>(`[data-anchor="${active}"]`)
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' })
  }, [active])

  const go = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - (COMPACT_HEADER_PX + 60)
    pinnedUntil.current = Date.now() + 1000
    window.scrollTo({ top, behavior: 'smooth' })
    setActive(id)
  }

  return (
    <nav
      // Phone: under the compact header; desktop: under the app header.
      className="sticky top-[calc(env(safe-area-inset-top)+52px)] z-30 bg-white/95 backdrop-blur-[20px] lg:top-[77px]"
      aria-label="Profile sections"
      data-testid="profile-anchors"
    >
      <div ref={rowRef} className="flex gap-2 overflow-x-auto px-4 pb-1.5 pt-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            data-anchor={item.id}
            onClick={() => go(item.id)}
            aria-current={active === item.id ? 'true' : undefined}
            className="relative flex h-11 shrink-0 items-center"
          >
            <span className={cn('flex h-[34px] items-center rounded-full px-3.5 text-secondary font-semibold transition-colors duration-150', chipTone(active === item.id))}>
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}
