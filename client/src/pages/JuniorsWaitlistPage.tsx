/**
 * JuniorsWaitlistPage — the goodbye email's logged-out waitlist touchpoint
 * (/juniors-waitlist?e=<base64 email>). PUBLIC route: frozen minors cannot
 * sign in (auth ban), so this page must work with no session. The email is
 * prefilled from the link; joining is an explicit button press that POSTs
 * to the age-gate edge fn (mail scanners prefetching the URL enroll nobody).
 */
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, CheckCircle2 } from 'lucide-react'
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

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-gray-50 to-white flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 max-w-md w-full p-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900">HOCKIA Juniors</h1>
        {phase === 'done' ? (
          <>
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mt-6">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm text-gray-600 mt-4 leading-relaxed">
              You&apos;re on the list. The moment HOCKIA Juniors opens, you&apos;ll
              be the first to know.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-600 mt-4 leading-relaxed">
              We&apos;re building a version of HOCKIA with protections designed
              for young players. Leave your email and be first in when it opens.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mt-5 w-full h-11 px-4 rounded-lg border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:ring-2 focus:ring-hockia-primary focus:border-transparent text-center"
            />
            {phase === 'error' && (
              <p className="text-sm text-red-600 mt-2" role="alert">
                Please check the email address and try again.
              </p>
            )}
            <button
              type="button"
              onClick={join}
              disabled={phase === 'saving'}
              className="mt-4 w-full py-3 bg-hockia-primary text-white font-semibold rounded-xl hover:bg-[#6b1fd4] transition-colors disabled:opacity-50"
            >
              {phase === 'saving' ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Keep me posted'}
            </button>
          </>
        )}
        <div className="mt-6 text-xs tracking-wide text-gray-400 font-semibold">HOCKIA</div>
      </div>
    </div>
  )
}
