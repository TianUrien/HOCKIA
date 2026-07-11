/**
 * EmailActionPage — landing page for the weekly digest's one-click triage
 * links AND the opportunity renewal link (/email-action?t=<token>). PUBLIC
 * route: publishers click from their inbox, often logged out; the token IS
 * the authorization (single-use, hashed, expiring, server-side precondition).
 *
 * Flow against the application-action edge fn (JSON API):
 *   GET peek (read-only) → decides what to render. Mail scanners that
 *   prefetch this page therefore change nothing.
 *   - ready + Good fit / Maybe / Renew → auto-execute via POST (one click)
 *   - ready + Not a fit               → explicit confirm tap first (spec)
 *   - used / expired / already_handled / invalid → info states
 * Pages render here (app domain) because the Supabase gateway forces
 * text/plain + a sandbox CSP onto HTML served from *.supabase.co.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2, Star, HelpCircle, X, CheckCircle2, Link2, Clock, ShieldAlert, RefreshCw } from 'lucide-react'
import { SUPABASE_URL } from '@/lib/supabase'

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
  return new Date(y, m - 1, day).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
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
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm max-w-md w-full p-8 text-center">
        <Card phase={phase} onConfirmReject={() => execute((phase as { info: ActionInfo }).info)} />
        <div className="mt-6 text-xs tracking-wide text-gray-400 font-semibold">HOCKIA</div>
      </div>
    </div>
  )
}

function appLink(info: ActionInfo): string {
  return info.opportunity_id ? `/dashboard/opportunities/${info.opportunity_id}/applicants` : '/dashboard'
}

function Card({ phase, onConfirmReject }: { phase: Phase; onConfirmReject: () => void }) {
  if (phase.kind === 'loading' || phase.kind === 'executing') {
    const executingLabel =
      phase.kind === 'executing' && phase.info.action === 'renew'
        ? 'Renewing your opportunity…'
        : 'Recording your response…'
    return (
      <>
        <Loader2 className="w-10 h-10 mx-auto animate-spin text-hockia-primary" />
        <h1 className="text-lg font-bold text-gray-900 mt-4">
          {phase.kind === 'executing' ? executingLabel : 'Checking your link…'}
        </h1>
      </>
    )
  }

  if (phase.kind === 'confirm_reject') {
    const { info } = phase
    return (
      <>
        <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
          <X className="w-6 h-6 text-gray-600" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-4">
          Mark {info.applicant_name ?? 'this applicant'} as Not a fit?
        </h1>
        <p className="text-sm text-gray-600 mt-2 leading-relaxed">
          For {info.opportunity_title ?? 'your opportunity'}. They&apos;ll be notified honestly — a
          clear answer beats silence.
        </p>
        <button
          type="button"
          onClick={onConfirmReject}
          className="mt-5 w-full bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white font-semibold text-sm rounded-xl px-5 py-3 hover:opacity-95 transition"
        >
          Yes, mark as Not a fit
        </button>
        <Link
          to={appLink(info)}
          className="mt-3 block w-full text-sm font-medium text-gray-600 bg-gray-100 rounded-xl px-5 py-3 hover:bg-gray-200 transition"
        >
          Review in HOCKIA instead
        </Link>
      </>
    )
  }

  const { info } = phase
  const name = info.applicant_name ?? 'The applicant'
  const cta = (label = 'Review applicants in HOCKIA') => (
    <Link
      to={appLink(info)}
      className="mt-5 inline-block bg-gradient-to-r from-hockia-primary to-hockia-secondary text-white font-semibold text-sm rounded-xl px-6 py-3 hover:opacity-95 transition"
    >
      {label}
    </Link>
  )

  switch (info.outcome) {
    case 'renewed': {
      const until = formatDeadline(info.new_deadline)
      return (
        <>
          <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
            <RefreshCw className="w-6 h-6 text-hockia-primary" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">Opportunity renewed</h1>
          <p className="text-sm text-gray-600 mt-2">
            {info.opportunity_title ?? 'Your opportunity'} is open again
            {until ? ` and accepting applications until ${until}` : ''}.
          </p>
          {cta('Open in HOCKIA')}
        </>
      )
    }
    case 'closed_by_publisher':
      return (
        <>
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-gray-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">This opportunity stays closed</h1>
          <p className="text-sm text-gray-600 mt-2">
            {info.opportunity_title ?? 'This opportunity'} was closed from the app, so this link
            didn&apos;t change anything. You can reopen it anytime from your dashboard.
          </p>
          {cta('Open in HOCKIA')}
        </>
      )
    case 'applied':
      switch (info.action) {
        case 'shortlisted':
          return (
            <>
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
                <Star className="w-6 h-6 text-hockia-primary" />
              </div>
              <h1 className="text-lg font-bold text-gray-900 mt-4">{name} added to your shortlist</h1>
              <p className="text-sm text-gray-600 mt-2">
                They&apos;ll see they&apos;re on your shortlist for {info.opportunity_title ?? 'your opportunity'}.
              </p>
              {cta()}
            </>
          )
        case 'maybe':
          return (
            <>
              <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
                <HelpCircle className="w-6 h-6 text-amber-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900 mt-4">{name} marked as Maybe</h1>
              <p className="text-sm text-gray-600 mt-2">
                You can revisit them anytime. They see their application as under review.
              </p>
              {cta()}
            </>
          )
        default:
          return (
            <>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
              </div>
              <h1 className="text-lg font-bold text-gray-900 mt-4">{name} marked as Not a fit</h1>
              <p className="text-sm text-gray-600 mt-2">
                They&apos;ll be notified honestly — a clear answer beats silence.
              </p>
              {cta()}
            </>
          )
      }
    case 'already_handled':
      return (
        <>
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">This application was already handled</h1>
          <p className="text-sm text-gray-600 mt-2">
            {name}&apos;s application isn&apos;t pending anymore — it was already responded to. Nothing
            was changed.
          </p>
          {cta('Open in HOCKIA')}
        </>
      )
    case 'used':
      return (
        <>
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">This link was already used</h1>
          <p className="text-sm text-gray-600 mt-2">
            {info.action === 'renew'
              ? 'This opportunity was already renewed with this link — nothing was changed.'
              : 'Your response was recorded the first time — nothing was changed.'}
          </p>
          {cta('Open in HOCKIA')}
        </>
      )
    case 'expired':
      return (
        <>
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
            <Clock className="w-6 h-6 text-gray-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">This link has expired</h1>
          <p className="text-sm text-gray-600 mt-2">
            Action links work for 14 days. You can still respond from your dashboard.
          </p>
          {cta('Open in HOCKIA')}
        </>
      )
    case 'rate_limited':
      return (
        <>
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-amber-600" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">Too many requests</h1>
          <p className="text-sm text-gray-600 mt-2">Please wait a minute and open the link again.</p>
        </>
      )
    case 'error':
      return (
        <>
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6 text-red-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">Something went wrong</h1>
          <p className="text-sm text-gray-600 mt-2">
            Your response was not recorded. Please try the link again, or respond from your dashboard.
          </p>
          {cta('Open HOCKIA')}
        </>
      )
    default:
      return (
        <>
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto">
            <Link2 className="w-6 h-6 text-gray-500" />
          </div>
          <h1 className="text-lg font-bold text-gray-900 mt-4">This link isn&apos;t valid</h1>
          <p className="text-sm text-gray-600 mt-2">
            It may have been truncated by your email client. You can respond from your dashboard instead.
          </p>
          {cta('Open HOCKIA')}
        </>
      )
  }
}
