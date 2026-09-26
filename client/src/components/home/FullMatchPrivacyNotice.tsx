import { useState } from 'react'
import { Lock } from 'lucide-react'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/lib/auth'
import { useToastStore } from '@/lib/toast'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { useFullMatchPrivacyNotice } from '@/hooks/useFullMatchPrivacyNotice'

/**
 * One-time notice (Phase 1 · step 3): full matches now default to clubs and
 * coaches who recruit. Shown once per player — the answer is stored on the
 * server (user_pulse_items.dismissed_at), so answering on one device clears
 * it everywhere, and answering in Settings → Privacy clears it too.
 *
 *   card   — Home, phone and desktop (sits above the feed like "Your week")
 *   banner — desktop v1 player dashboard, a full-width strip
 */
export function FullMatchPrivacyNotice({ variant = 'card', className }: { variant?: 'card' | 'banner'; className?: string }) {
  const { noticeId, resolveNotice } = useFullMatchPrivacyNotice()
  const { user, refreshProfile } = useAuthStore()
  const addToast = useToastStore((s) => s.addToast)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  if (!noticeId || !user) return null

  const makePublic = async () => {
    setSaving(true)
    try {
      const { error } = await supabase.from('profiles').update({ full_match_visibility: 'public' }).eq('id', user.id)
      if (error) throw error
      setConfirming(false)
      await resolveNotice(true)
      void refreshProfile()
      addToast('Your full matches are now public.', 'success')
    } catch (err) {
      logger.error('[FullMatchPrivacyNotice] make public failed', err)
      addToast('Could not save that. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const banner = variant === 'banner'

  return (
    <>
      <section
        aria-labelledby="full-match-privacy-title"
        data-testid={`full-match-privacy-notice-${variant}`}
        className={cn(
          banner
            ? 'flex flex-col gap-3 rounded-xl border border-line bg-white px-5 py-4 sm:flex-row sm:items-center sm:gap-5'
            : 'rounded-[18px] bg-surface-grouped px-4 pb-4 pt-3.5',
          className,
        )}
      >
        <div className={cn('flex min-w-0 gap-3', banner && 'sm:flex-1 sm:items-center')}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-ink-1 shadow-[0_0_0_1px_rgba(20,20,28,0.06)]">
            <Lock className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="full-match-privacy-title" className="text-body font-semibold text-ink-1">Your full matches are now for clubs and coaches</h2>
            <p className="mt-0.5 text-secondary text-ink-2">
              Only clubs and coaches who recruit can watch your full matches. Highlights stay public. You can change this any time in Settings → Privacy.
            </p>
          </div>
        </div>
        <div className={cn('flex gap-2', banner ? 'sm:shrink-0' : 'mt-3.5 pl-12')}>
          <button
            type="button"
            onClick={() => void resolveNotice(false)}
            className="h-9 rounded-full bg-hockia-primary px-4 text-secondary font-semibold text-white transition-opacity active:opacity-80"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className={cn('h-9 rounded-full px-4 text-secondary font-semibold text-ink-1 transition-colors', banner ? 'bg-surface-grouped hover:bg-[#e9e9ef]' : 'bg-white active:bg-[#e9e9ef]')}
          >
            Make them public
          </button>
        </div>
      </section>

      <BottomSheet open={confirming} onClose={() => setConfirming(false)} ariaLabel="Make your full matches public">
        <div className="px-5 pb-3 pt-1">
          <h2 className="text-title text-ink-1">Make your full matches public?</h2>
          <p className="mt-1.5 text-row text-ink-2">Anyone on Hockia will be able to watch your full matches. You can switch back any time in Settings → Privacy.</p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void makePublic()}
            className="mt-5 flex h-[50px] w-full items-center justify-center rounded-full bg-hockia-primary text-body font-semibold text-white disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Make them public'}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="mt-2 flex h-[50px] w-full items-center justify-center rounded-full bg-surface-grouped text-body font-semibold text-ink-1"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </>
  )
}
