import { useEffect, useState } from 'react'
import { Capacitor } from '@capacitor/core'
import { supabase } from '@/lib/supabase'
import { getAppVersion, compareVersions, getStoreUrl } from '@/lib/appVersion'
import { logger } from '@/lib/logger'

export type UpdateStatus = 'ok' | 'soft' | 'force'

export interface AppUpdateState {
  status: UpdateStatus
  storeUrl: string
}

/**
 * Native-only update check. Compares the bundled app version against the
 * app_version_requirements config row for this platform:
 *   installed < min_version    → 'force' (blocking)
 *   installed < latest_version → 'soft'  (dismissible)
 * Web/PWA always return 'ok' (served fresh, can't be out of date).
 */
export function useAppUpdateCheck(): AppUpdateState {
  const [state, setState] = useState<AppUpdateState>({ status: 'ok', storeUrl: getStoreUrl() })

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let cancelled = false

    void (async () => {
      try {
        const installed = await getAppVersion()
        if (!installed) return

        const platform = Capacitor.getPlatform() // 'ios' | 'android'
        const { data, error } = await supabase
          .from('app_version_requirements')
          .select('min_version, latest_version, store_url')
          .eq('platform', platform)
          .maybeSingle()

        if (cancelled || error || !data) return

        let status: UpdateStatus = 'ok'
        if (compareVersions(installed.version, data.min_version) < 0) status = 'force'
        else if (compareVersions(installed.version, data.latest_version) < 0) status = 'soft'

        setState({ status, storeUrl: data.store_url || getStoreUrl() })
      } catch (err) {
        logger.error('[useAppUpdateCheck] failed:', err)
      }
    })()

    return () => { cancelled = true }
  }, [])

  return state
}
