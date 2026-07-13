import { useCoachPulseMode, type CoachPulseMode } from '@/hooks/useCoachPulseMode'
import { PlayerHero } from './PlayerHero'
import { YourApplications } from './YourApplications'
import { OpportunitiesForYou } from './OpportunitiesForYou'
import { ClubPulse } from './ClubPulse'
import { HappeningNow } from './HappeningNow'

/**
 * The coach Pulse (Home V2 Phase 3, §2.3 dual mode): "Find roles" (get hired
 * — visibility hero + applications + coaching-roles rail) vs "My recruiting"
 * (the recruiter surface — the club Pulse modules verbatim in coach voice;
 * they're all role-agnostic: coaches own opportunities via club_id and
 * recruiting contexts support coach owners). Default mode follows
 * coach_recruits_for_team; the switch persists per user.
 *
 * A coach who has never posted sees the Post-an-opportunity CTA in recruiting
 * mode — posting flips their recruiter flag (existing dashboard behavior).
 */
function ModeSwitch({ mode, onChange }: { mode: CoachPulseMode; onChange: (m: CoachPulseMode) => void }) {
  const options: Array<{ value: CoachPulseMode; label: string }> = [
    { value: 'find', label: '🎯 Find roles' },
    { value: 'recruit', label: '🔍 My recruiting' },
  ]
  return (
    <div className="mb-4 flex rounded-2xl bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={mode === o.value}
          className={`flex-1 rounded-xl py-2 text-sm font-bold transition-colors ${
            mode === o.value ? 'bg-white text-hockia-primary shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function CoachPulse() {
  const [mode, setMode] = useCoachPulseMode()

  return (
    <>
      <ModeSwitch mode={mode} onChange={setMode} />
      {mode === 'find' ? (
        <>
          <PlayerHero voice="coach" />
          <YourApplications enabled />
          <OpportunitiesForYou
            enabled
            forRole="coach"
            moduleId="coach_roles_for_you"
            position={2}
            title="Coaching roles for you"
          />
          <HappeningNow position={3} />
        </>
      ) : (
        <>
          <ClubPulse voice="coach" />
          <HappeningNow position={5} />
        </>
      )}
    </>
  )
}
