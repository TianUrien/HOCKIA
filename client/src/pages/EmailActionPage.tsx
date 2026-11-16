/**
 * EmailActionPage — landing page for the weekly digest's one-click triage
 * links AND the opportunity renewal link (/email-action?t=<token>). PUBLIC
 * route: publishers click from their inbox, often logged out; the token IS
 * the authorization (single-use, hashed, expiring, server-side precondition).
 *
 * Flow against the application-action edge fn (JSON API):
 *   GET peek (read-only) → decides what to render. Mail scanners that
 *   prefetch this page therefore change nothing.
 *   - ready + Top pick / Maybe / Renew → auto-execute via POST (one click)
 *   - ready + Not a fit               → explicit confirm tap first (spec)
 *   - used / expired / already_handled / invalid → info states
 * Pages render here (app domain) because the Supabase gateway forces
 * text/plain + a sandbox CSP onto HTML served from *.supabase.co.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Star, HelpCircle, X, CheckCircle2, Link2, Clock, ShieldAlert, RefreshCw } from 'lucide-react'
import { SUPABASE_URL } from '@/lib/supabase'
import { buttonClassName } from '@/components/ui/buttonClasses'
import { intlLocale } from '@/i18n/format'
import { useSettingsT } from '@/i18n/ns/settings'

type Action = 'shortlisted' | 'maybe' | 'rejected' | 'renew'

interface ActionInfo {
  outcome: string
  action?: Action
  applicant_name?: string
  opportunity_id?: string
  opportunity_title?: string
  new_deadline?: string
}

/** 'YYYY-MM-DD' → 'July 30' without the UTC-midnight timezone shift. */
function formatDeadline(d: string | undefined): string | null {
  if (!d) return null
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return null
  return new Date(y, m - 1, day).toLocaleDateString(intlLocale(), { month: 'long', day: 'numeric' })
}

const ENDPOINT = `${SUPABASE_URL}/functions/v1/application-action`
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

type Phase =
  | { kind: 'loading' }
  | { kind: 'confirm_reject'; info: ActionInfo }
  | { kind: 'executing'; info: ActionInfo }
  | { kind: 'done'; info: ActionInfo }

export default function EmailActionPage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('t') ?? ''
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  // Guards the auto-execute against StrictMode double-effects and re-renders:
  // a second POST would burn into the "already used" path.
  const startedRef = useRef(false)

  const execute = useCallback(async (info: ActionInfo) => {
    setPhase({ kind: 'executing', info })
    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token }),
      })
      const result = (await res.json()) as ActionInfo
      setPhase({ kind: 'done', info: { ...info, ...result } })
    } catch {
      setPhase({ kind: 'done', info: { ...info, outcome: 'error' } })
    }
  }, [token])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    if (!TOKEN_RE.test(token)) {
      setPhase({ kind: 'done', info: { outcome: 'invalid' } })
      return
    }

    ;(async () => {
      try {
        const res = await fetch(`${ENDPOINT}?t=${encodeURIComponent(token)}`)
        const info = (await res.json()) as ActionInfo
        if (info.outcome !== 'ready') {
          setPhase({ kind: 'done', info })
        } else if (info.action === 'rejected') {
          // Rejections get an explicit human confirmation step.
          setPhase({ kind: 'confirm_reject', info })
        } else {
          await execute(info)
        }
      } catch {
        setPhase({ kind: 'done', info: { outcome: 'error' } })
      }
    })()
  }, [token, execute])

  return (
    // Rebrand page 26 · email actions: the lockup on top, the result centred.
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="flex h-[46px] shrink-0 items-center justify-center">
        <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="Hockia" width={108} height={22} className="h-[22px] w-auto" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-6 text-center">
        <Card phase={phase} onConfirmReject={() => execute((phase as { info: ActionInfo }).info)} />
      </main>
    </div>
  )
}

function appLink(info: ActionInfo): string {
  return info.opportunity_id ? `/dashboard/opportunities/${info.opportunity_id}/applicants` : '/home'
}

