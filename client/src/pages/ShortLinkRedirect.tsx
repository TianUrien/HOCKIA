/**
 * /l/:code — resolve a short link and move on.
 *
 * Rendered INSTEAD of the app shell (see ShortLinkGate), so nothing else
 * paints first. Resolution logs the click server-side; the redirect carries
 * the link's utm set plus hk_link=<code>, which is what the attribution
 * engine records as the touch. An unknown or retired code goes home
 * untagged rather than erroring at a visitor who tapped a bio link.
 */

import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'
import { currentPlatform } from '@/lib/attribution'
import { hostnameOf } from '@/lib/attributionRules'
import { getDeviceContext } from '@/lib/analyticsIdentity'
import { buildShortLinkTarget, isIOSUserAgent, shortLinkCode, type ShortLink } from '@/lib/shortLinks'

const FAILSAFE_MS = 6000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, params?: Record<string, unknown>) => Promise<{ data: any; error: any }>

export default function ShortLinkRedirect() {
  // Mounted by ShortLinkGate outside the <Routes> tree, so there are no
  // route params — the code comes from the pathname itself.
  const { pathname } = useLocation()
  const code = shortLinkCode(pathname) ?? ''
  const navigate = useNavigate()
  const [failed, setFailed] = useState(false)
  const done = useRef(false)

  useEffect(() => {
    let cancelled = false
    const go = (target: { url: string; external: boolean }) => {
      if (cancelled || done.current) return
      done.current = true
      if (target.external) window.location.replace(target.url)
      else navigate(target.url, { replace: true })
    }
    const home = () => {
      if (cancelled || done.current) return
      setFailed(true)
      go({ url: '/', external: false })
    }

    const failsafe = window.setTimeout(home, FAILSAFE_MS)
    let device: string | null = null
    try { device = getDeviceContext().device ?? null } catch { /* optional */ }

    rpc('resolve_short_link', {
      p_code: code,
      p_platform: currentPlatform(),
      p_referrer_host: hostnameOf(document.referrer || null),
      p_device: device,
    })
      .then(({ data, error }) => {
        if (error) throw new Error(error.message)
        const link = data as ShortLink | null
        if (!link) { home(); return }
        go(buildShortLinkTarget(link, { isIOS: isIOSUserAgent(navigator.userAgent, navigator.maxTouchPoints ?? 0) }))
      })
      .catch((err: unknown) => {
        logger.warn('[ShortLinkRedirect] resolve failed', err)
        home()
      })
      .finally(() => window.clearTimeout(failsafe))

    return () => { cancelled = true; window.clearTimeout(failsafe) }
  }, [code, navigate])

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-white text-gray-600"
      data-testid="short-link-redirect"
      role="status"
      aria-live="polite"
    >
      <div className="w-8 h-8 rounded-full border-2 border-purple-200 border-t-purple-600 animate-spin" aria-hidden="true" />
      <p className="mt-4 text-sm">{failed ? 'Taking you to Hockia…' : 'Opening Hockia…'}</p>
    </div>
  )
}
