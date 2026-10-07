import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

/**
 * Quiet "Sign out" for the set-up screens (release audit 2026-10-05).
 *
 * Until onboarding_completed is true the route gate sends every path —
 * /settings included — back to /complete-profile, and none of the set-up
 * screens had a way out. Someone who picked the wrong role (locked after the
 * choice) or signed in with the wrong Google account was stuck. This is the
 * one exit: the global sign-out from the auth store (which also drops the
 * pending_role / pending_email backups), then the landing page.
 *
 * `nav` = the trailing slot of a nav bar (44 pt tall, ink-3 text, no fill);
 * `footer` = a full-width text row under the primary action, for screens
 * whose trailing slot is already "Skip".
 */
export function SetupSignOut({ placement = 'nav', className }: { placement?: 'nav' | 'footer'; className?: string }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)

  const signOut = async () => {
    if (busy) return
    setBusy(true)
    try {
      await useAuthStore.getState().signOut()
    } catch (error) {
      // The store already cleared the local session before rethrowing.
      logger.error('[SETUP_SIGN_OUT] Sign out failed', error)
    } finally {
      navigate('/', { replace: true })
    }
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      disabled={busy}
      data-testid="setup-sign-out"
      className={cn(
        placement === 'nav'
          ? 'h-11 px-2 text-body text-ink-3 active:text-ink-2 disabled:opacity-40'
          : 'mt-1 flex h-11 w-full items-center justify-center text-secondary text-ink-3 active:text-ink-2 disabled:opacity-40',
        className,
      )}
    >
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  )
}
