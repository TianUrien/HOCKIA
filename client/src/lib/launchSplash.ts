import { Capacitor, registerPlugin } from '@capacitor/core'
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

/**
 * The artwork's BOTTOM edge colour (sampled from the 1170×2532 export: every
 * pixel of the last row is #7b39ec; the top edge is #301462, the middle is the
 * #5929a8 base). Used as the page canvas while the launch artwork is up.
 */
export const LAUNCH_CANVAS_COLOR = '#7b39ec'

/**
 * Launch canvas (white home-indicator strip fix, iOS 1.3.17).
 *
 * The iOS WKWebView runs with `ios.contentInset: 'automatic'`, so the scroll
 * view can inset the web layout viewport by the safe area. The in-app splash is
 * `position: fixed; inset: 0` — it fills the LAYOUT viewport, not the screen —
 * and whatever lies outside it (the home-indicator band) shows the page canvas:
 * WebKit paints the scroll view with the document's background colour, which
 * globals.css sets to #ffffff. Result: a white strip under the artwork until
 * the inset settles and the fixed layer grows to the full display.
 *
 * Fix: while the launch artwork is (or is about to be) on screen, the canvas
 * itself — html AND body, inline so it beats globals.css — is the artwork's
 * bottom colour. Any band outside the fixed layer is then the same violet as
 * the artwork's last row, so no white can show and nothing visibly shifts when
 * the layer resizes. Ref-counted holders:
 *  - the boot paint (main.tsx, before React's first frame), released by
 *    LaunchSplashController on the first commit;
 *  - each mounted NativeLaunchSplash, released on unmount.
 * When the last holder lets go, the inline colours are removed and the app's
 * own white canvas is back. Web: no-op (the browser owns its chrome).
 */
let canvasHolders = 0

function applyLaunchCanvas(on: boolean): void {
  if (typeof document === 'undefined') return
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue
    if (on) el.style.setProperty('background-color', LAUNCH_CANVAS_COLOR)
    else el.style.removeProperty('background-color')
  }
}

/** Take a hold on the violet launch canvas. Returns the matching release. */
export function holdLaunchCanvas(): () => void {
  if (!Capacitor.isNativePlatform()) return () => {}
  canvasHolders += 1
  if (canvasHolders === 1) applyLaunchCanvas(true)
  let released = false
  return () => {
    if (released) return
    released = true
    canvasHolders = Math.max(0, canvasHolders - 1)
    if (canvasHolders === 0) applyLaunchCanvas(false)
  }
}

let releaseBootCanvas: (() => void) | null = null

/** Boot: paint the launch canvas before React renders anything (main.tsx). */
export function paintBootLaunchCanvas(): void {
  if (releaseBootCanvas) return
  releaseBootCanvas = holdLaunchCanvas()
}

/** First commit happened: drop the boot hold (a mounted splash keeps its own). */
export function releaseBootLaunchCanvas(): void {
  releaseBootCanvas?.()
  releaseBootCanvas = null
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
      void SplashScreen.hide({ fadeOutDuration: 0 })
        .catch(() => {
          /* plugin missing or already hidden — nothing to recover */
        })
        .finally(switchToLightNativeSurface)
    })
  })
}

/**
 * iOS: once the launch artwork is gone, the violet that sits under the web
 * page (capacitor.config.ts backgroundColor, chosen so the hand-off never
 * flashes white) has done its job — switch it to white, or it shows as a strip
 * below pages that exactly fit the screen (the WKWebView's layout viewport is
 * shorter than the screen with contentInset 'automatic'). Native side:
 * ios/App/App/MainViewController.swift. Older store builds lack the plugin;
 * the call then fails quietly.
 */
const AppSurface = registerPlugin<{ applyLightSurface(): Promise<void> }>('AppSurface')

function switchToLightNativeSurface(): void {
  if (Capacitor.getPlatform() !== 'ios') return
  void AppSurface.applyLightSurface().catch(() => {
    /* older build without the plugin */
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
  canvasHolders = 0
  releaseBootCanvas = null
  applyLaunchCanvas(false)
  if (failsafe) clearTimeout(failsafe)
  failsafe = null
}
