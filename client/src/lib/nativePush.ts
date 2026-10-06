/**
 * Native (Capacitor iOS/Android) push helpers shared by usePushSubscription,
 * the auth store and NativePushBridge.
 *
 *   registerNativePushToken     permission granted → register() → device token
 *   saveNativePushToken         upsert this device's push_subscriptions row
 *   refreshNativePushRegistration  on app start, when permission is already
 *                               granted: re-register and upsert (tokens rotate)
 *   removeThisDevicePushSubscription  on sign-out: delete ONLY this device's
 *                               row, so the next account on the phone doesn't
 *                               get the previous account's pushes
 *   safePushPath / addPushTapListener  tapping a push opens its in-app path
 *
 * This device's token is remembered in localStorage so sign-out knows which
 * row is ours (Capacitor has no "current token" getter without registering).
 */

import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

export const NATIVE_PUSH_TOKEN_KEY = 'hockia.push.nativeToken'
const REGISTRATION_TIMEOUT_MS = 15_000

function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform()
}

export function rememberNativePushToken(token: string): void {
  try { window.localStorage.setItem(NATIVE_PUSH_TOKEN_KEY, token) } catch { /* storage unavailable */ }
}

export function readNativePushToken(): string | null {
  try { return window.localStorage.getItem(NATIVE_PUSH_TOKEN_KEY) } catch { return null }
}

export function forgetNativePushToken(): void {
  try { window.localStorage.removeItem(NATIVE_PUSH_TOKEN_KEY) } catch { /* storage unavailable */ }
}

/**
 * The in-app path a push may open: a relative path starting with a single
 * "/" (never "//host", "/\host" or an absolute URL). Anything else → null.
 */
export function safePushPath(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const value = url.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null
  // Reject control characters (and anything the URL parser would move off-origin).
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) < 0x20) return null
  }
  return value
}

/**
 * Register with APNs/FCM and resolve the device token. Listeners are attached
 * (and awaited) BEFORE register(), otherwise the 'registration' event can fire
 * first and be missed.
 */
export async function registerNativePushToken(): Promise<string> {
  const { PushNotifications } = await import('@capacitor/push-notifications')
  let resolveToken!: (value: string) => void
  let rejectToken!: (err: Error) => void
  const tokenPromise = new Promise<string>((resolve, reject) => {
    resolveToken = resolve
    rejectToken = reject
  })
  const timeout = setTimeout(() => rejectToken(new Error('Push registration timeout')), REGISTRATION_TIMEOUT_MS)

  const regHandle = await PushNotifications.addListener('registration', (token) => {
    clearTimeout(timeout)
    resolveToken(token.value)
  })
  const errHandle = await PushNotifications.addListener('registrationError', (err) => {
    clearTimeout(timeout)
    rejectToken(new Error(err.error))
  })

  try {
    await PushNotifications.register()
    return await tokenPromise
  } finally {
    clearTimeout(timeout)
    await regHandle.remove()
    await errHandle.remove()
  }
}

/** Upsert this device's row and remember its token. */
export async function saveNativePushToken(userId: string, token: string): Promise<void> {
  // Authoritative native platform ('ios' | 'android'): send-push routes on it
  // (ios → APNs, android → FCM).
  const platform = Capacitor.getPlatform()
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert(
      {
        profile_id: userId,
        fcm_token: token,
        platform,
        user_agent: navigator.userAgent,
        endpoint: `fcm:${token}`,
        p256dh: 'fcm',
        auth: 'fcm',
      } as never,
      { onConflict: 'profile_id,endpoint' }
    )
  if (error) throw error
  rememberNativePushToken(token)
}

/**
 * App start: when the member already granted permission, re-register and
 * upsert the (possibly rotated) token. Never prompts. Returns true when a
 * token was saved.
 */
export async function refreshNativePushRegistration(userId: string): Promise<boolean> {
  if (!isNativePlatform() || !userId) return false
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const { receive } = await PushNotifications.checkPermissions()
    if (receive !== 'granted') return false
    const token = await registerNativePushToken()
    await saveNativePushToken(userId, token)
    return true
  } catch (err) {
    logger.warn('[Push] Native refresh failed', err)
    return false
  }
}

/**
 * Sign-out: delete this device's push_subscriptions row while the session is
 * still valid (RLS: members manage their own rows). Never throws.
 */
export async function removeThisDevicePushSubscription(userId: string | null | undefined): Promise<void> {
  if (!isNativePlatform() || !userId) return
  const token = readNativePushToken()
  if (!token) return
  try {
    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('profile_id', userId)
      .eq('fcm_token', token)
    if (error) throw error
    forgetNativePushToken()
  } catch (err) {
    logger.warn('[Push] Could not remove this device on sign-out', err)
  }
}

/**
 * Tapping a push opens the path it carries (data.url, set by send-push).
 * Returns a disposer. Native only; a no-op elsewhere.
 */
export async function addPushTapListener(navigate: (to: string) => void): Promise<() => void> {
  if (!isNativePlatform()) return () => {}
  const { PushNotifications } = await import('@capacitor/push-notifications')
  const handle = await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action?.notification?.data ?? {}) as Record<string, unknown>
    const path = safePushPath(data.url)
    if (path) navigate(path)
  })
  return () => { void handle.remove() }
}
