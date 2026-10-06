/**
 * Native push glue. Renders nothing; native only.
 *
 *  - Tapping a push opens the in-app path it carries (same-origin relative
 *    paths only, see lib/nativePush safePushPath).
 *  - When a member is signed in and notification permission is already
 *    granted, the device re-registers on app start and upserts its token
 *    (APNs/FCM tokens rotate; a stale row would silently stop pushes).
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { IS_NATIVE } from '@/lib/isNative'
import { useAuthStore } from '@/lib/auth'
import { addPushTapListener, refreshNativePushRegistration } from '@/lib/nativePush'
import { logger } from '@/lib/logger'

export default function NativePushBridge() {
  const navigate = useNavigate()
  const userId = useAuthStore((s) => s.user?.id ?? null)

  useEffect(() => {
    if (!IS_NATIVE) return
    let dispose: (() => void) | null = null
    let disposed = false
    addPushTapListener((to) => navigate(to))
      .then((d) => { if (disposed) d(); else dispose = d })
      .catch((err) => logger.warn('[Push] tap listener failed', err))
    return () => {
      disposed = true
      if (dispose) dispose()
    }
  }, [navigate])

  useEffect(() => {
    if (!IS_NATIVE || !userId) return
    void refreshNativePushRegistration(userId)
  }, [userId])

  return null
}
