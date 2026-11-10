/**
 * Vercel Edge Function: the visitor's country as Vercel reads it from the
 * connection (x-vercel-ip-country), e.g. {"country":"NZ"}. Nothing else is
 * read, logged or stored, and the answer is never cached (founder
 * 2026-11-09). The app uses it only to suggest a country on the Home
 * "Which country are you based in?" card; the member confirms or picks
 * another, and nothing is saved without them.
 *
 * The native apps call it cross-origin (capacitor://localhost on iOS,
 * https://localhost on Android), so those origins get CORS headers.
 */
export const config = { runtime: 'edge' }

const NATIVE_ORIGINS = new Set(['capacitor://localhost', 'ionic://localhost', 'https://localhost', 'http://localhost'])

export default function handler(req: Request): Response {
  const origin = req.headers.get('origin')
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'cache-control': 'private, no-store',
  }
  if (origin && NATIVE_ORIGINS.has(origin)) {
    headers['access-control-allow-origin'] = origin
    headers['access-control-allow-methods'] = 'GET, OPTIONS'
    headers.vary = 'Origin'
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers })
  const raw = (req.headers.get('x-vercel-ip-country') ?? '').trim().toUpperCase()
  const country = /^[A-Z]{2}$/.test(raw) && raw !== 'XX' ? raw : null
  return new Response(JSON.stringify({ country }), { status: 200, headers })
}
