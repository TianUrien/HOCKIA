/**
 * JuniorsWaitlistPage — the goodbye email's logged-out waitlist touchpoint
 * (/juniors-waitlist?e=<base64 email>). PUBLIC route: frozen minors cannot
 * sign in (auth ban), so this page must work with no session. The email is
 * prefilled from the link; joining is an explicit button press that POSTs
 * to the age-gate edge fn (mail scanners prefetching the URL enroll nobody).
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AuthStatus, FormError } from '@/components/auth/authUi'
import { Button } from '@/components/ui/Button'
import { CheckIcon, StickAndBallIcon } from '@/components/icons/HockiaIcons'
import { fieldInput, fieldLabel } from '@/components/ui/fieldClasses'
import { SUPABASE_URL } from '@/lib/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export default function JuniorsWaitlistPage() {
  const [searchParams] = useSearchParams()
  const prefill = useMemo(() => {
    try {
      const decoded = atob(searchParams.get('e') ?? '')
      return EMAIL_RE.test(decoded) ? decoded : ''
    } catch {
      return ''
    }
  }, [searchParams])
  const [email, setEmail] = useState(prefill)
  const [phase, setPhase] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')

  const join = async () => {
    if (!EMAIL_RE.test(email)) {
      setPhase('error')
      return
    }
    setPhase('saving')
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/age-gate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'waitlist', email: email.trim().toLowerCase(), source: 'goodbye_email' }),
      })
      const body = await res.json()
      setPhase(body?.outcome === 'saved' ? 'done' : 'error')
    } catch {
      setPhase('error')
    }
  }

  // Rebrand page 28 · Hockia Juniors: lockup, one field, one action.
  return (
    <div className="flex min-h-app-screen flex-col bg-white pt-[env(safe-area-inset-top)] pb-[max(env(safe-area-inset-bottom),24px)]">
      <header className="flex h-[46px] shrink-0 items-center px-6">
        <img src="/brand/lockup/hockia-lockup-horizontal-ink.svg" alt="Hockia" width={108} height={22} className="h-[22px] w-auto" />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col px-6">
        {phase === 'done' ? (
          <AuthStatus tone="positive" icon={<CheckIcon className="h-9 w-9" />} title="You’re on the list">
            The moment Hockia Juniors opens, you’ll be the first to know.
          </AuthStatus>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); void join() }} noValidate className="flex flex-1 flex-col">
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-hockia-soft text-hockia-primary" aria-hidden="true">
                <StickAndBallIcon className="h-9 w-9" />
              </span>
              <h1 className="mt-8 text-title text-ink-1">Hockia Juniors</h1>
              <p className="mt-3 text-[17px] leading-[22px] text-ink-2">Hockia is for players 18 and over for now. Join the waitlist and we’ll email you when Juniors opens.</p>
              <div className="mt-6 w-full text-left">
                <label htmlFor="juniors-email" className={fieldLabel}>Email</label>
                <input id="juniors-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={fieldInput} autoComplete="email" inputMode="email" autoCapitalize="none" required />
                <p className="mt-1.5 text-caption text-ink-3">Only used to tell you when Juniors opens.</p>
                {phase === 'error' && <div className="mt-3"><FormError>Please check the email address and try again.</FormError></div>}
              </div>
            </div>
            <div className="pt-8">
              <Button type="submit" block loading={phase === 'saving'}>Join the waitlist</Button>
            </div>
          </form>
        )}
      </main>
    </div>
  )
}
