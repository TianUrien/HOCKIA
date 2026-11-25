/**
 * Hockia's consent page for the Supabase OAuth 2.1 server (founder decision
 * 2026-11-24: members connect an AI assistant to their own account).
 *
 * Supabase Auth sends the member here as Site URL + /oauth/consent with an
 * `authorization_id`. The only client registered on the Supabase OAuth server
 * is the Hockia connector (a Cloudflare Worker), which has already asked the
 * member about the specific assistant on its own page before sending them
 * here. Approving here lets the connector read the account through the
 * read-only mcp_* database functions; it never writes.
 *
 * Signed-out members are sent to sign in and brought back with the same query.
 * Route: public in ProtectedRoute so the query string survives sign-in.
 */
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2, ShieldX } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { useSettingsT } from '@/i18n/ns/settings'
import { logger } from '@/lib/logger'

type State = 'loading' | 'ready' | 'invalid' | 'working' | 'failed'

/** Only follow Supabase's answer to an https address. */
function goTo(url: string | undefined): boolean {
  if (!url) return false
  try {
    if (new URL(url).protocol !== 'https:') return false
  } catch {
    return false
  }
  window.location.assign(url)
  return true
}

/** True when Supabase's redirect already holds the outcome for the client. */
function carriesAnswer(url: string | undefined): boolean {
  if (!url) return false
  try {
    const query = new URL(url).searchParams
    return query.has('code') || query.has('error')
  } catch {
    return false
  }
}

export default function OAuthConsentPage() {
  const t = useSettingsT()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const authorizationId = params.get('authorization_id')
  const { user, profile, loading: authLoading } = useAuthStore()
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    if (authLoading || !user) return
    if (!authorizationId) {
      setState('invalid')
      return
    }
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
      if (cancelled) return
      if (error || !data) {
        logger.debug('[OAuthConsent] details failed', error)
        setState('invalid')
        return
      }
      // A member who allowed the connector before is approved by Supabase on
      // the spot ("auto_approved" in the auth log): `redirect_uri` then carries
      // the code and the authorization is no longer pending, so Allow would
      // fail. On a first authorization `redirect_uri` is the bare registered
      // address with no code (both seen on staging 2026-11-25): follow it only
      // when it carries a code or an error.
      if (carriesAnswer(data.redirect_uri) && goTo(data.redirect_uri)) return
      setState('ready')
    })()
    return () => {
      cancelled = true
    }
  }, [authLoading, user, authorizationId])

  const decide = async (approve: boolean) => {
    if (!authorizationId) return
    setState('working')
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization
    const { data, error } = await fn.call(supabase.auth.oauth, authorizationId, { skipBrowserRedirect: true })
    if (error || !goTo(data?.redirect_url)) {
      logger.debug('[OAuthConsent] decision failed', error)
      setState('failed')
    }
  }

  const signIn = () => {
    const back = `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId ?? '')}`
    try {
      sessionStorage.setItem('hockia-redirect-after-login', back)
    } catch {
      /* noop */
    }
    navigate(`/signin?next=${encodeURIComponent(back)}`)
  }

  const shell = (children: React.ReactNode) => (
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="flex h-[46px] shrink-0 items-center px-6">
        <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="Hockia" width={108} height={22} className="h-[22px] w-auto" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6">{children}</main>
    </div>
  )

  if (authLoading || (user && state === 'loading')) {
    return shell(
      <div className="flex flex-col items-center py-8 text-ink-3">
        <Loader2 className="mb-3 h-7 w-7 animate-spin" />
        <p className="text-sm">{t('assistantConsent.working')}</p>
      </div>,
    )
  }

  if (!user) {
    return shell(
      <div className="text-center">
        <h1 className="text-title text-ink-1">{t('assistantConsent.signInTitle')}</h1>
        <p className="mb-8 mt-3 text-[17px] leading-[22px] text-ink-2">{t('assistantConsent.signInBody')}</p>
        <button type="button" onClick={signIn} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('assistantConsent.signIn')}
        </button>
      </div>,
    )
  }

  if (state === 'invalid' || state === 'failed') {
    return shell(
      <div className="text-center">
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
          <ShieldX className="h-9 w-9 text-ink-2" />
        </div>
        <h1 className="mt-8 text-title text-ink-1">{t('assistantConsent.invalidTitle')}</h1>
        <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
          {state === 'failed' ? t('assistantConsent.failed') : t('assistantConsent.invalidBody')}
        </p>
      </div>,
    )
  }

  const working = state === 'working'
  return shell(
    <div>
      <h1 className="text-title text-ink-1">{t('assistantConsent.title')}</h1>
      <p className="mt-3 text-[17px] leading-[22px] text-ink-2">{t('assistantConsent.intro')}</p>
      <p className="mt-5 text-[15px] font-semibold text-ink-1">{t('assistantConsent.canRead')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-[20px] text-ink-2">
        <li>{t('assistantConsent.readOwn')}</li>
        <li>{t('assistantConsent.readOpportunities')}</li>
        <li>{t('assistantConsent.readProfiles')}</li>
        <li>{t('assistantConsent.readRecruiting')}</li>
      </ul>
      <p className="mt-4 text-[15px] leading-[20px] text-ink-1">{t('assistantConsent.cannot')}</p>
      {profile?.full_name && <p className="mt-6 text-secondary text-ink-3">{t('assistantConsent.signedInAs', { name: profile.full_name })}</p>}
      <div className="mt-8 flex flex-col gap-3">
        <button type="button" disabled={working} onClick={() => void decide(true)} className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true })}>
          {working ? t('assistantConsent.working') : t('assistantConsent.allow')}
        </button>
        <button type="button" disabled={working} onClick={() => void decide(false)} className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true })}>
          {t('assistantConsent.deny')}
        </button>
      </div>
    </div>,
  )
}
