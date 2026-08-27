/**
 * storage-cleanup — drains public.storage_cleanup_queue through the Storage
 * API.
 *
 * WHY THIS EXISTS (audit 2026-08-27): the original drain,
 * public.process_storage_cleanup_queue(), ran `DELETE FROM storage.objects`
 * from pg_cron. Supabase forbids direct deletes on the storage tables
 * ("Direct deletion from storage tables is not allowed. Use the storage
 * API"), so every row failed, every night, forever — 68 rows on prod at 158
 * attempts each. Orphaned avatars, gallery photos and hard-deleted post
 * images were never removed: storage cost, and deleted content stayed
 * reachable by URL.
 *
 * Contract (mirrors the SQL function it replaces):
 *  - only rows queued for at least GRACE_DAYS are eligible (time to catch a
 *    wrong enqueue before a file is gone for good);
 *  - rows that failed MAX_ATTEMPTS times are left alone for a human;
 *  - each object is removed via storage.from(bucket).remove([path]);
 *    "not found" counts as success (the goal is "gone", not "deleted by us");
 *  - success → processed_at set, last_error cleared; failure → attempts+1,
 *    last_error set. Never throws for a single bad row.
 *
 * Invoked daily by pg_cron (net.http_post, service_role bearer) and
 * manually with the same bearer. Any other caller gets 401.
 */
import { getServiceClient } from '../_shared/supabase-client.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { assertServiceRole } from '../_shared/webhook-auth.ts'
import { captureException } from '../_shared/sentry.ts'

const GRACE_DAYS = 7
const MAX_ATTEMPTS = 200
const BATCH = 200

type QueueRow = {
  id: string
  bucket_id: string
  object_path: string
  attempts: number
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const unauthorized = assertServiceRole(req)
  if (unauthorized) return unauthorized

  const supabase = getServiceClient()
  const nowIso = new Date().toISOString()
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString()

  const { data: rows, error: selectError } = await supabase
    .from('storage_cleanup_queue')
    .select('id, bucket_id, object_path, attempts')
    .is('processed_at', null)
    .lt('queued_at', cutoff)
    .lt('attempts', MAX_ATTEMPTS)
    .order('queued_at', { ascending: true })
    .limit(BATCH)

  if (selectError) {
    captureException(selectError, { tags: { fn: 'storage-cleanup', step: 'select' } })
    return json({ error: 'select failed' }, 500)
  }

  let removed = 0
  let failed = 0
  for (const row of (rows ?? []) as QueueRow[]) {
    const { error: removeError } = await supabase.storage.from(row.bucket_id).remove([row.object_path])
    // Storage returns no error for missing objects in most cases; when it
    // does surface one, "not found" still means the goal state is reached.
    const notFound = removeError && /not found|does not exist/i.test(removeError.message)
    if (!removeError || notFound) {
      await supabase
        .from('storage_cleanup_queue')
        .update({ processed_at: nowIso, updated_at: nowIso, last_error: null })
        .eq('id', row.id)
      removed++
    } else {
      await supabase
        .from('storage_cleanup_queue')
        .update({ attempts: row.attempts + 1, last_error: removeError.message.slice(0, 500), updated_at: nowIso })
        .eq('id', row.id)
      failed++
    }
  }

  return json({ eligible: rows?.length ?? 0, removed, failed })
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
