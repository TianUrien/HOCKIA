// Allowed origins for CORS - restrict to known domains
const ALLOWED_ORIGINS = [
  'https://www.inhockia.com',
  'https://inhockia.com',
  'https://staging.inhockia.com',
  'https://hockia.vercel.app',
  'https://hockia-staging.vercel.app',
  // Development origins
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  // Native Capacitor app shells — the WKWebView/WebView Origin is a tuple
  // origin scheme://host: iOS = hockia://app.inhockia.com (Capacitor lowercases
  // the iosScheme), Android = https://app.inhockia.com, and the Capacitor
  // default (if a build ever drops the custom host) is capacitor://localhost.
  // WITHOUT these the native app's edge-function calls are CORS-blocked by the
  // WebView (it enforces CORS; there is no @capacitor/http bridge), which broke
  // HOCKIA AI + every other edge function on iOS.
  'hockia://app.inhockia.com',
  'https://app.inhockia.com',
  'capacitor://localhost',
]

/** Check if an origin is allowed (static list + Vercel preview deployments). */
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const url = new URL(origin)
    const host = url.hostname.toLowerCase()
    const scheme = url.protocol.replace(':', '').toLowerCase()
    // Vercel preview deployments
    if (host.endsWith('.vercel.app') && host.startsWith('hockia-')) return true
    // Native Capacitor app: match by HOST regardless of scheme so a scheme
    // rename/casing change (HOCKIA vs hockia) or a custom-host build can't
    // silently re-break native edge calls. CORS is not the auth boundary here
    // (verify_jwt + getUser + RLS are) — the native app is a first-party client.
    if (host === 'app.inhockia.com') return true
    if (host === 'localhost' && (scheme === 'capacitor' || scheme === 'ionic')) return true
  } catch { /* invalid URL */ }
  return false
}

/**
 * Get CORS headers with origin validation.
 * Returns the request origin if allowed, otherwise defaults to primary production domain.
 *
 * USE THIS FOR: Client-facing APIs that handle sensitive operations (auth, profile, account)
 */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin = requestOrigin && isAllowedOrigin(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0]

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Vary': 'Origin',
  }
}

/**
 * Open CORS headers that allow all origins.
 * 
 * USE THIS FOR:
 * - Public APIs intended for external consumers (public-opportunities, sitemap)
 * - Webhook handlers (notify-*) that are triggered by Supabase, not browsers
 * 
 * DO NOT USE FOR:
 * - Client-facing APIs that handle authentication or sensitive data
 * - User account operations (use getCorsHeaders instead)
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
