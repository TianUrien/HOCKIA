/**
 * Vercel Edge Function: serves the IndexNow key file.
 *
 * IndexNow accepts pings for a site only if `<site>/<key>.txt` returns the
 * key as plain text. Routed by the vercel.json rewrite `/:key.txt` (32 hex
 * characters) → `/api/indexnow-key?key=:key`. The key comes from the
 * INDEXNOW_KEY environment variable, so it is set per environment and
 * nothing is committed. Any other value, or no variable, is a 404.
 */
export const config = { runtime: 'edge' }

export default function handler(req: Request): Response {
  const asked = new URL(req.url).searchParams.get('key') ?? ''
  const key = (process.env.INDEXNOW_KEY ?? '').trim()
  if (!key || !/^[A-Za-z0-9-]{8,128}$/.test(key) || asked !== key) {
    return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } })
  }
  return new Response(key, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } })
}
