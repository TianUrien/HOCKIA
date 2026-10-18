import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useWeekViewers } from '@/hooks/useYourWeek'
import { DetailNavBar } from '@/components/ui/DetailNavBar'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { backLabelFrom } from '@/lib/backLabel'
import { getImageUrl } from '@/lib/imageUrl'
import { referenceArrivedThisWeek } from '@/lib/pulseWeek'
import { hapticLight } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { useNextStep, type NextStep } from '@/components/home/v1/useNextStep'
import { SquircleBox } from '@/components/home/v1/primitives'
import { WhoLookedAtYou } from './WhoLookedAtYou'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import { AVAILABLE_RING } from '@/lib/homeEngagement'

const REFERENCES_PATH = '/dashboard/profile?tab=references'
const TIP_KEYS = new Set(['photo', 'complete', 'crest', 'umpire'])

/**
 * Your activity (Figma H3 61:247; founder ruling 11 Oct: replaces "Your week"
 * on /pulse for everyone). Every Pulse action card in priority order —
 * roles / applicants · availability check-in · who viewed you (masked
 * viewers are a generic placeholder, never a blurred crest) · a reference
 * from a friend (gold) · a profile tip. /pulse stays because old native apps
 * link to it; Home's Next step shows the same cards one at a time.
 */
