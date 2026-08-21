/**
 * NativeLaunchSplash — in-app continuation of the NATIVE LAUNCH SCREEN
 * (white mark on brand violet: ios App/Assets.xcassets/Splash.imageset +
 * android res/drawable/splash.png).
 *
 * Rendered whenever the native app must wait before it knows which screen is
 * the truth (auth hydration, redirect-in-flight). Because it is pixel-matched
 * to the system splash, the user just perceives the splash lasting a moment
 * longer — never a spinner, never a flash of the wrong screen.
 *
 * Founder spec (2026-08-17 launch-flicker fix): no unauthenticated UI may
 * paint for a signed-in member during session restoration, and the waiting
 * state must be consistent with the app's visual identity.
 */
export default function NativeLaunchSplash() {
  return (
    <div
      data-testid="native-launch-splash"
      className="flex min-h-screen-dvh w-full items-center justify-center"
      style={{ backgroundColor: '#5b21b6' }}
      aria-label="Loading HOCKIA"
    >
      <img
        src="/brand/svg/hockia-logo-white.svg"
        alt=""
        width={300}
        height={243}
        className="h-[72px] w-auto"
        draggable={false}
      />
    </div>
  )
}
