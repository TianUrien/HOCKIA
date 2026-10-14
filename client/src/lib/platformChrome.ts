import { getRuntimePlatform } from '@/lib/appVersion'

/**
 * Which platform chrome the phone UI wears. The Android app follows the
 * Figma Android variants (P14 Community, H6 Home, PR1-A/PR7-A Profile,
 * file t24oVtBpZ0m24rs4TcSyTf): a Material 3 navigation bar with a pill
 * indicator and the Material back arrow without a label. Everything else
 * (iPhone app, web, PWA) keeps the iOS chrome, which is the source of truth.
 *
 * Decided once per page load: the platform never changes underneath a
 * session, and a constant keeps every header and the tab bar in agreement.
 *
 * Preview on the web: `localStorage.setItem('hockia-chrome', 'android')`
 * (or 'ios' to force the iOS chrome inside the Android app), then reload.
 */
export function isAndroidChrome(): boolean {
  try {
    const override = window.localStorage.getItem('hockia-chrome')
    if (override === 'android') return true
    if (override === 'ios') return false
  } catch {
    // Storage can be blocked (private mode, embedded views): fall through.
  }
  return getRuntimePlatform() === 'android-native'
}

export const ANDROID_CHROME = isAndroidChrome()
