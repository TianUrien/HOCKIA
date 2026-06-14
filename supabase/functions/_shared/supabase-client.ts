import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import type { Database } from './database.types.ts'

/**
 * Lazy singleton Supabase service-role client.
 *
 * Edge functions run with `per_worker` policy — the Deno isolate persists
 * across requests within the same worker. Creating the client once at module
 * scope (lazily) avoids re-initializing the SDK on every invocation.
 *
 * Auth features are disabled because they are browser-only and add unnecessary
 * overhead in a server context.
 */
let _client: SupabaseClient<Database> | null = null

export function getServiceClient(): SupabaseClient<Database> {
  if (!_client) {
    const url = Deno.env.get('SUPABASE_URL')!
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    _client = createClient<Database>(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return _client
}
