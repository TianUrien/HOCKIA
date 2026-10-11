import type { ReactNode } from 'react'
import { useHideTabBar } from '@/lib/navChrome'
import { cn } from '@/lib/utils'

export interface ActionBarButton {
  key: string
  label: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  /** primary = brand fill; secondary = white with hairline; done = soft green (Friends / Shortlisted). */
  tone: 'primary' | 'secondary' | 'done'
  testId?: string
}

/**
 * Public profile action bar (Figma PR1 99:71): fixed at the bottom, never
 * hides; 52 pt buttons, white 92 % + blur, hairline on top. The tab bar steps
 * aside while it's shown (own profiles keep the tab bar and no action bar).
 */
export function ProfileActionBar({ buttons }: { buttons: ActionBarButton[] }) {
  const show = buttons.length > 0
  useHideTabBar(show)
  if (!show) return null
  return (
    <>
      <div aria-hidden="true" className="h-[calc(100px+env(safe-area-inset-bottom))] lg:hidden" />
      <div
        className="fixed inset-x-0 bottom-0 z-40 flex gap-2.5 border-t-[0.5px] border-line bg-[rgba(255,255,255,0.92)] px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 backdrop-blur-[12px] lg:hidden"
        data-testid="profile-action-bar"
      >
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={b.onClick}
            disabled={b.disabled}
            data-testid={b.testId}
            className={cn(
              'flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition-transform duration-300 ease-[cubic-bezier(.34,1.36,.64,1)] active:scale-[0.97] disabled:opacity-70',
              b.tone === 'primary' && 'bg-hockia-primary text-white',
              b.tone === 'secondary' && 'border border-line bg-white text-ink-1',
              b.tone === 'done' && 'bg-positive-soft text-positive',
            )}
          >
            {b.icon} {b.label}
          </button>
        ))}
      </div>
    </>
  )
}
