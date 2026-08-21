import { Capacitor } from '@capacitor/core'

// Dev-only preview: `?native=1` renders the native experience in a browser so
// the screens can be reviewed without a device build. Ignored in production
// (import.meta.env.DEV is false there), so it can never leak to the website.
export const IS_NATIVE =
  Capacitor.isNativePlatform() ||
  (import.meta.env.DEV && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('native') === '1')
