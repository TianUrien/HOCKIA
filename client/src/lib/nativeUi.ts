import { Capacitor } from '@capacitor/core'
import { Badge } from '@capawesome/capacitor-badge'
import { StatusBar, Style } from '@capacitor/status-bar'
import { logger } from './logger'

const isNative = (): boolean => Capacitor.isNativePlatform()

/**
 * Sync the iOS/Android app-icon badge to the unread-notification count.
 * `count <= 0` clears it. No-op on web/PWA (the OS icon badge is native-only).
 *
 * Fixes the "stuck badge": the APNs/FCM payload sets a badge when a push arrives,
 * but nothing on the client ever cleared it after the user read the notification.
 * Mirroring the live unread count here clears it the moment the count hits 0.
 */
export async function setAppBadge(count: number): Promise<void> {
  if (!isNative()) return
  try {
    const n = Math.max(0, Math.floor(Number(count) || 0))
    if (n <= 0) {
      await Badge.clear()
    } else {
      await Badge.set({ count: n })
    }
  } catch (err) {
    logger.warn('[NATIVE_UI] setAppBadge failed', err)
  }
}

/**
 * Set the native status-bar content style for the current screen's background.
 * Capacitor's `Style` names refer to the BACKGROUND the bar sits on:
 *   - 'dark-bg'  → Style.Dark  → LIGHT (white) icons — for dark screens (Landing, SignUp)
 *   - 'light-bg' → Style.Light → DARK icons          — for the white app
 * No-op on web (the browser owns its own chrome there).
 */
export async function setStatusBarForBackground(bg: 'dark-bg' | 'light-bg'): Promise<void> {
  if (!isNative()) return
  try {
    await StatusBar.setStyle({ style: bg === 'dark-bg' ? Style.Dark : Style.Light })
  } catch (err) {
    logger.warn('[NATIVE_UI] setStatusBarForBackground failed', err)
  }
}
