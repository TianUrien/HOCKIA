/**
 * Cloudflare Stream asset deletion, shared by video-delete, delete-account
 * and admin-actions. Best-effort: a 404 counts as deleted (already gone);
 * any other failure is logged as an orphan for reconciliation and never
 * throws, so a Cloudflare outage can't block a user-facing delete.
 */

export type StreamDeleteResult = 'deleted' | 'skipped' | 'failed'

const UID_RE = /^[0-9a-f]{32}$/i

export async function deleteStreamAsset(uid: string | null | undefined, logPrefix = '[cloudflare-stream]'): Promise<StreamDeleteResult> {
  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const apiToken = Deno.env.get('CF_STREAM_API_TOKEN')
  if (!uid || !accountId || !apiToken) return 'skipped'
  if (!UID_RE.test(uid)) {
    console.error(`${logPrefix} unexpected Stream uid format, not deleting: ${uid.slice(0, 40)}`)
    return 'failed'
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/stream/${uid}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(10_000) },
    )
    if (res.ok || res.status === 404) return 'deleted'
    const detail = await res.text().catch(() => '')
    console.error(`${logPrefix} ORPHANED Cloudflare asset cf_uid=${uid} status=${res.status} ${detail.slice(0, 300)}`)
    return 'failed'
  } catch (err) {
    console.error(`${logPrefix} ORPHANED Cloudflare asset cf_uid=${uid}`, err)
    return 'failed'
  }
}

/** Delete many assets with a small concurrency cap; returns per-outcome counts. */
export async function deleteStreamAssets(
  uids: Array<string | null | undefined>,
  logPrefix = '[cloudflare-stream]',
  concurrency = 4,
): Promise<Record<StreamDeleteResult, number>> {
  const unique = [...new Set(uids.filter((u): u is string => typeof u === 'string' && u.length > 0))]
  const counts: Record<StreamDeleteResult, number> = { deleted: 0, skipped: 0, failed: 0 }
  for (let i = 0; i < unique.length; i += concurrency) {
    const batch = unique.slice(i, i + concurrency)
    const results = await Promise.all(batch.map((uid) => deleteStreamAsset(uid, logPrefix)))
    for (const r of results) counts[r]++
  }
  return counts
}
