import { useCallback, type SyntheticEvent } from 'react'
import { hideNativeSplash, LAUNCH_ARTWORK_URL } from '@/lib/launchSplash'

/**
 * NativeLaunchSplash — in-app continuation of the NATIVE LAUNCH SCREEN.
 *
 * Artwork: Figma "01-E · First run — Violet editorial" (node 83:1680), the
 * SAME image the OS shows as the launch screen (ios Splash.imageset, android
 * drawable/splash). Rendered full-bleed with cover scaling and centre anchor —
 * the lockup stays centred and whole on every aspect ratio; only the gradient
 * bleed and the decorative stick crop at the edges. Nothing is recreated or
 * overlaid: the artwork already contains the complete design.
 *
 * Rendered whenever the native app must wait before it knows which screen is
 * the truth (auth hydration, redirect-in-flight, lazy chunk). Because it is
 * pixel-matched to the native splash, the user just perceives the launch
 * screen lasting a moment longer — never a spinner, never a wrong screen.
 *
 * When the image has decoded it tells the native layer it can go
 * (lib/launchSplash) — that is the ONLY thing that ends the native splash on
 * a launch that lands here, so the hand-off is continuous and never timed.
 */
export default function NativeLaunchSplash() {
  // `load` fires when the bytes are in, not when the bitmap is ready to
  // paint — releasing the native layer on `load` alone showed one flat-violet
  // frame on slower devices (iPhone SE, simulator burst 2026-08-21). Wait for
  // decode(); a broken image releases too, so nobody is ever trapped.
  const onLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const release = () => hideNativeSplash()
    if (typeof img.decode === 'function') void img.decode().then(release, release)
    else release()
  }, [])
  const onError = useCallback(() => hideNativeSplash(), [])
  return (
    <div
      data-testid="native-launch-splash"
      className="fixed inset-0 z-[9995] overflow-hidden"
      style={{ backgroundColor: '#5929a8' }}
      aria-label="Loading HOCKIA"
    >
      <img
        src={LAUNCH_ARTWORK_URL}
        alt=""
        width={1170}
        height={2532}
        decoding="sync"
        fetchPriority="high"
        draggable={false}
        onLoad={onLoad}
        onError={onError}
        className="absolute inset-0 h-full w-full max-w-none select-none object-cover object-center"
      />
    </div>
  )
}
