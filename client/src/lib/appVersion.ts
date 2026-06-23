/**
 * App version + runtime detection, and the version-comparison used by the
 * in-app update check. Native (iOS/Android) builds have a real bundled version
 * that can fall behind the store; the web/PWA is always served fresh.
 */

import { Capacitor } from '@capacitor/core'

export type RuntimePlatform = 'ios-native' | 'android-native' | 'pwa' | 'web'

/** What the app is actually running as right now. */
export function getRuntimePlatform(): RuntimePlatform {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'ios' ? 'ios-native' : 'android-native'
  }
  // Installed PWA = launched in standalone display mode (or iOS Safari's flag).
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as { standalone?: boolean }) : undefined
  const standalone =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(display-mode: standalone)').matches || nav?.standalone === true)
  return standalone ? 'pwa' : 'web'
}

export const PLATFORM_LABEL: Record<RuntimePlatform, string> = {
  'ios-native': 'iOS app',
  'android-native': 'Android app',
  'pwa': 'Web app (installed)',
  'web': 'Web (browser)',
}

export interface AppVersionInfo {
  version: string // marketing version, e.g. "1.3.2"
  build: string // build number, e.g. "12"
}

/** Bundled app version/build — native only (web/PWA return null, always latest). */
export async function getAppVersion(): Promise<AppVersionInfo | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    return { version: info.version, build: info.build }
  } catch {
    return null
  }
}

/** Which Supabase backend the build points at — surfaced in the About card. */
export function getEnvironment(): 'production' | 'staging' | 'development' {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ''
  if (url.includes('xtertgftujnebubxgqit')) return 'production'
  if (url.includes('ivjkdaylalhsteyyclvl')) return 'staging'
  return 'development'
}

/** The store URL for the current native platform (used by "Update now"). */
export function getStoreUrl(): string {
  return Capacitor.getPlatform() === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.inhockia.app'
    : 'https://apps.apple.com/app/hockia/id6760937891'
}

/**
 * Compare two dot-separated versions ("1.3.2" vs "1.3.10").
 * Returns -1 if a < b, 0 if equal, 1 if a > b. Missing segments count as 0.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0)
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff < 0 ? -1 : 1
  }
  return 0
}
