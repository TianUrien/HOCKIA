import { createClient } from '@supabase/supabase-js'

/**
 * Hard-deletes the messages the smoke / messaging specs send as the E2E
 * player (walkthrough finding #3): they used to pile up as "E2E smoke
 * message" + "Message deleted" pairs in the test player's real conversations.
 * Runs as the player under RLS — the sender-delete policy
 * (20260923190000) lets an account remove its OWN rows and nothing else.
 * Skipped silently when the credentials are not in the environment.
 */
export default async function globalTeardown() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const email = process.env.E2E_PLAYER_EMAIL
  const password = process.env.E2E_PLAYER_PASSWORD
  if (!url || !key || !email || !password) return
  try {
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error || !data.user) return
    const patterns = ['E2E smoke message %', 'E2E messaging test %', 'Mobile E2E %', 'E2E edit/delete %', 'Trigger test __dbtest_%', 'Enter key test %', 'QA test msg %']
    let removed = 0
    for (const pattern of patterns) {
      const { data: rows } = await sb.from('messages').delete().eq('sender_id', data.user.id).like('content', pattern).select('id')
      removed += rows?.length ?? 0
    }
    // The soft-deleted rows the edit/delete spec leaves behind have no text left.
    const { data: blanks } = await sb.from('messages').delete().eq('sender_id', data.user.id).not('deleted_at', 'is', null).select('id')
    removed += blanks?.length ?? 0
    console.log(`[e2e teardown] removed ${removed} test message(s)`)
  } catch (err) {
    console.warn('[e2e teardown] cleanup skipped:', err instanceof Error ? err.message : err)
  }
}
