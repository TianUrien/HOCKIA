/**
 * Android system Back (button or gesture) inside the native app.
 *
 * Without a listener, Capacitor sends Back straight to the WebView history,
 * so with a sheet or modal open the screen behind it navigated away and the
 * overlay was left behind (seen on the device lab, 2026-11-21). Back now
 * closes the topmost overlay first, the way Escape does on the web: every
 * overlay already registers a focus trap and closes on Escape only when it
 * is the top one, so one Back closes one layer. With no overlay open, Back
 * navigates as before, and at the first screen it sends the app to the
 * background.
 *
 * Registering a `backButton` listener turns Capacitor's own handling off, so
 * this module owns all three cases.
 */
import { Capacitor } from '@capacitor/core'
import { activeFocusTrapCount } from '@/hooks/useFocusTrap'
import { logger } from '@/lib/logger'

/** How long an overlay gets to close before Back falls through to navigation. */
const CLOSE_GRACE_MS = 350

export interface BackDeps {
  overlayCount: () => number
  /** Ask the top overlay to close (an Escape key press). */
  pressEscape: () => void
  goBack: () => void
  leaveApp: () => void
  wait: (ms: number) => Promise<void>
}

/**
 * One Back press. Returns what was done, for tests and logs.
 * An overlay that does not react to Escape must not trap the member, so after
 * a short wait Back falls through to navigation (what it did before).
 */
export async function handleNativeBack(canGoBack: boolean, deps: BackDeps): Promise<'closed-overlay' | 'navigated' | 'left-app'> {
  const open = deps.overlayCount()
  if (open > 0) {
    deps.pressEscape()
    await deps.wait(CLOSE_GRACE_MS)
    if (deps.overlayCount() < open) return 'closed-overlay'
  }
  if (canGoBack) { deps.goBack(); return 'navigated' }
  deps.leaveApp()
  return 'left-app'
}

let overlaysWithoutTrap = 0

/**
 * For an overlay that closes on Escape but holds no focus trap (the Hockia AI
 * sheet keeps focus free so the page behind stays usable on desktop). It
 * counts itself here while open, so Back closes it like any other overlay.
 * Returns the function that takes it off the count.
 */
export function registerBackOverlay(): () => void {
  overlaysWithoutTrap += 1
  let done = false
  return () => { if (!done) { done = true; overlaysWithoutTrap -= 1 } }
}

/** Every overlay Back should close before it navigates. */
export function backOverlayCount(): number {
  return activeFocusTrapCount() + overlaysWithoutTrap
}

function pressEscape(): void {
  // From the focused element (inside the top overlay) so element-level and
  // document-level key handlers both see it.
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
}

let started = false

/** Call once at startup. Android only: iOS has no system Back. */
export function initNativeBack(): void {
  if (started || Capacitor.getPlatform() !== 'android') return
  started = true
  void import('@capacitor/app')
    .then(({ App }) => {
      let busy = false
      void App.addListener('backButton', ({ canGoBack }) => {
        // A second press while the first is settling would skip a layer.
        if (busy) return
        busy = true
        void handleNativeBack(canGoBack, {
          overlayCount: backOverlayCount,
          pressEscape,
          goBack: () => window.history.back(),
          leaveApp: () => { void App.minimizeApp() },
          wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        }).catch((err) => logger.error('[nativeBack] back failed', err)).finally(() => { busy = false })
      })
    })
    .catch((err) => logger.error('[nativeBack] not started', err))
}
