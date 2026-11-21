import { useEffect, useState } from 'react'
import { useInRouterContext, useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { useCommonT } from '@/i18n/ns/common'
import { helpScreen, hockiaHelpRoute, readHelpProfileId, trackHelpShown, type HelpMoment } from '@/lib/hockiaHelp'

interface HockiaHelpLineProps {
  moment: HelpMoment
  /**
   * Load the chat as a fresh page instead of navigating inside the app. For
   * the "Something went wrong" screens only: what is on screen has already
   * failed, so a clean start is the point. Everywhere else the line navigates
   * with the router and keeps what the member has open or typed.
   */
  hard?: boolean
  className?: string
}

/**
 * One line, "Not working? Ask Hockia", that opens a chat with the Hockia
 * account (founder 2026-11-21). Shown only to a signed-in member who can open
 * that chat right now (the server decides), and never to the account itself.
 * Neutral tone: it is an offer of help, not something the member must do, so
 * no amber.
 */
export function HockiaHelpLine({ moment, hard = false, className }: HockiaHelpLineProps) {
  const inRouter = useInRouterContext()
  return inRouter && !hard ? <RoutedLine moment={moment} className={className} /> : <Line moment={moment} className={className} go={(route) => window.location.assign(route)} />
}

function RoutedLine({ moment, className }: { moment: HelpMoment; className?: string }) {
  const navigate = useNavigate()
  return <Line moment={moment} className={className} go={(route) => navigate(route)} />
}

function Line({ moment, className, go }: { moment: HelpMoment; className?: string; go: (route: string) => void }) {
  const t = useCommonT()
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const [helpId, setHelpId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = typeof window === 'undefined' ? '' : helpScreen(window.location.pathname)

  useEffect(() => {
    setHelpId(null)
    if (!userId) return
    let live = true
    void readHelpProfileId(userId).then((id) => { if (live) setHelpId(id) })
    return () => { live = false }
  }, [userId])

  const visible = Boolean(userId && helpId && helpId !== userId)
  useEffect(() => { if (visible) trackHelpShown(moment, screen) }, [visible, moment, screen])
  if (!visible || !userId || !helpId) return null

  const question = moment === 'search_empty' || moment === 'ai_no_result' ? t('hockiaHelp.cantFind') : moment === 'settings_help' || moment === 'feedback_form' ? t('hockiaHelp.question') : t('hockiaHelp.notWorking')
  const open = async () => {
    setBusy(true)
    try {
      go(await hockiaHelpRoute(userId, helpId, moment, screen, `${t('hockiaHelp.draft', { screen })}\n`))
    } catch {
      // The chat could not be prepared: open the composer for the account anyway.
      go(`/messages?new=${helpId}`)
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
