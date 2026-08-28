/**
 * Mounts the native deep-link router and the one-time Install Referrer
 * capture. Renders nothing; native only.
 *
 * Cold start: App.getLaunchUrl() → navigate. Warm: appUrlOpen events.
 * Both record the touch first so a tagged link that opens the app is the
 * session's source (and, on a fresh install, the first touch upgrade).
 */

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { App } from '@capacitor/app'
import type { PluginListenerHandle } from '@capacitor/core'
import { IS_NATIVE } from '@/lib/isNative'
import { resolveDeepLink } from '@/lib/deepLinkRouter'
import { recordDeepLinkTouch } from '@/lib/attribution'
import { captureInstallReferrer } from '@/lib/installReferrer'
import { logger } from '@/lib/logger'

export default function NativeDeepLinkRouter() {
  const navigate = useNavigate()

  useEffect(() => {
    if (!IS_NATIVE) return
    let handle: PluginListenerHandle | null = null
    let disposed = false

    const open = (url: string | null | undefined) => {
      const target = resolveDeepLink(url)
      if (!target) return
      recordDeepLinkTouch(target.url)
      navigate(target.to)
    }

    void captureInstallReferrer()

    App.getLaunchUrl()
      .then((launch) => { if (!disposed) open(launch?.url) })
      .catch((err) => logger.warn('[deepLink] getLaunchUrl failed', err))

    App.addListener('appUrlOpen', (event) => open(event.url))
      .then((h) => { if (disposed) void h.remove(); else handle = h })
      .catch((err) => logger.warn('[deepLink] listener failed', err))

    return () => {
      disposed = true
      if (handle) void handle.remove()
    }
  }, [navigate])

  return null
}
