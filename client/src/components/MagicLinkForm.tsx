import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Trans } from 'react-i18next'
import { Mail, CheckCircle2 } from 'lucide-react'
import Button from './Button'
import Input from './Input'
import { sendMagicLink, type MagicLinkIntent, type MagicLinkRole } from '@/lib/magicLink'
import { useAuthT } from '@/i18n/ns/auth'

const RESEND_COOLDOWN_SECONDS = 60

export interface MagicLinkFormProps {
  /** 'signin' = existing user (Landing), 'signup' = new account (SignUp). */
  intent: MagicLinkIntent
  /** Required for intent='signup' so the role is written to user_metadata. */
  role?: MagicLinkRole
  /** Dark theme for Landing sign-in card; light for SignUp panel. */
  variant: 'light' | 'dark'
  /** Optional callback when the link is successfully sent (for analytics hooks). */
  onSent?: (email: string) => void
  /** Compact vertical spacing — used inside tight sign-in cards. */
  compact?: boolean
  /** CTA label — defaults to "Send me a magic link". */
  ctaLabel?: string
}

/**
 * Email-only (passwordless) sign-in / sign-up form.
 *
 * Shows an email input; on submit, sends a Supabase magic link and
 * swaps to a "check your inbox" confirmation with a 60s resend timer.
 * Use this on any surface where Google/Apple OAuth may be unreliable
 * (e.g. Meta in-app WebViews).
 */
export default function MagicLinkForm({ intent, role, variant, onSent, compact = false, ctaLabel }: MagicLinkFormProps) {
  const navigate = useNavigate()
  const t = useAuthT()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userNotFound, setUserNotFound] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  // Tick down the resend cooldown
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (loading || cooldown > 0) return
    setError(null)
    setUserNotFound(false)
    setLoading(true)
    try {
      const result = await sendMagicLink({ email, role, intent })
      if (!result.ok) {
        setError(result.error ?? t('magicLink.sendFailed'))
        if (result.userNotFound) setUserNotFound(true)
        return
      }
      setSentTo(email.trim().toLowerCase())
      setCooldown(RESEND_COOLDOWN_SECONDS)
      onSent?.(email.trim().toLowerCase())
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!sentTo || cooldown > 0 || loading) return
    setError(null)
    setLoading(true)
    try {
      const result = await sendMagicLink({ email: sentTo, role, intent })
      if (!result.ok) {
        setError(result.error ?? t('magicLink.resendFailed'))
        return
      }
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } finally {
      setLoading(false)
    }
  }

  const handleUseDifferentEmail = () => {
    setSentTo(null)
    setCooldown(0)
    setError(null)
  }

  // ── Sent state — "Check your inbox" ──
  if (sentTo) {
    const labelColor = variant === 'dark' ? 'text-white' : 'text-gray-900'
    const subColor = variant === 'dark' ? 'text-gray-500' : 'text-gray-600'
    const linkColor = variant === 'dark' ? 'text-[#c084fc] hover:text-[#d8b4fe]' : 'text-hockia-primary hover:text-[#6B20D4]'

    return (
      <div className={compact ? 'space-y-2' : 'space-y-3'}>
        <div className="flex items-start gap-3">
          <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${variant === 'dark' ? 'bg-emerald-500/20' : 'bg-emerald-50'}`}>
            <CheckCircle2 className={`w-5 h-5 ${variant === 'dark' ? 'text-emerald-400' : 'text-emerald-600'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${labelColor}`}>{t('magicLink.sentTitle')}</p>
            <p className={`text-xs mt-0.5 break-words ${subColor}`}>
              <Trans t={t} i18nKey="magicLink.sentBody" values={{ email: sentTo }} components={{ email: <span className="font-medium" /> }} />
            </p>
          </div>
        </div>

        {error && (
          <p className="text-red-500 text-xs" role="alert">{error}</p>
        )}

        <div className="flex items-center gap-5 pt-1">
          <button
            type="button"
            onClick={handleResend}
            disabled={cooldown > 0 || loading}
            className={`text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${linkColor}`}
          >
            {cooldown > 0 ? t('magicLink.resendIn', { seconds: cooldown }) : loading ? t('magicLink.resending') : t('magicLink.resend')}
          </button>
          {' '}
          <button
            type="button"
            onClick={handleUseDifferentEmail}
            className={`text-xs font-medium transition-colors ${linkColor}`}
          >
            {t('magicLink.differentEmail')}
          </button>
        </div>
      </div>
    )
  }

  // ── Entry state — email input ──
  // Input's built-in `icon` prop handles the left-aligned icon + pl-10 padding,
  // so we don't need a wrapper or padding overrides here.
  const inputClass =
    variant === 'dark'
      ? '!bg-white border-0 text-gray-900 placeholder:text-gray-400 !h-10 text-[13px] !rounded-xl'
      : '!bg-white border-gray-300 text-gray-900 placeholder:text-gray-400 !h-12 !rounded-lg'
  const errorColor = variant === 'dark' ? 'text-red-400' : 'text-red-600'

  return (
    <form onSubmit={handleSubmit} noValidate className={compact ? 'space-y-2' : 'space-y-3'}>
      <Input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t('fields.emailPlaceholder')}
        icon={<Mail className="w-4 h-4" />}
        className={inputClass}
        required
        autoComplete="email"
        inputMode="email"
        aria-label={t('magicLink.emailLabel')}
      />

      {error && !userNotFound && (
        <p className={`text-xs ${errorColor}`} role="alert">{error}</p>
      )}

      {userNotFound && (
        <div
          className={`text-xs rounded-lg p-2.5 ${variant === 'dark' ? 'bg-white/5 text-gray-200 border border-white/10' : 'bg-amber-50 text-amber-900 border border-amber-200'}`}
          role="alert"
        >
          <p className="font-medium mb-1">{t('magicLink.notFound')}</p>
          <button
            type="button"
            onClick={() => navigate('/signup')}
            className={`font-semibold underline-offset-2 hover:underline ${variant === 'dark' ? 'text-[#c084fc]' : 'text-hockia-primary'}`}
          >
            {t('magicLink.createAccount')}
          </button>
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        className={variant === 'dark' ? 'w-full !h-10 !rounded-xl text-[13px] font-semibold' : 'w-full'}
        disabled={loading || !email.trim()}
      >
        {loading ? t('magicLink.sending') : ctaLabel ?? t('magicLink.send')}
      </Button>
    </form>
  )
}
