/**
 * IndexNow pings for role pages (AI search visibility, 2026-11-18).
 *
 * IndexNow tells Bing (and through it ChatGPT search and Copilot) that a URL
 * changed, so a newly published role is read within hours and a closed one
 * is dropped. Only the role's public URL is sent: no member data.
 *
 * Off unless INDEXNOW_KEY is set for the project. The key is not a secret
 * (the protocol requires it to be readable at `<site>/<key>.txt`), but the
 * site must serve that file before pings are accepted; see
 * docs/engineering/operations.md.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

export interface StatusChange {
  type: 'INSERT' | 'UPDATE'
  record: { id: string; status?: string | null }
  old_record: { status?: string | null } | null
}

/** 'published' when a role becomes open, 'closed' when it stops being open, else null. */
export function roleVisibilityChange(change: StatusChange): 'published' | 'closed' | null {
  const now = change.record.status
  const before = change.type === 'UPDATE' ? change.old_record?.status ?? null : null
  if (now === 'open' && before !== 'open') return 'published'
  if (change.type === 'UPDATE' && before === 'open' && now !== 'open') return 'closed'
  return null
}

/** Keys are 8 to 128 characters: letters, digits and dashes (IndexNow protocol). */
export function isValidIndexNowKey(key: string | undefined | null): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9-]{8,128}$/.test(key)
}

export function indexNowBody(siteUrl: string, key: string, paths: string[]): { host: string; key: string; keyLocation: string; urlList: string[] } {
  const origin = new URL(siteUrl).origin
  return {
    host: new URL(origin).host,
    key,
    keyLocation: `${origin}/${key}.txt`,
    urlList: paths.map((p) => `${origin}${p.startsWith('/') ? p : `/${p}`}`),
  }
}

export type IndexNowResult = { sent: false; reason: 'no-key' | 'no-urls' } | { sent: true; status: number } | { sent: false; reason: 'error'; detail: string }

/**
 * Sends the URLs to IndexNow. Never throws and never blocks for long: a
 * failed ping only delays discovery, the sitemap still lists the role.
 */
export async function pingIndexNow(
  siteUrl: string,
  paths: string[],
  opts: { key?: string | null; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<IndexNowResult> {
  const key = opts.key
  if (!isValidIndexNowKey(key)) return { sent: false, reason: 'no-key' }
  if (paths.length === 0) return { sent: false, reason: 'no-urls' }
  const doFetch = opts.fetchImpl ?? fetch
  try {
    const res = await doFetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(indexNowBody(siteUrl, key, paths)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 4000),
    })
    await res.body?.cancel()
    return { sent: true, status: res.status }
  } catch (err) {
    return { sent: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) }
  }
}
