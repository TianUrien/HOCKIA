import { Capacitor } from '@capacitor/core'
import { SplashScreen } from '@capacitor/splash-screen'

/**
 * Native launch-splash hand-off.
 *
 * capacitor.config.ts sets `launchAutoHide: false`, so the native artwork
 * (01-E · First run — Violet editorial) stays on screen for exactly as long as
 * the app genuinely needs to boot — until the web app has PAINTED its first
 * frame — and not one fixed millisecond longer. Two callers report readiness:
 *
 *  - NativeLaunchSplash: when its (identical) artwork has decoded, so the
 *    native → web hand-off is pixel-continuous.
 *  - RootApp: when React's first commit rendered a real destination directly
 *    (no in-app splash in the tree), so there is nothing to wait for.
 *
 * `hideNativeSplash` is idempotent; on the web it is a no-op.
 *
 * The failsafe is NOT a delay: it only fires if neither caller reported within
 * a generous bound (a broken image, a thrown render), so a user can never be
 * trapped behind the native splash. On a healthy launch it never fires.
 */
const FAILSAFE_MS = 4000

/** The in-app splash artwork — same file NativeLaunchSplash renders. */
export const LAUNCH_ARTWORK_URL = '/native/launch-editorial.webp'

let warmed: HTMLImageElement | null = null

/**
 * Fetch AND decode the in-app splash artwork before React mounts, so that
 * when NativeLaunchSplash renders, its <img> resolves from the image cache
 * already decoded and paints on its first frame. Without this, a slow
 * device can show the splash's background colour for a frame between the
 * native layer going away and the bitmap landing (seen once on an API 36
 * emulator with software rendering). Web: no-op. Failures are ignored —
 * NativeLaunchSplash still waits for its own decode() before releasing.
 */
export function warmLaunchArtwork(): void {
  if (warmed || !Capacitor.isNativePlatform() || typeof Image === 'undefined') return
  const img = new Image()
  img.decoding = 'sync'
  img.src = LAUNCH_ARTWORK_URL
  if (typeof img.decode === 'function') img.decode().catch(() => { /* handled by the splash itself */ })
  warmed = img // keep a reference so the cache entry is not evicted before use
}

let hidden = false
let failsafe: ReturnType<typeof setTimeout> | null = null

export function hideNativeSplash(): void {
  if (hidden) return
  hidden = true
  if (failsafe) {
    clearTimeout(failsafe)
    failsafe = null
  }
  if (!Capacitor.isNativePlatform()) return
  // Two frames: the DOM the caller saw committed must actually be on screen
  // before the native layer above it goes away.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {
        /* plugin missing or already hidden — nothing to recover */
      })
    })
  })
}

export function armLaunchSplashFailsafe(): void {
  if (hidden || failsafe || !Capacitor.isNativePlatform()) return
  failsafe = setTimeout(() => {
    failsafe = null
    hideNativeSplash()
  }, FAILSAFE_MS)
}

/** Test-only: reset module state between cases. */
export function __resetLaunchSplashForTests(): void {
  hidden = false
  warmed = null
  if (failsafe) clearTimeout(failsafe)
  failsafe = null
}
