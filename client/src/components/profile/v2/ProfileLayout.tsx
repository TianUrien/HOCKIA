import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { ProfileActionBar, type ActionBarButton } from './ProfileActionBar'

/**
 * Profile v2 layout (Figma PR24 138:1044). Phone: one column — hero, then the
 * scroll, with the fixed action bar. Desktop (≥ 1024): body max 1200 centred;
 * the hero becomes a sticky photo card on the left (360 wide at 1024–1279,
 * 480 from 1280) with the actions under it, and the same anchors, sections
 * and order run in the right column (fluid, 680 from 1280).
 */
export function ProfileLayout({ hero, actions = [], children }: { hero: ReactNode; actions?: ActionBarButton[]; children: ReactNode }) {
  return (
    <div className="lg:mx-auto lg:grid lg:max-w-[1200px] lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-6 lg:pt-2 xl:grid-cols-[480px_680px] xl:justify-center">
      <aside className="lg:sticky lg:top-24">
        <div className="lg:overflow-hidden lg:rounded-[24px]">{hero}</div>
        {actions.length > 0 && (
          <div className="hidden gap-2.5 pt-4 lg:flex" data-testid="profile-actions-desktop">
            {actions.map((b) => (
              <button
                key={b.key}
                type="button"
                onClick={b.onClick}
                disabled={b.disabled}
                className={cn(
                  'flex h-[52px] flex-1 items-center justify-center gap-2 rounded-full text-[16px] font-semibold transition-transform duration-300 active:scale-[0.97] disabled:opacity-70',
                  b.tone === 'primary' && 'bg-hockia-primary text-white',
                  b.tone === 'secondary' && 'border border-line bg-white text-ink-1',
                  b.tone === 'done' && 'bg-positive-soft text-positive',
                )}
              >
                {b.icon} {b.label}
              </button>
            ))}
          </div>
        )}
      </aside>
      <div className="min-w-0">{children}</div>
      <ProfileActionBar buttons={actions} />
    </div>
  )
}
