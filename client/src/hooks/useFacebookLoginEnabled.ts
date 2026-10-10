import { useEffect, useState } from 'react'
import { facebookLoginEnabled } from '@/lib/inAppBrowser'

/**
 * Whether to show "Continue with Facebook". ON when the web build forces it
 * (VITE_ENABLE_FACEBOOK_LOGIN, staging) or the runtime switch is set
 * (app_settings 'facebook_login_enabled' via the facebook_login_enabled()
 * RPC). The runtime switch is what turns the button on in the store apps
 * without a new build. Read once per page load and shared; any failure keeps
 * the button hidden.
 */
let remote: Promise<boolean> | null = null

function readRemoteSwitch(): Promise<boolean> {
  remote ??= import('@/lib/supabase')
    .then(({ supabase }) => supabase.rpc('facebook_login_enabled'))
    .then(({ data, error }) => !error && data === true)
    .catch(() => false)
  return remote
}

/** Test seam: forget the cached answer. */
export function resetFacebookLoginSwitch(): void {
  remote = null
}

export function useFacebookLoginEnabled(): boolean {
  const forced = facebookLoginEnabled()
  const [enabled, setEnabled] = useState(forced)
  useEffect(() => {
    if (forced) return
    let live = true
    void readRemoteSwitch().then((on) => {
      if (live) setEnabled(on)
    })
    return () => {
      live = false
    }
  }, [forced])
  return forced || enabled
}
