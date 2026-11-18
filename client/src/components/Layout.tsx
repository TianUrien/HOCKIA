import type { ReactNode } from 'react'
import MobileBottomNav from './MobileBottomNav'
import NotificationBridge from './NotificationBridge'
import NotificationsDrawer from './NotificationsDrawer'

interface LayoutProps {
  children: ReactNode
  className?: string
}

/** Prerender snapshot (scripts/prerender-landing.mjs): overlays must never be baked into the static landing HTML. */
const IS_PRERENDER = typeof window !== 'undefined' && (window as unknown as { __PRERENDER__?: boolean }).__PRERENDER__ === true

export default function Layout({ children, className = '' }: LayoutProps) {
  return (
    <div className="flex min-h-screen-dvh flex-col">
      <NotificationBridge />
      {!IS_PRERENDER && <NotificationsDrawer />}
      {/* Main content area */}
      <main className={`flex flex-1 min-h-0 flex-col ${className}`}>
        {children}
      </main>

      {/* Mobile Bottom Navigation - Instagram style */}
      <MobileBottomNav />
    </div>
  )
}
