import { useState, useEffect, useCallback } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { detectPlatform } from '@/lib/detectPlatform'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

/** Convert a URL-safe base64 string to a Uint8Array (applicationServerKey format) */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

/** True when running inside a Capacitor native shell (iOS/Android) */
const isNative = Capacitor.isNativePlatform()

/** Web push is supported in browsers with service workers and VAPID key configured */
const isWebPushSupported =
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window &&
  !!VAPID_PUBLIC_KEY

export function usePushSubscription() {
  const { user } = useAuthStore()
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied'
  )
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)

  const isSupported = isNative || isWebPushSupported

  // Check current subscription state on mount and when user changes
  useEffect(() => {
    if (!user) {
      setIsSubscribed(false)
      return
    }

    if (isNative) {
      // For native, check if we have an FCM token stored in the database
      let cancelled = false
      supabase
        .from('push_subscriptions')
        .select('id')
        .eq('profile_id', user.id)
        .not('fcm_token', 'is', null)
        .limit(1)
        .then(({ data }) => {
          if (!cancelled) setIsSubscribed(!!data && data.length > 0)
        })
      return () => { cancelled = true }
    }

    if (!isWebPushSupported) {
      setIsSubscribed(false)
      return
    }

    let cancelled = false
    navigator.serviceWorker.ready.then((registration) => {
      registration.pushManager.getSubscription().then((sub) => {
        if (!cancelled) {
          setIsSubscribed(!!sub)
        }
      })
    })
    return () => { cancelled = true }
  }, [isSupported, user])

  // Sync permission state when it might change
  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission)
    }
  }, [isSubscribed])

  const subscribe = useCallback(async () => {
    if (!isSupported || !user) return

    setLoading(true)
    try {
      if (isNative) {
        // ---- Native (Capacitor) FCM registration ----
        const { PushNotifications } = await import('@capacitor/push-notifications')

        let permResult = await PushNotifications.checkPermissions()
        if (permResult.receive === 'prompt') {
          permResult = await PushNotifications.requestPermissions()
        }

        if (permResult.receive !== 'granted') {
          logger.info('[Push] Native permission denied')
          setPermission('denied')
          return
        }
        setPermission('granted')

        // Register will trigger the 'registration' event with the FCM token
        await PushNotifications.register()

        // Listen for the registration token
        const tokenPromise = new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('FCM registration timeout')), 15000)

          PushNotifications.addListener('registration', (token) => {
            clearTimeout(timeout)
            resolve(token.value)
          })

          PushNotifications.addListener('registrationError', (err) => {
            clearTimeout(timeout)
            reject(new Error(err.error))
          })
        })

        const fcmToken = await tokenPromise
        const platform = detectPlatform()

        // Upsert FCM token to database
        // Cast needed because fcm_token/platform columns are added via migration
        // and may not yet be in the generated types
        const { error } = await supabase
          .from('push_subscriptions')
          .upsert(
            {
              profile_id: user.id,
              fcm_token: fcmToken,
              platform,
              user_agent: navigator.userAgent,
              endpoint: `fcm:${fcmToken}`,
              p256dh: 'fcm',
              auth: 'fcm',
            } as never,
            { onConflict: 'profile_id,endpoint' }
          )

        if (error) throw error

        setIsSubscribed(true)
        logger.info('[Push] Native FCM registered', { platform })
      } else {
        // ---- Web Push (VAPID) registration ----
        if (!VAPID_PUBLIC_KEY) return

        const result = await Notification.requestPermission()
        setPermission(result)

        if (result !== 'granted') {
          logger.info('[Push] Permission denied by user')
          return
        }

        const registration = await navigator.serviceWorker.ready
        let subscription = await registration.pushManager.getSubscription()

        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
          })
        }

        const subJson = subscription.toJSON()
        const endpoint = subscription.endpoint
        const p256dh = subJson.keys?.p256dh
        const auth = subJson.keys?.auth

        if (!endpoint || !p256dh || !auth) {
          throw new Error('Invalid push subscription: missing keys')
        }

        const { error } = await supabase
          .from('push_subscriptions')
          .upsert(
            {
              profile_id: user.id,
              endpoint,
              p256dh,
              auth,
              platform: 'web',
              user_agent: navigator.userAgent,
            },
            { onConflict: 'profile_id,endpoint' }
          )

        if (error) throw error

        setIsSubscribed(true)
        logger.info('[Push] Web push subscribed')
      }
    } catch (err) {
      logger.error('[Push] Subscribe failed:', err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [isSupported, user])

  const unsubscribe = useCallback(async () => {
    if (!user) return

    setLoading(true)
    try {
      if (isNative) {
        // Remove all native subscriptions for this user
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('profile_id', user.id)
          .not('fcm_token', 'is', null)
      } else {
        // Unsubscribe from PushManager
        const registration = await navigator.serviceWorker.ready
        const subscription = await registration.pushManager.getSubscription()

        if (subscription) {
          const endpoint = subscription.endpoint
          await subscription.unsubscribe()

          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('profile_id', user.id)
            .eq('endpoint', endpoint)
        }
      }

      setIsSubscribed(false)
      logger.info('[Push] Unsubscribed successfully')
    } catch (err) {
      logger.error('[Push] Unsubscribe failed:', err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [user])

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    subscribe,
    unsubscribe,
  }
}
