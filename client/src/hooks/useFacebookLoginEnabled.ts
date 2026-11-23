import { useEffect, useState } from 'react'
import { facebookLoginEnabled } from '@/lib/inAppBrowser'

/**
 * Whether to show "Continue with Facebook". ON when the web build forces it
 * (VITE_ENABLE_FACEBOOK_LOGIN, staging) or the runtime switch is set
 * (app_settings 'facebook_login_enabled' via the facebook_login_enabled()
 * RPC). The runtime switch is what turns the button on in the store apps
 * without a new build. Read once per page load and shared; any failure keeps
 * the last known answer.
 *
 * The last answer is remembered on the device, so the button is there on the
 * first paint of the next visit instead of popping in a moment later when the
 * request returns (founder report 2026-11-23). The request still runs every
 * page load and corrects the remembered value.
 */
let remote: Promise<boolean | null> | null = null

const STORAGE_KEY = 'hockia.facebookLoginEnabled'

function remembered(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}

function remember(on: boolean): void {
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : '0') } catch { /* private mode: nothing to remember */ }
}

/** true / false from the server; null when the request failed (keep what we had). */
function readRemoteSwitch(): Promise<boolean | null> {
  remote ??= import('@/lib/supabase')
    .then(({ supabase }) => supabase.rpc('facebook_login_enabled'))
    .then(({ data, error }) => {
      if (error) return null
      const on = data === true
      remember(on)
      return on
    })
    .catch(() => null)
  return remote
}

/** Test seam: forget the cached answer. */
export function resetFacebookLoginSwitch(): void {
  remote = null
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* nothing stored */ }
}

export function useFacebookLoginEnabled(): boolean {
  const forced = facebookLoginEnabled()
  const [enabled, setEnabled] = useState(() => forced || remembered())
  useEffect(() => {
    if (forced) return
    let live = true
    void readRemoteSwitch().then((on) => {
      if (live && on !== null) setEnabled(on)
    })
    return () => {
      live = false
    }
  }, [forced])
  return forced || enabled
}
