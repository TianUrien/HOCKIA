/**
 * Fire-and-forget device tracking.
 *
 * Upserts the user's platform into `user_devices` and updates
 * `profiles.last_platform`. Called once per browser session.
 */

import { supabase } from '@/lib/supabase'
import { detectPlatform } from '@/lib/detectPlatform'

const DEVICE_TRACKED_KEY = 'hockia-device-tracked'

export function trackUserDevice(): void {
  if (typeof window === 'undefined') return
  if (sessionStorage.getItem(DEVICE_TRACKED_KEY)) return

  const platform = detectPlatform()
  const isPwa =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true

  void Promise.resolve(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types
    (supabase.rpc as any)('track_user_device', {
      p_platform: platform,
      p_user_agent: navigator.userAgent,
      p_is_pwa: isPwa,
    })
  ).then(() => {
    sessionStorage.setItem(DEVICE_TRACKED_KEY, '1')
  }).catch(() => {})
}
