import { useEffect, useState } from 'react'
import { useAuthStore } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useCommonT } from '@/i18n/ns/common'
import { helpScreen, hockiaHelpRoute, readHelpProfileId, trackHelpShown, type HelpMoment } from '@/lib/hockiaHelp'

interface HockiaHelpLineProps {
  moment: HelpMoment
  /** Inside the router: pass navigate. Without it (an error screen) the page loads the chat itself. */
  onNavigate?: (route: string) => void
  className?: string
}

/**
 * One line, "Not working? Ask Hockia", that opens a chat with the Hockia
 * account (founder 2026-11-21). Shown only to a signed-in member, only when a
 * help account is set, and never to that account itself. Neutral tone: it is
 * an offer of help, not something the member must do, so no amber.
 */
export function HockiaHelpLine({ moment, onNavigate, className }: HockiaHelpLineProps) {
  const t = useCommonT()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [helpId, setHelpId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = typeof window === 'undefined' ? '' : helpScreen(window.location.pathname)

  useEffect(() => {
    if (!userId) return
    let live = true
    void readHelpProfileId().then((id) => { if (live) setHelpId(id) })
    return () => { live = false }
  }, [userId])

  const visible = Boolean(userId && helpId && helpId !== userId)
  useEffect(() => { if (visible) trackHelpShown(moment, screen) }, [visible, moment, screen])
  if (!visible || !userId || !helpId) return null

  const question = moment === 'search_empty' || moment === 'ai_no_result' ? t('hockiaHelp.cantFind') : moment === 'settings_help' || moment === 'feedback_form' ? t('hockiaHelp.question') : t('hockiaHelp.notWorking')
  const open = async () => {
    setBusy(true)
    try {
      const route = await hockiaHelpRoute(userId, helpId, moment, screen, `${t('hockiaHelp.draft', { screen })}\n`)
      if (onNavigate) onNavigate(route)
      else window.location.assign(route)
    } catch {
      // The chat could not be prepared: open the composer for the account anyway.
      const route = `/messages?new=${helpId}`
      if (onNavigate) onNavigate(route)
      else window.location.assign(route)
    } finally {
      setBusy(false)
    }
  }

  return (
    <p className={cn('text-[15px] leading-[1.4] text-ink-2', className)} data-testid="hockia-help-line" data-moment={moment}>
      {question}{' '}
      <button type="button" onClick={() => void open()} disabled={busy} className="inline-flex min-h-[44px] items-center font-semibold text-brand-primary underline-offset-2 hover:underline disabled:opacity-60" data-testid="hockia-help-ask">
        {t('hockiaHelp.ask')}
      </button>
    </p>
  )
}
