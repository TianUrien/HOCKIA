import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { useAuthStore } from '@/lib/auth'
import { useWeeklyVisibility } from '@/hooks/useWeeklyVisibility'
import { useTrustedReferences } from '@/hooks/useTrustedReferences'
import { useWeekViewers } from '@/hooks/useYourWeek'
import { EntityAvatar } from '@/components/ui/EntityAvatar'
import { getImageUrl } from '@/lib/imageUrl'
import { referenceArrivedThisWeek } from '@/lib/pulseWeek'
import { hapticLight } from '@/lib/haptics'
import { cn } from '@/lib/utils'
import { useNextStep, type NextStep } from '@/components/home/v1/useNextStep'
import { SquircleBox } from '@/components/home/v1/primitives'
import { WhoLookedAtYou } from './WhoLookedAtYou'
import { FaceCircle } from '@/components/home/v1/FaceCircle'
import { AVAILABLE_RING } from '@/lib/homeEngagement'
import { trackDbEvent } from '@/lib/trackDbEvent'
import { tHome } from '@/i18n/ns/home'
import { trackNextStepAction } from '@/lib/homeInstrumentation'
import { useHockiaAiSheet } from '@/components/hockiaAi/hockiaAiSheetStore'
import RolePlaceholder from '@/components/RolePlaceholder'
import { isRoleAvatarRole } from '@/lib/roleAvatar'
import { useCommunityT } from '@/i18n/ns/community'

const REFERENCES_PATH = '/dashboard/profile?tab=references'
const TIP_KEYS = new Set(['photo', 'career', 'complete', 'crest', 'umpire'])

/**
 * What needs you (founder 2026-11-24): the Pulse action cards, at the top of
 * Inbox › Activity. In priority order: opportunities or applicants, the
 * availability check-in, who viewed you (masked viewers are a generic
 * placeholder, never a blurred crest), a reference from a friend (gold), a
 * profile tip. They used to be the "Your activity" page (/pulse) and the Next
 * step card on Home; /pulse now redirects here. Renders nothing when there is
 * nothing to act on, so the list of activity below keeps its own empty state.
 */
export function ActivityCards() {
  const location = useLocation()
  const navigate = useNavigate()
  const t = useCommunityT()
  const profile = useAuthStore((s) => s.profile)
  const { steps, loading, run, dismiss, markDone } = useNextStep()
  const showAi = useHockiaAiSheet((st) => st.show)
  const vis = useWeeklyVisibility(Boolean(profile), false)
  const viewers = useWeekViewers(profile?.role === 'player' || profile?.role === 'coach')
  const refs = useTrustedReferences(profile?.id ?? '')
  // The views step links here with ?viewers=1: open the list straight away.
  const [showViewers, setShowViewers] = useState(() => new URLSearchParams(location.search).get('viewers') === '1')
  // "Who viewed you" opened (gap 7): from a link (?viewers=1) or from this block.
  const viewersSource = useRef(showViewers ? 'link' : 'inbox_activity')
  useEffect(() => {
    if (!showViewers || !profile) return
    trackDbEvent('profile_viewers_view', 'profile', profile.id, { source: viewersSource.current })
    viewersSource.current = 'inbox_activity'
  }, [showViewers, profile])
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
    // Every tap is recorded, so the move from Home can be measured (67 members used the card there).
    trackNextStepAction(s.key, 'open', 'inbox_activity')
    if (s.action === 'fill_profile') { showAi('home', 'builder'); return }
    if (s.to) navigate(s.to)
  }
  const confirm = async (s: NextStep) => {
    setBusy(s.key)
    if (await run(s)) markDone(s.key)
    setBusy(null)
  }
  const notNow = (s: NextStep) => dismiss(s)

  if (nothing || (loading && steps.length === 0 && views === 0 && !reference)) return null

  return (
    <div data-testid="activity-cards">
      <div className="mx-auto flex max-w-md flex-col gap-3 px-4 pb-3 pt-1">
        {primary.map((s, i) => (
          <SquircleBox key={s.key} radius={20} className={i === 0 ? 'bg-hockia-soft' : 'bg-surface-subtle'}>
            <button type="button" onClick={() => go(s)} className="flex w-full items-center gap-3 px-4 py-4 text-left active:opacity-80">
              <Stack visual={s.visual} />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-[16px] font-semibold leading-[21px] text-ink-1">{s.title}</span>
                {s.subtitle && <span className="line-clamp-2 text-secondary text-ink-2">{s.subtitle}</span>}
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
                <span className="block text-[16px] font-semibold leading-[21px] text-ink-1">{checkIn.title === tHome('nextStep.checkIn.titlePlayer') ? t('pulse.activity.checkInTitle') : checkIn.title}</span>
                <span className="block text-secondary text-ink-2">{t('pulse.activity.checkInBody')}</span>
                <span className="mt-2.5 flex gap-2">
                  <button type="button" onClick={() => void confirm(checkIn)} disabled={busy === checkIn.key} className="h-9 rounded-full bg-hockia-primary px-4 text-[14px] font-semibold text-white disabled:opacity-60">
                    {t('pulse.activity.yesAvailable')}
                  </button>
                  <button type="button" onClick={() => void notNow(checkIn)} className="h-9 rounded-full border border-line bg-white px-4 text-[14px] font-semibold text-ink-1">
                    {t('pulse.activity.notNow')}
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
                <span className="line-clamp-2 text-[16px] font-semibold leading-[21px] text-ink-1">
                  {recruiters > 0 ? t('pulse.activity.clubsViewed', { count: recruiters }) : t('pulse.activity.profileViews', { count: views })}
                </span>
                <span className="line-clamp-2 text-secondary text-ink-2">{t('pulse.activity.viewsHint')}</span>
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
                <span className="line-clamp-2 text-[16px] font-semibold leading-[21px] text-ink-1">
                  {reference.profile?.fullName ? t('pulse.activity.leftReference', { name: reference.profile.fullName.split(/\s+/)[0] }) : t('pulse.activity.receivedReference')}
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
                <span className="line-clamp-2 text-[16px] font-semibold leading-[21px] text-ink-1">{s.title}</span>
                {s.subtitle && <span className="line-clamp-2 text-secondary text-ink-2">{s.subtitle}</span>}
              </span>
            </button>
          </SquircleBox>
        ))}
      </div>
    </div>
  )
}

function Stack({ visual }: { visual: NextStep['visual'] }) {
  if (visual.kind === 'placeholder') {
    return (
      <span className={cn('block h-10 w-10 shrink-0 overflow-hidden', visual.role === 'brand' ? 'rounded-[10px]' : 'rounded-full')} aria-hidden="true">
        <RolePlaceholder role={isRoleAvatarRole(visual.role) ? visual.role : 'player'} label="" />
      </span>
    )
  }
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
          {u ? <img src={getImageUrl(u, 'avatar-sm') ?? u} alt="" className="h-full w-full rounded-[25%] object-contain" /> : <span className="h-full w-full bg-hockia-soft" />}
        </span>
      ))}
    </span>
  )
}
