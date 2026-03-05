// Allowed origins for CORS - restrict to known domains
const ALLOWED_ORIGINS = [
  'https://www.oplayr.com',
  'https://oplayr.com',
  'https://playr-flax.vercel.app',
  'https://playr-staging.vercel.app',
  // Development origins
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
]

/** Check if an origin is allowed (static list + Vercel preview deployments). */
function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true
  try {
    const { hostname } = new URL(origin)
    if (hostname.endsWith('.vercel.app') && hostname.startsWith('playr-')) return true
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
