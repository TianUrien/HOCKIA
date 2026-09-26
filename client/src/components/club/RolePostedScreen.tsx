import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Clock, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { trackPushSubscribe } from '@/lib/analytics'
import { usePushSubscription } from '@/hooks/usePushSubscription'
import { INLINE_PUSH_ASK, useBottomPrompt } from '@/lib/bottomPrompt'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { IconButton } from '@/components/ui/IconButton'
import { DEFAULT_EXPIRY_DAYS } from '@/lib/clubRecruiting'
import { replyWindowLine, rolePostedCopy, type PostRoleDraft } from '@/lib/postRole'

/**
 * Role posted (Figma 04 Club D1.26 368:780; DEV NOTE 368:1098). Shown after
 * Post role succeeds. Find <players|coaches> for this role → Community with
 * the role's recruiting context active (player roles); Done and × →
 * Opportunities with the new card on top. The push card shows only while
 * the club has no push subscription, and stops after two dismissals.
 */
interface Props {
  roleId: string
  draft: Pick<PostRoleDraft, 'type' | 'position'>
}

const PUSH_DISMISS_KEY = 'hockia-role-posted-push-dismissals'
const PUSH_DISMISS_MAX = 2

function readDismissals(): number {
  try {
    const n = Number(localStorage.getItem(PUSH_DISMISS_KEY) ?? 0)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function recordDismissal() {
  try {
    localStorage.setItem(PUSH_DISMISS_KEY, String(readDismissals() + 1))
  } catch {
    /* storage unavailable: the card just shows again next time */
  }
}

export default function RolePostedScreen({ roleId, draft }: Props) {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const push = usePushSubscription()
  const copy = rolePostedCopy(draft)
  const [expiryDays, setExpiryDays] = useState<number | null>(null)
  const [dismissals] = useState(readDismissals)
  const [turnedOn, setTurnedOn] = useState(false)

  useEffect(() => {
    let cancelled = false
    void supabase.from('application_response_settings').select('expiry_days').limit(1).maybeSingle().then(({ data, error }) => {
      if (cancelled) return
      if (error) logger.warn('[RolePosted] expiry_days not loaded', error)
      setExpiryDays((data as { expiry_days?: number } | null)?.expiry_days ?? DEFAULT_EXPIRY_DAYS)
    })
    return () => { cancelled = true }
  }, [])

  const showPush = push.isSupported && !push.isSubscribed && !turnedOn && push.permission !== 'denied' && push.permission !== 'granted' && dismissals < PUSH_DISMISS_MAX
  // Holds the push slot so the global PushPrompt doesn't stack on this card.
  useBottomPrompt(INLINE_PUSH_ASK, showPush)
  // Leaving with the card still up counts as one dismissal.
  const leave = (to: string, state?: unknown) => {
    if (showPush) recordDismissal()
    navigate(to, { replace: true, state })
  }
  const done = () => leave('/opportunities', { highlight: roleId })

  const turnOn = async () => {
    try {
      await push.subscribe()
      trackPushSubscribe('prompt')
      setTurnedOn(true)
    } catch {
      // Denied or failed: the hook logs it; the card hides once permission is denied.
    }
  }

  return (
    <div className="flex h-[100dvh] flex-col bg-white pt-[env(safe-area-inset-top)] lg:hidden" data-testid="role-posted-screen">
      <div className="flex h-11 shrink-0 items-center justify-end pr-2">
        <IconButton label="Close" onClick={done}>
          <X className="h-6 w-6" strokeWidth={2} />
        </IconButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="my-auto flex flex-col items-center gap-4 px-8 py-4">
          <span className="flex h-[88px] w-[88px] shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive" aria-hidden="true">
            <Check className="h-10 w-10" strokeWidth={2.4} />
          </span>
          <h1 className="text-center text-[28px] font-bold leading-[34px] tracking-[-0.28px] text-ink-1">{copy.title}</h1>
          <EntityAvatar src={profile?.avatar_url ?? null} name={profile?.full_name ?? null} role="club" size={64} />
          <p className="text-center text-[15px] leading-[21px] text-ink-2">{copy.body}</p>

          <div className="flex w-full items-center gap-2.5 rounded-[14px] bg-surface-grouped px-3.5 py-3">
            <Clock className="h-[18px] w-[18px] shrink-0 text-ink-2" strokeWidth={1.8} aria-hidden="true" />
            <p className={expiryDays === null ? 'invisible text-[13px] leading-[18px] text-ink-2' : 'text-[13px] leading-[18px] text-ink-2'} data-testid="role-posted-reply-window">
              {replyWindowLine(expiryDays ?? DEFAULT_EXPIRY_DAYS)}
            </p>
          </div>

          {showPush && (
            <div className="flex w-full items-center gap-3 rounded-2xl bg-hockia-soft p-3.5" data-testid="role-posted-push">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white text-hockia-primary" aria-hidden="true">
                <Bell className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-semibold leading-5 text-ink-1">{copy.pushTitle}</p>
                <p className="text-[13px] leading-[18px] text-ink-2">A notification for each applicant and before one closes.</p>
              </div>
              <button type="button" onClick={() => void turnOn()} disabled={push.loading} className="flex h-[34px] shrink-0 items-center rounded-full bg-hockia-primary px-3.5 text-[14px] font-semibold text-white disabled:opacity-60">
                Turn on
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2.5 px-5 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
        <button type="button" onClick={() => leave(copy.findPath)} className="flex h-[52px] w-full items-center justify-center rounded-full bg-hockia-primary px-[18px] text-[17px] font-semibold text-white active:opacity-90">
          {copy.findLabel}
        </button>
        <button type="button" onClick={done} className="flex h-[52px] w-full items-center justify-center rounded-full bg-surface-grouped px-[18px] text-[17px] font-semibold text-ink-1">
          Done
        </button>
      </div>
    </div>
  )
}
