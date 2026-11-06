import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { useAuthStore } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

/**
 * Before a coach who only looks for a role can post one (iOS audit
 * 2026-11-06): posting is a recruiter tool, so ask the onboarding question
 * again instead of switching them to recruiting in silence. Yes = recruiting
 * coach (`coach_recruits_for_team`), then the Post flow; Not now = back.
 */
export default function RecruitConfirmScreen() {
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const refreshProfile = useAuthStore((s) => s.refreshProfile)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirm = async () => {
    if (!profile?.id) return
    setSaving(true)
    setFailed(false)
    const { error } = await supabase.from('profiles').update({ coach_recruits_for_team: true }).eq('id', profile.id)
    if (error) {
      logger.error('[RecruitConfirm] could not turn on recruiting', error)
      setFailed(true)
      setSaving(false)
      return
    }
    // The route re-renders into the Post flow once the profile says "recruits".
    await refreshProfile()
  }

  return (
    <div className="flex min-h-screen flex-col bg-white" data-testid="recruit-confirm">
      <DetailNavBar parent="Opportunities" fallbackPath="/opportunities" />
      <div className="flex flex-1 flex-col items-center px-6 pt-16 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-hockia-soft text-hockia-primary">
          <Users className="h-7 w-7" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-[22px] font-bold leading-7 text-ink-1">Do you recruit players for a team?</h1>
        <p className="mt-2 text-row text-ink-2">
          Posting opportunities is for coaches who recruit. Say yes and you also get Find players and a shortlist.
        </p>
        {failed && <p className="mt-3 text-row text-ink-2" role="alert">That didn’t save. Check your connection and try again.</p>}
      </div>
      <div className="flex flex-col gap-2 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Button block loading={saving} onClick={() => void confirm()} data-testid="recruit-confirm-yes">Yes, I recruit for a team</Button>
        <Button block variant="tertiary" onClick={() => navigate('/opportunities', { replace: true })} data-testid="recruit-confirm-no">Not now</Button>
      </div>
    </div>
  )
}