export function ActivityScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const profile = useAuthStore((s) => s.profile)
  const { steps, loading, run, dismiss, markDone } = useNextStep()
  const vis = useWeeklyVisibility(Boolean(profile), false)
  const viewers = useWeekViewers(profile?.role === 'player' || profile?.role === 'coach')
  const refs = useTrustedReferences(profile?.id ?? '')
  // Home's views card links here with ?viewers=1: open the list straight away.
  const [showViewers, setShowViewers] = useState(() => new URLSearchParams(location.search).get('viewers') === '1')
  const [busy, setBusy] = useState<string | null>(null)

  const checkIn = steps.find((s) => s.action === 'confirm_availability')
  const primary = steps.filter((s) => s !== checkIn && !TIP_KEYS.has(s.key) && s.key !== 'views' && s.key !== 'week')
  const tips = steps.filter((s) => TIP_KEYS.has(s.key))
  const views = vis.visibility?.views_7d ?? 0
  const byRole = vis.visibility?.viewers_by_role ?? {}
  const recruiters = (byRole.club ?? 0) + (byRole.coach ?? 0)
  const reference = referenceArrivedThisWeek(refs.acceptedReferences)
  const nothing = !loading && primary.length === 0 && !checkIn && views === 0 && !reference && tips.length === 0

  const go = (s: NextStep) => {
    void hapticLight()
    if (s.to) navigate(s.to)
  }
  const confirm = async (s: NextStep) => {
    setBusy(s.key)
    if (await run(s)) markDone(s.key)
    setBusy(null)
  }
  const notNow = (s: NextStep) => dismiss(s)

  return (
    <div className="min-h-screen bg-white pt-[env(safe-area-inset-top)]" data-testid="activity-screen">
      <DetailNavBar parent={backLabelFrom(location.state, 'Home')} fallbackPath="/home" />
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pb-10">
        <h1 className="px-1 pb-2 text-[22px] font-bold leading-7 text-ink-1">Your activity</h1>

        {loading && [0, 1, 2].map((i) => <div key={i} className="h-[76px] animate-pulse rounded-[20px] bg-surface-muted" />)}

        {primary.map((s, i) => (
          <SquircleBox key={s.key} radius={20} className={i === 0 ? 'bg-hockia-soft' : 'bg-surface-subtle'}>
            <button type="button" onClick={() => go(s)} className="flex w-full items-center gap-3 px-4 py-4 text-left active:opacity-80">
              <Stack visual={s.visual} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{s.title}</span>
                {s.subtitle && <span className="block truncate text-secondary text-ink-2">{s.subtitle}</span>}
              </span>
            </button>
          </SquircleBox>
        ))}

        {checkIn && (
          <SquircleBox radius={20} className="bg-surface-subtle px-4 py-4" >
            <div className="flex gap-3" data-testid="activity-check-in">
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#e8f7ee]">
                <span className="h-5 w-5 rounded-full bg-gradient-to-b from-[#34c759] to-[#1f9d45] shadow-[inset_0_1px_1px_rgba(255,255,255,0.5)]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">{checkIn.title.replace('Still open to play?', 'Still available to play?')}</span>
                <span className="block text-secondary text-ink-2">Clubs see this on your profile.</span>
                <span className="mt-2.5 flex gap-2">
                  <button type="button" onClick={() => void confirm(checkIn)} disabled={busy === checkIn.key} className="h-9 rounded-full bg-hockia-primary px-4 text-[14px] font-semibold text-white disabled:opacity-60">
                    Yes, available
                  </button>
                  <button type="button" onClick={() => void notNow(checkIn)} className="h-9 rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-ink-1">
                    Not now
                  </button>
                </span>
              </span>
            </div>
          </SquircleBox>
        )}

        {views > 0 && (
          <SquircleBox radius={20} className="bg-surface-subtle">
            <button type="button" onClick={() => setShowViewers((v) => !v)} aria-expanded={showViewers} className="flex w-full items-center gap-3 px-4 py-4 text-left">
              {/* Masked viewers: a generic placeholder, never a blurred crest (ruling 11 Oct). */}
              <span className="relative h-10 w-[72px] shrink-0" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="absolute top-0 flex h-10 w-10 items-center justify-center rounded-full border border-line bg-white" style={{ left: i * 16 }}>
                    {i === 2 && <Shield className="h-4 w-4 text-ink-4" strokeWidth={1.8} />}
                  </span>
                ))}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">
                  {recruiters > 0 ? `${recruiters} ${recruiters === 1 ? 'club' : 'clubs'} viewed your profile` : `${views} profile ${views === 1 ? 'view' : 'views'}`}
                </span>
                <span className="block truncate text-secondary text-ink-2">This week · names shown when visible</span>
              </span>
            </button>
            {showViewers && !viewers.loading && viewers.viewers.length > 0 && (
              <div className="pb-3"><WhoLookedAtYou rows={viewers.viewers} /></div>
            )}
          </SquircleBox>
        )}

        {reference && (
          <SquircleBox radius={20} className="bg-gold-soft">
            <Link to={REFERENCES_PATH} className="flex items-center gap-3 px-4 py-4" data-testid="activity-reference">
              <EntityAvatar
                src={getImageUrl(reference.profile?.avatarUrl, 'avatar-md') ?? reference.profile?.avatarUrl}
                name={reference.profile?.fullName}
                role={reference.profile?.role}
                size={40}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">
                  {reference.profile?.fullName ? `${reference.profile.fullName.split(/\s+/)[0]} left you a reference` : 'You received a reference'}
                </span>
                {reference.endorsementText && <span className="block truncate text-secondary text-ink-2">“{reference.endorsementText}”</span>}
              </span>
            </Link>
          </SquircleBox>
        )}

        {tips.map((s) => (
          <SquircleBox key={s.key} radius={20} className="bg-surface-subtle">
            <button type="button" onClick={() => go(s)} className="flex w-full items-center gap-3 px-4 py-4 text-left">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-hockia-soft text-[18px]" aria-hidden="true">✨</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold leading-[21px] text-ink-1">{s.title}</span>
                {s.subtitle && <span className="block truncate text-secondary text-ink-2">{s.subtitle}</span>}
              </span>
            </button>
          </SquircleBox>
        ))}

        {nothing && (
          <div className="px-6 py-16 text-center">
            <p className="text-body font-semibold text-ink-1">Nothing new this week</p>
            <p className="mt-1 text-secondary text-ink-2">Roles, views and references will show up here.</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Stack({ visual }: { visual: NextStep['visual'] }) {
  if (visual.kind === 'icon') {
    return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[18px]" aria-hidden="true">{visual.icon === 'user' ? '👤' : visual.icon === 'chart' ? '📈' : visual.icon === 'camera' ? '📷' : '🏑'}</span>
  }
  if (visual.kind === 'faces') {
    const people = visual.people.slice(0, 3)
    // One available player: their face in the green "Available now" ring (H3 review).
    if (people.length === 1) {
      const p = people[0]
      return (
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full p-[2px]" style={{ backgroundImage: AVAILABLE_RING }} aria-hidden="true">
          <span className="flex h-full w-full items-center justify-center rounded-full bg-white p-[2px]">
            <FaceCircle url={p.url} name={p.name} role={p.role} size="avatar-sm" initialsClassName="text-[13px]" className="h-full w-full" />
          </span>
        </span>
      )
    }
    return (
      <span className="relative h-10 shrink-0" style={{ width: 40 + (people.length - 1) * 20 }} aria-hidden="true">
        {people.map((p, i) => (
          <span key={i} className="absolute top-0" style={{ left: i * 20 }}>
            <FaceCircle url={p.url} name={p.name} role={p.role} size="avatar-sm" initialsClassName="text-[13px]" className="h-10 w-10 ring-2 ring-white" />
          </span>
        ))}
      </span>
    )
  }
  const urls = visual.urls.slice(0, 3)
  return (
    <span className="relative h-10 shrink-0" style={{ width: 40 + (urls.length - 1) * 20 }} aria-hidden="true">
      {urls.map((u, i) => (
        <span key={i} className={cn('absolute top-0 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-white p-1 ring-2 ring-white')} style={{ left: i * 20 }}>
          {u ? <img src={getImageUrl(u, 'avatar-sm') ?? u} alt="" className="h-full w-full object-contain" /> : <span className="h-full w-full bg-hockia-soft" />}
        </span>
      ))}
    </span>
  )
}
