import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

type TabOption<T extends string> = {
  id: T
  label: string
}

interface ScrollableTabsProps<T extends string> {
  tabs: TabOption<T>[]
  activeTab: T
  onTabChange: (tab: T) => void
  className?: string
  activeClassName?: string
  inactiveClassName?: string
  wrapperClassName?: string
}

/**
 * ScrollableTabs renders a responsive horizontal tab list that becomes
 * scrollable on mobile screens. It automatically scrolls the active tab
 * into view when the selection changes.
 */
export default function ScrollableTabs<T extends string>({
  tabs,
  activeTab,
  onTabChange,
  className,
  activeClassName = 'border-hockia-primary text-hockia-primary',
  inactiveClassName = 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300',
  wrapperClassName,
}: ScrollableTabsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(max-width: 768px)')
    if (!mediaQuery.matches) return

    const container = containerRef.current
    if (!container) return

    const activeButton = container.querySelector<HTMLButtonElement>(
      `[data-tab-id="${activeTab}"]`
    )

    if (activeButton) {
      activeButton.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      })
    }
  }, [activeTab])

  return (
    <div className={cn(wrapperClassName)}>
      <nav
        ref={containerRef}
        role="tablist"
        aria-orientation="horizontal"
        className={cn(
          'flex gap-6 px-4 sm:px-6 overflow-x-auto md:overflow-visible whitespace-nowrap scrollbar-hide',
          className
        )}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            data-tab-id={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id ? 'true' : 'false'}
            onClick={() => onTabChange(tab.id)}
            className={cn(
              'py-4 border-b-2 text-sm font-medium transition-colors',
              activeTab === tab.id ? activeClassName : inactiveClassName
            )}
          >
            {tab.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
