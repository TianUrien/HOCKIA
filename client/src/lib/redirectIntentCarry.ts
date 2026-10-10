import { supabase } from '@/lib/supabase'
import { consumeRedirectIntent, POST_AUTH_NEXT_KEY } from '@/lib/redirectIntent'

/** consumeRedirectIntent + clearing the account-carried destination after
 *  first use (best effort: a stale value is re-validated and single-use). */
export function consumeCarriedRedirect(user: Parameters<typeof consumeRedirectIntent>[0]): string | null {
  return consumeRedirectIntent(user, () => {
    supabase.auth.updateUser({ data: { [POST_AUTH_NEXT_KEY]: null } }).catch(() => {
      /* best effort */
    })
  })
}