function Card({ phase, onConfirmReject }: { phase: Phase; onConfirmReject: () => void }) {
  const t = useSettingsT()
  if (phase.kind === 'loading' || phase.kind === 'executing') {
    const executingLabel =
      phase.kind === 'executing' && phase.info.action === 'renew'
        ? t('emailAction.renewing')
        : t('emailAction.recording')
    return (
      <>
        <Loader2 className="mx-auto h-10 w-10 animate-spin text-hockia-primary" />
        <h1 className="mt-8 text-title text-ink-1">
          {phase.kind === 'executing' ? executingLabel : t('emailAction.checking')}
        </h1>
      </>
    )
  }

  if (phase.kind === 'confirm_reject') {
    const { info } = phase
    return (
      <>
        <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
          <X className="h-9 w-9 text-ink-2" />
        </div>
        <h1 className="mt-8 text-title text-ink-1">
          {info.applicant_name
            ? t('emailAction.confirmReject.title', { name: info.applicant_name })
            : t('emailAction.confirmReject.titleNoName')}
        </h1>
        <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
          {info.opportunity_title
            ? t('emailAction.confirmReject.body', { title: info.opportunity_title })
            : t('emailAction.confirmReject.bodyNoTitle')}
        </p>
        <button
          type="button"
          onClick={onConfirmReject}
          className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-8' })}
        >
          {t('emailAction.confirmReject.confirm')}
        </button>
        <Link
          to={appLink(info)}
          className={buttonClassName({ variant: 'secondary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-3' })}
        >
          {t('emailAction.confirmReject.review')}
        </Link>
      </>
    )
  }

  const { info } = phase
  const name = info.applicant_name ?? t('emailAction.applicantFallback')
  const cta = (label = t('emailAction.reviewApplicants')) => (
    <Link
      to={appLink(info)}
      className={buttonClassName({ variant: 'primary', size: 'large', radius: 'rounded-full', block: true, className: 'mt-8' })}
    >
      {label}
    </Link>
  )

  switch (info.outcome) {
    case 'renewed': {
      const until = formatDeadline(info.new_deadline)
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-positive-soft">
            <RefreshCw className="h-9 w-9 text-positive" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.renewed.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {info.opportunity_title
              ? (until ? t('emailAction.renewed.bodyUntil', { title: info.opportunity_title, date: until }) : t('emailAction.renewed.body', { title: info.opportunity_title }))
              : (until ? t('emailAction.renewed.bodyNoTitleUntil', { date: until }) : t('emailAction.renewed.bodyNoTitle'))}
          </p>
          {cta(t('emailAction.openIn'))}
        </>
      )
    }
    case 'closed_by_publisher':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <CheckCircle2 className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.closed.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {info.opportunity_title
              ? t('emailAction.closed.body', { title: info.opportunity_title })
              : t('emailAction.closed.bodyNoTitle')}
          </p>
          {cta(t('emailAction.openIn'))}
        </>
      )
    case 'applied':
      switch (info.action) {
        case 'shortlisted':
          return (
            <>
              <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-positive-soft">
                <Star className="h-9 w-9 text-positive" />
              </div>
              <h1 className="mt-8 text-title text-ink-1">{t('emailAction.shortlisted.title', { name })}</h1>
              <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
                {info.opportunity_title
                  ? t('emailAction.shortlisted.body', { title: info.opportunity_title })
                  : t('emailAction.shortlisted.bodyNoTitle')}
              </p>
              {cta()}
            </>
          )
        case 'maybe':
          return (
            <>
              <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
                <HelpCircle className="h-9 w-9 text-ink-2" />
              </div>
              <h1 className="mt-8 text-title text-ink-1">{t('emailAction.maybe.title', { name })}</h1>
              <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
                {t('emailAction.maybe.body')}
              </p>
              {cta()}
            </>
          )
        default:
          return (
            <>
              <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
                <CheckCircle2 className="h-9 w-9 text-ink-2" />
              </div>
              <h1 className="mt-8 text-title text-ink-1">{t('emailAction.rejected.title', { name })}</h1>
              <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
                {t('emailAction.rejected.body')}
              </p>
              {cta()}
            </>
          )
      }
    case 'already_handled':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <CheckCircle2 className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.alreadyHandled.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {t('emailAction.alreadyHandled.body', { name })}
          </p>
          {cta(t('emailAction.openIn'))}
        </>
      )
    case 'used':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <CheckCircle2 className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.used.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {info.action === 'renew'
              ? t('emailAction.used.bodyRenew')
              : t('emailAction.used.body')}
          </p>
          {cta(t('emailAction.openIn'))}
        </>
      )
    case 'expired':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <Clock className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.expired.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {t('emailAction.expired.body')}
          </p>
          {cta(t('emailAction.openIn'))}
        </>
      )
    case 'rate_limited':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <ShieldAlert className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.rateLimited.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">{t('emailAction.rateLimited.body')}</p>
        </>
      )
    case 'error':
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-status-danger-soft">
            <ShieldAlert className="h-9 w-9 text-status-danger" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.error.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {t('emailAction.error.body')}
          </p>
          {cta(t('emailAction.openHockia'))}
        </>
      )
    default:
      return (
        <>
          <div className="mx-auto flex h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-muted">
            <Link2 className="h-9 w-9 text-ink-2" />
          </div>
          <h1 className="mt-8 text-title text-ink-1">{t('emailAction.invalid.title')}</h1>
          <p className="mt-3 text-[17px] leading-[22px] text-ink-2">
            {t('emailAction.invalid.body')}
          </p>
          {cta(t('emailAction.openHockia'))}
        </>
      )
  }
}
