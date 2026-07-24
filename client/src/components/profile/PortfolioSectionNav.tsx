import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * PortfolioSectionNav — sticky quick-nav chips on the public portfolio.
 *
 * Each dashboard passes ONLY the sections it actually rendered (same gate
 * conditions as the wrappers), so a chip can never point at a missing
 * anchor. Pins directly below the fixed Header (76px content height +
 * native safe-area, mirroring Header.tsx's py-4 + 44px controls); the
 * portfolio anchors use scroll-mt-32 so a jump lands below BOTH bars.
 *
 * Active-section tracking is IntersectionObserver-based and purely
 * cosmetic — in environments without IO callbacks (vitest stub) the bar
 * still renders and scrolls, it just doesn't highlight.
 */

export interface PortfolioNavSection {
  /** DOM anchor id of the section wrapper (e.g. 'portfolio-media'). */
  id: string
  label: string
}

interface PortfolioSectionNavProps {
  sections: PortfolioNavSection[]
  /**
   * True when PublicViewBanner is on screen (owner previewing their own
   * public profile). That banner is `fixed top-[68px]` and taller than
   * the header, so the default offset would park the chips underneath
   * it. Its height differs by breakpoint because its content stacks on
   * mobile (see PublicViewBanner's own h-[132px] sm:h-[68px] spacer).
   */
  hasPreviewBanner?: boolean
}

// One or two sections don't need a map; the bar earns its pixels at 3+.
const MIN_SECTIONS = 3

export default function PortfolioSectionNav({
  sections,
  hasPreviewBanner = false,
}: PortfolioSectionNavProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  // Suppress observer-driven highlight churn while a chip-initiated smooth
  // scroll is in flight — the sections passing by would flash each chip.
  const clickScrollUntil = useRef(0)

  useEffect(() => {
    if (sections.length < MIN_SECTIONS) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < clickScrollUntil.current) return
        // Topmost intersecting section wins.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible.length > 0) setActiveId(visible[0].target.id)
      },
      // Band just below the sticky bars: a section is "active" while it
      // occupies the upper-middle of the viewport.
      { rootMargin: '-140px 0px -55% 0px' }
    )
    const observed: Element[] = []
    for (const s of sections) {
      const el = document.getElementById(s.id)
      if (el) {
        observer.observe(el)
        observed.push(el)
      }
    }
    return () => observer.disconnect()
  }, [sections])

  if (sections.length < MIN_SECTIONS) return null

  const handleJump = (id: string) => {
    const el = document.getElementById(id)
    if (!el || typeof el.scrollIntoView !== 'function') return
    clickScrollUntil.current = Date.now() + 900
    setActiveId(id)
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav
      aria-label="Profile sections"
      data-testid="portfolio-section-nav"
      className={cn(
        'sticky z-30 -mx-4 border-b border-gray-100 bg-gray-50/95 px-4 py-2 backdrop-blur md:-mx-6 md:px-6',
        hasPreviewBanner
          ? 'top-[calc(200px+env(safe-area-inset-top))] sm:top-[calc(148px+env(safe-area-inset-top))]'
          : 'top-[calc(76px+env(safe-area-inset-top))]',
      )}
    >
      <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => handleJump(s.id)}
            aria-current={activeId === s.id ? 'true' : undefined}
            className={cn(
              'whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors',
              activeId === s.id
                ? 'bg-hockia-primary text-white'
                : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-100'
            )}
          >
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  )
}
