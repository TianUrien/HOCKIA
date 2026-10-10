import { useState } from 'react'
import { Check, Copy, Globe } from 'lucide-react'
import { webButtonClassName } from '@/components/ui/buttonClasses'
import { trackEvent } from '@/lib/analytics'
import { getExternalBrowserInstructions, handoffHref, inAppPlatform, openInExternalBrowser } from '@/lib/inAppBrowser'
import { cn } from '@/lib/utils'

/**
 * Figma: "Sign up v3 · Mobile · In-app browser (Google tapped)" 153:475, card 153:510.
 * Shown in place of a failing Google round-trip when the page is open inside
 * Instagram, Facebook or another app's built-in browser (Google refuses
 * embedded webviews). Calm and compact on purpose: it appears only after the
 * member taps "Continue with Google", never on arrival, and it says what
 * still works right here (Apple, email).
 *
 * Recovery, strongest first — the menu steps are the one route that works on
 * every platform, so they stay visible whatever the button does:
 * 1. "Open in Safari / Chrome": best-effort hand-off (intent:// on Android,
 *    x-safari-https:// on iOS), see lib/inAppBrowser.
 * 2. The app's own ⋯ menu → "Open in external browser".
 * 3. Copy link, to paste into the browser.
 * The URL handed over is this page's (plus any destination stashed only in
 * this webview, see handoffHref), so the invite / `?next=` survives the switch.
 */
interface ContinueInBrowserProps {
  browserName: string | null
  /** The sign-in that has to happen in the system browser. */
  providerLabel?: 'Google' | 'Facebook'
  className?: string
}

export function ContinueInBrowser({ browserName, providerLabel = 'Google', className }: ContinueInBrowserProps) {
  const [copied, setCopied] = useState(false)
  const platform = inAppPlatform()
  const appName = browserName && !/webview/i.test(browserName) ? browserName : 'This app'
  const browser = platform === 'ios' ? 'Safari' : platform === 'android' ? 'Chrome' : 'your browser'
  const label = (method: string) => `${browserName ?? 'unknown'}:${platform}:${providerLabel.toLowerCase()}:${method}`

  const open = () => {
    trackEvent({ action: 'inapp_browser_handoff', category: 'auth', label: label('open') })
    openInExternalBrowser(handoffHref())
  }

  const copy = async () => {
    trackEvent({ action: 'inapp_browser_handoff', category: 'auth', label: label('copy') })
    const href = handoffHref()
    try {
      await navigator.clipboard.writeText(href)
    } catch {
      const area = document.createElement('textarea')
      area.value = href
      area.setAttribute('readonly', '')
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div role="status" className={cn('rounded-[16px] bg-surface-subtle p-4 ring-1 ring-inset ring-line', className)}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-primary" aria-hidden="true">
          <Globe className="h-4 w-4" strokeWidth={2} />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-semibold leading-5 text-ink-1">Continue with {providerLabel} in {browser}</p>
          <p className="mt-1 text-[14px] leading-5 text-ink-2">
            {appName} doesn’t allow {providerLabel} sign-in inside the app. Open this page in {browser} and you’ll pick
            up right here. Apple and email work here too.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {platform !== 'other' && (
          <button type="button" onClick={open} className={webButtonClassName({ variant: 'primary', size: 'medium' })}>
            Open in {browser}
          </button>
        )}
        <button type="button" onClick={copy} className={cn(webButtonClassName({ variant: 'secondary', size: 'medium' }), 'gap-1.5')}>
          {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          {copied ? 'Link copied' : 'Copy link'}
        </button>
      </div>
      <p className="mt-3 text-[13px] leading-[18px] text-ink-3">
        {platform !== 'other' ? 'If nothing happens: ' : ''}
        {getExternalBrowserInstructions(browserName)}
      </p>
    </div>
  )
}
