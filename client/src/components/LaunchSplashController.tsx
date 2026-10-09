import { useEffect } from 'react'
import { armLaunchSplashFailsafe, hideNativeSplash, releaseBootLaunchCanvas } from '@/lib/launchSplash'

/**
 * Decides, on React's FIRST commit, whether the native launch splash can go.
 *
 * Mounted as the last sibling of <App/> so its effect runs after the whole
 * app subtree is in the DOM:
 *  - if the first frame contains the in-app NativeLaunchSplash, that
 *    component ends the native splash itself once its artwork has decoded
 *    (pixel-continuous hand-off) — we only arm the failsafe here;
 *  - otherwise the first frame IS the destination (e.g. a route with no
 *    auth wait), so the native splash is released right away.
 *
 * Either way the boot-time violet page canvas (lib/launchSplash) is dropped
 * here: a mounted NativeLaunchSplash already holds its own (its layout effect
 * runs before this passive effect), and a real destination brings its own.
 */
export default function LaunchSplashController() {
  useEffect(() => {
    armLaunchSplashFailsafe()
    if (!document.querySelector('[data-testid="native-launch-splash"]')) hideNativeSplash()
    releaseBootLaunchCanvas()
  }, [])
  return null
}
